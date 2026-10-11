"""Dated official identity supplements for Japanese ordinary listed companies.

This is an identity catalogue, not a quote service.  Regional-only companies use
an internal .JP symbol and have no inferred Yahoo ticker.  Monthly JPX data stays
separate; exchange-specific changes never delist a company from other exchanges.
"""
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import time
import unicodedata

import requests

JST = timezone(timedelta(hours=9))
SCOPE = 'japan-listed-domestic-common-equity'
SEED_PATH = Path(__file__).with_name('static') / 'japan-equity-supplement.json'
CODE = re.compile(r'^[0-9][0-9A-Z]{3}$')
SOURCES = {
    'tokyo_new': 'https://www.jpx.co.jp/listing/stocks/new/index.html',
    'tokyo_delisted': 'https://www.jpx.co.jp/listing/stocks/delisted/index.html',
    'tokyo_transfers': 'https://www.jpx.co.jp/listing/stocks/transfers/index.html',
    'nagoya': 'https://www.nse.or.jp/api/stock/search.json?listedSingle=1&dispType=stockCode&dispOrder=ASC&dispCount=100&dispPage=1',
    'sapporo': 'https://www.sse.or.jp/tandoku',
    'fukuoka': 'https://www.fse.or.jp/market-info/single-listings/',
    'nagoya_all': 'https://www.nse.or.jp/api/stock/search.json?dispType=stockCode&dispOrder=ASC&dispCount=100&dispPage=1',
    'sapporo_all': 'https://www.sse.or.jp/listing/list',
    'fukuoka_all': 'https://www.fse.or.jp/investors/companies-and-brokers/',
}
# Public company-search pagination only, never a financial/quote endpoint.
NAGOYA_PAGES = tuple(SOURCES['nagoya_all'][:-1] + str(page) for page in range(1, 11))
REGIONAL_SOURCES = {'nagoya': 'Nagoya', 'nagoya_all': 'Nagoya',
                    'sapporo': 'Sapporo', 'sapporo_all': 'Sapporo',
                    'fukuoka': 'Fukuoka', 'fukuoka_all': 'Fukuoka'}
SOURCE_TITLES = {'Tokyo': '日本取引所グループ（JPX）', 'Nagoya': '名古屋証券取引所',
                 'Sapporo': '札幌証券取引所', 'Fukuoka': '福岡証券取引所'}
REGIONAL_MARKETS = {'Nagoya': {'プレミア市場', 'メイン市場', 'ネクスト市場'},
                    'Sapporo': {'本則市場', 'アンビシャス市場'},
                    'Fukuoka': {'本則', 'Q-Board'}}
TOKYO_MARKETS = {'プライム', 'スタンダード', 'グロース'}


def today_jst():
    return datetime.now(JST).date()


class _Node:
    def __init__(self, tag='', attrs=()):
        self.tag, self.attrs, self.children = tag, dict(attrs), []
        self.closed = False

    def text(self):
        return ''.join(child.text() if isinstance(child, _Node) else child for child in self.children)

    def findall(self, tag):
        for child in self.children:
            if isinstance(child, _Node):
                if child.tag == tag:
                    yield child
                yield from child.findall(tag)


class _HTML(HTMLParser):
    VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}

    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.root = _Node()
        self.stack, self.count = [self.root], 0
        self.feed(text)
        self.close()

    def handle_starttag(self, tag, attrs):
        self.count += 1
        if self.count > 100000 or len(self.stack) > 100:
            raise ValueError('Official HTML size limit')
        node = _Node(tag, attrs)
        node.closed = tag in self.VOID
        self.stack[-1].children.append(node)
        if tag not in self.VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                self.stack[i].closed = True
                del self.stack[i:]
                break

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def _cells(row):
    return [node for node in row.children if isinstance(node, _Node) and node.tag in ('td', 'th')]


def _within_section(node, tag):
    # The official Sapporo HTML omits the honsoku closing section.  Do not
    # absorb its following Ambitious/PRO section into the first market.
    for child in node.children:
        if isinstance(child, _Node) and child.tag != 'section':
            if child.tag == tag:
                yield child
            yield from _within_section(child, tag)


def _text(node):
    return re.sub(r'\s+', ' ', node.text()).strip()


def _name(value):
    value = value.strip().rstrip('*＊').strip()
    value = re.sub(r'^[（(]株[）)]\s*|\s*[（(]株[）)]$', '', value).strip()
    return value


