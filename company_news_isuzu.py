"""Fixed inspected Isuzu release parser; no network or publication side effects."""
import re

from daily_news_sources import _Document
from official_news_sources import _agree, _in_window, _publication
from company_news_selection import candidate_order, priority

ISUZU_CONFIG = dict(
    feed='https://www.isuzu-global.com/ja/newsroom.html', host='www.isuzu-global.com',
    symbol='7202.T', name='いすゞ自動車', issuer='いすゞ自動車株式会社',
    actors=('いすゞ自動車株式会社',), path=r'/ja/newsroom/20\d{6}(?:_\d+)?\.html',
    template='isuzu_html', discovery_format='html', expansion_route=True)
_EMPTY = (None, None, '', None, None)


def _day(value):
    import company_news_additional as common
    return common._day_text(value) if isinstance(value, str) and re.fullmatch(
        r'\s*20\d{2}年\d{1,2}月\d{1,2}日\s*', value) else None


def _path_day(url, publication):
    match = re.search(r'/ja/newsroom/(20\d{6})(?:_\d+)?\.html$', url)
    return bool(match and match[1] == publication['published_date'].replace('-', ''))


def parse_index(payload, source, now, since, catalogue):
    import company_news_additional as common
    now, since = common._window(now, since)
    if not common.valid_identity(source, catalogue):
        return []
    config = common.SOURCES[source]
    if config != ISUZU_CONFIG:
        return []
    document = _Document(common._decode(payload))
    # The first panel is a duplicate pickup subset; only the dated full-news
    # panel is authoritative for discovery, not the duplicated category tabs.
    root = common._single(common._nodes(document, tag='div', cls='basic-list2', identifier='basic-list2-2'))
    listing = common._single(common._nodes(document, root, tag='ul', cls='tabItems')) if root else None
    if not listing:
        raise ValueError('unsupported_feed_structure')
    records, conflicts = {}, set()
    rows = [node for node in listing.children if not isinstance(node, str)
            and node.tag == 'li' and common._visible_content(node)]
    for row in rows[:common.MAX_FEED_ITEMS]:
        anchor = common._single(common._nodes(document, row, tag='a'))
        dated = common._single(common._nodes(document, anchor, tag='span', cls='date')) if anchor else None
        heading = common._single(common._nodes(document, anchor, tag='span', cls='news_tx')) if anchor else None
        visible = _day(common._body_text(dated)) if dated else None
        raw_date = row.attrs.get('entrydate', '')
        stated = _publication(raw_date.replace('/', '-')) if re.fullmatch(r'20\d{2}/\d{2}/\d{2}', raw_date) else None
        publication = _agree([visible, stated]) if visible and stated else None
        url = common.safe_url(anchor.attrs.get('href'), source, config['feed']) if anchor else None
        title = ' '.join(common._body_text(heading).split()) if heading else ''
        score, category = priority(title)
        if (not publication or publication['published_at'] is not None or not _in_window(publication, now, since)
                or not url or not _path_day(url, publication) or not title
                or len(title) > common.MAX_TITLE_CHARS or score <= 0):
            continue
        item = dict(source=source, symbol=config['symbol'], name=config['name'], issuer=config['issuer'],
            title=title, url=url, priority=score, category=category,
            feed_date_fields={'date':publication['published_date']}, discovery_format='html', **publication)
        if url in records and records[url] != item:
            conflicts.add(url)
        records[url] = item
    return sorted((item for url,item in records.items() if url not in conflicts), key=candidate_order)


def declared_actor(actor, body, dateline=''):
    """The inspected original opens with the listed parent's own subject."""
    if actor != ISUZU_CONFIG['issuer'] or not isinstance(body, str):
        return False
    lines = [line.strip() for line in body.splitlines() if line.strip()]
    return bool(lines and re.match(re.escape(actor) +
        r'(?:[（(][^（）()]{0,250}[）)])?(?:は|が)', lines[0]))


def article_layout(document, config, expected_url):
    import company_news_additional as common
    if config != ISUZU_CONFIG:
        return _EMPTY
    body_node = common._single(common._nodes(document, tag='body', identifier='multi3'))
    header = common._single(common._nodes(document, tag='div', identifier='page-intro'))
    heading = common._single(common._nodes(document, header, tag='h1')) if header else None
    dated = common._single(common._nodes(document, header, tag='div', cls='text-meta')) if header else None
    main = common._single(common._nodes(document, tag='div', identifier='sharewithmain'))
    visible = _day(common._body_text(dated)) if dated else None
    stated = _day(body_node.attrs.get('entrydate', '')) if body_node else None
    publication = _agree([visible, stated]) if visible and stated else None
    og = [node.attrs.get('content') for node in document.nodes
          if node.tag=='meta' and node.attrs.get('property')=='og:url']
    canonical = [node.attrs.get('href') for node in document.nodes
                 if node.tag=='link' and node.attrs.get('rel')=='canonical']
    if (not body_node or not header or not heading or not dated or not main
            or main.attrs.get('role') != 'main' or dated.attrs.get('role') != 'contentinfo'
            or header.parent is not main.parent or not main.parent
            or main.parent.children.index(header) >= main.parent.children.index(main)
            or not publication or not _path_day(expected_url, publication)
            or og and og != [expected_url] or canonical and canonical != [expected_url]):
        return _EMPTY
    paragraphs = []
    for block in common._nodes(document, main, tag='div', cls='rich-text'):
        if (not block.parent or not common._class(block.parent, 'text-section')
                or not block.parent.parent or not common._class(block.parent.parent, 'column')):
            return _EMPTY
        for paragraph in block.children:
            if isinstance(paragraph, str) or paragraph.tag != 'p' or not common._visible_content(paragraph):
                continue
            text = common._body_text(paragraph).strip()
            if text == '以上' or text.startswith(('お問い合わせ先', '本件に関するお問い合わせ', '【関連情報】')):
                narrative = '\n'.join(paragraphs)
                return (heading, dated, narrative, None, None) if declared_actor(config['issuer'], narrative) else _EMPTY
            if text:
                paragraphs.append(text)
    narrative = '\n'.join(paragraphs)
    if not declared_actor(config['issuer'], narrative):
        return _EMPTY
    return heading, dated, narrative, None, None
