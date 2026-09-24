"""Company-name/code lookup backed by a verified, bundled JPX catalogue.

Quote availability never determines whether a search result is a real company.
The official monthly catalogue is loaded before serving requests; network refresh
runs separately and cannot replace good data with an empty/invalid download.
"""
from calendar import monthrange
from datetime import date, datetime, timezone
from hashlib import sha256
from io import BytesIO
import json
import os
from pathlib import Path
import re
from threading import Event, Lock, Semaphore, Thread
import time
import unicodedata
from urllib.parse import urljoin, urlsplit
import xml.etree.ElementTree as ET
from zipfile import BadZipFile, ZipFile

import requests

JPX_PAGE = 'https://www.jpx.co.jp/markets/statistics-equities/misc/01.html'
SEED_PATH = Path(__file__).with_name('static') / 'jpx-company-catalogue.json'
RUNTIME_PATH = Path('/tmp/kn-stock-catalogue.json')
MAX_DOWNLOAD = 5_000_000
JP_CODE = re.compile(r'^[0-9][0-9A-Z]{3}$')
YAHOO_SYMBOL = re.compile(r'^[A-Z0-9][A-Z0-9.=-]{0,19}$')
XNS = {'x': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def normalize(value):
    if not isinstance(value, str):
        return ''
    value = unicodedata.normalize('NFKC', value).casefold()
    # Hiragana/katakana share search keys, including half-width voiced kana.
    value = ''.join(chr(ord(c) + 0x60) if '\u3041' <= c <= '\u3096' else c for c in value)
    return re.sub(r'\s+', '', value)


def safe_symbol(value):
    if not isinstance(value, str):
        return None
    value = unicodedata.normalize('NFKC', value).strip().upper()
    return value if YAHOO_SYMBOL.fullmatch(value) else None


def _verified_catalogue(value):
    if not isinstance(value, dict) or value.get('source_url') != JPX_PAGE:
        raise ValueError('Invalid catalogue source')
    as_of = date.fromisoformat(value.get('as_of', ''))
    if as_of > datetime.now(timezone.utc).date():
        raise ValueError('Future catalogue')
    rows = value.get('items')
    if not isinstance(rows, list) or not 1000 <= len(rows) <= 10000:
        raise ValueError('Incomplete catalogue')
    clean = []
    seen = set()
    for row in rows:
        code = str(row.get('code', '')) if isinstance(row, dict) else ''
        name = row.get('name', '') if isinstance(row, dict) else ''
        market = row.get('market', '') if isinstance(row, dict) else ''
        if (not JP_CODE.fullmatch(code) or code in seen or not isinstance(name, str)
                or not 1 <= len(name) <= 200 or any(ord(c) < 32 for c in name)
                or not isinstance(market, str) or '内国株式' not in market):
            raise ValueError('Invalid catalogue company')
        clean.append({'code': code, 'name': name, 'market': market})
        seen.add(code)
    return {**value, 'as_of': as_of.isoformat(), 'items': sorted(clean, key=lambda row: row['code'])}


def parse_jpx_xlsx(payload, file_url, fetched_at=None):
    """Read only public cells from the JPX XLSX, without Excel or formula execution."""
    with ZipFile(BytesIO(payload)) as archive:
        if len(archive.infolist()) > 100 or sum(i.file_size for i in archive.infolist()) > 25_000_000:
            raise ValueError('Workbook size limit')
        shared = ET.fromstring(archive.read('xl/sharedStrings.xml'))
        strings = [''.join(n.itertext()) for n in shared.findall('x:si', XNS)]
        sheet = ET.fromstring(archive.read('xl/worksheets/sheet1.xml'))
    cells = []
    for row in sheet.findall('x:sheetData/x:row', XNS):
        values = {}
        for cell in row.findall('x:c', XNS):
            column = re.sub(r'\d', '', cell.get('r', ''))
            raw = cell.findtext('x:v', default='', namespaces=XNS)
            if cell.get('t') == 's':
                raw = strings[int(raw)]
            elif cell.get('t') == 'inlineStr':
                raw = ''.join(cell.find('x:is', XNS).itertext())
            values[column] = raw
        cells.append(values)
    if not cells:
        raise ValueError('Empty workbook')
    columns = {name: column for column, name in cells[0].items()}
    if not {'日付', 'コード', '銘柄名', '市場・商品区分'} <= columns.keys():
        raise ValueError('Unknown workbook columns')
    companies, dates = [], set()
    for values in cells[1:]:
        market = values.get(columns['市場・商品区分'], '').strip()
        if '内国株式' not in market:
            continue
        code = values.get(columns['コード'], '').strip().upper()
        if code.endswith('.0'):
            code = code[:-2]
        # Five-digit preferred/class shares need a different provider mapping.
        # Keep this catalogue to the existing four-character company codes.
        if re.fullmatch(r'[0-9]{5}', code):
            continue
        stamp = values.get(columns['日付'], '').strip().removesuffix('.0')
        parsed = datetime.strptime(stamp, '%Y%m%d').date()
        dates.add(parsed.isoformat())
        companies.append({'code': code, 'name': values.get(columns['銘柄名'], '').strip(), 'market': market})
    if len(dates) != 1:
        raise ValueError('Mixed catalogue dates')
    return _verified_catalogue({'version': 1, 'source_url': JPX_PAGE, 'file_url': file_url,
                               'as_of': dates.pop(), 'fetched_at': time.time() if fetched_at is None else fetched_at,
                               'file_sha256': sha256(payload).hexdigest(), 'items': companies})


def _download(url):
    if (urlsplit(url).scheme != 'https' or urlsplit(url).hostname != 'www.jpx.co.jp'
            or not urlsplit(url).path.startswith('/markets/statistics-equities/misc/')):
        raise ValueError('Invalid JPX URL')
    deadline = time.monotonic() + 20
    with requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=(4, 5),
                      stream=True, allow_redirects=False) as response:
        response.raise_for_status()
        chunks, size = [], 0
        for chunk in response.iter_content(32768):
            size += len(chunk)
            if size > MAX_DOWNLOAD or time.monotonic() > deadline:
                raise ValueError('JPX response limit')
            chunks.append(chunk)
        return b''.join(chunks)


