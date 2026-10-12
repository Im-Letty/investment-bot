"""Independent business summaries reviewed against same-issuer public filings.

Only authored short factual explanations are shipped. Report sections, PDFs,
personal contacts and employer prose remain private research material.
"""
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
import json
import math
from pathlib import Path
import re
import time

from company_business import normalize_name, official_identity
from company_public_business import summary_excerpt

JST = timezone(timedelta(hours=9))
USE_BASIS = 'independent_summary_of_business_facts'
SEED_PATH = Path(__file__).with_name('static') / 'company-reviewed-business-seed.json'


def report_name_key(value):
    """Narrow typographic hyphen equivalence, never name or subsidiary aliases."""
    normalized = normalize_name(value)
    return normalized.translate(str.maketrans({'‐': '-', '‑': '-', '−': '-'})) if normalized else None


def report_document_id(value):
    if not isinstance(value, str):
        return None
    match = re.fullmatch(r'https://info\.gbiz\.go\.jp/hojin/edinetDownload\?docId=(S[A-Z0-9]{7})', value)
    if not match:
        match = re.fullmatch(r'https://disclosure2dl\.edinet-fsa\.go\.jp/searchdocument/pdf/(S[A-Z0-9]{7})\.pdf', value)
    return match.group(1) if match else None


def validate_summary(row, company, *, now=None):
    now = time.time() if now is None else now
    if not isinstance(row, dict):
        return None
    identity = official_identity(row.get('symbol'), company)
    proof = row.get('proof')
    if (identity is None or row.get('identity') != identity or not isinstance(proof, dict) or
            row.get('use_basis') != USE_BASIS or row.get('source_kind') != 'public_annual_report' or
            proof.get('code') != identity['code'] or
            report_name_key(proof.get('source_company_name')) != report_name_key(identity['name']) or
            report_name_key(proof.get('filing_company_name')) != report_name_key(identity['name']) or
            proof.get('official_code_match') is not True or proof.get('current_company_name_match') is not True or
            not re.fullmatch(r'E[0-9]{5}', str(proof.get('edinet_code', ''))) or
            not re.fullmatch(r'[0-9]{13}', str(proof.get('corporate_number', ''))) or
            proof.get('current_edinet_code') != proof.get('edinet_code') or
            proof.get('current_corporate_number') != proof.get('corporate_number') or
            not re.fullmatch(r'[0-9a-f]{64}', str(row.get('pdf_sha256', ''))) or
            proof.get('doc_id') != report_document_id(row.get('source_url')) or
            proof.get('doc_id') is None):
        return None
    text = row.get('text')
    fetched = row.get('fetched_at')
    if (not isinstance(text, str) or not 0 < len(text) <= 400 or summary_excerpt(text) != text or
            type(fetched) not in (int, float) or not math.isfinite(fetched) or not 0 < fetched <= now):
        return None
    try:
        filed = date.fromisoformat(row['filed_on'])
        checked = date.fromisoformat(row['checked_on'])
        fetched_day, today = datetime.fromtimestamp(fetched, JST).date(), datetime.fromtimestamp(now, JST).date()
        if (row['filed_on'] != filed.isoformat() or row['checked_on'] != checked.isoformat() or
                not filed <= fetched_day <= checked <= today):
            return None
    except (KeyError, ValueError, TypeError, OSError, OverflowError):
        return None
    return dict(kind='reviewed_company_business', field_status='available', text=text,
                source_kind='public_annual_report', use_basis=USE_BASIS, source_url=row['source_url'],
                source_title='Gビズインフォ・EDINET有価証券報告書' if row['source_url'].startswith('https://info.gbiz.go.jp/') else 'EDINET有価証券報告書', fetched_at=fetched,
                source_published_on=row['filed_on'], reviewed_on=row['checked_on'],
                attribution_notice='提出資料の事業情報をもとに当サイトが説明を作成。',
                refreshing=False, products=[], industry_labels=[])


class CompanyReviewedBusinesses:
    def __init__(self, path=SEED_PATH, *, now=time.time):
        self.now, self.rows = now, {}
        try:
            path = Path(path)
            if path.stat().st_size > 8_000_000:
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
                    self.rows.pop(symbol, None)
                    duplicates.add(symbol)
                else:
                    self.rows[symbol] = row
        except (OSError, ValueError, TypeError, AttributeError):
            pass

    def get(self, symbol, company):
        row = self.rows.get(symbol)
        return deepcopy(validate_summary(row, company, now=self.now())) if row else None
