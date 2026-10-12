"""Explicit, resumable CC0 company-facts seed refresh; no import-time network.

WDQS listing rows only discover candidate QIDs. Fresh entity JSON must still
pass company_business.verify_entity against the current official catalogue.
Noninteractive API reads always use maxlag=5. A busy upstream is pending work,
never an empty description or proof that a company has no business facts.
"""
import argparse
from collections import Counter
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
import math
from pathlib import Path
import re
import sys
import time

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from company_business import (BusinessFailure, EXCHANGES, TTL, WikidataBusinessProvider,
                              _japanese, _qid, _valid_record, fact_ids,
                              official_identity, verify_entity)
from stock_search import StockSearch

JST = timezone(timedelta(hours=9))
QUERY_URL = 'https://query.wikidata.org/sparql'
QUERY = '''PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX p: <http://www.wikidata.org/prop/>
PREFIX ps: <http://www.wikidata.org/prop/statement/>
PREFIX pq: <http://www.wikidata.org/prop/qualifier/>
PREFIX wikibase: <http://wikiba.se/ontology#>
SELECT DISTINCT ?item ?exchange ?ticker WHERE {
 VALUES ?exchange { wd:Q217475 wd:Q1188840 wd:Q11093491 wd:Q5507703 }
 ?item p:P414 ?listing .
 ?listing ps:P414 ?exchange ; pq:P249 ?ticker ; wikibase:rank ?rank .
 FILTER (?rank != wikibase:DeprecatedRank)
 FILTER NOT EXISTS { ?listing pq:P582 ?ended }
}
LIMIT 10000'''
MAX_BYTES = 8_000_000
SEED_PATH = Path(__file__).resolve().parents[1] / 'static/company-business-seed.json'
GENERIC_DESCRIPTIONS = frozenset(('日本の企業', '日本の会社', '日本の株式会社', '株式会社'))


class _ObservedRaw:
    """Only retain a small API error code; never save upstream entity bodies."""
    def __init__(self, raw, observation):
        self.raw, self.observation, self.prefix = raw, observation, bytearray()
        self.complete = True

    def read1(self, *args, **kwargs):
        chunk = self.raw.read1(*args, **kwargs)
        if len(self.prefix) + len(chunk) <= 16_384:
            self.prefix.extend(chunk)
        else:
            self.complete = False
        if not chunk and self.complete:
            try:
                error = json.loads(self.prefix).get('error', {})
                code = error.get('code')
                if isinstance(code, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,64}', code):
                    self.observation['api_error_code'] = code
                lag = error.get('lag')
                if (code == 'maxlag' and isinstance(lag, (int, float)) and not isinstance(lag, bool)
                        and math.isfinite(lag) and 0 <= lag <= 1_000_000):
                    self.observation['upstream_lag_seconds'] = lag
            except (ValueError, AttributeError, TypeError):
                pass
        return chunk

    def __getattr__(self, name):
        return getattr(self.raw, name)


class _ObservedSession(requests.Session):
    def __init__(self, observations):
        super().__init__()
        self.observations = observations

    def get(self, *args, **kwargs):
        response = super().get(*args, **kwargs)
        retry = response.headers.get('Retry-After')
        observation = dict(http_status=response.status_code, api_error_code=None,
                           retry_after=retry if isinstance(retry, str) and len(retry) <= 128 else None)
        age = response.headers.get('Age')
        if isinstance(age, str) and age.isdigit() and len(age) <= 9:
            observation['http_cache_age_seconds'] = int(age)
        self.observations.append(observation)
        response.raw = _ObservedRaw(response.raw, observation)
        return response


class BatchWikidataProvider(WikidataBusinessProvider):
    def __init__(self, **kwargs):
        self.safe_read_observations = []
        super().__init__(session_factory=lambda: _ObservedSession(self.safe_read_observations),
                         interactive=False, **kwargs)


