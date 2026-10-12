"""A verified company identity, reviewed explanation and dated provider figures."""
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
import json
import math
from pathlib import Path
import re
import unicodedata

from flask import jsonify, request
from company_business import official_company_overview
from company_forecast_dividends import FIELD as ISSUER_FORECAST
from company_year_per import FIELD as YEAR_PER
from regional_edinet import safe_edinet_diagnostic


EDITORIAL_PATH = Path(__file__).with_name('static') / 'company-profile-editorial.json'
SCHEDULE_PATH = Path(__file__).with_name('company-profile-schedules.json')
JST = timezone(timedelta(hours=9))
PROFILE_FIELDS = ('price', 'market_cap', 'forward_annual_dividend_per_share',
                  'ex_dividend_date', 'dividend_payment_date', 'analyst_target')
FIELD_STATES = {'available', 'loading', 'source_missing', 'fetch_error', 'invalid', 'unconfirmed'}
HISTORICAL_DIVIDEND = 'historical_dividend_per_share'
EDINET_REASONS = {
    'available': 'available', 'pending': 'loading', 'loading': 'loading',
    'provider_waiting': 'loading', 'rate_limited': 'loading',
    'source_missing': 'source_missing', 'fetch_error': 'fetch_error',
    'invalid_source': 'invalid', 'invalid': 'invalid',
    'identity_unconfirmed': 'unconfirmed', 'filing_unconfirmed': 'unconfirmed',
    'filing_invalidated': 'invalid', 'correction_unconfirmed': 'unconfirmed',
    'warm_budget_exhausted': 'unconfirmed',
    'unconfirmed': 'unconfirmed',
}


def edinet_document_url(value, doc_id):
    """No credential-bearing API URL, arbitrary host, query or fragment leaks."""
    expected = 'https://disclosure2dl.edinet-fsa.go.jp/searchdocument/pdf/' + doc_id + '.pdf'
    return value if isinstance(value, str) and value == expected else None


def edinet_coverage(value):
    if not isinstance(value, dict):
        return None
    names = ('window_days', 'indexed_days', 'missing_days')
    if any(not isinstance(value.get(key), int) or isinstance(value[key], bool)
           or not 0 <= value[key] <= 400 for key in names):
        return None
    if not value['window_days'] or value['indexed_days'] + value['missing_days'] != value['window_days']:
        return None
    try:
        if any(not isinstance(value.get(key), str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value[key])
               for key in ('from', 'to')):
            return None
        start, end = (date.fromisoformat(value[key]) for key in ('from', 'to'))
        if ((end - start).days + 1 != value['window_days'] or end > datetime.now(JST).date()
                or not isinstance(value.get('complete'), bool) or value.get('snapshot_guaranteed') is not False
                or value['complete'] != (value['missing_days'] == 0)):
            return None
    except (ValueError, TypeError, KeyError):
        return None
    # Fixed counters only; no filenames, descriptors, raw error or request URLs.
    clean = {key: value[key] for key in (*names, 'from', 'to', 'complete', 'snapshot_guaranteed')}
    if 'stale_days' in value:
        if (not isinstance(value['stale_days'], int) or isinstance(value['stale_days'], bool)
                or not 0 <= value['stale_days'] <= value['indexed_days']):
            return None
        clean['stale_days'] = value['stale_days']
    if value.get('observed_at') is not None:
        if not observed_time(value['observed_at']):
            return None
        clean['observed_at'] = value['observed_at']
    return clean


