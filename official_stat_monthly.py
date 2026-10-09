"""Verify the monthly release inside the Statistics Bureau's mixed result page.

This adapter reads an already downloaded document. It has no network, clock,
generation or publication operations; the caller records actual verification.
"""
import re


_URL = "https://www.stat.go.jp/data/kakei/sokuhou/tsuki/index.html"
_RSS_PERIOD = re.compile(
    r"^家計調査\(二人以上の世帯:(\d{4})年\(令和(元|\d+)年\)(\d{1,2})月分\)$")
_HEADING = re.compile(
    r"^家計調査\(二人以上の世帯\)(\d{4})年\(令和(元|\d+)年\)(\d{1,2})月分\((.+)公表\)$")


def _period(groups):
    year, era, month = groups
    era_year = 1 if era == "元" else int(era)
    year, month = int(year), int(month)
    if era_year <= 0 or year != 2018 + era_year or not 1 <= month <= 12:
        return None
    return year, month


def extract_stat_monthly(document, item, original, final, now, since, observed_at):
    """Return a date-verified monthly record, excluding quarterly/annual results.

    Only this fixed result URL and its inspected ``tsuki``/``shihanki`` layout
    qualify. The RSS period, monthly heading and explicit publication day must
    agree. Historical columns in the monthly comparison table retain their
    labels; the separate quarterly and annual releases are outside the scope.
    """
    # Import at call time so official_news_sources can invoke this adapter.
    import official_news_sources as sources
    from official_news_sources import _visible_content
    from daily_news_sources import _Node

    if (original != _URL or final != _URL or not isinstance(item, dict)
            or item.get("source") != "総務省統計局"
            or item.get("url") != original
            or not isinstance(item.get("title"), str)
            or len(item["title"]) > 1000
            or any(key not in item for key in
                   ("published_at", "published_date", "publication_precision"))):
        return None
    rss_match = _RSS_PERIOD.fullmatch(sources._compact(item["title"]))
    rss_period = _period(rss_match.groups()) if rss_match else None
    if rss_period is None:
        return None
    mains = [node for node in document.nodes if node.tag == "main"
             and node.attrs.get("id") == "main_contents"]
    if len(mains) != 1:
        return None
    main = mains[0]
    if not _visible_content(main):
        return None
    headings = [node for node in document.nodes if node.tag == "h1"
                and sources._descends(node, main)]
    if (len(headings) != 1 or not _visible_content(headings[0])
            or sources._compact(sources._body_text(headings[0]))
            != "家計調査報告―月・四半期・年―"):
        return None
    article = headings[0].parent
    if (article.tag != "article" or article.parent is None
            or article.parent.tag != "section" or article.parent.attrs.get("id") != "section"):
        return None
    anchors = [node for node in document.nodes if node.tag == "a"
               and sources._descends(node, main)
               and (node.attrs.get("id") == "tsuki" or node.attrs.get("name") == "tsuki")]
    if (len(anchors) != 1 or anchors[0].attrs.get("id") != "tsuki"
            or anchors[0].attrs.get("name") != "tsuki"):
        return None
    heading = anchors[0].parent
    if (heading.tag != "h2" or heading.parent is not article
            or not _visible_content(heading) or not _visible_content(anchors[0])):
        return None
    heading_text = sources._body_text(heading)
    if len(heading_text) > 1000:
        return None
    heading_match = _HEADING.fullmatch(sources._compact(heading_text))
    if heading_match is None or _period(heading_match.groups()[:3]) != rss_period:
        return None
    day_match = re.fullmatch(sources._JAPANESE_DATE, heading_match.group(4))
    publication_day = sources._japanese_day(day_match) if day_match else None
    if (publication_day is None or publication_day.isoformat() != item["published_date"]
            or rss_period >= (publication_day.year, publication_day.month)):
        return None

    siblings = article.children
    first = siblings.index(heading)
    last = next((index for index in range(first + 1, len(siblings))
                 if not isinstance(siblings[index], str) and siblings[index].tag == "h2"), None)
    if last is None:
        return None
    boundary = siblings[last]
    next_anchors = [node for node in document.nodes if node.tag == "a"
                    and sources._descends(node, boundary)
                    and node.attrs.get("id") == "shihanki" and node.attrs.get("name") == "shihanki"]
    if (len(next_anchors) != 1 or not _visible_content(boundary)
            or not _visible_content(next_anchors[0])):
        return None
    monthly = _Node("div")
    monthly.children = siblings[first:last]
    included = [node for node in monthly.children if not isinstance(node, str)]
    monthly_nodes = [node for node in document.nodes
                     if any(node is top or sources._descends(node, top) for top in included)]
    if any(not _visible_content(node) or node.tag in ("section", "article")
           or (node.tag == "h2" and node is not heading) for node in monthly_nodes):
        return None
    body = sources._body_text(monthly)
    content = [node for node in monthly_nodes if node.tag in ("p", "table", "dl", "ul", "ol")]
    content = [node for node in content if not any(other is not node and sources._descends(node, other)
                                                 for other in content)]
    if len("\n".join(sources._body_text(node) for node in content)) < sources.MIN_BODY_CHARS:
        return None
    publication = sources._agree([item, sources._html_date(document, body)])
    record = sources._record(item, original, final, body, publication, observed_at, now, since)
    if record is not None:
        record.update(source_scope="official_statistics_monthly_result",
                      result_period=f"{rss_period[0]:04d}-{rss_period[1]:02d}")
    return record