def _stamp(value):
    match = re.search(r'(\d{4})/(\d{2})/(\d{2})', value)
    return date(*map(int, match.groups())) if match else None


def _new_company_name(cell):
    # JPX puts the company link and a separate video link in the same cell.
    # A whole-cell text extraction turns that UI label into a company name.
    links = list(cell.findall('a'))
    if not 1 <= len(links) <= 2 or not _text(links[0]) or _text(links[0]) == '代表者インタビュー':
        raise ValueError('Unknown new-listing company link')
    if len(links) == 2 and (_text(links[1]) != '代表者インタビュー'
                           or not re.match(r'^https://(?:youtu\.be/|(?:www\.)?youtube\.com/)', links[1].attrs.get('href', ''))):
        raise ValueError('Unknown new-listing supplementary link')
    if not re.match(r'^https?://', links[0].attrs.get('href', '')):
        raise ValueError('Unknown new-listing company URL')
    # Unknown text outside those links must not silently become part of a name.
    outside = ''.join(child for child in cell.children if isinstance(child, str)).strip()
    nodes = [child for child in cell.children if isinstance(child, _Node)]
    if outside or any(node.tag not in ('a', 'br') or not node.closed for node in nodes):
        raise ValueError('Unknown new-listing name structure')
    name = _name(_text(links[0]))
    if not 1 <= len(name) <= 200 or '代表者インタビュー' in name:
        raise ValueError('Invalid new-listing company name')
    return name


def parse_tokyo_new(payload, observed_on):
    root = _HTML(payload.decode('utf-8')).root
    tables = [table for table in root.findall('table') if '上場日' in table.text()
              and '上場承認日' in table.text() and '市場区分' in table.text()]
    if len(tables) != 1 or not tables[0].closed:
        raise ValueError('Unknown JPX new-listing table')
    rows, result, parsed, seen = list(tables[0].findall('tr')), [], 0, set()
    if len(rows) < 4:
        raise ValueError('Incomplete JPX new-listing page')
    header, secondary = [_text(c) for c in _cells(rows[0])], [_text(c) for c in _cells(rows[1])]
    if (len(header) != 8 or not header[0].startswith('上場日') or '上場承認日' not in header[0]
            or not header[1].startswith('会社名') or header[2] != 'コード'
            or len(secondary) != 6 or secondary[0] != '市場区分'):
        raise ValueError('Unknown JPX new-listing columns')
    if (len(rows) - 2) % 2:
        raise ValueError('Unpaired JPX new-listing row')
    for i in range(2, len(rows), 2):
        row = rows[i]
        cells = _cells(row)
        market_cells = _cells(rows[i + 1])
        if (len(cells) != 8 or len(market_cells) != 6 or not row.closed or not rows[i + 1].closed
                or any(cell.tag != 'td' or not cell.closed for cell in (*cells, *market_cells))):
            raise ValueError('Unknown JPX new-listing row structure')
        dates = re.fullmatch(r'(\d{4}/\d{2}/\d{2})\s*[（(](\d{4}/\d{2}/\d{2})[）)]', _text(cells[0]))
        stamp = _stamp(dates[1]) if dates else None
        code = _text(cells[2]).upper()
        if (stamp is None or _stamp(dates[2]) > stamp or not CODE.fullmatch(code) or code in seen):
            raise ValueError('Invalid JPX new-listing identity')
        name = _new_company_name(cells[1])
        seen.add(code)
        parsed += 1
        market = _text(market_cells[0])
        if market not in TOKYO_MARKETS:
            raise ValueError('Unknown new-listing market')
        if stamp <= observed_on:
            result.append({'code': code, 'name': name,
                           'market': market + '（内国株式）', 'listed_on': stamp.isoformat()})
    if parsed == 0:
        raise ValueError('Incomplete JPX new-listing page')
    return result


