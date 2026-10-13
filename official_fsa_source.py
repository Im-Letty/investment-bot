"""Read the inspected Financial Services Agency release template.

This adapter performs no network, clock, AI, publication or persistence work.
RSS dates are discovery evidence; their time is not an original release time.
Attachments and external material are outside this HTML-only source scope.
"""
from datetime import date
from email.utils import parsedate_to_datetime
import re
import unicodedata
from urllib.parse import urlsplit


SOURCE = "金融庁"
FEED_URL = "https://www.fsa.go.jp/fsaNewsListAll_rss2.xml"
_HOST = "www.fsa.go.jp"
_PATH = re.compile(
    r"/news/r[1-9]\d?/(?:hoken|sonota|shouken|ginkou)/"
    r"(?:(\d{8})/)?(\d{8})(?:_[a-z0-9]+|[a-z]+)?\.html")
_TOPIC = re.compile(r"金融|保険|預貯金|口座|証券|銀行|信用|資産運用|NISA|サイバーセキュリティ")
_EXCLUDED = re.compile(
    r"予定|募集|入札|採用|調達|公募|開催|会議|会合|連絡会|議事|"
    r"パブリックコメント|意見募集|訂正|正誤表|更新しました|差替|差し替|取消|取り消し")
_RFC_JST = re.compile(
    r"(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), "
    r"\d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) "
    r"\d{4} \d{2}:\d{2}:\d{2} JST")


def _compact(value):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", value))


def article_path(path):
    """Accept only fixed Japanese FSA news categories and dated HTML paths."""
    return isinstance(path, str) and _PATH.fullmatch(path) is not None


def eligible_title(title):
    """Exclude schedules, corrections, meeting records and general updates."""
    return (isinstance(title, str) and 0 < len(title) <= 1000
            and _TOPIC.search(title) is not None
            and _EXCLUDED.search(title) is None)


def feed_publication(value):
    """Return the corroboratable RSS calendar day, never its presumed time.

    This feed currently uses the non-standard RFC timezone name JST. Limit the
    conversion to the inspected format rather than teaching the generic parser
    to guess arbitrary timezone abbreviations. The displayed original release
    remains date-only even when the discovery feed carries a delivery time.
    """
    if not isinstance(value, str) or not _RFC_JST.fullmatch(value.strip()):
        return None
    value = value.strip()
    try:
        parsed = parsedate_to_datetime(value[:-3] + "+0900")
        weekdays = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
        months = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
        expected = (f"{weekdays[parsed.weekday()]}, {parsed.day:02d} {months[parsed.month - 1]} "
                    f"{parsed.year:04d} {parsed.hour:02d}:{parsed.minute:02d}:{parsed.second:02d}")
        if expected != value[:-4]:
            return None
        return {"published_at": None, "published_date": parsed.date().isoformat(),
                "publication_precision": "day"}
    except (ValueError, TypeError, OverflowError):
        return None


def priority(item):
    """Prefer implemented financial rules and supervision over other notices."""
    title = item.get("title", "") if isinstance(item, dict) else ""
    if not eligible_title(title):
        return 99
    return 0 if re.search(r"制度|法律|改正|行政処分|監督|要請|取組", title) else 1


def _article_url(value):
    if not isinstance(value, str) or len(value) > 2048 or "\\" in value:
        return None
    if any(ord(c) < 33 or ord(c) == 127 for c in value):
        return None
    try:
        parsed = urlsplit(value)
        if (parsed.scheme != "https" or parsed.hostname != _HOST
                or parsed.username is not None or parsed.password is not None
                or parsed.port not in (None, 443) or parsed.query or parsed.fragment
                or not article_path(parsed.path)):
            return None
        return parsed
    except (ValueError, UnicodeError):
        return None


