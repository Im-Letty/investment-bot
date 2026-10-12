"""Candidate EDINET supplement for *filed fiscal-period* dividend facts.

This optional module reads official filing metadata and filed fiscal dividends.
It never fetches quotes, calculates capitalization, copies descriptions or creates
credentials. Without an owner-provided API key, even a Session is not created.

References: EDINET API v2 specification, sections 3-1, 3-2 and 4-1;
2026 taxonomy element list ESE140114.xlsx; instance guideline ESE140112.pdf.
"""
from dataclasses import dataclass
from datetime import date, datetime, timezone, timedelta
from decimal import Decimal, InvalidOperation
from email.utils import parsedate_to_datetime
from hashlib import sha256
from io import BytesIO, StringIO
import csv
import fcntl
import json
from pathlib import Path
import math
import os
import re
import threading
import time
import unicodedata
from urllib.parse import urlsplit
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
MAX_LIST_BYTES = 4_000_000
MAX_LIST_ROWS = 20_000
SEED_PATH = Path(__file__).with_name('regional_edinet_identities.json')
FILING_HINT_PATH = Path(__file__).with_name('regional_edinet_filing_hints.json')
# Closed, corporation-bound spellings verified against the 2026-10-12 official
# EDINET code list and issuer sources. No transliteration or fuzzy matching.
# NITTOH explicitly identifies its registered name as ニットー:
# https://www.nittoh-info.co.jp/company/
# The same 3055 corporation changed its name on 2026-09-29:
# https://www.tsumuguhd.co.jp/company/message/
_VERIFIED_NAMES = {
    ('1738', 'E05065', '17380', '1180001013107'):
        ('2026-10-12', ('ニットー', 'NITTOH')),
    ('3055', 'E03003', '30550', '2430001032501'):
        ('2026-10-12', ('TSUMUGU HOLDINGS', 'ほくやく・竹山ホールディングス')),
}


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


def _same_issuer_name(value, identity):
    if _name(value) == _name(identity.name):
        return True
    verified = _VERIFIED_NAMES.get((identity.code, identity.edinet_code,
                                   identity.security_code, identity.corporate_number))
    return bool(verified and _date(identity.as_of) and _date(identity.as_of) >= _date(verified[0])
                and _name(identity.name) in {_name(name) for name in verified[1]}
                and _name(value) in {_name(name) for name in verified[1]})


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
             and _same_issuer_name(company['name'], row)
             and re.fullmatch(r'E[0-9]{5}', row.edinet_code) and _date(row.as_of)]
    if len(found) != 1:
        return None
    row = found[0]
    if company.get('corporate_number') and company['corporate_number'] != row.corporate_number:
        return None
    return row


def _stamp(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2} \d{2}:\d{2}', value):
        return None
    try:
        return datetime.strptime(value, '%Y-%m-%d %H:%M').replace(tzinfo=JST)
    except ValueError:
        return None


def load_identity_seed(path=SEED_PATH, *, observed_at=None):
    """Public dated identity facts only; no credentials or communication."""
    now = time.time() if observed_at is None else observed_at
    try:
        today = datetime.fromtimestamp(now, JST).date()
        raw = Path(path).read_bytes()
        if len(raw) > 200_000:
            return ()
        data = json.loads(raw)
        if data.get('source_url') != CODE_LIST_URL or data.get('version') != 1:
            return ()
        records = data.get('identities')
        if not isinstance(records, list) or not 0 < len(records) <= 1000:
            return ()
        output, seen = [], set()
        for item in records:
            if not isinstance(item, dict) or set(item) != set(EdinetIdentity.__dataclass_fields__):
                return ()
            row = EdinetIdentity(**item)
            if (not re.fullmatch(r'[0-9][A-Z0-9]{3}', row.code)
                    or row.security_code != row.code + '0'
                    or not re.fullmatch(r'E[0-9]{5}', row.edinet_code)
                    or not _name(row.name) or not _date(row.as_of)
                    or _date(row.as_of) > today or row.code in seen
                    or row.corporate_number and not re.fullmatch(r'[0-9]{13}', row.corporate_number)):
                return ()
            output.append(row)
            seen.add(row.code)
        return tuple(output)
    except (OSError, ValueError, TypeError, OverflowError):
        return ()


