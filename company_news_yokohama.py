"""One inspected issuer HTML route; pure parsing, no registration or requests.

Only this source's observed id/lang URL grammar is accepted. Original prose
remains a private verification input, never public archive material.
"""
import re
from urllib.parse import urljoin, urlsplit, urlunsplit

from daily_news_sources import _Document
from official_news_sources import _in_window
from company_news_selection import candidate_order, priority

YOKOHAMA_CONFIG = dict(
    feed='https://www.y-yokohama.com/release/', host='www.y-yokohama.com',
    symbol='5101.T', name='横浜ゴム', issuer='横浜ゴム株式会社',
    actors=('横浜ゴム株式会社',), path=r'/release/', template='yokohama_html',
    discovery_format='html', expansion_route=True)
MAX_INDEX_ITEMS = 120
_EMPTY = (None, None, '', None, None)
_QUERY = re.compile(r'id=[1-9][0-9]{0,7}&lang=ja')


def safe_url(value, base=None):
    """Only the exact issuer feed or observed numeric id plus Japanese locale."""
    if (type(value) is not str or not value or len(value) > 2048 or '\\' in value
            or any(ord(char) < 33 or ord(char) == 127 for char in value)):
        return None
    try:
        parsed = urlsplit(urljoin(base or YOKOHAMA_CONFIG['feed'], value))
        if (parsed.scheme != 'https' or parsed.hostname != YOKOHAMA_CONFIG['host']
                or parsed.username is not None or parsed.password is not None
                or parsed.port not in (None, 443) or parsed.fragment or parsed.path != '/release/'):
            return None
        if parsed.query and not _QUERY.fullmatch(parsed.query):
            return None
        return urlunsplit(('https', YOKOHAMA_CONFIG['host'], '/release/', parsed.query, ''))
    except (ValueError, UnicodeError):
        return None


def _visible_day(value):
    import company_news_additional as common
    if type(value) is not str or not re.fullmatch(r'\s*20\d{2}年\d{1,2}月\d{1,2}日\s*', value):
        return None
    return common._day_text(value)


def parse_index(payload, source, now, since, catalogue):
    """Use the unique visible dated list, not category/navigation headlines."""
    import company_news_additional as common
    now, since = common._window(now, since)
    if not common.valid_identity(source, catalogue):
        return []
    config = common.SOURCES[source]
    if config.get('template') != 'yokohama_html' or config != YOKOHAMA_CONFIG:
        return []
    document = _Document(common._decode(payload))
    main = common._single(common._nodes(document, tag='main'))
    listing = common._single(common._nodes(document, main, tag='ul', cls='md-li-06')) if main else None
    if not main or main.attrs.get('role') != 'main' or not listing:
        raise ValueError('unsupported_feed_structure')
    rows = [node for node in listing.children if not isinstance(node, str)
            and node.tag == 'li' and common._class(node, 'li-06-inr')]
    records, conflicts = {}, set()
    for row in rows[:MAX_INDEX_ITEMS]:
        anchor = common._single(common._nodes(document, row, tag='a', cls='md-link'))
        item = common._single(common._nodes(document, anchor, tag='dl', cls='md-item')) if anchor else None
        dated = common._single(common._nodes(document, item, tag='dt', cls='md-head')) if item else None
        title_node = common._single(common._nodes(document, item, tag='p', cls='md-ttl')) if item else None
        publication = _visible_day(common._body_text(dated)) if dated else None
        target = safe_url(anchor.attrs.get('href'), config['feed']) if anchor else None
        title = ' '.join(common._body_text(title_node).split()) if title_node else ''
        score, category = priority(title)
        if (not publication or not _in_window(publication, now, since) or not target
                or target == config['feed'] or not title or len(title) > common.MAX_TITLE_CHARS or score <= 0):
            continue
        result = dict(source=source, symbol=config['symbol'], name=config['name'], issuer=config['issuer'],
            title=title, url=target, priority=score, category=category,
            feed_date_fields={'date': publication['published_date']}, discovery_format='html', **publication)
        if target in records and records[target] != result:
            conflicts.add(target)
        records[target] = result
    return sorted((item for url, item in records.items() if url not in conflicts), key=candidate_order)


