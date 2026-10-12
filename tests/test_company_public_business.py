from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

from flask import Flask
from company_business import official_identity
from company_profile_api import register_company_profiles
from company_public_business import (CompanyPublicBusinesses, USE_BASIS, SOURCE_URL,
                                    TERMS_URL, summary_excerpt, validate_record)
from scripts.refresh_public_business_seed import build_seed, verified_edinet_identities


NOW = datetime(2026, 10, 12, 14, 40, tzinfo=timezone.utc).timestamp()
COMPANY = dict(symbol='2408.T', code='2408', name='ＫＧ情報', exchange='Tokyo',
               market='スタンダード（内国株式）', industry='サービス業')
NUMBER = '8470001001397'


def edinet(**changes):
    row = {'証券コード': '24080', '上場区分': '上場', '提出者名': '株式会社ＫＧ情報',
           '提出者法人番号': NUMBER, 'ＥＤＩＮＥＴコード': 'E05416'}
    row.update(changes)
    return row


def workplace(**changes):
    row = {'法人番号': NUMBER, '企業名': '株式会社ＫＧ情報', '証券コード': '',
           '事業概要': '調査・情報サービス、有料職業紹介事業\n求人情報の提供',
           '更新日時': '2026-05-28 10:50:14',
           '電話': 'private-to-importer', '従業員数': '9999'}
    row.update(changes)
    return row


def seed(rows=None):
    identities = verified_edinet_identities([edinet()], {'2408': COMPANY})
    return build_seed(rows if rows is not None else [workplace()], identities,
                      source_day='2026-10-12', fetched_at=NOW, now=NOW,
                      summaries={'2408.T': '調査や求人の情報を提供し、職業紹介を行う会社です。'})


class PublicBusinesses(unittest.TestCase):
    def test_join_requires_current_code_name_and_unique_corporate_number(self):
        for row in (edinet(提出者名='ＫＧ情報サービス株式会社'), edinet(証券コード='24090'),
                    edinet(上場区分='非上場'), edinet(提出者法人番号='bad')):
            self.assertEqual(verified_edinet_identities([row], {'2408': COMPANY}), {})
        self.assertEqual(verified_edinet_identities([edinet(), edinet()], {'2408': COMPANY}), {})
        self.assertEqual(verified_edinet_identities([edinet(), edinet(提出者法人番号='9470001001397')], {'2408': COMPANY}), {})
        self.assertEqual(len(verified_edinet_identities([edinet()], {'2408': COMPANY})), 1)

    def test_parent_child_name_and_foreign_code_mismatches_do_not_enter_seed(self):
        for row in (workplace(企業名='ＫＧ情報サービス株式会社'), workplace(証券コード='9999'),
                    workplace(法人番号='9470001001397'), workplace(事業概要='未記入')):
            self.assertEqual(seed([row])['items'], [])
        self.assertEqual(seed([workplace(), workplace()])['items'], [])

    def test_record_preserves_source_license_identity_and_excludes_contact_workforce(self):
        row = seed()['items'][0]
        self.assertEqual(row['identity'], official_identity('2408.T', COMPANY))
        self.assertEqual(row['text'], '調査や求人の情報を提供し、職業紹介を行う会社です。')
        self.assertEqual(row['proof']['edinet_corporate_number'], NUMBER)
        self.assertEqual(row['use_basis'], USE_BASIS)
        self.assertNotIn('license', row)
        self.assertEqual(row['source_record_updated_on'], '2026-05-28')
        self.assertEqual(row['source_updated_on'], '2026-10-12')
        self.assertNotIn('private-to-importer', json.dumps(row))
        self.assertNotIn('従業員数', row)

    def test_wrong_market_renamed_company_and_invalid_source_fail_at_read(self):
        row = seed()['items'][0]
        self.assertIsNotNone(validate_record(row, COMPANY, now=NOW))
        changed = dict(COMPANY, exchange='Nagoya', symbol='2408.JP')
        self.assertIsNone(validate_record(row, changed, now=NOW))
        self.assertIsNone(validate_record(row, dict(COMPANY, name='別会社'), now=NOW))
        for patch in ({'source_url': 'https://example.com/'}, {'use_basis': 'unreviewed_original'},
                      {'source_updated_on': '2026-10-13'}, {'fetched_at': NOW + 1}):
            self.assertIsNone(validate_record({**row, **patch}, COMPANY, now=NOW))
        bad = deepcopy(row); bad['proof']['edinet_corporate_number'] = '0000000000000'
        self.assertIsNone(validate_record(bad, COMPANY, now=NOW))

    def test_loading_excludes_ambiguous_duplicates_without_removing_other_companies(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'seed.json'; data = seed(); data['items'] *= 2
            path.write_text(json.dumps(data)); service = CompanyPublicBusinesses(path, now=lambda: NOW)
            self.assertIsNone(service.get('2408.T', COMPANY))

    def test_excerpt_is_a_labelled_excerpt_and_does_not_turn_missing_into_prose(self):
        self.assertIsNone(summary_excerpt('その他'))
        self.assertIsNone(summary_excerpt(''))
        text = '情報サービスを提供します。' * 100
        excerpt = summary_excerpt(text)
        self.assertLessEqual(len(excerpt), 1000)
        self.assertTrue(excerpt.endswith('…'))
        self.assertTrue(text.startswith(excerpt[:-1]))

    def test_raw_download_is_not_automatically_republished_as_a_licensed_description(self):
        identities = verified_edinet_identities([edinet()], {'2408': COMPANY})
        result = build_seed([workplace()], identities, source_day='2026-10-12', fetched_at=NOW)
        self.assertEqual(result['items'], [])
        self.assertEqual(result['statistics']['independent_summary_not_provided'], 1)

    def test_api_uses_saved_public_summary_without_wikidata_request_and_keeps_editorial_priority(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'seed.json'; path.write_text(json.dumps(seed()))
            public = CompanyPublicBusinesses(path, now=lambda: NOW)
            for editorial in ({}, {'2408.T': {'business': '編集済みの紹介'}}):
                app = Flask(__name__); profiles, catalogue, dividends, businesses = Mock(), Mock(), Mock(), Mock()
                profiles.get.return_value = {'status': 'ready', 'data': {'currency': 'JPY'}}
                catalogue.company.return_value = COMPANY; dividends.lookup.return_value = {}
                register_company_profiles(app, profiles, catalogue, dividends, editorial,
                                          businesses=businesses, public_businesses=public)
                body = app.test_client().get('/api/company-profile?symbol=2408').get_json()
                if editorial:
                    self.assertEqual(body['editorial']['business'], '編集済みの紹介')
                    self.assertNotIn('business_overview', body)
                else:
                    self.assertEqual(body['business_overview']['kind'], 'public_company_business')
                    self.assertEqual(body['business_overview']['source_url'], SOURCE_URL)
                    self.assertEqual(body['business_overview']['field_status'], 'available')
                    self.assertNotIn('proof', body['business_overview'])
                businesses.get.assert_not_called()


if __name__ == '__main__':
    unittest.main()