def parse_tokyo_transfers(payload, observed_on):
    root = _HTML(payload.decode('utf-8')).root
    tables = [table for table in root.findall('table') if '以前の市場区分' in table.text()
              and '変更日' in table.text() and 'コード' in table.text()]
    if len(tables) != 1 or not tables[0].closed:
        raise ValueError('Unknown JPX market-transfer table')
    rows = list(tables[0].findall('tr'))
    header = [_text(cell) for cell in _cells(rows[0])] if rows else []
    if (len(header) != 7 or header[0] != '変更日' or not header[1].startswith('会社名')
            or header[2:5] != ['コード', '市場区分', '以前の市場区分']):
        raise ValueError('Unknown JPX market-transfer columns')
    result, seen = [], set()
    for row in rows[1:]:
        cells = _cells(row)
        if len(cells) != 7 or not row.closed or any(cell.tag != 'td' or not cell.closed for cell in cells):
            raise ValueError('Unknown JPX market-transfer row structure')
        stamp, name, code, market, previous = [_text(cell) for cell in cells[:5]]
        if (not CODE.fullmatch(code) or code in seen or market not in TOKYO_MARKETS
                or previous not in TOKYO_MARKETS or market == previous):
            raise ValueError('Invalid JPX market-transfer identity')
        seen.add(code)
        name = _name(name)
        if not 1 <= len(name) <= 200 or '代表者インタビュー' in name:
            raise ValueError('Invalid JPX market-transfer name')
        if re.fullmatch(r'\d{4}/\d{2}/\d{2}', stamp):
            event = _stamp(stamp)
        else:
            window = re.fullmatch(r'(\d{4}/\d{2}/\d{2})\s*～\s*(\d{4}/\d{2}/\d{2})', stamp)
            if not window or _stamp(window[1]) > _stamp(window[2]):
                raise ValueError('Unknown JPX market-transfer date')
            # Announced windows are not evidence of an actual change date.
            continue
        if event <= observed_on:
            result.append({'code': code, 'name': name, 'changed_on': event.isoformat(),
                           'market': market + '（内国株式）',
                           'previous_market': previous + '（内国株式）'})
    if len(rows) < 2:
        raise ValueError('Incomplete JPX market-transfer page')
    return result


def parse_tokyo_delisted(payload, observed_on):
    root = _HTML(payload.decode('utf-8')).root
    tables = [table for table in root.findall('table') if '上場廃止日' in table.text()
              and '上場廃止理由' in table.text()]
    if len(tables) != 1:
        raise ValueError('Unknown JPX delisting table')
    result, parsed = [], 0
    for row in tables[0].findall('tr'):
        cells = _cells(row)
        if len(cells) != 5:
            continue
        stamp, code = _stamp(_text(cells[0])), _text(cells[2]).upper()
        if stamp is None or not CODE.fullmatch(code):
            continue
        market = _text(cells[3])
        if market not in ('プライム', 'スタンダード', 'グロース'):
            continue
        parsed += 1
        if stamp <= observed_on:
            result.append({'code': code, 'name': _name(_text(cells[1])),
                           'delisted_on': stamp.isoformat()})
    if parsed == 0:
        raise ValueError('Incomplete JPX delisting page')
    return result


def parse_nagoya(payload, observed_on):
    data = json.loads(payload)
    rows, pages = data.get('stock'), data.get('list')
    if not isinstance(rows, list) or not isinstance(pages, list) or len(pages) != 1:
        raise ValueError('Unknown Nagoya response')
    if int(pages[0].get('listTotal', -1)) != len(rows) or int(pages[0].get('listPage', -1)) != 1:
        raise ValueError('Incomplete Nagoya list')
    names = {1: 'プレミア市場', 2: 'メイン市場', 3: 'ネクスト市場'}
    result = []
    for row in rows:
        # This official API appends a zero for ordinary shares (17380 -> 1738).
        # Other issue classes and its ETF/other division are separate products.
        raw, division = str(row.get('stockCode', '')), int(row.get('listedDivision', 0))
        if division not in names:
            continue
        if int(row.get('simpleListing', 0)) != 1 or len(raw) != 5 or raw[-1] != '0' or not CODE.fullmatch(raw[:-1]):
            raise ValueError('Invalid Nagoya ordinary company')
        item = {'code': raw[:-1], 'name': row.get('stockName_j'), 'market': names[division],
                'industry': row.get('industryName_j')}
        result.append(item)
    if not 10 <= len(result) <= 100:
        raise ValueError('Incomplete Nagoya ordinary list')
    return result


