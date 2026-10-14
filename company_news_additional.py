"""Fixed, inspected official corporate RSS/HTML routes; no requests or AI calls.

RSS or a fixed HTML index discovers candidates; an original heading, visible date and
announcing company are required before a private writing input is returned.
Coverage is this registered subset, not every Nikkei 225 announcement.
"""
from datetime import date, timedelta
from hashlib import sha256
import math
import re
import unicodedata
from urllib.parse import urljoin, urlsplit, urlunsplit
from xml.etree import ElementTree

from daily_news_sources import JST, _Document, _jsonld
from official_news_sources import (_agree, _body_text as _original_body_text, _descends, _in_window,
                                   _now, _publication, _visible_content)
from company_news_selection import candidate_order, priority
from company_news_official_html import FURUKAWA_CONFIG, TOSOH_CONFIG

MAX_BYTES = 1_000_000
MAX_FEED_ITEMS = 120
MAX_TITLE_CHARS = 400
MIN_BODY_CHARS = 100
MAX_BODY_CHARS = 20_000
RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
RSS = 'http://purl.org/rss/1.0/'
DC = 'http://purl.org/dc/elements/1.1/'


def _body_text(node, **options):
    """The original body helper plus explicit hidden-content exclusion."""
    # Work on a lightweight view, preserving each node's visibility ancestors;
    # source parsing never executes markup or changes the original document.
    from daily_news_sources import _Node
    def visible_copy(original):
        copy = _Node(original.tag, dict(original.attrs))
        pending = [(original, copy)]
        while pending:
            source, target = pending.pop()
            for child in source.children:
                if isinstance(child, str):
                    target.children.append(child)
                elif _visible_content(child):
                    clone = _Node(child.tag, dict(child.attrs), target)
                    target.children.append(clone)
                    pending.append((child, clone))
        return copy
    return _original_body_text(visible_copy(node), **options) if node and _visible_content(node) else ''

SOURCES = {
    'トヨタ自動車': dict(feed='https://global.toyota/export/jp/allnews_rss.xml',
        host='global.toyota', symbol='7203.T', name='トヨタ自動車', issuer='トヨタ自動車株式会社',
        path=r'/jp/newsroom/(?:corporate|toyota|lexus)/[1-9]\d*\.html', template='toyota',
        actors=('トヨタ自動車株式会社',)),
    '本田技研工業': dict(feed='https://global.honda/jp/rss/hotnews.xml',
        host='global.honda', symbol='7267.T', name='本田技研工業', issuer='本田技研工業株式会社',
        path=r'/jp/news/20\d{2}/[a-z]?\d{6,8}[a-z]?\.html', template='honda',
        actors=('本田技研工業株式会社', 'Honda'), tracking='from=RSS'),
    'ソフトバンクグループ': dict(feed='https://group.softbank/news/press/index.rdf',
        host='group.softbank', symbol='9984.T', name='ソフトバンクグループ', issuer='ソフトバンクグループ株式会社',
        path=r'/news/press/20\d{6}(?:_\d+)?', template='softbank', actors=('ソフトバンクグループ株式会社',)),
    '日本電気': dict(feed='https://jpn.nec.com/ja/press/press.xml',
        host='jpn.nec.com', symbol='6701.T', name='日本電気', issuer='日本電気株式会社',
        path=r'/press/20\d{4}/20\d{6}_\d+\.html', template='nec', actors=('日本電気株式会社',)),
    '電通グループ': dict(feed='https://www.group.dentsu.com/jp/news/release/index.xml',
        host='www.group.dentsu.com', symbol='4324.T', name='電通グループ', issuer='株式会社電通グループ',
        path=r'/jp/news/release/\d{6}\.html', template='dentsu', actors=('株式会社電通グループ',)),
    '三菱重工業': dict(feed='https://www.mhi.com/jp/rss/mhi_news.xml',
        host='www.mhi.com', symbol='7011.T', name='三菱重工業', issuer='三菱重工業株式会社',
        path=r'/jp/news/\d{6}(?:\d{2})?\.html', template='mhi', actors=('三菱重工業株式会社',)),
    '大阪ガス': dict(feed='https://www.osakagas.co.jp/company/press/rss/index.xml',
        host='www.osakagas.co.jp', symbol='9532.T', name='大阪瓦斯', issuer='大阪ガス株式会社',
        path=r'/company/press/pr20\d{2}/\d+_\d+\.html', template='osakagas', actors=('大阪ガス株式会社',)),
    'ブリヂストン': dict(feed='https://www.bridgestone.co.jp/corporate/news/rss/bridgestone_news.xml',
        host='www.bridgestone.co.jp', symbol='5108.T', name='ブリヂストン', issuer='株式会社ブリヂストン',
        path=r'/corporate/news/20\d{8}\.html', template='bridgestone', actors=('株式会社ブリヂストン',),
        tracking='ref=rss'),
    '大阪ガス（発表配信）': dict(feed='https://prtimes.jp/companyrdf.php?company_id=139670',
        host='prtimes.jp', symbol='9532.T', name='大阪瓦斯', issuer='Daigasグループ',
        path=r'/main/html/rd/p/[0-9]{9}\.000139670\.html', template='prtimes_group',
        actors=('大阪ガス株式会社',), company_id='139670'),
}
SOURCES['古河電気工業'] = dict(FURUKAWA_CONFIG)
SOURCES['東ソー'] = dict(TOSOH_CONFIG)
FEEDS = {label: config['feed'] for label, config in SOURCES.items()}


