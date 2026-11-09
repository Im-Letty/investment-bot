"""Read only the inspected MOF exchange-assets XLSX profile.

No formula evaluation, network, spreadsheet engine, dependency, or workbook write.
The collector must independently verify the parent/index, dated attachment and
dated official archive. Fiscal-year labels are never publication evidence.
"""
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP, localcontext
from hashlib import sha256
from io import BytesIO
import json
import posixpath
import re
import unicodedata
from xml.etree import ElementTree as ET
from zipfile import BadZipFile, ZIP_DEFLATED, ZIP_STORED, ZipFile

SOURCE_KIND = 'mof_exchange_assets_xlsx_cached_v1'
REPORT_TITLE = '外国為替資金特別会計の外貨建資産の内訳及び運用収入の内訳等'
MAX_BYTES = 128_000
MAX_UNCOMPRESSED_BYTES = 500_000
MAX_PART_BYTES = 200_000
MAX_BODY_CHARACTERS = 30_000
S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
X = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'
NS = {'s': S, 'a': A, 'x': X}
PARTS = frozenset({
    '[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml',
    'xl/theme/theme1.xml', 'xl/styles.xml', 'xl/sharedStrings.xml',
    'xl/drawings/drawing1.xml', 'xl/worksheets/_rels/sheet1.xml.rels',
    'xl/printerSettings/printerSettings1.bin', 'xl/calcChain.xml',
    'docProps/core.xml', 'docProps/app.xml',
})
RELATIONSHIPS = frozenset({
    'officeDocument', 'metadata/core-properties', 'extended-properties',
    'worksheet', 'styles', 'theme', 'sharedStrings', 'calcChain',
    'drawing', 'printerSettings',
})
KNOWN_CUSTOM_FORMATS = frozenset({
    '"平成"##"年度末残高"', '##"年""度"', '"令和""元""年度"',
    '"令和""元""年度末残高"', '#,##0;"△ "#,##0', '#,##0;[Red]"△ "#,##0',
    r'\(\ 0.0%\ \)', r'\(\ #,##0.0%\ \);"（ △ "#,##0.0%\ \)',
    r'\(\ 0%\ \)', r'\(\ #,##0.0%\ \);"（ △ "#,##0%\ \)',
    r'\(\ #,##0.0%\ \);\(\ "△ "#,##0.0%\ \)',
    r'\ #,##0.00%\ ;" △ "#,##0.00%\ ',
})
# Filled with the inspected nonempty-cell geometry, never original values.
EXPECTED_CELLS = frozenset(('A3', 'B5', 'S6', 'H7', 'N7', 'B8', 'H8', 'N8', 'C9', 'H9', 'N9', 'C10', 'H10', 'N10', 'B11', 'H11', 'N11', 'B12', 'H12', 'N12', 'B13', 'H13', 'N13', 'B14', 'H14', 'N14', 'B15', 'H15', 'N15', 'B16', 'H16', 'N16', 'B17', 'H17', 'N17', 'B19', 'C19', 'B21', 'B22', 'C22', 'W23', 'C24', 'H24', 'O24', 'C25', 'H25', 'L25', 'O25', 'T25', 'C26', 'H26', 'L26', 'O26', 'T26', 'C27', 'H27', 'L27', 'O27', 'T27', 'C28', 'H28', 'L28', 'O28', 'T28', 'B30', 'C30', 'W31', 'C32', 'H32', 'O32', 'C33', 'H33', 'L33', 'O33', 'T33', 'C34', 'H34', 'L34', 'O34', 'T34', 'C35', 'H35', 'L35', 'O35', 'T35', 'B37', 'C38', 'B43', 'C44', 'B47', 'S48', 'H49', 'N49', 'B50', 'H50', 'N50', 'C51', 'H51', 'N51', 'C52', 'H52', 'N52', 'B53', 'H53', 'N53', 'C54', 'H54', 'N54', 'C55', 'H55', 'N55', 'B56', 'H56', 'N56', 'B57', 'H57', 'N57', 'B58', 'H58', 'N58', 'B61', 'S62', 'H63', 'N63', 'B64', 'F64', 'H64', 'N64', 'B65', 'F65', 'H65', 'N65', 'B66', 'F66', 'H66', 'N66', 'B68', 'C68', 'B69', 'C69', 'B70', 'C70'))
EXPECTED_NUMERIC_CELLS = frozenset(('H8', 'N8', 'H9', 'N9', 'H10', 'N10', 'H11', 'N11', 'H12', 'N12', 'H13', 'N13', 'H14', 'N14', 'H15', 'N15', 'H16', 'N16', 'H17', 'N17', 'H25', 'L25', 'O25', 'T25', 'H26', 'L26', 'O26', 'T26', 'H27', 'L27', 'O27', 'T27', 'H28', 'L28', 'O28', 'H33', 'L33', 'O33', 'T33', 'H34', 'L34', 'O34', 'T34', 'H35', 'L35', 'O35', 'H50', 'N50', 'H51', 'N51', 'H52', 'N52', 'H53', 'N53', 'H54', 'N54', 'H55', 'N55', 'H56', 'N56', 'H57', 'N57', 'H58', 'N58', 'H64', 'N64', 'H65', 'N65', 'H66', 'N66'))