def parse_nagoya_all(payload, observed_on):
    pages = json.loads(payload).get('pages')
    if not isinstance(pages, list) or not 1 <= len(pages) <= 10:
        raise ValueError('Unknown Nagoya complete response')
    rows, total = [], None
    for number, page in enumerate(pages, 1):
        stocks, meta = page.get('stock'), page.get('list')
        if not isinstance(stocks, list) or not isinstance(meta, list) or len(meta) != 1:
            raise ValueError('Unknown Nagoya page')
        declared = int(meta[0].get('listTotal', -1))
        total = declared if total is None else total
        if declared != total or int(meta[0].get('listPage', -1)) != number or not 1 <= total <= 1000:
            raise ValueError('Inconsistent Nagoya pagination')
        if len(stocks) != min(100, total - (number - 1) * 100):
            raise ValueError('Truncated Nagoya page')
        rows.extend(stocks)
    if len(rows) != total:
        raise ValueError('Incomplete Nagoya complete list')
    result, seen = [], set()
    markets = {1: 'プレミア市場', 2: 'メイン市場', 3: 'ネクスト市場'}
    for row in rows:
        division, raw = int(row.get('listedDivision', 0)), str(row.get('stockCode', ''))
        if division == 4:
            continue  # The official ETF/other division is outside company scope.
        if division not in markets:
            raise ValueError('Unknown Nagoya listing division')
        if len(raw) != 5 or raw[-1] != '0' or not CODE.fullmatch(raw[:-1]) or raw in seen:
            raise ValueError('Invalid Nagoya ordinary issue')
        result.append({'code': raw[:-1], 'name': row.get('stockName_j'),
                       'market': markets[division], 'industry': row.get('industryName_j')})
        seen.add(raw)
    if len(result) < 10:
        raise ValueError('Incomplete Nagoya ordinary companies')
    return result


def parse_sapporo(payload, observed_on):
    root = _HTML(payload.decode('utf-8')).root
    regions = {node.attrs.get('id'): node for node in root.findall('section')
               if node.attrs.get('id') in ('honsoku', 'ambitious')}
    if set(regions) != {'honsoku', 'ambitious'}:
        raise ValueError('Unknown Sapporo ordinary sections')
    result = []
    for key, market in (('honsoku', '本則市場'), ('ambitious', 'アンビシャス市場')):
        for link in _within_section(regions[key], 'a'):
            spans = list(link.findall('span'))
            if len(spans) != 1:
                continue
            code = _text(spans[0]).upper()
            if not CODE.fullmatch(code):
                raise ValueError('Invalid Sapporo company code')
            text = _text(link)
            if not text.startswith(code):
                raise ValueError('Unknown Sapporo company name')
            result.append({'code': code, 'name': text[len(code):].strip(), 'market': market})
    if not 5 <= len(result) <= 100:
        raise ValueError('Incomplete Sapporo ordinary list')
    return result


def parse_sapporo_all(payload, observed_on):
    root = _HTML(payload.decode('utf-8')).root
    menus = [node for node in root.findall('div') if 'subnav07' in node.attrs.get('class', '').split()]
    if len(menus) != 1:
        raise ValueError('Unknown Sapporo current-list navigation')
    groups = {'単独上場会社 - 本則市場': '本則市場',
              '重複上場会社 - 本則市場': '本則市場',
              '単独上場会社 - アンビシャス': 'アンビシャス市場',
              '重複上場会社 - アンビシャス': 'アンビシャス市場'}
    result, parsed = [], set()
    for block in menus[0].findall('dl'):
        children = [node for node in block.children if isinstance(node, _Node)]
        if len(children) != 2 or children[0].tag != 'dt' or children[1].tag != 'dd':
            continue
        headers = list(children[0].findall('h5'))
        if len(headers) != 1:
            continue
        title = _text(headers[0])
        if title not in groups:
            continue  # PRO and bonds are explicitly separate sections.
        if title in parsed:
            raise ValueError('Duplicate Sapporo listing section')
        parsed.add(title)
        for company in children[1].findall('dl'):
            parts = [node for node in company.children if isinstance(node, _Node)]
            if len(parts) != 2 or parts[0].tag != 'dt' or parts[1].tag != 'dd':
                raise ValueError('Unknown Sapporo company row')
            code, links = _text(parts[0]).upper(), list(parts[1].findall('a'))
            if not CODE.fullmatch(code) or len(links) != 1 or links[0].attrs.get('href') != 'https://www.sse.or.jp/listing/company' + code:
                raise ValueError('Invalid Sapporo current company')
            images = list(links[0].findall('img'))
            name = _text(links[0]) or (images[0].attrs.get('alt', '') if len(images) == 1 else '')
            result.append({'code': code, 'name': _name(name), 'market': groups[title]})
    if parsed != set(groups) or not 20 <= len(result) <= 200:
        raise ValueError('Incomplete Sapporo current companies')
    return result


