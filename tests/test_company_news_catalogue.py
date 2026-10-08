"""Offline identity and URL boundaries for the dated Nikkei company catalogue."""
from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time, timedelta, timezone
from hashlib import sha256
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch

import company_news_catalogue as catalogue_module
from company_news_catalogue import (load_catalogue, normalize_issuer_name,
                                    source_url_matches, validate_source_config)


JST = timezone(timedelta(hours=9))
AS_OF = date(2026, 10, 8)
NOW = datetime(2026, 10, 9, 16, tzinfo=JST)
SOURCE_URL = ('https://indexes.nikkei.co.jp/nkave/archives/file/'
              'nikkei_225_price_adjustment_factor_jp.csv')
COMPONENT_URL = 'https://indexes.nikkei.co.jp/nkave/index/component?idx=nk225'
SOURCE_DIGEST = 'a' * 64
BUSINESS = '通信の仕組みをつくり、企業や家庭へサービスを提供する会社です。'
BUSINESS_URL = 'https://www.example.test/corporate/business/'


def universe():
    # Fictional identities make the safety checks independent of future index
    # replacements. Keep one alphabetic security code in the valid 225 rows.
    rows = [{'code': str(code), 'symbol': str(code) + '.T',
             'name': f'検証会社{code}'} for code in range(1000, 1224)]
    rows[0]['name'] = '検証通信'
    rows[1]['name'] = '検証通信ホールディングス'
    rows.append({'code': '285A', 'symbol': '285A.T', 'name': '検証半導体'})
    return {'schema_version': 1, 'index': 'nikkei225', 'as_of': AS_OF.isoformat(),
            'retrieved_at': '2026-10-08T18:00:00+09:00',
            'source': {'title': '日経公式構成銘柄の検証用資料', 'url': SOURCE_URL,
                       'component_url': COMPONENT_URL, 'sha256': SOURCE_DIGEST},
            'items': rows, 'scheduled_changes': []}


def editorial_row(symbol='1000.T', name='検証通信'):
    return {'symbol': symbol, 'name': name, 'business': BUSINESS,
            'life': '家庭や仕事で使う通信につながっています。',
            'watch': '発表した計画と実際の事業の状況を確認します。',
            'sources': [{'title': '検証用会社の事業紹介', 'url': BUSINESS_URL}],
            'reviewed_on': '2026-10-08'}


def editorial(*rows):
    return {'schema_version': 1, 'reviewed_on': '2026-10-08', 'items': list(rows)}


def source_config():
    return {'source_id': 'verified-company_news', 'symbol': '1000.T',
            'host': 'news.example.test',
            'path_pattern': r'/releases/\d{4}/\d{2}/\d{2}/[a-z0-9_-]+\.html'}


def universe_on(day, *, retrieved_day=None):
    document = universe()
    document['as_of'] = day.isoformat()
    document['retrieved_at'] = datetime.combine(retrieved_day or day, time(12), JST).isoformat()
    return document


