"""A verified company identity, reviewed explanation and dated provider figures."""
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
import json
from pathlib import Path
import re
import unicodedata

from flask import jsonify, request


EDITORIAL_PATH = Path(__file__).with_name('static') / 'company-profile-editorial.json'
SCHEDULE_PATH = Path(__file__).with_name('company-profile-schedules.json')
JST = timezone(timedelta(hours=9))


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


def register_company_profiles(app, profiles, catalogue, dividends, editorial=None):
    reviewed = read_editorial() if editorial is None else editorial

    @app.get('/api/company-profile')
    def api_company_profile():
        symbol = unicodedata.normalize('NFKC', request.args.get('symbol', '')).strip().upper()
        if re.fullmatch(r'[0-9][A-Z0-9]{3}', symbol):
            symbol += '.T'
        if not re.fullmatch(r'[0-9][A-Z0-9]{3}\.T', symbol):
            return jsonify(error='invalid_symbol'), 400
        # A syntactically valid ticker is not proof that a company exists.
        company = next((row for row in catalogue.all_items()['items'] if row['code'] == symbol[:-2]), None)
        if company is None:
            return jsonify(error='company_not_found'), 404
        payload = deepcopy(profiles.get(symbol, company['name']))
        payload['symbol'], payload['name'] = symbol, company['name']
        payload['editorial'] = deepcopy(reviewed.get(symbol))
        figures = payload.setdefault('data', {})
        if not isinstance(figures, dict):
            figures = payload['data'] = {}
        figures['currency'] = 'JPY'
        # Read the existing snapshot only. Opening a profile must not wait for
        # the dividend universe or start a second market-data scan.
        dividend = next((row for row in dividends.payload(refresh=False)['items']
                         if row['ticker'] == symbol), None)
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
        schedule = payment_schedule(symbol)
        if schedule:
            figures['dividend_payment_period'] = schedule['payment_period']
            if not isinstance(payload.get('source'), dict):
                payload['source'] = {}
            payload['source'].setdefault('fields', {})['dividend_payment_period'] = {
                'fetched_at': schedule['fetched_at'], 'as_of': schedule.get('source_updated_on')}
            sources.append(dict(schedule['source'], fetched_at=schedule['fetched_at']))
        payload['sources'] = sources
        response = jsonify(payload)
        response.headers['Cache-Control'] = 'no-store'
        return response
