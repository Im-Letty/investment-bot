"""Short CC0 business facts need both official name and active listing proof."""
from copy import deepcopy
from datetime import date, datetime, timezone
from email.utils import formatdate
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch

import requests

from company_business import (CompanyBusinesses, WikidataBusinessProvider, BusinessFailure,
                              EXCHANGES, TTL, RETAIN, RETRY, MAX_FACTS, normalize_name,
                              official_identity, verify_entity, fact_ids, _valid_record,
                              read_candidate_hints, official_company_overview)

NOW = datetime(2026, 10, 11, 11, tzinfo=timezone.utc).timestamp()
TODAY = date(2026, 10, 11)


def company(code='7203', name='トヨタ自動車', exchange='Tokyo'):
    return dict(code=code, name=name, exchange=exchange,
                symbol=code + ('.T' if exchange == 'Tokyo' else '.JP'))


def value_snak(prop, value):
    return dict(snaktype='value', property=prop, datavalue={'value': value})


def item_claim(prop, qid, rank='normal', qualifiers=None):
    return dict(rank=rank, mainsnak=value_snak(prop, {'id': qid, 'entity-type': 'item'}),
                qualifiers=qualifiers or {})


def time_snak(year=2020, month=1, day=1, precision=11):
    return value_snak('P580', {'time': f'+{year:04d}-{month:02d}-{day:02d}T00:00:00Z',
                             'precision': precision,
                             'calendarmodel': 'http://www.wikidata.org/entity/Q1985727'})


def entity(qid='Q53268', *, name='トヨタ自動車', code='7203', exchange='Tokyo', description=True):
    listing = item_claim('P414', EXCHANGES[exchange], qualifiers={'P249': [value_snak('P249', code)]})
    value = dict(id=qid, labels={'ja': {'language': 'ja', 'value': name}}, aliases={'ja': []},
                 descriptions={'ja': {'language': 'ja', 'value': '愛知県豊田市にある自動車メーカー'}} if description else {},
                 claims={'P414': [listing], 'P452': [item_claim('P452', 'Q190')],
                         'P1056': [item_claim('P1056', 'Q1420')]})
    return value


def saved(symbol='7203.T', *, now=NOW, name='トヨタ自動車', exchange='Tokyo'):
    official = company(symbol.split('.')[0], name, exchange)
    identity = official_identity(symbol, official)
    return dict(symbol=symbol, identity=identity,
                proof=verify_entity(entity(name=name, code=official['code'], exchange=exchange), identity, TODAY),
                fetched_at=now, facts=dict(description='愛知県豊田市にある自動車メーカー',
                    industries=[dict(id='Q190', label='自動車産業')], products=[dict(id='Q1420', label='自動車')]))


def wait_until(condition, timeout=2):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if condition():
            return
        time.sleep(.005)
    raise AssertionError('business background operation did not finish')


class Response:
    def __init__(self, data, status=200, headers=None):
        self.status_code, self.headers = status, headers or {}
        self.parts = [data if isinstance(data, bytes) else json.dumps(data).encode()]
        self.raw = self; self.reads = 0
    def __enter__(self):
        return self
    def __exit__(self, *args):
        return None
    def read1(self, *args, **kwargs):
        self.reads += 1
        return self.parts.pop(0) if self.parts else b''


