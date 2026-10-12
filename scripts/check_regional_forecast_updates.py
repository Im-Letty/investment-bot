"""Check known public issuer disclosure pages; never update dividend facts.

Default CLI mode is offline. Explicit --fetch uses bounded, serial ordinary
GETs and writes only a work checkpoint and a PDF-review queue. A new title or
publisher date is NOT a verified dividend number or issuer-document proof.
Run the existing reviewed forecast compiler only after reading the document
and verifying issuer/code, announcement date, fiscal period, unit and splits.
The file lock/backoff are local to the shared work directory, not a promise of
cross-machine coordination or of the latest disclosure being available.
"""

import argparse
from contextlib import contextmanager
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import fcntl
from hashlib import sha256
from html import unescape
from html.parser import HTMLParser
import json
import ipaddress
import math
import os
from pathlib import Path
import re
import sys
import time
import unicodedata
from urllib.parse import parse_qsl, urljoin, urlsplit

import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from company_business import normalize_name
DEFAULT_MANIFEST = ROOT / 'static/regional-forecast-refresh-manifest.json'
DEFAULT_WORK = ROOT / 'work/regional-forecast-refresh'
JST = timezone(timedelta(hours=9))
MAX_REQUESTS = 180
MAX_SECONDS = 900
MAX_RESPONSE_BYTES = 3_000_000
MAX_TOTAL_BYTES = 20_000_000
MIN_INTERVAL = 1.5
MIN_CHECK_SECONDS = 1800
MAX_JSON_BYTES = 20_000_000
KINDS = ('nse_json', 'sse_html', 'fse_html', 'issuer_html', 'issuer_xj_json')
# company is an audited public widget selector, not an authentication token.
SAFE_QUERY_KEYS = {'stockCode', 'copid', 'category', 'year', 'c', 'i', 'id', 'company', 'len', 'output'}


class CheckError(Exception):
    """Fixed diagnostic code only; don't emit upstream bodies or raw errors."""


def fingerprint(value):
    return sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                             separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def normalized_name(value):
    # Use the same strict key as the existing facts identity validator. Dots,
    # middle dots, hyphens and non-corporate parentheses stay meaningful.
    return normalize_name(value) or ''


def page_name_key(value):
    """Long page text uses the same narrow transformations, no symbol deletion."""
    value = unicodedata.normalize('NFKC', value).replace('株式会社', '')
    return re.sub(r'\s+', '', value)


def plain(value):
    return re.sub(r'\s+', ' ', unescape(re.sub(r'<[^>]*>', ' ', value))).strip()


def public_url(value, hosts=None):
    if not isinstance(value, str) or len(value) > 1800:
        return False
    try:
        parsed = urlsplit(value)
        if (parsed.scheme not in ('http', 'https') or not parsed.hostname
                or parsed.username or parsed.password or parsed.fragment
                or parsed.port not in (None, 80, 443)):
            return False
        host = parsed.hostname.lower()
        if host == 'localhost' or host.endswith(('.localhost', '.local')) or '.' not in host:
            return False
        try:
            if not ipaddress.ip_address(host).is_global:
                return False
        except ValueError:
            pass
    except ValueError:
        return False
    if hosts is not None and parsed.hostname.lower() not in hosts:
        return False
    if re.search(r'/(?:auth|login|signin|sign-in|signup)(?:/|$)', parsed.path, re.I):
        return False
    for key, item in parse_qsl(parsed.query, keep_blank_values=True):
        if key not in SAFE_QUERY_KEYS or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', item):
            return False
    return True


def read_json(path, default=None):
    path = Path(path)
    if not path.exists():
        if default is None:
            raise CheckError('missing_json')
        return deepcopy(default)
    try:
        if path.stat().st_size > MAX_JSON_BYTES:
            raise CheckError('json_size_limit')
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, UnicodeError, ValueError) as error:
        raise CheckError('invalid_json') from error