def fingerprint(value):
    return sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                             separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n'
    if len(text.encode()) > 32_000_000:
        raise ValueError('checkpoint_size_limit')
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(text, encoding='utf-8')
    temporary.replace(path)


def read_json(path, default):
    try:
        path = Path(path)
        if path.stat().st_size > 32_000_000:
            return deepcopy(default)
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError, TypeError):
        return deepcopy(default)


def official_rows():
    catalogue = StockSearch(runtime_path=None)
    return [catalogue.company(item['code']) for item in catalogue.all_items()['items']]


def _listing_ids(company):
    exchanges = {company.get('exchange')}
    # Alternate listings must come from the official master, never from WDQS.
    for row in company.get('other_listings', []):
        if isinstance(row, dict) and row.get('exchange') in EXCHANGES:
            exchanges.add(row['exchange'])
    return {EXCHANGES[name] for name in exchanges if name in EXCHANGES}


def discovery_hints(document, companies):
    """Accept cached audit, saved hints or WDQS JSON; hints carry no trust."""
    by_symbol = {row['symbol']: row for row in companies}
    by_pair = {}
    for row in companies:
        for exchange_id in _listing_ids(row):
            by_pair[(exchange_id, row['code'])] = row['symbol']
    hints, rejected = {}, set()
    if not isinstance(document, dict):
        raise ValueError('invalid_discovery_document')
    discovery = document.get('discovery')
    if isinstance(discovery, dict):
        rows = discovery.get('unverified_candidate_entity_mapping', [])
        rejected.update(symbol for symbol in discovery.get('ambiguous_exact_match_symbols', [])
                        if symbol in by_symbol)
        for row in rows:
            if (isinstance(row, dict) and row.get('symbol') in by_symbol
                    and _qid(row.get('qid'))):
                hints.setdefault(row['symbol'], set()).add(row['qid'])
    elif isinstance(document.get('hints'), dict):
        for symbol, ids in document['hints'].items():
            if symbol in by_symbol and isinstance(ids, list):
                hints[symbol] = {qid for qid in ids[:100] if _qid(qid)}
        rejected.update(symbol for symbol in document.get('rejected_ambiguous_symbols', [])
                        if symbol in by_symbol)
    else:
        bindings = document.get('results', {}).get('bindings')
        if not isinstance(bindings, list) or len(bindings) >= 10000:
            raise ValueError('incomplete_discovery')
        for row in bindings:
            if not isinstance(row, dict):
                continue
            qid = row.get('item', {}).get('value', '').rsplit('/', 1)[-1]
            exchange = row.get('exchange', {}).get('value', '').rsplit('/', 1)[-1]
            code = row.get('ticker', {}).get('value', '')
            symbol = by_pair.get((exchange, code.strip().upper())) if isinstance(code, str) else None
            if symbol and _qid(qid):
                hints.setdefault(symbol, set()).add(qid)
    return {symbol: sorted(ids) for symbol, ids in hints.items() if ids and symbol not in rejected}, sorted(rejected)


def fetch_discovery(provider, *, session_factory=requests.Session, monotonic=time.monotonic):
    if provider.retry_after_seconds:
        return BusinessFailure('fetch_error', retry_after_seconds=provider.retry_after_seconds)
    deadline = monotonic() + 20
    try:
        with session_factory() as session:
            session.headers.update({'User-Agent': 'InvestmentLetterCompanyFacts/1.0 (+https://investment-bot-ta24.onrender.com/)',
                                    'Accept-Encoding': 'gzip,deflate',
                                    'Accept': 'application/sparql-results+json'})
            with session.get(QUERY_URL, params={'query': QUERY, 'format': 'json'},
                             timeout=(3, 12), allow_redirects=False, stream=True) as response:
                retry = response.headers.get('Retry-After')
                if response.status_code == 429 or response.status_code == 503 and retry:
                    return provider._backoff(retry)
                if response.status_code != 200:
                    return BusinessFailure('fetch_error')
                chunks, size = [], 0
                for chunk in response.iter_content(8192):
                    size += len(chunk)
                    if size > MAX_BYTES or monotonic() >= deadline:
                        return BusinessFailure('fetch_error')
                    chunks.append(chunk)
        return json.loads(b''.join(chunks))
    except (requests.RequestException, OSError, ValueError, TypeError):
        return BusinessFailure('fetch_error')