def direct_feed_company_count():
    """The three base RSS issuers plus unique RSS additions, excluding HTML."""
    return 3 + len({config['symbol'] for config in SOURCES.values()
                    if config.get('discovery_format') != 'html'})


def _compact(value):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', value)) if isinstance(value, str) else ''


def _plain(value):
    return ' '.join(_body_text(_Document(value).root).split()) if isinstance(value, str) else ''


def safe_url(value, source=None, base=None):
    """Only exact registered feeds and original release paths are fetchable."""
    if not isinstance(value, str):
        return None
    value = value.strip()  # Bridgestone's advertised RSS links contain edge whitespace.
    if (not value or len(value) > 2048 or '\\' in value
            or any(ord(char) < 33 or ord(char) == 127 for char in value)):
        return None
    try:
        parsed = urlsplit(urljoin(base, value) if base else value)
        if (parsed.scheme != 'https' or parsed.username is not None or parsed.password is not None
                or parsed.port not in (None, 443) or parsed.fragment or '%' in parsed.path):
            return None
        labels = [source] if source in SOURCES else list(SOURCES) if source is None else []
        for label in labels:
            config = SOURCES[label]
            if parsed.hostname != config['host']:
                continue
            normalized = urlunsplit(('https', config['host'], parsed.path, '', ''))
            full = urlunsplit(('https', config['host'], parsed.path, parsed.query, ''))
            if full == config['feed']:
                return full
            if (re.fullmatch(config['path'], parsed.path)
                    and (not parsed.query or parsed.query == config.get('tracking'))):
                return normalized
    except (ValueError, UnicodeError):
        pass
    return None


def _registered_member(label, catalogue):
    config = SOURCES.get(label) if isinstance(label, str) else None
    if not config or catalogue is None:
        return False
    member = catalogue.members.get(config['symbol'])
    return (isinstance(member, dict) and member.get('symbol') == config['symbol']
            and member.get('name') == config['name'] and len(member['name']) <= 200)