def atomic_json(path, value):
    path = Path(path)
    encoded = (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode()
    if len(encoded) > MAX_JSON_BYTES:
        raise CheckError('checkpoint_size_limit')
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    try:
        with temporary.open('wb') as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(path)
    finally:
        if temporary.exists():
            temporary.unlink()


@contextmanager
def file_lock(work):
    work = Path(work)
    work.mkdir(parents=True, exist_ok=True)
    with (work / 'refresh.lock').open('a') as handle:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise CheckError('already_running') from error
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def date_value(value):
    """Only an actual date carried by publisher metadata, never today's date."""
    value = str(value or '')
    match = re.search(r'\b(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日|\b)', value)
    if not match:
        return None
    try:
        return date(*map(int, match.groups())).isoformat()
    except ValueError:
        return None


def categories(title):
    kinds = []
    for kind, pattern in (
        ('financial_results', r'決算短信'),
        ('dividend', r'配当'),
        ('split_or_consolidation', r'株式(?:分割|併合)'),
        ('correction', r'訂正|修正'),
        ('earnings_forecast', r'業績予想')):
        if re.search(pattern, title):
            kinds.append(kind)
    return kinds


def metadata_document(url, title, publisher_date, source, kind=None):
    title = plain(title)[:600]
    found = categories(title)
    if not found or not public_url(url, set(source['document_hosts'])):
        return None
    if not urlsplit(url).path.lower().endswith('.pdf') and not re.search(r'td_download\.cgi$', urlsplit(url).path):
        return None
    # Retain unknown publication dates as unknown; PDF review must resolve them.
    publisher_date = date_value(publisher_date)
    row = dict(url=url, title=title, publisher_date=publisher_date,
               categories=found, publisher_kind=kind or source['kind'])
    row['document_id'] = fingerprint(row)
    return row


class Page(HTMLParser):
    """Visible text and links; deliberately never execute/load page scripts."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.text, self.links, self.current = [], [], None
        self.ignore = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ('script', 'style'):
            self.ignore += 1
        if not self.ignore and tag == 'a':
            self.current = dict(href=attrs.get('href', ''), text=[])
        if not self.ignore and tag == 'img' and attrs.get('alt'):
            self.text.append(attrs['alt'])

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.ignore = max(0, self.ignore - 1)
        if tag == 'a' and self.current:
            self.links.append(dict(href=self.current['href'], title=' '.join(self.current['text'])))
            self.current = None

    def handle_data(self, data):
        if not self.ignore and data.strip():
            self.text.append(data.strip())
            if self.current:
                self.current['text'].append(data.strip())


def page_name_matches(value, company):
    value = normalized_name(value)
    return any(normalized_name(alias) and normalized_name(alias) == value
               for alias in [company['name'], *company.get('aliases', [])])


def parse_source(source, company, body):
    """Fail closed on wrong company; return metadata only, no numeric facts."""
    kind, docs, source_gaps = source['kind'], [], []
    identity = {}
    if kind == 'issuer_xj_json':
        if dict(parse_qsl(urlsplit(source['url']).query)).get('company') != source['expected_public_company_selector']:
            raise CheckError('source_company_identity_mismatch')
        try:
            value = json.loads(body)
        except (ValueError, TypeError) as error:
            raise CheckError('invalid_source_json') from error
        rows = value.get('items') if isinstance(value, dict) else None
        if not isinstance(rows, list) or len(rows) > 500:
            raise CheckError('source_document_list_missing')
        identity = dict(code=company['code'], name=company['name'],
                        method='audited_issuer_IR_page_and_embedded_public_widget_selector',
                        issuer_link_evidence=source['identity_evidence_url'],
                        issuer_binding_page_url=source['issuer_binding_page_url'])
        for row in rows:
            if not isinstance(row, dict):
                continue
            for file in row.get('files', []) if isinstance(row.get('files'), list) else []:
                if not isinstance(file, dict):
                    continue
                url = file.get('url', '')
                if (public_url(url) and urlsplit(url).hostname == 'contents.xj-storage.jp'
                        and not urlsplit(url).path.startswith('/xcontents/' + source['expected_public_company_selector'] + '/')):
                    raise CheckError('source_company_identity_mismatch')
                doc = metadata_document(url, row.get('title', ''), row.get('publishDate'), source)
                if doc:
                    docs.append(doc)
    elif kind == 'nse_json':
        expected = company['code'] + '0'
        if (source.get('expected_stock_code') != expected
                or dict(parse_qsl(urlsplit(source['url']).query)).get('stockCode') != expected):
            raise CheckError('source_company_identity_mismatch')
        try:
            value = json.loads(body)
        except (ValueError, TypeError) as error:
            raise CheckError('invalid_source_json') from error
        stock = value.get('stock', {}) if isinstance(value, dict) else {}
        # The live publisher uses a singleton list; the audited manifest input
        # contains its selected dictionary. Never choose one of multiple issuers.
        if isinstance(stock, list):
            stock = stock[0] if len(stock) == 1 else {}
        if (not isinstance(stock, dict) or str(stock.get('stockCode')) != source['expected_stock_code']
                or not page_name_matches(stock.get('stockName_j'), company)):
            raise CheckError('source_company_identity_mismatch')
        identity = dict(code=company['code'], name=stock['stockName_j'],
                        method='publisher_json_exact_code_and_name')
        # No stock price, share count, market cap or other stock fields retained.
        for section in ('kessan', 'timely'):
            rows = value.get(section)
            if not isinstance(rows, list):
                raise CheckError('source_document_list_missing')
            if len(rows) > 500:
                raise CheckError('source_document_count_limit')
            for row in rows:
                if not isinstance(row, dict):
                    continue
                filename = row.get('filename', '')
                if not isinstance(filename, str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,160}\.pdf', filename):
                    continue
                doc = metadata_document(urljoin(source['document_base_url'], filename),
                                        row.get('title', ''), row.get('date'), source, section)
                if doc:
                    docs.append(doc)
    else:
        if not isinstance(body, str):
            raise CheckError('invalid_source_html')
        page = Page()
        page.feed(body)
        if kind == 'sse_html':
            if urlsplit(source['url']).path != '/listing/company' + company['code']:
                raise CheckError('source_company_identity_mismatch')
            profile = re.search(r'<section\b[^>]*id=["\']companyprofile["\'][^>]*>(.*?)</section>', body, re.S | re.I)
            heading = re.search(r'<section\b[^>]*id=["\']pgtitle["\'][^>]*>.*?<h2\b[^>]*>(.*?)</h2>', body, re.S | re.I)
            code = re.search(r'<span\b[^>]*>\s*([0-9]{3}[0-9A-Z])\s*</span>', profile.group(1)) if profile else None
            name = plain(heading.group(1)) if heading else ''
            if not code or code.group(1) != company['code'] or not page_name_matches(name, company):
                raise CheckError('source_company_identity_mismatch')
            identity = dict(code=code.group(1), name=name, method='publisher_html_company_heading_and_profile_code')
            for section in ('disclosure', 'settlement', 'publicnews'):
                part = re.search(r'<section\b[^>]*id=["\']' + section + r'["\'][^>]*>(.*?)</section>', body, re.S | re.I)
                if not part:
                    continue
                for when, href, title in re.findall(r'<dt\b[^>]*>(.*?)</dt>\s*<dd\b[^>]*>\s*<a\b[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', part.group(1), re.S | re.I):
                    doc = metadata_document(urljoin(source['url'], unescape(href)), title, plain(when), source, section)
                    if doc:
                        docs.append(doc)
            if not re.search(r'id=["\'](?:settlement|disclosure|publicnews)["\']', body):
                if source.get('profile_only') is True:
                    source_gaps.append('audited_publisher_profile_has_no_disclosure_list')
                else:
                    raise CheckError('source_document_list_missing')
        elif kind == 'fse_html':
            heading = re.search(r'<h2\b[^>]*class=["\'][^"\']*under__title[^"\']*["\'][^>]*>(.*?)</h2>', body, re.S | re.I)
            # The first issuer table explicitly starts with code, not the menu.
            table = re.search(r'<table\b[^>]*>\s*<thead>.*?<th\b[^>]*>\s*コード\s*</th>.*?</thead>\s*<tbody>\s*<tr>\s*<td\b[^>]*>\s*([0-9]{3}[0-9A-Z])\s*</td>', body, re.S | re.I)
            name = plain(heading.group(1)) if heading else ''
            if not table or table.group(1) != company['code'] or not page_name_matches(name, company):
                raise CheckError('source_company_identity_mismatch')
            identity = dict(code=table.group(1), name=name, method='publisher_html_company_heading_and_code_table')
            for row in re.findall(r'<tr\b[^>]*>(.*?)</tr>', body, re.S | re.I):
                hrefs = re.findall(r'href=["\']([^"\']+\.pdf(?:\?[^"\']*)?)["\']', row, re.I)
                when = date_value(plain(row))
                if not when:
                    continue
                for href in hrefs:
                    # PDF filename/size are not part of the announcement title.
                    title = re.sub(r'\s+[^\s]+\.pdf\s*\([^)]*\)', '', plain(row))
                    title = re.sub(r'^20\d{2}\.\d{2}\.\d{2}\s*', '', title)
                    doc = metadata_document(urljoin(source['url'], unescape(href)), title, when, source)
                    if doc:
                        docs.append(doc)
            if 'lis_tkj' not in body and '適時開示' not in body:
                raise CheckError('source_document_list_missing')
        elif kind == 'issuer_html':
            text = page_name_key(' '.join(page.text))
            # The trusted host comes from an already reviewed official issuer
            # link; the fresh visible page must still carry its company name.
            if not any(normalized_name(alias) in text for alias in source['identity_names'] if normalized_name(alias)):
                raise CheckError('source_company_identity_mismatch')
            identity = dict(code=company['code'], name=company['name'],
                            method='audited_publisher_issuer_link_and_fresh_page_name',
                            issuer_link_evidence=source['identity_evidence_url'])
            selector = source.get('required_public_widget_selector')
            if selector:
                if not re.search(r'(?:https?:)?//www\.xj-storage\.jp/resources/' + re.escape(selector) + r'/XjStorageLoaderIRNews\.js(?:\?[^"\']*)?["\']', body):
                    raise CheckError('source_widget_binding_mismatch')
                identity['embedded_public_widget_selector'] = selector
            # Dates are taken from the smallest document-list container. A page
            # footer, copyright year or today's fetch date is never substituted.
            blocks = re.findall(r'<(?:li|tr|article|dl)\b[^>]*>(.*?)</(?:li|tr|article|dl)>', body, re.S | re.I)
            dated_links = {}
            for block in sorted(blocks, key=len):
                for href in re.findall(r'href=["\']([^"\']+)["\']', block):
                    url = urljoin(source['url'], unescape(href))
                    dated_links.setdefault(url, date_value(plain(block)))
            for link in page.links:
                url = urljoin(source['url'], link['href'])
                doc = metadata_document(url, link['title'], date_value(link['title']) or dated_links.get(url), source)
                if doc:
                    docs.append(doc)
        else:
            raise CheckError('unsupported_source_kind')
    unique = {row['document_id']: row for row in docs}
    if len(unique) > 500:
        raise CheckError('source_document_count_limit')
    gaps = source_gaps
    if not unique:
        gaps.append('no_relevant_pdf_metadata_in_static_response')
    if any(row['publisher_date'] is None for row in unique.values()):
        gaps.append('publication_date_requires_pdf_or_source_review')
    return dict(identity=identity, documents=list(unique.values()), gaps=gaps)


def validate_manifest(value):
    if not isinstance(value, dict) or value.get('schema_version') != 1 or value.get('latest_revision_guaranteed') is not False:
        raise CheckError('invalid_manifest')
    rows = value.get('companies')
    if not isinstance(rows, list) or len(rows) != 110:
        raise CheckError('manifest_requires_110_companies')
    symbols, ids = set(), set()
    for company in rows:
        if (not isinstance(company, dict) or not re.fullmatch(r'[0-9]{3}[0-9A-Z]\.JP', company.get('symbol', ''))
                or company.get('code') != company['symbol'].split('.')[0] or not company.get('name')):
            raise CheckError('invalid_manifest_company')
        if company['symbol'] in symbols:
            raise CheckError('duplicate_manifest_company')
        symbols.add(company['symbol'])
        sources = company.get('sources')
        if not isinstance(sources, list) or len(sources) > 10:
            raise CheckError('invalid_manifest_sources')
        for source in sources:
            if (not isinstance(source, dict) or source.get('kind') not in KINDS
                    or source.get('id') in ids or not isinstance(source.get('id'), str)
                    or not public_url(source.get('url')) or source.get('verified_on') is None
                    or not source.get('document_hosts')):
                raise CheckError('invalid_manifest_source')
            ids.add(source['id'])
            host = urlsplit(source['url']).hostname
            if source['kind'] == 'nse_json' and host != 'www.nse.or.jp':
                raise CheckError('invalid_publisher_host')
            if source['kind'] == 'sse_html' and host != 'www.sse.or.jp':
                raise CheckError('invalid_publisher_host')
            if source['kind'] == 'fse_html' and host != 'www.fse.or.jp':
                raise CheckError('invalid_publisher_host')
            if source['kind'] == 'nse_json' and not (source.get('expected_stock_code') and public_url(source.get('document_base_url'))):
                raise CheckError('invalid_nse_source')
            if source['kind'].startswith('issuer_') and not public_url(source.get('identity_evidence_url')):
                raise CheckError('invalid_issuer_source')
            if source['kind'] == 'issuer_html' and not source.get('identity_names'):
                raise CheckError('invalid_issuer_source')
            if source['kind'].startswith('issuer_') and not any(
                    not str(s.get('kind')).startswith('issuer_') and s.get('url') == source['identity_evidence_url']
                    for s in sources if isinstance(s, dict)):
                raise CheckError('invalid_issuer_publisher_binding')
            if source['kind'] == 'issuer_xj_json' and not (
                    host == 'www.xj-storage.jp' and re.fullmatch(r'AS[0-9]{5}', source.get('expected_public_company_selector', ''))
                    and source.get('dependency_source_id') in {s.get('id') for s in sources if s.get('kind') == 'issuer_html'}
                    and public_url(source.get('issuer_binding_page_url')) and public_url(source.get('issuer_script_url'))):
                raise CheckError('invalid_public_widget_binding')
            if source['kind'] == 'issuer_xj_json':
                query = dict(parse_qsl(urlsplit(source['url']).query))
                if urlsplit(source['url']).path != '/public-list/GetList2.aspx' or query.get('len') != '100' or query.get('output') != 'json':
                    raise CheckError('invalid_public_widget_binding')
            baselines = source.get('baseline_document_fingerprints', [])
            if not isinstance(baselines, list) or len(baselines) > 500 or any(not re.fullmatch(r'[0-9a-f]{64}', b) for b in baselines):
                raise CheckError('invalid_manifest_baseline')
    return value


def retry_after_seconds(value, now):
    if not isinstance(value, str) or len(value) > 128:
        return None
    try:
        if re.fullmatch(r'\s*\d{1,10}\s*', value):
            return int(value.strip())
        parsed = parsedate_to_datetime(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return max(0, math.ceil(parsed.timestamp() - now))
    except (TypeError, ValueError, OverflowError):
        return None


def validate_state(value):
    if (not isinstance(value, dict) or value.get('schema_version') != 1
            or not isinstance(value.get('sources'), dict) or not isinstance(value.get('hosts'), dict)
            or not isinstance(value.get('review_queue'), dict)
            or isinstance(value.get('cursor'), bool)
            or not isinstance(value.get('cursor'), int) or value['cursor'] < 0):
        raise CheckError('invalid_checkpoint')
    for record in value['sources'].values():
        if not isinstance(record, dict) or not isinstance(record.get('documents', {}), dict):
            raise CheckError('invalid_checkpoint')
        for field in ('next_check_at', 'last_successful_check_at', 'last_attempt_at'):
            number = record.get(field, 0)
            if isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number) or number < 0:
                raise CheckError('invalid_checkpoint')
    for record in value['hosts'].values():
        if not isinstance(record, dict):
            raise CheckError('invalid_checkpoint')
        number = record.get('next_allowed_at', 0)
        if isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number) or number < 0:
            raise CheckError('invalid_checkpoint')
        failures = record.get('failures', 0)
        if isinstance(failures, bool) or not isinstance(failures, int) or not 0 <= failures <= 10:
            raise CheckError('invalid_checkpoint')
    if any(not isinstance(record, dict) for record in value['review_queue'].values()):
        raise CheckError('invalid_checkpoint')
    number = value.get('last_request_started_at', 0)
    if isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number) or number < 0:
        raise CheckError('invalid_checkpoint')
    number = value.get('total_requests_recorded', 0)
    if isinstance(number, bool) or not isinstance(number, int) or number < 0:
        raise CheckError('invalid_checkpoint')
    selections = value.get('selection_cursors', {})
    if not isinstance(selections, dict) or any(
            not isinstance(key, str) or not re.fullmatch(r'[0-9a-f]{64}', key)
            or isinstance(cursor, bool) or not isinstance(cursor, int) or cursor < 0
            for key, cursor in selections.items()):
        raise CheckError('invalid_checkpoint')
    return value


class Checker:
    def __init__(self, manifest, work, *, session=None, wall=time.time,
                 monotonic=time.monotonic, sleep=time.sleep, max_requests=MAX_REQUESTS,
                 max_seconds=MAX_SECONDS, max_response_bytes=MAX_RESPONSE_BYTES,
                 max_total_bytes=MAX_TOTAL_BYTES, min_check_seconds=21600, source_ids=None):
        self.manifest = validate_manifest(manifest)
        limits = ((max_requests, 1, MAX_REQUESTS), (max_seconds, 1, MAX_SECONDS),
                  (max_response_bytes, 1, MAX_RESPONSE_BYTES), (max_total_bytes, 1, MAX_TOTAL_BYTES),
                  (min_check_seconds, MIN_CHECK_SECONDS, 7 * 86400))
        if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not low <= v <= high for v, low, high in limits):
            raise CheckError('invalid_budget')
        self.work, self.wall, self.monotonic, self.sleep = Path(work), wall, monotonic, sleep
        self.session = session
        self.max_requests, self.max_seconds = int(max_requests), max_seconds
        self.max_response_bytes, self.max_total_bytes = int(max_response_bytes), int(max_total_bytes)
        self.min_check_seconds = min_check_seconds
        self.requests, self.bytes, self.last_request = 0, 0, None
        self.before_request = None
        self.source_ids = set(source_ids) if source_ids is not None else None
        known_ids = {s['id'] for c in manifest['companies'] for s in c['sources']}
        if self.source_ids is not None and (not self.source_ids or not self.source_ids <= known_ids):
            raise CheckError('unknown_manifest_source_id')
        self.started = self.monotonic()

    def audit(self):
        return dict(mode='offline', company_count=len(self.manifest['companies']),
                    source_count=sum(len(c['sources']) for c in self.manifest['companies']),
                    companies_without_publisher=[c['symbol'] for c in self.manifest['companies'] if not any(not s['kind'].startswith('issuer_') for s in c['sources'])],
                    latest_revision_guaranteed=False, forecast_facts_modified=False,
                    manifest_gaps=self.manifest.get('gaps', []))

    def _budget(self, wait=0):
        if (self.requests >= self.max_requests or self.bytes >= self.max_total_bytes
                or self.monotonic() - self.started + wait >= self.max_seconds):
            raise CheckError('budget_exhausted')

    def _get(self, source):
        wait = max(0, MIN_INTERVAL - (self.monotonic() - self.last_request)) if self.last_request is not None else 0
        self._budget(wait)
        if wait:
            self.sleep(wait)
        self._budget()
        remaining = self.max_seconds - (self.monotonic() - self.started)
        self.requests += 1
        self.last_request = self.monotonic()
        if self.before_request:
            self.before_request(self.wall())
        response = self.session.get(source['url'], stream=True, allow_redirects=False,
                                    timeout=(min(5, remaining / 3), min(20, remaining * 2 / 3)),
                                    headers={'User-Agent': 'InvestmentSite-PublicDisclosureCheck/1.0',
                                             'Accept': 'application/json,text/html;q=0.9'})
        try:
            status = response.status_code
            retry = retry_after_seconds(response.headers.get('Retry-After'), self.wall())
            if status != 200:
                return dict(status=status, retry_after_seconds=retry, body=None)
            length = response.headers.get('Content-Length')
            if isinstance(length, str) and length.isdigit() and int(length) > self.max_response_bytes:
                raise CheckError('response_size_limit')
            data = bytearray()
            for chunk in response.iter_content(64 * 1024):
                self.bytes += len(chunk)
                if len(data) + len(chunk) > self.max_response_bytes or self.bytes > self.max_total_bytes:
                    raise CheckError('response_size_limit')
                if self.monotonic() - self.started >= self.max_seconds:
                    raise CheckError('budget_exhausted')
                data.extend(chunk)
            try:
                body = bytes(data).decode('utf-8-sig')
            except UnicodeDecodeError:
                body = bytes(data).decode('cp932')
            return dict(status=status, retry_after_seconds=retry, body=body,
                        body_sha256=sha256(data).hexdigest())
        finally:
            response.close()

    def _fresh_identity(self, state, company, source, selector=None):
        record = state['sources'].get(source['id'], {})
        identity = record.get('identity', {})
        age = self.wall() - record.get('last_successful_check_at', 0)
        return (record.get('last_attempt_status') == 'checked'
                and 0 <= age <= self.min_check_seconds and isinstance(identity, dict)
                and identity.get('code') == company['code']
                and page_name_matches(identity.get('name'), company)
                and (selector is None or identity.get('embedded_public_widget_selector') == selector))

    def _dependencies_ready(self, state, company, source, visited, events):
        """Read stale prerequisites before a resumed issuer/widget, within budget."""
        if not source['kind'].startswith('issuer_'):
            return None
        publisher = next(s for s in company['sources']
                         if not s['kind'].startswith('issuer_') and s['url'] == source['identity_evidence_url'])
        dependencies = [(publisher, None, 'deferred_publisher_identity_check')]
        if source['kind'] == 'issuer_xj_json':
            issuer = next(s for s in company['sources'] if s['id'] == source['dependency_source_id'])
            dependencies.append((issuer, source['expected_public_company_selector'], 'deferred_issuer_page_identity_check'))
        for dependency, selector, failure in dependencies:
            if self._fresh_identity(state, company, dependency, selector):
                continue
            if dependency['id'] not in visited:
                events.append(self._visit(state, company, dependency, visited, events, role='dependency'))
            if not self._fresh_identity(state, company, dependency, selector):
                return failure
        return None

    def _visit(self, state, company, source, visited, events, *, role='main'):
        """Visit a source once per run; dependency reads never move scan cursors."""
        event = dict(symbol=company['symbol'], source_id=source['id'], role=role, request_performed=False)
        if source['id'] in visited:
            event['status'] = ('deferred_recent_check' if self._fresh_identity(state, company, source)
                               else 'deferred_attempted_this_run')
            return event
        visited.add(source['id'])
        previous = deepcopy(state['sources'].get(source['id'], {}))
        host = urlsplit(source['url']).hostname.lower()
        host_state = state['hosts'].get(host, {})
        now = self.wall()
        if host_state.get('next_allowed_at', 0) > now:
            event['status'] = 'deferred_host_backoff'
            return event
        if previous.get('next_check_at', 0) > now:
            event['status'] = 'deferred_recent_check'
            return event
        failure = self._dependencies_ready(state, company, source, visited, events)
        if failure:
            event['status'] = failure
            return event
        requests_before = self.requests
        try:
            response = self._get(source)
            if response['status'] != 200:
                event.update(status='http_unavailable', http_status=response['status'])
                if response['status'] in (401, 403, 429) or response['status'] >= 500:
                    failures = min(10, host_state.get('failures', 0) + 1)
                    backoff = max(response['retry_after_seconds'] or 0,
                                  86400 if response['status'] in (401, 403) else min(86400, 60 * 2 ** (failures - 1)))
                    state['hosts'][host] = dict(failures=failures, next_allowed_at=self.wall() + backoff,
                                               reason='http_unavailable', http_status=response['status'])
                previous.update(last_attempt_at=now, last_attempt_status=event['status'], last_http_status=response['status'])
                # Do not follow redirects to login, new hosts or unaudited pages.
            else:
                parsed = parse_source(source, company, response['body'])
                baseline = set(source.get('baseline_document_fingerprints', []))
                baseline.update(d['document_id'] for d in source.get('known_documents', []))
                known = previous.get('documents', {})
                if not isinstance(known, dict):
                    raise CheckError('invalid_checkpoint')
                for doc in parsed['documents']:
                    identifier = doc['document_id']
                    if identifier not in baseline and identifier not in known:
                        queue_id = fingerprint([company['symbol'], identifier])
                        state['review_queue'].setdefault(queue_id, dict(
                            queue_id=queue_id, symbol=company['symbol'], code=company['code'],
                            issuer_name=company['name'], source_id=source['id'],
                            source_page=source['url'], metadata=doc,
                            first_discovered_at=now, source_identity=parsed['identity'],
                            issuer_document_identity_status='requires_pdf_body_review',
                            announcement_date=None, annual_forecast_value=None,
                            review_status='pending_document_identity_period_unit_date_split_review',
                            latest_revision_guaranteed=False, fact_eligible=False))
                    known[identifier] = doc
                checked = self.wall()
                previous.update(documents=known, current_document_ids=[d['document_id'] for d in parsed['documents']],
                                identity=parsed['identity'], gaps=parsed['gaps'],
                                body_sha256=response['body_sha256'], last_attempt_at=now,
                                last_successful_check_at=checked, next_check_at=checked + self.min_check_seconds,
                                last_attempt_status='checked', last_http_status=200)
                state['hosts'][host] = dict(failures=0, next_allowed_at=0)
                event.update(status='checked', document_count=len(parsed['documents']), gaps=parsed['gaps'])
        except CheckError as error:
            if str(error) == 'budget_exhausted':
                raise  # Caller preserves the main target, even during a prerequisite.
            event.update(status='check_failed', reason=str(error))
            previous.update(last_attempt_at=now, last_attempt_status='check_failed', last_error_code=str(error))
        except (requests.RequestException, UnicodeError, ValueError, TypeError):
            event.update(status='check_failed', reason='transport_or_decode_error')
            previous.update(last_attempt_at=now, last_attempt_status='check_failed', last_error_code='transport_or_decode_error')
            failures = min(10, host_state.get('failures', 0) + 1)
            state['hosts'][host] = dict(failures=failures, next_allowed_at=self.wall() + min(86400, 60 * 2 ** (failures - 1)),
                                       reason='transport_or_decode_error')
        state['sources'][source['id']] = previous
        event['request_performed'] = self.requests > requests_before
        return event

    def fetch(self):
        path = self.work / 'checkpoint.json'
        with file_lock(self.work):
            state = validate_state(read_json(path, dict(schema_version=1, sources={}, hosts={}, review_queue={}, cursor=0)))
            state['manifest_fingerprint'] = fingerprint(self.manifest)
            last_started = state.get('last_request_started_at')
            if isinstance(last_started, (int, float)) and math.isfinite(last_started):
                self.last_request = self.monotonic() - max(0, self.wall() - last_started)
            def reserve_request(started):
                state['last_request_started_at'] = started
                state['total_requests_recorded'] = state.get('total_requests_recorded', 0) + 1
                atomic_json(path, state)
            self.before_request = reserve_request
            # The main scan resumes fairly; stale dependencies are visited first
            # even when the cursor points into the issuer/widget phase.
            ordered = [(c, s) for kind in (False, True) for c in self.manifest['companies']
                       for s in c['sources'] if s['kind'].startswith('issuer_') == kind]
            events, stopped, visited = [], None, set()
            selection_key = fingerprint(sorted(self.source_ids)) if self.source_ids is not None else None
            if selection_key:
                state.setdefault('selection_cursors', {})
                cursor = state['selection_cursors'].get(selection_key, state['cursor'])
            else:
                cursor = state['cursor']
            start = cursor % len(ordered) if ordered else 0
            def save_cursor(index):
                if selection_key:
                    state['selection_cursors'][selection_key] = index
                else:
                    state['cursor'] = index
                atomic_json(path, state)
            created = self.session is None
            if created:
                self.session = requests.Session()
                self.session.trust_env = False  # no netrc credentials or account access
            try:
                for offset in range(len(ordered)):
                    index = (start + offset) % len(ordered)
                    company, source = ordered[index]
                    if self.source_ids is not None and source['id'] not in self.source_ids:
                        continue
                    # Persist the intended main target before any prerequisite GET.
                    # A dependency must not send a stopped scan back to a publisher.
                    save_cursor(index)
                    try:
                        event = self._visit(state, company, source, visited, events)
                    except CheckError as error:
                        if str(error) != 'budget_exhausted':
                            raise
                        stopped = 'budget_exhausted'
                        save_cursor(index)
                        break
                    events.append(event)
                    save_cursor((index + 1) % len(ordered))
                if stopped is None:
                    save_cursor(0)  # A complete cycle starts at publishers next time.
            finally:
                if created:
                    self.session.close()
            report = dict(schema_version=1, checked_at_jst=datetime.fromtimestamp(self.wall(), JST).isoformat(),
                          mode='fetch', company_count=110, requests=self.requests, response_bytes=self.bytes,
                          selected_source_ids=sorted(self.source_ids) if self.source_ids is not None else None,
                          elapsed_seconds=round(self.monotonic() - self.started, 3), stopped_reason=stopped,
                          next_cursor=state['cursor'], events=events, latest_revision_guaranteed=False,
                          next_selected_cursor=state['selection_cursors'][selection_key] if selection_key else None,
                          dependency_requests=sum(e['role'] == 'dependency' and e['request_performed'] for e in events),
                          forecast_facts_modified=False, manifest_gaps=self.manifest.get('gaps', []))
            queue = dict(schema_version=1, checked_at_jst=report['checked_at_jst'], latest_revision_guaranteed=False,
                         forecast_facts_modified=False, items=list(state['review_queue'].values()),
                         required_review=['issuer and securities code in PDF', 'actual announcement date',
                                          'company forecast versus result', 'fiscal period', 'ordinary yen per share',
                                          'annual versus interim/year end', 'later revision and share split basis'])
            atomic_json(self.work / 'review-queue.json', queue)
            atomic_json(self.work / 'last-run.json', report)
            return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument('--work-dir', type=Path, default=DEFAULT_WORK)
    parser.add_argument('--fetch', action='store_true', help='explicitly enable ordinary public GETs')
    parser.add_argument('--source-id', action='append', help='check this audited source plus required audited dependencies (repeatable)')
    parser.add_argument('--max-requests', type=int, default=MAX_REQUESTS)
    parser.add_argument('--max-seconds', type=float, default=MAX_SECONDS)
    parser.add_argument('--max-response-bytes', type=int, default=MAX_RESPONSE_BYTES)
    parser.add_argument('--max-total-bytes', type=int, default=MAX_TOTAL_BYTES)
    parser.add_argument('--min-check-seconds', type=float, default=21600)
    args = parser.parse_args(argv)
    try:
        checker = Checker(read_json(args.manifest), args.work_dir,
                          max_requests=args.max_requests, max_seconds=args.max_seconds,
                          max_response_bytes=args.max_response_bytes, max_total_bytes=args.max_total_bytes,
                          min_check_seconds=args.min_check_seconds, source_ids=args.source_id)
        result = checker.fetch() if args.fetch else checker.audit()
        if args.fetch:
            statuses = {}
            for row in result['events']:
                statuses[row['status']] = statuses.get(row['status'], 0) + 1
            result = {k: v for k, v in result.items() if k not in ('events', 'manifest_gaps')}
            result['source_statuses'] = statuses
        if 'manifest_gaps' in result:
            result['manifest_gap_count'] = len(result.pop('manifest_gaps'))
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
        return 0
    except (CheckError, OSError) as error:
        print(json.dumps(dict(status='blocked', reason=str(error) if isinstance(error, CheckError) else 'local_io_error',
                              previous_metadata_preserved=True, forecast_facts_modified=False), ensure_ascii=False))
        return 2


if __name__ == '__main__':
    sys.exit(main())
