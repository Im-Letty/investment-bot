"""Bulk hints never replace current official-company and listing verification."""
from copy import deepcopy
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from company_business import (BusinessFailure, EXCHANGES, WikidataBusinessProvider,
                              official_identity, verify_entity)
from scripts.refresh_company_business_seed import (_ObservedRaw, discovery_hints,
                                                   main, refresh)

NOW = datetime(2026, 10, 11, 11, tzinfo=timezone.utc).timestamp()


def company(code='7203', name='トヨタ自動車', exchange='Tokyo'):
    return dict(code=code, name=name, exchange=exchange,
                symbol=code + ('.T' if exchange == 'Tokyo' else '.JP'))


def snak(prop, value):
    return dict(snaktype='value', property=prop, datavalue=dict(value=value))


def entity(row, qid='Q53268', *, description=True, industry=False, exchange=None):
    listing = dict(rank='normal', mainsnak=snak('P414', dict(id=EXCHANGES[exchange or row['exchange']])),
                   qualifiers=dict(P249=[snak('P249', row['code'])]))
    claims = dict(P414=[listing])
    if industry:
        claims['P452'] = [dict(rank='normal', mainsnak=snak('P452', dict(id='Q190')))]
    return dict(id=qid, labels=dict(ja=dict(language='ja', value=row['name'])), aliases={},
                descriptions=dict(ja=dict(language='ja', value='日本の自動車メーカー')) if description else {},
                claims=claims, lastrevid=123)


class Clock:
    def __init__(self):
        self.time, self.elapsed, self.sleeps = NOW, 0., []
    def now(self):
        return self.time
    def monotonic(self):
        return self.elapsed
    def sleep(self, seconds):
        self.sleeps.append(seconds); self.elapsed += seconds; self.time += seconds


class Provider:
    interactive = False
    retry_after_seconds = 0
    def __init__(self, entities=None, failure=None):
        self.entities, self.failure, self.calls = entities or {}, failure, []
    def _read(self, params, deadline, limit):
        self.calls.append(deepcopy(params))
        if self.failure:
            return self.failure
        return dict(entities={qid: deepcopy(self.entities[qid]) for qid in params['ids'].split('|')})


def run(rows, hints, provider, **kwargs):
    clock = Clock()
    result = refresh(rows, hints, provider=provider, now=clock.now,
                     monotonic=clock.monotonic, sleep=clock.sleep, **kwargs)
    return result, clock