def valid_identity(source, catalogue):
    """Validate a durable article against its provided immutable catalogue.

    A label is accepted for feed discovery membership checks; a stored source
    dictionary must additionally preserve URL, actor and catalogue evidence.
    No current constituent download occurs when reading an older valid record.
    """
    if isinstance(source, str):
        return _registered_member(source, catalogue)
    if not isinstance(source, dict) or not _registered_member(source.get('source'), catalogue):
        return False
    config = SOURCES[source['source']]
    member, provenance = catalogue.members[config['symbol']], catalogue.provenance
    url, actor, body = source.get('url'), source.get('related_company'), source.get('body')
    if (source.get('symbol') != member['symbol'] or source.get('name') != member['name']
            or not isinstance(url, str) or safe_url(url, source['source']) != url or url == config['feed']
            or actor not in config['actors'] or not isinstance(body, str)
            or not MIN_BODY_CHARS <= len(body) <= MAX_BODY_CHARS
            or not _declared_actor(actor, body)
            or source.get('catalogue_as_of') != provenance['as_of']
            or source.get('catalogue_facts_sha256') != catalogue.facts_sha256
            or source.get('catalogue_source_sha256') != provenance['source_sha256']):
        return False
    mode = source.get('business_context_mode')
    if mode == 'announcement_only':
        return source.get('business') == body[:1800] and source.get('business_url') == url
    if mode != 'verified_profile':
        return False
    # The review source hash binds the original editorial profile. A later
    # profile revision must not invalidate an already reviewed archived item.
    business, business_url = source.get('business'), source.get('business_url')
    if not isinstance(business, str) or not 8 <= len(business.strip()) <= 2000 or not isinstance(business_url, str):
        return False
    try:
        parsed = urlsplit(business_url)
        return bool(parsed.scheme == 'https' and parsed.hostname and parsed.netloc == parsed.hostname
                    and parsed.username is None and parsed.password is None and not parsed.query
                    and not parsed.fragment and not any(ord(char) < 33 for char in business_url))
    except ValueError:
        return False


def _decode(payload):
    if not isinstance(payload, bytes) or len(payload) > MAX_BYTES:
        raise ValueError('source_size_limit')
    try:
        return payload.decode('utf-8-sig', errors='strict')
    except UnicodeDecodeError as exc:
        raise ValueError('unsupported_source_encoding') from exc


def _window(now, since):
    current = _now(now)
    boundary = current - timedelta(hours=72) if since is None else since
    if type(boundary) is not date:
        boundary = _now(boundary)
    return current, boundary


def _one(node, tag):
    fields = node.findall(tag)
    return ''.join(fields[0].itertext()) if len(fields) == 1 else None


def parse_feed(payload, source, now, since, catalogue):
    """Discover recent important releases without trusting titles as issuer proof."""
    now, since = _window(now, since)
    if not valid_identity(source, catalogue):
        return []
    if SOURCES[source].get('discovery_format') == 'html':
        from company_news_official_html import parse_index
        return parse_index(payload, source, now, since, catalogue)
    text = _decode(payload)
    if re.search(r'<!DOCTYPE|<!ENTITY', text, re.I):
        raise ValueError('unsupported_feed_declaration')
    try:
        root = ElementTree.fromstring(text)
    except ElementTree.ParseError as exc:
        raise ValueError('unsupported_feed_structure') from exc
    if root.tag == 'rss' and len(root.findall('channel')) == 1:
        entries, namespace = root.findall('channel/item'), ''
    elif root.tag == '{' + RDF + '}RDF' and len(root.findall('{' + RSS + '}channel')) == 1:
        entries, namespace = root.findall('{' + RSS + '}item'), '{' + RSS + '}'
    else:
        raise ValueError('unsupported_feed_structure')
    config, records, conflicts = SOURCES[source], {}, set()
    if config['template'] == 'prtimes_group':
        channel = root.find(namespace + 'channel')
        expected = config['feed']
        if channel is None or channel.get('{' + RDF + '}about') != expected:
            raise ValueError('unsupported_feed_structure')
    for entry in entries[:MAX_FEED_ITEMS]:
        if config['template'] == 'prtimes_group' and _one(entry, '{' + DC + '}corp') != config['issuer']:
            continue
        title = _plain(_one(entry, namespace + 'title'))
        url = safe_url(_one(entry, namespace + 'link'), source)
        date_fields = {}
        for tag in ('pubDate', '{' + DC + '}date', namespace + 'date'):
            nodes = entry.findall(tag)
            if nodes:
                date_fields[tag] = ''.join(nodes[0].itertext()) if len(nodes) == 1 else None
        dates = [_publication(value) for value in date_fields.values()]
        if any(value and value['published_at'] is not None and value['published_at'] > now.timestamp()
               for value in dates):
            continue
        publication = _agree(dates)
        score, category = priority(title)
        if (not title or len(title) > MAX_TITLE_CHARS or not url or url == config['feed']
                or not publication or not _in_window(publication, now, since) or score <= 0):
            continue
        candidate = {'source': source, 'symbol': config['symbol'], 'name': config['name'],
                     'issuer': config['issuer'], 'title': title, 'url': url, 'priority': score,
                     'category': category, 'feed_date_fields': date_fields, **publication}
        if url in records and records[url] != candidate:
            conflicts.add(url)
        records[url] = candidate
    return sorted((item for url, item in records.items() if url not in conflicts), key=candidate_order)