class CatalogueFixture(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.universe_path = Path(self.directory.name) / 'universe.json'
        self.editorial_path = Path(self.directory.name) / 'editorial.json'

    def load(self, document=None, copy=None, **options):
        self.universe_path.write_text(json.dumps(universe() if document is None else document,
                                                ensure_ascii=False), encoding='utf-8')
        if copy is not None:
            self.editorial_path.write_text(json.dumps(copy, ensure_ascii=False), encoding='utf-8')
        elif self.editorial_path.exists():
            self.editorial_path.unlink()
        return load_catalogue(self.universe_path, self.editorial_path,
                              now=options.pop('now', NOW), **options)


class CatalogueIdentityTests(CatalogueFixture):
    def test_dated_225_identities_preserve_alpha_code_and_provenance(self):
        catalogue = self.load()
        self.assertEqual(len(catalogue.members), 225)
        self.assertTrue(catalogue.is_member('285A.T'))
        self.assertFalse(catalogue.is_member('9999.T'))
        self.assertFalse(catalogue.is_member('285A'))
        self.assertFalse(catalogue.is_member(None))
        self.assertEqual(catalogue.members['285A.T']['code'], '285A')
        self.assertEqual(catalogue.provenance, {
            'index': 'nikkei225', 'as_of': '2026-10-08',
            'retrieved_at': '2026-10-08T18:00:00+09:00',
            'source_url': SOURCE_URL, 'source_sha256': SOURCE_DIGEST, 'member_count': 225})
        row = catalogue.members['1000.T']
        self.assertEqual((row['code'], row['symbol'], row['name']), ('1000', '1000.T', '検証通信'))
        self.assertIsNone(row['business'])
        self.assertIsNone(row['business_url'])
        self.assertEqual(row['business_sources'], [])
        self.assertIsNone(row['business_reviewed_on'])

    def test_count_duplicates_symbol_mismatch_and_invalid_identity_fail_closed(self):
        invalid = []
        missing = universe(); missing['items'].pop(); invalid.append(missing)
        extra = universe(); extra['items'].append({'code': '9999', 'symbol': '9999.T', 'name': '余分な会社'}); invalid.append(extra)
        duplicate = universe(); duplicate['items'][-1] = deepcopy(duplicate['items'][0]); invalid.append(duplicate)
        mismatch = universe(); mismatch['items'][0]['symbol'] = '1001.T'; invalid.append(mismatch)
        for key, value in [('code', '1000/../../x'), ('code', '285a'),
                           ('symbol', '1000.T/extra'), ('name', ''), ('name', None)]:
            changed = universe(); changed['items'][0][key] = value; invalid.append(changed)
        for document in invalid:
            with self.subTest(first=document['items'][0], count=len(document['items'])), self.assertRaises(ValueError):
                self.load(document)

    def test_only_the_fixed_official_source_and_component_are_identity_evidence(self):
        for key, value in [('schema_version', 2), ('index', 'other225')]:
            changed = universe(); changed[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                self.load(changed)
        for field, value in [('url', SOURCE_URL.replace('https:', 'http:')),
                             ('url', SOURCE_URL + '?mirror=1'),
                             ('url', SOURCE_URL.replace('indexes.nikkei.co.jp', 'indexes.nikkei.co.jp.evil.test')),
                             ('component_url', COMPONENT_URL.replace('nk225', 'other')),
                             ('component_url', None), ('sha256', 'a' * 63),
                             ('sha256', 'z' * 64), ('sha256', None)]:
            changed = universe(); changed['source'][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                self.load(changed)

    def test_future_old_unparseable_and_timezone_free_metadata_are_rejected(self):
        for field, value in [('as_of', '2026-10-10'), ('as_of', '2026-09-24'),
                             ('as_of', '2026-10-8'), ('as_of', 'not-a-date'),
                             ('retrieved_at', '2026-10-10T12:00:00+09:00'),
                             ('retrieved_at', '2026-10-08T18:00:00'),
                             ('retrieved_at', 'not-a-timestamp')]:
            changed = universe(); changed[field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                self.load(changed)

    def test_grace_days_are_explicit_and_do_not_relabel_the_original_date(self):
        self.assertEqual(self.load(now=NOW + timedelta(days=13)).provenance['as_of'], '2026-10-08')
        with self.assertRaises(ValueError):
            self.load(now=NOW + timedelta(days=14))
        self.assertEqual(self.load(grace_days=1).provenance['as_of'], '2026-10-08')
        with self.assertRaises(ValueError):
            self.load(grace_days=0)
        same_day = datetime(2026, 10, 8, 20, tzinfo=JST)
        self.assertEqual(self.load(now=same_day, grace_days=0).provenance['as_of'], '2026-10-08')
        with self.assertRaises(ValueError):
            self.load(grace_days=-1)

    def test_scheduled_changes_do_not_authorize_unconfirmed_members(self):
        document = universe()
        document['scheduled_changes'] = [{'effective_on': '2026-10-10',
            'add': [{'code': '9999', 'symbol': '9999.T', 'name': '予定だけの会社'}],
            'remove': [deepcopy(document['items'][0])]}]
        catalogue = self.load(document)
        self.assertFalse(catalogue.is_member('9999.T'))
        self.assertIsNone(catalogue.match_issuer('予定だけの会社株式会社'))
        self.assertTrue(catalogue.is_member('1000.T'))

    def test_real_checked_in_universe_is_validated_at_its_own_dated_snapshot(self):
        root = Path(__file__).resolve().parents[1]
        path = root / 'static' / 'nikkei225-universe.json'
        document = json.loads(path.read_text(encoding='utf-8'))
        dated_now = datetime.combine(date.fromisoformat(document['as_of']), time(23, 59, 59), JST)
        catalogue = load_catalogue(path, root / 'static' / 'company-profile-editorial.json', now=dated_now)
        self.assertEqual(len(catalogue.members), 225)
        self.assertEqual(catalogue.provenance['as_of'], document['as_of'])
        self.assertEqual(catalogue.provenance['source_sha256'], document['source']['sha256'])
        self.assertEqual(set(catalogue.members), {row['symbol'] for row in document['items']})


class IssuerMatchingTests(CatalogueFixture):
    def test_normalization_handles_width_spacing_and_one_edge_corporate_designation(self):
        for value in ('株式会社　検証 通信', '検証通信株式会社', '（株）検証通信',
                      '検証通信(株)', '　検証\t通信\n'):
            with self.subTest(value=value):
                self.assertEqual(normalize_issuer_name(value), '検証通信')
        self.assertEqual(normalize_issuer_name('ＮＴＴ'), 'NTT')
        self.assertEqual(normalize_issuer_name('検証株式会社通信'), '検証株式会社通信')
        self.assertNotEqual(normalize_issuer_name('株式会社検証通信株式会社'), '検証通信')
        for value in (None, 1, {}, '', ' \t\n', '株式会社', '(株)'):
            with self.subTest(value=value):
                self.assertIsNone(normalize_issuer_name(value))

    def test_exact_normalized_identity_does_not_match_substrings_or_subsidiaries(self):
        catalogue = self.load()
        for value in ('検証通信', '株式会社検証通信', '検証 通信(株)'):
            self.assertEqual(catalogue.match_issuer(value)['symbol'], '1000.T')
        self.assertEqual(catalogue.match_issuer('検証通信ホールディングス株式会社')['symbol'], '1001.T')
        for value in ('検証', '通信', '検証通信サービス株式会社',
                      '検証通信の取引先', '検証通信ホールディングスの子会社', None):
            with self.subTest(value=value):
                self.assertIsNone(catalogue.match_issuer(value))

    def test_colliding_normalized_names_never_resolve_to_an_arbitrary_company(self):
        document = universe()
        document['items'][0]['name'] = '株式会社検証通信'
        document['items'][1]['name'] = '検証 通信(株)'
        # Either refusing the catalogue or retaining the 225 identities while
        # refusing this ambiguous issuer is safe; first-row-wins is unsafe.
        try:
            catalogue = self.load(document)
        except ValueError:
            return
        self.assertEqual(len(catalogue.members), 225)
        self.assertIsNone(catalogue.match_issuer('検証通信株式会社'))


class EditorialEvidenceTests(CatalogueFixture):
    def test_missing_editorial_keeps_the_identity_without_inventing_business(self):
        catalogue = self.load()
        self.assertTrue(catalogue.is_member('1000.T'))
        self.assertIsNone(catalogue.members['1000.T']['business'])
        self.assertIsNone(catalogue.members['1000.T']['business_url'])
        self.assertEqual(catalogue.members['1000.T']['business_sources'], [])
        without_path = load_catalogue(self.universe_path, None, now=NOW)
        self.assertIsNone(without_path.members['1000.T']['business'])

    def test_verified_editorial_is_attached_only_to_the_matching_member(self):
        catalogue = self.load(copy=editorial(editorial_row()))
        member = catalogue.members['1000.T']
        self.assertEqual(member['business'], BUSINESS)
        self.assertEqual(member['business_url'], BUSINESS_URL)
        self.assertEqual(member['business_sources'], editorial_row()['sources'])
        self.assertEqual(member['business_reviewed_on'], '2026-10-08')
        self.assertIsNone(catalogue.members['1001.T']['business'])

    def test_invalid_or_unconfirmed_editorial_does_not_fill_business(self):
        invalid = []
        for field, value in [('name', '別の会社'), ('business', ''), ('business', None),
                             ('reviewed_on', '2026-10-10'), ('reviewed_on', 'not-a-date'),
                             ('sources', [])]:
            row = editorial_row(); row[field] = value; invalid.append(row)
        for url in ('http://www.example.test/business',
                    'https://user:secret@www.example.test/business',
                    'https://127.0.0.1/business', 'javascript:alert(1)'):
            row = editorial_row(); row['sources'][0]['url'] = url; invalid.append(row)
        for row in invalid:
            with self.subTest(row=row):
                catalogue = self.load(copy=editorial(row, editorial_row('1001.T', '検証通信ホールディングス')))
                member = catalogue.members['1000.T']
                self.assertIsNone(member['business'])
                self.assertIsNone(member['business_url'])
                self.assertEqual(member['business_sources'], [])
                self.assertEqual(catalogue.members['1001.T']['business'], BUSINESS)
        unlisted = editorial_row('9999.T', '名簿外の会社')
        catalogue = self.load(copy=editorial(unlisted))
        self.assertNotIn('9999.T', catalogue.members)


class SourceUrlBoundaryTests(CatalogueFixture):
    def test_trusted_configuration_binds_source_identity_and_catalogue_member(self):
        config = validate_source_config(source_config(), self.load())
        for field, expected in source_config().items():
            self.assertEqual(config[field], expected)
        self.assertEqual(validate_source_config(source_config())['symbol'], '1000.T')
        changed = source_config(); changed['symbol'] = '9999.T'
        with self.assertRaises(ValueError):
            validate_source_config(changed, self.load())

    def test_configuration_rejects_missing_malformed_host_identity_and_regex(self):
        invalid = []
        for field in source_config():
            changed = source_config(); changed.pop(field); invalid.append(changed)
        for field, value in [('source_id', 'Uppercase'), ('source_id', 'not allowed'),
                             ('source_id', '../escape'), ('source_id', ''),
                             ('symbol', '1000'), ('symbol', '285a.T'),
                             ('host', 'NEWS.example.test'), ('host', '127.0.0.1'),
                             ('host', '[::1]'), ('host', 'news.example.test:443'),
                             ('host', 'https://news.example.test'), ('host', 'localhost'),
                             ('host', 'user@news.example.test'), ('host', 'news..example.test'),
                             ('path_pattern', ''), ('path_pattern', '['),
                             ('path_pattern', 'x' * 10000), ('path_pattern', None)]:
            changed = source_config(); changed[field] = value; invalid.append(changed)
        for config in invalid:
            with self.subTest(config=config), self.assertRaises(ValueError):
                validate_source_config(config)

    def test_matching_requires_the_whole_https_path_and_exact_bound_identity(self):
        config = validate_source_config(source_config())
        url = 'https://news.example.test/releases/2026/10/08/verified_1.html'
        kwargs = {'source_id': config['source_id'], 'symbol': config['symbol']}
        self.assertTrue(source_url_matches(url, config, **kwargs))
        self.assertFalse(source_url_matches(url, config, source_id='other-source', symbol=config['symbol']))
        self.assertFalse(source_url_matches(url, config, source_id=config['source_id'], symbol='1001.T'))
        for bad in (None, {}, url.replace('https:', 'http:'),
                    url.replace('news.example.test', 'news.example.test.evil.test'),
                    url.replace('news.example.test', '127.0.0.1'),
                    url.replace('news.example.test', 'user@news.example.test'),
                    url.replace('news.example.test', 'news.example.test:443'),
                    url.replace('news.example.test', 'news.example.test:invalid'),
                    url + '?download=1', url + '#fragment', url + '/another',
                    url + '.exe', url.replace('/releases/', '/prefix/releases/'),
                    url.replace('/releases/', '/private/')):
            with self.subTest(url=bad):
                self.assertFalse(source_url_matches(bad, config, **kwargs))


class CatalogueSnapshotTests(CatalogueFixture):
    def test_snapshot_is_detached_and_contains_only_membership_evidence(self):
        document = universe()
        document['items'][0].update(weight=0.5, price_adjustment_factor=7,
                                     business='未確認のCSV外の説明')
        catalogue = self.load(document, copy=editorial(editorial_row()))
        snapshot = catalogue.snapshot()
        self.assertEqual(snapshot['schema_version'], 1)
        self.assertEqual(snapshot['index'], 'nikkei225')
        self.assertEqual(snapshot['as_of'], catalogue.provenance['as_of'])
        self.assertEqual(snapshot['retrieved_at'], catalogue.provenance['retrieved_at'])
        self.assertEqual(snapshot['source']['url'], SOURCE_URL)
        self.assertEqual(snapshot['source']['component_url'], COMPONENT_URL)
        self.assertEqual(snapshot['source']['sha256'], SOURCE_DIGEST)
        self.assertEqual(len(snapshot['items']), 225)
        self.assertTrue(all(set(row) == {'code', 'symbol', 'name'} for row in snapshot['items']))
        self.assertNotIn('editorial', snapshot)
        self.assertNotIn(BUSINESS, json.dumps(snapshot, ensure_ascii=False))
        snapshot['items'][0]['name'] = '外部から変更した名前'
        snapshot['source']['url'] = 'https://evil.test/universe'
        self.assertEqual(catalogue.members['1000.T']['name'], '検証通信')
        self.assertEqual(catalogue.snapshot()['source']['url'], SOURCE_URL)

    def test_facts_hash_roundtrip_uses_sorted_identity_facts_not_business_or_retrieval(self):
        catalogue = self.load(copy=editorial(editorial_row()))
        facts = {'index': 'nikkei225', 'as_of': '2026-10-08',
                 'items': sorted(universe()['items'], key=lambda row: row['code'])}
        expected = sha256(json.dumps(facts, ensure_ascii=False, sort_keys=True,
                                    separators=(',', ':'), allow_nan=False).encode()).hexdigest()
        self.assertEqual(catalogue.facts_sha256, expected)
        altered = universe()
        altered['items'].reverse()
        altered['retrieved_at'] = '2026-10-09T12:00:00+09:00'
        reordered = self.load(altered)
        self.assertEqual(reordered.facts_sha256, expected)
        captured = catalogue.snapshot()
        # Verification uses the captured dated universe even if today's file
        # now contains a different name or an invalid unrelated revision.
        altered['items'][0]['name'] = '後日更新した会社名'
        self.universe_path.write_text(json.dumps(altered, ensure_ascii=False), encoding='utf-8')
        restored = load_catalogue(self.universe_path, None, snapshot=captured, now=NOW.timestamp())
        self.assertEqual(restored.facts_sha256, expected)
        self.assertEqual(restored.members['1000.T']['name'], '検証通信')
        damaged = deepcopy(captured); damaged['items'][0]['name'] += '訂正'
        revised = load_catalogue(self.universe_path, None, snapshot=damaged, now=NOW.timestamp())
        self.assertNotEqual(revised.facts_sha256, expected)


class CurrentCatalogueTests(CatalogueFixture):
    def setUp(self):
        super().setUp()
        self.seed_path = self.universe_path
        self.cache_path = Path(self.directory.name) / 'current-universe.json'
        catalogue_module._CURRENT_CACHE.clear()
        catalogue_module._SNAPSHOT_CACHE.clear()
        self.addCleanup(catalogue_module._CURRENT_CACHE.clear)
        self.addCleanup(catalogue_module._SNAPSHOT_CACHE.clear)

    def paths(self):
        return {'cache_path': self.cache_path, 'seed_path': self.seed_path,
                'editorial_path': self.editorial_path}

    @staticmethod
    def save(path, document):
        path.write_text(json.dumps(document, ensure_ascii=False), encoding='utf-8')

    def updater(self):
        def update(output_path, *, now=None):
            stamp = now if isinstance(now, datetime) else datetime.fromtimestamp(now, JST)
            document = universe_on(stamp.astimezone(JST).date())
            self.save(Path(output_path), document)
            return deepcopy(document)
        return Mock(side_effect=update)

    def test_current_dated_static_seed_skips_the_default_lazy_fetch(self):
        self.save(self.seed_path, universe_on(NOW.date()))
        with patch('scripts.update_nikkei225.update_universe',
                   side_effect=AssertionError('fresh local universe must not fetch')) as update:
            catalogue = catalogue_module.current_catalogue(NOW, **self.paths())
        update.assert_not_called()
        self.assertTrue(catalogue.provenance['verified_today'])
        self.assertEqual(catalogue.provenance['as_of'], NOW.date().isoformat())
        self.assertFalse(self.cache_path.exists())

    def test_today_retrieval_of_an_older_original_date_also_skips_fetch(self):
        self.save(self.seed_path, universe_on(NOW.date() - timedelta(days=3), retrieved_day=NOW.date()))
        update = self.updater()
        catalogue = catalogue_module.current_catalogue(NOW, updater=update, **self.paths())
        update.assert_not_called()
        self.assertEqual(catalogue.provenance['as_of'], '2026-10-06')

    def test_tomorrow_fetches_once_and_preserves_the_static_seed(self):
        self.save(self.seed_path, universe_on(NOW.date()))
        seed_bytes = self.seed_path.read_bytes()
        update = self.updater()
        self.assertTrue(catalogue_module.current_catalogue(NOW, updater=update,
                                                         **self.paths()).provenance['verified_today'])
        update.assert_not_called()
        tomorrow = NOW + timedelta(days=1)
        first = catalogue_module.current_catalogue(tomorrow, updater=update, **self.paths())
        second = catalogue_module.current_catalogue(tomorrow + timedelta(minutes=1),
                                                     updater=update, **self.paths())
        self.assertEqual(update.call_count, 1)
        self.assertEqual(first.provenance['as_of'], '2026-10-10')
        self.assertTrue(first.provenance['verified_today'])
        self.assertEqual(first.facts_sha256, second.facts_sha256)
        self.assertEqual(json.loads(self.cache_path.read_text())['as_of'], '2026-10-10')
        self.assertEqual(self.seed_path.read_bytes(), seed_bytes)
        args, kwargs = update.call_args
        output_path = kwargs.get('output_path', args[0] if args else None)
        self.assertEqual(Path(output_path), self.cache_path)

    def test_concurrent_requests_share_one_daily_fetch(self):
        self.save(self.seed_path, universe_on(NOW.date() - timedelta(days=1)))
        entered, release = threading.Event(), threading.Event()
        barrier = threading.Barrier(8)
        save_update = self.updater()
        def slow_update(output_path, *, now=None):
            entered.set()
            if not release.wait(3):
                raise AssertionError('test release timed out')
            return save_update(output_path, now=now)
        update = Mock(side_effect=slow_update)
        def current():
            barrier.wait(timeout=3)
            return catalogue_module.current_catalogue(NOW, updater=update, **self.paths())
        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = [pool.submit(current) for _ in range(8)]
            try:
                self.assertTrue(entered.wait(3))
                # Give the other callers a chance to reach the same daily gate.
                release.wait(.05)
            finally:
                release.set()
            catalogues = [future.result(timeout=3) for future in futures]
        self.assertEqual(update.call_count, 1)
        self.assertEqual({catalogue.facts_sha256 for catalogue in catalogues},
                         {catalogues[0].facts_sha256})
        self.assertTrue(all(catalogue.provenance['verified_today'] for catalogue in catalogues))

    def test_outage_keeps_previous_good_cache_and_never_retries_that_day(self):
        self.save(self.seed_path, universe_on(NOW.date() - timedelta(days=2)))
        cached = universe_on(NOW.date() - timedelta(days=1))
        cached['items'][0]['name'] = '確認済みの別名'
        self.save(self.cache_path, cached)
        previous_bytes = self.cache_path.read_bytes()
        update = Mock(side_effect=TimeoutError('offline synthetic outage'))
        first = catalogue_module.current_catalogue(NOW, updater=update, **self.paths())
        second = catalogue_module.current_catalogue(NOW + timedelta(minutes=1),
                                                     updater=update, **self.paths())
        self.assertEqual(update.call_count, 1)
        self.assertEqual(first.members['1000.T']['name'], '確認済みの別名')
        self.assertEqual(first.provenance['as_of'], '2026-10-08')
        self.assertFalse(first.provenance['verified_today'])
        self.assertEqual(first.facts_sha256, second.facts_sha256)
        self.assertEqual(self.cache_path.read_bytes(), previous_bytes)

    def test_read_only_loader_selects_latest_valid_local_file_without_fetch(self):
        self.save(self.seed_path, universe_on(NOW.date() - timedelta(days=1)))
        cached = universe_on(NOW.date())
        cached['items'][0]['name'] = '新しい日付の確認済み会社名'
        self.save(self.cache_path, cached)
        with patch('scripts.update_nikkei225.update_universe',
                   side_effect=AssertionError('read-only loading must never fetch')) as update:
            catalogue = catalogue_module.load_current_snapshot(NOW, **self.paths())
        update.assert_not_called()
        self.assertEqual(catalogue.provenance['as_of'], '2026-10-09')
        self.assertEqual(catalogue.members['1000.T']['name'], '新しい日付の確認済み会社名')

    def test_read_only_loader_ignores_invalid_newer_cache_and_keeps_valid_seed(self):
        self.save(self.seed_path, universe_on(NOW.date() - timedelta(days=1)))
        invalid = universe_on(NOW.date()); invalid['source']['url'] = 'https://evil.test/list.csv'
        self.save(self.cache_path, invalid)
        with patch('scripts.update_nikkei225.update_universe',
                   side_effect=AssertionError('read-only loading must never fetch')) as update:
            catalogue = catalogue_module.load_current_snapshot(NOW, **self.paths())
        update.assert_not_called()
        self.assertEqual(catalogue.provenance['as_of'], '2026-10-08')

    def test_no_valid_local_or_fetched_universe_fails_closed(self):
        for invalid in (universe_on(NOW.date() - timedelta(days=15)),
                        universe_on(NOW.date() + timedelta(days=1)), {'items': []}):
            with self.subTest(document=invalid.get('as_of')):
                catalogue_module._CURRENT_CACHE.clear()
                catalogue_module._SNAPSHOT_CACHE.clear()
                self.save(self.seed_path, invalid)
                self.save(self.cache_path, invalid)
                with patch('scripts.update_nikkei225.update_universe',
                           side_effect=AssertionError('read-only loading must never fetch')) as update:
                    with self.assertRaises(ValueError):
                        catalogue_module.load_current_snapshot(NOW, **self.paths())
                update.assert_not_called()
                offline = Mock(side_effect=TimeoutError('offline synthetic outage'))
                with self.assertRaises(ValueError):
                    catalogue_module.current_catalogue(NOW, updater=offline, **self.paths())
                self.assertLessEqual(offline.call_count, 1)


if __name__ == '__main__':
    unittest.main()
