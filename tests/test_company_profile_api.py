"""Public company cards use verified identities and keep actual/forecast data apart."""
from copy import deepcopy
import unittest
from unittest.mock import Mock
import json
from pathlib import Path
import tempfile

from flask import Flask
from company_profile_api import register_company_profiles, read_editorial, payment_schedule
from datetime import date
from datetime import datetime, timedelta, timezone


class ProfileRoutes(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.catalogue = Mock()
        self.company = {'code': '7203', 'name': 'トヨタ自動車', 'market': 'プライム（内国株式）',
                        'industry': '輸送用機器', 'catalogue_as_of': '2026-09-30',
                        'source_url': 'https://www.jpx.co.jp/markets/statistics-equities/misc/01.html'}
        self.catalogue.company.side_effect = lambda code: deepcopy(self.company) if code == '7203' else None
        self.profiles = Mock()
        self.raw = {'symbol': '7203.T', 'name': 'provider name', 'status': 'pending', 'refreshing': True,
                    'updated_at': None, 'data': {'forward_annual_dividend_per_share': 100}}
        self.profiles.get.side_effect = lambda *_: deepcopy(self.raw)
        self.dividends = Mock()
        self.dividends.lookup.return_value = {'ticker': '7203.T', 'price': 3000,
            'price_updated_at': 1000, 'annual_dividend': 95, 'annual_dividend_basis': 'trailing_12m',
            'fetched_at': 1100}
        self.quotes = Mock(return_value={'items': []})
        self.story = {'business': '車をつくる会社です。', 'life': '移動を支えます。',
                      'watch': 'どんな車が売れるかに注目です。', 'reviewed_on': '2026-09-24',
                      'sources': [{'title': '会社情報', 'url': 'https://global.toyota/jp/company/'}]}
        register_company_profiles(self.app, self.profiles, self.catalogue, self.dividends,
                                  {'7203.T': self.story}, quotes=self.quotes)
        self.client = self.app.test_client()

    def test_invalid_and_unknown_companies_cannot_trigger_provider_requests(self):
        for symbol, status in [('https://example.org', 400), ('../7203.T', 400), ('AAPL', 400), ('9999.T', 404)]:
            self.assertEqual(self.client.get('/api/company-profile', query_string={'symbol': symbol}).status_code, status)
        self.profiles.get.assert_not_called()
        self.dividends.lookup.assert_not_called()
        self.quotes.assert_not_called()

    def test_first_open_has_reviewed_text_and_saved_prices_during_background_fetch(self):
        response = self.client.get('/api/company-profile?symbol=7203')
        body = response.get_json()
        self.assertEqual(body['name'], 'トヨタ自動車')
        self.assertEqual(body['status'], 'pending')
        self.assertEqual(body['editorial'], self.story)
        self.assertEqual(body['data']['price'], 3000)
        self.assertEqual(body['data']['price_updated_at'], 1000)
        self.assertEqual(body['data']['annual_dividend'], 95)
        self.assertEqual(body['source']['fields']['price']['fetched_at'], 1100)
        self.assertEqual(body['data']['forward_annual_dividend_per_share'], 100)
        self.assertIsNone(body['updated_at'])
        self.dividends.lookup.assert_called_once_with('7203.T', 'トヨタ自動車')
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertNotIn('annual_dividend', self.raw['data'])

    def test_provider_price_keeps_its_own_time_and_sources_survive(self):
        self.raw.update(status='ready', refreshing=False, updated_at=1300,
                        source={'name': 'Yahoo Finance', 'url': 'https://finance.yahoo.com/quote/7203.T/'})
        self.raw['data'].update(price=3100, price_updated_at=1250)
        body = self.client.get('/api/company-profile?symbol=7203.T').get_json()
        self.assertEqual(body['data']['price'], 3100)
        self.assertEqual(body['data']['price_updated_at'], 1250)
        self.assertEqual(body['data']['dividend_fetched_at'], 1100)
        self.assertEqual(len(body['sources']), 2)

    def test_separate_sources_keep_each_missing_reason_during_a_dividend_fetch(self):
        self.raw.update(status='ready', refreshing=False, data={'currency': 'JPY'},
                        field_status={'market_cap': 'source_missing',
                                      'analyst_target': 'invalid', 'price': 'source_missing',
                                      'dividend_payment_date': 'source_missing'})
        self.dividends.lookup.return_value = {'status': 'loading', 'refreshing': True,
                                             'field_status': {'price': 'loading', 'annual_dividend': 'loading'}}
        body = self.client.get('/api/company-profile?symbol=7203').get_json()
        self.assertTrue(body['refreshing'])
        self.assertEqual(body['field_status']['market_cap'], 'source_missing')
        self.assertEqual(body['field_status']['analyst_target'], 'invalid')
        self.assertEqual(body['field_status']['annual_dividend'], 'loading')
        self.assertEqual(body['field_status']['price'], 'loading')
        self.assertEqual(body['field_status']['dividend_payment_date'], 'source_missing')

    def test_saved_numbers_override_fetch_failure_without_changing_dates(self):
        self.raw.update(status='stale', refreshing=False, data={'price': 3100, 'price_updated_at': 1250},
                        field_status={field: 'fetch_error' for field in ('price', 'market_cap', 'analyst_target')})
        self.dividends.lookup.return_value.update(field_status={'price': 'fetch_error', 'annual_dividend': 'fetch_error'})
        body = self.client.get('/api/company-profile?symbol=7203').get_json()
        self.assertEqual(body['field_status']['price'], 'available')
        self.assertEqual(body['field_status']['annual_dividend'], 'available')
        self.assertEqual(body['field_status']['market_cap'], 'fetch_error')
        self.assertEqual(body['data']['price_updated_at'], 1250)
        self.assertEqual(body['data']['dividend_fetched_at'], 1100)

    def test_verified_zero_dividend_is_available_but_split_review_is_not_zero(self):
        self.dividends.lookup.return_value.update(annual_dividend=0, field_status={'annual_dividend': 'available'})
        body = self.client.get('/api/company-profile?symbol=7203').get_json()
        self.assertEqual(body['data']['annual_dividend'], 0)
        self.assertEqual(body['field_status']['annual_dividend'], 'available')
        self.dividends.lookup.return_value.update(annual_dividend=None, calculation_status='split_review',
                                                 field_status={'annual_dividend': 'invalid'})
        body = self.client.get('/api/company-profile?symbol=7203').get_json()
        self.assertIsNone(body['data']['annual_dividend'])
        self.assertEqual(body['field_status']['annual_dividend'], 'invalid')

    def test_legacy_or_untrusted_status_cannot_claim_company_has_not_announced(self):
        self.raw.update(status='ready', refreshing=False, data=None,
                        field_status={'analyst_target': 'unpublished', 'market_cap': 'available'})
        self.dividends.lookup.return_value = {'status': 'unavailable', 'field_status': {'annual_dividend': 'unpublished'}}
        body = self.client.get('/api/company-profile?symbol=7203').get_json()
        self.assertEqual(body['field_status']['analyst_target'], 'unconfirmed')
        self.assertEqual(body['field_status']['market_cap'], 'unconfirmed')
        self.assertEqual(body['field_status']['annual_dividend'], 'unconfirmed')

    def test_scanner_price_removes_only_price_failure(self):
        now = datetime.now(timezone(timedelta(hours=9)))
        self.raw.update(status='unavailable', refreshing=False, data=None,
                        field_status={'price': 'fetch_error', 'market_cap': 'fetch_error'})
        self.dividends.lookup.return_value = {'status': 'unavailable',
                                             'field_status': {'price': 'fetch_error', 'annual_dividend': 'fetch_error'}}
        self.quotes.return_value = {'items': [{'symbol': '7203.T', 'currency': 'JPY', 'price': 3200,
                                             'trade_date': now.date().isoformat(), 'fetched_at': now.timestamp()-20}]}
        body = self.client.get('/api/company-profile?symbol=7203').get_json()
        self.assertEqual(body['field_status']['price'], 'available')
        self.assertEqual(body['field_status']['market_cap'], 'fetch_error')
        self.assertEqual(body['field_status']['annual_dividend'], 'fetch_error')

    def test_missing_information_stays_missing(self):
        self.raw['data'] = None
        self.dividends.lookup.return_value = {'status': 'unavailable'}
        body = self.client.get('/api/company-profile?symbol=7203.T').get_json()
        self.assertEqual(body['data'], {'currency': 'JPY'})
        self.assertEqual(body['sources'], [])

    def test_official_identity_is_available_without_financial_data_or_editorial(self):
        self.raw.update(status='unavailable', refreshing=False, data=None)
        self.dividends.lookup.return_value = {'status': 'unavailable'}
        response = self.client.get('/api/company-profile?symbol=7203')
        identity = response.get_json()['identity']
        self.assertEqual(identity['industry'], '輸送用機器')
        self.assertEqual(identity['market'], 'プライム（内国株式）')
        self.assertEqual(identity['date'], '2026-09-30')
        self.assertEqual(identity['source_url'], self.company['source_url'])
        self.assertEqual(response.status_code, 200)

    def test_existing_dated_close_is_immediately_available_without_a_new_scan(self):
        now = datetime.now(timezone(timedelta(hours=9)))
        trade_day = now.date() - timedelta(days=1)
        self.raw.update(status='unavailable', refreshing=False, data=None)
        self.dividends.lookup.return_value = {'status': 'loading', 'refreshing': True}
        self.quotes.return_value = {'items': [{'symbol': '7203.T', 'currency': 'JPY', 'price': 3200,
                                             'trade_date': trade_day.isoformat(), 'fetched_at': now.timestamp() - 20}]}
        body = self.client.get('/api/company-profile?symbol=7203').get_json()
        self.assertEqual(body['data']['price'], 3200)
        self.assertEqual(body['data']['price_trade_date'], trade_day.isoformat())
        self.assertIsNone(body['data']['price_updated_at'])
        self.assertEqual(body['source']['fields']['price']['as_of'], trade_day.isoformat())
        self.assertTrue(body['refreshing'])
        self.assertEqual(body['status'], 'pending')
        self.assertNotIn('market_cap', body['data'])
        self.quotes.assert_called_once_with()

    def test_old_forecast_does_not_prevent_a_newer_saved_close(self):
        now = datetime.now(timezone(timedelta(hours=9)))
        day = now.date() - timedelta(days=1)
        self.raw['data'].update(price=3000, price_updated_at=(now - timedelta(days=3)).timestamp())
        self.quotes.return_value = {'items': [{'symbol': '7203.T', 'currency': 'JPY', 'price': 3200,
                                             'trade_date': day.isoformat(), 'fetched_at': now.timestamp() - 20}]}
        body = self.client.get('/api/company-profile?symbol=7203').get_json()
        self.assertEqual(body['data']['price'], 3200)
        self.assertEqual(body['data']['forward_annual_dividend_per_share'], 100)
        self.assertIsNone(body['updated_at'])

    def test_future_expired_or_wrong_currency_quotes_stay_unknown(self):
        now = datetime.now(timezone(timedelta(hours=9)))
        self.raw['data'] = None
        self.dividends.lookup.return_value = {'status': 'unavailable'}
        valid = {'symbol': '7203.T', 'currency': 'JPY', 'price': 3200,
                 'trade_date': now.date().isoformat(), 'fetched_at': now.timestamp() - 20}
        for overrides in ({'trade_date': (now.date()+timedelta(days=1)).isoformat()},
                          {'fetched_at': now.timestamp()-8*86400}, {'currency': 'USD'}, {'price': True}):
            with self.subTest(overrides=overrides):
                self.quotes.return_value = {'items': [dict(valid, **overrides)]}
                self.assertNotIn('price', self.client.get('/api/company-profile?symbol=7203').get_json()['data'])

    def test_same_day_saved_close_cannot_replace_a_dated_provider_quote(self):
        now = datetime.now(timezone(timedelta(hours=9)))
        self.raw['data'].update(price=3300, price_updated_at=now.timestamp()-60)
        self.quotes.return_value = {'items': [{'symbol': '7203.T', 'currency': 'JPY', 'price': 3200,
                                             'trade_date': now.date().isoformat(), 'fetched_at': now.timestamp()-20}]}
        body = self.client.get('/api/company-profile?symbol=7203').get_json()
        self.assertEqual(body['data']['price'], 3300)
        self.assertNotIn('price_trade_date', body['data'])

    def test_full_width_codes_resolve_to_the_same_verified_company(self):
        self.assertEqual(self.client.get('/api/company-profile?symbol=７２０３').get_json()['symbol'], '7203.T')

    def test_one_invalid_editorial_does_not_remove_other_reviewed_companies(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'editorial.json'
            good = dict(self.story, symbol='7203.T')
            bad = dict(self.story, symbol='9432.T', reviewed_on='not a date')
            path.write_text(json.dumps({'items': [good, bad]}))
            self.assertEqual(read_editorial(path), {'7203.T': good})

    def test_stale_forecast_keeps_its_own_retrieval_date(self):
        self.raw.update(status='stale', updated_at=5000, source={'fields': {
            'forward_annual_dividend_per_share': {'fetched_at': 1000, 'as_of': None}}})
        body = self.client.get('/api/company-profile?symbol=7203.T').get_json()
        self.assertEqual(body['source']['fields']['forward_annual_dividend_per_share']['fetched_at'], 1000)
        self.assertIsNone(body['source']['fields']['forward_annual_dividend_per_share']['as_of'])

    def test_month_only_payment_announcement_does_not_invent_a_day_or_live_forever(self):
        current = payment_schedule('9432.T', date(2026, 9, 24))
        self.assertEqual(current['payment_period'], '2026-11')
        self.assertEqual(current['reviewed_on'], '2026-09-24')
        self.assertIsNone(payment_schedule('9432.T', date(2026, 12, 1)))
        self.assertIsNone(payment_schedule('9432.T', date(2026, 9, 23)))


if __name__ == '__main__':
    unittest.main()
