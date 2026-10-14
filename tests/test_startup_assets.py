from hashlib import sha256
from pathlib import Path
import os
import re
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from flask import Flask

from startup_assets import StartupAssets, MAX_GENERATIONS, _safe_script


ROOT = Path(__file__).parents[1]


class StartupAssetsTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.static = self.root / "static"
        self.static.mkdir()
        self.sources = {
            "a.css": b".first { color: red; }\n",
            "b.css": b".second { background: url(./image.webp); }\n",
            "a.js": b"(function () { window.first = ['a']; })(); // end comment",
            "b.js": b"(function () { window.first.push('b'); })();\n",
        }
        for filename, body in self.sources.items():
            (self.static / filename).write_bytes(body)
        self.html = ('<!doctype html><html><head>\n'
                     '<script>window.first = [];</script>\n'
                     '<script src="/static/guest.js"></script>\n'
                     '<link rel="stylesheet" href="/static/a.css?v=first">\n'
                     '<script defer src="/static/a.js?v=first"></script>\n'
                     '<link rel="stylesheet" href="/static/b.css?v=first">\n'
                     '<script src="/static/b.js?v=first" defer></script>\n'
                     '<style id="original-style">.second { color: green; }</style>\n'
                     '<link rel="stylesheet" href="https://example.test/fonts" media="print">\n'
                     '<link rel="stylesheet" href="/static/menu.css?v=first">\n'
                     '</head><body><script defer id="late" src="/static/late.js"></script>'
                     '<div id="morning-news-content">Existing news</div></body></html>')
        (self.root / "index.html").write_text(self.html)
        self.assets = StartupAssets(self.root)

    def client(self, assets=None):
        app = Flask(__name__, static_folder=str(self.static))
        (assets or self.assets).register(app)
        return app.test_client()

    def urls(self, html):
        return re.findall(r"/static/startup-(?:css|js)-[a-f0-9]{64}\.(?:css|js)", html)

    def bundles(self, assets=None, html=None):
        assets = assets or self.assets
        html = assets.transform(self.html if html is None else html)
        client = self.client(assets)
        return html, {url.rsplit(".", 1)[1]: client.get(url).data for url in self.urls(html)}

    def test_only_target_tag_spans_change_and_cascade_positions_stay(self):
        transformed, bundles = self.bundles()
        self.assertEqual(len(self.urls(transformed)), 2)
        self.assertNotIn('/static/a.css?v=', transformed)
        self.assertNotIn('/static/b.js?v=', transformed)
        untouched = [
            '<script>window.first = [];</script>',
            '<script src="/static/guest.js"></script>',
            '<style id="original-style">.second { color: green; }</style>',
            '<link rel="stylesheet" href="https://example.test/fonts" media="print">',
            '<link rel="stylesheet" href="/static/menu.css?v=first">',
            '<script defer id="late" src="/static/late.js"></script>',
            '<div id="morning-news-content">Existing news</div>',
        ]
        for markup in untouched:
            self.assertIn(markup, transformed)
        self.assertLess(transformed.index("startup-css-"), transformed.index("original-style"))
        self.assertLess(transformed.index("original-style"), transformed.index("menu.css"))
        self.assertLess(transformed.index("startup-js-"), transformed.index("original-style"))
        self.assertEqual(bundles['css'], self.sources['a.css'] + b"\n" + self.sources['b.css'])

    def test_raw_script_bytes_order_exception_boundaries_and_asi_separator(self):
        _, bundles = self.bundles()
        script = bundles['js']
        self.assertLess(script.index(self.sources['a.js']), script.index(self.sources['b.js']))
        self.assertIn(b"/* a.js */\ntry {\n" + self.sources['a.js'], script)
        self.assertIn(b"\n;\n/* b.js */\ntry {\n", script)
        self.assertEqual(script.count(b"catch (error) { setTimeout(function () { throw error; }, 0); }"), 2)

    def test_content_digest_is_actual_bytes_and_route_beats_static(self):
        transformed = self.assets.transform(self.html)
        client = self.client()
        for url in self.urls(transformed):
            response = client.get(url)
            self.assertEqual(response.status_code, 200)
            digest = sha256(response.data).hexdigest()
            self.assertIn(digest, url)
            self.assertEqual(response.get_etag(), (digest, False))
            self.assertEqual(response.cache_control.max_age, 31536000)
            self.assertTrue(response.cache_control.public)
            self.assertTrue(response.cache_control.immutable)
            self.assertIn('text/css' if url.endswith('.css') else 'application/javascript', response.content_type)

    def test_conditional_get_and_head(self):
        url = self.urls(self.assets.transform(self.html))[0]
        client = self.client()
        response = client.get(url)
        cached = client.get(url, headers={'If-None-Match': response.headers['ETag']})
        self.assertEqual(cached.status_code, 304)
        self.assertEqual(cached.data, b'')
        self.assertTrue(cached.cache_control.immutable)
        head = client.head(url)
        self.assertEqual(head.status_code, 200)
        self.assertEqual(head.data, b'')
        self.assertEqual(head.content_length, len(response.data))

    def test_other_serving_worker_can_build_before_its_first_home_request(self):
        url = self.urls(self.assets.transform(self.html))[0]
        other = StartupAssets(self.root)
        response = self.client(other).get(url)
        self.assertEqual(response.status_code, 200)
        self.assertIn(sha256(response.data).hexdigest(), url)

    def test_unknown_digest_extension_kind_and_traversal_are_404(self):
        client = self.client()
        for url in (
            '/static/startup-css-' + 'a' * 64 + '.css',
            '/static/startup-css-' + 'A' * 64 + '.css',
            '/static/startup-css-' + 'a' * 64 + '.js',
            '/static/startup-json-' + 'a' * 64 + '.json',
            '/static/startup-js-../index.html.js',
        ):
            with self.subTest(url=url):
                self.assertEqual(client.get(url).status_code, 404)

    def test_missing_source_keeps_whole_original_html_and_prior_bundle(self):
        first = self.assets.transform(self.html)
        url = self.urls(first)[0]
        (self.static / 'b.js').unlink()
        self.assertEqual(self.assets.transform(self.html), self.html)
        self.assertEqual(self.client().get(url).status_code, 200)

    def test_modified_html_invalidates_cached_transform(self):
        first = self.assets.transform(self.html)
        changed = self.html.replace('Existing news', 'New published edition')
        actual = self.assets.transform(changed)
        self.assertNotEqual(actual, first)
        self.assertIn('New published edition', actual)
        self.assertEqual(self.urls(actual), self.urls(first))

    def test_modified_source_mtime_and_size_changes_digest(self):
        first = self.assets.transform(self.html)
        path = self.static / 'a.css'
        stamp = path.stat()
        path.write_bytes(b'.first { color: tan; }\n')  # Same size; mtime still matters.
        os.utime(path, ns=(stamp.st_atime_ns, stamp.st_mtime_ns + 1_000_000))
        second = self.assets.transform(self.html)
        self.assertNotEqual(self.urls(first)[0], self.urls(second)[0])
        old = self.client().get(self.urls(first)[0])
        self.assertEqual(old.status_code, 200)
        self.assertEqual(old.data, self.sources['a.css'] + b'\n' + self.sources['b.css'])

    def test_warm_transform_does_not_reparse_or_reread_source(self):
        first = self.assets.transform(self.html)
        with patch('startup_assets._Tags', side_effect=AssertionError('reparsed')), patch.object(Path, 'read_bytes', side_effect=AssertionError('reread')):
            self.assertEqual(self.assets.transform(self.html), first)

    def test_generation_history_and_retained_bytes_are_bounded(self):
        first = self.urls(self.assets.transform(self.html))[0]
        for number in range(MAX_GENERATIONS + 2):
            (self.static / 'a.css').write_text(f'.first {{ color: red; opacity: {number}; }}')
            self.assets.transform(self.html)
        self.assertLessEqual(len(self.assets._history), MAX_GENERATIONS)
        self.assertEqual(self.assets._history_bytes, sum(len(body) for generation in self.assets._history.values() for _, _, body in generation))
        self.assertEqual(self.client().get(first).status_code, 404)
        current = self.urls(self.assets.transform(self.html))[0]
        self.assertEqual(self.client().get(current).status_code, 200)

    def test_non_target_static_does_not_gain_immutable_or_cache_public_data(self):
        (self.static / 'data.json').write_text('{"fresh":"metadata"}')
        response = self.client().get('/static/data.json')
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.cache_control.immutable)
        response.close()

    def test_unsafe_css_directives_leave_original_whole_html(self):
        for source in ('@import "nested.css";', '@charset "UTF-8";', '@namespace svg "http://example.test/";'):
            with self.subTest(source=source):
                (self.static / 'a.css').write_text(source)
                self.assertEqual(self.assets.transform(self.html), self.html)

    def test_unsafe_javascript_leaves_original_whole_html(self):
        for source in (
            '(function(){ window.source = document.currentScript.src; })();',
            '(function(){ document.write("markup"); })();',
            '(function(){ window.scripts = document.scripts; })();',
            '(function(){ window.source = import.meta.url; })();',
            'const shared = 1;',
            '(function(){})(); let shared = 1;',
            '(function(){})(); class Shared {}',
            '"use strict"; (function(){})();',
            'window.ready = true; var shared = 1;',
            '(function(){})(',
        ):
            with self.subTest(source=source):
                (self.static / 'a.js').write_text(source)
                self.assertEqual(self.assets.transform(self.html), self.html)

    def test_broken_stylesheet_delimiters_cannot_consume_successor(self):
        for source in ('body {', 'body {} /* unfinished', 'body { color: "unfinished; }', 'body { background: url(open; }', 'body }'):
            with self.subTest(source=source):
                (self.static / 'a.css').write_text(source)
                self.assertEqual(self.assets.transform(self.html), self.html)

    def test_lexer_ignores_local_bindings_comment_strings_templates_and_regex(self):
        self.assertTrue(_safe_script('''/* let fake = 0; */
            (function () { const local = 1; let x = "class Shared {}";
              var pattern = /[{}\\/()]+/g; var t = `global let ${local}`;
              window.value = pattern.test(x) ? t : local / 2;
            })(); // trailing const bad
        '''))

    def test_attributes_are_excluded_and_interleaving_preserves_original_order(self):
        for attribute in ('id="middle"', 'integrity="hash"', 'type="module"', 'async', 'crossorigin="anonymous"'):
            with self.subTest(attribute=attribute):
                extra = f'<script defer {attribute} src="/static/other.js"></script>'
                altered = self.html.replace('<link rel="stylesheet" href="/static/b.css?v=first">', extra + '<link rel="stylesheet" href="/static/b.css?v=first">')
                self.assertEqual(self.assets.transform(altered), altered)
        extra = '<link rel="stylesheet" href="/static/other.css" media="screen">'
        altered = self.html.replace('<script defer src=', extra + '<script defer src=', 1)
        self.assertEqual(self.assets.transform(altered), altered)

    def test_duplicate_attributes_and_nested_paths_are_not_eligible(self):
        for extra in (
            '<script defer src="/static/other.js" src="/static/a.js"></script>',
            '<script defer src="/static/nested/other.js"></script>',
            '<script defer src="https://example.test/other.js"></script>',
        ):
            altered = self.html.replace('<link rel="stylesheet" href="/static/b.css?v=first">', extra + '<link rel="stylesheet" href="/static/b.css?v=first">')
            self.assertEqual(self.assets.transform(altered), altered)

    def test_symlink_outside_static_and_invalid_utf8_leave_original(self):
        path = self.static / 'a.css'
        path.unlink()
        outside = self.root / 'outside.css'
        outside.write_text('body {}')
        path.symlink_to(outside)
        self.assertEqual(self.assets.transform(self.html), self.html)
        path.unlink()
        path.write_bytes(b'\xff\xfe')
        self.assertEqual(self.assets.transform(self.html), self.html)

    def test_source_size_and_bundle_size_budget_leave_original(self):
        with patch('startup_assets.MAX_SOURCE_BYTES', 2):
            self.assertEqual(self.assets.transform(self.html), self.html)
        with patch('startup_assets.MAX_BUNDLE_BYTES', 2):
            self.assertEqual(self.assets.transform(self.html), self.html)

    def test_concurrent_input_change_during_read_leaves_original(self):
        actual = self.assets._inputs
        calls = 0

        def changing(tags):
            nonlocal calls
            calls += 1
            stamp = actual(tags)
            return stamp if calls == 1 else stamp + (('changed', 0, 0),)

        with patch.object(self.assets, '_inputs', side_effect=changing):
            self.assertEqual(self.assets.transform(self.html), self.html)

    def test_plain_html_without_eligible_tags_is_unchanged(self):
        self.assertEqual(self.assets.transform('<html><body>Original</body></html>'), '<html><body>Original</body></html>')

    def test_current_repository_assets_bundle_posting_with_existing_startup_groups(self):
        html = (ROOT / 'index.html').read_text()
        assets = StartupAssets(ROOT)
        transformed = assets.transform(html)
        self.assertNotEqual(transformed, html)
        app = Flask('actual_startup_assets', static_folder=None)
        assets.register(app)
        bundles = {url.rsplit('.', 1)[1]: app.test_client().get(url).data for url in self.urls(transformed)}
        self.assertEqual(bundles['js'].count(b'catch (error) { setTimeout(function () { throw error; }, 0); }'), 29)
        self.assertIn(b'KNShortsPosting', bundles['js'])
        self.assertIn(b'.ks-post-overlay', bundles['css'])
        self.assertNotIn('/static/shorts-posting.js?', transformed)
        self.assertNotIn('/static/shorts-posting.css?', transformed)
        self.assertEqual(transformed.count('startup-css-'), 1)
        self.assertIn('/static/menu-a.css?', transformed)
        self.assertIn('/static/stock-watch.js?', transformed)
        self.assertIn('/static/guest-access.js?', transformed)
        self.assertIn('/static/menu-a.js?', transformed)
        self.assertIn('fonts.googleapis.com/css2?', transformed)


if __name__ == '__main__':
    unittest.main()
