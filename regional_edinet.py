"""Candidate EDINET supplement for *filed fiscal-period* dividend facts.

This module is not enabled by the application. It does not discover filings,
fetch quotes, calculate capitalization, copy descriptions or create credentials.
A caller must supply an official code list and an already known annual filing
descriptor. Without an owner-provided API key, even a Session is not created.

References: EDINET API v2 specification, sections 3-1, 3-2 and 4-1;
2026 taxonomy element list ESE140114.xlsx; instance guideline ESE140112.pdf.
"""
from dataclasses import dataclass
from datetime import date, datetime, timezone, timedelta
from decimal import Decimal, InvalidOperation
from email.utils import parsedate_to_datetime
from io import BytesIO, StringIO
import csv
import math
import os
import re
import threading
import time
import unicodedata
from xml.etree import ElementTree as ET
from zipfile import BadZipFile, ZipFile

import requests
from urllib3.exceptions import HTTPError as UpstreamReadError

CODE_LIST_URL = 'https://disclosure2dl.edinet-fsa.go.jp/searchdocument/codelist/Edinetcode.zip'
API_BASE = 'https://api.edinet-fsa.go.jp/api/v2/documents/'
TERMS_URL = 'https://disclosure2dl.edinet-fsa.go.jp/guide/static/disclosure/WZEK0030.html'
TAG = 'DividendPaidPerShareSummaryOfBusinessResults'
XBRLI = 'http://www.xbrl.org/2003/instance'
XBRLDI = 'http://xbrl.org/2006/xbrldi'
XSI = 'http://www.w3.org/2001/XMLSchema-instance'
JST = timezone(timedelta(hours=9))
MAX_CODE_LIST_BYTES = 4_000_000
MAX_ZIP_BYTES = 16_000_000
MAX_XML_BYTES = 8_000_000
MAX_UNCOMPRESSED_BYTES = 24_000_000
MAX_ZIP_ENTRIES = 256
MAX_XML_NODES = 100_000


def _name(value):
    if not isinstance(value, str) or not 0 < len(value) <= 250:
        return None
    value = unicodedata.normalize('NFKC', value)
    value = re.sub(r'\s+', '', value)
    value = value.replace('株式会社', '').replace('(株)', '')
    return value or None


def _date(value):
    try:
        return date.fromisoformat(value) if isinstance(value, str) else None
    except ValueError:
        return None


@dataclass(frozen=True)
class EdinetIdentity:
    code: str
    edinet_code: str
    name: str
    security_code: str
    corporate_number: str
    as_of: str


def parse_edinet_code_list(payload):
    """Read only the fixed official CSV identity fields; reject ambiguity."""
    if not isinstance(payload, bytes) or len(payload) > MAX_CODE_LIST_BYTES:
        raise ValueError('invalid_code_list')
    try:
        if payload.startswith(b'PK'):
            with ZipFile(BytesIO(payload)) as archive:
                if archive.namelist() != ['EdinetcodeDlInfo.csv']:
                    raise ValueError('invalid_code_list')
                info = archive.infolist()[0]
                if info.file_size > MAX_CODE_LIST_BYTES or info.flag_bits & 1:
                    raise ValueError('invalid_code_list')
                payload = archive.read(info)
        rows = csv.reader(StringIO(payload.decode('cp932')))
        meta, header = next(rows), next(rows)
        stamp = re.fullmatch(r'(\d{4})年(\d{1,2})月(\d{1,2})日現在', meta[1])
        if not stamp or meta[0] != 'ダウンロード実行日':
            raise ValueError('invalid_code_list')
        as_of = date(*map(int, stamp.groups())).isoformat()
        header = [unicodedata.normalize('NFKC', item) for item in header]
        required = ('EDINETコード', '提出者名', '証券コード', '提出者法人番号')
        if len(header) != len(set(header)) or not all(item in header for item in required):
            raise ValueError('invalid_code_list')
        identities, seen = [], set()
        for number, values in enumerate(rows):
            if number >= 30_000 or len(values) != len(header):
                raise ValueError('invalid_code_list')
            row = dict(zip(header, values))
            security = row['証券コード']
            if not re.fullmatch(r'[0-9][A-Z0-9]{3}0', security):
                continue
            edinet = row['EDINETコード']
            company = row['提出者名']
            corporate = row['提出者法人番号']
            if (not re.fullmatch(r'E[0-9]{5}', edinet) or not _name(company)
                    or corporate and not re.fullmatch(r'[0-9]{13}', corporate)
                    or security in seen):
                raise ValueError('invalid_code_list')
            seen.add(security)
            identities.append(EdinetIdentity(security[:4], edinet, company,
                                              security, corporate, as_of))
        return tuple(identities)
    except (BadZipFile, UnicodeError, StopIteration, IndexError, OSError,
            RuntimeError, csv.Error) as error:
        raise ValueError('invalid_code_list') from None


