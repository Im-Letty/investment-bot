"""Private real-clock release tests; no network, AI, cache or LINE calls."""
import base64
from copy import deepcopy
from datetime import datetime
from hashlib import sha256
import json
import unittest
from unittest.mock import Mock, patch

import news_release_test as probe
from news_cache import JST


NOW = datetime(2026, 10, 8, 1, 30, tzinfo=JST).timestamp()
IDENTIFIER, TOKEN = 'a' * 32, base64.urlsafe_b64encode(b't' * 32).decode().rstrip('=')


def record():
    draft = {'headline': '代表の発表', 'summary': '代表の発表をやさしく紹介します。',
        'articles': [{'index': 0, 'headline': '最初のニュース', 'summary': '最初の紹介です。\n\n条件を説明します。'},
                     {'index': 1, 'headline': '別のニュース', 'summary': '別の出来事の紹介です。\n\n追加の条件です。'}]}
    refs = []
    for index in range(2):
        refs.append({'index': index, 'source': '財務省', 'title': f'架空の資料{index}',
            'url': f'https://www.mof.go.jp/policy/international_policy/convention/dialogue/test20261005_{index}.html',
            'published_at': None, 'published_date': '2026-10-05', 'publication_precision': 'day',
            'body_sha256': str(index) * 64, 'body_verified_at': NOW - 60 * 60})
    return {'schema': probe.SCHEMA, 'created_at': NOW, 'test_release_at': NOW + 30,
        'expires_at': NOW + 15 * 60, 'token_sha256': sha256(TOKEN.encode()).hexdigest(),
        'draft': draft, 'source_refs': refs, 'final_copy_sha256': probe.fingerprint(draft)}


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.saved = record()
        self.storage = Mock()
        self.storage.read.side_effect = lambda path: deepcopy(self.saved)
        self.blocker = patch('requests.sessions.Session.request', side_effect=AssertionError('network forbidden'))
        self.blocker.start()
        self.addCleanup(self.blocker.stop)

    def call(self, now=NOW, identifier=IDENTIFIER, token=TOKEN):
        return probe.private_preview_response(self.storage, identifier, token, now)

    def test_invalid_header_id_or_clock_stops_before_any_storage_read(self):
        for identifier, token, now in ((IDENTIFIER, '', NOW), (IDENTIFIER, 'x' * 4096, NOW),
            (IDENTIFIER, TOKEN + ' ', NOW), (IDENTIFIER.upper(), TOKEN, NOW),
            (IDENTIFIER, 't' * 43, NOW),
            ('../days/2026-10-08/edition', TOKEN, NOW), (IDENTIFIER, TOKEN, float('nan'))):
            with self.subTest(identifier=identifier):
                self.assertEqual(self.call(now, identifier, token), probe._unavailable())
        self.storage.read.assert_not_called()
        self.storage.ensure_private.assert_not_called()
        self.storage.create.assert_not_called()

    def test_waiting_has_no_copy_and_exact_real_second_releases_unmodified_historical_copy(self):
        before = self.call(NOW + 29.999)
        self.assertEqual(before[1], 200)
        self.assertEqual(before[0]['status'], 'waiting')
        for key in ('markup', 'draft', 'source_refs', 'data_sha256', 'final_copy_sha256'):
            self.assertNotIn(key, before[0])
        response, status = self.call(NOW + 30)
        self.assertEqual(status, 200)
        self.assertEqual(response['status'], 'available')
        self.assertEqual(response['final_copy_sha256'], self.saved['final_copy_sha256'])
        self.assertEqual(response['source_dates'], ['2026-10-05'])
        self.assertIn('別のニュース', response['markup'])
        self.assertNotIn('最初のニュース', response['markup'])  # lead is not duplicated in details
        self.assertIn('2026/10/5', response['markup'])
        self.assertFalse(response['scheduled_08_verified'])
        self.assertIn('過去の公式発表', response['markup'])
        self.assertFalse(response['publication_allowed'])
        self.assertTrue(response['historical_copy_only'])
        self.assertEqual(probe._presentation(self.saved, NOW)['edition_date'], '2026-10-05')
        self.storage.read.assert_called_with(probe.PREFIX + IDENTIFIER + '.json')
        self.storage.create.assert_not_called()
        self.assertNotIn(TOKEN, json.dumps(response))
        self.assertNotIn(self.saved['token_sha256'], json.dumps(response))

    def test_empty_missing_wrong_token_and_expired_all_same_generic_response(self):
        for item in (None, {}, record()):
            self.saved = item
            self.assertEqual(self.call(token='w' * 43), probe._unavailable())
        self.saved = record()
        self.assertEqual(self.call(NOW + 900), probe._unavailable())
        self.assertEqual(self.call(NOW - 1), probe._unavailable())

    def test_timing_bounds_no_long_lived_or_invalid_release_record(self):
        for field, value in (('expires_at', NOW + 901), ('test_release_at', NOW - 1),
            ('test_release_at', NOW + 900), ('created_at', True), ('expires_at', float('inf'))):
            self.saved = record()
            self.saved[field] = value
            self.assertEqual(self.call(), probe._unavailable())

    def test_hash_mutation_ref_order_unknown_fields_or_source_identity_rejected(self):
        alterations = [lambda item: item['draft'].update(summary='未審査の書き換え'),
            lambda item: item['source_refs'].reverse(),
            lambda item: item.update(publication_mode='curated'),
            lambda item: item['source_refs'][0].update(url='https://evil.example/a.html'),
            lambda item: item['source_refs'][0].update(body='raw originals never allowed'),
            lambda item: item['source_refs'][0].update(published_date='2026-10-09'),
            lambda item: item['source_refs'][0].update(body_verified_at=NOW + 1),
            lambda item: item['source_refs'][0].update(index=True)]
        for change in alterations:
            self.saved = record()
            change(self.saved)
            self.assertEqual(self.call(NOW + 30), probe._unavailable())

    def test_original_precise_time_cannot_be_guessed_for_date_only_source(self):
        self.saved['source_refs'][0]['published_at'] = NOW - 60
        self.assertEqual(self.call(NOW + 30), probe._unavailable())
        self.saved = record()
        stamp = datetime(2026, 10, 5, 14, 3, tzinfo=JST).timestamp()
        self.saved['source_refs'][0].update(publication_precision='second', published_at=stamp)
        response, status = self.call(NOW + 30)
        self.assertEqual(status, 200)
        self.assertIn('14:03', response['markup'])

    def test_storage_failure_never_reflects_exception_token_secret_or_private_url(self):
        self.storage.read.side_effect = RuntimeError(TOKEN + ' sk-private-key https://secret.example')
        self.assertEqual(self.call(), probe._unavailable())

    def test_render_escapes_copy_and_does_not_return_header_or_api_key_like_strings(self):
        self.saved['draft']['articles'][1]['summary'] = '<script>alert(1)</script>\n\n説明です。'
        self.saved['final_copy_sha256'] = probe.fingerprint(self.saved['draft'])
        response, status = self.call(NOW + 30)
        self.assertEqual(status, 200)
        self.assertNotIn('<script>', response['markup'])
        self.assertIn('&lt;script&gt;', response['markup'])
        for text in (TOKEN, 'sk-proj-' + 'a' * 20):
            self.saved['draft']['summary'] = text
            self.saved['final_copy_sha256'] = probe.fingerprint(self.saved['draft'])
            self.assertEqual(self.call(NOW + 30), probe._unavailable())


if __name__ == '__main__':
    unittest.main()