def parse_fukuoka(payload, observed_on):
    root = _HTML(payload.decode('utf-8')).root
    tables = [table for table in root.findall('table') if 'under__table--border' in table.attrs.get('class', '').split()]
    result = []
    for table in tables:
        fields = {}
        for row in table.findall('tr'):
            cells = _cells(row)
            for i in range(0, len(cells) - 1, 2):
                if cells[i].tag == 'th':
                    fields[_text(cells[i])] = cells[i + 1]
        if not {'コード', '業種', '市場区分', '会社名'} <= fields.keys():
            raise ValueError('Unknown Fukuoka company table')
        market = _text(fields['市場区分'])
        if market not in REGIONAL_MARKETS['Fukuoka']:
            if 'PRO' in market:
                continue
            raise ValueError('Unknown Fukuoka ordinary market')
        name_node = fields['会社名']
        images = list(name_node.findall('img'))
        name = _text(name_node) or (images[0].attrs.get('alt', '').strip() if len(images) == 1 else '')
        result.append({'code': _text(fields['コード']), 'name': name,
                       'market': market, 'industry': _text(fields['業種'])})
    if not 10 <= len(result) <= 100:
        raise ValueError('Incomplete Fukuoka ordinary list')
    return result


def parse_fukuoka_all(payload, observed_on):
    root = _HTML(payload.decode('utf-8')).root
    sections = {node.attrs.get('id'): node for node in root.findall('section')
                if node.attrs.get('id') in ('honsoku', 'q-board')}
    if set(sections) != {'honsoku', 'q-board'}:
        raise ValueError('Unknown Fukuoka current ordinary sections')
    result = []
    for key, market in (('honsoku', '本則'), ('q-board', 'Q-Board')):
        for link in _within_section(sections[key], 'a'):
            if not re.fullmatch(r'/market-info/listed-companies/detail\.php\?copid=\d+', link.attrs.get('href', '')):
                raise ValueError('Unknown Fukuoka company link')
            spans = [span for span in link.findall('span') if 'under__btn-code' in span.attrs.get('class', '').split()]
            if len(spans) != 1:
                raise ValueError('Unknown Fukuoka current company code')
            match = re.fullmatch(r'コード：([0-9][0-9A-Z]{3})', _text(spans[0]))
            if not match:
                raise ValueError('Invalid Fukuoka ordinary code')
            name = _text(link).removesuffix(_text(spans[0])).strip()
            # These are explicitly named securities, mixed into the official
            # regular-market list; do not turn them into ordinary companies.
            if any(kind in name for kind in ('受益証券', '投資証券', '投資法人', '上場投信')):
                continue
            result.append({'code': match.group(1), 'name': _name(name), 'market': market})
    if not 30 <= len(result) <= 300:
        raise ValueError('Incomplete Fukuoka current companies')
    return result


PARSERS = {'tokyo_new': parse_tokyo_new, 'tokyo_delisted': parse_tokyo_delisted,
           'tokyo_transfers': parse_tokyo_transfers,
           'nagoya': parse_nagoya, 'sapporo': parse_sapporo, 'fukuoka': parse_fukuoka,
           'nagoya_all': parse_nagoya_all, 'sapporo_all': parse_sapporo_all,
           'fukuoka_all': parse_fukuoka_all}


