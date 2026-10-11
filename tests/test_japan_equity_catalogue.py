"""Official national identities, effective listing dates and bounded recovery."""
from copy import deepcopy
from datetime import date
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import requests
import japan_equity_catalogue as national
from stock_search import StockSearch, SEED_PATH as JPX_SEED_PATH
import stock_search

DAY = date(2026, 10, 11)


def source(key, rows, stamp='2026-10-11'):
    return {'source_url': national.SOURCES[key], 'as_of': stamp, 'sha256': 'a' * 64, 'items': rows}


def document(sources):
    return {'version': 1, 'scope': national.SCOPE, 'sources': sources}


def new_listing_table(rows):
    header = ('<tr><th>上場日（上場承認日）</th><th>会社名（注3）</th><th>コード</th>'
              '<th>会社概要</th><th>確認書</th><th>仮条件</th><th>公募</th><th>売買単位</th></tr>'
              '<tr><th>市場区分</th><th>Iの部</th><th>CG報告書</th><th>公募価格</th><th>売出</th><th>決算短信</th></tr>')
    return ('<table>' + header + ''.join(
        f'<tr><td>{stamp}</td><td>{name}</td><td>{code}</td>' + '<td>-</td>' * 5 + '</tr>' +
        f'<tr><td>{market}</td>' + '<td>-</td>' * 5 + '</tr>' for stamp, name, code, market in rows) + '</table>').encode()


def transfer_table(rows):
    return ('<table><tr><th>変更日</th><th>会社名（注1）</th><th>コード</th><th>市場区分</th>'
            '<th>以前の市場区分</th><th>幹事取引参加者</th><th>代表者インタビュー</th></tr>' + ''.join(
                '<tr>' + ''.join(f'<td>{value}</td>' for value in (*row, '-', '-')) + '</tr>'
                for row in rows) + '</table>').encode()