def edinet_persistence(value, fact):
    """Public fixed observations, without paths, hashes or credential material."""
    if not isinstance(value, dict):
        return None
    enums = {
        'local_status': {'pending', 'saved', 'save_failed'},
        'durable_status': {'disabled', 'pending', 'missing', 'restored', 'invalid',
                           'load_failed', 'saved', 'save_failed'},
        'restore_status': {'disabled', 'pending', 'missing', 'restored', 'invalid', 'load_failed'},
    }
    if any(not isinstance(value.get(key), str) or value[key] not in allowed
           for key, allowed in enums.items()):
        return None
    if value.get('snapshot_guaranteed') is not False or value.get('cross_instance_cas') is not False:
        return None
    for key, limit in (('restored_indexed_days', 400), ('restored_facts', 110)):
        if type(value.get(key)) is not int or not 0 <= value[key] <= limit:
            return None
    for key in ('selected_fact_restored', 'selected_fact_saved'):
        if type(value.get(key)) is not bool:
            return None
    for key in ('restored_at', 'saved_at'):
        if value.get(key) is not None and not observed_time(value[key]):
            return None
    if (value['restore_status'] == 'restored' and not observed_time(value.get('restored_at'))
            or value['durable_status'] == 'saved' and not observed_time(value.get('saved_at'))):
        return None
    clean = {key: value[key] for key in (*enums, 'restored_indexed_days', 'restored_facts',
                                       'selected_fact_restored', 'selected_fact_saved')}
    clean.update(restored_at=value.get('restored_at'), saved_at=value.get('saved_at'),
                 snapshot_guaranteed=False, cross_instance_cas=False)
    errors = {'storage_configuration', 'storage_budget', 'storage_deadline',
              'storage_response', 'storage_network', 'storage_timeout',
              'storage_bucket', 'storage_private_required', 'storage_read',
              'storage_write', 'storage_size', 'checkpoint_wrapper_invalid',
              'checkpoint_encoding_invalid', 'checkpoint_compression_invalid',
              'checkpoint_digest_mismatch', 'checkpoint_schema_invalid',
              'checkpoint_size_limit', 'checkpoint_read_failed', 'checkpoint_save_failed'}
    for key in ('restore_error', 'save_error'):
        if key in value:
            error = value[key]
            if error is not None and (not isinstance(error, str) or error not in errors):
                return None
            clean[key] = error
    # Global index recovery is separate from recovery of this validated value.
    for flag, timestamp_key in (('selected_fact_restored', 'restored_at'),
                                ('selected_fact_saved', 'saved_at')):
        at = clean[timestamp_key]
        if not fact or not observed_time(at) or at < fact['fetched_at']:
            clean[flag] = False
    if clean['restore_status'] != 'restored' or not clean['restored_facts']:
        clean['selected_fact_restored'] = False
    return clean


