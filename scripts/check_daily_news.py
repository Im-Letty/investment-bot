"""External wake/check only. No secrets, AI calls, LINE endpoints or Git writes."""
from datetime import datetime, timedelta, timezone
import json
import math
from pathlib import Path
import re
import sys
import time
from urllib.parse import urlsplit
from urllib.request import urlopen

if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from news_copy_policy import COPY_LENGTH_POLICY, summary_bounds

BASE = 'https://investment-bot-ta24.onrender.com'
JST = timezone(timedelta(hours=9))
# Mirrored from the public format without importing server/SDK dependencies.
LEAD_OTHER_NEWS_STRUCTURE = 'lead-plus-other-news-v1'
PUBLICATION_STATES = frozenset(('starting', 'waiting', 'disabled', 'collecting', 'freezing',
    'source_empty', 'source_unavailable', 'waiting_for_writer', 'prepared', 'ready',
    'generating', 'generation_failed', 'daily_limit', 'storage_unavailable',
    'cache_unavailable', 'unavailable', 'invalid_edition', 'configuration_unavailable'))


def valid_official_delivery(data, now):
    """Check the public frozen-source contract with stdlib only (CI has no SDKs)."""
    try:
        digest = data['digest']
        if digest.get('lang') != 'ja':
            return False
        day = now.replace(hour=0, minute=0, second=0, microsecond=0)
        previous = day - timedelta(days=1)
        expected = {'version': 1, 'edition_date': day.date().isoformat(),
                    'window_start': previous.replace(hour=8).timestamp(),
                    'carryover_start': previous.replace(hour=7, minute=30).timestamp(),
                    'cutoff_at': day.replace(hour=7, minute=30).timestamp()}
        window = digest['source_window']
        if window != expected or type(window.get('version')) is not int:
            return False
        number = lambda v: type(v) in (int, float) and math.isfinite(v)
        reviewed, release = digest.get('reviewed_at'), digest.get('publish_at')
        if (not number(reviewed) or not number(release)
                or not expected['cutoff_at'] <= reviewed <= release <= now.timestamp()
                or release < day.replace(hour=8).timestamp()):
            return False
        refs, details = digest['article_refs'], digest['article_summaries']
        if not isinstance(refs, list) or len(refs) != len(data['news']) or not isinstance(details, list) or len(details) != len(refs):
            return False
        policy = digest.get('copy_length_policy')
        if 'copy_length_policy' in digest and policy != COPY_LENGTH_POLICY:
            return False
        structure = digest.get('reading_structure')
        if 'reading_structure' in digest and (structure != LEAD_OTHER_NEWS_STRUCTURE
                or policy != COPY_LENGTH_POLICY):
            return False
        for role, text in [('overview', digest)] + [('article', item) for item in details]:
            minimum, maximum = summary_bounds(role, policy)
            if (not isinstance(text, dict) or not isinstance(text.get('headline'), str)
                    or not 1 <= len(text['headline'].strip()) <= 80
                    or not isinstance(text.get('summary'), str) or not minimum <= len(text['summary'].strip()) <= maximum):
                return False
        fields = ('source', 'title', 'url', 'published_at', 'published_date',
                  'publication_precision', 'body_sha256', 'body_verified_at', 'selection_route',
                  'deferred_from', 'deferred_reason')
        identity = lambda ref: tuple(ref.get(key) for key in fields)
        if (len({ref['url'] for ref in refs}) != len(refs)
                or sorted(map(repr, map(identity, data['news']))) != sorted(map(repr, map(identity, refs)))
                or sorted(map(repr, map(identity, details))) != sorted(map(repr, map(identity, refs)))):
            return False
        if structure is not None and any(detail.get('url') != ref.get('url')
                                         for detail, ref in zip(details, refs)):
            return False
        for ref in refs:
            if not isinstance(ref.get('title'), str) or not 1 <= len(ref['title'].strip()) <= 1000:
                return False
            url = urlsplit(ref['url'])
            host = {'総務省統計局': 'www.stat.go.jp', '財務省': 'www.mof.go.jp'}.get(ref['source'])
            verified = ref['body_verified_at']
            if (not host or url.scheme != 'https' or url.hostname != host or url.username or url.password
                    or url.port not in (None, 443) or url.query
                    or not number(verified) or not 0 < verified <= expected['cutoff_at']
                    or not re.fullmatch('[a-f0-9]{64}', ref['body_sha256'])):
                return False
            pubday = datetime.strptime(ref['published_date'], '%Y-%m-%d').date()
            if pubday.isoformat() != ref['published_date'] or pubday > datetime.fromtimestamp(verified, JST).date():
                return False
            route, stamp = ref['selection_route'], ref['published_at']
            deferred = route == 'deferred'
            if deferred and (ref.get('deferred_from') != previous.date().isoformat()
                    or ref.get('deferred_reason') not in ('late_verification', 'review_failed', 'omitted')
                    or (ref.get('deferred_reason') == 'late_verification' and verified <= expected['carryover_start'])):
                return False
            if not deferred and ('deferred_from' in ref or 'deferred_reason' in ref):
                return False
            if ref['publication_precision'] == 'day':
                allowed_days = ((previous - timedelta(days=1)).date(), previous.date()) if deferred else (previous.date(), day.date())
                if stamp is not None or pubday not in allowed_days or (not deferred and route != 'date_only'):
                    return False
            elif ref['publication_precision'] == 'second':
                if (not number(stamp) or stamp > verified
                        or datetime.fromtimestamp(stamp, JST).date() != pubday):
                    return False
                if deferred:
                    valid = expected['window_start'] - 86400 <= stamp <= expected['carryover_start']
                elif route == 'main':
                    valid = expected['window_start'] <= stamp <= expected['cutoff_at']
                elif route == 'carryover':
                    valid = expected['carryover_start'] < stamp < expected['window_start']
                else:
                    valid = False
                if not valid:
                    return False
            else:
                return False
        return True
    except (KeyError, TypeError, ValueError, OverflowError, OSError, AttributeError):
        return False


