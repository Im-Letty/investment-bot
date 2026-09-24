"""Three-month dividend calendar from verified schedules, without guessed dates."""
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
import fcntl
import json
import math
import os
from pathlib import Path
import re
import threading
import time
import unicodedata
from urllib.parse import urlsplit

from flask import jsonify, request

JST = timezone(timedelta(hours=9))
ROOT = Path(__file__).parent
HOLIDAY_SOURCE = 'https://www.jpx.co.jp/corporate/about-jpx/calendar/'
SETTLEMENT_SOURCE = 'https://www.jpx.co.jp/equities/clearing-settlement/tplus2-settlement-cycle/'
# JPX cash-equity holidays checked 2026-09-24. Derivatives' holiday trading
# does not make a cash-equity trading day. Unknown years are never guessed.
HOLIDAYS = {
    2026: {'01-01','01-02','01-03','01-12','02-11','02-23','03-20','04-29',
           '05-03','05-04','05-05','05-06','07-20','08-11','09-21','09-22','09-23','10-12','11-03','11-23','12-31'},
    2027: {'01-01','01-02','01-03','01-11','02-11','02-23','03-21','03-22','04-29',
           '05-03','05-04','05-05','07-19','08-11','09-20','09-23','10-11','11-03','11-23','12-31'},
}


def symbol(value):
    if not isinstance(value, str):
        return None
    value = unicodedata.normalize('NFKC', value).strip().upper()
    if re.fullmatch(r'[0-9][0-9A-Z]{3}', value):
        value += '.T'
    return value if re.fullmatch(r'[0-9][0-9A-Z]{3}\.T', value) else None