def download_catalogue():
    page = _download(JPX_PAGE).decode('utf-8')
    # Match the closing quote: the previous .xls regex truncated .xlsx to .xls.
    match = re.search(r'href=["\']([^"\']*/data_j\.xlsx)["\']', page)
    if not match:
        raise ValueError('JPX workbook link not found')
    file_url = urljoin(JPX_PAGE, match.group(1))
    result = parse_jpx_xlsx(_download(file_url), file_url)
    # Independently compare the page month and workbook date when available.
    month = re.search(r'東証上場銘柄一覧[（(](\d{4})年(\d{1,2})月末[）)]', page)
    if month:
        year, number = map(int, month.groups())
        expected = date(year, number, monthrange(year, number)[1]).isoformat()
        if result['as_of'] != expected:
            raise ValueError('JPX page/workbook date mismatch')
    return result


class StockSearch:
    def __init__(self, seed_path=SEED_PATH, runtime_path=RUNTIME_PATH, *, session=None, clock=time.time):
        self.session, self.clock = session or requests.Session(), clock
        self.runtime_path = Path(runtime_path) if runtime_path else None
        self._state_lock, self._refresh_lock = Lock(), Lock()
        self._remote_slots = Semaphore(3)
        self._pending, self._cache = set(), {}
        self._worker_lock, self._worker_stop = Lock(), Event()
        self._worker, self._pid = None, os.getpid()
        if hasattr(os, 'register_at_fork'):
            os.register_at_fork(after_in_child=self._after_fork)
        candidates = []
        for path in (Path(seed_path), self.runtime_path):
            if path is None:
                continue
            try:
                candidates.append(_verified_catalogue(json.loads(path.read_text(encoding='utf-8'))))
            except (OSError, ValueError, TypeError):
                continue
        self.catalogue = max(candidates, key=lambda item: item['as_of']) if candidates else {'as_of': None, 'items': []}
        self._index()

    def _after_fork(self):
        # Gunicorn preload copies objects but cannot carry live threads/locks
        # safely into workers. Keep verified data and recreate process resources.
        self._state_lock, self._refresh_lock = Lock(), Lock()
        self._worker_lock, self._worker_stop = Lock(), Event()
        self._remote_slots, self._pending = Semaphore(3), set()
        self.session = requests.Session()
        self._worker, self._pid = None, os.getpid()

    def ensure_refresh_worker(self):
        if self._pid != os.getpid():
            self._after_fork()
        with self._worker_lock:
            if self._worker is None or not self._worker.is_alive():
                self._worker = Thread(target=self._refresh_loop, name='company-catalogue-refresh', daemon=True)
                self._worker.start()

    def _refresh_loop(self):
        if self._worker_stop.wait(20):
            return
        while not self._worker_stop.is_set():
            try:
                self.refresh()
            except Exception:
                pass
            if self._worker_stop.wait(86400):
                return

    def _index(self):
        self.index = [(row, normalize(row['code']), normalize(row['name'])) for row in self.catalogue['items']]

    def refresh(self):
        if not self._refresh_lock.acquire(blocking=False):
            return False
        try:
            latest = download_catalogue()
            if self.catalogue['as_of'] and latest['as_of'] < self.catalogue['as_of']:
                return False
            if self.runtime_path:
                temporary = self.runtime_path.with_suffix('.tmp.' + str(os.getpid()))
                try:
                    temporary.write_text(json.dumps(latest, ensure_ascii=False), encoding='utf-8')
                    os.replace(temporary, self.runtime_path)
                finally:
                    temporary.unlink(missing_ok=True)
            with self._state_lock:
                self.catalogue = latest
                self._index()
                self._cache.clear()
            return True
        except (OSError, ValueError, IndexError, KeyError, requests.RequestException, ET.ParseError, BadZipFile):
            return False
        finally:
            self._refresh_lock.release()

    def all_items(self):
        with self._state_lock:
            items = [{'code': row['code'], 'name': row['name']} for row in self.catalogue['items']]
            return {'items': items, 'count': len(items), 'catalogue_as_of': self.catalogue['as_of']}

    def _local(self, query):
        key = normalize(query)
        code_key = key.removesuffix('.t')
        matches = []
        with self._state_lock:
            for row, code, name in self.index:
                score = (0 if code_key == code else 1 if key == name else
                         2 if code.startswith(code_key) else 3 if name.startswith(key) else
                         4 if key in name else None)
                if score is not None:
                    matches.append((score, row['code'], row))
            rows = [row for _, _, row in sorted(matches)[:20]]
            return [{'symbol': row['code'] + '.T', 'name': row['name'], 'exchange': 'Tokyo',
                     'type': 'EQUITY', 'currency': 'JPY', 'verified': True, 'source': 'JPX',
                     'catalogue_as_of': self.catalogue['as_of']} for row in rows]

    def search(self, query):
        if not isinstance(query, str) or len(query) > 80 or any(ord(c) < 32 for c in query):
            return {'results': []}
        key = normalize(query)
        if not key:
            return {'results': []}
        local = self._local(query)
        if local:
            return {'results': local, 'catalogue_as_of': self.catalogue['as_of']}
        # One-character remote queries create broad, expensive typeahead calls.
        if len(key) < 2:
            return {'results': []}
        now = self.clock()
        with self._state_lock:
            cached = self._cache.get(key)
            if cached and now - cached[0] < cached[1]:
                return cached[2]
            if key in self._pending or not self._remote_slots.acquire(blocking=False):
                return {'results': [], 'unavailable': True}
            self._pending.add(key)
        try:
            remote_query = unicodedata.normalize('NFKC', query).strip()
            if JP_CODE.fullmatch(remote_query.upper()):
                remote_query += '.T'
            with self.session.get('https://query1.finance.yahoo.com/v1/finance/search',
                                  params={'q': remote_query, 'quotesCount': 8, 'newsCount': 0,
                                          'lang': 'ja-JP', 'region': 'JP'},
                                  headers={'User-Agent': 'Mozilla/5.0'}, timeout=(3, 4),
                                  allow_redirects=False, stream=True) as response:
                response.raise_for_status()
                content = bytearray()
                deadline = time.monotonic() + 6
                for chunk in response.iter_content(16384):
                    content.extend(chunk)
                    if len(content) > 250000 or time.monotonic() > deadline:
                        raise ValueError('Lookup response limit')
                data = json.loads(content)
            rows, seen = [], set()
            for row in data.get('quotes', [])[:12]:
                symbol = safe_symbol(row.get('symbol'))
                name = row.get('shortname') or row.get('longname')
                kind = row.get('quoteType')
                if (not symbol or symbol in seen or kind not in ('EQUITY', 'ETF')
                        or not isinstance(name, str) or not 1 <= len(name) <= 200):
                    continue
                seen.add(symbol)
                rows.append({'symbol': symbol, 'name': name, 'exchange': row.get('exchDisp') or row.get('exchange') or '',
                             'type': kind, 'verified': True, 'source': 'Yahoo Finance'})
            result, ttl = {'results': rows}, 300
        except (requests.RequestException, ValueError, TypeError, AttributeError):
            result, ttl = {'results': [], 'unavailable': True}, 15
        finally:
            with self._state_lock:
                self._pending.discard(key)
                self._remote_slots.release()
        with self._state_lock:
            if len(self._cache) > 256:
                self._cache.clear()
            self._cache[key] = (now, ttl, result)
        return result