def check_window_seconds(now):
    """Cover early preparation through 08:20, with a bounded late retry window."""
    release_grace = now.replace(hour=8, minute=20, second=0, microsecond=0)
    maximum = 240 * 60 if 4 <= now.hour < 7 else 100 * 60
    return min(maximum, max(65 * 60, (release_grace - now).total_seconds()))


def current_delivery(data, now):
    """A dated headline fallback is usable, but never a successful AI edition."""
    today = now.date().isoformat()
    if (now.hour < 8 or not isinstance(data, dict) or data.get('policy_version') != 4
            or 'error' in data
            or data.get('edition_date') != today or data.get('selection_status') != 'ready'
            or data.get('lang') != 'ja'):
        return None
    articles = data.get('news')
    if not isinstance(articles, list) or not 1 <= len(articles) <= 3:
        return None
    digest = data.get('digest')
    if isinstance(digest, dict) and 'source_window' in digest:
        if (data.get('delivery') == 'published' and digest.get('publication_mode') == 'curated'
                and digest.get('edition_date') == today and valid_official_delivery(data, now)):
            return 'published'
        return None
    for article in articles:
        if not isinstance(article, dict):
            return None
        stamp = article.get('published_at')
        if (type(stamp) not in (float, int) or not math.isfinite(stamp)
                or stamp > now.timestamp() or article.get('published_date') != today):
            return None
        try:
            if datetime.fromtimestamp(stamp, JST).date().isoformat() != today:
                return None
            url = urlsplit(article.get('url', ''))
            if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password:
                return None
        except (TypeError, ValueError, OverflowError, OSError):
            return None
    if (data.get('delivery') == 'published' and isinstance(digest, dict)
            and digest.get('publication_mode') == 'curated' and digest.get('edition_date') == today):
        return 'published'
    fetched = data.get('fetched_at')
    if (data.get('delivery') == 'headlines' and data.get('digest') is None
            and data.get('fallback_reason') == 'current_edition_unavailable'
            and type(fetched) in (int, float) and math.isfinite(fetched)
            and 0 <= now.timestamp() - fetched < 900 and not data.get('stale')):
        return 'headlines'
    return None


