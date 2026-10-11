"""Frozen intraday source windows and publication provenance, without live AI."""
from copy import deepcopy
from datetime import datetime
from hashlib import sha256
import unittest
from unittest.mock import Mock

from daily_news_producer import (CHECKS, GenerationError, _official_articles,
                                 _source_window, build_issue, generate_edition)
from news_cache import JST, _official_ref, _official_window, _validated_digest, select_daily_news


def stamp(value):
    return datetime.fromisoformat(value + '+09:00').timestamp()


def draft():
    return {'headline': '公式発表をやさしく説明', 'summary': '要' * 220,
            'articles': [{'index': 0, 'headline': '発表された内容', 'summary': '詳' * 230}]}


class IntradayWindowTests(unittest.TestCase):
    def setUp(self):
        self.window = {'version': 2, 'kind': 'intraday', 'edition_date': '2026-10-11',
                       'window_start': stamp('2026-10-11T07:30:00'),
                       'cutoff_at': stamp('2026-10-11T14:15:20')}
        self.now = self.window['cutoff_at'] + 60
        body = 'これは日時と本文の検証のための架空の公式発表です。' * 10
        self.record = {'source': '財務省', 'title': '架空の経済政策の発表',
                       'url': 'https://www.mof.go.jp/policy/tax_policy/tax_reform/example.html',
                       'evidence_url': 'https://www.mof.go.jp/policy/tax_policy/tax_reform/example.html',
                       'published_at': stamp('2026-10-11T12:00:00'),
                       'published_date': '2026-10-11', 'publication_precision': 'second',
                       'body': body, 'body_sha256': sha256(body.encode()).hexdigest(),
                       'body_verified_at': self.window['cutoff_at'], 'selection_route': 'intraday'}

    def issue(self, record=None, now=None):
        return build_issue(draft(), [self.record if record is None else record],
                           self.now if now is None else now, source_window=self.window)

    def test_actual_frozen_cutoff_is_preserved_without_rounding(self):
        before = deepcopy(self.window)
        producer = _source_window(self.window, self.now)
        public = _official_window(self.window, '2026-10-11')
        self.assertEqual(producer, before)
        self.assertEqual(public, before)
        producer['cutoff_at'] += 1
        public['cutoff_at'] += 1
        self.assertEqual(self.window, before)

    def test_invalid_windows_fail_in_both_validators(self):
        variants = []
        for key, value in (
            ('version', True), ('version', 2.0), ('version', 3), ('kind', 'morning'),
            ('kind', None), ('edition_date', '2026-10-10'), ('edition_date', '20261011'),
            ('edition_date', '2026-W41-7'), ('window_start', True),
            ('window_start', self.window['window_start'] + 1),
            ('cutoff_at', False), ('cutoff_at', float('nan')), ('cutoff_at', float('inf')),
            ('cutoff_at', stamp('2026-10-11T08:59:59')),
            ('cutoff_at', stamp('2026-10-11T23:00:00')),
            ('cutoff_at', stamp('2026-10-10T14:15:20')),
            ('cutoff_at', stamp('2026-10-12T14:15:20'))):
            variants.append({**self.window, key: value})
        variants += [{**self.window, 'carryover_start': self.window['window_start']},
                     {**self.window, 'extra': 'untrusted'},
                     {key: value for key, value in self.window.items() if key != 'kind'},
                     {key: value for key, value in self.window.items() if key != 'cutoff_at'}]
        for value in variants:
            with self.subTest(window=value):
                with self.assertRaisesRegex(GenerationError, '^invalid_source_window$'):
                    _source_window(value, self.now)
                self.assertIsNone(_official_window(value, '2026-10-11'))

    def test_cutoff_bounds_include_nine_and_exclude_twenty_three(self):
        for clock in ('2026-10-11T09:00:00', '2026-10-11T22:59:59'):
            value = {**self.window, 'cutoff_at': stamp(clock)}
            self.assertEqual(_source_window(value, value['cutoff_at']), value)
            self.assertEqual(_official_window(value, '2026-10-11'), value)

    def test_generation_cannot_precede_freeze_or_cross_edition_day(self):
        for now in (self.window['cutoff_at'] - 1, stamp('2026-10-10T23:59:59'),
                    stamp('2026-10-12T00:00:00'), True, float('nan')):
            with self.subTest(now=now), self.assertRaisesRegex(GenerationError, '^invalid_source_window$'):
                _source_window(self.window, now)
        self.assertEqual(_source_window(self.window, stamp('2026-10-11T23:30:00')), self.window)

    def test_timed_references_have_inclusive_same_day_boundaries(self):
        for published in (self.window['window_start'], self.window['cutoff_at']):
            record = {**self.record, 'published_at': published}
            issue = self.issue(record)
            self.assertEqual(issue['article_refs'][0]['selection_route'], 'intraday')
            self.assertEqual(issue['article_refs'][0]['published_at'], published)
            self.assertEqual(_official_ref(issue['article_refs'][0], self.window), issue['article_refs'][0])

    def test_unknown_publication_time_stays_unknown_for_today(self):
        record = {**self.record, 'published_at': None, 'publication_precision': 'day'}
        issue = self.issue(record)
        for ref in (issue['article_refs'][0], issue['article_summaries'][0]):
            self.assertIsNone(ref['published_at'])
            self.assertEqual(ref['published_date'], '2026-10-11')
            self.assertEqual(ref['selection_route'], 'intraday')
        self.assertEqual(_validated_digest(issue), issue)

    def test_date_only_body_must_be_verified_inside_intraday_window(self):
        record = {**self.record, 'published_at': None, 'publication_precision': 'day',
                  'body_verified_at': self.window['window_start'] - 1}
        with self.assertRaisesRegex(GenerationError, '^invalid_official_article$'):
            _official_articles([record], self.window, self.now)
        self.assertIsNone(_official_ref(record, self.window))
        record['body_verified_at'] = self.window['window_start']
        issue = self.issue(record)
        self.assertEqual(_validated_digest(issue), issue)
        self.assertIsNone(issue['article_refs'][0]['published_at'])

    def test_intraday_never_uses_carryover_or_correction_to_bypass_provenance(self):
        variants = []
        for key, value in (
            ('published_at', self.window['window_start'] - 1),
            ('published_at', self.window['cutoff_at'] + 1),
            ('published_date', '2026-10-10'), ('published_date', '2026-10-12'),
            ('body_verified_at', self.window['cutoff_at'] + 1),
            ('selection_route', 'main'), ('selection_route', 'carryover'),
            ('selection_route', 'date_only'), ('selection_route', 'deferred'),
            ('selection_route', 'correction'), ('deferred_from', '2026-10-10'),
            ('deferred_reason', 'review_failed')):
            variants.append({**self.record, key: value})
        previous_day = {**self.record, 'published_at': None, 'publication_precision': 'day',
                        'published_date': '2026-10-10'}
        future_day = {**previous_day, 'published_date': '2026-10-12'}
        variants += [previous_day, future_day,
                     {**previous_day, 'correction_of': 'previous-edition'},
                     {key: value for key, value in self.record.items() if key != 'published_at'},
                     {**self.record, 'published_at': None},
                     {**self.record, 'publication_precision': 'day'},
                     {**self.record, 'published_at': None, 'publication_precision': 'minute'}]
        for record in variants:
            with self.subTest(record=record):
                with self.assertRaisesRegex(GenerationError, '^invalid_official_article$'):
                    _official_articles([record], self.window, self.now)
                self.assertIsNone(_official_ref(record, self.window))

    def test_reference_requires_original_host_hash_and_verified_version(self):
        for key, value in (('url', 'https://example.test/policy.html'),
                           ('url', self.record['url'] + '?edited=1'),
                           ('source', '日本銀行'), ('body_sha256', 'a' * 63),
                           ('body_sha256', 'A' * 64), ('body_verified_at', None)):
            record = {**self.record, key: value}
            with self.subTest(field=key, value=value):
                with self.assertRaisesRegex(GenerationError, '^invalid_official_article$'):
                    _official_articles([record], self.window, self.now)
                self.assertIsNone(_official_ref(record, self.window))

    def test_publication_can_follow_review_immediately_without_morning_delay(self):
        issue = self.issue(now=self.window['cutoff_at'])
        self.assertEqual(issue['reviewed_at'], self.window['cutoff_at'])
        self.assertEqual(issue['publish_at'], self.window['cutoff_at'])
        self.assertEqual(_validated_digest(issue), issue)
        result = select_daily_news({'news': []}, now=self.window['cutoff_at'], reviewed_digests=[issue])
        self.assertEqual(result['digest'], issue)

    def test_incomplete_or_early_intraday_review_and_release_are_not_public(self):
        issue = self.issue()
        variants = [deepcopy(issue) for _ in range(4)]
        variants[0]['reviewed_at'] = self.window['cutoff_at'] - 1
        variants[0]['publish_at'] = self.window['cutoff_at'] - 1
        variants[1]['publish_at'] = variants[1]['reviewed_at'] - 1
        variants[2].pop('publish_at')
        variants[3]['publish_at'] = stamp('2026-10-12T00:00:00')
        for value in variants:
            with self.subTest(value=value):
                self.assertIsNone(_validated_digest(value))
        not_yet_visible = select_daily_news({'news': []}, now=issue['publish_at'] - 1,
                                            reviewed_digests=[issue])
        self.assertIsNone(not_yet_visible['digest'])

    def test_article_detail_cannot_change_frozen_reference(self):
        issue = self.issue()
        for key, value in (('body_sha256', 'a' * 64),
                           ('published_date', '2026-10-10'), ('published_at', self.window['window_start'])):
            modified = deepcopy(issue)
            modified['article_summaries'][0][key] = value
            with self.subTest(field=key):
                self.assertIsNone(_validated_digest(modified))

    def test_normal_generation_reviews_same_frozen_copy_and_intraday_context(self):
        approved = {'approved': True, 'checks': {key: True for key in CHECKS}, 'issues': []}
        providers = Mock()
        providers.claude.return_value = draft()
        providers.gemini.return_value = approved
        providers.openai.return_value = approved
        collector = Mock(side_effect=AssertionError('frozen inputs must not refetch'))
        issue = generate_edition(self.now, articles=[self.record], source_window=self.window,
                                 providers=providers, collector=collector, clock=lambda: self.now)
        collector.assert_not_called()
        self.assertEqual(providers.claude.call_count, 1)
        self.assertEqual(providers.gemini.call_count, 1)
        self.assertEqual(providers.openai.call_count, 1)
        self.assertEqual(providers.gemini.call_args.args[1], providers.openai.call_args.args[1])
        for reviewer in (providers.gemini, providers.openai):
            self.assertEqual(reviewer.call_args.args[1]['source_window'], self.window)
            self.assertIn('kind=intradayの日中版は当日の発表だけ', reviewer.call_args.args[0])
            self.assertNotIn('今回はsource_windowに示された朝版', reviewer.call_args.args[0])
        self.assertEqual(issue['publish_at'], self.now)

    def test_invalid_snapshot_stops_before_every_provider(self):
        providers, collector = Mock(), Mock()
        record = {**self.record, 'published_at': None, 'publication_precision': 'day',
                  'published_date': '2026-10-10', 'deferred_from': '2026-10-10'}
        with self.assertRaisesRegex(GenerationError, '^invalid_official_article$'):
            generate_edition(self.now, articles=[record], source_window=self.window,
                             providers=providers, collector=collector, clock=lambda: self.now)
        providers.claude.assert_not_called()
        providers.gemini.assert_not_called()
        providers.openai.assert_not_called()
        collector.assert_not_called()

    def test_morning_window_and_eight_oclock_release_remain_unchanged(self):
        window = {'version': 1, 'edition_date': '2026-10-11',
                  'window_start': stamp('2026-10-10T08:00:00'),
                  'carryover_start': stamp('2026-10-10T07:30:00'),
                  'cutoff_at': stamp('2026-10-11T07:30:00')}
        now = stamp('2026-10-11T07:40:00')
        self.assertEqual(_source_window(window, now), window)
        self.assertEqual(_official_window(window, '2026-10-11'), window)
        record = {**self.record, 'published_at': None, 'publication_precision': 'day',
                  'published_date': '2026-10-10', 'body_verified_at': window['cutoff_at'],
                  'selection_route': 'date_only'}
        issue = build_issue(draft(), [record], now, source_window=window)
        self.assertEqual(issue['publish_at'], stamp('2026-10-11T08:00:00'))
        issue['publish_at'] = now
        self.assertIsNone(_validated_digest(issue))
        for value in ({**window, 'kind': 'intraday'},
                      {**window, 'cutoff_at': window['cutoff_at'] + 1}):
            with self.assertRaisesRegex(GenerationError, '^invalid_source_window$'):
                _source_window(value, now)
            self.assertIsNone(_official_window(value, '2026-10-11'))


if __name__ == '__main__':
    unittest.main()
