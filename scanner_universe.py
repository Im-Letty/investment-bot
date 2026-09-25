"""JPX domestic equity coverage and bounded rolling scan batches."""
import json
from pathlib import Path


def load_universe(path):
    rows = json.loads(Path(path).read_text(encoding='utf-8'))['items']
    labels = {'プライム（内国株式）': 'prime', 'スタンダード（内国株式）': 'standard', 'グロース（内国株式）': 'growth'}
    return {row['code'] + '.T': {'name': row['name'], 'market': labels[row['market']]}
            for row in rows if row.get('market') in labels}


def next_batch(symbols, cursor, size=200):
    if not symbols:
        return [], 0
    count = min(size, len(symbols))
    return [symbols[(cursor + i) % len(symbols)] for i in range(count)], (cursor + count) % len(symbols)
