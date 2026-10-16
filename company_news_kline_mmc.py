"""Inspected corporate HTML seams, with no network or route registration.

The source-specific use review and registry integration are separate. Original
prose is a private verification input; this module supplies no public copy.
"""
import re

from daily_news_sources import _Document
from official_news_sources import _agree, _in_window, _publication, _visible_content
from company_news_selection import candidate_order, priority

KLINE_CONFIG = dict(
    feed='https://www.kline.co.jp/ja/news/other.html', host='www.kline.co.jp',
    symbol='9107.T', name='川崎汽船', issuer='川崎汽船株式会社',
    actors=('川崎汽船株式会社',),
    path=r'/ja/news/other/other-20\d{6}(?:-\d+)?\.html',
    template='kline_html', discovery_format='html', expansion_route=True)
MMC_CONFIG = dict(
    feed='https://news.mmc.co.jp/corporate/ja/newsroom/press.html',
    host='news.mmc.co.jp', symbol='5711.T', name='三菱マテリアル',
    issuer='三菱マテリアル株式会社', actors=('三菱マテリアル株式会社',),
    path=r'/corporate/ja/newsroom/press/news20\d{6}[a-z]?\.html',
    template='mmc_html', discovery_format='html', expansion_route=True)
MAX_INDEX_ITEMS = 120
_TEMPLATES = frozenset(('kline_html', 'mmc_html'))
_EMPTY = (None, None, '', None, None)


def parse_index(payload, source, now, since, catalogue):
    """Read bounded original dated rows, excluding duplicate latest-news panels."""
    import company_news_additional as common
    now, since = common._window(now, since)
    if not common.valid_identity(source, catalogue):
        return []
    config = common.SOURCES[source]
    if config.get('template') not in _TEMPLATES:
        return []
    document = _Document(common._decode(payload))
    root = common._single(common._nodes(document, tag='div', cls='basic-list2',
                                       identifier='basic-list2-1'))
    listing = common._single(common._nodes(document, root, tag='ul', cls='tabItems')) if root else None
    if not listing:
        raise ValueError('unsupported_feed_structure')
    rows = [node for node in listing.children if not isinstance(node, str)
            and node.tag == 'li' and _visible_content(node)]
    records, conflicts = {}, set()
    for row in rows[:MAX_INDEX_ITEMS]:
        dated = common._single(common._nodes(document, row, tag='span', cls='date'))
        heading = common._single(common._nodes(document, row, tag='span', cls='news_tx'))
        anchor = common._single(common._nodes(document, row, tag='a'))
        visible = common._day_text(common._body_text(dated)) if dated else None
        stated = _publication(row.attrs.get('entrydate'))
        publication = _agree([visible, stated]) if visible and stated else None
        url = common.safe_url(anchor.attrs.get('href'), source, config['feed']) if anchor else None
        title = ' '.join(common._body_text(heading).split()) if heading else ''
        score, category = priority(title)
        if (not publication or publication['published_at'] is not None
                or not _in_window(publication, now, since) or not url
                or not heading or not dated or not anchor
                or not common._descends(heading, anchor) or not common._descends(dated, anchor)
                or not title or len(title) > common.MAX_TITLE_CHARS or score <= 0):
            continue
        match = re.search(r'(20\d{6})(?:-\d+|[a-z])?\.html$', common.urlsplit(url).path)
        if not match or match[1] != publication['published_date'].replace('-', ''):
            continue
        item = dict(source=source, symbol=config['symbol'], name=config['name'],
                    issuer=config['issuer'], title=title, url=url, priority=score,
                    category=category, feed_date_fields={'date': publication['published_date']},
                    discovery_format='html', **publication)
        if url in records and records[url] != item:
            conflicts.add(url)
        records[url] = item
    return sorted((item for url, item in records.items() if url not in conflicts), key=candidate_order)


def article_layout(document, config, expected_url):
    """Bind visible original date and opening parent actor to narrative only."""
    import company_news_additional as common
    if config.get('template') not in _TEMPLATES:
        return _EMPTY
    header = common._single(common._nodes(document, tag='div', identifier='page-intro'))
    heading = common._single(common._nodes(document, header, tag='h1')) if header else None
    dated = common._single(common._nodes(document, header, tag='div', cls='text-meta')) if header else None
    main = common._single(common._nodes(document, tag='div', identifier='sharewithmain'))
    body_node = common._single(common._nodes(document, tag='body', identifier='multi3'))
    day = common._day_text(common._body_text(dated)) if dated else None
    body_day = common._day_text(body_node.attrs.get('entrydate', '')) if body_node else None
    og_urls = [node.attrs.get('content') for node in document.nodes if node.tag == 'meta'
               and node.attrs.get('property') == 'og:url']
    canonical = [node.attrs.get('href') for node in document.nodes if node.tag == 'link'
                 and node.attrs.get('rel') == 'canonical']
    if (not heading or not dated or not main or main.attrs.get('role') != 'main'
            or dated.attrs.get('role') != 'contentinfo' or not day or not body_day
            or not _agree([day, body_day]) or og_urls != [expected_url]
            or canonical and canonical != [expected_url]):
        return _EMPTY
    blocks = common._nodes(document, main, tag='div', cls='rich-text')
    if not blocks:
        return _EMPTY
    paragraphs = []
    stop = False
    for block in blocks:
        parent = block.parent
        if (not parent or parent.tag != 'div' or not common._class(parent, 'text-section')
                or not parent.parent or not common._class(parent.parent, 'column')):
            return _EMPTY
        for node in block.children:
            if isinstance(node, str) or not _visible_content(node):
                continue
            # Observed narrative is direct paragraphs; tables, figures, image
            # captions and site/chrome content are not prose source material.
            if node.tag != 'p':
                continue
            text = common._body_text(node).strip()
            if (text == '以上' or text.startswith(('＜本件に関するお問い合わせ',
                    '【関連情報】', 'お問い合わせ先', '問い合わせ先'))):
                stop = True
                break
            if not text or re.fullmatch(r'【[^\n]{1,150}】', text):
                continue
            paragraphs.append(text)
        if stop:
            break
    if len(paragraphs) < 2:
        return _EMPTY
    signers = [line.strip() for line in paragraphs[0].splitlines() if line.strip()]
    if config['template'] == 'kline_html':
        if (len(signers) != 2 or signers[1] != config['issuer']
                or not _agree([day, common._day_text(signers[0])])):
            return _EMPTY
    elif signers != [config['issuer']]:
        return _EMPTY
    narrative = '\n'.join(paragraphs[1:])
    # A signatory or footer mention alone is insufficient for these inspected
    # layouts: the first narrative subject must be the exact listed parent.
    if not common._declared_actor(config['issuer'], narrative):
        return _EMPTY
    return heading, dated, '\n'.join(paragraphs), None, None
