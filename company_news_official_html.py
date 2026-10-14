"""Inspected first-party HTML discovery and layout, without network access.

The config alone does not register a route. The caller must separately approve
its use scope and bind it to the current catalogue. Original text stays private.
"""
import re

from daily_news_sources import _Document
from official_news_sources import _agree, _in_window, _publication
from company_news_selection import candidate_order, priority

FURUKAWA_CONFIG = dict(
    feed='https://www.furukawaelectric.com/release/',
    host='www.furukawaelectric.com', symbol='5801.T', name='古河電気工業',
    issuer='古河電気工業株式会社', actors=('古河電気工業株式会社',),
    path=r'/release/20\d{2}/(?:dev|kei|metal|opt|ene|comp|comm)_20\d{6}(?:_\d+)?\.html',
    template='furukawa_html', discovery_format='html', expansion_route=True)
TOSOH_CONFIG = dict(
    feed='https://www.tosoh.co.jp/news/release/', host='www.tosoh.co.jp',
    symbol='4042.T', name='東ソー', issuer='東ソー株式会社', actors=('東ソー',),
    path=r'/news/release/20\d{2}/20\d{6}(?:-\d+)?\.html',
    template='tosoh_html', discovery_format='html', expansion_route=True)
MAX_INDEX_ITEMS = 120


def parse_index(payload, source, now, since, catalogue):
    """Inspect only the fixed visible list; PDF and off-site links are excluded."""
    import company_news_additional as common
    now, since = common._window(now, since)
    if not common.valid_identity(source, catalogue):
        return []
    config = common.SOURCES[source]
    if config.get('template') == 'tosoh_html':
        return _tosoh_index(payload, source, now, since, config)
    if config.get('template') != 'furukawa_html':
        return []
    document = _Document(common._decode(payload))
    root = common._single(common._nodes(document, tag='main', cls='l-main'))
    listing = common._single(common._nodes(document, root, tag='ol', cls='m-link-news')) if root else None
    if not listing:
        raise ValueError('unsupported_feed_structure')
    rows = [node for node in listing.children if not isinstance(node, str)
            and node.tag == 'li' and common._class(node, 'm-link-news__item')]
    records, conflicts = {}, set()
    for row in rows[:MAX_INDEX_ITEMS]:
        dates = common._nodes(document, row, tag='time', cls='m-link-news__date')
        dated = common._single(dates)
        content = common._single(common._nodes(document, row, tag='div', cls='m-link-news__content'))
        anchor = common._single(common._nodes(document, content, tag='a', cls='m-link')) if content else None
        if not dated or not anchor:
            continue
        # Attribute and visible day must both exist and agree. Never infer a
        # publication day from the filename or from this retrieval's clock.
        visible = common._day_text(common._body_text(dated))
        stated = _publication(dated.attrs.get('datetime'))
        publication = _agree([visible, stated]) if visible and stated else None
        url = common.safe_url(anchor.attrs.get('href'), source, config['feed'])
        title = ' '.join(common._body_text(anchor).split())
        score, category = priority(title)
        if (not publication or publication['published_at'] is not None
                or not _in_window(publication, now, since) or not url or url == config['feed']
                or not title or len(title) > common.MAX_TITLE_CHARS or score <= 0):
            continue
        # The inspected filename repeats the original day. A mismatch is a
        # conflict, rather than another source from which to guess a date.
        path_match = re.fullmatch(r'/release/(20\d{2})/[a-z]+_(20\d{6})(?:_\d+)?\.html',
                                  common.urlsplit(url).path)
        if (not path_match or path_match[1] != publication['published_date'][:4]
                or path_match[2] != publication['published_date'].replace('-', '')):
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
    """Bind a visible original day and leading issuer block to the narrative."""
    import company_news_additional as common
    if config.get('template') == 'tosoh_html':
        return _tosoh_article(document, config, expected_url)
    root = common._single(common._nodes(document, tag='main', cls='l-main'))
    header = common._single(common._nodes(document, root, tag='div', cls='l-page-title')) if root else None
    heading = common._single(common._nodes(document, header, tag='h1', cls='l-page-title__title')) if header else None
    captions = common._nodes(document, header, tag='p', cls='l-page-title__sub-title') if header else []
    content = common._single(common._nodes(document, root, tag='div', cls='l-content__inner')) if root else None
    canonical = [node.attrs.get('href') for node in document.nodes if node.tag == 'link'
                 and node.attrs.get('rel') == 'canonical']
    og_urls = [node.attrs.get('content') for node in document.nodes if node.tag == 'meta'
               and node.attrs.get('property') == 'og:url']
    if (not heading or not content or len(captions) > 1
            or og_urls != [expected_url] or canonical and canonical != [expected_url]):
        return None, None, '', None, None
    blocks = [node for node in content.children if not isinstance(node, str)]
    # The observed first two blocks contain the day then the signing issuers.
    # A parent name found in a footer or a partner profile cannot satisfy this.
    if (len(blocks) < 3 or any(node.tag != 'div' or not common._class(node, 'text-right')
                              for node in blocks[:2])):
        return None, None, '', None, None
    dated = common._single(common._nodes(document, blocks[0], tag='p', cls='m-text__item'))
    issuer = common._single(common._nodes(document, blocks[1], tag='p', cls='m-text__item'))
    signers = [line.strip() for line in common._body_text(issuer).splitlines() if line.strip()] if issuer else []
    if (not dated or not common._day_text(common._body_text(dated)) or not signers
            or config['issuer'] not in signers or len(signers) > 8
            or any(not re.fullmatch(r'.{2,200}(?:株式会社|法人|大学)|株式会社.{1,200}', line)
                   for line in signers)):
        return None, None, '', None, None
    def stop(node):
        return (node.tag in ('h2', 'h3') and common._body_text(node).strip() in
                ('関連ページ', '古河電工グループについて', 'お問い合わせ先'))
    body = common._before_contact(blocks, stop)
    title = common._body_text(heading)
    if captions:
        title += ' ' + common._body_text(captions[0])
    return title, dated, body, None, None


