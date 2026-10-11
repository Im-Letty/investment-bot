"""Read only the private, numeric review receipts; never invoke an AI."""
import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import sys

if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from news_review_costs import JST, TARGET_JPY, collect_daily_cost


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live', action='store_true')
    parser.add_argument('--day', default=datetime.now(JST).date().isoformat())
    args = parser.parse_args(argv)
    if not args.live:
        print(json.dumps({'status': 'not_connected', 'target_jpy': TARGET_JPY, 'target_mode': 'soft'}))
        return 0
    storage = None
    try:
        from daily_news_runtime import BUCKET, SupabaseNewsStorage
        storage = SupabaseNewsStorage(os.environ.get('SUPABASE_URL'), os.environ.get('SUPABASE_KEY'))
        # Unlike ensure_private(), this report cannot create a missing bucket.
        response = storage._request('GET', '/bucket/' + BUCKET)
        if response.status_code != 200 or storage._payload(response).get('public') is not False:
            raise ValueError('private_store_unavailable')
        report = collect_daily_cost(storage, args.day)
        print(json.dumps({'status': 'checked' if report['scan_complete'] else 'incomplete', **report}))
        return 0
    except Exception:
        print(json.dumps({'status': 'cost_unavailable', 'target_jpy': TARGET_JPY, 'target_mode': 'soft'}))
        return 0
    finally:
        if storage is not None:
            try:
                storage._session.close()
            except Exception:
                pass


if __name__ == '__main__':
    raise SystemExit(main())