def healthy_quiet_response(data, now):
    """A quiet source window cannot hide a broken public response."""
    if (not isinstance(data, dict) or 'error' in data or data.get('policy_version') != 4
            or data.get('lang') != 'ja' or not isinstance(data.get('news'), list)):
        return False
    try:
        day = datetime.strptime(data['edition_date'], '%Y-%m-%d').replace(tzinfo=JST)
        if day.date().isoformat() != data['edition_date'] or day.date() > now.date():
            return False
        if data.get('delivery') == 'published':
            asof = now if day.date() == now.date() else day.replace(hour=23, minute=59, second=59)
            return current_delivery(data, asof) == 'published'
        return (data['edition_date'] == now.date().isoformat() and not data['news']
                and data.get('digest') is None
                and data.get('selection_status') in ('empty_today', 'unavailable'))
    except (KeyError, ValueError, TypeError):
        return False


def main():
    started = time.monotonic()
    initial = datetime.now(JST)
    expected = initial.date().isoformat()
    window = check_window_seconds(initial)
    headlines_seen = False
    while time.monotonic() - started < window:
        now = datetime.now(JST)
        if now.date().isoformat() != expected:
            raise SystemExit('Japan date changed before publication')
        try:
            # Inbound traffic wakes a sleeping instance; the server handles the
            # actual job with persistent per-day attempt limits.
            with urlopen(BASE + '/api/news-publication', timeout=60) as response:
                state = json.load(response)
            # Warm the public feed even when AI is disabled or has used its
            # daily attempts. Keep waking until 08:00; exiting at 07:30 would
            # otherwise leave a sleeping site with only yesterday's edition.
            with urlopen(BASE + '/api/morning-news?lang=ja', timeout=45) as response:
                published = json.load(response)
            # A slow wake/request can cross 08:00 or midnight. Attest what was
            # actually observed after the responses, not the request start.
            now = datetime.now(JST)
            if now.date().isoformat() != expected:
                raise SystemExit('Japan date changed before publication')
            status = state.get('status') if isinstance(state, dict) else None
            print(json.dumps({'event': 'publication_observation', 'edition_date': expected,
                'checked_at': now.isoformat(timespec='seconds'),
                'status': status if isinstance(status, str) and status in PUBLICATION_STATES else 'unknown'},
                ensure_ascii=False), flush=True)
            delivery = current_delivery(published, now)
            if delivery == 'published':
                release = now.replace(hour=8, minute=0, second=0, microsecond=0)
                print(json.dumps({'event': 'current_edition_first_observed',
                    'edition_date': expected, 'observed_at': now.isoformat(timespec='seconds'),
                    'seconds_since_scheduled_release': round((now - release).total_seconds(), 3),
                    'timing_note': 'First observed availability; not proof of exact 08:00 release.'},
                    ensure_ascii=False), flush=True)
                print('Current Japan edition is publicly available.', flush=True)
                return 0
            if (now.hour >= 8 and isinstance(state, dict) and state.get('status') == 'source_empty'
                    and state.get('edition_date') == expected and state.get('source_mode') == 'official'
                    and state.get('sources') == ['総務省統計局', '財務省']
                    and state.get('cutoff_at') == now.replace(hour=7, minute=30, second=0, microsecond=0).timestamp()
                    and state.get('last_error') is None and healthy_quiet_response(published, now)):
                print('No eligible new announcements in the checked sources; previous edition retains its actual date. No AI edition was generated.', flush=True)
                return 0
            if delivery == 'headlines':
                if not headlines_seen:
                    print('::warning::AI summary is unavailable; verified current-day headlines are publicly available. Waiting for the reviewed summary.', flush=True)
                    headlines_seen = True
        except (OSError, ValueError) as error:
            print('Website not ready yet: ' + type(error).__name__, flush=True)
        # Requests before the preparation window keep the web worker awake.
        time.sleep(60)
    if headlines_seen:
        raise SystemExit('Current AI summary was not published within the check window; only headlines were confirmed')
    raise SystemExit('Current daily edition was not confirmed within the check window')


if __name__ == '__main__':
    raise SystemExit(main())