def _tosoh_index(payload, source, now, since, config):
    import company_news_additional as common
    document = _Document(common._decode(payload))
    root = common._single(common._nodes(document, tag='main', cls='news_sort'))
    if not root:
        raise ValueError('unsupported_feed_structure')
    blocks = common._nodes(document, root, tag='div', cls='mod-selectBox_block')
    records, conflicts, checked = {}, set(), 0
    for block in blocks:
        year = block.attrs.get('data-year', '')
        if not re.fullmatch(r'20\d{2}', year) or not since.year <= int(year) <= now.year:
            continue
        listing = common._single(common._nodes(document, block, tag='ul', cls='mod-news_content_list'))
        if not listing:
            continue
        for row in listing.children:
            if isinstance(row, str) or row.tag != 'li' or not common._class(row, 'mod-news_content_item'):
                continue
            checked += 1
            if checked > MAX_INDEX_ITEMS:
                break
            anchor = common._single(common._nodes(document, row, tag='a'))
            date_root = common._single(common._nodes(document, anchor, tag='div', cls='mod-news_content-date')) if anchor else None
            dated = common._single(common._nodes(document, date_root, tag='p', cls='mod-news_content-time')) if date_root else None
            heading = common._single(common._nodes(document, anchor, tag='div', cls='mod-news_content_txt')) if anchor else None
            publication = common._day_text(common._body_text(dated)) if dated else None
            url = common.safe_url(anchor.attrs.get('href'), source, config['feed']) if anchor else None
            title = ' '.join(common._body_text(heading).split()) if heading else ''
            score, category = priority(title)
            if (not publication or publication['published_date'][:4] != year
                    or not _in_window(publication, now, since) or not url or url == config['feed']
                    or not title or len(title) > common.MAX_TITLE_CHARS or score <= 0):
                continue
            match = re.fullmatch(r'/news/release/(20\d{2})/(20\d{6})(?:-\d+)?\.html', common.urlsplit(url).path)
            if (not match or match[1] != year
                    or match[2] != publication['published_date'].replace('-', '')):
                continue
            item = dict(source=source, symbol=config['symbol'], name=config['name'], issuer=config['issuer'],
                        title=title, url=url, priority=score, category=category,
                        feed_date_fields={'date': publication['published_date']}, discovery_format='html', **publication)
            if url in records and records[url] != item:
                conflicts.add(url)
            records[url] = item
        if checked >= MAX_INDEX_ITEMS:
            break
    return sorted((item for url, item in records.items() if url not in conflicts), key=candidate_order)


def _tosoh_article(document, config, expected_url):
    import company_news_additional as common
    root = common._single(common._nodes(document, tag='main', cls='news_release'))
    content = common._single(common._nodes(document, root, tag='div', cls='container')) if root else None
    header = common._single(common._nodes(document, content, tag='div', cls='mod-newsTtl')) if content else None
    heading = common._single(common._nodes(document, header, tag='h1', cls='mod-h1')) if header else None
    dated = common._single(common._nodes(document, header, tag='p', cls='mod-newsTtl-time')) if header else None
    og_urls = [node.attrs.get('content') for node in document.nodes if node.tag == 'meta'
               and node.attrs.get('property') == 'og:url']
    canonical = [node.attrs.get('href') for node in document.nodes if node.tag == 'link'
                 and node.attrs.get('rel') == 'canonical']
    if (not content or not heading or not dated or not common._day_text(common._body_text(dated))
            or og_urls != [expected_url] or canonical and canonical != [expected_url]
            or header not in content.children):
        return None, None, '', None, None
    # Do not use the print-only header as a visible day or issuer proof. The
    # narrative itself must open with this parent's exact inspected alias.
    blocks = content.children[content.children.index(header) + 1:]
    body = common._before_contact(blocks, lambda node: node.tag in ('h2', 'h3')
                                  and common._body_text(node).strip() in ('お問い合わせ先', '関連情報'))
    if not common._declared_actor(config['actors'][0], body):
        return None, None, '', None, None
    return heading, dated, body, None, None
