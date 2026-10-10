"""A verified company identity, reviewed explanation and dated provider figures."""
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
import json
import math
from pathlib import Path
import re
import unicodedata

from flask import jsonify, request


EDITORIAL_PATH = Path(__file__).with_name('static') / 'company-profile-editorial.json'
SCHEDULE_PATH = Path(__file__).with_name('company-profile-schedules.json')
JST = timezone(timedelta(hours=9))
PROFILE_FIELDS = ('price', 'market_cap', 'forward_annual_dividend_per_share',
                  'ex_dividend_date', 'dividend_payment_date', 'analyst_target')
FIELD_STATES = {'available', 'loading', 'source_missing', 'fetch_error', 'invalid', 'unconfirmed'}


def field_states(payload, fields):
    """Only use observed reasons; old records cannot prove why a field is absent."""
    supplied = payload.get('field_status')
    supplied = supplied if isinstance(supplied, dict) else {}
    loading = payload.get('refreshing') is True and payload.get('status') in ('pending', 'loading')
    return {field: supplied[field] if isinstance(supplied.get(field), str) and supplied[field] in FIELD_STATES else
            'loading' if loading else 'unconfirmed' for field in fields}


def has_figure(figures, field):
    value = figures.get(field)
    if field == 'analyst_target':
        return isinstance(value, dict) and any(
            isinstance(value.get(part), (int, float)) and not isinstance(value.get(part), bool)
            and math.isfinite(value[part]) and value[part] > 0 for part in ('mean', 'low', 'high'))
    if field in ('ex_dividend_date', 'dividend_payment_date'):
        return isinstance(value, str) and bool(value)
    return (isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
            and (value >= 0 if field in ('annual_dividend', 'forward_annual_dividend_per_share') else value > 0))


def read_editorial(path=EDITORIAL_PATH):
    try:
        document = json.loads(Path(path).read_text(encoding='utf-8'))
        clean = {}
        for item in document.get('items', []):
            if not isinstance(item, dict) or not re.fullmatch(r'[0-9][A-Z0-9]{3}\.T', item.get('symbol', '')):
                continue
            if not all(isinstance(item.get(key), str) and 0 < len(item[key]) <= 400
                       for key in ('business', 'life', 'watch')):
                continue
            try:
                date.fromisoformat(item['reviewed_on'])
            except (KeyError, TypeError, ValueError):
                continue
            sources = item.get('sources', [])
            if not sources or not all(isinstance(source, dict) and
                                      str(source.get('url', '')).startswith('https://')
                                      for source in sources):
                continue
            clean[item['symbol']] = item
        return clean
    except (OSError, ValueError, TypeError, KeyError):
        return {}


def payment_schedule(symbol, today=None, path=SCHEDULE_PATH):
    """Keep month-only company announcements at month precision; never invent a day."""
    try:
        row = json.loads(Path(path).read_text(encoding='utf-8')).get('items', {}).get(symbol)
        period = row.get('payment_period') if isinstance(row, dict) else None
        today = today or datetime.now(JST).date()
        if not isinstance(period, str) or not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', period):
            return None
        if period < today.strftime('%Y-%m') or date.fromisoformat(row['reviewed_on']) > today:
            return None
        if not isinstance(row.get('fetched_at'), (float, int)) or not row.get('source', {}).get('url', '').startswith('https://'):
            return None
        return row
    except (OSError, KeyError, TypeError, ValueError):
        return None