class OfficialNationalCatalogueTests(unittest.TestCase):
    def test_live_read_snapshot_is_dated_and_every_current_identity_is_searchable_offline(self):
        supplement = national.read_supplement()
        self.assertEqual(set(supplement['sources']), set(national.SOURCES))
        search = StockSearch(runtime_path=None, session=Mock())
        data = search.all_items()
        self.assertEqual(data['scope'], national.SCOPE)
        self.assertEqual(len(data['items']), len({row['code'] for row in data['items']}))
        self.assertEqual(set(data['exchanges']), {'Tokyo', 'Nagoya', 'Sapporo', 'Fukuoka'})
        self.assertEqual(len(data['items']), 3796)
        self.assertEqual(len(search.provider_items()), 3686)
        for row in data['items']:
            identity = search.company(row['code'])
            result = search.search(row['code'])['results'][0]
            self.assertEqual(result['symbol'], identity['symbol'])
            self.assertEqual(result['name'], row['name'])
            self.assertEqual(set(row), {'code', 'name'}, 'Preserve lookup_all item contract')
        search.session.get.assert_not_called()

    def test_each_regional_market_has_a_canonical_identity_without_an_inferred_quote_symbol(self):
        search = StockSearch(runtime_path=None, session=Mock())
        for code, exchange in [('1738', 'Nagoya'), ('2928', 'Sapporo'), ('1771', 'Fukuoka'), ('231A', 'Fukuoka')]:
            with self.subTest(code=code):
                row = search.company(code)
                self.assertEqual(row['exchange'], exchange)
                self.assertEqual(row['symbol'], code + '.JP')
                self.assertIsNone(row['provider_symbol'])
                self.assertEqual(search.company(code + '.JP'), row)
                self.assertIsNone(search.company(code + '.T'))
                self.assertEqual(search.search(code + '.JP')['results'][0]['symbol'], code + '.JP')
                self.assertEqual(search.search(code + '.T')['results'], [])
                for unconfirmed_suffix in ('.N', '.S', '.F'):
                    self.assertEqual(search.search(code + unconfirmed_suffix)['results'], [])
        search.session.get.assert_not_called()

    def test_provider_items_exclude_regional_and_delisted_without_per_company_lookup(self):
        search = StockSearch(runtime_path=None, session=Mock())
        with patch.object(search, 'company', side_effect=AssertionError('No per-company lookup')):
            providers = search.provider_items()
        self.assertTrue(providers)
        symbols = {row['provider_symbol'] for row in providers}
        self.assertIn('640A.T', symbols)
        self.assertNotIn('7851.T', symbols)
        self.assertNotIn('2928.T', symbols)
        self.assertNotIn('1738.T', symbols)
        for regional_multiple in ('353A.T', '6147.T', '7118.T'):
            self.assertNotIn(regional_multiple, symbols)
        self.assertTrue(all(row['symbol'] == row['provider_symbol'] and row['symbol'].endswith('.T') for row in providers))
        providers[0]['name'] = 'Changed copy'
        self.assertNotEqual(search.provider_items()[0]['name'], 'Changed copy')
        search.session.get.assert_not_called()

    def test_effective_tokyo_new_listing_and_exchange_specific_delisting(self):
        search = StockSearch(runtime_path=None, session=Mock())
        for code in ('640A', '641A', '642A'):
            self.assertEqual(search.company(code)['provider_symbol'], code + '.T')
            self.assertEqual(search.company(code)['listed_on'], '2026-10-01')
        self.assertIsNone(search.company('648A'), 'Future listing must not become a current company')
        self.assertIsNone(search.company('588A'), 'PRO issue is separate from ordinary market scope')
        self.assertIsNone(search.company('9691'))
        self.assertEqual(search.search('9691')['results'], [])
        self.assertEqual(search.company('7851')['exchange'], 'Fukuoka')
        self.assertEqual(search.company('7851')['symbol'], '7851.JP')
        search.session.get.assert_not_called()

    def test_effective_market_transfer_corrects_current_market_without_changing_provider_count(self):
        search = StockSearch(runtime_path=None, session=Mock())
        medrx = search.company('4586')
        self.assertEqual(medrx['market'], 'スタンダード（内国株式）')
        self.assertEqual(medrx['market_changed_on'], '2026-10-07')
        self.assertEqual(medrx['as_of'], '2026-10-11')
        self.assertEqual(medrx['source_url'], national.SOURCES['tokyo_transfers'])
        self.assertEqual(medrx['provider_symbol'], '4586.T')
        self.assertEqual(search.company('4475')['market'], 'グロース（内国株式）')
        self.assertNotIn('market_changed_on', search.company('4475'), 'Announced date window is not an actual change')
        self.assertEqual(len(search.all_items()['items']), 3796)
        self.assertEqual(len(search.provider_items()), 3686)
        search.session.get.assert_not_called()

    def test_companies_with_multiple_regional_listings_survive_tokyo_delisting(self):
        search = StockSearch(runtime_path=None, session=Mock())
        for code in ('6147', '353A', '7118'):
            with self.subTest(code=code):
                row = search.company(code)
                self.assertEqual(row['symbol'], code + '.JP')
                self.assertIsNone(row['provider_symbol'])
                exchanges = {row['exchange']} | {r['exchange'] for r in row['other_listings']}
                self.assertEqual(len(exchanges), 2)
                self.assertNotIn('Tokyo', exchanges)
                self.assertEqual(search.search(code)['results'][0]['symbol'], code + '.JP')
                self.assertEqual(search.search(code + '.T')['results'], [])
        search.session.get.assert_not_called()

    def test_full_regional_membership_has_market_provenance_and_excludes_other_products(self):
        supplement = national.read_supplement()
        self.assertEqual(len(supplement['sources']['nagoya_all']['items']), 321)
        self.assertEqual(len(supplement['sources']['sapporo_all']['items']), 68)
        self.assertEqual(len(supplement['sources']['fukuoka_all']['items']), 122)
        search = StockSearch(runtime_path=None, session=Mock())
        for code in ('1319', '1553', '8968', '588A', '599A', '615A', '628A'):
            self.assertIsNone(search.company(code), code)
        row = search.company('4502')
        self.assertEqual(row['provider_symbol'], '4502.T')
        regional = [listing['exchange'] for listing in row['other_listings']]
        self.assertEqual(len(regional), len(set(regional)), 'One row per exchange, not one per source')

    def test_old_upstream_tokyo_quote_cannot_resurrect_delisted_company(self):
        search = StockSearch(runtime_path=None, session=Mock())
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.iter_content.return_value = [json.dumps({'quotes': [
            {'symbol': '9691.T', 'shortname': 'Old company', 'quoteType': 'EQUITY'},
            {'symbol': 'AAPL', 'shortname': 'Apple', 'quoteType': 'EQUITY'}]}).encode()]
        search.session.get.return_value = response
        self.assertEqual([row['symbol'] for row in search.search('old-alias')['results']], ['AAPL'])

    def test_duplicate_exchange_listing_keeps_tokyo_quote_mapping_and_regional_provenance(self):
        monthly = {'as_of': '2026-09-30', 'source_url': 'https://www.jpx.co.jp/markets/statistics-equities/misc/01.html',
                   'items': [{'code': '7203', 'name': 'トヨタ自動車', 'market': 'プライム（内国株式）'}]}
        extra = document({'nagoya': source('nagoya', [
            {'code': '7203', 'name': 'トヨタ自動車', 'market': 'プレミア市場'}])})
        rows, closed = national.merge_companies(monthly, extra)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['symbol'], '7203.T')
        self.assertEqual(rows[0]['other_listings'][0]['exchange'], 'Nagoya')
        self.assertFalse(closed)

    def test_last_good_full_exchange_membership_cannot_be_erased_by_a_newer_single_listing_page(self):
        monthly = {'as_of': '2026-09-30', 'source_url': 'https://www.jpx.co.jp/markets/statistics-equities/misc/01.html',
                   'items': [{'code': '6147', 'name': 'ヤマザキ', 'market': 'スタンダード（内国株式）'}]}
        extra = document({'tokyo_delisted': source('tokyo_delisted', [
                          {'code': '6147', 'name': 'ヤマザキ', 'delisted_on': '2026-10-01'}]),
                          'sapporo_all': source('sapporo_all', [{'code': '6147', 'name': 'ヤマザキ', 'market': '本則市場'}], '2026-10-10'),
                          'sapporo': source('sapporo', [], '2026-10-11')})
        rows, closed = national.merge_companies(monthly, extra)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['symbol'], '6147.JP')
        self.assertIsNone(rows[0]['provider_symbol'])
        self.assertEqual(rows[0]['catalogue_as_of'], '2026-10-10')
        self.assertIn('6147', closed)

    def test_delisting_does_not_delete_later_relisting(self):
        monthly = {'as_of': '2026-09-30', 'source_url': 'https://www.jpx.co.jp/markets/statistics-equities/misc/01.html', 'items': []}
        extra = document({'tokyo_new': source('tokyo_new', [{'code': '123A', 'name': 'Relisted',
                          'market': 'グロース（内国株式）', 'listed_on': '2026-10-10'}]),
                          'tokyo_delisted': source('tokyo_delisted', [{'code': '123A', 'name': 'Old', 'delisted_on': '2026-10-01'}])})
        rows, closed = national.merge_companies(monthly, extra)
        self.assertEqual(rows[0]['symbol'], '123A.T')
        self.assertNotIn('123A', closed)

    def test_new_listing_parser_uses_listing_date_not_approval_date_and_skips_future(self):
        payload = new_listing_table([
            ('2026/10/01<br>（2026/09/01）', '<a href="https://current.test/">（株）Current *</a>', '640A', 'グロース'),
            ('2026/10/15<br>（2026/09/08）', '<a href="https://future.test/">Future</a>', '648A', 'グロース')])
        rows = national.parse_tokyo_new(payload, DAY)
        self.assertEqual(rows, [{'code': '640A', 'name': 'Current', 'market': 'グロース（内国株式）', 'listed_on': '2026-10-01'}])

    def test_new_listing_name_comes_from_company_link_not_video_label(self):
        payload = new_listing_table([('2026/02/13<br>（2026/01/09）',
            '<a href="https://www.tobooks.jp/">（株）ＴＯブックス</a><br>'
            '<a href="https://youtu.be/1GKeoFdHgmo">代表者インタビュー</a>', '500A', 'スタンダード')])
        self.assertEqual(national.parse_tokyo_new(payload, DAY)[0]['name'], 'ＴＯブックス')
        seed = national.read_supplement()
        self.assertEqual(next(row for row in seed['sources']['tokyo_new']['items'] if row['code'] == '500A')['name'], 'ＴＯブックス')
        self.assertTrue(all('代表者インタビュー' not in row['name'] for row in seed['sources']['tokyo_new']['items']))

    def test_new_listing_unknown_name_structure_duplicate_code_or_unpaired_market_fails(self):
        good = ('2026/10/01<br>（2026/09/01）', '<a href="https://company.test/">（株）Current</a>', '640A', 'グロース')
        for name in (good[1] + '<a href="https://second.test/">Other company</a>',
                     good[1] + ' Unknown label', '<span>' + good[1] + '</span>',
                     '<a href="https://youtu.be/example">代表者インタビュー</a>'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                national.parse_tokyo_new(new_listing_table([(good[0], name, good[2], good[3])]), DAY)
        with self.assertRaises(ValueError):
            national.parse_tokyo_new(new_listing_table([good, good]), DAY)
        with self.assertRaises(ValueError):
            national.parse_tokyo_new(new_listing_table([good]).replace(b'<td>-</td></tr></table>', b'</tr></table>'), DAY)
        with self.assertRaises(ValueError):
            national.parse_tokyo_new(new_listing_table([good]).removesuffix(b'</table>'), DAY)
        for stamp in ('2026/10/01 ～ 2026/10/03', '2026/10/01（2026/10/02）', '2026/10/32（2026/09/01）'):
            with self.subTest(stamp=stamp), self.assertRaises(ValueError):
                national.parse_tokyo_new(new_listing_table([(stamp, good[1], good[2], good[3])]), DAY)

    def test_market_transfer_parser_requires_actual_effective_date_and_known_markets(self):
        payload = transfer_table([
            ('2026/10/20<br> ～ 2026/10/22', 'ＨＥＮＮＧＥ（株）', '4475', 'プライム', 'グロース'),
            ('2026/10/07', '（株）メドレックス', '4586', 'スタンダード', 'グロース'),
            ('2026/10/15', 'Future（株）', '123A', 'プライム', 'スタンダード'),
            ('2026/10/01 ～ 2026/10/03', 'Unconfirmed actual date（株）', '234A', 'プライム', 'グロース')])
        self.assertEqual(national.parse_tokyo_transfers(payload, DAY), [{
            'code': '4586', 'name': 'メドレックス', 'changed_on': '2026-10-07',
            'market': 'スタンダード（内国株式）', 'previous_market': 'グロース（内国株式）'}])

    def test_market_transfer_changed_columns_invalid_dates_and_duplicate_identities_fail_safe(self):
        good = ('2026/10/07', '（株）メドレックス', '4586', 'スタンダード', 'グロース')
        for row in (('2026/10/32', *good[1:]), ('2026/10/07 未確定', *good[1:]),
                    ('2026/10/09 ～ 2026/10/07', *good[1:]),
                    (*good[:3], 'PRO', good[4]), (*good[:3], 'グロース', 'グロース')):
            with self.subTest(row=row), self.assertRaises(ValueError):
                national.parse_tokyo_transfers(transfer_table([row]), DAY)
        with self.assertRaises(ValueError):
            national.parse_tokyo_transfers(transfer_table([good, good]), DAY)
        with self.assertRaises(ValueError):
            national.parse_tokyo_transfers(transfer_table([good]).replace('以前の市場区分'.encode(), '変更理由'.encode()), DAY)
        with self.assertRaises(ValueError):
            national.parse_tokyo_transfers(transfer_table([good]).replace(b'<td>-</td></tr>', b'</tr>'), DAY)
        with self.assertRaises(ValueError):
            national.parse_tokyo_transfers(transfer_table([good]).removesuffix(b'</table>'), DAY)

    def test_market_transfer_cannot_resurrect_delisted_or_mismatch_current_issuer(self):
        monthly = {'as_of': '2026-09-30', 'source_url': 'https://www.jpx.co.jp/markets/statistics-equities/misc/01.html',
            'items': [{'code': '4586', 'name': 'メドレックス', 'market': 'グロース（内国株式）'},
                      {'code': '6147', 'name': 'ヤマザキ', 'market': 'スタンダード（内国株式）'},
                      {'code': '123A', 'name': 'New issuer', 'market': 'グロース（内国株式）'},
                      {'code': '234A', 'name': 'Wrong former market', 'market': 'プライム（内国株式）'}]}
        rows = [{'code': code, 'name': name, 'market': target, 'previous_market': previous, 'changed_on': '2026-10-07'} for
                code, name, target, previous in [
                    ('4586', 'メドレックス', 'スタンダード（内国株式）', 'グロース（内国株式）'),
                    ('6147', 'ヤマザキ', 'プライム（内国株式）', 'スタンダード（内国株式）'),
                    ('123A', 'Old issuer', 'スタンダード（内国株式）', 'グロース（内国株式）'),
                    ('234A', 'Wrong former market', 'プライム（内国株式）', 'グロース（内国株式）'),
                    ('999A', 'Unknown company', 'スタンダード（内国株式）', 'グロース（内国株式）')]]
        extra = document({'tokyo_transfers': source('tokyo_transfers', rows),
                          'tokyo_delisted': source('tokyo_delisted', [{'code': '6147', 'name': 'ヤマザキ', 'delisted_on': '2026-10-01'}]),
                          'sapporo_all': source('sapporo_all', [{'code': '6147', 'name': 'ヤマザキ', 'market': '本則市場'}])})
        merged, closed = national.merge_companies(monthly, extra)
        by_code = {row['code']: row for row in merged}
        self.assertEqual(by_code['4586']['market'], 'スタンダード（内国株式）')
        self.assertEqual(by_code['6147']['symbol'], '6147.JP')
        self.assertEqual(by_code['123A']['market'], 'グロース（内国株式）')
        self.assertNotIn('market_changed_on', by_code['234A'])
        self.assertNotIn('999A', by_code)
        self.assertIn('6147', closed)

    def test_market_transfer_older_than_monthly_or_later_relisting_cannot_overwrite(self):
        monthly = {'as_of': '2026-10-31', 'source_url': 'https://www.jpx.co.jp/markets/statistics-equities/misc/01.html',
                   'items': [{'code': '4586', 'name': 'メドレックス', 'market': 'プライム（内国株式）'}]}
        extra = document({'tokyo_transfers': source('tokyo_transfers', [{'code': '4586', 'name': 'メドレックス',
            'market': 'スタンダード（内国株式）', 'previous_market': 'グロース（内国株式）', 'changed_on': '2026-10-07'}])})
        merged, _ = national.merge_companies(monthly, extra)
        self.assertEqual(merged[0]['market'], 'プライム（内国株式）')
        monthly.update(as_of='2026-09-30', items=[])
        extra['sources']['tokyo_new'] = source('tokyo_new', [{'code': '4586', 'name': 'メドレックス',
            'market': 'グロース（内国株式）', 'listed_on': '2026-10-10'}])
        merged, _ = national.merge_companies(monthly, extra)
        self.assertEqual(merged[0]['market'], 'グロース（内国株式）')

    def test_delisting_parser_skips_future_announced_delisting(self):
        payload = '''<table><tr><th>上場廃止日</th><th>銘柄名</th><th>コード</th><th>市場区分</th><th>上場廃止理由</th></tr>
        <tr><td>2026/10/09</td><td>（株）Current</td><td>9691</td><td>スタンダード</td><td>MBO</td></tr>
        <tr><td>2026/10/19</td><td>Future</td><td>5484</td><td>スタンダード</td><td>MBO</td></tr></table>'''.encode()
        rows = national.parse_tokyo_delisted(payload, DAY)
        self.assertEqual(rows[0]['code'], '9691')
        self.assertEqual(len(rows), 1)

    def test_nagoya_complete_page_class_mapping_excludes_etf(self):
        rows = [{'simpleListing': 1, 'stockCode': str(1700 + i) + '0', 'stockName_j': 'Company' + str(i),
                 'listedDivision': 2, 'industryName_j': '建設業'} for i in range(10)]
        rows += [{'simpleListing': 1, 'stockCode': '15530', 'stockName_j': 'ETF', 'listedDivision': 4}]
        data = {'stock': rows, 'list': [{'listTotal': '11', 'listPage': '1'}]}
        self.assertEqual(len(national.parse_nagoya(json.dumps(data).encode(), DAY)), 10)
        data['list'][0]['listTotal'] = '12'
        with self.assertRaises(ValueError):
            national.parse_nagoya(json.dumps(data).encode(), DAY)

    def test_nagoya_full_pagination_includes_multiple_listings_and_fails_on_missing_or_changed_pages(self):
        rows = [{'simpleListing': 0, 'stockCode': str(1700 + i) + '0', 'stockName_j': 'Company' + str(i),
                 'listedDivision': 2, 'industryName_j': '建設業'} for i in range(101)]
        rows += [{'stockCode': '15530', 'listedDivision': 4, 'stockName_j': 'ETF'}]
        pages = [{'list': [{'listTotal': '102', 'listPage': str(i + 1)}], 'stock': rows[i * 100:(i + 1) * 100]}
                 for i in range(2)]
        self.assertEqual(len(national.parse_nagoya_all(json.dumps({'pages': pages}).encode(), DAY)), 101)
        for bad in ([pages[0]], [pages[0], dict(pages[1], list=[{'listTotal': '103', 'listPage': '2'}])],
                    [pages[0], dict(pages[1], stock=[])]):
            with self.assertRaises(ValueError):
                national.parse_nagoya_all(json.dumps({'pages': bad}).encode(), DAY)
        bad = deepcopy(pages)
        bad[0]['stock'][0]['stockCode'] = '17381'
        with self.assertRaises(ValueError):
            national.parse_nagoya_all(json.dumps({'pages': bad}).encode(), DAY)
        bad = deepcopy(pages)
        bad[0]['stock'][0]['listedDivision'] = 99
        with self.assertRaises(ValueError):
            national.parse_nagoya_all(json.dumps({'pages': bad}).encode(), DAY)

    def test_nagoya_full_download_only_follows_bounded_public_identity_pages(self):
        pages = [{'list': [{'listTotal': '102', 'listPage': str(i + 1)}], 'stock': []} for i in range(2)]
        with patch.object(national, '_download', side_effect=[json.dumps(page).encode() for page in pages]) as fetch:
            payload = national._download_source('nagoya_all', national.SOURCES['nagoya_all'], Mock())
        self.assertEqual(json.loads(payload)['pages'], pages)
        self.assertEqual([call.args[0] for call in fetch.call_args_list], list(national.NAGOYA_PAGES[:2]))
        with patch.object(national, '_download', return_value=b'{"list":[{"listTotal":"1001"}]}') as fetch:
            with self.assertRaises(ValueError):
                national._download_source('nagoya_all', national.SOURCES['nagoya_all'], Mock())
        self.assertEqual(fetch.call_count, 1)

    def test_sapporo_malformed_section_cannot_absorb_pro_or_misclassify_ambitious(self):
        def link(code): return f'<a href="/listing/company{code}"><span>{code}</span>Company{code}</a>'
        # The actual official document omits the first closing section.
        payload = ('<section id="honsoku">' + ''.join(link(str(1400+i)) for i in range(5)) +
                   '<section id="ambitious">' + link('2928') + '</section>' +
                   '<section id="spfm">' + link('588A') + '</section></section>').encode()
        rows = national.parse_sapporo(payload, DAY)
        self.assertEqual(len(rows), 6)
        self.assertEqual(rows[-1]['market'], 'アンビシャス市場')
        self.assertNotIn('588A', {row['code'] for row in rows})

    def test_fukuoka_company_name_uses_official_logo_alt_and_excludes_pro(self):
        def table(code, market):
            return f'''<table class="under__table under__table--border"><tr><th>業種</th><td>建設業</td>
            <th>コード</th><td>{code}</td><th>市場区分</th><td>{market}</td></tr>
            <tr><th>会社名</th><td><a href="https://example.test"><img alt="Company{code}"></a></td></tr></table>'''
        payload = (''.join(table(str(1700+i), '本則') for i in range(10)) + table('342A', 'Fukuoka PRO Market')).encode()
        rows = national.parse_fukuoka(payload, DAY)
        self.assertEqual(len(rows), 10)
        self.assertEqual(rows[0]['name'], 'Company1700')

    def test_sapporo_full_sections_keep_multi_exchange_company_but_exclude_pro_and_bonds(self):
        def group(title, codes):
            return '<dl><dt><h5>' + title + '</h5></dt><dd><div>' + ''.join(
                f'<dl><dt>{code}</dt><dd><a href="https://www.sse.or.jp/listing/company{code}">Company{code}</a></dd></dl>'
                for code in codes) + '</div></dd></dl>'
        payload = ('<div class="subnav07">' + group('単独上場会社 - 本則市場', [str(1400+i) for i in range(10)]) +
                   group('重複上場会社 - 本則市場', [str(1500+i) for i in range(10)] + ['6147']) +
                   group('単独上場会社 - アンビシャス', ['2928']) + group('重複上場会社 - アンビシャス', ['7118']) +
                   group('重複上場会社 - Sapporo PRO Frontier Market', ['628A']) +
                   group('債券上場会社 - 北海道ESGプロボンドマーケット', ['0001']) + '</div>').encode()
        rows = national.parse_sapporo_all(payload, DAY)
        codes = {r['code'] for r in rows}
        self.assertIn('6147', codes)
        self.assertIn('7118', codes)
        self.assertNotIn('628A', codes)
        self.assertNotIn('0001', codes)
        with self.assertRaises(ValueError):
            national.parse_sapporo_all(payload.replace('重複上場会社 - アンビシャス'.encode(), b'Unknown market'), DAY)

    def test_fukuoka_full_regular_market_excludes_explicit_etf_reit_and_pro(self):
        def link(code, name):
            return f'<a href="/market-info/listed-companies/detail.php?copid=1"><p>{name}<br><span class="under__btn-code">コード：{code}</span></p></a>'
        payload = ('<section id="honsoku">' + ''.join(link(str(1700+i), 'Company') for i in range(30)) +
                   link('6147', 'ヤマザキ') + link('1319', 'ETF受益証券') + link('8968', '福岡リート投資法人 投資証券') +
                   '</section><section id="q-board">' + link('231A', 'Current alpha') +
                   '</section><section id="fukuokapromarket">' + link('628A', 'PRO company') + '</section>').encode()
        rows = national.parse_fukuoka_all(payload, DAY)
        self.assertEqual(len(rows), 32)
        self.assertEqual({r['code'] for r in rows} & {'1319', '8968', '628A'}, set())
        self.assertIn('6147', {r['code'] for r in rows})
        with self.assertRaises(ValueError):
            national.parse_fukuoka_all(payload.replace(b'6147', b'61471'), DAY)

    def test_failed_source_preserves_last_good_catalogue_and_invalid_future_cache_falls_back(self):
        before = national.read_supplement()
        session = Mock()
        session.get.side_effect = requests.Timeout('upstream failed')
        self.assertEqual(national.refresh_supplement(before, session=session, today=DAY), before)
        bad = deepcopy(before)
        bad['sources']['sapporo']['as_of'] = '2099-01-01'
        with tempfile.TemporaryDirectory() as temporary:
            cache = Path(temporary) / 'national.json'
            cache.write_text(json.dumps(bad))
            self.assertEqual(national.read_supplement(runtime_path=cache), before)

    def test_older_runtime_ui_label_or_future_transfer_cannot_replace_verified_seed(self):
        before = national.read_supplement()
        bad = deepcopy(before)
        bad['sources']['tokyo_new']['items'][0]['name'] += ' 代表者インタビュー'
        bad['sources']['tokyo_transfers']['items'][0]['changed_on'] = '2026-10-20'
        with tempfile.TemporaryDirectory() as temporary:
            cache = Path(temporary) / 'national.json'
            cache.write_text(json.dumps(bad))
            after = national.read_supplement(runtime_path=cache)
        self.assertEqual(after['sources']['tokyo_new'], before['sources']['tokyo_new'])
        self.assertEqual(after['sources']['tokyo_transfers'], before['sources']['tokyo_transfers'])

    def test_changed_or_truncated_transfer_page_retains_last_good_market_source(self):
        before = national.read_supplement()
        good = ('2026/10/07', '（株）メドレックス', '4586', 'スタンダード', 'グロース')
        for payload in (transfer_table([good]).removesuffix(b'</table>'),
                        transfer_table([good]).replace('以前の市場区分'.encode(), '変更理由'.encode())):
            def download(url, session):
                if url == national.SOURCES['tokyo_transfers']:
                    return payload
                raise requests.Timeout('no response')
            with patch.object(national, '_download', side_effect=download):
                after = national.refresh_supplement(before, today=DAY)
            self.assertEqual(after, before)

    def test_partial_runtime_corruption_keeps_other_verified_exchange_update(self):
        before = national.read_supplement()
        mixed = deepcopy(before)
        mixed['sources']['sapporo']['items'][0]['name'] = 'Verified updated name'
        mixed['sources']['fukuoka']['source_url'] = 'https://unapproved.test/'
        with tempfile.TemporaryDirectory() as temporary:
            cache = Path(temporary) / 'national.json'
            cache.write_text(json.dumps(mixed))
            restored = national.read_supplement(runtime_path=cache)
        self.assertEqual(restored['sources']['sapporo']['items'][0]['name'], 'Verified updated name')
        self.assertEqual(restored['sources']['fukuoka'], before['sources']['fukuoka'])

    def test_monthly_refresh_failure_does_not_block_a_valid_daily_identity_update(self):
        search = StockSearch(runtime_path=None, session=Mock())
        monthly = deepcopy(search.catalogue)
        updated = deepcopy(search.supplement)
        row = next(row for row in updated['sources']['tokyo_new']['items'] if row['code'] == '640A')
        row['name'] = 'Verified new name'
        with patch.object(stock_search, 'download_catalogue', side_effect=requests.Timeout('monthly failed')):
            with patch.object(stock_search, 'refresh_supplement', return_value=updated):
                self.assertTrue(search.refresh())
        self.assertEqual(search.company('640A')['name'], 'Verified new name')
        self.assertEqual(search.catalogue, monthly)
        search.session.get.assert_not_called()

    def test_failed_one_exchange_download_does_not_erase_other_exchange(self):
        before = national.read_supplement()
        rows = deepcopy(before['sources']['nagoya']['items'])
        rows[0]['name'] = 'Updated Nagoya identity'
        def download(url, session):
            if url == national.SOURCES['nagoya']:
                return b'fixed public response'
            raise requests.Timeout('no response')
        with patch.object(national, '_download', side_effect=download):
            with patch.dict(national.PARSERS, {'nagoya': lambda payload, observed: rows}):
                result = national.refresh_supplement(before, today=DAY)
        self.assertEqual(result['sources']['nagoya']['items'][0]['name'], 'Updated Nagoya identity')
        for key in ('sapporo', 'fukuoka', 'tokyo_new', 'tokyo_delisted'):
            self.assertEqual(result['sources'][key], before['sources'][key])

    def test_only_preapproved_public_urls_can_be_fetched(self):
        session = Mock()
        for url in ('https://evil.test/', 'http://www.jpx.co.jp/listing/stocks/new/index.html',
                    national.SOURCES['sapporo'] + '?token=secret'):
            with self.assertRaises(ValueError):
                national._download(url, session)
        session.get.assert_not_called()


if __name__ == '__main__':
    unittest.main()
