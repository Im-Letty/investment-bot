import unittest
from pathlib import Path
from scanner_universe import load_universe, next_batch
from scanner_snapshot import valid_quotes


class UniverseTests(unittest.TestCase):
    def test_official_domestic_catalogue_has_all_three_markets(self):
        rows = load_universe(Path(__file__).resolve().parents[1] / 'static/jpx-company-catalogue.json')
        self.assertGreater(len(rows), 3000)
        self.assertEqual({r['market'] for r in rows.values()}, {'prime', 'standard', 'growth'})
        self.assertNotIn('6502.T', rows)  # delisted Toshiba cannot enter the scope

    def test_bounded_batches_cover_every_symbol_and_wrap(self):
        symbols = [str(i) for i in range(450)]
        cursor, seen = 0, set()
        for _ in range(3):
            batch, cursor = next_batch(symbols, cursor)
            self.assertEqual(len(batch), 200)
            self.assertEqual(len(set(batch)), 200)
            seen.update(batch)
        self.assertEqual(seen, set(symbols))
        self.assertEqual(next_batch([], 0), ([], 0))

    def test_volume_is_optional_and_never_invented(self):
        from tests.test_scanner_snapshot import quote, NOW
        for value in (None, -1, float('nan'), True, '100'):
            rows = valid_quotes([dict(quote(), volume=value)], NOW)
            self.assertNotIn('volume', rows['7203.T'])
        self.assertEqual(valid_quotes([dict(quote(), volume=123)], NOW)['7203.T']['volume'], 123)
