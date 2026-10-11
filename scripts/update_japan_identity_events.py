#!/usr/bin/env python3
"""Refresh dated JPX identity events from fixed public, bounded sources only."""
import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from japan_equity_catalogue import (PARSERS, SEED_PATH, SOURCES, _download,
                                    today_jst, verified_supplement)

EVENT_SOURCES = ('tokyo_new', 'tokyo_delisted', 'tokyo_transfers')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', action='append', choices=EVENT_SOURCES,
                        help='Refresh only selected events; default refreshes all JPX events.')
    parser.add_argument('--output', type=Path, default=SEED_PATH)
    args = parser.parse_args()
    selected = args.source or EVENT_SOURCES
    if len(set(selected)) != len(selected):
        parser.error('Each source can be selected only once.')
    document = json.loads(args.output.read_text(encoding='utf-8'))
    observed = today_jst()
    # A failed/changed page leaves the existing seed untouched. This script
    # performs no quote, AI, company-site, or authenticated request.
    for key in selected:
        payload = _download(SOURCES[key])
        document['sources'][key] = {'source_url': SOURCES[key], 'as_of': observed.isoformat(),
                                    'sha256': sha256(payload).hexdigest(),
                                    'items': PARSERS[key](payload, observed)}
    document = verified_supplement(document, observed)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=args.output.parent,
                                         prefix='.jpx-identity-', delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(document, handle, ensure_ascii=False, indent=2)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, args.output)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    print(json.dumps({'as_of': observed.isoformat(), 'sources': {
        key: {'count': len(document['sources'][key]['items']), 'sha256': document['sources'][key]['sha256']}
        for key in selected}}, ensure_ascii=False))


if __name__ == '__main__':
    main()
