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


class ProfileRoutes(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.catalogue = Mock()
        self.catalogue.all_items.return_value = {'items': [{'code': '7203', 'name': 'トヨタ自動車'}]}
        self.profiles = Mock()
        self.raw = {'symbol': '7203.T', 'name': 'provider name', 'status': 'pending', 'refreshing': True,
                    'updated_at': None, 'data': {'forward_annual_dividend_per_share': 100}}
        self.profiles.get.side_effect = lambda *_: deepcopy(self.raw)
        self.dividends = Mock()
        self.dividends.payload.return_value = {'items': [{'ticker': '7203.T', 'price': 3000,
            'price_updated_at': 1000, 'annual_dividend': 95, 'annual_dividend_basis': 'trailing_12m',
            'fetched_at': 1100}]}
        self.story = {'business': '車をつくる会社です。', 'life': '移動を支えます。',
                      'watch': 'どんな車が売れるかに注目です。', 'reviewed_on': '2026-09-24',
                      'sources': [{'title': '会社情報', 'url': 'https://global.toyota/jp/company/'}]}
        register_company_profiles(self.app, self.profiles, self.catalogue, self.dividends,
                                  {'7203.T': self.story})
        self.client = self.app.test_client()

    def test_invalid_and_unknown_companies_cannot_trigger_provider_requests(self):
        for symbol, status in [('https://example.org', 400), ('../7203.T', 400), ('AAPL', 400), ('9999.T', 404)]:
            self.assertEqual(self.client.get('/api/company-profile', query_string={'symbol': symbol}).status_code, status)
        self.profiles.get.assert_not_called()

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
        self.dividends.payload.assert_called_once_with(refresh=False)
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

    def test_missing_information_stays_missing(self):
        self.raw['data'] = None
        self.dividends.payload.return_value = {'items': []}
        body = self.client.get('/api/company-profile?symbol=7203.T').get_json()
        self.assertEqual(body['data'], {'currency': 'JPY'})
        self.assertEqual(body['sources'], [])

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