def _fresh(value, now):
    fetched = value.get('fetched_at') if isinstance(value, dict) else None
    return (isinstance(fetched, (int, float)) and not isinstance(fetched, bool)
            and math.isfinite(fetched) and 0 <= now - fetched < TTL)


def discovery_time(document, fallback):
    if isinstance(document, dict):
        for field in ('discovered_at', 'discovery_at'):
            value = document.get(field)
            if (isinstance(value, (int, float)) and not isinstance(value, bool)
                    and math.isfinite(value) and 0 < value <= fallback):
                return value
        observed = document.get('observed_at')
        if isinstance(observed, str):
            try:
                value = datetime.fromisoformat(observed)
                if value.tzinfo is not None and 0 < value.timestamp() <= fallback:
                    return value.timestamp()
            except ValueError:
                pass
    return fallback


def refresh(companies, hints, *, provider, state=None, previous_seed=None,
            rejected=(), now=time.time, monotonic=time.monotonic, sleep=time.sleep,
            max_seconds=1800, max_requests=200, batch_size=50, interval=2,
            checkpoint=None):
    """One serial bounded batch job; previous good records survive outages."""
    if getattr(provider, 'interactive', False) is not False:
        raise ValueError('bulk_requires_noninteractive_maxlag')
    batch_size = max(1, min(50, int(batch_size)))
    interval = max(1, float(interval))
    deadline = monotonic() + max(.1, float(max_seconds))
    identities = {row['symbol']: official_identity(row['symbol'], row) for row in companies}
    identities = {symbol: identity for symbol, identity in identities.items() if identity}
    signature = {symbol: fingerprint(identity) for symbol, identity in identities.items()}
    generation = fingerprint(signature)
    state = deepcopy(state) if isinstance(state, dict) and state.get('version') == 1 else {}
    discovered_at = discovery_time(state, now())
    entities = state.get('entities') if isinstance(state.get('entities'), dict) else {}
    labels = state.get('labels') if isinstance(state.get('labels'), dict) else {}
    targets = {}
    for symbol, ids in hints.items():
        if symbol in identities and symbol not in rejected:
            for qid in ids:
                if _qid(qid):
                    targets.setdefault(qid, []).append(symbol)
    entities = {qid: value for qid, value in entities.items() if qid in targets and isinstance(value, dict)}
    labels = {qid: value for qid, value in labels.items() if _qid(qid) and isinstance(value, dict)}
    old = {}
    if isinstance(previous_seed, dict):
        previous_rows = previous_seed.get('items')
        for row in previous_rows[:8192] if isinstance(previous_rows, list) else []:
            if isinstance(row, dict) and row.get('symbol') in identities:
                clean = _valid_record(row, now(), identities[row['symbol']])
                if clean:
                    old[clean['symbol']] = clean
    requests_sent = 0
    phase, stop_reason = 'entities', None

    def entity_ready(qid):
        row = entities.get(qid)
        return (_fresh(row, now()) and isinstance(row.get('identity_signatures'), dict)
                and isinstance(row.get('drafts'), list)
                and all(isinstance(draft, dict) and all(key in draft for key in
                    ('symbol', 'identity', 'proof', 'fetched_at', 'description', 'industries_ids', 'products_ids'))
                    and isinstance(draft['industries_ids'], list) and isinstance(draft['products_ids'], list)
                    for draft in row['drafts'])
                and all(row['identity_signatures'].get(symbol) == signature[symbol] for symbol in targets[qid]))

    def assemble():
        records = deepcopy(old)
        counts = Counter()
        statuses = {}
        verified_symbols = set()
        ambiguous = set(rejected)
        for symbol, identity in identities.items():
            ids = hints.get(symbol, [])
            if symbol in rejected:
                counts['ambiguous'] += 1
                statuses[symbol] = 'ambiguous'
                continue
            if not ids:
                counts['unmapped'] += 1
                statuses[symbol] = 'candidate_missing'
                continue
            if not all(qid in targets and entity_ready(qid) for qid in ids):
                counts['pending_identity'] += 1
                statuses[symbol] = 'identity_pending'
                continue
            drafts = [draft for qid in ids for draft in entities[qid].get('drafts', [])
                      if isinstance(draft, dict) and draft.get('symbol') == symbol
                      and draft.get('identity') == identity]
            if len(drafts) != 1:
                counts['ambiguous' if len(drafts) > 1 else 'identity_unconfirmed'] += 1
                statuses[symbol] = 'ambiguous' if len(drafts) > 1 else 'identity_unconfirmed'
                if len(drafts) > 1:
                    ambiguous.add(symbol)
                continue
            draft = drafts[0]
            facts = dict(description=draft.get('description'), industries=[], products=[])
            missing_labels = False
            for field in ('industries', 'products'):
                for qid in draft.get(field + '_ids', []):
                    label = labels.get(qid, {})
                    if not _fresh(label, now()):
                        missing_labels = True
                    elif label.get('label'):
                        facts[field].append(dict(id=qid, label=label['label']))
            record = {key: draft[key] for key in ('symbol', 'identity', 'proof', 'fetched_at')}
            record['facts'] = facts
            clean = _valid_record(record, now(), identity)
            if clean:
                records[symbol] = clean
                verified_symbols.add(symbol)
                counts['new_verified'] += 1
                statuses[symbol] = 'verified_facts'
            elif missing_labels:
                counts['pending_fact_labels'] += 1
                statuses[symbol] = 'fact_labels_pending'
            else:
                counts['no_structured_facts'] += 1
                statuses[symbol] = 'structured_facts_missing'
        coverage = dict(counts)
        coverage.update(official_companies=len(identities), candidate_companies=len(hints),
                        available_records=len(records), verified_current_refresh=len(verified_symbols),
                        retained_previous_records=len(set(records) - verified_symbols),
                        short_description_records=sum(bool(r['facts']['description']) for r in records.values()),
                        generic_description_records=sum(r['facts']['description'] in GENERIC_DESCRIPTIONS
                            for r in records.values()),
                        company_specific_short_description_records=sum(bool(r['facts']['description'])
                            and r['facts']['description'] not in GENERIC_DESCRIPTIONS for r in records.values()),
                        industry_only_records=sum(not r['facts']['description'] and bool(r['facts']['industries'])
                            and not r['facts']['products'] for r in records.values()),
                        product_facts_without_description=sum(not r['facts']['description']
                            and bool(r['facts']['products']) for r in records.values()),
                        by_exchange=dict(Counter(r['identity']['exchange'] for r in records.values())))
        seed = dict(version=1, license='CC0-1.0', source_url='https://www.wikidata.org/wiki/Wikidata:Data_access',
                    generated_at=now(), catalogue_identity_sha256=generation,
                    discovered_at=discovered_at,
                    candidate_hints=[dict(symbol=symbol, identity=identities[symbol], entity_ids=sorted(ids))
                        for symbol, ids in sorted(hints.items()) if symbol in identities and symbol not in rejected],
                    coverage=coverage, items=[records[symbol] for symbol in sorted(records)])
        company_coverage = []
        for symbol, identity in sorted(identities.items()):
            record = records.get(symbol)
            facts = record['facts'] if record else {}
            description = facts.get('description')
            if description:
                content_kind = ('generic_description' if description in GENERIC_DESCRIPTIONS
                                else 'company_specific_short_description')
            elif facts.get('products'):
                content_kind = 'product_facts_only'
            elif facts.get('industries'):
                content_kind = 'industry_facts_only'
            else:
                content_kind = 'not_available'
            company_coverage.append(dict(symbol=symbol, name=identity['name'], exchange=identity['exchange'],
                refresh_status=statuses[symbol], candidate_count=len(hints.get(symbol, [])),
                verified_available=bool(record), content_kind=content_kind,
                fetched_at=record['fetched_at'] if record else None,
                source_url=('https://www.wikidata.org/wiki/' + record['proof']['entity_id']) if record else None,
                retained_previous=symbol in records and symbol not in verified_symbols))
        coverage['missing_company_specific_descriptions_by_exchange'] = dict(Counter(
            row['exchange'] for row in company_coverage if row['content_kind'] != 'company_specific_short_description'))
        report = dict(status=stop_reason or 'in_progress', phase=phase, requests_sent=requests_sent,
                      coverage=coverage, remaining_entities=sum(not entity_ready(qid) for qid in targets),
                      ambiguous_symbols=sorted(ambiguous), retry_after_seconds=provider.retry_after_seconds,
                      company_coverage=company_coverage,
                      verified_whole_catalogue_descriptions=bool(company_coverage) and all(
                          row['content_kind'] == 'company_specific_short_description' for row in company_coverage))
        observations = getattr(provider, 'safe_read_observations', [])
        report['last_upstream_response'] = observations[-1] if observations else None
        saved_state = dict(version=1, catalogue_identity_sha256=generation, updated_at=now(),
                           entities=entities, labels=labels, hints=hints,
                           discovery_at=discovered_at,
                           rejected_ambiguous_symbols=sorted(rejected), report=report)
        return seed, saved_state, report

    def persist():
        values = assemble()
        if checkpoint:
            checkpoint(*values)
        return values

    def read(ids, props, limit):
        nonlocal requests_sent, stop_reason
        if monotonic() >= deadline or requests_sent >= max_requests:
            stop_reason = 'paused_budget'
            return None
        wait = provider.retry_after_seconds
        if wait:
            if monotonic() + wait + 1 >= deadline:
                stop_reason = 'paused_upstream_backoff'
                return None
            sleep(wait)
        if requests_sent:
            sleep(interval)
        if monotonic() >= deadline:
            stop_reason = 'paused_budget'
            return None
        requests_sent += 1
        value = provider._read(dict(action='wbgetentities', ids='|'.join(ids), languages='ja', props=props),
                               min(deadline, monotonic() + 15), limit)
        if isinstance(value, BusinessFailure):
            stop_reason = 'paused_upstream_backoff' if value.retry_after_seconds else 'paused_fetch_error'
            return None
        if not isinstance(value, dict) or not isinstance(value.get('entities'), dict):
            stop_reason = 'paused_invalid_response'
            return None
        return value['entities']

    while True:
        pending = sorted(qid for qid in targets if not entity_ready(qid))
        if not pending:
            break
        batch = pending[:batch_size]
        values = read(batch, 'info|labels|aliases|descriptions|claims', MAX_BYTES)
        if values is None:
            return persist()
        fetched = now()
        today = datetime.fromtimestamp(fetched, JST).date()
        for qid in batch:
            entity = values.get(qid)
            # A missing/malformed entity response is not a completed negative.
            if not isinstance(entity, dict) or entity.get('id') != qid:
                stop_reason = 'paused_invalid_response'
                return persist()
            drafts = []
            for symbol in targets[qid]:
                identity = identities[symbol]
                proof = verify_entity(entity, identity, today, fetched)
                if not proof:
                    continue
                facts, _ = fact_ids(entity, today, fetched)
                drafts.append(dict(symbol=symbol, identity=identity, proof=proof, fetched_at=fetched,
                    description=_japanese(entity.get('descriptions', {}).get('ja'), require_script=True),
                    industries_ids=facts['industries'], products_ids=facts['products']))
            entities[qid] = dict(fetched_at=fetched, identity_signatures={symbol: signature[symbol] for symbol in targets[qid]},
                                 lastrevid=entity.get('lastrevid'), drafts=drafts)
        persist()
    phase = 'fact_labels'
    needed = sorted({qid for row in entities.values() for draft in row.get('drafts', [])
                     for field in ('industries_ids', 'products_ids') for qid in draft.get(field, [])
                     if _qid(qid) and not _fresh(labels.get(qid), now())})
    while needed:
        batch = needed[:batch_size]
        values = read(batch, 'labels', 1_000_000)
        if values is None:
            return persist()
        fetched = now()
        for qid in batch:
            entity = values.get(qid)
            if not isinstance(entity, dict) or entity.get('id') != qid:
                stop_reason = 'paused_invalid_response'
                return persist()
            labels[qid] = dict(fetched_at=fetched, label=_japanese(entity.get('labels', {}).get('ja'), 100))
        needed = needed[len(batch):]
        persist()
    stop_reason = 'checked_available_facts'
    return persist()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fetch', action='store_true', help='Explicitly permit public CC0 reads')
    parser.add_argument('--discovery-input', type=Path, help='Reuse a previously fetched WDQS audit or hints')
    parser.add_argument('--output', type=Path, default=SEED_PATH)
    parser.add_argument('--state-file', type=Path)
    parser.add_argument('--report', type=Path)
    parser.add_argument('--batch-size', type=int, default=50)
    parser.add_argument('--interval', type=float, default=2)
    parser.add_argument('--max-seconds', type=float, default=1800)
    parser.add_argument('--max-requests', type=int, default=200)
    args = parser.parse_args(argv)
    companies = official_rows()
    if not args.fetch:
        print(json.dumps(dict(status='plan_only', network_requests=0, official_companies=len(companies),
                              max_batch_size=50, descriptions_not_guaranteed=True), ensure_ascii=False))
        return 0
    state_path = args.state_file or args.output.with_suffix('.refresh-state.json')
    report_path = args.report or args.output.with_suffix('.refresh-report.json')
    provider = BatchWikidataProvider(cooldown_path=str(state_path) + '.backoff.json')
    previous_state = read_json(state_path, {})
    previous_state = previous_state if isinstance(previous_state, dict) else {}
    current_generation = fingerprint({row['symbol']: fingerprint(official_identity(row['symbol'], row))
        for row in companies if official_identity(row['symbol'], row)})
    if args.discovery_input:
        document = read_json(args.discovery_input, None)
        previous_state['discovery_at'] = discovery_time(document, time.time())
    elif (previous_state.get('hints') and _fresh(dict(fetched_at=previous_state.get('discovery_at')), time.time())
          and previous_state.get('catalogue_identity_sha256') == current_generation):
        document = previous_state
    else:
        document = fetch_discovery(provider)
        previous_state['discovery_at'] = time.time()
    if isinstance(document, BusinessFailure):
        report = dict(status='paused_discovery_backoff' if document.retry_after_seconds else 'paused_discovery_fetch_error',
                      official_companies=len(companies), retry_after_seconds=document.retry_after_seconds,
                      available_seed_unchanged=True, verified_whole_catalogue_descriptions=False)
        atomic_json(report_path, report)
        print(json.dumps(report, ensure_ascii=False))
        return 2
    try:
        hints, rejected = discovery_hints(document, companies)
    except (ValueError, TypeError, AttributeError):
        print(json.dumps(dict(status='invalid_discovery_seed_unchanged'), ensure_ascii=False))
        return 2

    def save(seed, state, report):
        atomic_json(args.output, seed)
        atomic_json(state_path, state)
        atomic_json(report_path, report)

    seed, state, report = refresh(companies, hints, provider=provider, state=previous_state,
        previous_seed=read_json(args.output, {}), rejected=rejected, batch_size=args.batch_size,
        interval=args.interval, max_seconds=args.max_seconds, max_requests=max(1, args.max_requests), checkpoint=save)
    print(json.dumps(report, ensure_ascii=False))
    return 0 if report['status'] == 'checked_available_facts' else 2


if __name__ == '__main__':
    raise SystemExit(main())