def _class(node, value):
    return value in node.attrs.get('class', '').split()


def _nodes(document, ancestor=None, *, tag=None, cls=None, identifier=None):
    return [node for node in document.nodes if (ancestor is None or _descends(node, ancestor))
            and (tag is None or node.tag == tag) and (cls is None or _class(node, cls))
            and (identifier is None or node.attrs.get('id') == identifier) and _visible_content(node)]


def _single(nodes):
    return nodes[0] if len(nodes) == 1 else None


def _day_text(value):
    match = re.match(r'^\s*(\d{4})(?:年|[./-])(\d{1,2})(?:月|[./-])(\d{1,2})(?:日|(?=\s|$))', value)
    if not match:
        return None
    try:
        return _publication(date(*map(int, match.groups())).isoformat())
    except ValueError:
        return None


def _before_contact(children, stop):
    """Read explicit sibling article blocks until the inspected contact/footer."""
    roots = []
    for node in children:
        if isinstance(node, str):
            continue
        if stop(node):
            break
        roots.append(node)
    return '\n'.join(_body_text(node, excluded_classes=frozenset({'comp-sns', 'secShare'})) for node in roots)


def _declared_actor(actor, body, dateline=''):
    """Require an issuer dateline or a leading announcing subject.

    A mention, possessive parent name, footer, or HondaJet brand cannot make
    the listed parent the announcer. Joint issuers in a fixed original
    dateline remain valid; the writer retains the entire original narrative.
    """
    legal = '株式会社' in actor
    if legal:
        for line in dateline.splitlines():
            if re.fullmatch(re.escape(actor) + r'(?:\s+(?:株式会社)?[^\s]+株式会社)*', line.strip()):
                return True
        # Toyota's inspected joint-statement issuer block is part of its body.
        lines = [line.strip() for line in body.splitlines() if line.strip()]
        for line in lines[:5]:
            if re.match(r'^\d{4}(?:年|[-./])|^PDFで見る$', line):
                continue
            if re.fullmatch(re.escape(actor) + r'(?:\s+(?:株式会社)?[^\s]+株式会社)*', line):
                return True
            if not re.fullmatch(r'.{2,200}(?:株式会社|股份有限公司|法人|大学)', line):
                break
    # Only the opening narrative can attribute the action. A later partner
    # mention or a quoted company background is insufficient.
    lines = [line.strip() for line in body.splitlines() if line.strip()]
    for line in lines[:5]:
        if re.match(r'^\d{4}(?:年|[-./])|^PDFで見る$', line) or (legal and line.endswith('株式会社')):
            continue
        prefix = re.escape(actor) + (r'(?:[（(][^（）()]{0,250}[）)])?' if legal else '')
        return bool(re.match(prefix + r'(?:は|が|と(?=[、,\s]|株式会社|有限会社|公益|学校|[A-Z])|、|,|および|及び)', line))
    return False


