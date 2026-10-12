"""Safety fixtures for metadata checks; never perform real source requests."""
from copy import deepcopy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import requests

PATH = Path(__file__).resolve().parents[1] / 'scripts/check_regional_forecast_updates.py'
SPEC = importlib.util.spec_from_file_location('regional_forecast_updates', PATH)
check = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(check)

COMPANY = dict(symbol='1738.JP', code='1738', name='ＮＩＴＴＯＨ', aliases=['株式会社ニットー'])
SOURCE = dict(id='nse:1738', kind='nse_json', url='https://www.nse.or.jp/api/stock/view.json?stockCode=17380',
              expected_stock_code='17380', document_base_url='https://www.nse.or.jp/listing/search/files/',
              document_hosts=['www.nse.or.jp'], verified_on='2026-10-13', known_documents=[])


def nse_body(code='17380', name='ＮＩＴＴＯＨ', filename='forecast.pdf', title='配当予想の修正に関するお知らせ', when='2026-10-13'):
    return json.dumps(dict(stock=dict(stockCode=code, stockName_j=name, latestPrice=1234,
                                     listedCount=9999, internalField='ignored'), kessan=[],
                           timely=[dict(title=title, date=when, filename=filename)]), ensure_ascii=False)


def manifest(two=False, issuer=False):
    companies = [{**deepcopy(COMPANY), 'sources': [deepcopy(SOURCE)]}]
    for number in range(2000, 2109):
        companies.append(dict(symbol=str(number) + '.JP', code=str(number), name='会社' + str(number), sources=[]))
    if two:
        companies[1]['sources'] = [{**deepcopy(SOURCE), 'id': 'nse:2000', 'url': 'https://www.nse.or.jp/api/stock/view.json?stockCode=20000',
                                   'expected_stock_code': '20000'}]
    if issuer:
        companies[0]['sources'].append(dict(id='issuer:1738:0', kind='issuer_html', url='https://www.nittoh-info.co.jp/ir/',
                                           document_hosts=['www.nittoh-info.co.jp'], verified_on='2026-10-13',
                                           identity_names=['株式会社ニットー'], identity_evidence_url=SOURCE['url'], known_documents=[]))
    return dict(schema_version=1, latest_revision_guaranteed=False, companies=companies, gaps=[])


class Clock:
    def __init__(self):
        self.value = 1791846000.0

    def now(self):
        return self.value

    def sleep(self, seconds):
        self.value += seconds


class Response:
    def __init__(self, body='', status=200, headers=None):
        self.status_code, self.headers = status, headers or {}
        self.body = body.encode()
        self.closed = False

    def iter_content(self, size):
        yield self.body

    def close(self):
        self.closed = True


class Session:
    def __init__(self, responses, clock):
        self.responses, self.clock, self.calls = list(responses), clock, []

    def get(self, url, **kwargs):
        self.calls.append((url, self.clock.now(), kwargs))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def checker(m, work, session, clock, **kwargs):
    return check.Checker(m, work, session=session, wall=clock.now, monotonic=clock.now, sleep=clock.sleep, **kwargs)


def saved_state(work, clock, cursor, *, recent=False):
    checked = clock.now() - (60 if recent else 21601)
    value = dict(schema_version=1, cursor=cursor, hosts={}, review_queue={}, sources={
        'nse:1738': dict(last_attempt_status='checked', last_successful_check_at=checked,
                         next_check_at=checked + 21600, identity=dict(code='1738', name='ＮＩＴＴＯＨ'),
                         documents={'old_document':dict(title='Previously saved metadata')})})
    check.atomic_json(Path(work) / 'checkpoint.json', value)
    return value


def issuer_body(name='株式会社ニットー', widget=False):
    html = '<h1>' + name + '</h1><a href="forecast.pdf">決算短信</a>'
    if widget:
        html += '<script src="//www.xj-storage.jp/resources/AS82085/XjStorageLoaderIRNews.js?ver=7.1.3"></script>'
    return html


def widget_manifest():
    # Synthetic binding for mocked order/budget checks; no real request is made.
    m = manifest(issuer=True)
    issuer = m['companies'][0]['sources'][1]
    issuer['required_public_widget_selector'] = 'AS82085'
    m['companies'][0]['sources'].append(dict(
        id='issuer-feed:1738', kind='issuer_xj_json',
        url='https://www.xj-storage.jp/public-list/GetList2.aspx?company=AS82085&len=100&output=json',
        document_hosts=['contents.xj-storage.jp'], verified_on='2026-10-13',
        expected_public_company_selector='AS82085', identity_evidence_url=SOURCE['url'],
        dependency_source_id=issuer['id'], issuer_binding_page_url=issuer['url'],
        issuer_script_url='https://www.xj-storage.jp/resources/AS82085/XjStorageLoaderIRNews.js'))
    return m