def load_filing_hints(path=FILING_HINT_PATH, *, identities=(), observed_at=None):
    """Exact official filing dates can guide discovery, never supply amounts.

    A hint is not an EDINET descriptor, proof of a latest filing, or permission
    to skip metadata/XBRL identity checks. Reading this bounded local seed makes
    no request to the reference URLs.
    """
    now = time.time() if observed_at is None else observed_at
    try:
        raw = Path(path).read_bytes()
        if len(raw) > 100_000:
            return ()
        data = json.loads(raw)
        fields = {'code', 'edinet_code', 'security_code', 'name', 'corporate_number',
                  'identity_as_of', 'submitted_date', 'fiscal_period', 'source_url', 'verified_at'}
        if (not isinstance(data, dict) or set(data) != {'version', 'hints'}
                or data['version'] != 1 or not isinstance(data['hints'], list)
                or len(data['hints']) > 110):
            return ()
        today, output, seen = datetime.fromtimestamp(now, JST).date(), [], set()
        for row in data['hints']:
            if not isinstance(row, dict) or set(row) != fields:
                return ()
            identity = [item for item in identities if item.code == row['code']]
            if len(identity) != 1:
                continue
            identity = identity[0]
            if (row['edinet_code'] != identity.edinet_code or row['security_code'] != identity.security_code
                    or _name(row['name']) != _name(identity.name)
                    or row['corporate_number'] != identity.corporate_number
                    or row['identity_as_of'] != identity.as_of):
                continue
            submitted = _date(row['submitted_date'])
            period = row['fiscal_period']
            if not isinstance(period, dict) or set(period) != {'start', 'end'}:
                continue
            start, end = _date(period['start']), _date(period['end'])
            verified = datetime.fromisoformat(row['verified_at']) if isinstance(row['verified_at'], str) else None
            url = urlsplit(row['source_url']) if isinstance(row['source_url'], str) else None
            if (not submitted or not start or not end or not 0 <= (end - start).days <= 550
                    or not end <= submitted <= today or not _date(identity.as_of) <= today
                    or not verified or verified.utcoffset() != timedelta(hours=9)
                    or not 0 < verified.timestamp() <= now or verified.date() < submitted
                    or verified.date() < _date(identity.as_of)
                    or not url or url.scheme != 'https' or not url.hostname
                    or not re.fullmatch(r'[a-z0-9.-]+', url.hostname) or '.' not in url.hostname
                    or url.username or url.password or url.port or url.query or url.fragment
                    or not url.path.endswith('.pdf') or len(row['source_url']) > 400
                    or row['code'] in seen):
                continue
            output.append(dict(row))
            seen.add(row['code'])
        return tuple(output)
    except (OSError, ValueError, TypeError, OverflowError, KeyError, AttributeError):
        return ()


def _issuer_valid(row, identity):
    return bool(identity and isinstance(row, dict)
                and row.get('edinetCode') == identity.edinet_code
                and row.get('secCode') == identity.security_code
                and _same_issuer_name(row.get('filerName'), identity)
                and (not row.get('JCN') or row['JCN'] == identity.corporate_number))


def _active(row):
    # 1 denotes an edit / disclosure event; 2 denotes unavailable metadata.
    return (row.get('withdrawalStatus') == '0'
            and row.get('docInfoEditStatus') in ('0', '1')
            and row.get('disclosureStatus') in ('0', '1')
            and row.get('legalStatus') in ('1', '2')
            and row.get('xbrlFlag') == '1')


