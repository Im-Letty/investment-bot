"""Private evidence for the inspected short MOF dialogue announcement template.

This is a narrow source exception, not a shorter generic article minimum or an
editorial approval. Only the trusted HTML collector attaches its provenance.
"""
from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
import json
import math
import re
import unicodedata
from urllib.parse import urlsplit

SCOPE = 'mof_verified_short_dialogue_html_v1'
SHORT_EVIDENCE = 'short_html_evidence'
MIN_SHORT_CHARACTERS = 80
MAX_SHORT_CHARACTERS = 99
JST = timezone(timedelta(hours=9))
# Individually inspected parent/attachment pairs, not a general PDF crawler.
# The parent supplies publication metadata; the PDF's signing date is separate.
# Shared with the collector so every short-source boundary excludes these parents.
MOF_SUPPORTING_PDFS = {
    "/policy/international_policy/convention/dialogue/20260925182123.html": {
        "path": "/policy/international_policy/convention/dialogue/JointStrategicFinancingMemorandumofCooperation.pdf",
        "title": "Japan-Australia Joint Strategic Financing Memorandum of Cooperation",
        "document_date": "2026-10-02",
        "signature": "Signed in duplicate at the Australian Embassy, Tokyo on 2 October 2026.",
        "allow_empty_password_pdf": True,
    },
    "/policy/international_policy/convention/dialogue/20260925182036.html": {
        "path": "/policy/international_policy/convention/dialogue/JP_MoU.pdf",
        "title": "日本財務省と豪州財務省が代表する豪州政府との間の日豪財務大臣対話に関する協力覚書",
        "document_date": "2026-10-05",
        "signature": "本覚書は、2026年10月5日に東京において、英語により2通作成された。",
        "allow_empty_password_pdf": True,
    },
}
_PATH = re.compile(r'/policy/international_policy/convention/dialogue/\d{14}\.html')
_DAY = re.compile(r'(?:(\d{4})年|令和(元|\d+)年)(\d{1,2})月(\d{1,2})日')
_CONTACT = re.compile(r'問い合わせ|問合せ|連絡先|電話|TEL|tel:|https?://')
_EXCLUDED = re.compile(r'入札|採用|募集|調達|公募|発行予定|公表予定|発表予定|開催予定|予定一覧|スケジュール|カレンダー')
_STATEMENT = re.compile(
    r'(?:財務大臣|財務副大臣|財務官)[^。！？!?]{2,80}(?:と|について)'
    r'[^。！？!?]{0,60}(?:意見交換|会談)(?:を)?(?:行いました|行った|しました|した)(?:。|$)')


def _compact(value):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', value))


def content_proof_sha256(proof):
    """Hash the eight fixed verified-content fields, never the raw HTML.

    Canonical UTF-8 JSON has sorted keys, compact separators and no ASCII
    escaping. Page decorations must not create a content revision; body/title,
    canonical URL and original publication metadata remain bound to the proof.
    """
    fields = ('version', 'title_sha256', 'body_sha256', 'published_date',
              'published_at', 'publication_precision', 'canonical_url', 'narrative_characters')
    value = {key: proof[key] for key in fields}
    return sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                            separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def short_body_details(body, title, published_date):
    """Require a substantive completed statement, beyond a title/dateline."""
    if (type(body) is not str or not MIN_SHORT_CHARACTERS <= len(body) <= MAX_SHORT_CHARACTERS
            or type(title) is not str or not title.strip() or len(title) > 1000
            or _EXCLUDED.search(title) or _CONTACT.search(body)):
        return None
    text = _compact(body)
    days = []
    for match in _DAY.finditer(text):
        year, era, month, day = match.groups()
        try:
            year = int(year) if year else 2018 + (1 if era == '元' else int(era))
            days.append(date(year, int(month), int(day)).isoformat())
        except ValueError:
            return None
    if not days or set(days) != {published_date}:
        return None
    narrative = _DAY.sub('', text.replace(_compact(title), ''))
    if len(narrative) < 60 or _STATEMENT.search(narrative) is None:
        return None
    return {'narrative_characters': len(narrative)}


def valid_short_mof_record(value):
    """Recheck source/proof binding at cache and generation boundaries.

    A model-selected scope alone grants no exception. The writer output schemas
    cannot supply this source provenance; the original HTML collector owns it.
    """
    if (type(value) is not dict or value.get('source') != '財務省' or value.get('source_scope') != SCOPE
            or 'published_at' not in value):
        return False
    url, body, title = value.get('url'), value.get('body'), value.get('title')
    if type(url) is not str or value.get('evidence_url') != url:
        return False
    try:
        parsed = urlsplit(url)
        if (parsed.scheme != 'https' or parsed.netloc != 'www.mof.go.jp'
                or parsed.query or parsed.fragment or _PATH.fullmatch(parsed.path) is None
                or parsed.path in MOF_SUPPORTING_PDFS):
            return False
        # Validate the CMS identity's syntax, never use it as the release date.
        datetime.strptime(parsed.path.rsplit('/', 1)[1][:-5], '%Y%m%d%H%M%S')
        day = date.fromisoformat(value.get('published_date'))
        if day.isoformat() != value['published_date']:
            return False
        stamp, precision = value.get('published_at'), value.get('publication_precision')
        if precision == 'day':
            if stamp is not None:
                return False
        elif (precision != 'second' or type(stamp) not in (int, float) or not math.isfinite(stamp)
                or stamp <= 0 or datetime.fromtimestamp(stamp, JST).date() != day):
            return False
    except (ValueError, TypeError, OverflowError, OSError):
        return False
    details = short_body_details(body, title, day.isoformat())
    if details is None or value.get('body_sha256') != sha256(body.encode()).hexdigest():
        return False
    proof = value.get(SHORT_EVIDENCE)
    keys = {'version', 'verified_content_sha256', 'title_sha256', 'body_sha256', 'published_date',
            'published_at', 'publication_precision', 'canonical_url', 'narrative_characters'}
    if (type(proof) is not dict or set(proof) != keys or type(proof.get('version')) is not int
            or proof['version'] != 1
            or proof.get('title_sha256') != sha256(title.encode()).hexdigest()
            or proof.get('body_sha256') != value['body_sha256']
            or proof.get('published_date') != value['published_date']
            or type(proof.get('published_at')) is not type(stamp) or proof.get('published_at') != stamp
            or proof.get('publication_precision') != precision or proof.get('canonical_url') != url
            or type(proof.get('narrative_characters')) is not int
            or proof['narrative_characters'] != details['narrative_characters']
            or proof.get('verified_content_sha256') != content_proof_sha256(proof)):
        return False
    return True