def iso_day(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def month_range(today):
    start = today.replace(day=1)
    year, month = divmod(start.year * 12 + start.month - 1 + 3, 12)
    return start, date(year, month + 1, 1) - timedelta(days=1)


def previous_trading_day(ex_day):
    day = iso_day(ex_day)
    if day is None or day.year not in HOLIDAYS or day.weekday() >= 5 or day.isoformat()[5:] in HOLIDAYS[day.year]:
        return None
    for _ in range(15):
        day -= timedelta(days=1)
        if day.year not in HOLIDAYS:
            return None
        if day.weekday() < 5 and day.isoformat()[5:] not in HOLIDAYS[day.year]:
            return day.isoformat()
    return None


def _source(value):
    if not isinstance(value, dict) or not isinstance(value.get('title'), str):
        return None
    try:
        url = value.get('url', '')
        parsed = urlsplit(url)
        if not isinstance(url, str) or len(url) > 2000 or parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
            return None
        if any(ord(c) < 33 for c in url):
            return None
        return {'title': value['title'][:200], 'url': url}
    except (ValueError, TypeError):
        return None


def validate_events(rows, today, *, origin='official'):
    clean = []
    if not isinstance(rows, list) or len(rows) > 10000:
        return clean
    for raw in rows:
        if not isinstance(raw, dict):
            continue
        ticker = symbol(raw.get('symbol') or raw.get('code'))
        source = _source(raw.get('source'))
        reviewed = iso_day(raw.get('verified_on'))
        kind, precision = raw.get('kind'), raw.get('precision')
        if not ticker or not source or not reviewed or reviewed > today or kind not in ('holding_deadline','payment','ex_dividend'):
            continue
        if raw.get('status') not in ('confirmed', 'planned'):
            continue
        if precision == 'day':
            event_day = iso_day(raw.get('date'))
            if not event_day or raw.get('period') is not None:
                continue
            when = {'date': event_day.isoformat()}
        elif precision == 'month' and kind == 'payment':
            period = raw.get('period')
            if not isinstance(period, str) or not re.fullmatch(r'\d{4}-(?:0[1-9]|1[0-2])', period) or raw.get('date') is not None:
                continue
            when = {'period': period}
        else:
            continue
        if origin == 'history' and (kind != 'ex_dividend' or precision != 'day' or event_day > today):
            continue
        event = dict(id=f'{ticker}-{kind}-{next(iter(when.values()))}', symbol=ticker, code=ticker[:-2],
                     name=str(raw.get('name') or ticker)[:200], kind=kind, precision=precision,
                     status=raw['status'], source=source, verified_on=reviewed.isoformat(), _origin=origin, **when)
        for field in ('record_date','effective_record_date'):
            if iso_day(raw.get(field)):
                event[field] = raw[field]
        clean.append(event)
    return clean


def with_holding_deadlines(events):
    out = []
    for event in events:
        if event['_origin'] != 'official' or event['kind'] != 'ex_dividend' or event['status'] != 'confirmed':
            out.append(event)
            continue
        deadline = previous_trading_day(event.get('date'))
        if deadline is None:
            out.append(event)
            continue
        row = deepcopy(event)
        row.update(holding_deadline=deadline, ex_dividend_date=event['date'])
        out.append(row)
        row = deepcopy(row)
        row.update(id=f"{event['symbol']}-holding_deadline-{deadline}", kind='holding_deadline', date=deadline,
                   calculation='previous_cash_equity_trading_day', calculation_sources=[
                       {'title':'JPX 現物株式の休業日','url':HOLIDAY_SOURCE},
                       {'title':'JPX 株式の受渡し（T+2）','url':SETTLEMENT_SOURCE}])
        out.append(row)
    return out


def validate_dividend_amounts(document, today):
    """Index separately reviewed, per-distribution amounts; never annual totals."""
    if not isinstance(document, dict) or document.get('schema_version') != 1:
        return None
    rows = document.get('items')
    if not isinstance(rows, list) or len(rows) > 10000:
        return None
    result, duplicates = {}, set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        ticker = symbol(row.get('symbol'))
        record = iso_day(row.get('record_date'))
        announced = iso_day(row.get('announced_on'))
        verified = iso_day(row.get('verified_on'))
        source = _source(row.get('source'))
        amount = row.get('per_share')
        try:
            valid_amount = (isinstance(amount, (int, float)) and not isinstance(amount, bool)
                            and math.isfinite(amount) and amount >= 0)
        except OverflowError:
            valid_amount = False
        if (not ticker or not record or not announced or not verified or not source
                or not announced <= verified <= today or announced > record
                or row.get('currency') != 'JPY' or row.get('status') != 'forecast'
                or not valid_amount):
            continue
        key = (ticker, record.isoformat())
        # Conflicting entries need editorial review; row order must not choose
        # the amount silently. A single current forecast belongs to each period.
        if key in result or key in duplicates:
            result.pop(key, None)
            duplicates.add(key)
            continue
        result[key] = dict(record_date=record.isoformat(), per_share=amount,
                           currency='JPY', status='forecast',
                           announced_on=announced.isoformat(), verified_on=verified.isoformat(), source=source)
    return result


def _read_json(path, max_bytes=4_000_000):
    if not path:
        return None
    try:
        p = Path(path)
        if p.stat().st_size > max_bytes:
            return None
        value = json.loads(p.read_text(encoding='utf-8'))
        return value if isinstance(value, dict) else None
    except (OSError, TypeError, ValueError):
        return None


class DividendCalendar:
    def __init__(self, catalogue, dividends, companies, *, loader=None, universe_loader=None,
                 schedule_path=ROOT/'dividend-calendar-schedules.json',
                 payment_path=ROOT/'company-profile-schedules.json',
                 amount_path=ROOT/'dividend-calendar-amounts.json',
                 universe_path=ROOT/'static'/'nikkei225-universe.json',
                 cache_path=None, universe_cache_path=None, now=time.time, retry=300):
        self.catalogue, self.dividends = catalogue, dividends
        self.companies = dict(companies)
        self.loader, self.universe_loader = loader, universe_loader
        self.schedule_path, self.payment_path, self.universe_path = schedule_path, payment_path, universe_path
        self.amount_path = amount_path
        self.cache_path = Path(cache_path) if cache_path else None
        self.universe_cache_path = Path(universe_cache_path) if universe_cache_path else None
        self.now, self.retry = now, retry
        self._document = None
        self._universe_document = None
        self._dividend_amounts = {}
        self._reset_process()
        self._load_local()
        if hasattr(os, 'register_at_fork'):
            os.register_at_fork(after_in_child=self._reset_process)

    def _reset_process(self):
        self._pid = os.getpid()
        self._lock = threading.RLock()
        self._running = False
        self._failed = False
        self._last_attempt = None
        self._thread = None
        self._files_seen = {}

    def _check_pid(self):
        if self._pid != os.getpid():
            self._reset_process()

    def _today(self):
        return datetime.fromtimestamp(self.now(), JST).date()

    def _checked_today(self, document, ttl=6*3600, after_publication=True):
        if not document:
            return False
        now = self.now()
        current = datetime.fromtimestamp(now,JST)
        def recent(stamp):
            checked = datetime.fromtimestamp(stamp,JST)
            if not 0 <= now-stamp < ttl or checked.date()!=current.date():
                return False
            # JPX publishes the cash-equity schedule on business days at 13:00.
            # A successful morning check cannot suppress the 13:30 recheck.
            if after_publication and (current.hour,current.minute)>=(13,30) and (checked.hour,checked.minute)<(13,0):
                return False
            return True
        stamp = document.get('fetched_at')
        if isinstance(stamp,(int,float)) and not isinstance(stamp,bool) and 0 < stamp <= now:
            return recent(stamp)
        for key in ('checked_at','retrieved_at'):
            try:
                checked = datetime.fromisoformat(document.get(key,'').replace('Z','+00:00'))
                if checked.tzinfo and recent(checked.timestamp()):
                    return True
            except (ValueError,TypeError,AttributeError):
                pass
        return False

    def _accept_document(self, value):
        if not isinstance(value, dict) or not isinstance(value.get('events'), list):
            return False
        today = self._today()
        verified = iso_day(value.get('verified_on'))
        if verified is None or verified > today:
            return False
        events = validate_events(value['events'], today)
        window = value.get('record_window',{})
        first,last = iso_day(window.get('start')),iso_day(window.get('end'))
        origin = _source(value.get('source'))
        authoritative = bool(first and last and first <= last and origin
                             and urlsplit(origin['url']).hostname in ('www.jpx.co.jp','www2.jpx.co.jp'))
        # A genuine empty official window may remove cancelled schedules; a
        # missing/error response without its verified window never clears data.
        if not events and not authoritative:
            return False
        current = iso_day(self._document.get('verified_on')) if self._document else None
        old_stamp = self._document.get('fetched_at',0) if self._document else 0
        new_stamp = value.get('fetched_at',0)
        if current and (verified < current or verified == current and isinstance(old_stamp,(int,float))
                        and isinstance(new_stamp,(int,float)) and new_stamp < old_stamp):
            return False
        retained = []
        start,end = month_range(today)
        for event in self._document.get('events',[]) if self._document else []:
            effective = iso_day(event.get('effective_record_date') or event.get('record_date'))
            from_jpx = urlsplit(event['source']['url']).hostname in ('www.jpx.co.jp','www2.jpx.co.jp')
            if authoritative and from_jpx and effective and first <= effective <= last:
                continue
            when = iso_day(event.get('date')) or iso_day(str(event.get('period'))+'-01')
            if when and start <= when <= end:
                retained.append(event)
        combined = {(row['symbol'],row['kind'],row.get('date',row.get('period'))):row for row in retained+events}
        self._document = dict(value, verified_on=verified.isoformat(), events=list(combined.values()))
        return True

    def _accept_universe(self, value):
        if not isinstance(value, dict) or not isinstance(value.get('items'), list):
            return False
        day = iso_day(value.get('as_of'))
        symbols = [symbol(row.get('symbol') or row.get('code')) for row in value['items'] if isinstance(row,dict)]
        expected = 226 if day == date(2026,9,29) and '646A.T' in symbols else 225
        if day is None or day > self._today() or len(symbols) != expected or None in symbols or len(set(symbols)) != expected:
            return False
        current = iso_day(self._universe_document.get('as_of')) if self._universe_document else None
        if current is None or day >= current:
            self._universe_document = value
            return True
        return False

    def _load_local(self):
        for path,accept in ((self.schedule_path,self._accept_document),(self.cache_path,self._accept_document),
                            (self.universe_path,self._accept_universe),(self.universe_cache_path,self._accept_universe),
                            (self.amount_path,self._accept_amounts)):
            if not path:
                continue
            try:
                stamp = Path(path).stat().st_mtime_ns
                key = str(path)
                if stamp != self._files_seen.get(key):
                    accept(_read_json(path))
                    self._files_seen[key] = stamp
            except OSError:
                pass

    def _accept_amounts(self, value):
        amounts = validate_dividend_amounts(value, self._today())
        if amounts is None:
            return False
        self._dividend_amounts = amounts
        return True

    def _save(self, path, value):
        if not path:
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + '.' + str(os.getpid()) + '.tmp')
        tmp.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False), encoding='utf-8')
        tmp.replace(path)

    def ensure_refresh(self):
        self._check_pid()
        with self._lock:
            self._load_local()
            today = self._today().isoformat()
            source_due = self.loader and not self._checked_today(self._document)
            universe_due = self.universe_loader and not self._checked_today(self._universe_document,86400,False)
            if self._running or not (source_due or universe_due):
                return
            if self._last_attempt is not None and self.now() - self._last_attempt < self.retry:
                return
            self._running = True
            self._last_attempt = self.now()
            self._thread = threading.Thread(target=self._refresh, name='dividend-calendar', daemon=True)
            try:
                self._thread.start()
            except Exception:
                self._running=False
                self._failed=True

    def _refresh(self):
        guard = None
        failed = False
        try:
            if self.cache_path:
                self.cache_path.parent.mkdir(parents=True, exist_ok=True)
                guard = open(str(self.cache_path)+'.lock', 'a')
                try:
                    fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    return
            with self._lock:
                self._load_local()
                today = self._today().isoformat()
                source_due = self.loader and not self._checked_today(self._document)
                universe_due = self.universe_loader and not self._checked_today(self._universe_document,86400,False)
            if source_due:
                try:
                    document = self.loader(datetime.fromtimestamp(self.now(),JST))
                    with self._lock:
                        accepted = self._accept_document(document)
                        saved = deepcopy(self._document)
                    if accepted:
                        self._save(self.cache_path, saved)
                    else:
                        failed = True
                except Exception:
                    failed = True
            if universe_due:
                try:
                    document = self.universe_loader(datetime.fromtimestamp(self.now(),JST))
                    with self._lock:
                        accepted = self._accept_universe(document)
                        saved = deepcopy(self._universe_document)
                    if accepted:
                        self._save(self.universe_cache_path, saved)
                    else:
                        failed = True
                except Exception:
                    failed = True
        finally:
            if guard:
                guard.close()
            with self._lock:
                self._failed = failed
                self._running = False
                self._last_attempt = self.now()

    def _payment_events(self, today):
        document = _read_json(self.payment_path)
        items = document.get('items', {}) if document else {}
        result = []
        if not isinstance(items, dict):
            return result
        for ticker, row in items.items():
            if not isinstance(row, dict):
                continue
            result.append(dict(symbol=ticker, kind='payment', period=row.get('payment_period'),
                               precision='month', status='planned', source=row.get('source'),
                               verified_on=row.get('reviewed_on')))
        return validate_events(result, today)

    def payload(self, month=None, symbols=None, scope='all'):
        self._check_pid()
        today = self._today()
        start, end = month_range(today)
        month = month or start.strftime('%Y-%m')
        if not re.fullmatch(r'\d{4}-(?:0[1-9]|1[0-2])', month) or not start.strftime('%Y-%m') <= month <= end.strftime('%Y-%m'):
            raise ValueError('invalid_month')
        if scope not in ('all', 'favorites'):
            raise ValueError('invalid_scope')
        if symbols is None:
            symbols = ''
        if not isinstance(symbols, str) or len(symbols) > 2000:
            raise ValueError('invalid_symbols')
        requested = set()
        for value in symbols.split(','):
            if not value.strip():
                continue
            normalized = symbol(value)
            if not normalized:
                raise ValueError('invalid_symbols')
            requested.add(normalized)
        known = {row['code']+'.T': row['name'] for row in self.catalogue.all_items()['items']}
        if len(requested) > 100:
            raise ValueError('invalid_symbols')
        invalid_symbols=sorted(requested-set(known))
        requested.intersection_update(known)
        self.ensure_refresh()
        with self._lock:
            document = self._document
            universe = self._universe_document
            amounts = self._dividend_amounts
            refreshing, failed = self._running, self._failed
        # All domestic listed companies are eligible; only verified dates appear.
        selected = requested if scope == 'favorites' else set(known)
        # Adds favorites to the existing bounded provider queue; never performs
        # a synchronous fetch and never extends the ranking's own universe.
        if requested and hasattr(self.dividends, 'request_companies'):
            self.dividends.request_companies({ticker[:-2]:known[ticker] for ticker in requested})
        raw_events=[]
        for event in document['events'] if document else []:
            if event['symbol'] not in selected:
                continue
            when=event.get('date',event.get('period',''))
            deadline=previous_trading_day(event.get('date')) if event['kind']=='ex_dividend' else None
            if when.startswith(month) or deadline and deadline.startswith(month):
                raw_events.append(deepcopy(event))
        events = with_holding_deadlines(raw_events)
        events.extend(self._payment_events(today))
        historical = []
        yields = {}
        for row in self.dividends.payload(refresh=False)['items']:
            if row.get('ticker') not in selected:
                continue
            fetched = row.get('fetched_at')
            if not isinstance(fetched, (int, float)) or isinstance(fetched, bool) or not math.isfinite(fetched) or fetched > self.now():
                continue
            value = row.get('yield_pct')
            if (row.get('annual_dividend_basis') == 'trailing_12m'
                    and isinstance(value, (int, float)) and not isinstance(value, bool)
                    and math.isfinite(value) and value >= 0
                    and 0 <= self.now() - fetched < 30 * 86400):
                yields[row['ticker']] = value
            for day in row.get('ex_dividend_dates', []):
                if not isinstance(day,str) or not day.startswith(month):
                    continue
                historical.append(dict(symbol=row.get('ticker'),name=row.get('name'),date=day,kind='ex_dividend',
                    precision='day',status='confirmed',source={'title':'Yahoo Finance・記録済みの権利落ち日',
                    'url':row.get('source_url') or 'https://finance.yahoo.com/quote/'+str(row.get('ticker'))+'/'},
                    verified_on=datetime.fromtimestamp(fetched,JST).date().isoformat()))
        events.extend(validate_events(historical,today,origin='history'))
        chosen = {}
        for event in events:
            when = event.get('date',event.get('period'))
            if event['symbol'] not in selected or not when.startswith(month):
                continue
            key=(event['symbol'],event['kind'],when)
            previous=chosen.get(key)
            if previous is None or previous['_origin']=='history':
                event['name']=known[event['symbol']]
                chosen[key]=event
        # A precise company payment date takes precedence over its month-only notice.
        precise={(event['symbol'],event['kind'],event['date'][:7]) for event in chosen.values() if event['precision']=='day'}
        result=[]
        for event in chosen.values():
            if event['precision']=='month' and (event['symbol'],event['kind'],event['period']) in precise:
                continue
            if event['_origin']=='official' and event['kind'] in ('holding_deadline','ex_dividend'):
                amount = amounts.get((event['symbol'],event.get('record_date')))
                if amount:
                    event['dividend'] = deepcopy(amount)
            event['yield_pct'] = yields.get(event['symbol'])
            event.pop('_origin',None)
            result.append(event)
        result.sort(key=lambda row:(row.get('date',row.get('period')+'-99' if row.get('period') else ''),row['kind'],row['code']))
        covered={row['symbol'] for row in result}
        stamp=document.get('fetched_at',document.get('updated_at')) if document else None
        if not isinstance(stamp,(int,float)) or isinstance(stamp,bool) or not 0 < stamp <= self.now():
            stamp=None
        stale=not self._checked_today(document) or failed
        return dict(month=month,range={'start':start.isoformat(),'end':end.isoformat()},events=result,
                    coverage={'universe':len(selected),'known':len(covered),'unknown':len(selected-covered)},
                    universe_as_of=universe.get('as_of') if universe else None,
                    updated_at=stamp,verified_on=document.get('verified_on') if document else None,invalid_symbols=invalid_symbols,
                    refreshing=refreshing,status='stale' if stale and document else 'ready' if document else 'loading' if refreshing else 'unavailable')


def register_dividend_calendar(app, calendar):
    @app.before_request
    def ensure_dividend_calendar_worker():
        calendar.ensure_refresh()

    @app.get('/api/dividend/calendar-v2')
    def api_dividend_calendar_v2():
        try:
            payload=calendar.payload(request.args.get('month'),request.args.get('symbols',''),request.args.get('scope','all'))
        except ValueError as error:
            return jsonify(error=str(error)),400
        response=jsonify(payload)
        response.headers['Cache-Control']='no-store'
        return response