def _descriptor_valid(descriptor, identity, observed):
    if not isinstance(descriptor, dict) or identity is None:
        return False
    row = descriptor
    if row.get('docTypeCode') == '130':
        base, chain = row.get('_annual_base'), row.get('_correction_chain')
        if (not isinstance(chain, list) or not 0 < len(chain) <= 16
                or not isinstance(base, dict) or base.get('docTypeCode') != '120'
                or not _descriptor_valid(base, identity, observed)):
            return False
        parent, last_stamp = base['docID'], _stamp(base['submitDateTime'])
        seen = {parent}
        for correction in chain:
            stamp = _stamp(correction.get('submitDateTime')) if isinstance(correction, dict) else None
            if (not _issuer_valid(correction, identity) or not _active(correction)
                    or correction.get('docTypeCode') != '130'
                    or not re.fullmatch(r'S[A-Z0-9]{7}', str(correction.get('docID', '')))
                    or correction.get('docID') in seen or correction.get('parentDocID') != parent
                    or not stamp or not last_stamp <= stamp <= observed
                    or any(correction.get(key) not in (None, '', base[key])
                           for key in ('periodStart', 'periodEnd'))):
                return False
            parent, last_stamp = correction['docID'], stamp
            seen.add(parent)
        if row.get('docID') != parent or row.get('submitDateTime') != chain[-1]['submitDateTime']:
            return False
        if any(row.get(key) != base[key] for key in ('periodStart', 'periodEnd')):
            return False
    elif row.get('docTypeCode') != '120':
        return False
    if (not re.fullmatch(r'S[A-Z0-9]{7}', str(row.get('docID', '')))
            or not _issuer_valid(row, identity) or not _active(row)):
        return False
    start, end = (_date(row.get(field)) for field in ('periodStart', 'periodEnd'))
    submitted = _stamp(row.get('submitDateTime'))
    return bool(start and end and submitted and start <= end <= submitted.date()
                and submitted <= observed and _date(identity.as_of)
                and _date(identity.as_of) <= observed.date()
                and 0 <= (end - start).days <= 550)


_DESCRIPTOR_FIELDS = ('docID', 'edinetCode', 'secCode', 'filerName', 'JCN', 'docTypeCode',
                      'periodStart', 'periodEnd', 'submitDateTime', 'opeDateTime', 'parentDocID',
                      'withdrawalStatus', 'docInfoEditStatus', 'disclosureStatus', 'legalStatus', 'xbrlFlag')


def parse_daily_filings(payload, requested_date, observed_at):
    """Validate the official list envelope; store only annual identities / flags."""
    observed = datetime.fromtimestamp(observed_at, JST)
    requested = _date(requested_date)
    if requested is None or requested > observed.date() or not isinstance(payload, dict):
        raise ValueError('invalid_list')
    metadata, rows = payload.get('metadata'), payload.get('results')
    if not isinstance(metadata, dict) or not isinstance(rows, list) or len(rows) > MAX_LIST_ROWS:
        raise ValueError('invalid_list')
    parameter, resultset = metadata.get('parameter'), metadata.get('resultset')
    process = _stamp(metadata.get('processDateTime'))
    if (str(metadata.get('status')) != '200' or not isinstance(parameter, dict)
            or parameter.get('date') != requested_date or str(parameter.get('type')) != '2'
            or not isinstance(resultset, dict) or type(resultset.get('count')) is not int
            or resultset['count'] != len(rows) or not process or process > observed):
        raise ValueError('invalid_list')
    selected = {}
    for raw in rows:
        if not isinstance(raw, dict) or not re.fullmatch(r'S[A-Z0-9]{7}', str(raw.get('docID', ''))):
            raise ValueError('invalid_list')
        unavailable = (raw.get('withdrawalStatus') in ('1', '2') or raw.get('legalStatus') == '0'
                       or raw.get('docInfoEditStatus') == '2' or raw.get('disclosureStatus') == '2')
        if raw.get('docTypeCode') not in ('120', '130') and not unavailable:
            continue
        row = {key: raw.get(key) for key in _DESCRIPTOR_FIELDS}
        if any(value is not None and (not isinstance(value, str) or len(value) > 250)
               for value in row.values()):
            raise ValueError('invalid_list')
        operation = _stamp(row.get('opeDateTime'))
        submitted = _stamp(row.get('submitDateTime'))
        if (row.get('opeDateTime') and (not operation or operation > observed)
                or row.get('submitDateTime') and (not submitted or submitted > observed)):
            raise ValueError('invalid_list')
        if row.get('parentDocID') and not re.fullmatch(r'S[A-Z0-9]{7}', row['parentDocID']):
            raise ValueError('invalid_list')
        previous = selected.get(row['docID'])
        if previous and previous != row:
            old_time = _stamp(previous.get('opeDateTime'))
            if not old_time or not operation or operation == old_time:
                raise ValueError('ambiguous_list')
            if operation < old_time:
                continue
        selected[row['docID']] = row
    return dict(date=requested_date, process_at=metadata['processDateTime'], fetched_at=observed_at,
                rows=list(selected.values()))