def _layout(document, config, now=None, expected_url=None):
    """Return heading, visible dateline, narrative and optional original clock."""
    template = config['template']
    if template in ('furukawa_html', 'tosoh_html'):
        from company_news_official_html import article_layout
        return article_layout(document, config, expected_url)
    if template == 'toyota':
        root = _single(_nodes(document, tag='div', cls='contents_main'))
        header = _single(_nodes(document, root, tag='div', cls='article_info')) if root else None
        heading = _single(_nodes(document, header, tag='h1', cls='title')) if header else None
        dateline = _single(_nodes(document, header, tag='p', cls='date')) if header else None
        blocks = [node for node in root.children if not isinstance(node, str) and node is not header] if root else []
        body = _before_contact(blocks, lambda node: '以上' == _plain(_body_text(node)))
        return heading, dateline, body, None, None
    if template == 'honda':
        root = _single(_nodes(document, tag='main', cls='tp22'))
        header = _single(_nodes(document, root, tag='div', cls='p-post22__head')) if root else None
        heading = _single(_nodes(document, header, tag='h1', cls='p-post22__title')) if header else None
        dateline = _single(_nodes(document, header, tag='time', cls='c-time22')) if header else None
        body_root = _single(_nodes(document, root, tag='div', cls='p-post22__body')) if root else None
        caption = _single(_nodes(document, header, tag='p', cls='p-post22__lead')) if header else None
        title = _body_text(heading) + (' ' + _body_text(caption) if caption else '') if heading else ''
        objects = [obj for obj in _jsonld(document) if obj.get('@type') in ('Article', 'NewsArticle')]
        clocks = [obj.get('datePublished') if heading and
                  _compact(_plain(obj.get('headline'))) == _compact(_body_text(heading)) else None
                  for obj in objects]
        # The inspected visible time has an invalid 2023-00-00 attribute. Only
        # datePublished, corroborated by RSS and the visible day, supplies a clock.
        return title, dateline, _body_text(body_root) if body_root else '', clocks, None
    if template == 'softbank':
        root = _single([node for node in _nodes(document, tag='article')
                        if 'data-history-node-id' in node.attrs])
        heading = _single(_nodes(document, root, tag='h1')) if root else None
        dateline = _single(_nodes(document, root, tag='time')) if root else None
        body_root = _single(_nodes(document, root, tag='div', cls='field-content')) if root else None
        return heading, dateline, _body_text(body_root) if body_root else '', None, dateline.attrs.get('datetime') if dateline else None
    if template == 'nec':
        root = _single(_nodes(document, tag='main', cls='site-main'))
        heading = _single(_nodes(document, root, tag='h1', cls='hdg')) if root else None
        body_root = _single(_nodes(document, root, tag='div', cls='str-column-main')) if root else None
        dates = [node for node in _nodes(document, body_root, tag='p', cls='align-right')
                 if _day_text(_body_text(node))] if body_root else []
        dateline = _single(dates)
        body = _before_contact(body_root.children if body_root else [],
                               lambda node: '本件に関するお問い合わせ先' in _body_text(node))
        return heading, dateline, body, None, None
    if template == 'dentsu':
        root = _single(_nodes(document, tag='main', cls='wrap-main'))
        heading = _single(_nodes(document, root, tag='h1', cls='hdg-lv1-article')) if root else None
        info = _single(_nodes(document, root, tag='div', cls='wrap-article-info')) if root else None
        dateline = _single([node for node in _nodes(document, info, tag='p') if _day_text(_body_text(node))]) if info else None
        body_root = _single(_nodes(document, root, tag='div', cls='wrap-edit')) if root else None
        return heading, dateline, _body_text(body_root) if body_root else '', None, None
    if template == 'mhi':
        root = _single(_nodes(document, tag='div', identifier='comMainContent'))
        heading = _single(_nodes(document, root, tag='h1')) if root else None
        date_root = _single(_nodes(document, root, tag='div', cls='field--name-field-published-date')) if root else None
        dateline = _single(_nodes(document, date_root, tag='time')) if date_root else None
        roots = [node for node in _nodes(document, root, tag='div') if any(_class(node, cls) for cls in
                 ('field--name-field-description', 'field--name-field-detail1', 'field--name-field-detail2'))] if root else []
        # MHI's inspected datetime attribute appends Z to the RSS Japan clock;
        # it is inconsistent. Preserve the visible original day, not a time.
        return heading, dateline, '\n'.join(_body_text(node) for node in roots), None, None
    if template == 'osakagas':
        root = _single(_nodes(document, tag='div', identifier='contents'))
        heading = _single([node for node in root.children if not isinstance(node, str) and node.tag == 'h2']) if root else None
        children = root.children[root.children.index(heading) + 1:] if heading else []
        dateline = _single([node for node in children if not isinstance(node, str) and node.tag == 'p'
                           and _class(node, 'aRight') and _day_text(_body_text(node))])
        body = _before_contact(children, lambda node: _class(node, 'secShare'))
        return heading, dateline, body, None, None
    if template == 'bridgestone':
        root = _single(_nodes(document, tag='article', identifier='main'))
        heading = _single(_nodes(document, root, tag='h2', cls='h2_basic01')) if root else None
        dateline = _single([node for node in _nodes(document, root, tag='p', cls='taR')
                           if _day_text(_body_text(node))]) if root else None
        body = '\n'.join(_body_text(node) for node in root.children if not isinstance(node, str)
                         and node not in (heading, dateline)
                         and not any(_class(node, cls) for cls in ('box01Wrap', 'h2_basic01Wrap'))) if root else ''
        return heading, dateline, body, None, None
    if template == 'prtimes_group':
        from company_news_prtimes import _article_date, _profile_id, _article_objects, _future_clock, _local_clock
        root = _single(_nodes(document, tag='article', identifier='js-heatmap-subject-area'))
        heading = _single(_nodes(document, root, tag='h1', identifier='press-release-title')) if root else None
        body_root = _single(_nodes(document, root, tag='div', identifier='press-release-body')) if root else None
        positions = {id(node): i for i, node in enumerate(document.nodes)}
        header = [node for node in _nodes(document, root) if body_root
                  and positions[id(node)] < positions[id(body_root)]] if root else []
        anchors = [node for node in header if node.tag == 'a' and _profile_id(node.attrs.get('href'))]
        dateline = _single([node for node in header if node.tag == 'time'])
        objects = _article_objects(document)
        if (len(anchors) != 1 or _profile_id(anchors[0].attrs.get('href')) != config['company_id']
                or _compact(_body_text(anchors[0])) != _compact(config['issuer'])
                or len(objects) != 1 or heading is None or dateline is None or body_root is None):
            return None, None, '', None, None
        obj = objects[0]
        if obj.get('url') is not None and obj.get('url') != expected_url:
            return None, None, '', None, None
        author = obj.get('author')
        author = author[0] if isinstance(author, list) and len(author) == 1 else author
        if (not isinstance(author, dict) or author.get('@type') != 'Organization'
                or _compact(author.get('name')) != _compact(config['issuer'])
                or _compact(_plain(obj.get('headline'))) != _compact(_body_text(heading))):
            return None, None, '', None, None
        metadata_day = _article_date(obj.get('datePublished'))
        visible_day = _article_date(dateline.attrs.get('datetime'))
        if not metadata_day or not visible_day or metadata_day['published_date'] != visible_day['published_date']:
            return None, None, '', None, None
        metadata_clock = _local_clock(obj.get('datePublished'))
        visible_clock = _local_clock(dateline.attrs.get('datetime'))
        if (metadata_clock is not None and visible_clock is not None and metadata_clock != visible_clock
                or now is not None and (_future_clock(obj.get('datePublished'), metadata_day, now)
                    or _future_clock(dateline.attrs.get('datetime'), visible_day, now))):
            return None, None, '', None, None
        # The inspected PR TIMES clock has no timezone. Keep its original
        # day, corroborated by the visible day and feed, rather than inventing
        # a Japanese publication time or using the RSS discovery timestamp.
        return heading, dateline, _body_text(body_root), [metadata_day['published_date']], None
    return None, None, '', None, None


