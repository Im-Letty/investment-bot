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


def observed_time(value):
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value) and 0 < value <= datetime.now(JST).timestamp())


def source_fields(payload):
    if not isinstance(payload.get('source'), dict):
        payload['source'] = {}
    if not isinstance(payload['source'].get('fields'), dict):
        payload['source']['fields'] = {}
    return payload['source']['fields']


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


def register_company_profiles(app, profiles, catalogue, dividends, editorial=None, *, quotes=None,
                              quote_service=None, businesses=None):
    reviewed = read_editorial() if editorial is None else editorial

    @app.get('/api/company-profile')
    def api_company_profile():
        symbol = unicodedata.normalize('NFKC', request.args.get('symbol', '')).strip().upper()
        if not re.fullmatch(r'[0-9][A-Z0-9]{3}(?:\.(?:T|JP))?', symbol):
            return jsonify(error='invalid_symbol'), 400
        # A syntactically valid ticker is not proof that a company exists.
        code = symbol.split('.')[0]
        company = catalogue.company(code)
        if company is None:
            return jsonify(error='company_not_found'), 404
        canonical = company.get('symbol') or code + '.T'
        if '.' in symbol and symbol != canonical:
            return jsonify(error='symbol_market_mismatch'), 400
        symbol = canonical
        provider_symbol = company.get('provider_symbol', symbol if symbol.endswith('.T') else None)
        detail = request.args.get('purpose', 'detail') != 'preview'
        # A regional-only company is a real company, but .JP is our identity
        # key, never a guessed Yahoo ticker. Do not fetch a different market.
        payload = (deepcopy(profiles.get(provider_symbol, company['name'])) if provider_symbol else
                   dict(status='ready', refreshing=False, updated_at=None,
                        data={'currency': 'JPY'}, field_status={key: 'unconfirmed' for key in PROFILE_FIELDS}))
        states = field_states(payload, PROFILE_FIELDS)
        payload['symbol'], payload['name'] = symbol, company['name']
        payload['quote_refresh_enabled'] = quote_service is not None and provider_symbol is not None
        payload['identity'] = {
            'market': company.get('market'), 'industry': company.get('industry'),
            'date': company.get('catalogue_as_of'), 'source_url': company.get('source_url'),
            'source_title': company.get('source_title') or '日本取引所グループ（JPX）',
            'exchange': company.get('exchange', 'Tokyo'), 'provider_symbol': provider_symbol,
            'listings': deepcopy(company.get('other_listings', company.get('listings', [])))}
        payload['editorial'] = deepcopy(reviewed.get(symbol))
        if businesses is not None and detail and not payload['editorial']:
            payload['business_overview'] = deepcopy(businesses.get(symbol, company))
            payload['refreshing'] = payload.get('refreshing') is True or (
                isinstance(payload['business_overview'], dict)
                and (payload['business_overview'].get('field_status') == 'loading'
                     or payload['business_overview'].get('refreshing') is True))
        figures = payload.setdefault('data', {})
        if not isinstance(figures, dict):
            figures = payload['data'] = {}
        figures['currency'] = 'JPY'
        # Queue this verified company ahead of the dividend universe, returning
        # saved facts immediately. The existing bounded pool does the work.
        dividend = dividends.lookup(provider_symbol, company['name']) if provider_symbol else {}
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
                source_fields(payload)['price'] = {
                    'fetched_at': dividend.get('fetched_at'), 'as_of': dividend.get('price_updated_at')}
        # The ranking scanner already keeps dated closes for almost the whole
        # search catalogue. Reading it must not launch a new provider scan.
        quote = None
        if quotes is not None and provider_symbol:
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
                            source_fields(payload)['price'] = {
                                'fetched_at': fetched, 'as_of': trade_day.isoformat()}
            except (KeyError, TypeError, ValueError, OverflowError, OSError):
                pass
        selected_quote = None
        if quote_service is not None and detail and provider_symbol:
            selected_quote = quote_service.get(provider_symbol, company['name'])
            selected_quote = selected_quote if isinstance(selected_quote, dict) else {}
            qdata = selected_quote.get('data')
            qdata = qdata if isinstance(qdata, dict) else {}
            qsource = selected_quote.get('source')
            qsource = qsource if isinstance(qsource, dict) else {}
            qfields = qsource.get('fields')
            qfields = qfields if isinstance(qfields, dict) else {}
            price_at = qdata.get('price_updated_at')
            previous_at = figures.get('price_updated_at')
            valid_time = observed_time(price_at)
            old_trade_day = figures.get('price_trade_date')
            same_quote = (selected_quote.get('symbol') == provider_symbol
                          and qsource.get('name') == 'Yahoo Finance' and qdata.get('currency') == 'JPY')
            later = (not has_figure(figures, 'price') or not observed_time(previous_at)
                     or valid_time and price_at >= previous_at)
            if valid_time and isinstance(old_trade_day, str):
                later = datetime.fromtimestamp(price_at, JST).date().isoformat() >= old_trade_day
            if (same_quote and valid_time and later
                    and has_figure(qdata, 'price')):
                figures.update(price=qdata['price'], price_updated_at=price_at)
                figures.pop('price_trade_date', None)
                price_meta = qfields.get('price')
                source_fields(payload)['price'] = deepcopy(price_meta if isinstance(price_meta, dict) else {})
            if same_quote and has_figure(qdata, 'market_cap'):
                old_meta = source_fields(payload).get('market_cap', {})
                new_meta = qfields.get('market_cap', {})
                old_meta = old_meta if isinstance(old_meta, dict) else {}
                new_meta = new_meta if isinstance(new_meta, dict) else {}
                previous_fetch = old_meta.get('fetched_at') if observed_time(old_meta.get('fetched_at')) else 0
                if (observed_time(new_meta.get('fetched_at')) and
                        (not has_figure(figures, 'market_cap') or new_meta['fetched_at'] >= previous_fetch)):
                    figures['market_cap'] = qdata['market_cap']
                    source_fields(payload)['market_cap'] = deepcopy(new_meta)
            payload['refreshing'] = payload.get('refreshing') is True or selected_quote.get('refreshing') is True
            payload['quote_refreshing'] = selected_quote.get('refreshing') is True
            if selected_quote.get('status') in ('ready', 'pending', 'stale', 'unavailable', 'error'):
                payload['quote_status'] = selected_quote['status']
            if isinstance(selected_quote.get('retry_after_seconds'), (int, float)):
                payload['retry_after_seconds'] = selected_quote['retry_after_seconds']
            qstates = field_states(selected_quote, ('price', 'market_cap'))
            if qstates['price'] in ('fetch_error', 'invalid', 'unconfirmed'):
                payload['quote_error'] = qstates['price']
            for field in ('price', 'market_cap'):
                if not has_figure(figures, field):
                    states[field] = qstates[field]
            if has_figure(figures, 'price') and payload.get('status') == 'unavailable':
                payload['status'] = 'pending' if payload['refreshing'] else 'ready'
        price_at = figures.get('price_updated_at')
        if not provider_symbol:
            payload['market_data'] = {'kind': 'unsupported', 'delay_minutes': None,
                                      'quote_as_of': None, 'quote_is_recent': False}
        elif observed_time(price_at):
            age = max(0, datetime.now(JST).timestamp() - price_at)
            payload['market_data'] = {'kind': 'delayed', 'delay_minutes': 20, 'quote_as_of': price_at,
                                      'quote_age_seconds': age, 'quote_is_recent': age <= 30 * 60}
        elif figures.get('price_trade_date'):
            payload['market_data'] = {'kind': 'end_of_day', 'delay_minutes': None,
                                      'quote_as_of': None, 'quote_is_recent': False}
        else:
            payload['market_data'] = {'kind': 'delayed', 'delay_minutes': 20,
                                      'quote_as_of': None, 'quote_is_recent': False}
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
        if selected_quote and isinstance(selected_quote.get('source'), dict):
            sources.append({'title': '検索時の株価（Yahoo Finance・20分遅延）',
                            'url': 'https://finance.yahoo.com/quote/' + provider_symbol + '/',
                            'fetched_at': selected_quote.get('updated_at')})
        schedule = payment_schedule(symbol)
        if schedule:
            figures['dividend_payment_period'] = schedule['payment_period']
            source_fields(payload)['dividend_payment_period'] = {
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