def select_annual_filing(snapshots, identity, observed_at):
    """Latest known fiscal year, with explicit correction links; never guarantee completeness."""
    observed = datetime.fromtimestamp(observed_at, JST)
    versions, removed = {}, set()
    for snapshot in snapshots:
        process = _stamp(snapshot.get('process_at'))
        if not process or process > observed:
            continue
        for row in snapshot.get('rows', ()):
            previous = versions.get(row['docID'])
            rank = (process, _stamp(row.get('opeDateTime')) or datetime.min.replace(tzinfo=JST))
            if previous and previous[0] == rank and previous[1] != row:
                return dict(status='filing_invalidated', invalidated=True)
            if not previous or rank > previous[0]:
                versions[row['docID']] = (rank, row)
        removed.update(snapshot.get('removed_doc_ids', ()))
    rows = {key: item[1] for key, item in versions.items()}
    for row in rows.values():
        if row.get('withdrawalStatus') == '1' and row.get('parentDocID'):
            removed.add(row['parentDocID'])
    issuer = [row for row in rows.values() if _issuer_valid(row, identity)]
    bases = [row for row in issuer if row.get('docTypeCode') == '120' and _date(row.get('periodEnd'))]
    if not bases:
        if any(row.get('docTypeCode') == '130' for row in issuer):
            return dict(status='correction_unconfirmed', invalidated=True)
        return dict(status='source_missing', invalidated=False)
    period = max(row['periodEnd'] for row in bases)
    bases = [row for row in bases if row['periodEnd'] == period]
    valid = [row for row in bases if row['docID'] not in removed and _descriptor_valid(row, identity, observed)]
    if len(bases) != 1 or len(valid) != 1:
        return dict(status='filing_invalidated', invalidated=True)
    base, chain = valid[0], []
    # A new annual year is chosen before corrections of any older year.
    corrections = [row for row in issuer if row.get('docTypeCode') == '130'
                   and (row.get('periodEnd') in (None, '', period) or row.get('parentDocID') == base['docID'])]
    if any(not row.get('parentDocID') for row in corrections):
        return dict(status='correction_unconfirmed', invalidated=True)
    parent, seen = base['docID'], {base['docID']}
    while True:
        children = [row for row in corrections if row.get('parentDocID') == parent]
        if not children:
            break
        if len(children) != 1 or len(chain) >= 16:
            return dict(status='correction_unconfirmed', invalidated=True)
        child = children[0]
        if child['docID'] in seen or child['docID'] in removed or not _active(child):
            return dict(status='filing_invalidated', invalidated=True)
        chain.append(child)
        seen.add(child['docID'])
        parent = child['docID']
    # An unrelated parent with a same/unknown fiscal period cannot establish correctness.
    if any(row['docID'] not in seen and row.get('parentDocID') not in rows for row in corrections):
        return dict(status='correction_unconfirmed', invalidated=True)
    selected = {**(chain[-1] if chain else base), 'periodStart': base['periodStart'], 'periodEnd': base['periodEnd']}
    if chain:
        selected.update(_annual_base=base, _correction_chain=chain)
    if not _descriptor_valid(selected, identity, observed):
        return dict(status='correction_unconfirmed' if chain else 'filing_invalidated', invalidated=True)
    return dict(status='selected', invalidated=False, descriptor=selected,
                base_doc_id=base['docID'], correction_count=len(chain))


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
            or not _same_issuer_name(next(iter(dei['FilerNameInJapaneseDEI'])), identity)):
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
                split_adjustment='as_reported', latest_filing_guaranteed=False,
                xbrl_body_sha256=sha256(payload).hexdigest(),
                doc_type_code=descriptor['docTypeCode'],
                base_doc_id=descriptor.get('_annual_base', descriptor)['docID'])


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
    """One bounded request at a time; metadata and XBRL share a 60-second gate."""
    def __init__(self, api_key=None, *, identities=(), session_factory=requests.Session,
                 clock=time.time, monotonic=time.monotonic, cooldown_path=None):
        self._api_key = api_key if isinstance(api_key, str) and 0 < len(api_key) <= 1024 else None
        self.identities = tuple(identities)
        self.session_factory, self.clock, self.monotonic = session_factory, clock, monotonic
        self.cooldown_path = Path(cooldown_path) if cooldown_path else None
        self._reset_process()
        if hasattr(os, 'register_at_fork'):
            os.register_at_fork(after_in_child=self._reset_process)

    @property
    def configured(self):
        return bool(self._api_key)

    def _reset_process(self):
        self._pid, self._lock, self._next_request = os.getpid(), threading.Lock(), 0

    @staticmethod
    def _result(status, fact=None):
        result = dict(status=status, data={}, field_status=dict(historical_dividend_per_share=status))
        if fact:
            result.update(data=dict(historical_dividend_per_share=fact['value']), dividend_fact=fact,
                          field_status=dict(historical_dividend_per_share='available'))
        return result

    def _shared_next(self):
        if not self.cooldown_path or not self.cooldown_path.exists():
            return 0
        raw = self.cooldown_path.read_bytes()
        if len(raw) > 256:
            raise ValueError('invalid_gate')
        stamp = json.loads(raw).get('next_request')
        if not isinstance(stamp, (int, float)) or not math.isfinite(stamp) or stamp < 0:
            raise ValueError('invalid_gate')
        return stamp

    def _reserve(self, stamp):
        self._next_request = max(self._next_request, stamp)
        if self.cooldown_path:
            temporary = self.cooldown_path.with_name(self.cooldown_path.name + '.' + str(os.getpid()) + '.tmp')
            try:
                temporary.write_text(json.dumps({'next_request': self._next_request}))
                os.replace(temporary, self.cooldown_path)
            finally:
                temporary.unlink(missing_ok=True)

    def next_request_at(self):
        try:
            return max(self._next_request, self._shared_next())
        except (OSError, ValueError, TypeError):
            return self.clock() + 60

    def restore_cooldown(self, stamp):
        if not self.configured or type(stamp) not in (int, float) or not math.isfinite(stamp) or stamp < 0:
            return False
        with self._lock:
            guard = None
            try:
                if self.cooldown_path:
                    self.cooldown_path.parent.mkdir(parents=True, exist_ok=True)
                    guard = open(str(self.cooldown_path) + '.lock', 'a')
                    fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
                self._reserve(max(stamp, self._shared_next()))
                return True
            except (OSError, ValueError, TypeError):
                return False
            finally:
                if guard:
                    guard.close()

    def retry_after_seconds(self):
        try:
            return max(0, math.ceil(max(self._next_request, self._shared_next()) - self.clock()))
        except (OSError, ValueError, TypeError):
            return 60

    def _request(self, document_id=None, requested_date=None):
        if not self._api_key:
            return dict(status='not_configured')
        if self._pid != os.getpid():
            self._reset_process()
        if not self._lock.acquire(blocking=False):
            return dict(status='provider_waiting')
        guard = None
        try:
            now = self.clock()
            if self.cooldown_path:
                self.cooldown_path.parent.mkdir(parents=True, exist_ok=True)
                guard = open(str(self.cooldown_path) + '.lock', 'a')
                try:
                    fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    return dict(status='provider_waiting')
            if now < max(self._next_request, self._shared_next()):
                return dict(status='provider_waiting')
            self._reserve(now + 60)
            params = {'Subscription-Key': self._api_key, 'type': 2 if requested_date else 1}
            if requested_date:
                params['date'] = requested_date
            url = API_BASE.rstrip('/') + '.json' if requested_date else API_BASE + document_id
            deadline = self.monotonic() + 8
            with self.session_factory() as session:
                with session.get(url, params=params, timeout=(3, 5), stream=True,
                                 allow_redirects=False) as response:
                    if response.status_code == 429:
                        self._reserve(now + _retry_after(response.headers.get('Retry-After'), now))
                        return dict(status='rate_limited')
                    if response.status_code != 200:
                        if response.headers.get('Retry-After'):
                            self._reserve(now + _retry_after(response.headers['Retry-After'], now))
                        return dict(status='fetch_error')
                    content_type = response.headers.get('Content-Type', '').split(';')[0].strip().lower()
                    expected = ('application/json',) if requested_date else ('application/octet-stream', 'application/zip', 'application/json')
                    if content_type not in expected:
                        return dict(status='invalid_source')
                    cap = MAX_LIST_BYTES if requested_date else (64_000 if content_type == 'application/json' else MAX_ZIP_BYTES)
                    blocks, size = [], 0
                    while True:
                        if self.monotonic() >= deadline:
                            return dict(status='fetch_error')
                        block = response.raw.read1(64_000, decode_content=True)
                        if not block:
                            break
                        size += len(block)
                        if size > cap:
                            return dict(status='invalid_source')
                        blocks.append(block)
                    payload = b''.join(blocks)
                    if content_type == 'application/json':
                        parsed = json.loads(payload)
                        metadata = parsed.get('metadata') if isinstance(parsed, dict) else None
                        status = metadata.get('status') if isinstance(metadata, dict) else parsed.get('StatusCode') if isinstance(parsed, dict) else None
                        if str(status) == '429':
                            self._reserve(now + _retry_after(response.headers.get('Retry-After'), now))
                            return dict(status='rate_limited')
                        if not requested_date or str(status) != '200':
                            if response.headers.get('Retry-After'):
                                self._reserve(now + _retry_after(response.headers['Retry-After'], now))
                            return dict(status='fetch_error')
                        return dict(status='downloaded', payload=parsed)
            return dict(status='downloaded', payload=payload)
        except (requests.RequestException, UpstreamReadError, OSError, TimeoutError,
                ValueError, TypeError, AttributeError):
            # Query credentials can appear in exceptions. Expose only fixed states.
            return dict(status='fetch_error')
        finally:
            if guard:
                guard.close()
            self._lock.release()

    def fetch_day(self, requested_date):
        if not self._api_key:
            return dict(status='not_configured')
        today = datetime.fromtimestamp(self.clock(), JST).date()
        day = _date(requested_date)
        if day is None or not today - timedelta(days=399) <= day <= today:
            return dict(status='invalid_source')
        result = self._request(requested_date=requested_date)
        if result['status'] != 'downloaded':
            return dict(status=result['status'])
        try:
            snapshot = parse_daily_filings(result['payload'], requested_date, self.clock())
            return dict(status='indexed', snapshot=snapshot)
        except (ValueError, TypeError, OverflowError, OSError):
            return dict(status='invalid_source')

    def fetch(self, company, descriptor):
        if not self._api_key:
            return self._result('not_configured')
        identity = match_identity(company, self.identities)
        if identity is None:
            return self._result('identity_unconfirmed')
        try:
            valid = _descriptor_valid(descriptor, identity, datetime.fromtimestamp(self.clock(), JST))
        except (ValueError, TypeError, OverflowError, OSError):
            valid = False
        if not valid:
            return self._result('filing_unconfirmed')
        result = self._request(document_id=descriptor['docID'])
        if result['status'] != 'downloaded':
            return self._result(result['status'])
        fact = parse_annual_zip(result['payload'], identity, descriptor, self.clock())
        if not fact:
            return self._result('correction_unconfirmed' if descriptor['docTypeCode'] == '130' else 'source_missing')
        return self._result('available', fact)