def register_company_profiles(app, profiles, catalogue, dividends, editorial=None, *, quotes=None):
    reviewed = read_editorial() if editorial is None else editorial

    @app.get('/api/company-profile')
    def api_company_profile():
        symbol = unicodedata.normalize('NFKC', request.args.get('symbol', '')).strip().upper()
        if re.fullmatch(r'[0-9][A-Z0-9]{3}', symbol):
            symbol += '.T'
        if not re.fullmatch(r'[0-9][A-Z0-9]{3}\.T', symbol):
            return jsonify(error='invalid_symbol'), 400
        # A syntactically valid ticker is not proof that a company exists.
        company = catalogue.company(symbol[:-2])
        if company is None:
            return jsonify(error='company_not_found'), 404
        payload = deepcopy(profiles.get(symbol, company['name']))
        states = field_states(payload, PROFILE_FIELDS)
        payload['symbol'], payload['name'] = symbol, company['name']
        payload['identity'] = {
            'market': company.get('market'), 'industry': company.get('industry'),
            'date': company.get('catalogue_as_of'), 'source_url': company.get('source_url'),
            'source_title': '日本取引所グループ（JPX）'}
        payload['editorial'] = deepcopy(reviewed.get(symbol))
        figures = payload.setdefault('data', {})
        if not isinstance(figures, dict):
            figures = payload['data'] = {}
        figures['currency'] = 'JPY'
        # Queue this verified company ahead of the dividend universe, returning
        # saved facts immediately. The existing bounded pool does the work.
        dividend = dividends.lookup(symbol, company['name'])
        dividend_states = field_states(dividend, ('price', 'annual_dividend'))
        states['annual_dividend'] = dividend_states['annual_dividend']
        if not has_figure(figures, 'price') and dividend_states['price'] == 'loading':
            states['price'] = 'loading'
        waiting_dividend = dividend.get('status') == 'loading' and dividend.get('refreshing') is True
        payload['refreshing'] = payload.get('refreshing') is True or waiting_dividend
        if waiting_dividend and payload.get('status') == 'unavailable':
            payload['status'] = 'pending'
        dividend = dividend if any(dividend.get(key) is not None for key in ('price', 'annual_dividend')) else None
        if dividend:
            figures.update(annual_dividend=dividend.get('annual_dividend'),
                           annual_dividend_basis=dividend.get('annual_dividend_basis'),
                           dividend_fetched_at=dividend.get('fetched_at'))
            if figures.get('price') is None and dividend.get('price') is not None:
                figures.update(price=dividend['price'], price_updated_at=dividend.get('price_updated_at'))
                if not isinstance(payload.get('source'), dict):
                    payload['source'] = {}
                payload['source'].setdefault('fields', {})['price'] = {
                    'fetched_at': dividend.get('fetched_at'), 'as_of': dividend.get('price_updated_at')}
        # The ranking scanner already keeps dated closes for almost the whole
        # search catalogue. Reading it must not launch a new provider scan.
        quote = None
        if quotes is not None:
            try:
                now = datetime.now(JST)
                candidate = next((row for row in quotes().get('items', []) if row.get('symbol') == symbol), None)
                if candidate and candidate.get('currency') == 'JPY':
                    price, fetched = candidate.get('price'), candidate.get('fetched_at')
                    trade_day = date.fromisoformat(candidate['trade_date'])
                    if (all(isinstance(value, (int, float)) and not isinstance(value, bool)
                            and math.isfinite(value) and value > 0 for value in (price, fetched))
                            and 0 <= now.timestamp() - fetched < 7 * 86400
                            and 0 <= (now.date() - trade_day).days <= 7):
                        observed = figures.get('price_updated_at')
                        previous_day = (datetime.fromtimestamp(observed, JST).date()
                                        if isinstance(observed, (int, float)) and observed > 0 else None)
                        if figures.get('price') is None or previous_day is not None and trade_day > previous_day:
                            quote = candidate
                            figures.update(price=price, price_updated_at=None, price_trade_date=trade_day.isoformat())
                            if not isinstance(payload.get('source'), dict):
                                payload['source'] = {}
                            payload['source'].setdefault('fields', {})['price'] = {
                                'fetched_at': fetched, 'as_of': trade_day.isoformat()}
            except (KeyError, TypeError, ValueError, OverflowError, OSError):
                pass
        sources = []
        source = payload.get('source')
        if isinstance(source, dict):
            url = source.get('url') or source.get('source_url')
            if isinstance(url, str) and url.startswith('https://'):
                sources.append({'title': source.get('title') or source.get('name') or 'Yahoo Finance',
                                'url': url, 'fetched_at': payload.get('updated_at')})
        if dividend:
            sources.append({'title': '配当実績・株価（Yahoo Finance）',
                            'url': 'https://finance.yahoo.com/quote/' + symbol + '/history/?filter=div',
                            'fetched_at': dividend.get('fetched_at')})
        if quote:
            sources.append({'title': '株価の終値（Yahoo Finance）',
                            'url': 'https://finance.yahoo.com/quote/' + symbol + '/history/',
                            'fetched_at': quote['fetched_at']})
        schedule = payment_schedule(symbol)
        if schedule:
            figures['dividend_payment_period'] = schedule['payment_period']
            if not isinstance(payload.get('source'), dict):
                payload['source'] = {}
            payload['source'].setdefault('fields', {})['dividend_payment_period'] = {
                'fetched_at': schedule['fetched_at'], 'as_of': schedule.get('source_updated_on')}
            sources.append(dict(schedule['source'], fetched_at=schedule['fetched_at']))
            states['dividend_payment_date'] = 'available'
        # A saved valid value remains visible with its own date even if the
        # current fetch failed. Zero is a value only for verified dividend data.
        for field in (*PROFILE_FIELDS, 'annual_dividend'):
            if has_figure(figures, field):
                states[field] = 'available'
            elif states[field] == 'available' and not (field == 'dividend_payment_date' and schedule):
                states[field] = 'unconfirmed'
        payload['field_status'] = states
        payload['sources'] = sources
        response = jsonify(payload)
        response.headers['Cache-Control'] = 'no-store'
        return response