def _clean_source(key, source, today):
    if not isinstance(source, dict) or source.get('source_url') != SOURCES[key]:
        raise ValueError('Invalid official source')
    observed = date.fromisoformat(source.get('as_of', ''))
    if observed > today or not re.fullmatch(r'[0-9a-f]{64}', source.get('sha256', '')):
        raise ValueError('Invalid official source observation')
    rows = source.get('items')
    if not isinstance(rows, list) or len(rows) > 1000:
        raise ValueError('Invalid official company list')
    clean, seen = [], set()
    exchange = REGIONAL_SOURCES.get(key, 'Tokyo')
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError('Invalid official company')
        code, name = row.get('code'), row.get('name')
        if (not isinstance(code, str) or not CODE.fullmatch(code) or code in seen
                or not isinstance(name, str) or not 1 <= len(name) <= 200
                or any(ord(c) < 32 for c in name)
                or (key in ('tokyo_new', 'tokyo_transfers') and '代表者インタビュー' in name)):
            raise ValueError('Invalid official identity')
        item = {'code': code, 'name': name}
        if key == 'tokyo_delisted':
            event = date.fromisoformat(row.get('delisted_on', ''))
            if event > observed:
                raise ValueError('Unimplemented delisting')
            item['delisted_on'] = event.isoformat()
        else:
            market = row.get('market')
            allowed = {name + '（内国株式）' for name in TOKYO_MARKETS} if exchange == 'Tokyo' else REGIONAL_MARKETS[exchange]
            if market not in allowed:
                raise ValueError('Invalid ordinary company market')
            item['market'] = market
            if key == 'tokyo_new':
                event = date.fromisoformat(row.get('listed_on', ''))
                if event > observed:
                    raise ValueError('Unimplemented listing')
                item['listed_on'] = event.isoformat()
            elif key == 'tokyo_transfers':
                event = date.fromisoformat(row.get('changed_on', ''))
                previous = row.get('previous_market')
                if event > observed or previous not in allowed or previous == market:
                    raise ValueError('Invalid implemented market transfer')
                item.update(changed_on=event.isoformat(), previous_market=previous)
            if 'industry' in row:
                value = row['industry']
                if not isinstance(value, str) or not 1 <= len(value) <= 100 or any(ord(c) < 32 for c in value):
                    raise ValueError('Invalid official industry')
                item['industry'] = value
        clean.append(item)
        seen.add(code)
    minimum = {'nagoya': 10, 'sapporo': 5, 'fukuoka': 10, 'nagoya_all': 10,
               'sapporo_all': 20, 'fukuoka_all': 30}.get(key)
    if minimum and len(clean) < minimum:
        raise ValueError('Incomplete regional catalogue')
    return {'source_url': SOURCES[key], 'as_of': observed.isoformat(), 'sha256': source['sha256'],
            'items': sorted(clean, key=lambda item: item['code'])}


def verified_supplement(value, today=None):
    today = today or today_jst()
    if not isinstance(value, dict) or value.get('version') != 1 or value.get('scope') != SCOPE:
        raise ValueError('Invalid national identity catalogue')
    sources = value.get('sources')
    if not isinstance(sources, dict) or set(sources) - SOURCES.keys():
        raise ValueError('Invalid national source set')
    return {'version': 1, 'scope': SCOPE,
            'sources': {key: _clean_source(key, source, today) for key, source in sources.items()}}


def read_supplement(seed_path=SEED_PATH, runtime_path=None):
    merged = {'version': 1, 'scope': SCOPE, 'sources': {}}
    for path in (seed_path, runtime_path):
        if path is None:
            continue
        try:
            document = json.loads(Path(path).read_text(encoding='utf-8'))
            if (not isinstance(document, dict) or document.get('version') != 1 or document.get('scope') != SCOPE
                    or not isinstance(document.get('sources'), dict) or set(document['sources']) - SOURCES.keys()):
                continue
            for key, raw in document['sources'].items():
                try:
                    source = _clean_source(key, raw, today_jst())
                except (ValueError, TypeError, KeyError):
                    continue
                current = merged['sources'].get(key)
                if current is None or source['as_of'] >= current['as_of']:
                    merged['sources'][key] = source
        except (OSError, ValueError, TypeError, KeyError):
            continue
    return merged


def _download(url, session=requests):
    if url not in (*SOURCES.values(), *NAGOYA_PAGES):
        raise ValueError('Unapproved official identity URL')
    deadline = time.monotonic() + 15
    with session.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=(3, 5), stream=True,
                     allow_redirects=False) as response:
        response.raise_for_status()
        chunks, size = [], 0
        for chunk in response.iter_content(32768):
            size += len(chunk)
            if size > 2_000_000 or time.monotonic() > deadline:
                raise ValueError('Official identity response limit')
            chunks.append(chunk)
        return b''.join(chunks)