class IdentityTests(unittest.TestCase):
    def test_only_nfkc_whitespace_and_corporate_form_are_normalized(self):
        self.assertEqual(normalize_name(' 株式会社 トヨタ 自動車 '), 'トヨタ自動車')
        self.assertEqual(normalize_name('ＡＢＣ株式会社'), 'ABC')
        self.assertEqual(normalize_name('（株）ＡＢＣ'), 'ABC')
        self.assertEqual(normalize_name('ＡＢＣ（株）'), 'ABC')
        self.assertNotEqual(normalize_name('株ABC'), normalize_name('ABC'))
        self.assertNotEqual(normalize_name('トヨタ自動車HD'), normalize_name('トヨタ自動車'))
        self.assertNotEqual(normalize_name('トヨタ自動車'), normalize_name('トヨタ車体'))

    def test_official_code_market_and_canonical_symbol_must_match(self):
        for bad in ['7203', 'AAPL', '7203.T?query=x', '../7203.T', None]:
            self.assertIsNone(official_identity(bad, company()))
        self.assertIsNone(official_identity('7203.JP', company()))
        self.assertIsNone(official_identity('7203.T', company(code='7204')))
        self.assertIsNone(official_identity('7203.T', company(exchange='Nagoya')))
        self.assertIsNone(official_identity('7203.T', company(exchange='Unknown')))

    def test_name_and_paired_exchange_code_are_both_required(self):
        identity = official_identity('7203.T', company())
        self.assertIsNotNone(verify_entity(entity(), identity, TODAY))
        self.assertIsNone(verify_entity(entity(name='トヨタ車体'), identity, TODAY))
        self.assertIsNone(verify_entity(entity(code='7204'), identity, TODAY))
        self.assertIsNone(verify_entity(entity(exchange='Nagoya'), identity, TODAY))
        raw = entity(); raw['claims']['P249'] = [value_snak('P249', '7203')]
        del raw['claims']['P414'][0]['qualifiers']['P249']
        self.assertIsNone(verify_entity(raw, identity, TODAY))

    def test_code_from_other_exchange_claim_cannot_be_reused(self):
        identity = official_identity('7203.T', company())
        raw = entity(code='7204')
        raw['claims']['P414'].append(entity(exchange='Nagoya')['claims']['P414'][0])
        self.assertIsNone(verify_entity(raw, identity, TODAY))

    def test_secondary_official_listing_can_prove_same_company_and_code(self):
        official = company('6147', 'ヤマザキ', 'Sapporo')
        official['other_listings'] = [dict(code='6147', name='（株）ヤマザキ', exchange='Fukuoka')]
        identity = official_identity('6147.JP', official)
        raw = entity(name='ヤマザキ', code='6147', exchange='Fukuoka')
        proof = verify_entity(raw, identity, TODAY)
        self.assertEqual(proof['exchange'], 'Fukuoka')
        value = saved('6147.JP', name='ヤマザキ', exchange='Sapporo')
        value.update(identity=identity, proof=proof)
        self.assertIsNotNone(_valid_record(value, NOW, identity))
        # An unregistered listing must not become proof merely by sharing a code.
        del official['other_listings']
        current_identity = official_identity('6147.JP', official)
        self.assertIsNone(verify_entity(raw, current_identity, TODAY))
        self.assertIsNone(_valid_record(value, NOW, current_identity))
        raw['claims']['P414'][0]['qualifiers']['P582'] = [value_snak('P582', {'time': '+2026-01-01T00:00:00Z'})]
        self.assertIsNone(verify_entity(raw, identity, TODAY))

    def test_wrong_name_code_unknown_exchange_and_forged_saved_pair_are_rejected(self):
        official = company('6147', 'ヤマザキ', 'Sapporo')
        raw = entity(name='ヤマザキ', code='6147', exchange='Fukuoka')
        for other in [dict(code='6147', name='山崎製パン', exchange='Fukuoka'),
                      dict(code='6148', name='ヤマザキ', exchange='Fukuoka'),
                      dict(code='6147', name='ヤマザキ', exchange='Unknown')]:
            official['other_listings'] = [other]
            self.assertIsNone(verify_entity(raw, official_identity('6147.JP', official), TODAY))
        official['other_listings'] = [dict(code='6147', name='ヤマザキ', exchange='Fukuoka')]
        value = saved('6147.JP', name='ヤマザキ', exchange='Sapporo')
        value['identity'] = official_identity('6147.JP', official)
        value['proof'] = verify_entity(raw, value['identity'], TODAY)
        value['identity']['listings'][0]['exchange_id'] = EXCHANGES['Tokyo']
        self.assertIsNone(_valid_record(value, NOW))

    def test_current_japanese_alias_can_match_official_name(self):
        identity = official_identity('7203.T', company())
        raw = entity(name='Toyota Motor Corporation')
        raw['aliases']['ja'] = [{'language': 'ja', 'value': 'トヨタ自動車株式会社'}]
        self.assertIsNotNone(verify_entity(raw, identity, TODAY))
        raw['aliases']['ja'][0]['language'] = 'en'
        self.assertIsNone(verify_entity(raw, identity, TODAY))

    def test_japanese_language_roman_brand_name_can_match_exactly(self):
        official = company('3697', 'SHIFT')
        identity = official_identity('3697.T', official)
        self.assertIsNotNone(verify_entity(entity(name='SHIFT', code='3697'), identity, TODAY))

    def test_deprecated_ended_future_and_unknown_start_listings_rejected(self):
        identity = official_identity('7203.T', company())
        for change in ['deprecated', 'ended', 'future', 'unknown', 'current_year_approximate']:
            raw = entity(); claim = raw['claims']['P414'][0]
            if change == 'deprecated':
                claim['rank'] = 'deprecated'
            elif change == 'ended':
                claim['qualifiers']['P582'] = [value_snak('P582', {'time': '+2020-01-01T00:00:00Z'})]
            elif change == 'future':
                claim['qualifiers']['P580'] = [time_snak(year=2027)]
            elif change == 'unknown':
                claim['qualifiers']['P580'] = [{'snaktype': 'somevalue', 'property': 'P580'}]
            else:
                claim['qualifiers']['P580'] = [time_snak(year=2026, month=0, day=0, precision=9)]
            self.assertIsNone(verify_entity(raw, identity, TODAY), change)

    def test_past_precise_and_past_approximate_start_are_accepted(self):
        identity = official_identity('7203.T', company())
        for start in [time_snak(), time_snak(year=1952, month=0, day=0, precision=9),
                      time_snak(year=2026, month=9, day=0, precision=10)]:
            raw = entity(); raw['claims']['P414'][0]['qualifiers']['P580'] = [start]
            self.assertIsNotNone(verify_entity(raw, identity, TODAY))

    def test_same_day_future_precise_time_is_not_active_yet(self):
        identity = official_identity('7203.T', company())
        raw = entity()
        start = time_snak(year=2026, month=10, day=11, precision=14)
        start['datavalue']['value']['time'] = '+2026-10-11T15:00:00Z'
        raw['claims']['P414'][0]['qualifiers']['P580'] = [start]
        self.assertIsNone(verify_entity(raw, identity, TODAY, NOW))
        start['datavalue']['value']['time'] = '+2026-10-11T09:00:00Z'
        self.assertIsNotNone(verify_entity(raw, identity, TODAY, NOW))

    def test_all_regional_exchanges_require_their_own_exchange_and_code(self):
        for exchange in ['Nagoya', 'Sapporo', 'Fukuoka']:
            official = company('1734', '北日本企業', exchange)
            identity = official_identity('1734.JP', official)
            self.assertIsNotNone(verify_entity(entity(name='北日本企業', code='1734', exchange=exchange), identity, TODAY))
            self.assertIsNone(verify_entity(entity(name='北日本企業', code='1734'), identity, TODAY))

    def test_fact_ids_are_current_direct_claims_and_maximum_eight(self):
        raw = entity()
        raw['claims']['P1056'] = [item_claim('P1056', 'Q' + str(1000 + number)) for number in range(20)]
        raw['claims']['P1056'][0]['rank'] = 'deprecated'
        raw['claims']['P1056'][1]['qualifiers']['P582'] = [{'snaktype': 'somevalue'}]
        raw['claims']['P1056'][2]['qualifiers']['P580'] = [time_snak(year=2027)]
        fields, ids = fact_ids(raw, TODAY)
        self.assertEqual(len(ids), MAX_FACTS)
        self.assertNotIn('Q1000', ids); self.assertNotIn('Q1001', ids); self.assertNotIn('Q1002', ids)
        self.assertEqual(fields['industries'], ['Q190'])