def _fail(code):
    raise ValueError('mof_xlsx_' + code)


def _compact(value):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', value))


def _address(value):
    match = re.fullmatch(r'([A-X])([1-9]\d{0,2})', value or '')
    if not match or int(match[2]) > 120:
        _fail('cell_bounds')
    return int(match[2]), ord(match[1]) - 65


def _range(value):
    parts = (value or '').split(':')
    if len(parts) != 2:
        _fail('merge_bounds')
    start, end = map(_address, parts)
    if start[0] > end[0] or start[1] > end[1] or start == end:
        _fail('merge_bounds')
    return start, end


def _xml(archive, name):
    raw = archive.read(name)
    try:
        text = raw.decode('utf-8-sig')
    except UnicodeDecodeError:
        _fail('XML_encoding')
    encoding = re.search(r'^\s*<\?xml\b[^?]*\bencoding\s*=\s*[\"\']([^\"\']+)', text, re.I)
    if '\x00' in text or encoding and encoding[1].lower() not in ('utf-8', 'utf8'):
        _fail('XML_encoding')
    if '<!DOCTYPE' in text.upper() or '<!ENTITY' in text.upper():
        _fail('XML_declaration')
    try:
        return ET.fromstring(text)
    except ET.ParseError:
        _fail('XML_invalid')


def _relationships(archive):
    result = {}
    for name in PARTS:
        if not name.endswith('.rels'):
            continue
        parent = '' if name == '_rels/.rels' else name.rsplit('/_rels/', 1)[0]
        found = {}
        for node in _xml(archive, name):
            key, target = node.get('Id'), node.get('Target', '')
            kind = node.get('Type', '').split('/relationships/', 1)[-1]
            if (not key or key in found or node.get('TargetMode') == 'External'
                    or not target or ':' in target or '\\' in target or target.startswith('//')
                    or kind not in RELATIONSHIPS):
                _fail('relationship')
            resolved = posixpath.normpath(posixpath.join(parent, target)).lstrip('/')
            if resolved not in PARTS:
                _fail('relationship_target')
            found[key] = resolved
        result[name] = found
    return result


def _string(node):
    """Only visible base text: rPh/phoneticPr never become report content."""
    output = []
    for child in node:
        tag = child.tag.rsplit('}', 1)[-1]
        if tag == 't':
            output.append(child.text or '')
        elif tag == 'r':
            for item in child:
                if item.tag == '{' + S + '}t':
                    output.append(item.text or '')
                elif item.tag != '{' + S + '}rPr':
                    _fail('rich_text')
        elif tag not in ('rPh', 'phoneticPr'):
            _fail('rich_text')
    text = ''.join(output)
    if len(text) > 5_000 or any(ord(c) < 32 and c not in '\n\r\t' for c in text):
        _fail('text_limit')
    return text


