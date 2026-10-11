"""Decision extraction, no-prose storage and identical final-copy reviews."""
from copy import deepcopy
from datetime import datetime
from hashlib import sha256
import json
import unittest
from unittest.mock import Mock, patch

from daily_news_producer import CHECKS, GenerationError, _official_articles, generate_edition
from intraday_news_runtime import importance, intraday_window, select_candidate
from morning_news_window import JST, MorningNewsPreparer, morning_window
from official_boj_facts import policy_facts, valid_policy_fact_record
from official_news_cache import OfficialNewsCache, _article
from tests.test_official_news_cache import Storage
from website_news import collect_website_sources


def stamp(day='2026-10-11', hour=7, minute=29):
    return datetime.fromisoformat(day).replace(hour=hour, minute=minute, tzinfo=JST).timestamp()


def original(body=None, day='2026-10-10'):
    body = body or (f'{day[:4]}年{int(day[5:7])}月{int(day[8:])}日 日本銀行 金融市場調節方針の変更について\n'
        '1. 日本銀行は、本日、政策委員会・金融政策決定会合において、次回金融政策決定会合までの'
        '金融市場調節方針を、以下のとおりとすることを決定した（賛成7反対2）（注）。\n'
        '無担保コールレート（オーバーナイト物）を、１．２５％程度で推移するよう\n促す1。\n'
        '基準貸付利率は1.5％とする。参考の公表予定は11月5日8:50。\n'
        'PRIVATE_BOJ_PROSE: 景気判断や委員の見通しを含む説明はAI入力に混ぜない。')
    url = 'https://www.boj.or.jp/mopo/mpmdeci/mpr_2026/k' + day[2:].replace('-', '') + 'a.pdf'
    return {'source': '日本銀行', 'url': url, 'evidence_url': url,
            'title': '金融市場調節方針の変更について', 'body': body,
            'body_sha256': sha256(body.encode()).hexdigest(), 'published_date': day,
            'published_at': None, 'publication_precision': 'day',
            'observed_at': stamp(), 'body_verified_at': stamp()}