def match_identity(company, identities):
    """A regional symbol never becomes a Tokyo/Yahoo identifier."""
    if not isinstance(company, dict):
        return None
    code = company.get('code')
    if (not isinstance(code, str) or not re.fullmatch(r'[0-9][A-Z0-9]{3}', code)
            or company.get('symbol') != code + '.JP'
            or company.get('provider_symbol') is not None or not _name(company.get('name'))):
        return None
    found = [row for row in identities if isinstance(row, EdinetIdentity)
             and row.code == code and row.security_code == code + '0'
             and _name(row.name) == _name(company['name'])
             and re.fullmatch(r'E[0-9]{5}', row.edinet_code) and _date(row.as_of)]
    if len(found) != 1:
        return None
    row = found[0]
    if company.get('corporate_number') and company['corporate_number'] != row.corporate_number:
        return None
    return row


def _descriptor_valid(descriptor, identity, observed):
    today = observed.date()
    if not isinstance(descriptor, dict) or identity is None:
        return False
    if (not re.fullmatch(r'S[A-Z0-9]{7}', str(descriptor.get('docID', '')))
            or descriptor.get('edinetCode') != identity.edinet_code
            or descriptor.get('secCode') != identity.security_code
            or _name(descriptor.get('filerName')) != _name(identity.name)
            or descriptor.get('docTypeCode') != '120'
            or any(descriptor.get(field) != '0' for field in
                   ('withdrawalStatus', 'docInfoEditStatus', 'disclosureStatus'))
            or descriptor.get('xbrlFlag') != '1'):
        return False
    if descriptor.get('JCN') and descriptor['JCN'] != identity.corporate_number:
        return False
    start, end = (_date(descriptor.get(field)) for field in ('periodStart', 'periodEnd'))
    submitted = descriptor.get('submitDateTime')
    if not isinstance(submitted, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2} \d{2}:\d{2}', submitted):
        return False
    try:
        submitted_date = datetime.strptime(submitted, '%Y-%m-%d %H:%M').date()
    except ValueError:
        return False
    return bool(start and end and start <= end <= submitted_date <= today
                and datetime.strptime(submitted, '%Y-%m-%d %H:%M').replace(tzinfo=JST) <= observed
                and _date(identity.as_of) and _date(identity.as_of) <= today
                and 0 <= (end - start).days <= 550)


def _family(uri, family):
    return bool(re.fullmatch(r'https?://disclosure\.edinet-fsa\.go\.jp/taxonomy/'
                            + family + r'/\d{4}-\d{2}-\d{2}/' + family + '_cor', uri))


def _qname(value, namespaces):
    if not isinstance(value, str):
        return None, None
    parts = value.strip().split(':')
    if len(parts) == 2:
        return namespaces.get(parts[0]), parts[1]
    if len(parts) == 1:
        return namespaces.get(''), parts[0]
    return None, None


