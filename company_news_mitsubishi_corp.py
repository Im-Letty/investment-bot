"""Fixed Mitsubishi Corporation JSON discovery and original HTML; no I/O."""
import json
import re

from daily_news_sources import _Document
from official_news_sources import _agree, _in_window, _publication
from company_news_selection import candidate_order, priority

MITSUBISHI_CORP_CONFIG = dict(
    feed='https://www.mitsubishicorp.com/jp/ja/data/news/json/list.json',
    host='www.mitsubishicorp.com', symbol='8058.T', name='三菱商事',
    issuer='三菱商事株式会社', actors=('三菱商事株式会社',),
    path=r'/jp/ja/news/release/20\d{2}/20\d{6}\d{3}\.html',
    template='mitsubishi_corp_json', discovery_format='json', expansion_route=True)
_EMPTY = (None, None, '', None, None)


def _visible_day(value):
    import company_news_additional as common
    if not isinstance(value, str) or not re.fullmatch(r'\s*20\d{2}年\d{1,2}月\d{1,2}日\s*', value):
        return None
    return common._day_text(value)


def _url_day(url, publication):
    match = re.search(r'/(20\d{2})/(20\d{6})\d{3}\.html$', url)
    return bool(match and match[1] == publication['published_date'][:4]
                and match[2] == publication['published_date'].replace('-', ''))


def _pairs(values):
    result = {}
    for key, value in values:
        if key in result:
            raise ValueError('unsupported_feed_structure')
        result[key] = value
    return result


def _invalid_constant(value):
    raise ValueError('invalid_json_constant')


def parse_index(payload, source, now, since, catalogue):
    """Use only published-date fields and the bounded displayed release rows."""
    import company_news_additional as common
    now, since = common._window(now, since)
    if not common.valid_identity(source, catalogue):
        return []
    config = common.SOURCES[source]
    try:
        data = json.loads(common._decode(payload), object_pairs_hook=_pairs,
                          parse_constant=_invalid_constant)
    except (ValueError, TypeError, RecursionError) as exc:
        raise ValueError('unsupported_feed_structure') from exc
    rows = data.get('newsReleaseData') if isinstance(data, dict) else None
    if not isinstance(rows, list):
        raise ValueError('unsupported_feed_structure')
    records, conflicts = {}, set()
    for row in rows[:common.MAX_FEED_ITEMS]:
        if not isinstance(row, dict) or row.get('linkIcon') != '詳細ページ':
            continue
        if any(not isinstance(row.get(key), str) for key in
               ('publishDate1', 'publishDate2', 'publishYear', 'url', 'title')):
            continue
        visible = _visible_day(row['publishDate1'])
        stated = _publication(row['publishDate2'])
        publication = _agree([visible, stated]) if visible and stated else None
        url = common.safe_url(row['url'], source, config['feed'])
        title = common._plain(row['title'])
        score, category = priority(title)
        if (not publication or publication['published_at'] is not None
                or not re.fullmatch(r'20\d{2}-\d{2}-\d{2}', row['publishDate2'])
                or row['publishYear'] != publication['published_date'][:4]
                or not _in_window(publication, now, since) or not url
                or not title or len(title) > common.MAX_TITLE_CHARS or score <= 0):
            continue
        if not _url_day(url, publication):
            continue
        item = dict(source=source, symbol=config['symbol'], name=config['name'], issuer=config['issuer'],
                    title=title, url=url, priority=score, category=category,
                    feed_date_fields={'date': publication['published_date']}, discovery_format='json', **publication)
        if url in records and records[url] != item:
            conflicts.add(url)
        records[url] = item
    return sorted((item for url, item in records.items() if url not in conflicts), key=candidate_order)


def article_layout(document, config, expected_url):
    """Read the original article, excluding the related/contact/footer blocks."""
    import company_news_additional as common
    main = common._single(common._nodes(document, tag='main', cls='l-main'))
    heading = common._single(common._nodes(document, main, tag='h1', cls='p-pagetitle1__hd')) if main else None
    post = common._single(common._nodes(document, main, tag='div', cls='p-post')) if main else None
    dated = common._single(common._nodes(document, post, tag='div', cls='prDate')) if post else None
    content = common._single(common._nodes(document, post, tag='div', cls='news-body')) if post else None
    og_urls = [node.attrs.get('content') for node in document.nodes if node.tag == 'meta'
               and node.attrs.get('property') == 'og:url']
    canonical = [node.attrs.get('href') for node in document.nodes if node.tag == 'link'
                 and node.attrs.get('rel') == 'canonical']
    day = _visible_day(common._body_text(dated)) if dated else None
    if (not heading or not content or not day or og_urls != [expected_url]
            or canonical != [expected_url]):
        return _EMPTY
    if not _url_day(expected_url, day):
        return _EMPTY
    paragraphs = []
    for block in content.children:
        if isinstance(block, str) or not common._visible_content(block):
            continue
        if block.tag == 'hr' or common._class(block, 'prFrame01'):
            break
        if block.tag == 'div' and common._class(block, 'p-txt01'):
            paragraphs.append(common._body_text(block))
    body = '\n'.join(paragraphs)
    if not common._declared_actor(config['issuer'], body):
        return _EMPTY
    return heading, dated, body, None, None