def filed_dividend_fact(raw, company):
    if not isinstance(raw, dict):
        return None
    xbrl_hash = raw.get('xbrl_body_sha256')
    if xbrl_hash is not None and (not isinstance(xbrl_hash, str)
                                or not re.fullmatch(r'[0-9a-f]{64}', xbrl_hash)):
        return None
    value, doc_id, fetched = (raw.get(key) for key in ('value', 'doc_id', 'fetched_at'))
    if (not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value)
            or not 0 <= value <= 1_000_000_000 or not observed_time(fetched)
            or raw.get('currency') != 'JPY' or raw.get('unit') != 'JPY/share'
            or raw.get('kind') != 'filed_fiscal_period_dividend' or raw.get('split_adjustment') != 'as_reported'
            or not isinstance(doc_id, str) or not re.fullmatch(r'S[A-Z0-9]{7}', doc_id)
            or raw.get('security_code') != company['code'] + '0'
            or not isinstance(raw.get('edinet_code'), str) or not re.fullmatch(r'E[0-9]{5}', raw['edinet_code'])
            or not edinet_document_url(raw.get('source_url'), doc_id)):
        return None
    period, submitted = raw.get('fiscal_period'), raw.get('filing_submitted_at')
    if (not isinstance(period, dict) or not isinstance(submitted, str)
            or not re.fullmatch(r'\d{4}-\d{2}-\d{2} \d{2}:\d{2}', submitted)):
        return None
    try:
        if any(not isinstance(period.get(key), str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', period[key])
               for key in ('start', 'end')):
            return None
        start, end = (date.fromisoformat(period[key]) for key in ('start', 'end'))
        submitted_at = datetime.strptime(submitted, '%Y-%m-%d %H:%M').replace(tzinfo=JST)
        if not (0 <= (end - start).days <= 550 and end <= submitted_at.date()
                and submitted_at.timestamp() <= fetched):
            return None
    except (ValueError, TypeError, KeyError, OverflowError, OSError):
        return None
    clean = dict(value=value, currency='JPY', unit='JPY/share',
                fiscal_period={'start': start.isoformat(), 'end': end.isoformat()},
                filing_submitted_at=submitted, submitted_at=submitted_at.timestamp(), fetched_at=fetched,
                doc_id=doc_id, edinet_code=raw['edinet_code'], security_code=raw['security_code'],
                source_url=raw['source_url'], source_title='EDINET 有価証券報告書',
                kind='filed_fiscal_period_dividend', split_adjustment='as_reported',
                latest_filing_guaranteed=False)
    if xbrl_hash is not None:
        clean['xbrl_body_sha256'] = xbrl_hash
    return clean


def annual_dividend_result(raw, company):
    """A filed fiscal-year figure is independent of trailing/forecast dividends."""
    if not isinstance(raw, dict) or raw.get('configured') is not True or raw.get('status') == 'not_configured':
        return None
    reason = raw.get('status') if raw.get('status') in EDINET_REASONS else 'unconfirmed'
    state = EDINET_REASONS[reason]
    invalidated = raw.get('invalidated') is True or raw.get('status') not in EDINET_REASONS or reason in {
        'filing_invalidated', 'correction_unconfirmed', 'identity_unconfirmed', 'invalid'}
    fact = None if invalidated else filed_dividend_fact(raw.get('dividend_fact'), company)
    data = raw.get('data') if isinstance(raw.get('data'), dict) else {}
    value = data.get(HISTORICAL_DIVIDEND)
    if fact and (isinstance(value, bool) or not isinstance(value, (int, float)) or value != fact['value']):
        fact = None
    if not invalidated and raw.get('dividend_fact') is not None and not fact:
        state = 'invalid'
        invalidated = True
    if fact:
        state = 'available'
    elif state == 'available':
        state = 'unconfirmed'
    return dict(status=state, provider_status=reason, fact=fact, invalidated=invalidated,
                diagnostic=safe_edinet_diagnostic(raw.get('diagnostic')),
                error='fetch_error' if reason == 'fetch_error' else None,
                refreshing=raw.get('refreshing') is True or state == 'loading',
                coverage=edinet_coverage(raw.get('coverage')),
                persistence=edinet_persistence(raw.get('persistence'), fact))


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
            if not isinstance(item, dict) or not re.fullmatch(r'[0-9][A-Z0-9]{3}\.(?:T|JP)', item.get('symbol', '')):
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
                              quote_service=None, businesses=None, annual_dividends=None,
                              public_businesses=None, forecast_dividends=None, reviewed_businesses=None,
                              year_pers=None):
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
        payload['company_overview'] = official_company_overview(symbol, company)
        payload['editorial'] = deepcopy(reviewed.get(symbol))
        public_business = (public_businesses.get(symbol, company)
                           if public_businesses is not None and detail and not payload['editorial'] else None)
        reviewed_business = (reviewed_businesses.get(symbol, company)
                             if reviewed_businesses is not None and detail and not payload['editorial'] else None)
        if reviewed_business:
            payload['business_overview'] = reviewed_business
        elif public_business:
            payload['business_overview'] = public_business
        elif businesses is not None and detail and not payload['editorial']:
            payload['business_overview'] = deepcopy(businesses.get(symbol, company))
            payload['refreshing'] = payload.get('refreshing') is True or (
                isinstance(payload['business_overview'], dict)
                and (payload['business_overview'].get('field_status') == 'loading'
                     or payload['business_overview'].get('refreshing') is True))
        figures = payload.setdefault('data', {})
        if not isinstance(figures, dict):
            figures = payload['data'] = {}
        figures['currency'] = 'JPY'
        # Only the independently verified EDINET service may supply this field.
        figures.pop(HISTORICAL_DIVIDEND, None)
        payload.pop('dividend_fact', None)
        figures.pop(ISSUER_FORECAST, None)
        payload.pop('issuer_dividend_forecast', None)
        figures.pop(YEAR_PER, None)
        payload.pop('year_per', None)
        payload.pop('year_per_status', None)
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
        if annual_dividends is not None and detail and not provider_symbol and symbol.endswith('.JP'):
            try:
                historical = annual_dividend_result(annual_dividends.get(company), company)
            except (ValueError, TypeError, AttributeError, KeyError, OSError):
                historical = None
            if historical is not None:
                states[HISTORICAL_DIVIDEND] = historical['status']
                payload['historical_dividend_status'] = historical['status']
                payload['historical_dividend_coverage'] = historical['coverage']
                payload['historical_dividend_persistence'] = historical['persistence']
                payload['historical_dividend_refreshing'] = historical['refreshing']
                payload['historical_dividend_invalidated'] = historical['invalidated']
                payload['historical_dividend_error'] = historical['error']
                payload['historical_dividend_diagnostic'] = historical['diagnostic']
                payload['dividend_fact'] = historical['fact']
                payload['refreshing'] = payload.get('refreshing') is True or historical['refreshing']
                if historical['fact']:
                    fact = historical['fact']
                    figures[HISTORICAL_DIVIDEND] = fact['value']
                    source_fields(payload)[HISTORICAL_DIVIDEND] = {
                        'fetched_at': fact['fetched_at'], 'as_of': fact['fiscal_period']['end']}
                    sources.append({'title': 'EDINET 有価証券報告書（当サイトが配当額を抜粋）',
                                    'url': fact['source_url'], 'fetched_at': fact['fetched_at']})
        schedule = payment_schedule(symbol)
        if schedule:
            figures['dividend_payment_period'] = schedule['payment_period']
            source_fields(payload)['dividend_payment_period'] = {
                'fetched_at': schedule['fetched_at'], 'as_of': schedule.get('source_updated_on')}
            sources.append(dict(schedule['source'], fetched_at=schedule['fetched_at']))
            states['dividend_payment_date'] = 'available'
        if forecast_dividends is not None:
            forecast = forecast_dividends.get(symbol, company)
            payload['issuer_dividend_forecast_status'] = 'unconfirmed'
            if forecast:
                payload['issuer_dividend_forecast'] = forecast
                payload['issuer_dividend_forecast_status'] = forecast['status']
                states[ISSUER_FORECAST] = 'available' if forecast['status'] == 'available' else 'unconfirmed'
                if forecast['status'] == 'available':
                    figures[ISSUER_FORECAST] = forecast['value']
                source_fields(payload)[ISSUER_FORECAST] = {
                    'fetched_at': forecast['fetched_at'], 'as_of': forecast['announcement_date']}
                sources.append({'title': forecast['source_title'], 'url': forecast['source_url'],
                                'fetched_at': forecast['fetched_at']})
        if year_pers is not None:
            fact = year_pers.get(symbol, company)
            payload['year_per_status'] = fact['status'] if fact else 'unconfirmed'
            payload['year_per'] = fact
            states[YEAR_PER] = 'available' if fact and fact['status'] == 'available' else 'unconfirmed'
            if fact:
                if fact['status'] == 'available':
                    figures[YEAR_PER] = fact['value']
                source_fields(payload)[YEAR_PER] = {
                    'fetched_at': fact['fetched_at'], 'as_of': fact['price_reference_date'],
                    'fiscal_period_end': fact['fiscal_period']['end']}
                sources.append({'title': fact['source_title'], 'url': fact['source_url'],
                                'fetched_at': fact['fetched_at']})
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
