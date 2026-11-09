"""In-memory fictional OOXML contract fixtures; no original figures copied."""
from copy import deepcopy
from io import BytesIO
import unittest
from xml.etree import ElementTree as E
from zipfile import ZIP_DEFLATED, ZipFile

import official_mof_exchange_assets_xlsx as reader

S, R, A, X = reader.S, reader.R, reader.A, reader.X


def tag(namespace, name):
    return '{' + namespace + '}' + name


def relationship(identifier, kind, target):
    return f'<Relationship Id="{identifier}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/{kind}" Target="{target}"/>'


def fixture():
    header = {'A3': '令和７年度　' + reader.REPORT_TITLE,
              'B5': '1.　外貨建資産の内訳', 'B47': '2.　外貨建運用収入の内訳',
              'B61': '3.　外貨定期預け金及び外貨証券に係る運用資産利回り',
              'H7': '令和7年度末', 'H24': '令和7年度末', 'H32': '令和7年度末',
              'H49': '令和7年度', 'H63': '令和7年度'}
    for ref in ('S6', 'W23', 'W31', 'S48', 'S62'):
        header[ref] = '（単位：百万円）'
    sheet = E.Element(tag(S, 'worksheet'))
    E.SubElement(sheet, tag(S, 'dimension'), ref='A1:X102')
    data = E.SubElement(sheet, tag(S, 'sheetData'))
    strings, rows = [], {}
    for ref in sorted(reader.EXPECTED_CELLS, key=reader._address):
        rownum = reader._address(ref)[0]
        row = rows.get(rownum)
        if row is None:
            row = E.SubElement(data, tag(S, 'row'), r=str(rownum))
            rows[rownum] = row
        c = E.SubElement(row, tag(S, 'c'), r=ref, s='0')
        if ref in reader.EXPECTED_NUMERIC_CELLS:
            E.SubElement(c, tag(S, 'v')).text = '-1234' if ref == 'H8' else '321'
        elif ref in ('H32', 'H63'):
            c.set('t', 'str')
            E.SubElement(c, tag(S, 'f')).text = '"not evaluated"'
            E.SubElement(c, tag(S, 'v')).text = header[ref]
        else:
            c.set('t', 's')
            strings.append(header.get(ref, '架空の資料ラベル・注記' + ref))
            E.SubElement(c, tag(S, 'v')).text = str(len(strings) - 1)
    ss = E.Element(tag(S, 'sst'))
    for text in strings:
        si = E.SubElement(ss, tag(S, 'si'))
        E.SubElement(si, tag(S, 't')).text = text
        phonetic = E.SubElement(si, tag(S, 'rPh'), sb='0', eb='1')
        E.SubElement(phonetic, tag(S, 't')).text = 'ヨミガナハホンブンデハナイ'
    book = E.Element(tag(S, 'workbook'))
    sheets = E.SubElement(book, tag(S, 'sheets'))
    E.SubElement(sheets, tag(S, 'sheet'), name='R７年度', sheetId='1', attrib={tag(R, 'id'): 'one'})
    styles = E.Element(tag(S, 'styleSheet'))
    fmts = E.SubElement(styles, tag(S, 'numFmts'))
    E.SubElement(fmts, tag(S, 'numFmt'), numFmtId='179', formatCode='#,##0;"△ "#,##0')
    xfs = E.SubElement(styles, tag(S, 'cellXfs'))
    E.SubElement(xfs, tag(S, 'xf'), numFmtId='179')
    drawing = E.Element(tag(X, 'wsDr'))
    anchor = E.SubElement(drawing, tag(X, 'twoCellAnchor'))
    for name, row, col in [('from', 83, 14), ('to', 90, 23)]:
        place = E.SubElement(anchor, tag(X, name))
        E.SubElement(place, tag(X, 'row')).text = str(row)
        E.SubElement(place, tag(X, 'col')).text = str(col)
    shape = E.SubElement(anchor, tag(X, 'sp'))
    body = E.SubElement(shape, tag(X, 'txBody'))
    for count in (2, 2, 2, 1):
        p = E.SubElement(body, tag(A, 'p'))
        for _ in range(count):
            r = E.SubElement(p, tag(A, 'r'))
            E.SubElement(r, tag(A, 't')).text = '架空の図形注記'
    parts = {name: b'<root/>' for name in reader.PARTS}
    parts['[Content_Types].xml'] = b'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'
    parts['xl/workbook.xml'] = E.tostring(book)
    parts['xl/sharedStrings.xml'] = E.tostring(ss)
    parts['xl/styles.xml'] = E.tostring(styles)
    parts['xl/worksheets/sheet1.xml'] = E.tostring(sheet)
    parts['xl/drawings/drawing1.xml'] = E.tostring(drawing)
    parts['xl/_rels/workbook.xml.rels'] = ('<Relationships>' + relationship('one', 'worksheet', 'worksheets/sheet1.xml') + '</Relationships>').encode()
    parts['_rels/.rels'] = b'<Relationships/>'
    parts['xl/worksheets/_rels/sheet1.xml.rels'] = b'<Relationships/>'
    parts['xl/printerSettings/printerSettings1.bin'] = b'fictional printer metadata'
    return parts