def declared_actor(actor, body, dateline=''):
    """Normal parent subject, or only the observed exact dotData joint subject.

    No general lowercase-partner grammar is added. A separate signer line or
    footer does not authorize this source: its first narrative must announce.
    """
    import company_news_additional as common
    if actor != YOKOHAMA_CONFIG['issuer'] or type(body) is not str:
        return False
    lines = [line.strip() for line in body.splitlines() if line.strip()]
    if not lines or lines[0] == actor:
        return False
    opening = lines[0]
    if common._declared_actor(actor, opening):
        return True
    prefix = re.escape(actor) + r'(?:[（(][^（）()]{0,250}[）)])?'
    partner = r'とdotData, Inc\.(?:[（(][^（）()]{0,250}[）)])?(?:は|が)'
    return bool(re.match(prefix + partner, opening))


def article_layout(document, config, expected_url):
    """Keep dated original narrative, excluding image/table/contact modules."""
    import company_news_additional as common
    if config != YOKOHAMA_CONFIG or not safe_url(expected_url) or expected_url == config['feed']:
        return _EMPTY
    main = common._single(common._nodes(document, tag='main'))
    if not main or main.attrs.get('role') != 'main':
        return _EMPTY
    headers = []
    for header in common._nodes(document, main, tag='div', cls='md-hd-17'):
        title = common._single(common._nodes(document, header, tag='h2', cls='md-ttl'))
        day = common._single(common._nodes(document, header, tag='p', cls='md-date'))
        if title and day:
            headers.append((header, title, day))
    if len(headers) != 1:
        return _EMPTY
    header, title, dated = headers[0]
    authors = [node.attrs.get('content') for node in document.nodes if node.tag == 'meta'
               and node.attrs.get('name') == 'author']
    og_urls = [node.attrs.get('content') for node in document.nodes if node.tag == 'meta'
               and node.attrs.get('property') == 'og:url']
    canonical = [node.attrs.get('href') for node in document.nodes if node.tag == 'link'
                 and node.attrs.get('rel') == 'canonical']
    if (authors != [config['issuer']] or not _visible_day(common._body_text(dated))
            or og_urls and og_urls != [expected_url] or canonical and canonical != [expected_url]):
        return _EMPTY
    sections = [node for node in main.children if not isinstance(node, str)
                and common._class(node, 'sec-contents--lv3')
                and any(not isinstance(child, str) and common._class(child, 'md-cl-27')
                        for child in node.children)]
    if len(sections) != 1 or header.parent not in main.children:
        return _EMPTY
    if main.children.index(sections[0]) <= main.children.index(header.parent):
        return _EMPTY
    body = []
    for block in sections[0].children:
        if isinstance(block, str) or not common._visible_content(block):
            continue
        if common._class(block, 'md-hd-05'):
            heading = common._single(common._nodes(document, block, tag='h2', cls='md-ttl'))
            text = common._body_text(heading).strip() if heading else ''
            if not text:
                return _EMPTY
            if text.startswith(('本件に関するお問い合わせ', 'お問い合わせ', '関連情報')):
                break
            body.append(text)
        elif block.tag == 'h3' and common._class(block, 'md-ttl'):
            body.append(common._body_text(block))
        elif block.tag == 'div' and common._class(block, 'md-cl-27'):
            item = common._single(common._nodes(document, block, tag='div', cls='md-item'))
            if not item:
                return _EMPTY
            for paragraph in item.children:
                if (not isinstance(paragraph, str) and paragraph.tag == 'p'
                        and common._class(paragraph, 'md-read')):
                    text = common._body_text(paragraph).strip()
                    if text:
                        body.append(text)
    narrative = '\n'.join(body)
    if not declared_actor(config['issuer'], narrative):
        return _EMPTY
    return title, dated, narrative, None, None
