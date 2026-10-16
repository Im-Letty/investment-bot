"""Fixed Suzuki custom XML/HTML parsing; no I/O or AI calls.

The XML is a multi-year index, not RSS. Only a bounded 120 entries in relevant
fiscal-year groups are inspected. Its dates remain discovery evidence; an
original HTML heading/day and the parent announcing subject are mandatory.
"""
import re
from xml.etree import ElementTree

from company_news_selection import candidate_order, priority
from official_news_sources import _in_window

SUZUKI_CONFIG = dict(
    feed='https://www.suzuki.co.jp/release/release.xml', host='www.suzuki.co.jp',
    symbol='7269.T', name='スズキ', issuer='スズキ株式会社', actors=('スズキ株式会社',),
    path=r'/release/[a-d]/20\d{2}/\d{4}[a-z]?/', template='suzuki_xml',
    discovery_format='xml_custom', expansion_route=True)
MAX_INDEX_ITEMS = 120
MAX_YEAR_GROUPS = 40
_CATEGORY_PATH = {'car': 'a', 'motor': 'b', 'marine': 'c', 'corporate': 'd'}
_EMPTY = (None, None, '', None, None)


def _fiscal_year(day):
    return day.year - (day.month < 4)


def _path_day(url, publication):
    import company_news_additional as common
    match = re.fullmatch(r'/release/([a-d])/(20\d{2})/(\d{2})(\d{2})([a-z]?)/', common.urlsplit(url).path)
    day = publication['published_date']
    return match if match and f'{match[2]}-{match[3]}-{match[4]}' == day else None


def parse_index(payload, source, now, since, catalogue):
    import company_news_additional as common
    now, since = common._window(now, since)
    if not common.valid_identity(source, catalogue):
        return []
    config = common.SOURCES[source]
    if config.get('template') != 'suzuki_xml':
        return []
    text = common._decode(payload)
    if re.search(r'<!DOCTYPE|<!ENTITY', text, re.I):
        raise ValueError('unsupported_feed_declaration')
    try:
        root = ElementTree.fromstring(text)
    except ElementTree.ParseError as error:
        raise ValueError('unsupported_feed_structure') from error
    years = list(root)
    if root.tag != 'release' or len(years) > MAX_YEAR_GROUPS or any(node.tag != 'year' for node in years):
        raise ValueError('unsupported_feed_structure')
    ids = [node.get('id') for node in years]
    if (len(set(ids)) != len(ids) or any(not isinstance(value, str)
            or not re.fullmatch(r'ad(?:19|20)\d{2}', value) for value in ids)):
        raise ValueError('unsupported_feed_structure')
    records, conflicts, checked = {}, set(), 0
    for year in years:
        fiscal = int(year.get('id')[2:])
        if not _fiscal_year(since) <= fiscal <= _fiscal_year(now):
            continue
        if common._one(year, 'h1') != f'{fiscal}年4月～':
            raise ValueError('unsupported_feed_structure')
        for entry in year.findall('item'):
            checked += 1
            if checked > MAX_INDEX_ITEMS:
                break
            raw_day, raw_title, raw_url = (common._one(entry, tag) for tag in ('date', 'ttl', 'link'))
            publication = (common._day_text(raw_day) if isinstance(raw_day, str)
                           and re.fullmatch(r'20\d{2}年\d{1,2}月\d{1,2}日', raw_day.strip()) else None)
            url = common.safe_url(raw_url, source, config['feed'])
            title = common._plain(raw_title) if isinstance(raw_title, str) else ''
            score, category = priority(title)
            if (not publication or publication['published_at'] is not None
                    or not _in_window(publication, now, since) or not url
                    or not 1 <= len(title) <= common.MAX_TITLE_CHARS or score <= 0):
                continue
            from datetime import date
            actual = date.fromisoformat(publication['published_date'])
            match = _path_day(url, publication)
            if (_fiscal_year(actual) != fiscal or not match
                    or _CATEGORY_PATH.get(entry.get('class')) != match[1]):
                continue
            item = dict(source=source, symbol=config['symbol'], name=config['name'], issuer=config['issuer'],
                title=title, url=url, priority=score, category=category, discovery_format='xml_custom',
                feed_date_fields={'date': publication['published_date']}, **publication)
            if url in records and records[url] != item:
                conflicts.add(url)
            records[url] = item
        if checked >= MAX_INDEX_ITEMS:
            break
    return sorted((item for url, item in records.items() if url not in conflicts), key=candidate_order)


def article_layout(document, config, expected_url):
    import company_news_additional as common
    stage = common._single(common._nodes(document, tag='div', identifier='stage'))
    dates = common._single(common._nodes(document, stage, tag='div', identifier='releaseNumber')) if stage else None
    dated = common._single(common._nodes(document, dates, tag='div', identifier='date')) if dates else None
    root = common._single(common._nodes(document, stage, tag='div', identifier='mainContents')) if stage else None
    section = common._single(common._nodes(document, root, tag='section', cls='contents')) if root else None
    heading = common._single(common._nodes(document, section, tag='h1', identifier='releaseTitle')) if section else None
    lead = common._single(common._nodes(document, section, tag='div', identifier='lead')) if section else None
    end = common._single(common._nodes(document, section, tag='div', cls='backBtn')) if section else None
    og_urls = [node.attrs.get('content') for node in document.nodes
               if node.tag == 'meta' and node.attrs.get('property') == 'og:url']
    canonical = [node.attrs.get('href') for node in document.nodes
                 if node.tag == 'link' and node.attrs.get('rel') == 'canonical']
    if (not stage or not dates or not dated or not root or not section or not heading or not lead or not end
            or dates.parent is not stage or root.parent is not stage
            or stage.children.index(dates) >= stage.children.index(root)
            or section.parent is not root or lead.parent is not section or end.parent is not section
            or og_urls != [expected_url] or canonical and canonical != [expected_url]):
        return _EMPTY
    visible = common._body_text(dated)
    publication = common._day_text(visible) if re.fullmatch(r'\s*20\d{2}年\d{1,2}月\d{1,2}日\s*', visible) else None
    if not publication or not _path_day(expected_url, publication):
        return _EMPTY
    blocks = section.children
    if (not common._descends(heading, section)
            or document.nodes.index(heading) >= document.nodes.index(lead)
            or blocks.index(lead) >= blocks.index(end)):
        return _EMPTY
    lead_text = common._body_text(lead)
    if not common._declared_actor(config['issuer'], lead_text):
        return _EMPTY
    # Keep the full inspected narrative and qualifications after the lead,
    # stopping before the in-article back button. Images/header/footer/profile
    # panels outside this sibling range are not attribution or source prose.
    body = common._before_contact(blocks[blocks.index(lead):],
        lambda node: node is end or node.tag in ('footer', 'nav')
        or node.tag in ('h1', 'h2', 'h3') and common._body_text(node).strip() in ('お問い合わせ先', '関連情報'))
    return heading, dated, body, None, None