def extract_fsa_article(document, item, original, final, now, since, observed_at):
    """Read one date/issuer/heading-verified HTML announcement, fail closed.

    The inspected template is div#main > div.inner. Its leading date and FSA
    attribution precede the sole h1; substantive HTML follows, ending at the
    contact box. The feed day, visible original date and dated URL must agree.
    A meta date, attachment date, effective date or acquisition clock cannot
    repair missing publication evidence.
    """
    # Import at call time so official_news_sources can invoke this adapter.
    import official_news_sources as sources
    from daily_news_sources import _Node

    origin, target = _article_url(original), _article_url(final)
    if (origin is None or target is None or original != final
            or not isinstance(item, dict) or item.get("source") != SOURCE
            or item.get("url") != original or not eligible_title(item.get("title"))
            or item.get("published_at") is not None
            or item.get("publication_precision") != "day"
            or not isinstance(item.get("published_date"), str)):
        return None
    try:
        feed_day = date.fromisoformat(item["published_date"])
    except ValueError:
        return None
    path_match = _PATH.fullmatch(target.path)
    if (path_match.group(2) != feed_day.strftime("%Y%m%d")
            or path_match.group(1) not in (None, feed_day.strftime("%Y%m%d"))):
        return None

    mains = [n for n in document.nodes if n.tag == "div" and n.attrs.get("id") == "main"]
    if len(mains) != 1 or not sources._visible_content(mains[0]):
        return None
    main = mains[0]
    inners = [n for n in main.children if not isinstance(n, str) and n.tag == "div"
              and "inner" in n.attrs.get("class", "").split()]
    if len(inners) != 1 or not sources._visible_content(inners[0]):
        return None
    inner = inners[0]
    children = [n for n in inner.children if not isinstance(n, str)]
    headings = [n for n in document.nodes if n.tag == "h1" and sources._descends(n, main)]
    if (len(headings) != 1 or len(children) < 4 or children[1] is not headings[0]
            or children[0].tag != "div"
            or not sources._visible_subtree(children[0])
            or not sources._visible_subtree(headings[0])):
        return None
    datelines = [n for n in children[0].children if not isinstance(n, str)]
    if len(datelines) != 2 or any(n.tag != "p" for n in datelines):
        return None
    day_match = re.fullmatch(sources._JAPANESE_DATE, _compact(sources._body_text(datelines[0])))
    html_day = sources._japanese_day(day_match) if day_match else None
    if html_day != feed_day or _compact(sources._body_text(datelines[1])) != SOURCE:
        return None

    title = item["title"]
    # The fixed RSS adds this delivery suffix to the exact release heading.
    if title.endswith("公表しました。"):
        title = title[:-len("公表しました。")]
    if _compact(sources._body_text(headings[0])) != _compact(title):
        return None
    contacts = [n for n in document.nodes if "contact_box" in n.attrs.get("class", "").split()
                and sources._descends(n, inner)]
    if len(contacts) != 1 or contacts[0].parent is not inner:
        return None
    boundary = children.index(contacts[0])
    if boundary <= 2 or boundary != len(children) - 1:
        return None
    included = children[2:boundary]
    if any(not sources._visible_subtree(n) for n in included):
        return None
    # PDF/link labels alone are not announcement text.
    narrative = [n for n in included if n.tag in ("p", "table")]
    if len("\n".join(sources._body_text(n) for n in narrative)) < sources.MIN_BODY_CHARS:
        return None
    body_node = _Node("div")
    body_node.children = [headings[0], *included]
    body = sources._body_text(body_node)
    # Contradictory explicit publication metadata blocks this record; matching
    # optional metadata never promotes the visibly date-only release to time.
    for metadata in sources._html_dates(document, body):
        if metadata is None or metadata["published_date"] != html_day.isoformat():
            return None
    publication = sources._publication(html_day.isoformat())
    normalized = {**item, "title": sources._body_text(headings[0])}
    record = sources._record(normalized, original, final, body, publication, observed_at, now, since)
    if record is not None:
        record.update(source_scope="official_fsa_release_html",
                      publication_evidence="visible_dateline_issuer_heading_url_and_rss_day",
                      attachments_verified=False)
    return record