def _number(raw, code):
    """Apply only inspected display formats; never calculate a formula."""
    if not re.fullmatch(r'-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?', raw or '') or len(raw) > 60:
        _fail('numeric_value')
    try:
        n = Decimal(raw)
        if not n.is_finite() or abs(n.adjusted()) > 30 or n.as_tuple().exponent < -30:
            _fail('numeric_value')
    except InvalidOperation:
        _fail('numeric_value')
    formats = {
        '#,##0_);[Red](#,##0)': (0, True, '', '', '(', ')', False),
        '#,##0;"△ "#,##0': (0, True, '', '', '△ ', '', False),
        '#,##0;[Red]"△ "#,##0': (0, True, '', '', '△ ', '', False),
        r'\(\ 0.0%\ \)': (1, False, '( ', ' )', '( -', ' )', True),
        r'\(\ #,##0.0%\ \);"（ △ "#,##0.0%\ \)': (1, True, '( ', ' )', '（ △ ', ' )', True),
        r'\(\ 0%\ \)': (0, False, '( ', ' )', '( -', ' )', True),
        r'\(\ #,##0.0%\ \);"（ △ "#,##0%\ \)': (1, True, '( ', ' )', '（ △ ', ' )', True),
        r'\(\ #,##0.0%\ \);\(\ "△ "#,##0.0%\ \)': (1, True, '( ', ' )', '( △ ', ' )', True),
        r'\ #,##0.00%\ ;" △ "#,##0.00%\ ': (2, True, '', '', '△ ', '', True),
    }
    if code not in formats:
        _fail('unknown_numeric_format')
    places, grouped, prefix, suffix, neg_prefix, neg_suffix, percent = formats[code]
    negative = n < 0
    # This inspected format deliberately rounds the negative branch to0 places.
    if negative and code == r'\(\ #,##0.0%\ \);"（ △ "#,##0%\ \)':
        places = 0
    with localcontext() as context:
        context.prec = 80
        value = abs(n) * (100 if percent else 1)
        value = value.quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)
        text = format(value, (',' if grouped else '') + '.' + str(places) + 'f')
    return ((neg_prefix if negative else prefix) + text + ('%' if percent else '')
            + (neg_suffix if negative else suffix))


def _drawing(archive):
    root = _xml(archive, 'xl/drawings/drawing1.xml')
    if len(root) != 1 or root[0].tag != '{' + X + '}twoCellAnchor':
        _fail('drawing_profile')
    anchor = root[0]
    shapes = anchor.findall('x:sp', NS)
    if len(shapes) != 1 or any(node.tag.rsplit('}', 1)[-1] in
            {'pic', 'graphicFrame', 'cxnSp', 'grpSp', 'fld', 'hlinkClick', 'hlinkMouseOver'}
            or node.get('hidden') in ('1', 'true') for node in anchor.iter()):
        _fail('drawing_content')
    start, end = anchor.find('x:from', NS), anchor.find('x:to', NS)
    try:
        row, col = int(start.find('x:row', NS).text), int(start.find('x:col', NS).text)
        end_row, end_col = int(end.find('x:row', NS).text), int(end.find('x:col', NS).text)
    except (AttributeError, TypeError, ValueError):
        _fail('drawing_bounds')
    if not (0 <= row <= end_row < 120 and 0 <= col <= end_col < 24):
        _fail('drawing_bounds')
    body = shapes[0].find('x:txBody', NS)
    if body is None:
        _fail('drawing_content')
    paragraphs = []
    count = 0
    for paragraph in body.findall('a:p', NS):
        parts = []
        for item in paragraph:
            tag = item.tag.rsplit('}', 1)[-1]
            if tag == 'r':
                children = [x for x in item if x.tag == '{' + A + '}t']
                if len(children) != 1:
                    _fail('drawing_content')
                parts.append(children[0].text or '')
                count += 1
            elif tag == 'br':
                parts.append('\n')
            elif tag not in ('pPr', 'endParaRPr'):
                _fail('drawing_content')
        paragraphs.append(''.join(parts))
    text = '\n'.join(paragraphs)
    if (len(paragraphs) != 4 or count != 7 or not 20 <= len(text) <= 1_000
            or count != len(root.findall('.//a:t', NS))):
        _fail('drawing_content')
    return {'row': row + 1, 'column': col, 'text': text,
            'paragraph_count': len(paragraphs), 'text_run_count': count}


