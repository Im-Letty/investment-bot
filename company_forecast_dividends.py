"""Independently extracted, dated issuer dividend forecasts from public filings.

An issuer's fiscal-year forecast is never an annualized provider estimate or
a filed historical amount. No request, account, or paid API runs at startup.
Only reviewed same-company numerical facts enter the bundled seed.
"""
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
import ipaddress
import json
import math
from pathlib import Path
import re
import time
from urllib.parse import urlsplit

from company_business import normalize_name, official_identity

JST = timezone(timedelta(hours=9))
FIELD = 'issuer_annual_dividend_forecast_per_share'
KIND = 'issuer_annual_dividend_forecast'
USE_BASIS = 'independent_extraction_of_numeric_facts'
SEED_PATH = Path(__file__).with_name('static') / 'company-dividend-forecast-seed.json'


def public_document_url(value, host):
    if not isinstance(value, str) or len(value) > 2048 or re.search(r'[\x00-\x20\x7f\\]', value):
        return None
    try:
        url = urlsplit(value)
        if (url.scheme != 'https' or not url.hostname or url.hostname != host or
                url.username or url.password or (url.query and not re.fullmatch(r'[0-9]{1,20}', url.query)) or url.fragment or
                url.port not in (None, 443) or not re.fullmatch(r'[a-z0-9.-]+', host or '') or
                not url.path.lower().endswith('.pdf')):
            return None
        try:
            ipaddress.ip_address(host)
            return None
        except ValueError:
            pass
        if '.' not in host or host.endswith(('.local', '.localhost')):
            return None
        return value
    except ValueError:
        return None


def amount(value):
    return type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 1_000_000


def validate_forecast(row, company, *, now=None):
    now = time.time() if now is None else now
    if not isinstance(row, dict):
        return None
    identity = official_identity(row.get('symbol'), company)
    proof = row.get('proof')
    if (identity is None or row.get('identity') != identity or not isinstance(proof, dict) or
            proof.get('code') != identity['code'] or
            proof.get('source_security_code') not in (identity['code'], identity['code'] + '0') or
            normalize_name(proof.get('issuer_name')) != identity['name'] or
            proof.get('exchange') != identity['exchange'] or
            row.get('kind') != KIND or row.get('use_basis') != USE_BASIS or
            row.get('currency') != 'JPY' or row.get('unit') != 'JPY/share' or
            row.get('split_adjustment') != 'as_reported' or
            row.get('latest_revision_guaranteed') is not False):
        return None
    source_url = public_document_url(row.get('source_url'), proof.get('source_host'))
    if not source_url or proof.get('issuer_document_url') != source_url:
        return None
    fetched = row.get('fetched_at')
    if type(fetched) not in (int, float) or not math.isfinite(fetched) or not 0 < fetched <= now:
        return None
    try:
        announcement = date.fromisoformat(row['announcement_date'])
        checked = date.fromisoformat(row['checked_on'])
        period = row['fiscal_period']
        start, end = date.fromisoformat(period['start']), date.fromisoformat(period['end'])
        today, fetched_day = datetime.fromtimestamp(now, JST).date(), datetime.fromtimestamp(fetched, JST).date()
        if (row['announcement_date'] != announcement.isoformat() or row['checked_on'] != checked.isoformat() or
                period['start'] != start.isoformat() or period['end'] != end.isoformat() or
                not announcement <= fetched_day <= checked <= today or
                not 0 < (end - start).days <= 550 or
                not start - timedelta(days=90) <= announcement <= end + timedelta(days=180)):
            return None
    except (KeyError, TypeError, ValueError, OSError, OverflowError):
        return None
    status, value = row.get('status'), row.get('value')
    if status not in ('available', 'range', 'undetermined', 'not_comparable', 'not_disclosed') or (status == 'available' and not amount(value)) or (status != 'available' and value is not None):
        return None
    value_range = row.get('value_range')
    if status == 'range':
        if (not isinstance(value_range, dict) or not amount(value_range.get('min')) or
                not amount(value_range.get('max')) or value_range['min'] >= value_range['max']):
            return None
        value_range = {key: value_range[key] for key in ('min', 'max')}
    else:
        value_range = None
    reasons = {'not_comparable': 'split_basis_mismatch', 'not_disclosed': 'annual_amount_not_reported'}
    if status in reasons and row.get('reason') != reasons[status]:
        return None
    reported_split = row.get('reported_split')
    if reported_split is not None:
        try:
            effective = date.fromisoformat(reported_split['effective_on'])
            if (effective.isoformat() != reported_split['effective_on'] or effective > end or
                    type(reported_split['before']) is not int or type(reported_split['after']) is not int or
                    not 0 < reported_split['before'] <= 1_000_000 or not 0 < reported_split['after'] <= 1_000_000):
                return None
        except (TypeError, KeyError, ValueError):
            return None
        reported_split = {key: reported_split[key] for key in ('effective_on', 'before', 'after')}
    source_title = row.get('source_title')
    if not isinstance(source_title, str) or not 0 < len(source_title) <= 160 or re.search(r'[\x00-\x1f\x7f]', source_title):
        return None
    return dict(kind=KIND, status=status, reason=reasons.get(status), value=value, value_range=value_range, reported_split=reported_split, currency='JPY', unit='JPY/share',
                security_code=identity['code'], issuer_name=company['name'], exchange=identity['exchange'],
                fiscal_period={'start': start.isoformat(), 'end': end.isoformat()},
                fiscal_period_expired=end < today,
                announcement_date=announcement.isoformat(), checked_on=checked.isoformat(), fetched_at=fetched,
                source_url=source_url, source_title=source_title, source_host=proof['source_host'],
                use_basis=USE_BASIS, split_adjustment='as_reported', latest_revision_guaranteed=False)


class CompanyForecastDividends:
    def __init__(self, path=SEED_PATH, *, now=time.time):
        self.now, self.rows = now, {}
        try:
            path = Path(path)
            if path.stat().st_size > 2_000_000:
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
        return deepcopy(validate_forecast(row, company, now=self.now())) if row else None
