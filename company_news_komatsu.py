"""Fixed Komatsu visible release list and original narrative; no I/O."""
import re

from daily_news_sources import _Document
from official_news_sources import _in_window
from company_news_selection import candidate_order, priority

KOMATSU_CONFIG = dict(
    feed='https://www.komatsu.jp/ja/newsroom', host='www.komatsu.jp',
    symbol='6301.T', name='小松製作所', issuer='株式会社小松製作所',
    actors=('株式会社小松製作所', 'コマツ'), allow_alias_parenthetical=True,
    path=r'/ja/newsroom/20\d{2}/20\d{6}(?:_\d+)?',
    template='komatsu_html', discovery_format='html', expansion_route=True)
_EMPTY = (None, None, '', None, None)


def _visible_day(value):
    import company_news_additional as common
    if not isinstance(value, str) or not re.fullmatch(r'\s*20\d{2}年\d{1,2}月\d{1,2}日\s*', value):
        return None
    return common._day_text(value)


def _url_day(url, publication):
    match = re.search(r'/(20\d{2})/(20\d{6})(?:_\d+)?$', url)
    return bool(match and match[1] == publication['published_date'][:4]
                and match[2] == publication['published_date'].replace('-', ''))


def parse_index(payload, source, now, since, catalogue):
    import company_news_additional as common
    now, since = common._window(now, since)
    if not common.valid_identity(source, catalogue):
        return []
    config = common.SOURCES[source]
    if config != KOMATSU_CONFIG:
        return []
    document = _Document(common._decode(payload))
    lists = common._nodes(document, tag='dl', cls='newsList_dl')
    lists = [node for node in lists if node.parent and common._class(node.parent, 'newsList_inr')
             and node.parent.parent and common._class(node.parent.parent, 'cp_NewsList')]
    if not lists:
        raise ValueError('unsupported_feed_structure')
    rows = [row for listing in lists for row in listing.children if not isinstance(row, str)
            and row.tag == 'div' and common._visible_content(row)]
    records, conflicts = {}, set()
    for row in rows[:common.MAX_FEED_ITEMS]:
        dated = common._single(common._nodes(document, row, tag='dt', cls='newsList_dt'))
        inner = common._single(common._nodes(document, row, tag='div', cls='newsList_dd-inr'))
        anchor = common._single(common._nodes(document, inner, tag='a')) if inner else None
        publication = _visible_day(common._body_text(dated)) if dated else None
        url = common.safe_url(anchor.attrs.get('href'), source, config['feed']) if anchor else None
        title = ' '.join(common._body_text(anchor).split()) if anchor else ''
        score, category = priority(title)
        if (not publication or not _in_window(publication, now, since) or not url
                or not _url_day(url, publication) or not title
                or len(title) > common.MAX_TITLE_CHARS or score <= 0):
            continue
        item = dict(source=source, symbol=config['symbol'], name=config['name'], issuer=config['issuer'],
                    title=title, url=url, priority=score, category=category,
                    feed_date_fields={'date': publication['published_date']}, discovery_format='html', **publication)
        if url in records and records[url] != item:
            conflicts.add(url)
        records[url] = item
    return sorted((item for url, item in records.items() if url not in conflicts), key=candidate_order)


def article_layout(document, config, expected_url):
    import company_news_additional as common
    if config != KOMATSU_CONFIG:
        return _EMPTY
    root = common._single(common._nodes(document, tag='div', identifier='content cp_base'))
    title_root = common._single(common._nodes(document, root, tag='div', cls='cp_PageTitle')) if root else None
    heading = common._single(common._nodes(document, title_root, tag='h1')) if title_root else None
    dated_blocks = []
    for block in common._nodes(document, root, tag='div', cls='headingText1_inr') if root else []:
        holder = common._single([node for node in block.children if not isinstance(node, str) and node.tag == 'div'])
        if not holder:
            continue
        paragraphs = [node for node in holder.children if not isinstance(node, str) and node.tag == 'p'
                      and common._visible_content(node)]
        if paragraphs and _visible_day(common._body_text(paragraphs[0])):
            dated_blocks.append(paragraphs)
    og_urls = [node.attrs.get('content') for node in document.nodes if node.tag == 'meta'
               and node.attrs.get('property') == 'og:url']
    canonical = [node.attrs.get('href') for node in document.nodes if node.tag == 'link'
                 and node.attrs.get('rel') == 'canonical']
    if not root or not heading or len(dated_blocks) != 1 or og_urls != [expected_url] or canonical != [expected_url]:
        return _EMPTY
    paragraphs = dated_blocks[0]
    day = _visible_day(common._body_text(paragraphs[0]))
    if not day or not _url_day(expected_url, day):
        return _EMPTY
    texts = []
    for node in paragraphs[1:]:
        text = common._body_text(node).strip()
        if text == '以上' or text.startswith(('管理番号', '【お問い合わせ先】')):
            break
        if not text or re.fullmatch(r'【[^\n]{1,150}】', text):
            continue
        texts.append(text)
    body = '\n'.join(texts)
    if not any(common._declared_actor(actor, body, allow_alias_parenthetical=True) for actor in config['actors']):
        return _EMPTY
    return heading, paragraphs[0], body, None, None
