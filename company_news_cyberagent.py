"""Fixed first-party CyberAgent news HTML parsing; no I/O or AI calls."""
import re

from daily_news_sources import _Document, _Node
from official_news_sources import _agree, _in_window, _publication
from company_news_selection import candidate_order, priority

CYBERAGENT_CONFIG = dict(
    feed='https://www.cyberagent.co.jp/news/?pageID=1&search_ext_col_13%5B0%5D=1',
    host='www.cyberagent.co.jp', symbol='4751.T', name='サイバーエージェント',
    issuer='株式会社サイバーエージェント', actors=('株式会社サイバーエージェント',),
    path=r'/news/detail/id=[1-9]\d*', template='cyberagent_html',
    discovery_format='html', expansion_route=True)


def _visible_day(node):
    import company_news_additional as common
    if node is None:
        return None
    raw = common._body_text(node).strip()
    if re.fullmatch(r'20\d{2}年\s*\d{1,2}月\s*\d{1,2}日', raw) is None:
        return None
    visible = re.sub(r'\s+', '', raw)
    result = common._day_text(visible)
    stated = _publication(node.attrs.get('datetime'))
    if result is None or stated is None or stated['published_at'] is not None:
        return None
    agreed = _agree([result, stated])
    if agreed is None:
        return None
    normalized = _Node('time', dict(node.attrs), node.parent)
    normalized.children.append(visible)
    return agreed, normalized


def parse_index(payload, source, now, since, catalogue):
    import company_news_additional as common
    now, since = common._window(now, since)
    if not common.valid_identity(source, catalogue):
        return []
    config = common.SOURCES[source]
    document = _Document(common._decode(payload))
    main = common._single(common._nodes(document, tag='main', identifier='main', cls='l-main'))
    root = common._single(common._nodes(document, main, tag='div', cls='newsIndex')) if main else None
    listing = common._single(common._nodes(document, root, tag='ul', cls='m-cardGroup')) if root else None
    if listing is None:
        raise ValueError('unsupported_feed_structure')
    records, conflicts = {}, set()
    rows = [node for node in listing.children if not isinstance(node, str)
            and node.tag == 'li' and common._class(node, 'm-card') and common._visible_content(node)]
    for row in rows[:common.MAX_FEED_ITEMS]:
        anchor = common._single(common._nodes(document, row, tag='a'))
        info = common._single(common._nodes(document, anchor, tag='div', cls='m-card_body')) if anchor else None
        dated = common._single(common._nodes(document, info, tag='time')) if info else None
        heading = common._single(common._nodes(document, info, tag='p', cls='m-card_text')) if info else None
        found = _visible_day(dated)
        url = common.safe_url(anchor.attrs.get('href'), source, config['feed']) if anchor else None
        title = ' '.join(common._body_text(heading).split()) if heading else ''
        score, category = priority(title)
        if (found is None or not _in_window(found[0], now, since) or not url or url == config['feed']
                or not title or len(title) > common.MAX_TITLE_CHARS or score <= 0):
            continue
        publication = found[0]
        item = dict(source=source, symbol=config['symbol'], name=config['name'], issuer=config['issuer'],
                    title=title, url=url, priority=score, category=category,
                    feed_date_fields={'date': publication['published_date']}, discovery_format='html', **publication)
        if url in records and records[url] != item:
            conflicts.add(url)
        records[url] = item
    return sorted((item for url, item in records.items() if url not in conflicts), key=candidate_order)


def article_layout(document, config, expected_url):
    import company_news_additional as common
    invalid = (None, None, '', None, None)
    main = common._single(common._nodes(document, tag='main', identifier='main', cls='l-main'))
    root = common._single(common._nodes(document, main, tag='article', cls='newsDetail')) if main else None
    header = common._single(common._nodes(document, root, tag='header', cls='newsDetail_header')) if root else None
    heading = common._single(common._nodes(document, header, tag='h1', cls='newsDetail_header_title')) if header else None
    dated = common._single(common._nodes(document, header, tag='time')) if header else None
    outer = common._single(common._nodes(document, root, tag='div', cls='newsDetail_body')) if root else None
    content = common._single(common._nodes(document, outer, tag='div', cls='newsDetail_body_box')) if outer else None
    og_urls = [node.attrs.get('content') for node in document.nodes
               if node.tag == 'meta' and node.attrs.get('property') == 'og:url']
    canonical = [node.attrs.get('href') for node in document.nodes
                 if node.tag == 'link' and node.attrs.get('rel') == 'canonical']
    found = _visible_day(dated)
    if (root is None or heading is None or content is None or found is None
            or og_urls != [expected_url] or canonical and canonical != [expected_url]):
        return invalid
    body = common._body_text(content)
    if not common._declared_actor(config['issuer'], body):
        return invalid
    return heading, found[1], body, None, dated.attrs['datetime']
