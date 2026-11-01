"""The bounded writer preserves JSON bytes and rejects unusable staged output."""
import io
import json
import unittest

from bounded_json import JsonSizeLimitError, dump_bounded_json


class BoundedJSONTests(unittest.TestCase):
    def test_json_options_and_unicode_have_the_standard_exact_encoding(self):
        value = {'日本語': ['🌱', -0.0, 4.25, None, True], 'nested': {'z': 2, 'a': 1}}
        for options in ({}, {'ensure_ascii': False},
                        {'ensure_ascii': False, 'separators': (',', ':'), 'sort_keys': True},
                        {'indent': 2, 'ensure_ascii': True, 'allow_nan': False}):
            with self.subTest(options=options):
                expected = json.dumps(value, **options).encode('utf-8')
                output = io.BytesIO()
                count = dump_bounded_json(value, output, max_bytes=len(expected), **options)
                self.assertEqual(output.getvalue(), expected)
                self.assertEqual(count, len(expected))

    def test_limit_counts_utf8_bytes_and_never_writes_past_it(self):
        value = {'text': '🌱あ'}
        expected = json.dumps(value, ensure_ascii=False).encode('utf-8')
        output = io.BytesIO()
        with self.assertRaises(JsonSizeLimitError):
            dump_bounded_json(value, output, max_bytes=len(expected) - 1, ensure_ascii=False)
        self.assertLessEqual(len(output.getvalue()), len(expected) - 1)

    def test_large_string_values_write_small_chunks_and_restore_all_content(self):
        class RecordingOutput(io.BytesIO):
            def __init__(self):
                super().__init__()
                self.write_sizes = []

            def write(self, value):
                self.write_sizes.append(len(value))
                return super().write(value)

        value = {'text': '🌱日本語' * 30_000, 'after': 17}
        output = RecordingOutput()
        count = dump_bounded_json(value, output, max_bytes=1_000_000, ensure_ascii=False)
        self.assertEqual(json.loads(output.getvalue()), value)
        self.assertEqual(count, len(output.getvalue()))
        self.assertGreater(len(output.write_sizes), 4)
        self.assertLessEqual(max(output.write_sizes), 65_536)

    def test_nonfinite_json_is_not_classified_as_a_size_failure(self):
        with self.assertRaises(ValueError) as caught:
            dump_bounded_json({'value': float('nan')}, io.BytesIO(),
                              max_bytes=1000, allow_nan=False)
        self.assertNotIsInstance(caught.exception, JsonSizeLimitError)

    def test_short_writes_are_rejected(self):
        class ShortOutput:
            def write(self, value):
                return max(0, len(value) - 1)

        with self.assertRaises(OSError):
            dump_bounded_json({'value': 3}, ShortOutput(), max_bytes=1000)

    def test_invalid_limits_do_not_write_anything(self):
        for limit in (-1, True, 5.5):
            output = io.BytesIO()
            with self.assertRaises(ValueError):
                dump_bounded_json({'value': 3}, output, max_bytes=limit)
            self.assertEqual(output.getvalue(), b'')


if __name__ == '__main__':
    unittest.main()