class BulkSeedTests(unittest.TestCase):
    def test_cli_without_fetch_never_constructs_network_provider(self):
        with patch('scripts.refresh_company_business_seed.official_rows', return_value=[company()]), \
             patch('scripts.refresh_company_business_seed.BatchWikidataProvider', side_effect=AssertionError('network')), \
             patch('sys.stdout', new_callable=io.StringIO) as output:
            self.assertEqual(main([]), 0)
            self.assertEqual(json.loads(output.getvalue())['network_requests'], 0)

    def test_discovery_is_hint_without_name_or_market_trust(self):
        row = company('7441', 'Misumi', 'Fukuoka')
        document = dict(results=dict(bindings=[dict(item=dict(value='http://www.wikidata.org/entity/Q1'),
            exchange=dict(value='http://www.wikidata.org/entity/' + EXCHANGES['Fukuoka']), ticker=dict(value='7441'))]))
        hints, rejected = discovery_hints(document, [row])
        self.assertEqual(hints, {'7441.JP': ['Q1']}); self.assertEqual(rejected, [])
        wrong = entity(row, 'Q1', exchange='Tokyo')
        (seed, state, report), _ = run([row], hints, Provider({'Q1': wrong}))
        self.assertEqual(seed['items'], [])
        self.assertEqual(report['coverage']['identity_unconfirmed'], 1)

    def test_listing_provider_and_edinet_code_forms_are_verified_against_official_name(self):
        rows = [company('4838', 'スペースシャワーSKIYAKIホールディングス'),
                company('4255', 'THECOO')]
        values = {}
        bindings = []
        for row, qid, ticker in zip(rows, ['Q1', 'Q2'], ['4838.T', '42550']):
            raw = entity(row, qid)
            raw['claims']['P414'][0]['qualifiers']['P249'][0] = snak('P249', ticker)
            values[qid] = raw
            bindings.append(dict(item=dict(value='http://www.wikidata.org/entity/' + qid),
                exchange=dict(value='http://www.wikidata.org/entity/' + EXCHANGES['Tokyo']),
                ticker=dict(value=ticker)))
        hints, rejected = discovery_hints(dict(results=dict(bindings=bindings)), rows)
        self.assertEqual(hints, {'4838.T': ['Q1'], '4255.T': ['Q2']})
        (seed, state, report), _ = run(rows, hints, Provider(values))
        self.assertEqual({r['symbol'] for r in seed['items']}, {'4838.T', '4255.T'})
        self.assertEqual(report['coverage']['verified_current_refresh'], 2)

    def test_name_discovery_cannot_replace_current_market_and_ticker_proof(self):
        row = company()
        document = dict(results=dict(bindings=[dict(item=dict(value='http://www.wikidata.org/entity/Q1'),
            exchange=dict(value='http://www.wikidata.org/entity/' + EXCHANGES['Tokyo']),
            name=dict(value='トヨタ自動車株式会社'))]))
        hints, _ = discovery_hints(document, [row])
        self.assertEqual(hints, {'7203.T': ['Q1']})
        raw = entity(row, 'Q1')
        del raw['claims']['P414'][0]['qualifiers']['P249']
        (seed, state, report), _ = run([row], hints, Provider({'Q1': raw}))
        self.assertEqual(seed['items'], [])
        self.assertEqual(report['coverage']['identity_unconfirmed'], 1)
        document['results']['bindings'][0]['exchange']['value'] = 'http://www.wikidata.org/entity/' + EXCHANGES['Fukuoka']
        self.assertEqual(discovery_hints(document, [row])[0], {})

    def test_regional_industry_only_is_explicit_not_company_description(self):
        row = company('7441', 'ミスミ', 'Fukuoka')
        provider = Provider({'Q1': entity(row, 'Q1', description=False, industry=True),
                             'Q190': dict(id='Q190', labels=dict(ja=dict(language='ja', value='小売業')))})
        (seed, state, report), clock = run([row], {row['symbol']: ['Q1']}, provider)
        self.assertEqual(seed['items'][0]['symbol'], '7441.JP')
        self.assertEqual(seed['items'][0]['proof']['exchange'], 'Fukuoka')
        self.assertIsNone(seed['items'][0]['facts']['description'])
        self.assertEqual(report['coverage']['industry_only_records'], 1)
        self.assertFalse(report['verified_whole_catalogue_descriptions'])
        self.assertEqual(clock.sleeps, [2])

    def test_ambiguous_entities_are_rejected_even_when_both_match_ticker_name(self):
        row = company()
        provider = Provider({'Q1': entity(row, 'Q1'), 'Q2': entity(row, 'Q2')})
        (seed, state, report), _ = run([row], {row['symbol']: ['Q1', 'Q2']}, provider)
        self.assertEqual(seed['items'], [])
        self.assertEqual(report['ambiguous_symbols'], ['7203.T'])
        self.assertEqual(report['coverage']['ambiguous'], 1)

    def test_backoff_preserves_previous_good_seed_and_keeps_work_pending(self):
        row = company(); raw = entity(row)
        identity = official_identity(row['symbol'], row)
        record = dict(symbol=row['symbol'], identity=identity,
            proof=verify_entity(raw, identity, datetime.fromtimestamp(NOW, timezone.utc).date(), NOW),
            fetched_at=NOW, facts=dict(description='日本の自動車メーカー', industries=[], products=[]))
        provider = Provider(failure=BusinessFailure('fetch_error', retry_after_seconds=3600))
        (seed, state, report), _ = run([row], {row['symbol']: ['Q53268']}, provider,
                                     previous_seed=dict(items=[record]))
        self.assertEqual(seed['items'], [record])
        self.assertEqual(report['status'], 'paused_upstream_backoff')
        self.assertEqual(report['remaining_entities'], 1)
        self.assertEqual(state['entities'], {})
        self.assertEqual(len(provider.calls), 1)
        self.assertEqual(seed['candidate_hints'][0]['symbol'], '7203.T')
        self.assertEqual(seed['candidate_hints'][0]['identity'], identity)
        self.assertEqual(seed['candidate_hints'][0]['entity_ids'], ['Q53268'])
        self.assertEqual(seed['discovered_at'], NOW)

    def test_server_cooldown_longer_than_budget_is_not_shortened_or_retried(self):
        row = company(); provider = Provider({'Q1': entity(row, 'Q1')})
        provider.retry_after_seconds = 7200
        (seed, state, report), clock = run([row], {row['symbol']: ['Q1']}, provider, max_seconds=120)
        self.assertEqual(provider.calls, [])
        self.assertEqual(clock.sleeps, [])
        self.assertEqual(report['status'], 'paused_upstream_backoff')
        self.assertEqual(report['remaining_entities'], 1)
        self.assertEqual(report['retry_after_seconds'], 7200)

    def test_corrupt_partial_checkpoint_is_refetched_without_losing_good_data(self):
        row = company(); provider = Provider({'Q1': entity(row, 'Q1')})
        (seed, state, report), _ = run([row], {row['symbol']: ['Q1']}, provider)
        state['entities']['Q1']['drafts'] = [dict(symbol=row['symbol'])]
        second = Provider({'Q1': entity(row, 'Q1')})
        (seed2, state2, report), _ = run([row], {row['symbol']: ['Q1']}, second, state=state, previous_seed=seed)
        self.assertEqual(len(second.calls), 1)
        self.assertEqual(len(seed2['items']), 1)

    def test_serial_batches_are_capped_at_fifty_and_can_resume_checkpoint(self):
        rows = [company(str(1000 + i), '会社' + str(i)) for i in range(52)]
        hints = {r['symbol']: ['Q' + str(i + 1)] for i, r in enumerate(rows)}
        values = {'Q' + str(i + 1): entity(r, 'Q' + str(i + 1)) for i, r in enumerate(rows)}
        first = Provider(values)
        (seed, state, report), _ = run(rows, hints, first, batch_size=999, max_requests=1)
        self.assertEqual(len(first.calls[0]['ids'].split('|')), 50)
        self.assertEqual(report['status'], 'paused_budget')
        self.assertEqual(len(seed['items']), 50)
        self.assertEqual(report['remaining_entities'], 2)
        second = Provider(values)
        (finished, final_state, report), _ = run(rows, hints, second, state=state, previous_seed=seed)
        self.assertEqual(len(second.calls), 1)
        self.assertEqual(len(second.calls[0]['ids'].split('|')), 2)
        self.assertEqual(len(finished['items']), 52)
        self.assertEqual(report['status'], 'checked_available_facts')

    def test_official_rename_invalidates_saved_identity_and_triggers_new_verification(self):
        row = company(); provider = Provider({'Q1': entity(row, 'Q1')})
        (seed, state, report), _ = run([row], {row['symbol']: ['Q1']}, provider)
        renamed = company(name='別の会社')
        second = Provider({'Q1': entity(row, 'Q1')})
        (seed2, state2, report), _ = run([renamed], {renamed['symbol']: ['Q1']}, second,
                                      state=state, previous_seed=seed)
        self.assertEqual(len(second.calls), 1)
        self.assertEqual(seed2['items'], [])
        self.assertEqual(report['coverage']['identity_unconfirmed'], 1)

    def test_automatic_job_rejects_interactive_provider(self):
        provider = Provider(); provider.interactive = True
        with self.assertRaisesRegex(ValueError, 'noninteractive'):
            run([company()], {}, provider)

    def test_observation_retains_only_http_api_error_code_not_info_or_host(self):
        class Raw:
            def __init__(self):
                self.parts = [b'{"error":{"code":"maxlag","info":"private details","host":"host-name"}}', b'']
            def read1(self, *args, **kwargs):
                return self.parts.pop(0)
        observation = dict(http_status=200, api_error_code=None, retry_after='5')
        raw = _ObservedRaw(Raw(), observation)
        raw.read1(); raw.read1()
        self.assertEqual(observation, dict(http_status=200, api_error_code='maxlag', retry_after='5'))

    def test_lag_observation_is_bounded_number_and_never_retains_host_or_info(self):
        class Raw:
            def __init__(self, lag):
                self.parts = [json.dumps(dict(error=dict(code='maxlag', lag=lag,
                                     info='diagnostic prose', host='database-name'))).encode(), b'']
            def read1(self, *args, **kwargs):
                return self.parts.pop(0)
        for lag, expected in ((23.5, 23.5), (True, None), (-1, None), ('23.5', None), (1_000_001, None)):
            observation = {}
            raw = _ObservedRaw(Raw(lag), observation); raw.read1(); raw.read1()
            self.assertEqual(observation.get('upstream_lag_seconds'), expected)
            self.assertNotIn('host', observation); self.assertNotIn('info', observation)

    def test_coverage_separates_generic_industry_only_and_retained_description(self):
        one, two, three = company('1000', '会社A'), company('1001', '会社B'), company('1002', '会社C')
        generic = entity(one, 'Q1'); generic['descriptions']['ja']['value'] = '日本の企業'
        provider = Provider({'Q1': generic, 'Q2': entity(two, 'Q2', description=False, industry=True),
                             'Q190': dict(id='Q190', labels=dict(ja=dict(language='ja', value='小売業')))})
        (seed, state, report), _ = run([one, two, three], {one['symbol']: ['Q1'], two['symbol']: ['Q2']}, provider)
        records = {r['symbol']: r for r in report['company_coverage']}
        self.assertEqual(records[one['symbol']]['content_kind'], 'generic_description')
        self.assertEqual(records[two['symbol']]['content_kind'], 'industry_facts_only')
        self.assertEqual(records[three['symbol']]['refresh_status'], 'candidate_missing')
        self.assertFalse(report['verified_whole_catalogue_descriptions'])
        self.assertEqual(report['coverage']['company_specific_short_description_records'], 0)
        self.assertEqual(report['coverage']['missing_company_specific_descriptions_by_exchange'], {'Tokyo': 3})
        failing = Provider(failure=BusinessFailure('fetch_error', retry_after_seconds=3600))
        (restored, _, pending), _ = run([one, two, three], {one['symbol']: ['Q1'], two['symbol']: ['Q2']},
                                       failing, previous_seed=seed)
        self.assertEqual(restored['items'], seed['items'])
        self.assertTrue(all(row['retained_previous'] for row in pending['company_coverage'] if row['verified_available']))
        self.assertFalse(pending['verified_whole_catalogue_descriptions'])


if __name__ == '__main__':
    unittest.main()
