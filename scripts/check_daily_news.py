"""External wake/check only. No secrets, AI calls, LINE endpoints or Git writes."""
from datetime import datetime, timedelta, timezone
import json
import time
from urllib.request import urlopen

BASE = 'https://investment-bot-ta24.onrender.com'
JST = timezone(timedelta(hours=9))


def check_window_seconds(now):
    """Cover early preparation through 08:20, with a bounded late retry window."""
    release_grace = now.replace(hour=8, minute=20, second=0, microsecond=0)
    return min(100 * 60, max(65 * 60, (release_grace - now).total_seconds()))


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
            if not state.get('configured') or not state.get('enabled'):
                raise SystemExit('Daily news needs server configuration')
            if (state.get('edition_date') == expected and state.get('publish_at', float('inf')) <= now.timestamp()
                    and state.get('status') in ('ready', 'published')):
                with urlopen(BASE + '/api/morning-news?lang=ja', timeout=45) as response:
                    published = json.load(response)
                if published.get('edition_date') == expected and published.get('delivery') == 'published':
                    print('Current Japan edition is publicly available.', flush=True)
                    return 0
            if state.get('status') in ('exhausted', 'daily_limit', 'disabled'):
                raise SystemExit('Daily news did not complete; previous edition remains visible')
        except (OSError, ValueError) as error:
            print('Website not ready yet: ' + type(error).__name__, flush=True)
        # Requests before the preparation window keep the web worker awake.
        time.sleep(60)
    raise SystemExit('Current daily edition was not confirmed within the check window')


if __name__ == '__main__':
    raise SystemExit(main())
