"""The production observation route must never start any work."""
import ast
import os
from pathlib import Path
import unittest
from unittest.mock import Mock

from flask import Flask, jsonify, request


ROOT = Path(__file__).resolve().parents[1]


class CompanyObservationRouteTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask('company-observation')
        self.news, self.stocks, self.dividends, self.company, self.calendar = [Mock() for _ in range(5)]
        self.company.publication_observation.return_value = {
            'status': 'ready', 'published_record_count': 2,
            'generation_owner': 'external', 'observation_only': True,
        }
        names = {'ensure_daily_news_worker', '_ensure_stock_catalogue_worker',
                 '_ensure_dividend_warmer', 'ensure_company_news_worker',
                 'api_company_news_observation'}
        tree = ast.parse((ROOT / 'line_bot.py').read_text())
        nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
        self.assertEqual(len(nodes), len(names))
        scope = {'app': self.app, 'request': request, 'jsonify': jsonify, 'os': os,
                 '_daily_news': self.news, '_stock_search': self.stocks,
                 '_dividend_snapshot': self.dividends, '_company_news': self.company}
        exec(compile(ast.Module(body=nodes, type_ignores=[]), 'company-observation-routes', 'exec'), scope)
        calendar_tree = ast.parse((ROOT / 'dividend_calendar.py').read_text())
        register = next(node for node in calendar_tree.body if isinstance(node, ast.FunctionDef)
                        and node.name == 'register_dividend_calendar')
        exec(compile(ast.Module(body=[register], type_ignores=[]), 'calendar-registration', 'exec'), scope)
        scope['register_dividend_calendar'](self.app, self.calendar)
        self.app.add_url_rule('/normal', 'normal', lambda: 'normal')
        self.client = self.app.test_client()

    def test_observation_get_cannot_start_workers_even_with_force_query(self):
        response = self.client.get('/api/company-news-observation?force=1&retry=1')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['published_record_count'], 2)
        self.assertTrue(response.cache_control.no_store)
        self.company.publication_observation.assert_called_once_with()
        self.company.snapshot.assert_not_called()
        self.company.operational_snapshot.assert_not_called()
        self.news.start.assert_not_called()
        self.stocks.ensure_refresh_worker.assert_not_called()
        self.dividends.ensure_refresh.assert_not_called()
        self.company.start.assert_not_called()
        self.calendar.ensure_refresh.assert_not_called()

    def test_normal_requests_keep_existing_scheduled_wake_behavior(self):
        self.assertEqual(self.client.get('/normal').status_code, 200)
        self.news.start.assert_called_once_with()
        self.stocks.ensure_refresh_worker.assert_called_once_with()
        self.dividends.ensure_refresh.assert_called_once_with()
        self.company.start.assert_called_once_with()
        self.calendar.ensure_refresh.assert_called_once_with()


if __name__ == '__main__':
    unittest.main()