def _download_source(key, url, session):
    payload = _download(url, session)
    if key != 'nagoya_all':
        return payload
    first = json.loads(payload)
    meta = first.get('list')
    if not isinstance(meta, list) or len(meta) != 1:
        raise ValueError('Unknown Nagoya pagination metadata')
    total = int(meta[0].get('listTotal', -1))
    if not 1 <= total <= 1000:
        raise ValueError('Nagoya identity pagination limit')
    pages = [first]
    for page in range(2, (total + 99) // 100 + 1):
        pages.append(json.loads(_download(NAGOYA_PAGES[page - 1], session)))
    return json.dumps({'pages': pages}, ensure_ascii=False, sort_keys=True).encode('utf-8')


def refresh_supplement(previous, *, session=requests, today=None):
    """Refresh each source independently; a timeout cannot erase verified rows."""
    today = today or today_jst()
    result = deepcopy(verified_supplement(previous, today))
    for key, url in SOURCES.items():
        try:
            payload = _download_source(key, url, session)
            source = _clean_source(key, {'source_url': url, 'as_of': today.isoformat(),
                                         'sha256': sha256(payload).hexdigest(),
                                         'items': PARSERS[key](payload, today)}, today)
            result['sources'][key] = source
        except (requests.RequestException, ValueError, KeyError, TypeError, AttributeError, IndexError, UnicodeError):
            continue
    return result


def merge_companies(monthly, supplement):
    """Return company identities and Tokyo tombstones, with exchange provenance."""
    sources, monthly_date = supplement.get('sources', {}), monthly.get('as_of')
    tokyo = {row['code']: dict(row, exchange='Tokyo', source_url=monthly.get('source_url'),
                                catalogue_as_of=monthly_date) for row in monthly['items']}
    additions, removals = sources.get('tokyo_new', {}), sources.get('tokyo_delisted', {})
    for row in additions.get('items', []):
        if monthly_date is None or row['listed_on'] > monthly_date:
            tokyo[row['code']] = dict(row, exchange='Tokyo', source_url=additions['source_url'],
                                      catalogue_as_of=additions['as_of'])
    closed = set()
    for row in removals.get('items', []):
        closed.add(row['code'])
        current = tokyo.get(row['code'])
        if current and (monthly_date is None or row['delisted_on'] > monthly_date) and row['delisted_on'] >= current.get('listed_on', '0000-00-00'):
            del tokyo[row['code']]
    transfers = sources.get('tokyo_transfers', {})
    def same_name(left, right):
        def normalized(value):
            return re.sub(r'\s+', '', unicodedata.normalize('NFKC', value).replace('株式会社', ''))
        return normalized(left) == normalized(right)
    for row in transfers.get('items', []):
        current = tokyo.get(row['code'])
        # A market change only updates a matching, still-listed Tokyo company.
        # It cannot create a listing, undo a delisting, or affect a later issuer
        # that reused the code. Monthly data already includes older changes.
        if (current and (monthly_date is None or row['changed_on'] > monthly_date)
                and row['changed_on'] >= current.get('listed_on', '0000-00-00')
                and row['changed_on'] <= transfers['as_of']
                and current.get('market') == row['previous_market']
                and same_name(current['name'], row['name'])):
            current.update(market=row['market'], market_changed_on=row['changed_on'],
                           source_url=transfers['source_url'], catalogue_as_of=transfers['as_of'])
    companies = dict(tokyo)
    for key, exchange in (('nagoya', 'Nagoya'), ('sapporo', 'Sapporo'), ('fukuoka', 'Fukuoka')):
        # Full exchange membership covers companies listed on several regional
        # exchanges after leaving Tokyo. A single-listing page cannot do that.
        # Retain the dated last-good full source if a later refresh times out.
        source = sources.get(key + '_all') or sources.get(key, {})
        for row in source.get('items', []):
            listing = dict(row, exchange=exchange, source_url=source['source_url'], catalogue_as_of=source['as_of'])
            if row['code'] not in companies:
                companies[row['code']] = listing
            else:
                companies[row['code']].setdefault('other_listings', []).append(listing)
    for row in companies.values():
        tokyo_listing = row['exchange'] == 'Tokyo'
        row.update(symbol=row['code'] + ('.T' if tokyo_listing else '.JP'),
                   provider_symbol=row['code'] + '.T' if tokyo_listing else None,
                   source_title=SOURCE_TITLES[row['exchange']], scope=SCOPE,
                   as_of=row['catalogue_as_of'])
    return sorted(companies.values(), key=lambda row: row['code']), closed - tokyo.keys()