class OfficialOverviewTests(unittest.TestCase):
    def test_basic_classification_does_not_assert_specific_products_or_business(self):
        row = dict(company(), market='プライム（内国株式）', industry='輸送用機器',
                   as_of='2026-09-30', source_url='https://www.jpx.co.jp/markets/statistics-equities/misc/01.html')
        result = official_company_overview('7203.T', row)
        self.assertEqual(result['industry'], '輸送用機器')
        self.assertEqual(result['kind'], 'official_listing_overview')
        self.assertFalse(result['specific_business_description'])
        self.assertNotIn('fetched_at', result)
        self.assertNotIn('products', result)
        self.assertNotIn('メーカー', result['text'])

    def test_regional_missing_industry_remains_unknown_with_official_market(self):
        row = dict(company('1449', '株式会社FUJIジャパン', 'Sapporo'), market='本則市場',
                   as_of='2026-10-11', source_url='https://www.sse.or.jp/listing/list')
        result = official_company_overview('1449.JP', row)
        self.assertIsNone(result['industry'])
        self.assertEqual(result['text'], '上場市場：本則市場')
        self.assertFalse(result['specific_business_description'])

    def test_wrong_symbol_exchange_unknown_source_and_invalid_dates_are_rejected(self):
        row = dict(company(), market='プライム（内国株式）', industry='輸送用機器',
                   as_of='2026-09-30', source_url='https://www.jpx.co.jp/markets/statistics-equities/misc/01.html')
        self.assertIsNone(official_company_overview('7204.T', row))
        self.assertIsNone(official_company_overview('7203.JP', row))
        self.assertIsNone(official_company_overview('7203.T', dict(row, source_url='https://example.com/')))
        self.assertIsNone(official_company_overview('7203.T', dict(row, as_of='2026-02-30')))
        self.assertIsNone(official_company_overview('7203.T', dict(row, as_of='2026-10-12'), today=TODAY))
        self.assertIsNone(official_company_overview('7203.T', dict(row, industry='bad\x00data')))


