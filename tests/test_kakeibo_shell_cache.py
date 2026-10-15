"""Exercise the real shell route without importing the application's workers."""
import ast
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from flask import Flask, send_file
from ledger_api import create_ledger_blueprint


ROOT = Path(__file__).resolve().parents[1]


class KakeiboShellCacheTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.shell = Path(self.directory.name) / 'kakeibo.html'
        self.source_bytes = (ROOT / 'kakeibo.html').read_bytes()
        self.shell.write_bytes(self.source_bytes)
        self.app = Flask('kakeibo-shell-wrapper', root_path=self.directory.name)
        tree = ast.parse((ROOT / 'line_bot.py').read_text(encoding='utf-8'))
        nodes = [node for node in tree.body
                 if isinstance(node, ast.FunctionDef) and node.name == 'kakeibo']
        self.assertEqual(len(nodes), 1)
        # Compile the actual production route, keeping its decorators and path
        # handling. No line_bot imports, auth requests or background workers run.
        context = {'app': self.app, 'send_file': send_file, 'os': os}
        exec(compile(ast.Module(body=nodes, type_ignores=[]), 'kakeibo-shell-route', 'exec'), context)
        self.client = self.app.test_client()

    def get_shell(self, **kwargs):
        response = self.client.get('/kakeibo', **kwargs)
        self.addCleanup(response.close)
        return response

    def assert_shell_policy(self, response):
        policy = response.headers.get('Cache-Control', '')
        self.assertIn('private', policy.split(', '))
        self.assertIn('max-age=60', policy.split(', '))
        self.assertIn('must-revalidate', policy.split(', '))
        self.assertNotIn('public', policy.split(', '))
        self.assertNotIn('Set-Cookie', response.headers)

    def test_shell_is_exact_static_html_with_a_short_private_etag_cache(self):
        response = self.get_shell()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, self.source_bytes)
        self.assertEqual(response.mimetype, 'text/html')
        self.assertTrue(response.headers.get('ETag'))
        self.assert_shell_policy(response)

    def test_matching_etag_returns_304_without_a_body(self):
        original = self.get_shell()
        response = self.get_shell(headers={'If-None-Match': original.headers['ETag']})
        self.assertEqual(response.status_code, 304)
        self.assertEqual(response.data, b'')
        self.assertEqual(response.headers['ETag'], original.headers['ETag'])
        self.assert_shell_policy(response)

    def test_changed_source_has_a_new_etag_and_an_old_validator_receives_new_bytes(self):
        original = self.get_shell()
        changed = self.source_bytes + b'\n<!-- synthetic shell revision -->\n'
        self.shell.write_bytes(changed)
        response = self.get_shell(headers={'If-None-Match': original.headers['ETag']})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, changed)
        self.assertNotEqual(response.headers['ETag'], original.headers['ETag'])
        self.assert_shell_policy(response)

    def test_shell_cache_policy_does_not_apply_to_private_load_or_save(self):
        # An explicit repository object avoids construction of any real remote
        # storage client. Missing bearer auth must reject before touching it.
        self.app.register_blueprint(create_ledger_blueprint('', '', repository=object()))
        for path, method in [('/api/kakeibo/load', 'get'), ('/api/kakeibo/save', 'post')]:
            response = getattr(self.client, method)(path)
            self.assertEqual(response.status_code, 401)
            self.assertEqual(response.json, {'error': 'auth_required'})
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
            self.assertNotIn('ETag', response.headers)


if __name__ == '__main__':
    unittest.main()
