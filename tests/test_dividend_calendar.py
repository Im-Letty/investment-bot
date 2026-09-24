"""Official calendar dates, bounded refreshes and transparent unknown coverage."""
from copy import deepcopy
from datetime import datetime
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch

from flask import Flask
from dividend_calendar import (DividendCalendar, JST, month_range, previous_trading_day,
                               register_dividend_calendar, validate_dividend_amounts)

NOW=datetime(2026,9,24,14,tzinfo=JST).timestamp()


def event(symbol='7203.T',day='2026-09-29',kind='ex_dividend',source='jpx'):
    return dict(symbol=symbol,name='会社',date=day,kind=kind,precision='day',status='confirmed',
                verified_on='2026-09-24',record_date='2026-09-30',effective_record_date='2026-09-30',
                source={'title':'公式日程','url':'https://www.jpx.co.jp/list/20260924.xls' if source=='jpx' else 'https://company.example.jp/ir'})


def document(events=None,now=NOW):
    return dict(version=1,events=[event()] if events is None else events,verified_on='2026-09-24',
                fetched_at=now,record_window={'start':'2026-09-24','end':'2026-10-08'},
                source={'title':'JPX','url':'https://www.jpx.co.jp/list/20260924.xls'})


def dividend_amount(**changes):
    row = dict(symbol='5803.T', record_date='2026-09-30', per_share=19,
               currency='JPY', status='forecast', announced_on='2026-08-07', verified_on='2026-09-24',
               source={'title':'フジクラ 2027年3月期 第1四半期決算短信',
                       'url':'https://ssl4.eir-parts.net/doc/5803/tdnet/2866589/00.pdf'})
    row.update(changes)
    return row


class CalendarTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.path=Path(self.temp.name)
        self.now=NOW
        self.catalogue=Mock()
        self.catalogue.all_items.return_value={'items':[{'code':str(code),'name':'会社'+str(code)} for code in range(1000,1225)]+[
            {'code':'7203','name':'トヨタ'},{'code':'9432','name':'NTT'},{'code':'285A','name':'キオクシア'},
            {'code':'5803','name':'フジクラ'}]}
        self.dividends=Mock();self.dividends.payload.return_value={'items':[]}
        self.seed=self.path/'schedules.json';self.seed.write_text(json.dumps(document()))
        self.universe=self.path/'universe.json';self.universe.write_text(json.dumps(dict(as_of='2026-09-24',retrieved_at=datetime.fromtimestamp(NOW,JST).isoformat(),
            items=[{'code':str(code),'name':'会社'} for code in range(1000,1225)],
            scheduled_changes=[{'effective_on':'2026-10-01','add':[{'code':'285A'}]}])))
        self.payments=self.path/'payments.json';self.payments.write_text(json.dumps({'items':{'9432.T':{
            'payment_period':'2026-11','reviewed_on':'2026-09-24','source':{'title':'NTT','url':'https://group.ntt/jp/ir/shares/calendar/'}}}}))
        self.amounts=self.path/'amounts.json';self.amounts.write_text(json.dumps({'schema_version':1,'items':[dividend_amount()]}))

    def calendar(self,loader=None,**kwargs):
        return DividendCalendar(self.catalogue,self.dividends,{'7203':'トヨタ','9432':'NTT'},loader=loader,
            schedule_path=self.seed,payment_path=self.payments,amount_path=self.amounts,universe_path=self.universe,
            cache_path=self.path/'runtime.json',now=lambda:self.now,**kwargs)

    def test_calendar_carries_existing_snapshot_yield_without_fetching_quotes(self):
        base = dict(ticker='7203.T', fetched_at=NOW, yield_pct=3.2,
                    annual_dividend_basis='trailing_12m')
        calendar = self.calendar()
        for changes, expected in [({}, 3.2), ({'yield_pct':0}, 0),
                ({'yield_pct':None}, None), ({'yield_pct':True}, None),
                ({'yield_pct':-1}, None), ({'yield_pct':float('nan')}, None),
                ({'fetched_at':NOW-31*86400}, None),
                ({'annual_dividend_basis':'unknown'}, None)]:
            with self.subTest(changes=changes):
                self.dividends.payload.return_value={'items':[{**base, **changes}]}
                result=calendar.payload('2026-09')
                self.assertTrue(result['events'])
                self.assertTrue(all(row['yield_pct']==expected for row in result['events']))
                self.dividends.payload.assert_called_with(refresh=False)

    def test_all_scope_includes_verified_companies_outside_nikkei_without_extra_scan(self):
        self.seed.write_text(json.dumps(document([event('5803.T'),event('285A.T')])))
        data=self.calendar().payload('2026-09')
        self.assertEqual({row['symbol'] for row in data['events']},{'5803.T','285A.T'})
        self.assertEqual(data['coverage'],{'universe':229,'known':2,'unknown':227})
        self.dividends.request_companies.assert_not_called()
        self.assertEqual(self.calendar().payload('2026-09','5803','favorites')['coverage']['universe'],1)

    def test_official_exdate_and_real_businessday_deadline(self):
        data=self.calendar().payload('2026-09')
        by_kind={row['kind']:row for row in data['events']}
        self.assertEqual(by_kind['holding_deadline']['date'],'2026-09-28')
        self.assertEqual(by_kind['ex_dividend']['date'],'2026-09-29')
        for row in by_kind.values():
            self.assertEqual(row['holding_deadline'],'2026-09-28')
            self.assertEqual(row['ex_dividend_date'],'2026-09-29')
        self.assertEqual(by_kind['holding_deadline']['calculation'],'previous_cash_equity_trading_day')
        self.assertEqual(len(by_kind['holding_deadline']['calculation_sources']),2)
        self.assertEqual(data['range'],{'start':'2026-09-01','end':'2027-09-30'})
        self.assertEqual(data['coverage'],{'universe':229,'known':1,'unknown':228})
        self.assertEqual(data['universe_as_of'],'2026-09-24')
        self.assertNotIn('_origin',by_kind['ex_dividend'])

    def test_holidays_weekends_and_unverified_calendar_year(self):
        self.assertEqual(previous_trading_day('2026-09-24'),'2026-09-18')
        self.assertEqual(previous_trading_day('2027-01-04'),'2026-12-30')
        self.assertIsNone(previous_trading_day('2026-09-23'))
        self.assertIsNone(previous_trading_day('2028-01-05'))
        self.assertIsNone(previous_trading_day('2026-01-05')) # 2025 calendar not verified here.

    def test_scope_filters_before_deriving_but_keeps_deadline_in_previous_month(self):
        self.seed.write_text(json.dumps(document([event('7203.T','2026-10-01'),event('9432.T','2026-10-01')])))
        calendar=self.calendar()
        with patch('dividend_calendar.previous_trading_day',wraps=previous_trading_day) as previous:
            data=calendar.payload('2026-09','7203','favorites')
        self.assertEqual([(row['symbol'],row['kind'],row['date']) for row in data['events']],
                         [('7203.T','holding_deadline','2026-09-30')])
        self.assertEqual(data['events'][0]['holding_deadline'],'2026-09-30')
        self.assertEqual(data['events'][0]['ex_dividend_date'],'2026-10-01')
        # Only the selected company is considered, once for selection and once
        # to construct the complete derived event with its provenance.
        self.assertEqual(previous.call_count,2)

    def test_month_precision_is_retained_never_assigned_a_guessed_day(self):
        calendar=self.calendar();data=calendar.payload('2026-11')
        payment=data['events'][0]
        self.assertEqual(payment['kind'],'payment');self.assertEqual(payment['period'],'2026-11')
        self.assertEqual(payment['precision'],'month');self.assertNotIn('date',payment)
        self.assertEqual(payment['status'],'planned')
        self.assertEqual(calendar.payload('2026-10')['events'],[])

    def test_favorites_are_verified_filtered_and_queued_without_losing_valid_ones(self):
        calendar=self.calendar()
        favorite=calendar.payload('2026-09','７２０３,９４３７,２８５ａ','favorites')
        self.assertEqual(favorite['invalid_symbols'],['9437.T'])
        self.assertEqual(favorite['coverage'],{'universe':2,'known':1,'unknown':1})
        self.assertEqual({row['symbol'] for row in favorite['events']},{'7203.T'})
        self.dividends.request_companies.assert_called_once_with({'7203':'トヨタ','285A':'キオクシア'})
        self.assertEqual(calendar.payload('2026-09','','favorites')['coverage'],{'universe':0,'known':0,'unknown':0})
        self.assertEqual(calendar.payload('2026-09','285A','all')['coverage']['universe'],229)
        for value in ['http://evil','7203.T/../x']:
            with self.assertRaises(ValueError):calendar.payload('2026-09',value)

    def test_only_past_historical_exdates_no_forward_year_rollover(self):
        self.dividends.payload.return_value={'items':[{'ticker':'7203.T','name':'トヨタ','fetched_at':NOW,
            'ex_dividend_dates':['2025-11-29','2026-09-17','2026-10-29']} ]}
        calendar=self.calendar();data=calendar.payload('2026-09')
        historical=next(row for row in data['events'] if row.get('date')=='2026-09-17')
        self.assertEqual(historical['kind'],'ex_dividend')
        self.assertNotIn('holding_deadline',historical)
        self.assertNotIn('ex_dividend_date',historical)
        self.assertFalse(any(row['kind']=='holding_deadline' and row['date']=='2026-09-16' for row in data['events']))
        self.assertEqual(calendar.payload('2026-10')['events'],[])
        self.assertFalse(any(row.get('date')=='2026-11-29' for row in calendar.payload('2026-11')['events']))

    def test_confirmed_window_replaces_cancellations_preserves_company_schedules(self):
        custom=event('9432.T','2026-11-30','payment',source='company')
        earlier=event('7203.T','2026-09-17');earlier.update(record_date='2026-09-18',effective_record_date='2026-09-18')
        self.seed.write_text(json.dumps(document([event(),custom,earlier])))
        calendar=self.calendar();self.now+=60
        empty=document([],self.now)
        self.assertTrue(calendar._accept_document(empty))
        dates={row.get('date') for row in calendar.payload('2026-09')['events']}
        self.assertNotIn('2026-09-29',dates);self.assertIn('2026-09-17',dates)
        payment=calendar.payload('2026-11')['events']
        self.assertEqual(len(payment),1);self.assertEqual(payment[0]['date'],'2026-11-30')
        self.assertFalse(calendar._accept_document({'events':[]}))

    def test_background_singleflight_stale_preserved_on_failure_and_fork_reset(self):
        release=threading.Event();entered=threading.Event()
        def load(now):entered.set();release.wait(2);raise RuntimeError('private failure')
        self.now+=86400
        calendar=self.calendar(load)
        start=time.monotonic();first=calendar.payload('2026-09')
        self.assertLess(time.monotonic()-start,.1);self.assertTrue(first['refreshing'])
        self.assertTrue(entered.wait(1));thread=calendar._thread
        for _ in range(5):calendar.payload('2026-09')
        self.assertIs(thread,calendar._thread)
        release.set();thread.join(2)
        stale=calendar.payload('2026-09')
        self.assertEqual(stale['status'],'stale');self.assertEqual(stale['updated_at'],NOW)
        self.assertFalse(stale['refreshing']);self.assertTrue(stale['events'])
        old=calendar._lock;old.acquire()
        with patch('dividend_calendar.os.getpid',return_value=calendar._pid+1):
            calendar.loader=None;value=calendar.payload('2026-09')
        old.release();self.assertIsNot(old,calendar._lock);self.assertFalse(value['refreshing'])

    def test_afternoon_rechecks_morning_and_weekend_does_not_repeat_old_publication(self):
        calendar=self.calendar()
        morning=document(now=datetime(2026,9,24,11,tzinfo=JST).timestamp())
        self.now=datetime(2026,9,24,13,29,tzinfo=JST).timestamp();self.assertTrue(calendar._checked_today(morning))
        self.now+=60;self.assertFalse(calendar._checked_today(morning))
        morning['fetched_at']=self.now;self.assertTrue(calendar._checked_today(morning))
        self.now=datetime(2026,9,26,15,tzinfo=JST).timestamp();old_publication=document(now=self.now)
        self.assertTrue(calendar._checked_today(old_publication))

    def test_unchanged_files_are_not_reparsed_on_each_request(self):
        calendar=self.calendar()
        with patch('dividend_calendar._read_json',wraps=__import__('dividend_calendar')._read_json) as read:
            calendar.ensure_refresh();calendar.ensure_refresh()
        read.assert_not_called()

    def test_one_year_boundary_and_flask_contract(self):
        calendar=self.calendar();app=Flask(__name__);register_dividend_calendar(app,calendar);client=app.test_client()
        response=client.get('/api/dividend/calendar-v2?month=2026-11&scope=favorites&symbols=9432.T')
        self.assertEqual(response.status_code,200);self.assertEqual(response.get_json()['events'][0]['period'],'2026-11')
        self.assertEqual(response.headers['Cache-Control'],'no-store')
        self.assertEqual(client.get('/api/dividend/calendar-v2?month=2027-10').status_code,400)
        self.assertEqual(client.get('/api/dividend/calendar-v2?month=2026-08').status_code,400)
        self.assertEqual(client.get('/api/dividend/calendar-v2?scope=evil').status_code,400)
        self.assertEqual(client.get('/api/dividend/calendar-v2?month=2027-09').status_code,200)
        first,last=month_range(datetime(2026,12,24).date())
        self.assertEqual(first.isoformat(),'2026-12-01');self.assertEqual(last.isoformat(),'2027-12-31')

    def test_next_year_announced_payment_is_visible_without_repeating_this_year(self):
        self.payments.write_text(json.dumps({'items':{'9432.T':{
            'payment_period':'2027-09','reviewed_on':'2026-09-24',
            'source':{'title':'Company announcement','url':'https://group.ntt/jp/ir/shares/calendar/'}}}}))
        calendar=self.calendar()
        rows=calendar.payload('2027-09')['events']
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]['kind'],'payment')
        self.assertEqual(rows[0]['period'],'2027-09')
        self.assertEqual(calendar.payload('2027-08')['events'],[])
        self.now=datetime(2026,10,1,tzinfo=JST).timestamp()
        self.assertEqual(calendar.payload('2027-10')['range']['end'],'2027-10-31')

    def test_reviewed_current_distribution_is_attached_to_both_official_dates(self):
        self.seed.write_text(json.dumps(document([event('5803.T')])))
        calendar=self.calendar()
        data=calendar.payload('2026-09','5803','favorites')
        expected=dividend_amount();expected.pop('symbol')
        self.assertEqual(len(data['events']),2)
        self.assertEqual({row['kind'] for row in data['events']},{'holding_deadline','ex_dividend'})
        for row in data['events']:
            self.assertEqual(row['dividend'],expected)
            self.assertEqual(row['record_date'],row['dividend']['record_date'])
        # Consumer mutation must not change a subsequent API response.
        data['events'][0]['dividend']['per_share']=999
        self.assertTrue(all(row['dividend']['per_share']==19 for row in calendar.payload('2026-09','5803','favorites')['events']))
        app=Flask(__name__);register_dividend_calendar(app,calendar)
        response=app.test_client().get('/api/dividend/calendar-v2?month=2026-09&scope=favorites&symbols=5803')
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.get_json()['events'][0]['dividend'],expected)

    def test_amount_requires_exact_company_and_record_date_and_not_payment_or_history(self):
        rows=[event(),event('5803.T','2026-09-28','payment')]
        for record in ('2025-09-30','2026-10-30',None):
            with self.subTest(record_date=record):
                wrong=event('5803.T');wrong['record_date']=record
                # Provider-injected amounts are not trusted schedule fields.
                wrong['dividend']=dict(per_share=888)
                self.seed.write_text(json.dumps(document(rows+[wrong])))
                data=self.calendar().payload('2026-09','7203,5803','favorites')
                self.assertTrue(data['events'])
                self.assertTrue(all('dividend' not in row for row in data['events']))
        self.seed.write_text(json.dumps(document([])))
        self.dividends.payload.return_value={'items':[{'ticker':'5803.T','name':'フジクラ','fetched_at':NOW,
            'annual_dividend':999,'annual_dividend_per_share':999,'ex_dividend_dates':['2026-09-17']}]}
        history=self.calendar().payload('2026-09','5803','favorites')['events']
        self.assertEqual(len(history),1)
        self.assertNotIn('dividend',history[0])
        self.assertNotIn('holding_deadline',history[0])

    def test_official_refresh_does_not_overwrite_reviewed_amount_file(self):
        self.seed.write_text(json.dumps(document([event('5803.T')])))
        calendar=self.calendar();original=self.amounts.read_bytes()
        self.now+=86400
        refreshed=document([event('5803.T')],self.now);refreshed['verified_on']='2026-09-25'
        self.assertTrue(calendar._accept_document(refreshed))
        calendar._save(calendar.cache_path,calendar._document)
        data=calendar.payload('2026-09','5803','favorites')
        self.assertEqual([row['dividend']['per_share'] for row in data['events']],[19,19])
        self.assertEqual(self.amounts.read_bytes(),original)
        self.assertTrue(all('dividend' not in row for row in json.loads(calendar.cache_path.read_text())['events']))

    def test_forecast_validation_rejects_ambiguous_or_invalid_values_without_guessing(self):
        today=datetime.fromtimestamp(NOW,JST).date()
        invalid=[{'per_share':value} for value in (None,True,-1,float('nan'),float('inf'),'19',10**400)]
        invalid += [{'currency':'USD'},{'status':'paid'},{'record_date':'2026-02-30'},
                    {'verified_on':'2026-09-25'},{'announced_on':'2026-09-25'},
                    {'announced_on':'2026-08-07','verified_on':'2026-08-06'},
                    {'source':{'title':'untrusted','url':'http://example.com/file.pdf'}}]
        for changes in invalid:
            with self.subTest(changes=changes):
                self.assertEqual(validate_dividend_amounts({'schema_version':1,'items':[dividend_amount(**changes)]},today),{})
        duplicate={'schema_version':1,'items':[dividend_amount(),dividend_amount(per_share=20)]}
        self.assertEqual(validate_dividend_amounts(duplicate,today),{})
        zero=validate_dividend_amounts({'schema_version':1,'items':[dividend_amount(per_share=0)]},today)
        self.assertEqual(zero[('5803.T','2026-09-30')]['per_share'],0)

    def test_optional_amount_file_missing_or_malformed_leaves_calendar_available(self):
        self.seed.write_text(json.dumps(document([event('5803.T')])))
        self.amounts.unlink()
        data=self.calendar().payload('2026-09','5803','favorites')
        self.assertEqual(len(data['events']),2)
        self.assertTrue(all('dividend' not in row for row in data['events']))
        self.amounts.write_text('{broken')
        self.assertTrue(all('dividend' not in row for row in self.calendar().payload('2026-09','5803','favorites')['events']))

    def test_committed_distribution_file_contains_reviewed_interim_forecasts(self):
        path=Path(__file__).resolve().parents[1]/'dividend-calendar-amounts.json'
        data=json.loads(path.read_text())
        indexed=validate_dividend_amounts(data,datetime.fromtimestamp(NOW,JST).date())
        expected={'5803.T':(19,'2026-08-07'),'9432.T':(2.7,'2026-08-06'),'7203.T':(50,'2026-08-04')}
        for ticker,(amount,announced) in expected.items():
            with self.subTest(symbol=ticker):
                row=indexed[(ticker,'2026-09-30')]
                self.assertEqual(row['per_share'],amount)
                self.assertEqual(row['announced_on'],announced)
                self.assertEqual(row['status'],'forecast')


if __name__=='__main__':unittest.main()