def _xml_tree(payload):
    if (not isinstance(payload, bytes) or len(payload) > MAX_XML_BYTES
            or b'\x00' in payload or b'<!DOCTYPE' in payload.upper() or b'<!ENTITY' in payload.upper()):
        return None, None
    # Candidate supports EDINET UTF-8 only. Never let a UTF-16/32 declaration
    # bypass the byte-level DTD/entity guard, or parse unknown encodings.
    try:
        text = payload.decode('utf-8-sig')
    except UnicodeError:
        return None, None
    declaration = re.match(r'\s*<\?xml\s+[^>]*\bencoding\s*=\s*[\'"]([^\'"]+)[\'"]', text)
    if declaration and declaration.group(1).upper().replace('-', '') != 'UTF8':
        return None, None
    namespaces, count = {}, 0
    try:
        parser = ET.iterparse(BytesIO(payload), events=('start-ns', 'end'))
        for event, item in parser:
            if event == 'start-ns':
                prefix, uri = item
                # Reject rebinding: QName-valued units/dimensions must be exact.
                if prefix in namespaces and namespaces[prefix] != uri:
                    return None, None
                namespaces[prefix] = uri
            else:
                count += 1
                if count > MAX_XML_NODES:
                    return None, None
        if parser.root.tag != '{' + XBRLI + '}xbrl':
            return None, None
        return parser.root, namespaces
    except (ET.ParseError, ValueError):
        return None, None


def parse_annual_dividend(payload, identity, descriptor, observed_at):
    """Extract one exact numeric fact; no text blocks or implied future dates."""
    try:
        observed = datetime.fromtimestamp(observed_at, JST)
    except (ValueError, TypeError, OverflowError, OSError):
        return None
    if not _descriptor_valid(descriptor, identity, observed):
        return None
    root, namespaces = _xml_tree(payload)
    if root is None:
        return None
    ids = [element.get('id') for element in root.iter() if element.get('id')]
    if len(ids) != len(set(ids)):
        return None
    dei = {}
    for child in root:
        uri, _, local = child.tag[1:].partition('}') if child.tag.startswith('{') else ('', '', '')
        if _family(uri, 'jpdei') and local in ('EDINETCodeDEI', 'SecurityCodeDEI', 'FilerNameInJapaneseDEI'):
            dei.setdefault(local, set()).add((child.text or '').strip())
    if (dei.get('EDINETCodeDEI') != {identity.edinet_code}
            or dei.get('SecurityCodeDEI') != {identity.security_code}
            or len(dei.get('FilerNameInJapaneseDEI', ())) != 1
            or _name(next(iter(dei['FilerNameInJapaneseDEI']))) != _name(identity.name)):
        return None
    contexts = set()
    for context in root.findall('{' + XBRLI + '}context'):
        identifier = context.find('{' + XBRLI + '}entity/{' + XBRLI + '}identifier')
        period = context.find('{' + XBRLI + '}period')
        if identifier is None or period is None or identifier.get('scheme') != 'http://disclosure.edinet-fsa.go.jp':
            continue
        if not re.fullmatch(re.escape(identity.edinet_code) + r'-[0-9]{3}', identifier.text or ''):
            continue
        if context.find('{' + XBRLI + '}entity/{' + XBRLI + '}segment') is not None:
            continue
        if (period.findtext('{' + XBRLI + '}startDate') != descriptor['periodStart']
                or period.findtext('{' + XBRLI + '}endDate') != descriptor['periodEnd']
                or len(period) != 2):
            continue
        scenario = context.find('{' + XBRLI + '}scenario')
        if scenario is not None:
            if len(scenario) != 1 or scenario[0].tag != '{' + XBRLDI + '}explicitMember':
                continue
            dimension_uri, dimension = _qname(scenario[0].get('dimension'), namespaces)
            member_uri, member = _qname(scenario[0].text, namespaces)
            if (not _family(dimension_uri or '', 'jppfs')
                    or dimension != 'ConsolidatedOrNonConsolidatedAxis'
                    or not _family(member_uri or '', 'jppfs') or member != 'NonConsolidatedMember'):
                continue
        if context.get('id'):
            contexts.add(context.get('id'))
    units = set()
    for unit in root.findall('{' + XBRLI + '}unit'):
        divide = unit.find('{' + XBRLI + '}divide')
        if divide is None or len(unit) != 1 or len(divide) != 2:
            continue
        numerator = divide.find('{' + XBRLI + '}unitNumerator')
        denominator = divide.find('{' + XBRLI + '}unitDenominator')
        if numerator is None or denominator is None or len(numerator) != 1 or len(denominator) != 1:
            continue
        if numerator[0].tag != '{' + XBRLI + '}measure' or denominator[0].tag != '{' + XBRLI + '}measure':
            continue
        if (_qname(numerator[0].text, namespaces) == ('http://www.xbrl.org/2003/iso4217', 'JPY')
                and _qname(denominator[0].text, namespaces) == (XBRLI, 'shares') and unit.get('id')):
            units.add(unit.get('id'))
    facts = []
    for child in root:
        uri, _, local = child.tag[1:].partition('}') if child.tag.startswith('{') else ('', '', '')
        if (not _family(uri, 'jpcrp') or local != TAG or child.get('contextRef') not in contexts
                or child.get('unitRef') not in units or child.get('{' + XSI + '}nil') in ('true', '1')
                or len(child) or not re.fullmatch(r'(?:INF|-?[0-9]{1,3})', child.get('decimals', ''))):
            continue
        raw = (child.text or '').strip()
        if not re.fullmatch(r'[+]?[0-9]{1,12}(?:\.[0-9]{1,8})?', raw):
            continue
        try:
            value = Decimal(raw)
        except InvalidOperation:
            continue
        if not value.is_finite() or value > Decimal('1000000000'):
            continue
        facts.append((value, child.get('contextRef'), child.get('unitRef')))
    if not facts or len({value for value, _, _ in facts}) != 1:
        return None
    value, context_id, unit_id = sorted(facts, key=lambda row: (row[1], row[2]))[0]
    return dict(value=float(value), currency='JPY', unit='JPY/share',
                fiscal_period=dict(start=descriptor['periodStart'], end=descriptor['periodEnd']),
                tag='jpcrp_cor:' + TAG, context_id=context_id, unit_id=unit_id,
                filing_submitted_at=descriptor['submitDateTime'], fetched_at=observed_at,
                doc_id=descriptor['docID'], edinet_code=identity.edinet_code,
                security_code=identity.security_code,
                source_url='https://disclosure2dl.edinet-fsa.go.jp/searchdocument/pdf/' + descriptor['docID'] + '.pdf',
                source_title='EDINET 有価証券報告書', kind='filed_fiscal_period_dividend',
                split_adjustment='as_reported', latest_filing_guaranteed=False)


