from copy import deepcopy
from datetime import datetime
from hashlib import sha256
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

import daily_news_producer as shared
from daily_news_runtime import DailyNewsRuntime
from isolated_news_producer import generate_isolated_edition
from news_cache import JST
from news_review_receipt import content_hash, valid_receipt
from tests.test_isolated_news_producer import FakeProviders, sources
from tests.test_daily_news_runtime import MemoryStorage, issue, at

MORNING_NOW = at()

NOW = datetime(2026, 10, 11, 12, 0, tzinfo=JST).timestamp()
WINDOW = {'version': 2, 'kind': 'intraday', 'edition_date': '2026-10-11',
          'window_start': datetime(2026, 10, 11, 7, 30, tzinfo=JST).timestamp(),
          'cutoff_at': NOW - 10}


def intraday_source():
    row = sources(1)[0]
    row.update(published_date='2026-10-11', body_verified_at=NOW-20,
               selection_route='intraday')
    return [row]


class ExactCopyReceiptTests(unittest.TestCase):
    def test_receipt_follows_both_identical_reviews_and_binds_public_copy(self):
        provider = FakeProviders()
        result = generate_isolated_edition(NOW, articles=intraday_source(),
                    source_window=WINDOW, providers=provider, clock=lambda: NOW)
        reviewed = [call for call in provider.calls if call[0] in ('gemini', 'openai')]
        self.assertEqual([call[0] for call in reviewed], ['gemini', 'openai'])
        self.assertEqual(reviewed[0][2], reviewed[1][2])
        payload = json.dumps(reviewed[0][2], ensure_ascii=False, sort_keys=True,
                             separators=(',', ':'), allow_nan=False).encode()
        receipt = result['review_receipt']
        self.assertEqual(receipt['review_payload_sha256'], sha256(payload).hexdigest())
        self.assertTrue(valid_receipt(receipt, result))
        self.assertEqual(receipt['content_sha256'], content_hash(result))
        self.assertNotIn(result['summary'], json.dumps(receipt, ensure_ascii=False))
        self.assertNotIn(intraday_source()[0]['body'], json.dumps(receipt))
        result['publish_at'] += 5
        self.assertTrue(valid_receipt(receipt, result))
        result['headline'] += '変更'
        self.assertFalse(valid_receipt(receipt, result))

    def test_review_rejection_cannot_emit_success_receipt(self):
        provider = FakeProviders()
        def reject(name, data):
            from tests.test_isolated_news_producer import approved
            result = approved()
            if name == 'openai':
                result['approved'] = False
                result['checks']['facts'] = False
                result['issues'] = ['facts']
            return result
        provider.reviewer = reject
        with self.assertRaises(shared.GenerationError):
            generate_isolated_edition(NOW, articles=intraday_source(),
                    source_window=WINDOW, providers=provider, clock=lambda: NOW)


class PublishedUpdateHistoryTests(unittest.TestCase):
    def test_all_daytime_updates_remain_in_history_after_later_update(self):
        storage = MemoryStorage()
        original = issue()
        updates = []
        for index in (1, 2):
            value = deepcopy(original)
            value['reviewed_at'] += index * 60
            value['article_refs'][0]['url'] += '?update=' + str(index)
            value['article_summaries'][0]['url'] = value['article_refs'][0]['url']
            updates.append(value)
            storage.values[f"days/{value['edition_date']}/reviewed-{int(value['reviewed_at']*1_000_000):020d}.json"] = value
        storage.values[f"days/{original['edition_date']}/edition.json"] = original
        with TemporaryDirectory() as folder:
            runtime = DailyNewsRuntime(storage, None, enabled=False,
                     baseline_path=Path(folder)/'empty.json', cache_path=Path(folder)/'cache.json',
                     clock=lambda: MORNING_NOW + 3600)
            runtime._install([updates[-1]])
            history = runtime._published_history(MORNING_NOW + 3600)
            urls = {ref['url'] for value in history for ref in value['article_refs']}
            self.assertEqual(urls, {ref['url'] for v in [original] + updates for ref in v['article_refs']})
            self.assertIsNotNone(runtime._source_history)
            changed = deepcopy(updates[-1])
            changed['reviewed_at'] += 60
            runtime._install([changed])
            self.assertIsNone(runtime._source_history)


if __name__ == '__main__':
    unittest.main()