def widget_body():
    return json.dumps(dict(items=[dict(title='配当予想の修正', publishDate='2026/10/13 15:30:00',
                                      files=[dict(url='https://contents.xj-storage.jp/xcontents/AS82085/forecast.pdf')])]), ensure_ascii=False)


class RegionalForecastUpdates(unittest.TestCase):
    def test_offline_cli_never_constructs_a_network_session_or_touches_fact_seed(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'manifest.json'; path.write_text(json.dumps(manifest()))
            with patch.object(check.requests, 'Session', side_effect=AssertionError('network')), patch('sys.stdout', new=io.StringIO()):
                self.assertEqual(check.main(['--manifest', str(path), '--work-dir', tmp]), 0)
            self.assertFalse((Path(tmp) / 'checkpoint.json').exists())

    def test_exact_issuer_and_code_are_required_and_price_fields_are_not_retained(self):
        parsed = check.parse_source(SOURCE, COMPANY, nse_body())
        self.assertEqual(parsed['identity']['code'], '1738')
        self.assertEqual(parsed['documents'][0]['publisher_date'], '2026-10-13')
        self.assertNotIn('latestPrice', json.dumps(parsed))
        self.assertNotIn('listedCount', json.dumps(parsed))
        live = json.loads(nse_body()); live['stock'] = [live['stock']]
        self.assertEqual(check.parse_source(SOURCE, COMPANY, json.dumps(live))['identity']['code'], '1738')
        live['stock'].append(dict(stockCode='99990', stockName_j='別会社'))
        with self.assertRaisesRegex(check.CheckError, 'source_company_identity_mismatch'):
            check.parse_source(SOURCE, COMPANY, json.dumps(live))
        for body in (nse_body(code='17390'), nse_body(name='ニットーサービス株式会社')):
            with self.assertRaisesRegex(check.CheckError, 'source_company_identity_mismatch'):
                check.parse_source(SOURCE, COMPANY, body)
        bad = {**SOURCE, 'expected_stock_code': '17390'}
        with self.assertRaisesRegex(check.CheckError, 'source_company_identity_mismatch'):
            check.parse_source(bad, COMPANY, nse_body(code='17390'))

    def test_punctuation_does_not_merge_different_issuer_names(self):
        for first, second in [('A・B', 'AB'), ('A.B', 'AB'), ('A-B', 'AB'), ('ABC(地域)', 'ABC地域')]:
            self.assertNotEqual(check.normalized_name(first), check.normalized_name(second))
            company = {**COMPANY, 'name':first, 'aliases':[]}
            with self.assertRaisesRegex(check.CheckError, 'source_company_identity_mismatch'):
                check.parse_source(SOURCE, company, nse_body(name=second))
        company = {**COMPANY, 'name':'A・B', 'aliases':['AB']}
        self.assertEqual(check.parse_source(SOURCE, company, nse_body(name='AB'))['identity']['code'], '1738')

    def test_public_widget_requires_fresh_issuer_binding_and_rejects_another_company_file(self):
        company = dict(symbol='353A.JP', code='353A', name='エレベーターコミュニケーションズ株式会社')
        html_source = dict(id='issuer:353A:0', kind='issuer_html', url='https://www.evcom.co.jp/ir/news/',
                           document_hosts=['contents.xj-storage.jp'], identity_names=[company['name']],
                           identity_evidence_url='https://www.sse.or.jp/listing/company353A', required_public_widget_selector='AS82085')
        html = '<h1>' + company['name'] + '</h1><script src="//www.xj-storage.jp/resources/AS82085/XjStorageLoaderIRNews.js?ver=7.1.3"></script>'
        self.assertEqual(check.parse_source(html_source, company, html)['identity']['embedded_public_widget_selector'], 'AS82085')
        with self.assertRaisesRegex(check.CheckError, 'source_widget_binding_mismatch'):
            check.parse_source(html_source, company, html.replace('AS82085', 'AS99999'))
        source = dict(id='issuer-feed:353A', kind='issuer_xj_json', url='https://www.xj-storage.jp/public-list/GetList2.aspx?company=AS82085&len=100&output=json',
                      expected_public_company_selector='AS82085', document_hosts=['contents.xj-storage.jp'],
                      identity_evidence_url=html_source['identity_evidence_url'], issuer_binding_page_url=html_source['url'])
        body = dict(items=[dict(title='配当予想の修正', publishDate='2026/10/13 15:30:00', files=[dict(url='https://contents.xj-storage.jp/xcontents/AS82085/document.pdf')])])
        self.assertEqual(check.parse_source(source, company, json.dumps(body))['documents'][0]['publisher_date'], '2026-10-13')
        with self.assertRaisesRegex(check.CheckError, 'source_company_identity_mismatch'):
            check.parse_source(source, company, json.dumps(body).replace('AS82085/document', 'AS99999/document'))

    def test_source_selection_can_only_target_known_manifest_pages(self):
        m, clock = manifest(two=True), Clock()
        with tempfile.TemporaryDirectory() as tmp:
            session = Session([Response(nse_body(code='20000', name='会社2000'))], clock)
            result = checker(m, tmp, session, clock, source_ids=['nse:2000']).fetch()
            self.assertEqual(result['requests'], 1)
            self.assertEqual([r['symbol'] for r in result['events']], ['2000.JP'])
            with self.assertRaisesRegex(check.CheckError, 'unknown_manifest_source_id'):
                checker(m, tmp, session, clock, source_ids=['unreviewed-page'])

    def test_publisher_html_checks_issuer_section_not_a_menu_code(self):
        source = dict(id='sse:1738', kind='sse_html', url='https://www.sse.or.jp/listing/company1738', document_hosts=['www.sse.or.jp'])
        html = '''<nav>1738 ＮＩＴＴＯＨ</nav><section id="pgtitle"><h2>別会社</h2></section>
        <section id="companyprofile"><span>9999</span></section><section id="settlement">
        <dt>2026年10月13日</dt><dd><a href="/forecast.pdf">決算短信</a></dd></section>'''
        with self.assertRaisesRegex(check.CheckError, 'source_company_identity_mismatch'):
            check.parse_source(source, COMPANY, html)
        html = html.replace('<h2>別会社</h2>', '<h2>ＮＩＴＴＯＨ</h2>').replace('<span>9999</span>', '<span>1738</span>')
        self.assertEqual(check.parse_source(source, COMPANY, html)['documents'][0]['publisher_date'], '2026-10-13')

    def test_undated_links_are_review_candidates_not_today_or_verified_numbers(self):
        m, clock = manifest(), Clock()
        with tempfile.TemporaryDirectory() as tmp:
            session = Session([Response(nse_body(when='not-a-date'))], clock)
            result = checker(m, tmp, session, clock).fetch()
            queue = check.read_json(Path(tmp) / 'review-queue.json')['items']
            self.assertEqual(result['requests'], 1)
            self.assertIsNone(queue[0]['metadata']['publisher_date'])
            self.assertIsNone(queue[0]['announcement_date'])
            self.assertIsNone(queue[0]['annual_forecast_value'])
            self.assertFalse(queue[0]['fact_eligible'])
            self.assertFalse(queue[0]['latest_revision_guaranteed'])

    def test_same_url_revision_is_queued_and_transport_failure_keeps_metadata(self):
        m, clock = manifest(), Clock()
        old = check.parse_source(SOURCE, COMPANY, nse_body(title='配当予想について'))['documents'][0]
        m['companies'][0]['sources'][0]['known_documents'] = [old]
        with tempfile.TemporaryDirectory() as tmp:
            session = Session([Response(nse_body(title='（訂正）配当予想について'))], clock)
            checker(m, tmp, session, clock).fetch()
            before = check.read_json(Path(tmp) / 'checkpoint.json')
            self.assertEqual(len(before['review_queue']), 1)
            clock.sleep(21601)
            failed = Session([requests.ConnectionError('https://secret.example/?token=never_emit')], clock)
            report = checker(m, tmp, failed, clock).fetch()
            after = check.read_json(Path(tmp) / 'checkpoint.json')
            self.assertEqual(before['sources']['nse:1738']['documents'], after['sources']['nse:1738']['documents'])
            self.assertEqual(before['sources']['nse:1738']['last_successful_check_at'], after['sources']['nse:1738']['last_successful_check_at'])
            self.assertEqual(before['review_queue'], after['review_queue'])
            self.assertNotIn('secret.example', json.dumps(report))

    def test_rate_limit_retry_after_and_checkpoint_prevent_calls_to_same_host(self):
        m, clock = manifest(two=True), Clock()
        for status in (429, 503):
            with tempfile.TemporaryDirectory() as tmp:
                session = Session([Response(status=status, headers={'Retry-After': '3600'})], clock)
                first = checker(m, tmp, session, clock).fetch()
                self.assertEqual(first['requests'], 1)
                self.assertEqual(first['events'][1]['status'], 'deferred_host_backoff')
                second = checker(m, tmp, Session([], clock), clock).fetch()
                self.assertEqual(second['requests'], 0)
                self.assertEqual(check.retry_after_seconds('Tue, 13 Oct 2026 12:00:00 GMT', 1791892790), 10)

    def test_budget_resume_serial_interval_size_limits_and_no_redirect_follow(self):
        m, clock = manifest(two=True), Clock()
        with tempfile.TemporaryDirectory() as tmp:
            session = Session([Response(nse_body())], clock)
            first = checker(m, tmp, session, clock, max_requests=1).fetch()
            self.assertEqual(first['requests'], 1)
            self.assertEqual(first['next_cursor'], 1)
            self.assertEqual(first['stopped_reason'], 'budget_exhausted')
            resumed = Session([Response(nse_body(code='20000', name='会社2000'))], clock)
            second = checker(m, tmp, resumed, clock).fetch()
            self.assertEqual(second['events'][0]['symbol'], '2000.JP')
        with tempfile.TemporaryDirectory() as tmp:
            session = Session([Response(nse_body()), Response(nse_body(code='20000', name='会社2000'))], clock)
            checker(m, tmp, session, clock).fetch()
            self.assertGreaterEqual(session.calls[1][1] - session.calls[0][1], 1.5)
            self.assertTrue(all(call[2]['allow_redirects'] is False for call in session.calls))
        with tempfile.TemporaryDirectory() as tmp:
            session = Session([Response('x' * 30, headers={'Content-Length': '30'})], clock)
            result = checker(manifest(), tmp, session, clock, max_response_bytes=10).fetch()
            self.assertEqual(result['events'][0]['reason'], 'response_size_limit')
        with tempfile.TemporaryDirectory() as tmp:
            session = Session([Response(status=302, headers={'Location': 'https://login.example/auth'})], clock)
            self.assertEqual(checker(manifest(), tmp, session, clock).fetch()['requests'], 1)

    def test_issuer_requires_successful_publisher_identity_and_failed_parse_does_not_clear_docs(self):
        m, clock = manifest(issuer=True), Clock()
        with tempfile.TemporaryDirectory() as tmp:
            session = Session([Response(nse_body(name='別会社'))], clock)
            result = checker(m, tmp, session, clock).fetch()
            self.assertEqual(result['requests'], 1)
            self.assertEqual(result['events'][1]['status'], 'deferred_publisher_identity_check')
        with tempfile.TemporaryDirectory() as tmp:
            session = Session([Response(nse_body()), Response('<h1>株式会社ニットー</h1><a href="forecast.pdf">決算短信</a>')], clock)
            result = checker(m, tmp, session, clock).fetch()
            self.assertEqual(result['requests'], 2)
            self.assertEqual(result['events'][1]['status'], 'checked')

    def test_invalid_state_is_preserved_and_single_file_lock_blocks_concurrent_fetch(self):
        m, clock = manifest(), Clock()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'checkpoint.json'; path.write_text('{broken')
            with self.assertRaisesRegex(check.CheckError, 'invalid_json'):
                checker(m, tmp, Session([], clock), clock).fetch()
            self.assertEqual(path.read_text(), '{broken')
            path.unlink()
            invalid = dict(schema_version=1, sources={'nse:1738':'broken'}, hosts={}, review_queue={}, cursor=0)
            path.write_text(json.dumps(invalid))
            with self.assertRaisesRegex(check.CheckError, 'invalid_checkpoint'):
                checker(m, tmp, Session([], clock), clock).fetch()
            self.assertEqual(json.loads(path.read_text()), invalid)
            path.unlink()
            with check.file_lock(tmp):
                with self.assertRaisesRegex(check.CheckError, 'already_running'):
                    checker(m, tmp, Session([], clock), clock).fetch()

    def test_serial_spacing_is_restored_after_restart(self):
        m, clock = manifest(two=True), Clock()
        with tempfile.TemporaryDirectory() as tmp:
            first = Session([Response(nse_body())], clock)
            checker(m, tmp, first, clock, max_requests=1).fetch()
            resumed = Session([Response(nse_body(code='20000', name='会社2000'))], clock)
            checker(m, tmp, resumed, clock).fetch()
            self.assertGreaterEqual(resumed.calls[0][1] - first.calls[0][1], 1.5)

    def test_registration_urls_and_limits_fail_closed(self):
        for url in ('https://example.com/forecast.pdf?token=secret', 'https://user:pass@example.com/file.pdf',
                    'https://example.com/login', 'http://127.0.0.1/source', 'https://example.com:bad/ir'):
            self.assertFalse(check.public_url(url))
        with tempfile.TemporaryDirectory() as tmp:
            for limits in ({'max_requests':181}, {'max_seconds':901}, {'min_check_seconds':0}, {'max_total_bytes':20_000_001}):
                with self.assertRaisesRegex(check.CheckError, 'invalid_budget'):
                    checker(manifest(), tmp, Session([], Clock()), Clock(), **limits)

    def test_issuer_cursor_reads_stale_publisher_first_or_reuses_recent_checked_identity(self):
        for recent in (False, True):
            m, clock = manifest(issuer=True), Clock()
            with tempfile.TemporaryDirectory() as tmp:
                saved_state(tmp, clock, 1, recent=recent)
                responses = [Response(issuer_body())] if recent else [Response(nse_body()), Response(issuer_body())]
                session = Session(responses, clock)
                result = checker(m, tmp, session, clock).fetch()
                self.assertEqual(result['requests'], 1 if recent else 2)
                self.assertEqual([c[0] for c in session.calls], [m['companies'][0]['sources'][1]['url']] if recent else
                                 [SOURCE['url'], m['companies'][0]['sources'][1]['url']])
                self.assertEqual(result['dependency_requests'], 0 if recent else 1)
                self.assertEqual(result['next_cursor'], 0)
                self.assertIsNone(result['stopped_reason'])
                self.assertEqual(check.read_json(Path(tmp) / 'checkpoint.json')['sources']['issuer:1738:0']['last_attempt_status'], 'checked')
                # A following daily run must visit the issuer again, not defer it forever.
                clock.sleep(86400)
                tomorrow = Session([Response(nse_body()), Response(issuer_body())], clock)
                self.assertEqual(checker(m, tmp, tomorrow, clock).fetch()['requests'], 2)
                self.assertEqual([c[0] for c in tomorrow.calls], [SOURCE['url'], m['companies'][0]['sources'][1]['url']])

    def test_dependency_budget_stop_resumes_same_main_target_and_keeps_existing_state(self):
        m, clock = manifest(issuer=True), Clock()
        with tempfile.TemporaryDirectory() as tmp:
            state = saved_state(tmp, clock, 1)
            state['hosts']['unchanged.example.com'] = dict(failures=2, next_allowed_at=clock.now() + 3600)
            state['review_queue']['already_reviewed'] = dict(fact_eligible=False, review_status='already_reviewed')
            state['sources']['unchanged'] = dict(documents={'known':dict(title='existing fact proof')})
            check.atomic_json(Path(tmp) / 'checkpoint.json', state)
            first = Session([Response(nse_body())], clock)
            stopped = checker(m, tmp, first, clock, max_requests=1).fetch()
            self.assertEqual(stopped['requests'], 1)
            self.assertEqual(stopped['stopped_reason'], 'budget_exhausted')
            self.assertEqual(stopped['next_cursor'], 1)
            after = check.read_json(Path(tmp) / 'checkpoint.json')
            self.assertEqual(after['hosts']['unchanged.example.com'], state['hosts']['unchanged.example.com'])
            self.assertEqual(after['sources']['unchanged'], state['sources']['unchanged'])
            self.assertEqual(after['review_queue']['already_reviewed'], state['review_queue']['already_reviewed'])
            self.assertEqual(after['sources']['nse:1738']['documents']['old_document'], state['sources']['nse:1738']['documents']['old_document'])
            second = Session([Response(issuer_body())], clock)
            resumed = checker(m, tmp, second, clock, max_requests=1).fetch()
            self.assertEqual(resumed['requests'], 1)
            self.assertEqual([c[0] for c in second.calls], [m['companies'][0]['sources'][1]['url']])
            self.assertEqual(resumed['next_cursor'], 0)

    def test_small_budget_progresses_to_the_next_company_issuer(self):
        m, clock = manifest(two=True, issuer=True), Clock()
        m['companies'][1]['sources'].append(dict(id='issuer:2000:0', kind='issuer_html',
            url='https://www.second-issuer.example/ir/', document_hosts=['www.second-issuer.example'],
            verified_on='2026-10-13', identity_names=['会社2000'], identity_evidence_url=m['companies'][1]['sources'][0]['url']))
        with tempfile.TemporaryDirectory() as tmp:
            saved_state(tmp, clock, 2)
            first = Session([Response(nse_body()), Response(issuer_body())], clock)
            result = checker(m, tmp, first, clock, max_requests=2).fetch()
            self.assertEqual(result['next_cursor'], 3)
            self.assertEqual(result['stopped_reason'], 'budget_exhausted')
            second = Session([Response(nse_body(code='20000', name='会社2000')), Response(issuer_body('会社2000'))], clock)
            result = checker(m, tmp, second, clock, max_requests=2).fetch()
            self.assertEqual([c[0] for c in second.calls], [m['companies'][1]['sources'][0]['url'], m['companies'][1]['sources'][1]['url']])
            self.assertEqual(result['requests'], 2)
            self.assertEqual(result['next_cursor'], 0)

    def test_widget_resume_visits_publisher_then_issuer_then_widget_with_budgeted_dependencies(self):
        m, clock = widget_manifest(), Clock()
        with tempfile.TemporaryDirectory() as tmp:
            saved_state(tmp, clock, 2)
            session = Session([Response(nse_body()), Response(issuer_body(widget=True)), Response(widget_body())], clock)
            result = checker(m, tmp, session, clock).fetch()
            self.assertEqual([c[0] for c in session.calls], [s['url'] for s in m['companies'][0]['sources']])
            self.assertEqual(result['requests'], 3)
            self.assertEqual(result['dependency_requests'], 2)
            self.assertEqual(result['next_cursor'], 0)
            self.assertTrue(all(session.calls[i+1][1] - session.calls[i][1] >= 1.5 for i in range(2)))
        with tempfile.TemporaryDirectory() as tmp:
            saved_state(tmp, clock, 2)
            first = Session([Response(nse_body()), Response(issuer_body(widget=True))], clock)
            result = checker(m, tmp, first, clock, max_requests=2).fetch()
            self.assertEqual(result['next_cursor'], 2)
            self.assertEqual(result['stopped_reason'], 'budget_exhausted')
            resumed = Session([Response(widget_body())], clock)
            result = checker(m, tmp, resumed, clock, max_requests=1).fetch()
            self.assertEqual(result['requests'], 1)
            self.assertEqual([c[0] for c in resumed.calls], [m['companies'][0]['sources'][2]['url']])
            self.assertEqual(result['next_cursor'], 0)

    def test_selected_scan_and_its_budget_cursor_do_not_move_global_scan_cursor(self):
        m, clock = manifest(issuer=True), Clock()
        with tempfile.TemporaryDirectory() as tmp:
            saved_state(tmp, clock, 138)
            selected = ['issuer:1738:0']
            first = Session([Response(nse_body())], clock)
            result = checker(m, tmp, first, clock, source_ids=selected, max_requests=1).fetch()
            self.assertEqual(result['next_cursor'], 138)
            self.assertEqual(result['next_selected_cursor'], 1)
            second = Session([Response(issuer_body())], clock)
            result = checker(m, tmp, second, clock, source_ids=selected, max_requests=1).fetch()
            self.assertEqual(result['next_cursor'], 138)
            self.assertEqual(result['next_selected_cursor'], 0)
            self.assertEqual(check.read_json(Path(tmp) / 'checkpoint.json')['cursor'], 138)

    def test_resumed_dependency_respects_existing_host_backoff_without_clearing_metadata(self):
        m, clock = manifest(issuer=True), Clock()
        with tempfile.TemporaryDirectory() as tmp:
            state = saved_state(tmp, clock, 1)
            state['hosts']['www.nse.or.jp'] = dict(failures=3, next_allowed_at=clock.now() + 3600)
            check.atomic_json(Path(tmp) / 'checkpoint.json', state)
            session = Session([], clock)
            result = checker(m, tmp, session, clock).fetch()
            self.assertEqual(result['requests'], 0)
            self.assertIn('deferred_publisher_identity_check', [e['status'] for e in result['events']])
            after = check.read_json(Path(tmp) / 'checkpoint.json')
            self.assertEqual(after['sources'], state['sources'])
            self.assertEqual(after['hosts'], state['hosts'])


if __name__ == '__main__':
    unittest.main()
