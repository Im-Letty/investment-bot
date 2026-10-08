"""Explicit private CI company writer; no import-time AI or authentication."""
import argparse
from datetime import date, datetime, timedelta
import json
import os
from pathlib import Path
import re
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from daily_news_runtime import SupabaseNewsStorage
from company_news_runtime import (PREFIX, article_id, candidate_records, pending_candidates,
                                 source_fingerprint, valid_record, source_catalogue)
from company_news_producer import safe_company_diagnostic, safe_company_error
from news_cache import JST


def _manual_retry_source(storage, now, day, identifier, revision):
    claims = [storage.read(f'{PREFIX}/days/{day}/attempt-{slot}.json') for slot in range(1, 4)]
    if all(claim is not None for claim in claims):
        return None, None, 'daily_attempt_limit'
    published = [storage.read(f'{PREFIX}/days/{day}/published-{slot}.json') for slot in range(1, 4)]
    if any(isinstance(value, dict) and value.get('company', {}).get('article_id') == identifier
           for value in published):
        return None, None, 'already_published'
    for slot, claim in enumerate(claims, 1):
        if not isinstance(claim, dict) or claim.get('article_id') != identifier or published[slot - 1] is not None:
            continue
        if claim.get('revision') == revision:
            return None, None, 'revision_unchanged'
        result = storage.read(f'{PREFIX}/days/{day}/result-{slot}.json')
        if (not isinstance(result, dict) or result.get('article_id') != identifier
                or result.get('status') not in ('review_failed', 'partially_published')):
            continue
        for source in candidate_records(storage, now):
            fingerprint = source_fingerprint(source)
            if (article_id(source) != identifier or claim.get('fingerprint') != fingerprint
                    or claim.get('symbol') != source['symbol']):
                continue
            if any(isinstance(value, dict) and value.get('company', {}).get('symbol') == source['symbol']
                   for value in published):
                return None, None, 'already_published'
            seen = storage.read(f'{PREFIX}/seen/{fingerprint}.json')
            if (not isinstance(seen, dict) or seen.get('article_id') != identifier
                    or seen.get('fingerprint') != fingerprint or seen.get('symbol') != source['symbol']):
                return None, None, 'retry_seen_required'
            return source, slot, None
    return None, None, 'failed_attempt_required'


def run_job(storage, generator, *, clock=time.time, exclusion_urls=(), other_news=(),
            retry_article_id=None, retry_revision=None, diagnostics=None):
    now = clock()
    day = datetime.fromtimestamp(now, JST).date().isoformat()
    report = {'status': 'no_new_release', 'day': day, 'published_count': 0, 'attempt_count': 0}
    manual_retry = retry_article_id is not None
    if manual_retry and (not isinstance(retry_article_id, str)
                         or not re.fullmatch(r'[0-9a-f]{64}', retry_article_id)
                         or not isinstance(retry_revision, str)
                         or not re.fullmatch(r'[0-9a-f]{40}', retry_revision)):
        return {**report, 'status': 'retry_not_allowed', 'retry_reason': 'retry_input_invalid'}
    storage.ensure_private()
    retry_of = None
    if manual_retry:
        source, retry_of, reason = _manual_retry_source(storage, now, day, retry_article_id, retry_revision)
        if reason:
            return {**report, 'status': 'retry_not_allowed', 'retry_reason': reason}
        sources = [source]
    else:
        sources = pending_candidates(storage, now)
    for source in sources:
        # The economy section owns its own articles; don't publish the same URL
        # twice merely because it is also about a listed company.
        if source['url'] in exclusion_urls:
            continue
        source = {**source, 'other_news': list(other_news)}
        fingerprint = source_fingerprint(source)
        claim = {'article_id': article_id(source), 'fingerprint': fingerprint,
                 'symbol': source['symbol'], 'started_at': clock()}
        if isinstance(retry_revision, str) and re.fullmatch(r'[0-9a-f]{40}', retry_revision):
            claim['revision'] = retry_revision
        # An immutable source claim prevents the same draft/review from being
        # billed again tomorrow after a failure or an ambiguous upload result.
        if manual_retry:
            claim.update(retry_of=retry_of, revision=retry_revision)
            # The original seen record remains intact. A manually selected code
            # revision may consume at most one further slot for this same body,
            # including interrupted or failed retries and future-day requests.
            retry_key = f'{PREFIX}/retry-claims/{claim["article_id"]}/{fingerprint}/{retry_revision}.json'
            if not storage.create(retry_key, claim):
                return {**report, 'status': 'retry_not_allowed', 'retry_reason': 'retry_already_claimed'}
        elif not storage.create(f'{PREFIX}/seen/{fingerprint}.json', claim):
            continue
        slot = next((slot for slot in range(1, 4)
                     if storage.create(f'{PREFIX}/days/{day}/attempt-{slot}.json', claim)), None)
        if slot is None:
            break
        report['attempt_count'] += 1
        attempt_status = 'published'
        try:
            company = generator(source, now=clock(), clock=clock)
            company['valid_until'] = (date.fromisoformat(source['published_date']) + timedelta(days=7)).isoformat()
            record = {'schema': 'company-reviewed-v1', 'source': source, 'company': company}
            if datetime.fromtimestamp(clock(), JST).date().isoformat() != day or not valid_record(record, clock(),
                    catalogue=source_catalogue(storage, source)):
                raise ValueError('company_record_invalid')
            stored = storage.create(f'{PREFIX}/days/{day}/published-{slot}.json', record)
            if not stored:
                raise ValueError('company_publication_conflict')
            report['published_count'] += 1
            report['status'] = 'published'
        except Exception as error:
            attempt_status = 'review_failed'
            report['status'] = 'review_failed' if report['published_count'] == 0 else 'partially_published'
            # Raw source/provider/credential errors never become CI output.
            report['last_error'] = safe_company_error(error)
            diagnostic = safe_company_diagnostic(error)
            if isinstance(diagnostics, list) and diagnostic is not None:
                diagnostics.append({'article_id': claim['article_id'], **diagnostic})
        storage.create(f'{PREFIX}/days/{day}/result-{slot}.json', {
            'article_id': claim['article_id'], 'status': attempt_status,
            'finished_at': clock(), 'published_count': report['published_count']})
    return report


