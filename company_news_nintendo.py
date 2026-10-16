"""Inspected Nintendo corporate HTML/RSS parsing; no I/O at import.

Ordinary labeled HTML links only: images/PDFs are not source routes. The saved
RSS notice wrapper is removed for comparison with the original visible h1.
"""
import re
from xml.etree import ElementTree

NINTENDO_CONFIG = dict(
    feed='https://www.nintendo.co.jp/news/whatsnew.xml',
    host='www.nintendo.co.jp', symbol='7974.T', name='任天堂', issuer='任天堂株式会社',
    actors=('任天堂株式会社',),
    path=r'/corporate/release/20\d{2}/\d{6}(?:_\d+)?\.html',
    template='nintendo_rss', expansion_route=True)


def normalize_feed_payload(payload):
    """Unwrap only the inspected first-party corporate-release notice syntax.

    The fetched original bytes remain the evidence. This pure parsing view
    changes neither item dates/URLs nor the source's stored payload hash.
    """
    import company_news_additional as common
    text = common._decode(payload)
    if re.search(r'<!DOCTYPE|<!ENTITY', text, re.I):
        raise ValueError('unsupported_feed_declaration')
    try:
        root = ElementTree.fromstring(text)
    except ElementTree.ParseError as error:
        raise ValueError('unsupported_feed_structure') from error
    if root.tag != 'rss' or len(root.findall('channel')) != 1:
        raise ValueError('unsupported_feed_structure')
    for item in root.findall('channel/item')[:common.MAX_FEED_ITEMS]:
        titles, links = item.findall('title'), item.findall('link')
        if len(titles) != 1 or len(links) != 1:
            continue
        link = ''.join(links[0].itertext()).strip()
        if common.urlsplit(link).hostname != NINTENDO_CONFIG['host']:
            continue
        if re.fullmatch(NINTENDO_CONFIG['path'], common.urlsplit(link).path) is None:
            continue
        raw = ''.join(titles[0].itertext()).strip()
        match = re.fullmatch(r'ニュースリリース「(.+)」を公開しました。', raw, re.S)
        # Unknown publisher wrapper formats are rejected, not guessed.
        titles[0].clear()
        titles[0].text = match[1] if match else ''
    return ElementTree.tostring(root, encoding='utf-8')


def article_layout(document, config, expected_url):
    import company_news_additional as common
    invalid = (None, None, '', None, None)
    root = common._single(common._nodes(document, tag='div', identifier='nr_body'))
    if root is None:
        return invalid
    header = common._single(common._nodes(document, root, tag='div', cls='nr-headdata'))
    heading = common._single(common._nodes(document, root, tag='h1', cls='nr-header--1'))
    content = common._single(common._nodes(document, root, tag='div', identifier='nr_text'))
    og_urls = [node.attrs.get('content') for node in document.nodes
               if node.tag == 'meta' and node.attrs.get('property') == 'og:url']
    canonical = [node.attrs.get('href') for node in document.nodes
                 if node.tag == 'link' and node.attrs.get('rel') == 'canonical']
    if (header is None or heading is None or content is None or og_urls != [expected_url]
            or canonical and canonical != [expected_url]
            or any(node.parent is not root for node in (header, heading, content))
            or not root.children.index(header) < root.children.index(heading) < root.children.index(content)):
        return invalid
    paragraphs = [node for node in header.children if not isinstance(node, str)]
    if (len(paragraphs) != 3 or any(node.tag != 'p' for node in paragraphs)
            or any(not common._visible_content(node) for node in paragraphs)
            or common._body_text(paragraphs[1]).strip() != '各位'
            or common._body_text(paragraphs[2]).strip() != config['issuer']):
        return invalid
    published = common._day_text(common._body_text(paragraphs[0]))
    if published is None:
        return invalid
    match = re.fullmatch(r'/corporate/release/(20\d{2})/(\d{6})(?:_\d+)?\.html',
                         common.urlsplit(expected_url).path)
    if (match is None or match[1] != published['published_date'][:4]
            or match[2] != published['published_date'].replace('-', '')[2:]):
        return invalid
    # The visible signing issuer belongs to the same original. Keep it before
    # the narrative so durable identity validation need not rely on a footer.
    body = common._body_text(paragraphs[2]).strip() + '\n' + common._body_text(content)
    return heading, header, body, None, None