def _context(member, body, url):
    business, sources = member.get('business'), member.get('business_sources')
    if isinstance(business, str) and 8 <= len(business.strip()) <= 2000 and isinstance(sources, list) and sources:
        value = sources[0].get('url') if isinstance(sources[0], dict) else None
        if isinstance(value, str) and value.startswith('https://'):
            return business, value, 'verified_profile'
    return body[:1800], url, 'announcement_only'


def extract_article(payload, item, final_url, now, since, *, observed_at=None, catalogue):
    """Return only a catalogue-matched original, never a feed excerpt fallback."""
    now, since = _window(now, since)
    if not isinstance(item, dict) or not valid_identity(item.get('source'), catalogue):
        return None
    source, config = item['source'], SOURCES[item['source']]
    member = catalogue.members[config['symbol']]
    url = safe_url(item.get('url'), source)
    title = item.get('title')
    if (not url or url != item.get('url') or safe_url(final_url, source) != url or final_url != url
            or item.get('symbol') != config['symbol'] or item.get('name') != member['name']
            or item.get('issuer') != config['issuer'] or not isinstance(title, str)
            or not 1 <= len(title) <= MAX_TITLE_CHARS or priority(title)[0] <= 0):
        return None
    fields = item.get('feed_date_fields')
    if not isinstance(fields, dict) or not fields or len(fields) > 3:
        return None
    if any(key not in ('pubDate', '{' + DC + '}date', '{' + RSS + '}date', 'date') for key in fields):
        return None
    feed_publication = _agree([_publication(value) for value in fields.values()])
    if (not feed_publication or not _in_window(feed_publication, now, since)
            or any(item.get(key) != feed_publication[key] for key in
                   ('published_date', 'published_at', 'publication_precision'))):
        return None
    observed_at = now.timestamp() if observed_at is None else observed_at
    if type(observed_at) not in (int, float) or not math.isfinite(observed_at) or observed_at <= 0:
        raise ValueError('invalid_verification_clock')
    document = _Document(_decode(payload))
    heading, dateline, body, metadata_clocks, visible_clock = _layout(document, config, now, url)
    visible_day = _day_text(_body_text(dateline)) if dateline else None
    heading_text = heading if isinstance(heading, str) else _body_text(heading) if heading else ''
    if (not heading_text or _compact(heading_text) != _compact(title) or not visible_day
            or not MIN_BODY_CHARS <= len(body) <= MAX_BODY_CHARS):
        return None
    values = [_publication(feed_publication['published_date']), visible_day]
    original_clocks = []
    if metadata_clocks is not None:
        if len(metadata_clocks) != 1:
            return None
        original_clocks.extend(metadata_clocks)
    if visible_clock is not None:
        original_clocks.append(visible_clock)
    if original_clocks:
        clock_dates = [_publication(value) for value in original_clocks]
        if any(value and value['published_at'] is not None and value['published_at'] > now.timestamp()
               for value in clock_dates):
            return None
        values += clock_dates + [feed_publication]
    publication = _agree(values)
    if not publication or not _in_window(publication, now, since):
        return None
    if config['template'] == 'prtimes_group':
        publication = _publication(publication['published_date'])
        if not _in_window(publication, now, since):
            return None
    # A parent-hosted page alone never attributes a subsidiary's announcement
    # to the parent. Require the inspected actor in the dateline or narrative.
    actors = [actor for actor in config['actors'] if _declared_actor(actor, body, _body_text(dateline))]
    if not actors:
        return None
    actor = actors[0]
    business, business_url, mode = _context(member, body, url)
    provenance = catalogue.provenance
    evidence = {'feed_published_at': None, 'feed_reported_at': feed_publication['published_at'],
                'feed_timestamp_role': 'discovery', 'feed_date_fields': dict(fields),
                'article_published_at': publication['published_at'], 'visible_original_date': _body_text(dateline),
                'article_original_clock': original_clocks or None}
    if config.get('discovery_format') == 'html':
        evidence = {'discovery_format': 'html_index', 'index_url': config['feed'],
                    'index_date_fields': dict(fields), 'index_timestamp_role': 'discovery',
                    'article_published_at': publication['published_at'],
                    'visible_original_date': _body_text(dateline), 'article_original_clock': original_clocks or None}
    return {'source': source, 'symbol': member['symbol'], 'name': member['name'], 'related_company': actor,
            'sector': member.get('sector') or '企業の取り組み', 'business': business,
            'business_url': business_url, 'business_context_mode': mode, 'title': title, 'url': url,
            'catalogue_as_of': provenance['as_of'], 'catalogue_source_sha256': provenance['source_sha256'],
            'catalogue_facts_sha256': catalogue.facts_sha256, 'body': body,
            'body_sha256': sha256(body.encode()).hexdigest(), 'body_verified_at': observed_at,
            'observed_at': observed_at, 'evidence_url': final_url, **publication,
            'publication_evidence': evidence}