class FactTests(unittest.TestCase):
    def test_adopted_target_not_other_rate_or_scheduled_time(self):
        row = policy_facts(original())
        self.assertTrue(valid_policy_fact_record(row))
        self.assertEqual(row['policy_rate_percent'], '1.25')
        self.assertEqual(row['published_date'], '2026-10-10')
        self.assertIsNone(row['published_at'])
        self.assertEqual(row['original_body_sha256'], original()['body_sha256'])
        self.assertNotIn('PRIVATE_BOJ_PROSE', json.dumps(row))
        self.assertNotIn('1.5%', row['body'])
        self.assertNotIn('8:50', row['body'])
        self.assertEqual(policy_facts(row), row)

    def test_html_and_pdf_paths_preserve_actual_day(self):
        row = original()
        for path in ('mpr_2026/k261010a.pdf', 'state_2026/k261010a.htm'):
            url = 'https://www.boj.or.jp/mopo/mpmdeci/' + path
            self.assertTrue(valid_policy_fact_record(policy_facts({**row, 'url': url, 'evidence_url': url})))

    def test_missing_decision_or_ambiguous_or_proposal_target_rejected(self):
        text = original()['body']
        for body in (text.replace('決定した', '提案した'), text.replace('以下のとおり', '未定'),
                     text.replace('１．２５％', '1.25〜1.5％'),
                     text.replace('促す1。', '促す予定。'),
                     text.replace('無担保コールレート', '補完貸付制度'),
                     text.replace('無担保コールレート', '反対委員は提案した。無担保コールレート'),
                     text.replace('基準貸付利率は1.5％とする。',
                         '無担保コールレート（オーバーナイト物）を、2％程度で推移するよう促す。')):
            with self.subTest(body=body):
                self.assertIsNone(policy_facts(original(body)))

    def test_original_date_hash_title_and_host_must_be_verified(self):
        for change in ({'body_sha256': 'a' * 64}, {'published_at': stamp()},
                       {'title': '総裁の講演'}, {'source': '財務省'},
                       {'url': 'https://evil.test/document.pdf'},
                       {'url': original()['url'].replace('/mpmdeci/', '/speech/')},
                       {'url': original()['url'] + '?copy=1'}):
            self.assertIsNone(policy_facts({**original(), **change}))

    def test_adopted_sentence_cannot_cross_into_dissent_or_old_quoted_decision(self):
        dissent = ('2026年10月10日 日本銀行 金融市場調節方針の変更について\n'
            '日本銀行は、本日、政策委員会・金融政策決定会合において、金利目標を変更しないことを決定した。'
            '反対委員は、以下のとおりの提案を決定した。'
            '無担保コールレート（オーバーナイト物）を、2％程度で推移するよう促す。'
            'この提案は否決されました。現在の目標は1.25％です。')
        current = original()['body']
        old = current.replace('１．２５％', '0.50％')
        for body in (dissent, '前回の決定を引用します。' + old + '過去の注記。' * 80 + current,
                     current + '\n過去の決定: ' + old,
                     current.replace('2026年10月10日', '2026年10月9日')):
            self.assertIsNone(policy_facts(original(body)))

    def test_facts_cannot_smuggle_unknown_prose_fields_or_mutate_values(self):
        row = policy_facts(original())
        for change in ({'raw_body': original()['body']}, {'extra_notes': original()['body']},
                       {'policy_rate_percent': '1.250'}, {'policy_rate_percent': None},
                       {'original_body_sha256': 'wrong'}, {'body': row['body'] + '\nextra'}):
            changed = {**row, **change}
            if 'body' in change:
                changed['body_sha256'] = sha256(changed['body'].encode()).hexdigest()
            with self.subTest(change=change):
                self.assertFalse(valid_policy_fact_record(changed))
                self.assertIsNone(policy_facts(changed))

    def test_collector_rejection_is_unavailable_not_healthy_empty(self):
        diagnostics = {'日本銀行': {'accepted': 1, 'status': 'collected', 'errors': []}}
        raw = original(original()['body'].replace('決定した', '検討した'))
        with patch('website_news.collect_official_articles', return_value=[raw]):
            self.assertEqual(collect_website_sources(stamp(), since=1, until=stamp(), diagnostics=diagnostics), [])
        self.assertEqual(diagnostics['日本銀行']['status'], 'articles_unavailable')
        self.assertIn('boj_policy_facts_unverified', diagnostics['日本銀行']['errors'])

    def test_known_metadata_cannot_hide_original_prose(self):
        row = policy_facts(original())
        for key in ('observed_at', 'requires_correction_review', 'selection_route',
                    'deferred_from', 'deferred_reason', 'evidence_url'):
            changed = {**row, key: 'PRIVATE_ORIGINAL_PROSE_SENTINEL'}
            with self.subTest(key=key):
                self.assertFalse(valid_policy_fact_record(changed))
                self.assertIsNone(policy_facts(changed))
                with self.assertRaisesRegex(GenerationError, 'invalid_official_article'):
                    _official_articles([changed], morning_window(stamp()), stamp())

    def test_cache_persists_facts_only_and_rejects_direct_raw_input(self):
        row = policy_facts(original())
        self.assertTrue(valid_policy_fact_record(_article(row, stamp())))
        with self.assertRaisesRegex(ValueError, 'invalid_source_cache_article'):
            _article(original(), stamp())
        storage = Storage()
        cache = OfficialNewsCache(storage, Mock(return_value=[row]), clock=lambda: stamp())
        cache.collect(stamp())
        self.assertNotIn('PRIVATE_BOJ_PROSE', json.dumps(storage.values))
        self.assertTrue(any('/bodies/' in key for key in storage.values))
        self.assertTrue(valid_policy_fact_record(cache.snapshot(stamp())['articles'][0]))

    def test_writer_and_both_reviewers_receive_identical_fact_record(self):
        row = policy_facts(original())
        provider = Mock()
        provider.claude.return_value = {'headline': '日銀の短期金利の目標', 'summary': '要' * 220,
            'articles': [{'index': 0, 'headline': '目標を確認', 'summary': '詳' * 230}]}
        approval = {'approved': True, 'checks': {name: True for name in CHECKS}, 'issues': []}
        provider.gemini.return_value = provider.openai.return_value = approval
        issue = generate_edition(stamp(minute=35), articles=[row], source_window=morning_window(stamp()),
                                 providers=provider, clock=lambda: stamp(minute=35))
        writing = provider.claude.call_args.args[1]['articles']
        for reviewer in (provider.gemini, provider.openai):
            reviewer.assert_called_once()
            self.assertEqual(reviewer.call_args.args[1]['original_articles'], writing)
        self.assertEqual(provider.gemini.call_args.args[1], provider.openai.call_args.args[1])
        self.assertNotIn('PRIVATE_BOJ_PROSE', str(provider.mock_calls))
        self.assertNotIn('body', issue['article_refs'][0])
        with self.assertRaisesRegex(GenerationError, 'invalid_official_article'):
            _official_articles([original()], morning_window(stamp()), stamp())

    def test_repeat_read_next_day_keeps_first_real_observation_and_verification(self):
        row = policy_facts(original())
        storage = Storage()
        now = [stamp()]
        preparer = MorningNewsPreparer(storage, Mock(), clock=lambda: now[0])
        first = preparer._remember_identity(row, now[0])
        now[0] = stamp(day='2026-10-12')
        repeated = {**row, 'observed_at': now[0], 'body_verified_at': now[0]}
        remembered = preparer._remember_identity(repeated, now[0])
        self.assertEqual(remembered['body_verified_at'], first['body_verified_at'])
        self.assertEqual(remembered['observed_at'], first['observed_at'])
        self.assertTrue(valid_policy_fact_record(remembered))
        # Existing identity files must not manufacture a missing older time.
        for value in storage.values.values():
            value.pop('first_observed_at', None)
        remembered = preparer._remember_identity(repeated, now[0])
        self.assertNotIn('observed_at', remembered)
        self.assertTrue(valid_policy_fact_record(remembered))

    def test_intraday_selects_new_verified_policy_but_not_yesterdays_or_raw(self):
        row = policy_facts(original(day='2026-10-11'))
        row.update(observed_at=stamp(hour=10), body_verified_at=stamp(hour=10))
        window = intraday_window(stamp(hour=12))
        self.assertEqual(importance(row), 'monetary_policy')
        self.assertIsNone(importance(original()))
        found = select_candidate({'articles': [row]}, window, set())
        self.assertEqual(found[0][0], 'monetary_policy')
        self.assertEqual(select_candidate({'articles': [row]}, window, {(row['url'], row['published_date'])}), [])
        self.assertEqual(select_candidate({'articles': [policy_facts(original())]}, window, set()), [])