def parse_annual_zip(payload, identity, descriptor, observed_at):
    """No archive extraction to disk and no HTML/prose reads."""
    if not isinstance(payload, bytes) or len(payload) > MAX_ZIP_BYTES:
        return None
    try:
        with ZipFile(BytesIO(payload)) as archive:
            infos = archive.infolist()
            if (len(infos) > MAX_ZIP_ENTRIES
                    or len({info.filename for info in infos}) != len(infos)
                    or sum(info.file_size for info in infos) > MAX_UNCOMPRESSED_BYTES
                    or any(info.flag_bits & 1 for info in infos)):
                return None
            selected = [info for info in infos if re.fullmatch(r'XBRL/PublicDoc/[^/\\]{1,300}\.xbrl', info.filename)]
            if not 0 < len(selected) <= 4 or any(info.file_size > MAX_XML_BYTES for info in selected):
                return None
            facts = [parse_annual_dividend(archive.read(info), identity, descriptor, observed_at)
                     for info in selected]
            facts = [fact for fact in facts if fact is not None]
            if len(facts) != 1:
                return None
            return facts[0]
    except (BadZipFile, OSError, RuntimeError, ValueError):
        return None


def _retry_after(value, now):
    delay = 60
    if isinstance(value, str) and len(value) <= 128:
        if re.fullmatch(r'[0-9]{1,10}', value.strip()):
            delay = int(value.strip())
        else:
            try:
                parsed = parsedate_to_datetime(value)
                if parsed.tzinfo is not None:
                    delay = math.ceil(parsed.timestamp() - now)
            except (TypeError, ValueError, OverflowError, OSError):
                pass
    # A server-specified minimum must not be shortened into earlier retries.
    return max(30, delay)


