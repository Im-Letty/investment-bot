"""Verified public company business summaries from the MHLW bulk download.

Only independently written factual summaries are published. The source has
third-party copyright exceptions; downloading it does not license company prose.
The importer joins the current exchange identity to EDINET's corporate number
and then to the workplace record; a company name alone is never sufficient.
No network, registration, or paid service is used at startup or on requests.
"""
from copy import deepcopy
from datetime import date, datetime, timezone, timedelta
import json
import math
from pathlib import Path
import re
import time
import unicodedata

from company_business import normalize_name, official_identity

JST = timezone(timedelta(hours=9))
SOURCE_URL = 'https://shokuba.mhlw.go.jp/shokuba/utilize/utilize010.do'
TERMS_URL = 'https://shokuba.mhlw.go.jp/080/020/20180302211639.html'
EDINET_CODES_URL = 'https://disclosure2dl.edinet-fsa.go.jp/searchdocument/codelist/Edinetcode.zip'
USE_BASIS = 'independent_summary_of_business_facts'
SEED_PATH = Path(__file__).with_name('static') / 'company-public-business-seed.json'
NOTICE = '職場情報総合サイト（しょくばらぼ）の事業情報をもとに当サイトが説明を作成。'


def summary_excerpt(value, limit=1000):
    if not isinstance(value, str) or not 0 < len(value) <= 5120:
        return None
    # Preserve content and punctuation. Only line breaks/spacing are normalized.
    text = re.sub(r'\s+', ' ', value).strip()
    if (not re.search(r'[\u3040-\u30ff\u3400-\u9fff]', text)
            or any(unicodedata.category(c) == 'Cc' for c in text)
            or text in ('なし', '無し', '未記入', '未登録', '該当なし', 'その他', '日本の企業', '日本の会社')):
        return None
    if len(text) > limit:
        excerpt = text[:limit - 1]
        stop = max(excerpt.rfind('。'), excerpt.rfind('．'))
        if stop >= limit // 2:
            excerpt = excerpt[:stop + 1]
        text = excerpt.rstrip() + '…'
    return text


def validate_record(row, company, *, now=None):
    now = time.time() if now is None else now
    if not isinstance(row, dict):
        return None
    identity = official_identity(row.get('symbol'), company)
    proof = row.get('proof')
    if (identity is None or row.get('identity') != identity or not isinstance(proof, dict)
            or proof.get('code') != identity['code']
            or normalize_name(proof.get('edinet_name')) != identity['name']
            or normalize_name(proof.get('source_name')) != identity['name']
            or not re.fullmatch(r'E[0-9]{5}', str(proof.get('edinet_code', '')))
            or not re.fullmatch(r'[0-9]{13}', str(proof.get('corporate_number', '')))
            or proof.get('edinet_corporate_number') != proof.get('corporate_number')
            or proof.get('source_security_code') not in ('', identity['code'])
            or row.get('source_url') != SOURCE_URL or row.get('terms_url') != TERMS_URL
            or row.get('use_basis') != USE_BASIS):
        return None
    try:
        source_day = date.fromisoformat(row['source_updated_on'])
        checked_day = date.fromisoformat(row['identity_checked_on'])
        today = datetime.fromtimestamp(now, JST).date()
        if (source_day.isoformat() != row['source_updated_on'] or source_day > today
                or checked_day.isoformat() != row['identity_checked_on'] or checked_day > today):
            return None
        record_day = row.get('source_record_updated_on')
        if record_day is not None:
            parsed_record_day = date.fromisoformat(record_day)
            if parsed_record_day.isoformat() != record_day or parsed_record_day > source_day:
                return None
    except (KeyError, TypeError, ValueError, OSError, OverflowError):
        return None
    fetched = row.get('fetched_at')
    text = row.get('text')
    if (not isinstance(fetched, (int, float)) or isinstance(fetched, bool)
            or not math.isfinite(fetched) or not 0 < fetched <= now
            or not isinstance(text, str) or not 0 < len(text) <= 400
            or summary_excerpt(text) != text):
        return None
    return dict(kind='public_company_business', field_status='available', text=text,
                source_url=SOURCE_URL, source_title='厚生労働省・しょくばらぼ',
                source_updated_on=row['source_updated_on'], fetched_at=fetched,
                source_record_updated_on=row.get('source_record_updated_on'),
                use_basis=USE_BASIS, attribution_notice=NOTICE, refreshing=False,
                products=[], industry_labels=[])


class CompanyPublicBusinesses:
    def __init__(self, path=SEED_PATH, *, now=time.time):
        self.now, self.rows = now, {}
        try:
            path = Path(path)
            if path.stat().st_size > 16_000_000:
                return
            document = json.loads(path.read_text(encoding='utf-8'))
            rows = document.get('items')
            if document.get('schema_version') != 1 or not isinstance(rows, list) or len(rows) > 8192:
                return
            duplicate = set()
            for row in rows:
                if not isinstance(row, dict):
                    continue
                symbol = row.get('symbol')
                if not isinstance(symbol, str):
                    continue
                if symbol in self.rows or symbol in duplicate:
                    self.rows.pop(symbol, None)
                    duplicate.add(symbol)
                else:
                    self.rows[symbol] = row
        except (OSError, ValueError, TypeError, AttributeError):
            pass

    def get(self, symbol, company):
        row = self.rows.get(symbol)
        return deepcopy(validate_record(row, company, now=self.now())) if row else None