def payload(parts):
    stream = BytesIO()
    with ZipFile(stream, 'w', ZIP_DEFLATED) as archive:
        for name, data in parts.items():
            archive.writestr(name, data)
    return stream.getvalue()


def edit(parts, filename, transform):
    root = E.fromstring(parts[filename])
    transform(root)
    parts[filename] = E.tostring(root)


def cell(root, ref):
    return next(c for c in root.iter(tag(S, 'c')) if c.get('r') == ref)


class MofWorkbookReaderTests(unittest.TestCase):
    def test_complete_source_order_cached_content_no_evaluation_or_date_fabrication(self):
        parts = fixture()
        before = deepcopy(parts)
        result = reader.extract_mof_exchange_assets_workbook(payload(parts), '2026-11-09')
        self.assertEqual(parts, before)
        self.assertEqual(result['shape']['nonempty_cells'], 142)
        self.assertEqual(result['shape']['numeric_cells'], 70)
        self.assertEqual(result['shape']['formula_caches'], 2)
        self.assertEqual(result['shape']['drawing_text_runs'], 7)
        self.assertIn('H8: △ 1,234', result['body'])
        self.assertIn('図形内注記:', result['body'])
        self.assertNotIn('ヨミガナ', result['body'])
        self.assertNotIn('not evaluated', result['body'])
        self.assertIsNone(result['publication_date_in_workbook'])
        self.assertIsNone(result['issuer_in_workbook'])
        self.assertEqual(result['reporting_fiscal_year'], 2025)
        self.assertEqual(result['format_metadata']['formula_evaluations'], 0)
        self.assertLess(result['body'].index('A3:'), result['body'].index('H8:'))

    def test_display_rounding_percent_scale_zero_and_delta_signs(self):
        self.assertEqual(reader._number('-1234.5', '#,##0;"△ "#,##0'), '△ 1,235')
        self.assertEqual(reader._number('0', '#,##0;[Red]"△ "#,##0'), '0')
        self.assertEqual(reader._number('-1234', '#,##0_);[Red](#,##0)'), '(1,234)')
        self.assertEqual(reader._number('0.12555', r'\ #,##0.00%\ ;" △ "#,##0.00%\ '), '12.56%')
        self.assertEqual(reader._number('-0.12555', r'\ #,##0.00%\ ;" △ "#,##0.00%\ '), '△ 12.56%')
        self.assertEqual(reader._number('-0.1255', r'\(\ #,##0.0%\ \);"（ △ "#,##0%\ \)'), '（ △ 13% )')

    def test_missing_error_numeric_or_untrusted_formula_cache_is_rejected(self):
        for mutate in (
                lambda c: c.remove(c.find(tag(S, 'v'))),
                lambda c: c.set('t', 'e'),
                lambda c: c.set('t', 'n'),
                lambda c: setattr(c.find(tag(S, 'f')), 'text', '[other.xlsx]Sheet1!A1'),
                lambda c: c.find(tag(S, 'f')).set('t', 'shared'),
                lambda c: setattr(c.find(tag(S, 'v')), 'text', '令和8年度末')):
            with self.subTest(mutation=mutate):
                parts = fixture()
                edit(parts, 'xl/worksheets/sheet1.xml', lambda root: mutate(cell(root, 'H32')))
                with self.assertRaisesRegex(ValueError, '^mof_xlsx_'):
                    reader.extract_mof_exchange_assets_workbook(payload(parts), '2026-11-09')

    def test_unknown_numeric_format_and_nonfinite_values_are_rejected(self):
        parts = fixture()
        edit(parts, 'xl/styles.xml', lambda root: root.find('.//' + tag(S, 'numFmt')).set('formatCode', '0.000E+00'))
        with self.assertRaisesRegex(ValueError, 'unknown_numeric_format'):
            reader.extract_mof_exchange_assets_workbook(payload(parts))
        for bad in ('NaN', 'Infinity', '1e9999', '1e-9999'):
            with self.subTest(value=bad), self.assertRaisesRegex(ValueError, '^mof_xlsx_'):
                reader._number(bad, '#,##0;"△ "#,##0')

    def test_external_macro_extra_sheet_or_unknown_parts_are_rejected(self):
        parts = fixture()
        parts['_rels/.rels'] = b'<Relationships><Relationship Id="external" TargetMode="External" Type="x/relationships/officeDocument" Target="https://example.test/"/></Relationships>'
        with self.assertRaisesRegex(ValueError, 'relationship'):
            reader.extract_mof_exchange_assets_workbook(payload(parts))
        parts = fixture()
        parts['xl/vbaProject.bin'] = b'never executed'
        with self.assertRaisesRegex(ValueError, 'package_profile'):
            reader.extract_mof_exchange_assets_workbook(payload(parts))
        parts = fixture()
        edit(parts, 'xl/workbook.xml', lambda root: E.SubElement(root.find(tag(S, 'sheets')), tag(S, 'sheet'), name='hidden data', state='hidden'))
        with self.assertRaisesRegex(ValueError, 'sheet_profile'):
            reader.extract_mof_exchange_assets_workbook(payload(parts))

    def test_hidden_missing_or_duplicate_cells_do_not_disappear_silently(self):
        for mutation in ('hidden', 'missing', 'duplicate'):
            parts = fixture()
            def change(root):
                row = root.find(tag(S, 'sheetData'))[0]
                if mutation == 'hidden':
                    row.set('hidden', '1')
                elif mutation == 'missing':
                    row.remove(row[0])
                else:
                    row.append(deepcopy(row[0]))
            edit(parts, 'xl/worksheets/sheet1.xml', change)
            with self.subTest(mutation=mutation), self.assertRaisesRegex(ValueError, '^mof_xlsx_'):
                reader.extract_mof_exchange_assets_workbook(payload(parts))

    def test_merge_nonanchor_values_overlap_and_out_of_bounds_are_rejected(self):
        for ranges in [('B8:H8',), ('A1:B2', 'B2:C3'), ('A1:Y2',)]:
            parts = fixture()
            def change(root):
                merges = E.SubElement(root, tag(S, 'mergeCells'))
                for ref in ranges:
                    E.SubElement(merges, tag(S, 'mergeCell'), ref=ref)
            edit(parts, 'xl/worksheets/sheet1.xml', change)
            with self.subTest(ranges=ranges), self.assertRaisesRegex(ValueError, '^mof_xlsx_'):
                reader.extract_mof_exchange_assets_workbook(payload(parts))

    def test_drawing_notes_fields_images_or_hidden_content_cannot_be_omitted(self):
        for mutation in ('missing', 'field', 'picture', 'hidden'):
            parts = fixture()
            def change(root):
                if mutation == 'missing':
                    root.remove(root[0])
                elif mutation == 'field':
                    E.SubElement(root[0], tag(A, 'fld'))
                elif mutation == 'picture':
                    E.SubElement(root[0], tag(X, 'pic'))
                else:
                    root[0].set('hidden', '1')
            edit(parts, 'xl/drawings/drawing1.xml', change)
            with self.subTest(mutation=mutation), self.assertRaisesRegex(ValueError, '^mof_xlsx_'):
                reader.extract_mof_exchange_assets_workbook(payload(parts))

    def test_malformed_XML_bomb_bounds_and_invalid_context_reject(self):
        for bad in (b'not a zip', b'x' * (reader.MAX_BYTES + 1)):
            with self.assertRaisesRegex(ValueError, '^mof_xlsx_'):
                reader.extract_mof_exchange_assets_workbook(bad)
        for part in ('xl/theme/theme1.xml', 'xl/worksheets/sheet1.xml'):
            parts = fixture()
            parts[part] = b'<!DOCTYPE root [<!ENTITY x "fixture">]><root/>'
            with self.subTest(part=part), self.assertRaisesRegex(ValueError, '^mof_xlsx_'):
                reader.extract_mof_exchange_assets_workbook(payload(parts))
        for encoded in ('<root/>'.encode('utf-16'),
                        '<!DOCTYPE root [<!ENTITY x "fixture">]><root/>'.encode('utf-16'),
                        b'<?xml version="1.0" encoding="ISO-8859-1"?><root/>'):
            parts = fixture()
            parts['xl/theme/theme1.xml'] = encoded
            with self.assertRaisesRegex(ValueError, 'XML_encoding'):
                reader.extract_mof_exchange_assets_workbook(payload(parts))
        parts = fixture()
        parts['xl/printerSettings/printerSettings1.bin'] = b'x' * (reader.MAX_PART_BYTES + 1)
        with self.assertRaisesRegex(ValueError, 'package_profile'):
            reader.extract_mof_exchange_assets_workbook(payload(parts))
        for day in ('2026-2-30', '2026-11-09T00:00:00', True, '2025-11-09'):
            with self.subTest(day=day), self.assertRaisesRegex(ValueError, '^mof_xlsx_'):
                reader.extract_mof_exchange_assets_workbook(payload(fixture()), day)


if __name__ == '__main__':
    unittest.main()
