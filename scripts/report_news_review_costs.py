"""Read only the private, numeric review receipts; never invoke an AI."""
import argparse
from datetime import date, datetime
import json
import os
from pathlib import Path
import sys
import time

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
    began = datetime.now(JST).isoformat(timespec='seconds')
    try:
        if date.fromisoformat(args.day).isoformat() != args.day:
            raise ValueError('invalid_cost_day')
        from scripts.reconcile_news_review_costs import ReadOnlyCostStorage
        # This adapter admits only this day's numeric receipts and list requests.
        storage = ReadOnlyCostStorage(os.environ, args.day)
        storage.check_private(deadline=time.monotonic() + 20)
        report = collect_daily_cost(storage, args.day, seconds=120, max_objects=1200)
        print(json.dumps({'status': 'checked' if report['scan_complete'] else 'incomplete',
            'read_started_at': began, 'read_finished_at': datetime.now(JST).isoformat(timespec='seconds'),
            'read_only': True, **report}))
        return 0
    except Exception:
        print(json.dumps({'status': 'cost_unavailable', 'target_jpy': TARGET_JPY, 'target_mode': 'soft'}))
        return 0
    finally:
        if storage is not None:
            try:
                storage.close()
            except Exception:
                pass


if __name__ == '__main__':
    raise SystemExit(main())