class EdinetAnnualDividends:
    """Explicit candidate call only; single bounded request, no retries or scans."""
    def __init__(self, api_key=None, *, identities=(), session_factory=requests.Session,
                 clock=time.time, monotonic=time.monotonic):
        self._api_key = api_key if isinstance(api_key, str) and 0 < len(api_key) <= 1024 else None
        self.identities = tuple(identities)
        self.session_factory, self.clock, self.monotonic = session_factory, clock, monotonic
        self._reset_process()
        if hasattr(os, 'register_at_fork'):
            os.register_at_fork(after_in_child=self._reset_process)

    def _reset_process(self):
        self._pid, self._lock, self._next_request = os.getpid(), threading.Lock(), 0

    @staticmethod
    def _result(status, fact=None):
        result = dict(status=status, data={}, field_status=dict(historical_dividend_per_share=status))
        if fact:
            result.update(data=dict(historical_dividend_per_share=fact['value']), dividend_fact=fact,
                          field_status=dict(historical_dividend_per_share='available'))
        return result

    def fetch(self, company, descriptor):
        if not self._api_key:
            return self._result('not_configured')
        identity = match_identity(company, self.identities)
        if identity is None:
            return self._result('identity_unconfirmed')
        try:
            observed = self.clock()
            valid_descriptor = _descriptor_valid(descriptor, identity, datetime.fromtimestamp(observed, JST))
        except (ValueError, TypeError, OverflowError, OSError):
            valid_descriptor = False
        if not valid_descriptor:
            return self._result('filing_unconfirmed')
        if self._pid != os.getpid():
            self._reset_process()
        if not self._lock.acquire(blocking=False):
            return self._result('provider_waiting')
        try:
            if observed < self._next_request:
                return self._result('provider_waiting')
            self._next_request = observed + 60
            deadline = self.monotonic() + 8
            with self.session_factory() as session:
                with session.get(API_BASE + descriptor['docID'],
                                 params={'type': 1, 'Subscription-Key': self._api_key},
                                 timeout=(3, 5), stream=True, allow_redirects=False) as response:
                    if response.status_code == 429:
                        self._next_request = observed + _retry_after(response.headers.get('Retry-After'), observed)
                        return self._result('rate_limited')
                    if response.status_code != 200:
                        return self._result('fetch_error')
                    content_type = response.headers.get('Content-Type', '').split(';')[0].strip().lower()
                    if content_type not in ('application/octet-stream', 'application/zip', 'application/json'):
                        return self._result('invalid_source')
                    cap = 64_000 if content_type == 'application/json' else MAX_ZIP_BYTES
                    blocks, size = [], 0
                    while True:
                        if self.monotonic() >= deadline:
                            return self._result('fetch_error')
                        block = response.raw.read1(64_000, decode_content=True)
                        if not block:
                            break
                        size += len(block)
                        if size > cap:
                            return self._result('invalid_source')
                        blocks.append(block)
                    payload = b''.join(blocks)
                    if content_type == 'application/json':
                        # EDINET can return HTTP 200 containing an error object.
                        import json
                        error = json.loads(payload)
                        metadata = error.get('metadata') if isinstance(error, dict) else None
                        status = error.get('StatusCode') if isinstance(error, dict) else None
                        status = metadata.get('status') if isinstance(metadata, dict) else status
                        if str(status) == '429':
                            self._next_request = observed + _retry_after(response.headers.get('Retry-After'), observed)
                            return self._result('rate_limited')
                        return self._result('fetch_error')
            fact = parse_annual_zip(payload, identity, descriptor, self.clock())
            return self._result('available', fact) if fact else self._result('source_missing')
        except (requests.RequestException, UpstreamReadError, OSError, TimeoutError,
                ValueError, TypeError, AttributeError):
            # Exception URLs may contain the query credential; never expose them.
            return self._result('fetch_error')
        finally:
            self._lock.release()
