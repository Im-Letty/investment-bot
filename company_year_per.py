"""Issuer-reported annual PER facts, independent of today's quote and EPS.

Only reviewed, same-company numerical disclosure facts are shipped. A report's
year column is not proof of its price's exact date. Reading this seed, or
enriching a search result, never makes a source/provider request.
"""
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
import json
import math
from pathlib import Path
import re
import time
import unicodedata

from company_business import official_identity, normalize_name
from company_reviewed_business import report_document_id, report_name_key

JST = timezone(timedelta(hours=9))
KIND = FIELD = 'issuer_reported_fiscal_per'
USE_BASIS = 'independent_extraction_of_numeric_facts'
SEED_PATH = Path(__file__).with_name('static') / 'company-year-per-seed.json'


def source_number(value):
    """An exact table token; malformed comma groups never turn into numbers."""
    if not isinstance(value, str) or not 0 < len(value) <= 40:
        return None
    token = unicodedata.normalize('NFKC', value).strip()
    if not re.fullmatch(r'[+\-−△▲]?(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]{1,8})?', token):
        return None
    token = token.replace(',', '').replace('−', '-').replace('△', '-').replace('▲', '-')
    try:
        return Decimal(token)
    except InvalidOperation:
        return None


def validate_year_per(row, company, *, now=None):
    now = time.time() if now is None else now
    if not isinstance(row, dict):
        return None
    identity = official_identity(row.get('symbol'), company)
    proof = row.get('proof')
    if (identity is None or row.get('identity') != identity or not isinstance(proof, dict)
            or row.get('kind') != KIND or row.get('unit') != 'times'
            or row.get('use_basis') != USE_BASIS or row.get('latest_filing_guaranteed') is not False
            or proof.get('code') != identity['code']
            or report_name_key(proof.get('source_company_name')) != report_name_key(identity['name'])
            or report_name_key(proof.get('filing_company_name')) != report_name_key(identity['name'])
            or proof.get('official_code_match') is not True or proof.get('current_company_name_match') is not True
            or not re.fullmatch(r'E[0-9]{5}', str(proof.get('edinet_code', '')))
            or not re.fullmatch(r'[0-9]{13}', str(proof.get('corporate_number', '')))
            or proof.get('current_edinet_code') != proof.get('edinet_code')
            or proof.get('current_corporate_number') != proof.get('corporate_number')
            or not re.fullmatch(r'[0-9a-f]{64}', str(row.get('pdf_sha256', '')))
            or proof.get('reviewed') is not True
            or proof.get('review_method') not in ('strict_table_validation', 'individual_table_review')
            or proof.get('fiscal_period_verified') is not True
            or proof.get('accounting_standard_verified') is not True
            or proof.get('ratio_row_verified') is not True
            or proof.get('annual_report_verified') is not True
            or type(proof.get('source_page')) is not int or not 1 <= proof['source_page'] <= 600):
        return None
    document = report_document_id(row.get('source_url'))
    if document is None or proof.get('doc_id') != document:
        return None
    if (row.get('basis') not in ('consolidated', 'standalone')
            or row.get('accounting_standard') not in ('JGAAP', 'IFRS', 'USGAAP')
            or proof.get('basis') != row['basis'] or proof.get('accounting_standard') != row['accounting_standard']):
        return None
    if row['basis'] == 'standalone' and proof.get('standalone_scope_verified') is not True:
        return None
    fetched = row.get('fetched_at')
    if type(fetched) not in (int, float) or not math.isfinite(fetched) or not 0 < fetched <= now:
        return None
    try:
        start, end = (date.fromisoformat(row['fiscal_period'][key]) for key in ('start', 'end'))
        filed, checked = (date.fromisoformat(row[key]) for key in ('filed_on', 'checked_on'))
        fetched_day, today = datetime.fromtimestamp(fetched, JST).date(), datetime.fromtimestamp(now, JST).date()
        if (row['fiscal_period'] != {'start': start.isoformat(), 'end': end.isoformat()}
                or not 0 < (end - start).days <= 550 or row['filed_on'] != filed.isoformat()
                or row['checked_on'] != checked.isoformat() or not end <= filed <= fetched_day <= checked <= today
                or proof.get('latest_column_end') != end.isoformat()):
            return None
    except (ValueError, TypeError, KeyError, OSError, OverflowError):
        return None
    price_basis, price_date = row.get('price_basis'), row.get('price_reference_date')
    if price_basis not in ('period_end_explicit', 'not_stated'):
        return None
    if price_basis == 'period_end_explicit':
        if price_date != end.isoformat() or proof.get('price_basis_evidence_kind') != 'report_note':
            return None
    elif price_date is not None or proof.get('price_basis_evidence_kind') != 'not_stated':
        return None
    status, value, reason = row.get('status'), row.get('value'), row.get('reason')
    ratio, eps = source_number(proof.get('source_ratio_text')), source_number(proof.get('source_eps_text'))
    eps_label = proof.get('source_eps_label')
    eps_label = unicodedata.normalize('NFKC', eps_label) if isinstance(eps_label, str) else ''
    eps_is_earnings = (proof.get('eps_row_verified') is True and '1株' in eps_label
                       and any(word in eps_label for word in ('利益', '損失', '損益'))
                       and not any(word in eps_label for word in ('純資産', '帰属持分', '1株当たり資本')))
    if status == 'available':
        if (type(value) not in (int, float) or not math.isfinite(value) or not 0 < value <= 10_000_000
                or ratio is None or ratio != Decimal(str(value)) or reason is not None
                or eps is None or eps <= 0 or not eps_is_earnings):
            return None
    elif status == 'not_presented' and value is None:
        if proof.get('not_presented_verified') is not True:
            return None
        raw_ratio = proof.get('source_ratio_text')
        dash = isinstance(raw_ratio, str) and unicodedata.normalize('NFKC', raw_ratio).strip() in ('-', '—', '–', '―')
        if not dash and not (ratio is not None and ratio < 0 and reason == 'loss_eps'):
            return None
        if reason == 'loss_eps':
            if eps is None or eps >= 0 or not eps_is_earnings or proof.get('loss_eps_verified') is not True:
                return None
        elif reason == 'zero_eps':
            if eps != 0 or not eps_is_earnings or proof.get('zero_eps_verified') is not True:
                return None
        elif reason != 'ratio_not_disclosed':
            return None
        # A positive stated ratio cannot be quietly replaced with "not given".
        if ratio is not None and ratio > 0:
            return None
    else:
        return None
    return dict(symbol=identity['symbol'], security_code=identity['code'], issuer_name=company['name'],
                exchange=identity['exchange'], kind=KIND, status=status, value=value, reason=reason,
                unit='times', basis=row['basis'], accounting_standard=row['accounting_standard'],
                fiscal_period={'start': start.isoformat(), 'end': end.isoformat()},
                price_basis=price_basis, price_reference_date=price_date, doc_id=document,
                source_url=row['source_url'], source_title='有価証券報告書（当サイトが年度PERを抜粋）',
                filed_on=filed.isoformat(), checked_on=checked.isoformat(), fetched_at=fetched,
                use_basis=USE_BASIS, latest_filing_guaranteed=False)


