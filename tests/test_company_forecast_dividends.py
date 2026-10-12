from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

from flask import Flask

from company_business import official_identity
from company_forecast_dividends import CompanyForecastDividends, FIELD, KIND, USE_BASIS, validate_forecast
from company_profile_api import register_company_profiles

NOW = datetime(2026, 10, 13, 1, tzinfo=timezone.utc).timestamp()
COMPANY = dict(code='1832', symbol='1832.JP', name='北海電工', exchange='Sapporo',
               provider_symbol=None, market='札証', industry='建設業')


def row(**changes):
    source = 'https://www.hokkaidenko.co.jp/uploads/2026/07/forecast.pdf'
    value = dict(symbol=COMPANY['symbol'], identity=official_identity(COMPANY['symbol'], COMPANY),
                 proof=dict(code='1832', source_security_code='1832', issuer_name='株式会社北海電工',
                            exchange='Sapporo', source_host='www.hokkaidenko.co.jp', issuer_document_url=source),
                 kind=KIND, use_basis=USE_BASIS, currency='JPY', unit='JPY/share',
                 split_adjustment='as_reported', latest_revision_guaranteed=False,
                 source_url=source, source_title='北海電工 決算短信',
                 fetched_at=NOW - 3600, announcement_date='2026-07-28', checked_on='2026-10-13',
                 fiscal_period={'start': '2026-04-01', 'end': '2027-03-31'}, status='available', value=20)
    value.update(changes)
    return value


class CompanyForecasts(unittest.TestCase):
    def test_dated_forecast_is_independent_and_true_zero_is_a_value(self):
        for value in (20, 0, 10.5):
            clean = validate_forecast(row(value=value), COMPANY, now=NOW)
            self.assertEqual(clean['value'], value)
            self.assertEqual(clean['kind'], KIND)
            self.assertEqual(clean['fiscal_period']['end'], '2027-03-31')
            self.assertFalse(clean['latest_revision_guaranteed'])
            self.assertNotIn('proof', clean)
            self.assertNotIn('forward_dividend_basis', clean)

    def test_undetermined_cannot_be_zero_or_available_without_a_number(self):
        clean = validate_forecast(row(status='undetermined', value=None), COMPANY, now=NOW)
        self.assertIsNone(clean['value'])
        for updates in ({'status': 'undetermined', 'value': 0}, {'value': None},
                        {'value': True}, {'value': -1}, {'value': float('inf')}, {'unit': 'JPY'}):
            self.assertIsNone(validate_forecast(row(**updates), COMPANY, now=NOW))

    def test_range_split_mismatch_and_ended_periods_are_not_synthetic_annual_amounts(self):
        ranged = validate_forecast(row(status='range', value=None, value_range={'min': 1.34, 'max': 2.01}), COMPANY, now=NOW)
        self.assertIsNone(ranged['value'])
        self.assertEqual(ranged['value_range'], {'min': 1.34, 'max': 2.01})
        for value_range in ({'min': 2, 'max': 1}, {'min': True, 'max': 2}, {'min': 1, 'max': float('inf')}):
            self.assertIsNone(validate_forecast(row(status='range', value=None, value_range=value_range), COMPANY, now=NOW))
        split = row(status='not_comparable', value=None, reason='split_basis_mismatch')
        self.assertEqual(validate_forecast(split, COMPANY, now=NOW)['status'], 'not_comparable')
        self.assertIsNone(validate_forecast(row(status='not_comparable', value=None), COMPANY, now=NOW))
        past = row(fiscal_period={'start': '2025-09-01', 'end': '2026-08-31'})
        self.assertTrue(validate_forecast(past, COMPANY, now=NOW)['fiscal_period_expired'])

    def test_current_issuer_code_name_and_market_must_all_match(self):
        for changes in ({'code': '1833'}, {'source_security_code': '18330'},
                        {'issuer_name': '北海電工サービス株式会社'}, {'exchange': 'Tokyo'}):
            bad = row(); bad['proof'].update(changes)
            self.assertIsNone(validate_forecast(bad, COMPANY, now=NOW))
        self.assertIsNone(validate_forecast(row(), {**COMPANY, 'name': '新しい社名'}, now=NOW))
        self.assertIsNone(validate_forecast(row(), {**COMPANY, 'exchange': 'Nagoya'}, now=NOW))

    def test_source_hosts_credentials_queries_and_future_dates_are_rejected(self):
        for source in ('https://example.com/forecast.pdf', 'http://www.hokkaidenko.co.jp/forecast.pdf',
                       row()['source_url'] + '?token=secret', row()['source_url'] + '#secret'):
            self.assertIsNone(validate_forecast(row(source_url=source), COMPANY, now=NOW))
        for changes in ({'announcement_date': '2026-10-14'}, {'checked_on': '2026-10-14'},
                        {'fetched_at': NOW + 1}, {'announcement_date': '2026-02-30'},
                        {'fiscal_period': {'start': '2027-04-01', 'end': '2027-03-31'}},
                        {'latest_revision_guaranteed': True}):
            self.assertIsNone(validate_forecast(row(**changes), COMPANY, now=NOW))

    def test_duplicate_issuer_records_fail_closed_instead_of_last_value_winning(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / 'seed.json'
            p.write_text(json.dumps({'schema_version': 1, 'items': [row(), row(value=30)]}))
            self.assertIsNone(CompanyForecastDividends(p, now=lambda: NOW).get('1832.JP', COMPANY))

    def test_route_adds_only_company_forecast_and_never_borrows_tokyo_figures(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / 'seed.json'
            p.write_text(json.dumps({'schema_version': 1, 'items': [row()]}))
            service = CompanyForecastDividends(p, now=lambda: NOW)
            app = Flask(__name__)
            catalogue, profiles, dividends = Mock(), Mock(), Mock()
            catalogue.company.side_effect = lambda code: deepcopy(COMPANY) if code == '1832' else None
            register_company_profiles(app, profiles, catalogue, dividends, {}, forecast_dividends=service)
            result = app.test_client().get('/api/company-profile?symbol=1832.JP').get_json()
            self.assertEqual(result['data'][FIELD], 20)
            self.assertEqual(result['issuer_dividend_forecast']['announcement_date'], '2026-07-28')
            self.assertEqual(result['field_status'][FIELD], 'available')
            self.assertNotIn('forward_annual_dividend_per_share', result['data'])
            self.assertNotIn('historical_dividend_per_share', result['data'])
            profiles.get.assert_not_called()
            dividends.lookup.assert_not_called()
            self.assertEqual(app.test_client().get('/api/company-profile?symbol=1832.T').status_code, 400)


if __name__ == '__main__':
    unittest.main()