def extract_mof_exchange_assets_workbook(payload, expected_publication_day=None):
    """Return exact cached report content and proof metadata, or fixed ValueError.

    Optional day context rejects a current/future fiscal period; it never proves
    publication. There is no release-day or issuer cell. The collector owns it.
    """
    publication_context = None
    if expected_publication_day is not None:
        try:
            if type(expected_publication_day) is not str or date.fromisoformat(expected_publication_day).isoformat() != expected_publication_day:
                _fail('publication_context')
            publication_context = date.fromisoformat(expected_publication_day)
        except (ValueError, TypeError):
            _fail('publication_context')
    if type(payload) is not bytes or not 0 < len(payload) <= MAX_BYTES:
        _fail('size_limit')
    try:
        archive = ZipFile(BytesIO(payload))
        infos = archive.infolist()
        if (len(infos) != len(PARTS) or {i.filename for i in infos} != PARTS
                or sum(i.file_size for i in infos) > MAX_UNCOMPRESSED_BYTES
                or any(i.file_size > MAX_PART_BYTES or i.flag_bits & 1
                       or i.compress_type not in (ZIP_STORED, ZIP_DEFLATED)
                       or i.file_size > max(1, i.compress_size) * 200 for i in infos)):
            _fail('package_profile')
        with archive:
            # Even otherwise-unused package metadata must be bounded valid XML.
            for name in PARTS:
                if name.endswith(('.xml', '.rels')):
                    _xml(archive, name)
            types = archive.read('[Content_Types].xml')
            if any(x in types.lower() for x in (b'macroenabled', b'vbaproject', b'oleobject', b'activex')):
                _fail('active_content')
            _xml(archive, '[Content_Types].xml')
            relations = _relationships(archive)
            book = _xml(archive, 'xl/workbook.xml')
            sheets = book.findall('s:sheets/s:sheet', NS)
            if (len(sheets) != 1 or sheets[0].get('state', 'visible') != 'visible'
                    or relations['xl/_rels/workbook.xml.rels'].get(sheets[0].get('{' + R + '}id')) != 'xl/worksheets/sheet1.xml'
                    or book.find('s:externalReferences', NS) is not None):
                _fail('sheet_profile')
            sheet_name = sheets[0].get('name', '')
            sheet = _xml(archive, 'xl/worksheets/sheet1.xml')
            if sheet.find('s:dimension', NS).get('ref') != 'A1:X102':
                _fail('sheet_bounds')
            if (any(n.get('hidden') in ('1', 'true') for n in sheet.findall('s:sheetData/s:row', NS))
                    or any(n.get('hidden') in ('1', 'true') for n in sheet.findall('s:cols/s:col', NS))):
                _fail('hidden_content')
            styles = _xml(archive, 'xl/styles.xml')
            xfs = styles.find('s:cellXfs', NS)
            if xfs is None or not 1 <= len(xfs) <= 150:
                _fail('style_profile')
            formats = {38: '#,##0_);[Red](#,##0)'}
            for fmt in styles.findall('s:numFmts/s:numFmt', NS):
                key = int(fmt.get('numFmtId'))
                if key in formats or key < 164 or len(fmt.get('formatCode', '')) > 200:
                    _fail('format_profile')
                if fmt.get('formatCode') not in KNOWN_CUSTOM_FORMATS:
                    _fail('unknown_numeric_format')
                formats[key] = fmt.get('formatCode')
            if any(int(xf.get('numFmtId', '0')) not in {0, 10, *formats} for xf in xfs):
                _fail('unknown_numeric_format')
            shared = _xml(archive, 'xl/sharedStrings.xml')
            if len(shared) > 1_000:
                _fail('text_limit')
            strings = [_string(n) for n in shared]
            cells, numeric, formula_caches, occupied, formats_used = {}, set(), [], set(), set()
            raw_numeric_proof = []
            for row in sheet.findall('s:sheetData/s:row', NS):
                row_number = int(row.get('r', '0'))
                if not 1 <= row_number <= 120:
                    _fail('cell_bounds')
                for c in row.findall('s:c', NS):
                    ref = c.get('r')
                    if _address(ref)[0] != row_number or ref in occupied:
                        _fail('cell_geometry')
                    occupied.add(ref)
                    typ, v, f = c.get('t', 'n'), c.find('s:v', NS), c.find('s:f', NS)
                    index = int(c.get('s', '0'))
                    if not 0 <= index < len(xfs):
                        _fail('style_profile')
                    fmt_id = int(xfs[index].get('numFmtId', '0'))
                    if typ not in ('n', 's', 'str'):
                        _fail('cell_type')
                    if v is None or v.text is None:
                        if f is not None:
                            _fail('formula_cache_missing')
                        continue
                    if f is not None:
                        if (typ != 'str' or ref not in {'H32', 'H63'} or not f.text
                                or f.get('t', 'normal') != 'normal'
                                or re.search(r'\[|\]|!|\||://|WEBSERVICE|HYPERLINK|EXEC|CALL', f.text, re.I)):
                            _fail('formula_profile')
                        formula_caches.append({'cell': ref, 'formula_sha256': sha256(f.text.encode()).hexdigest()})
                    if typ == 's':
                        string_index = int(v.text)
                        if not 0 <= string_index < len(strings):
                            _fail('shared_string')
                        value = strings[string_index]
                    elif typ == 'str':
                        if f is None:
                            _fail('formula_profile')
                        value = v.text
                    else:
                        code = formats.get(fmt_id)
                        value = _number(v.text, code)
                        numeric.add(ref)
                        formats_used.add(code)
                        raw_numeric_proof.append((ref, v.text, code))
                    if not value or len(value) > 5_000:
                        _fail('cell_content')
                    cells[ref] = value
            if set(cells) != EXPECTED_CELLS or numeric != EXPECTED_NUMERIC_CELLS:
                _fail('cell_profile')
            title = cells['A3']
            match = re.fullmatch(r'令和([1-9]\d?)年度' + re.escape(REPORT_TITLE), _compact(title))
            if not match or _compact(sheet_name) != 'R' + match[1] + '年度':
                _fail('report_identity')
            if publication_context is not None and 2018 + int(match[1]) >= publication_context.year:
                _fail('future_report_period')
            fiscal = '令和' + match[1] + '年度'
            checks = {'B5': '1.外貨建資産の内訳', 'B47': '2.外貨建運用収入の内訳',
                      'B61': '3.外貨定期預け金及び外貨証券に係る運用資産利回り',
                      'H7': fiscal + '末', 'H24': fiscal + '末', 'H32': fiscal + '末',
                      'H49': fiscal, 'H63': fiscal}
            for ref, expected in checks.items():
                if _compact(cells[ref]) != expected:
                    _fail('header_identity')
            if any(_compact(cells[ref]) != '(単位:百万円)' for ref in ('S6', 'W23', 'W31', 'S48', 'S62')):
                _fail('unit_identity')
            if {c['cell'] for c in formula_caches} != {'H32', 'H63'}:
                _fail('formula_profile')
            merges, merged_cells = {}, set()
            for node in sheet.findall('s:mergeCells/s:mergeCell', NS):
                ref = node.get('ref')
                start, end = _range(ref)
                positions = {(r, c) for r in range(start[0], end[0] + 1) for c in range(start[1], end[1] + 1)}
                if positions & merged_cells or any(_address(c) in positions and _address(c) != start for c in cells):
                    _fail('merge_profile')
                merged_cells |= positions
                merges[ref.split(':')[0]] = ref
                if len(merges) > 150:
                    _fail('merge_profile')
            drawing = _drawing(archive)
            rows = []
            for ref, value in sorted(cells.items(), key=lambda item: _address(item[0])):
                row, col = _address(ref)
                rows.append((row, col, merges.get(ref, ref) + ': ' + value))
            rows.append((drawing['row'], drawing['column'], '図形内注記: ' + drawing['text']))
            rows.sort(key=lambda item: (item[0], item[1]))
            body = '\n'.join(item[2] for item in rows)
            if not 100 <= len(body) <= MAX_BODY_CHARACTERS:
                _fail('body_limit')
            return {'body': body, 'body_sha256': sha256(body.encode()).hexdigest(),
                    'body_bytes': len(body.encode()), 'title': title,
                    'fiscal_year_label': fiscal, 'reporting_fiscal_year': 2018 + int(match[1]),
                    'workbook_sha256': sha256(payload).hexdigest(), 'source_kind': SOURCE_KIND,
                    'worksheet_name': sheet_name, 'dimensions': 'A1:X102',
                    'shape': {'sheets': 1, 'nonempty_cells': len(cells), 'numeric_cells': len(numeric),
                              'merged_ranges': len(merges), 'formula_caches': len(formula_caches),
                              'drawing_paragraphs': drawing['paragraph_count'], 'drawing_text_runs': drawing['text_run_count']},
                    'format_metadata': {'number_formats': sorted(formats_used),
                        'cached_numeric_format_sha256': sha256(json.dumps(raw_numeric_proof, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest(),
                        'formula_caches': formula_caches, 'formula_evaluations': 0,
                        'phonetic_runs_in_body': False, 'units': '百万円; ratios use originalpercent formats'},
                    'publication_date_in_workbook': None, 'issuer_in_workbook': None,
                    'publication_evidence_required_from_parent': True}
    except ValueError as exc:
        if str(exc).startswith('mof_xlsx_'):
            raise
        _fail('invalid_package')
    except (BadZipFile, KeyError, AttributeError, TypeError, IndexError, OverflowError, ET.ParseError):
        _fail('invalid_package')