class CompanyYearPERs:
    def __init__(self, path=SEED_PATH, *, now=time.time):
        self.now, self.rows = now, {}
        try:
            path = Path(path)
            if path.stat().st_size > 12_000_000:
                return
            document = json.loads(path.read_text(encoding='utf-8'))
            if document.get('schema_version') != 1 or not isinstance(document.get('items'), list) or len(document['items']) > 8192:
                return
            duplicates = set()
            for row in document['items']:
                symbol = row.get('symbol') if isinstance(row, dict) else None
                if not isinstance(symbol, str):
                    continue
                if symbol in self.rows or symbol in duplicates:
                    self.rows.pop(symbol, None); duplicates.add(symbol)
                else:
                    self.rows[symbol] = row
        except (OSError, ValueError, TypeError, AttributeError):
            pass

    def get(self, symbol, company):
        return deepcopy(validate_year_per(self.rows.get(symbol), company, now=self.now()))


def enrich_search_per(payload, catalogue, year_pers):
    """Join local facts to verified catalogue results in this same response."""
    result = deepcopy(payload)
    for row in result.get('results', []):
        if not isinstance(row, dict) or row.get('verified') is not True:
            continue
        symbol = row.get('symbol')
        if not isinstance(symbol, str) or not re.fullmatch(r'[0-9][A-Z0-9]{3}\.(T|JP)', symbol):
            continue
        company = catalogue.company(symbol.split('.')[0])
        if (not company or company.get('symbol') != symbol
                or normalize_name(row.get('name')) != normalize_name(company.get('name'))):
            continue
        row['code'], row['exchange'] = company['code'], company['exchange']
        fact = year_pers.get(symbol, company)
        row['year_per'] = fact
        row['year_per_status'] = fact['status'] if fact else 'unconfirmed'
    return result