class ProviderTests(unittest.TestCase):
    def setUp(self):
        self.now = NOW
        self.session = Mock(); self.session.headers = {}
        self.factory = Mock(return_value=self.session)
        self.provider = WikidataBusinessProvider(session_factory=self.factory, now=lambda: self.now)

    def responses(self, raw=None, labels=None):
        raw = raw or entity()
        labels = labels or {'Q190': {'id': 'Q190', 'labels': {'ja': {'language': 'ja', 'value': '自動車産業'}}},
                            'Q1420': {'id': 'Q1420', 'labels': {'ja': {'language': 'ja', 'value': '自動車'}}}}
        self.session.get.side_effect = [Response({'search': [{'id': raw['id']}]}),
                                       Response({'entities': {raw['id']: raw}}),
                                       Response({'entities': labels})]

    def test_verified_short_description_and_fact_labels_only_three_fixed_requests(self):
        self.responses()
        result = self.provider('7203.T', company())
        self.assertEqual(result['facts']['description'], '愛知県豊田市にある自動車メーカー')
        self.assertEqual(result['facts']['products'], [{'id': 'Q1420', 'label': '自動車'}])
        self.assertEqual(result['proof']['entity_id'], 'Q53268')
        self.assertEqual(self.session.get.call_count, 3)
        for call in self.session.get.call_args_list:
            self.assertEqual(call.args, ('https://www.wikidata.org/w/api.php',))
            self.assertFalse(call.kwargs['allow_redirects']); self.assertTrue(call.kwargs['stream'])
            self.assertEqual(call.kwargs['params']['maxlag'], '5')
        search = self.session.get.call_args_list[0].kwargs['params']
        self.assertEqual(search['language'], 'ja'); self.assertEqual(search['limit'], '5')
        self.assertNotIn('claims', result); self.assertNotIn('Wikipedia', json.dumps(result))

    def test_unknown_identity_makes_no_request(self):
        result = self.provider('7203.T', company(name=''))
        self.assertEqual(result.reason, 'identity_unconfirmed'); self.factory.assert_not_called()

    def test_preloaded_hint_skips_search_but_verifies_fresh_entity(self):
        self.provider.candidate_hints = {'7203.T': dict(identity=official_identity('7203.T', company()), entity_ids=['Q53268'])}
        self.session.get.side_effect = [Response({'entities': {'Q53268': entity()}}),
                                       Response({'entities': {}})]
        result = self.provider('7203.T', company())
        self.assertEqual(result['proof']['entity_id'], 'Q53268')
        self.assertEqual(self.session.get.call_count, 2)
        self.assertEqual(self.session.get.call_args_list[0].kwargs['params']['action'], 'wbgetentities')
        self.assertEqual(self.session.get.call_args_list[0].kwargs['params']['maxlag'], '5')

    def test_wrong_company_or_ambiguous_hint_cannot_be_displayed_as_facts(self):
        identity = official_identity('7203.T', company())
        for values in [{'Q53268': entity(code='7204')},
                       {'Q53268': entity(), 'Q333': entity(qid='Q333')}]:
            self.provider.candidate_hints = {'7203.T': dict(identity=identity, entity_ids=list(values))}
            self.session.get.side_effect = [Response({'entities': values})]
            result = self.provider('7203.T', company())
            self.assertEqual(result.reason, 'identity_unconfirmed')
            self.assertNotIn('facts', vars(result))

    def test_hint_for_old_official_name_does_not_replace_name_search(self):
        self.provider.candidate_hints = {'7203.T': dict(identity=official_identity('7203.T', company(name='以前の会社')), entity_ids=['Q999'])}
        self.responses()
        self.assertEqual(self.provider('7203.T', company())['proof']['entity_id'], 'Q53268')
        self.assertEqual(self.session.get.call_args_list[0].kwargs['params']['action'], 'wbsearchentities')

    def test_obsolete_hint_is_discarded_before_next_bounded_name_search(self):
        self.provider.candidate_hints = {'7203.T': dict(identity=official_identity('7203.T', company()), entity_ids=['Q53268'])}
        self.session.get.side_effect = [Response({'entities': {'Q53268': entity(code='7204')}})]
        first = self.provider('7203.T', company())
        self.assertEqual(first.reason, 'identity_unconfirmed')
        self.assertEqual(first.retry_after_seconds, 30)
        self.assertNotIn('7203.T', self.provider.candidate_hints)
        self.session.get.reset_mock(); self.responses()
        self.assertEqual(self.provider('7203.T', company())['proof']['entity_id'], 'Q53268')
        self.assertEqual(self.session.get.call_args_list[0].kwargs['params']['action'], 'wbsearchentities')

    def test_explicit_interactive_requests_omit_only_maxlag(self):
        self.responses()
        self.provider.interactive = True
        result = self.provider('7203.T', company())
        self.assertEqual(result['proof']['entity_id'], 'Q53268')
        self.assertEqual(self.session.get.call_count, 3)
        for call in self.session.get.call_args_list:
            self.assertNotIn('maxlag', call.kwargs['params'])
            self.assertEqual(call.args, ('https://www.wikidata.org/w/api.php',))
            self.assertFalse(call.kwargs['allow_redirects'])
        self.assertFalse(WikidataBusinessProvider(interactive='true').interactive)

    def test_search_missing_and_name_code_mismatch_are_not_business_facts(self):
        self.session.get.side_effect = [Response({'search': []})]
        self.assertEqual(self.provider('7203.T', company()).reason, 'source_missing')
        self.responses(entity(code='7204'))
        self.assertEqual(self.provider('7203.T', company()).reason, 'identity_unconfirmed')
        self.assertEqual(self.session.get.call_count, 3)

    def test_two_entities_matching_identity_are_ambiguous_not_first_result(self):
        values = {'Q53268': entity(), 'Q333': entity(qid='Q333')}
        self.session.get.side_effect = [Response({'search': [{'id': key} for key in values]}),
                                       Response({'entities': values})]
        self.assertEqual(self.provider('7203.T', company()).reason, 'identity_unconfirmed')

    def test_no_japanese_description_can_use_direct_japanese_fact_labels(self):
        self.responses(entity(description=False))
        result = self.provider('7203.T', company())
        self.assertIsNone(result['facts']['description'])
        self.assertEqual(result['facts']['industries'][0]['label'], '自動車産業')

    def test_english_labels_and_descriptions_are_not_translated_or_generated(self):
        raw = entity(description=False)
        raw['descriptions']['en'] = {'language': 'en', 'value': 'car maker'}
        labels = {qid: {'id': qid, 'labels': {'en': {'language': 'en', 'value': 'cars'}}}
                  for qid in ['Q190', 'Q1420']}
        self.responses(raw, labels)
        self.assertEqual(self.provider('7203.T', company()).reason, 'source_missing')

    def test_optional_labels_failure_keeps_verified_description(self):
        self.responses()
        self.session.get.side_effect = [Response({'search': [{'id': 'Q53268'}]}),
                                       Response({'entities': {'Q53268': entity()}}),
                                       Response(b'private body', status=503)]
        result = self.provider('7203.T', company())
        self.assertEqual(result['facts']['description'], '愛知県豊田市にある自動車メーカー')
        self.assertEqual(result['facts']['products'], [])

    def test_429_does_not_read_body_and_stops_next_selected_request(self):
        response = Response(b'private token', status=429, headers={'Retry-After': '999999'})
        self.session.get.return_value = response
        result = self.provider('7203.T', company())
        self.assertEqual(result.reason, 'fetch_error'); self.assertEqual(result.retry_after_seconds, 999999)
        self.assertEqual(response.reads, 0)
        self.assertEqual(self.provider('7203.T', company()).reason, 'fetch_error')
        self.assertEqual(self.session.get.call_count, 1)

    def test_http_200_maxlag_or_ratelimited_shares_minimum_provider_pause(self):
        for code in ('maxlag', 'ratelimited', 'ratelimit'):
            self.provider._retry_at = 0; self.session.get.reset_mock()
            self.session.get.side_effect = None
            self.session.get.return_value = Response({'error': {'code': code, 'info': 'private server detail'}},
                                                    headers={'Retry-After': '5'})
            first = self.provider('7203.T', company())
            self.assertEqual(first.reason, 'fetch_error'); self.assertEqual(first.retry_after_seconds, 30)
            self.assertNotIn('private', repr(vars(first)))
            next_request = self.provider('2317.T', company('2317', 'システナ'))
            self.assertEqual(next_request.reason, 'fetch_error'); self.assertEqual(self.session.get.call_count, 1)
            self.now += 30
            self.responses()
            self.assertEqual(self.provider('7203.T', company())['proof']['entity_id'], 'Q53268')
            self.assertEqual(self.session.get.call_args_list[-1].kwargs['params']['maxlag'], '5')

    def test_long_retry_after_is_never_shortened_and_unknown_error_stays_fixed(self):
        self.session.get.return_value = Response({'error': {'code': 'maxlag', 'info': 'private'}},
                                                headers={'Retry-After': '999999'})
        self.assertEqual(self.provider('7203.T', company()).retry_after_seconds, 999999)
        self.provider._retry_at = 0
        self.session.get.return_value = Response({'error': {'code': 'some_unknown_error', 'info': 'private'}})
        self.assertEqual(self.provider('7203.T', company()).reason, 'fetch_error')
        self.assertEqual(self.provider.retry_after_seconds, 0)

    def test_interactive_mode_cannot_bypass_a_previous_pause(self):
        self.session.get.return_value = Response({'error': {'code': 'maxlag'}}, headers={'Retry-After': '5'})
        self.assertEqual(self.provider('7203.T', company()).retry_after_seconds, 30)
        self.provider.interactive = True
        self.assertEqual(self.provider('7203.T', company()).reason, 'fetch_error')
        self.assertEqual(self.session.get.call_count, 1)
        self.now += 30; self.responses()
        self.assertEqual(self.provider('7203.T', company())['proof']['entity_id'], 'Q53268')

    def test_503_retry_after_is_shared_without_reading_error_body(self):
        response = Response(b'private', status=503, headers={'Retry-After': '3600'})
        self.session.get.return_value = response
        self.assertEqual(self.provider('7203.T', company()).retry_after_seconds, 3600)
        self.assertEqual(response.reads, 0)
        self.assertEqual(self.provider('2317.T', company('2317', 'システナ')).reason, 'fetch_error')
        self.assertEqual(self.session.get.call_count, 1)

    def test_http_date_retry_after_longer_than_fifteen_minutes_is_preserved(self):
        self.session.get.return_value = Response(b'private', status=429,
            headers={'Retry-After': formatdate(self.now + 7200, usegmt=True)})
        self.assertEqual(self.provider('7203.T', company()).retry_after_seconds, 7200)
        self.now += 7199
        self.assertEqual(self.provider('7203.T', company()).retry_after_seconds, 1)
        self.assertEqual(self.session.get.call_count, 1)

    def test_other_workers_and_restarts_observe_the_longest_saved_pause(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'business.backoff.json'
            first = WikidataBusinessProvider(session_factory=self.factory, now=lambda: self.now,
                interactive=True, cooldown_path=path)
            self.session.get.return_value = Response(b'private', status=429, headers={'Retry-After': '3600'})
            self.assertEqual(first('7203.T', company()).retry_after_seconds, 3600)
            second_factory = Mock()
            second = WikidataBusinessProvider(session_factory=second_factory, now=lambda: self.now,
                interactive=True, cooldown_path=path)
            self.assertEqual(second('2317.T', company('2317', 'システナ')).retry_after_seconds, 3600)
            second_factory.assert_not_called()
            second._reset_process(); self.assertEqual(second.retry_after_seconds, 3600)
            second._backoff('30'); self.assertEqual(second.retry_after_seconds, 3600)
            self.assertNotIn('private', path.read_text())
            self.now += 3599; self.assertEqual(second.retry_after_seconds, 1)
            self.now += 1; self.assertEqual(second.retry_after_seconds, 0)

    def test_malformed_large_slow_and_transport_failures_have_fixed_reason(self):
        for response, expected in [(Response(b'private invalid json'), 'invalid'),
                                   (Response(b'x' * 40_001), 'invalid'),
                                   (Response({'error': {'info': 'private maxlag'}}), 'fetch_error')]:
            self.session.get.return_value = response
            failure = self.provider('7203.T', company())
            self.assertEqual(failure.reason, expected); self.assertNotIn('private', repr(vars(failure)))
        self.session.get.side_effect = requests.Timeout('private credential')
        self.assertEqual(self.provider('7203.T', company()).reason, 'fetch_error')
        self.session.get.side_effect = None
        self.provider.monotonic = Mock(side_effect=[0, 1, 16])
        self.session.get.return_value = Response({'search': []})
        self.assertEqual(self.provider('7203.T', company()).reason, 'fetch_error')

    def test_fork_starts_fresh_session(self):
        self.responses(); self.provider('7203.T', company())
        self.responses()
        with patch('company_business.os.getpid', return_value=self.provider._pid + 1):
            result = self.provider('7203.T', company())
        self.assertEqual(result['proof']['entity_id'], 'Q53268'); self.assertEqual(self.factory.call_count, 2)


class CacheTests(unittest.TestCase):
    def setUp(self):
        self.now = NOW
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'businesses.json'

    def cache(self, loader=None, **kwargs):
        return CompanyBusinesses(loader or (lambda symbol, row: saved(symbol, now=self.now, name=row['name'], exchange=row['exchange'])),
                                 cache_path=self.path, now=lambda: self.now, **kwargs)

    def wait_done(self, cache, symbol='7203.T', official=None):
        wait_until(lambda: not cache.get(symbol, official or company())['refreshing'])

    def test_immediate_selected_detail_singleflight_and_available_contract(self):
        release = threading.Event(); calls = []
        def load(symbol, row):
            calls.append(symbol); release.wait(2); return saved(symbol, now=self.now)
        cache = self.cache(load)
        started = time.monotonic(); first = cache.get('7203.T', company())
        self.assertLess(time.monotonic() - started, .1); self.assertEqual(first['field_status'], 'loading')
        for _ in range(20):
            cache.get('7203.T', company())
        wait_until(lambda: calls == ['7203.T']); release.set(); self.wait_done(cache)
        result = cache.get('7203.T', company())
        self.assertEqual(result, dict(text='愛知県豊田市にある自動車メーカー',
                source_url='https://www.wikidata.org/wiki/Q53268', source_title='Wikidata',
                fetched_at=NOW, kind='structured_company_facts', field_status='available',
                products=['自動車'], industry_labels=['自動車産業'], refreshing=False))

    def test_packaged_verified_seed_is_immediate_and_newer_runtime_wins(self):
        seed = Path(self.temp.name) / 'seed.json'
        seed.write_text(json.dumps({'version': 1, 'items': [saved()]}))
        loader = Mock(side_effect=AssertionError('fresh seed must not fetch'))
        cache = self.cache(loader, seed_path=seed)
        self.assertEqual(cache.get('7203.T', company())['fetched_at'], NOW)
        loader.assert_not_called()
        newer = saved(now=NOW + 10)
        newer['facts']['description'] = '新しい説明'
        self.path.write_text(json.dumps({'version': 1, 'items': [newer]}))
        self.now += 10
        cache = self.cache(loader, seed_path=seed)
        self.assertEqual(cache.get('7203.T', company())['text'], '新しい説明')
        loader.assert_not_called()
        # A stale name or removed secondary listing never leaks from the seed.
        cache.loader = lambda symbol, row: BusinessFailure('source_missing')
        self.assertIsNone(cache.get('7203.T', company(name='異なる会社'))['text'])

    def test_expired_or_forged_seed_is_not_available(self):
        seed = Path(self.temp.name) / 'seed.json'
        bad = saved(); bad['proof']['code'] = '9999'
        seed.write_text(json.dumps({'version': 1, 'items': [bad, saved(now=NOW - RETAIN)]}))
        cache = self.cache(lambda symbol, row: BusinessFailure('source_missing'), seed_path=seed)
        self.assertIsNone(cache.get('7203.T', company())['text'])
        self.wait_done(cache)
        self.assertEqual(cache.get('7203.T', company())['field_status'], 'source_missing')

    def test_newer_runtime_for_old_identity_cannot_hide_matching_fresh_seed(self):
        seed = Path(self.temp.name) / 'seed.json'
        seed.write_text(json.dumps({'version': 1, 'items': [saved(now=NOW - 20)]}))
        self.path.write_text(json.dumps({'version': 1, 'items': [saved(now=NOW - 10, name='以前の会社名')]}))
        loader = Mock(side_effect=AssertionError('verified fresh seed is available'))
        cache = self.cache(loader, seed_path=seed)
        current = cache.get('7203.T', company())
        self.assertEqual(current['text'], '愛知県豊田市にある自動車メーカー')
        self.assertEqual(current['fetched_at'], NOW - 20)
        self.assertFalse(current['refreshing']); loader.assert_not_called()

    def test_seed_hints_cannot_make_missing_business_facts_available(self):
        seed = Path(self.temp.name) / 'seed.json'
        hint = dict(symbol='7203.T', identity=official_identity('7203.T', company()), entity_ids=['Q53268'])
        seed.write_text(json.dumps({'version': 1, 'discovered_at': NOW, 'candidate_hints': [hint], 'items': []}))
        self.assertEqual(list(read_candidate_hints(seed, NOW)), ['7203.T'])
        service = CompanyBusinesses(cache_path=self.path, seed_path=seed, now=lambda: self.now)
        self.assertEqual(list(service.loader.candidate_hints), ['7203.T'])
        self.assertEqual(len(service._records), 0)
        service.loader = lambda symbol, row: BusinessFailure('source_missing')
        self.assertIsNone(service.get('7203.T', company())['text'])
        self.wait_done(service)

    def test_old_future_repeated_and_forged_hints_are_not_used(self):
        seed = Path(self.temp.name) / 'seed.json'
        hint = dict(symbol='7203.T', identity=official_identity('7203.T', company()), entity_ids=['Q53268'])
        for discovered in [NOW - RETAIN, NOW + 1, float('inf'), None]:
            seed.write_text(json.dumps({'version': 1, 'discovered_at': discovered, 'candidate_hints': [hint]}))
            self.assertEqual(read_candidate_hints(seed, NOW), {})
        seed.write_text(json.dumps({'version': 1, 'discovered_at': NOW, 'candidate_hints': [hint, hint]}))
        self.assertEqual(read_candidate_hints(seed, NOW), {})
        hint['identity']['exchange_id'] = EXCHANGES['Nagoya']
        seed.write_text(json.dumps({'version': 1, 'discovered_at': NOW, 'candidate_hints': [hint]}))
        self.assertEqual(read_candidate_hints(seed, NOW), {})

    def test_missing_description_is_formatted_from_fact_labels_not_guessed_prose(self):
        value = saved(); value['facts']['description'] = None
        cache = self.cache(lambda symbol, row: value)
        cache.get('7203.T', company()); self.wait_done(cache)
        self.assertEqual(cache.get('7203.T', company())['text'], '業種：自動車産業。主な製品・サービス：自動車')

    def test_seven_day_ttl_and_hour_error_retry_keep_dates_unchanged(self):
        loader = Mock(side_effect=lambda symbol, row: saved(symbol, now=self.now))
        cache = self.cache(loader); cache.get('7203.T', company()); self.wait_done(cache)
        self.now += TTL - 1
        cache.get('7203.T', company()); self.assertEqual(loader.call_count, 1)
        self.now += 1; loader.side_effect = requests.Timeout('private')
        cache.get('7203.T', company()); self.wait_done(cache)
        result = cache.get('7203.T', company())
        self.assertEqual(result['fetched_at'], NOW); self.assertEqual(result['field_status'], 'available')
        self.now += RETRY - 1; cache.get('7203.T', company()); self.assertEqual(loader.call_count, 2)
        self.now += 1; loader.side_effect = lambda symbol, row: saved(symbol, now=self.now)
        cache.get('7203.T', company()); self.wait_done(cache)
        self.assertEqual(loader.call_count, 3); self.assertEqual(cache.get('7203.T', company())['fetched_at'], self.now)

    def test_initial_failure_fixed_state_and_no_upstream_error_text(self):
        cache = self.cache(lambda symbol, row: BusinessFailure('identity_unconfirmed'))
        cache.get('7203.T', company()); self.wait_done(cache)
        self.assertEqual(cache.get('7203.T', company())['field_status'], 'identity_unconfirmed')
        other = self.cache(lambda symbol, row: (_ for _ in ()).throw(requests.Timeout('private credential')))
        other.get('7203.T', company()); self.wait_done(other)
        result = other.get('7203.T', company())
        self.assertEqual(result['field_status'], 'fetch_error'); self.assertNotIn('private', json.dumps(result))

    def test_provider_pause_retries_after_its_minimum_instead_of_one_hour(self):
        loader = Mock(side_effect=[BusinessFailure('fetch_error', retry_after_seconds=30), saved(now=self.now + 30)])
        cache = self.cache(loader); cache.get('7203.T', company()); self.wait_done(cache)
        self.now += 29; cache.get('7203.T', company()); self.assertEqual(loader.call_count, 1)
        self.now += 1; cache.get('7203.T', company()); self.wait_done(cache)
        self.assertEqual(loader.call_count, 2)
        self.assertEqual(cache.get('7203.T', company())['field_status'], 'available')

    def test_default_noninteractive_and_selected_service_have_the_same_shared_pause_path(self):
        automated = CompanyBusinesses(cache_path=self.path, now=lambda: self.now)
        selected = CompanyBusinesses(cache_path=self.path, now=lambda: self.now, interactive=True)
        self.assertFalse(automated.loader.interactive); self.assertTrue(selected.loader.interactive)
        self.assertEqual(automated.loader.cooldown_path, selected.loader.cooldown_path)

    def test_queue_64_and_one_worker_no_duplicate_or_unknown_identity_fetch(self):
        release = threading.Event(); calls = []
        def load(symbol, row):
            calls.append(symbol); release.wait(2); return saved(symbol, now=self.now, name=row['name'])
        cache = self.cache(load, max_pending=2)
        for symbol, row in [('7203.T', company()), ('9432.T', company('9432', 'NTT'))]:
            cache.get(symbol, row)
        self.assertEqual(cache.get('9433.T', company('9433', 'KDDI'))['field_status'], 'unconfirmed')
        self.assertEqual(cache.get('7203.JP', company())['field_status'], 'identity_unconfirmed')
        wait_until(lambda: len(calls) == 1); release.set()
        self.wait_done(cache); self.wait_done(cache, '9432.T', company('9432', 'NTT'))
        self.assertEqual(calls, ['7203.T', '9432.T'])

    def test_regional_canonical_identity_is_supported_without_yahoo_call(self):
        official = company('1734', '北日本企業', 'Sapporo')
        cache = self.cache(); cache.get('1734.JP', official); self.wait_done(cache, '1734.JP', official)
        self.assertEqual(cache.get('1734.JP', official)['field_status'], 'available')
        self.assertNotIn('Yahoo', json.dumps(cache.get('1734.JP', official)))

    def test_saved_identity_mismatch_is_not_exposed_and_requeues_changed_name(self):
        cache = self.cache(); cache._merge(saved()); cache._attempts['7203.T'] = self.now
        release = threading.Event()
        def load(symbol, row):
            release.wait(2); return saved(symbol, now=self.now, name=row['name'])
        cache.loader = load
        changed = company(name='トヨタ新名称')
        result = cache.get('7203.T', changed)
        self.assertIsNone(result['text']); self.assertTrue(result['refreshing'])
        release.set(); self.wait_done(cache, official=changed)
        self.assertEqual(cache.get('7203.T', changed)['field_status'], 'available')

    def test_immutable_saved_proof_sanitizes_raw_claims_and_unknown_payload(self):
        value = saved(); value['raw_claims'] = 'private body'; value['proof']['secret'] = 'private'; value['facts']['html'] = 'full text'
        clean = _valid_record(value, NOW)
        self.assertNotIn('private', json.dumps(clean)); self.assertNotIn('full text', json.dumps(clean))
        value['proof']['code'] = '7204'; self.assertIsNone(_valid_record(value, NOW))
        value = saved(); value['proof']['current_listing'] = False; self.assertIsNone(_valid_record(value, NOW))

    def test_atomic_persistence_restart_and_cache_over_512(self):
        cache = self.cache()
        for index in range(600):
            cache._merge(saved(str(1000 + index) + '.T'))
        cache._save()
        loader = Mock(side_effect=AssertionError('saved facts should be reused'))
        restarted = self.cache(loader)
        self.assertEqual(len(restarted._records), 600)
        self.assertEqual(restarted.get('1000.T', company('1000'))['field_status'], 'available')
        loader.assert_not_called()

    def test_refresh_remains_pending_until_verified_facts_are_persisted(self):
        loader = Mock(side_effect=lambda symbol, row: saved(symbol, now=self.now))
        cache = self.cache(loader)
        entered, release = threading.Event(), threading.Event()
        original = cache._save
        def blocked_save():
            entered.set(); release.wait(2); original()
        cache._save = blocked_save
        cache.get('7203.T', company())
        try:
            self.assertTrue(entered.wait(2))
            during = cache.get('7203.T', company())
            self.assertTrue(during['refreshing'])
            self.assertEqual(during['field_status'], 'available')
            self.assertEqual(during['fetched_at'], NOW)
            self.assertFalse(self.path.exists())
            self.assertEqual(loader.call_count, 1)
        finally:
            release.set(); self.wait_done(cache)
        self.assertTrue(self.path.exists())
        self.assertEqual(json.loads(self.path.read_text())['items'][0]['symbol'], '7203.T')

    def test_persistence_failure_releases_refresh_and_retains_verified_facts(self):
        cache = self.cache()
        cache._save = Mock(side_effect=OSError('disk unavailable'))
        cache.get('7203.T', company()); self.wait_done(cache)
        first = cache.get('7203.T', company())
        self.assertEqual(first['field_status'], 'available'); self.assertFalse(first['refreshing'])
        self.now += TTL
        cache.get('7203.T', company()); self.wait_done(cache)
        self.assertEqual(cache._save.call_count, 2)
        self.assertEqual(cache.get('7203.T', company())['fetched_at'], self.now)

    def test_fork_recreates_locked_state_and_retains_verified_facts(self):
        cache = self.cache(); cache._merge(saved()); cache._pending.add('7203.T')
        old = cache._condition; old.acquire()
        with patch('company_business.os.getpid', return_value=cache._pid + 1):
            result = cache.get('7203.T', company())
        self.assertEqual(result['field_status'], 'available'); self.assertFalse(result['refreshing'])
        self.assertIsNot(old, cache._condition); old.release()

    def test_expired_facts_and_future_retrieval_never_display(self):
        for fetched in [NOW - RETAIN, NOW + 1]:
            value = saved(now=fetched)
            self.assertIsNone(_valid_record(value, NOW))


if __name__ == '__main__':
    unittest.main()