def published_economy_context(storage, now, *, baseline_path=None):
    """Use validated, already published editions for URL and topic overlap."""
    from morning_news_window import published_references
    from news_cache import load_reviewed_digests, _validated_digest

    path = baseline_path or Path(__file__).resolve().parents[1] / 'news-digests.json'
    issues = load_reviewed_digests(path)
    for day in storage.recent_days()[:2]:
        # A normal morning edition has no reviewed-* revision key.
        for key in [f'days/{day}/edition.json', *storage.reviewed_keys(day)]:
            value = storage.read(key)
            if isinstance(value, dict):
                issues.append(value)
    valid_issues = [checked for issue in issues if (checked := _validated_digest(issue))
                    and checked.get('publication_mode') == 'curated'
                    and checked.get('publish_at', checked['reviewed_at']) <= now]
    excluded = [ref['url'] for ref in published_references(valid_issues, now)
                if isinstance(ref.get('url'), str)]
    latest = max(valid_issues, key=lambda issue:
        (issue['edition_date'], issue['reviewed_at']), default={})
    if latest.get('article_summaries'):
        other = [{key: detail[key] for key in ('headline', 'summary')}
                 for detail in latest['article_summaries'][:3]]
    else:
        other = [{key: latest[key] for key in ('headline', 'summary')}] if latest else []
    return excluded, other


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--run-live', action='store_true')
    parser.add_argument('--result-file')
    parser.add_argument('--retry-article-id')
    args = parser.parse_args(argv)
    if not args.run_live:
        print(json.dumps({'status': 'explicit_live_opt_in_required'}))
        return 2
    if args.retry_article_id is not None and (
            os.environ.get('GITHUB_EVENT_NAME') != 'workflow_dispatch'
            or os.environ.get('COMPANY_MANUAL_RETRY_ARTICLE_ID') != args.retry_article_id
            or not re.fullmatch(r'[0-9a-f]{64}', args.retry_article_id)
            or not re.fullmatch(r'[0-9a-f]{40}', os.environ.get('COMPANY_NEWS_SOURCE_REVISION', ''))):
        print(json.dumps({'status': 'retry_not_allowed', 'retry_reason': 'workflow_input_required'}))
        return 2
    from company_news_producer import generate_company_news
    from scripts.run_private_news_job import JobDeadline, process_deadline
    diagnostics = []
    try:
        with process_deadline(seconds=29 * 60):
            from company_news_catalogue import current_catalogue
            current_catalogue(now=datetime.now(JST))
            storage = SupabaseNewsStorage(os.environ.get('SUPABASE_URL'), os.environ.get('SUPABASE_KEY'))
            excluded, other = published_economy_context(storage, time.time())
            result = run_job(storage, generate_company_news, exclusion_urls=excluded, other_news=other,
                             retry_article_id=args.retry_article_id,
                             retry_revision=os.environ.get('COMPANY_NEWS_SOURCE_REVISION'),
                             diagnostics=diagnostics)
    except JobDeadline:
        result = {'status': 'job_deadline', 'published_count': 0}
    except Exception:
        result = {'status': 'storage_unavailable', 'published_count': 0}
    result['finished_at'] = datetime.now(JST).isoformat(timespec='seconds')
    if args.result_file:
        target = Path(args.result_file)
        # A pre-existing file/symlink cannot become a write destination.
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as stream:
            json.dump(result, stream, ensure_ascii=False, allow_nan=False)
            stream.write('\n')
        if diagnostics:
            # Reviewer free-text, original body, credentials and private logs
            # are excluded. Rejected copy stays in the private CI artifact only.
            diagnostic_target = target.with_name('diagnostic.json')
            fd = os.open(diagnostic_target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, 'w') as stream:
                json.dump(diagnostics, stream, ensure_ascii=False, allow_nan=False)
                stream.write('\n')
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))
    return 0 if result['status'] in ('published', 'no_new_release') else 1


if __name__ == '__main__':
    raise SystemExit(main())
