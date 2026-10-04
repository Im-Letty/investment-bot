"""External wake/check only. No secrets, AI calls, LINE endpoints or Git writes."""
from datetime import datetime, timedelta, timezone
import json
import math
import time
from urllib.parse import urlsplit
from urllib.request import urlopen

BASE = 'https://investment-bot-ta24.onrender.com'
JST = timezone(timedelta(hours=9))


def check_window_seconds(now):
    """Cover early preparation through 08:20, with a bounded late retry window."""
    release_grace = now.replace(hour=8, minute=20, second=0, microsecond=0)
    return min(100 * 60, max(65 * 60, (release_grace - now).total_seconds()))


def current_delivery(data, now):
    """A dated headline fallback is usable, but never a successful AI edition."""
    today = now.date().isoformat()
    if (now.hour < 8 or not isinstance(data, dict) or data.get('policy_version') != 4
            or data.get('edition_date') != today or data.get('selection_status') != 'ready'
            or data.get('lang') != 'ja'):
        return None
    articles = data.get('news')
    if not isinstance(articles, list) or not 1 <= len(articles) <= 3:
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
    if data.get('delivery') == 'published' and isinstance(data.get('digest'), dict):
        return 'published'
    fetched = data.get('fetched_at')
    if (data.get('delivery') == 'headlines' and data.get('digest') is None
            and data.get('fallback_reason') == 'current_edition_unavailable'
            and type(fetched) in (int, float) and math.isfinite(fetched)
            and 0 <= now.timestamp() - fetched < 900 and not data.get('stale')):
        return 'headlines'
    return None


def main():
    started = time.monotonic()
    initial = datetime.now(JST)
    expected = initial.date().isoformat()
    window = check_window_seconds(initial)
    while time.monotonic() - started < window:
        now = datetime.now(JST)
        if now.date().isoformat() != expected:
            raise SystemExit('Japan date changed before publication')
        try:
            # Inbound traffic wakes a sleeping instance; the server handles the
            # actual job with persistent per-day attempt limits.
            with urlopen(BASE + '/api/news-publication', timeout=60) as response:
                state = json.load(response)
            print(json.dumps(state, ensure_ascii=False), flush=True)
            # Warm the public feed even when AI is disabled or has used its
            # daily attempts. Keep waking until 08:00; exiting at 07:30 would
            # otherwise leave a sleeping site with only yesterday's edition.
            with urlopen(BASE + '/api/morning-news?lang=ja', timeout=45) as response:
                published = json.load(response)
            delivery = current_delivery(published, now)
            if delivery == 'published':
                print('Current Japan edition is publicly available.', flush=True)
                return 0
            if delivery == 'headlines':
                print('::warning::AI summary is unavailable; verified current-day headlines are publicly available.', flush=True)
                return 0
        except (OSError, ValueError) as error:
            print('Website not ready yet: ' + type(error).__name__, flush=True)
        # Requests before the preparation window keep the web worker awake.
        time.sleep(60)
    raise SystemExit('Current daily edition was not confirmed within the check window')


if __name__ == '__main__':
    raise SystemExit(main())
