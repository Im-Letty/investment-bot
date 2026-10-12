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
from company_reviewed_business import CompanyReviewedBusinesses, USE_BASIS, report_name_key, validate_summary

NOW = datetime(2026, 10, 13, 1, tzinfo=timezone.utc).timestamp()
COMPANY = dict(symbol='1382.T', code='1382', name='ホクリヨウ', exchange='Tokyo')


def row():
    return dict(symbol='1382.T', identity=official_identity('1382.T', COMPANY),
                source_kind='public_annual_report', use_basis=USE_BASIS,
                proof=dict(code='1382', corporate_number='2430001028862', current_corporate_number='2430001028862',
                           edinet_code='E31220', current_edinet_code='E31220', source_company_name='株式会社ホクリヨウ',
                           filing_company_name='株式会社ホクリヨウ', official_code_match=True,
                           current_company_name_match=True, doc_id='S100YK1Y'),
                text='鶏卵を生産して販売する会社です。',
                source_url='https://info.gbiz.go.jp/hojin/edinetDownload?docId=S100YK1Y',
                filed_on='2026-06-26', checked_on='2026-10-13', fetched_at=NOW-3600, pdf_sha256='a'*64)


class ReviewedBusinesses(unittest.TestCase):
    def test_only_typographic_hyphens_match_without_dropping_words_or_long_vowels(self):
        self.assertEqual(report_name_key('株式会社Ｇ−ＦＡＣＴＯＲＹ'), report_name_key('Ｇ－ＦＡＣＴＯＲＹ'))
        self.assertEqual(report_name_key('Aoba‐BBT'), report_name_key('Aoba-BBT'))
        self.assertNotEqual(report_name_key('Aoba-BBTサービス'), report_name_key('Aoba-BBT'))
        self.assertNotEqual(report_name_key('ニットー'), report_name_key('ニット-'))
    def test_only_authored_summary_and_public_provenance_are_exposed(self):
        raw = row(); raw['business_section'] = 'long copied report section'; raw['evidence_path'] = '/private/research.pdf'
        clean = validate_summary(raw, COMPANY, now=NOW)
        self.assertEqual(clean['text'], raw['text'])
        self.assertEqual(clean['source_published_on'], '2026-06-26')
        self.assertEqual(clean['kind'], 'reviewed_company_business')
        self.assertNotIn('license', clean)
        self.assertNotIn('copied', json.dumps(clean))
        self.assertNotIn('/private', json.dumps(clean))

    def test_parent_child_stale_name_and_wrong_corporate_or_code_proofs_fail(self):
        for changes in ({'code': '1383'}, {'source_company_name': 'ホクリヨウ販売'},
                        {'filing_company_name': '旧社名'}, {'current_edinet_code': 'E00001'},
                        {'current_corporate_number': '1430001028862'}, {'official_code_match': False},
                        {'doc_id': 'S100BAD1'}):
            bad = row(); bad['proof'].update(changes)
            self.assertIsNone(validate_summary(bad, COMPANY, now=NOW))
        self.assertIsNone(validate_summary(row(), {**COMPANY, 'name': '別会社'}, now=NOW))

    def test_credential_urls_wrong_dates_and_raw_source_kinds_cannot_publish(self):
        for changes in ({'source_url': row()['source_url']+'&token=secret'},
                        {'source_url': 'https://api.edinet-fsa.go.jp/api/v2/documents/S100YK1Y?type=2'},
                        {'fetched_at': NOW+1}, {'filed_on': '2026-10-14'}, {'checked_on': '2026-10-14'},
                        {'source_kind': 'raw_report_prose'}, {'pdf_sha256': 'not-a-hash'}, {'text': '日本の会社'}):
            bad = row(); bad.update(changes)
            self.assertIsNone(validate_summary(bad, COMPANY, now=NOW))

    def test_duplicate_records_fail_closed_and_editorial_still_has_priority(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'seed.json'; path.write_text(json.dumps({'schema_version': 1, 'items': [row(), row()]}))
            self.assertIsNone(CompanyReviewedBusinesses(path, now=lambda: NOW).get('1382.T', COMPANY))
            path.write_text(json.dumps({'schema_version': 1, 'items': [row()]}))
            service = CompanyReviewedBusinesses(path, now=lambda: NOW)
            for editorial in ({}, {'1382.T': {'business': '既存の詳しい説明'}}):
                app = Flask(__name__); catalogue, profiles, dividends, businesses = Mock(), Mock(), Mock(), Mock()
                catalogue.company.return_value = deepcopy(COMPANY)
                profiles.get.return_value = {'status': 'ready', 'data': {'currency': 'JPY'}}
                dividends.lookup.return_value = {}
                register_company_profiles(app, profiles, catalogue, dividends, editorial,
                                          businesses=businesses, reviewed_businesses=service)
                result = app.test_client().get('/api/company-profile?symbol=1382.T').get_json()
                if editorial:
                    self.assertNotIn('business_overview', result)
                else:
                    self.assertEqual(result['business_overview']['text'], row()['text'])
                    self.assertNotIn('proof', result['business_overview'])
                businesses.get.assert_not_called()


if __name__ == '__main__':
    unittest.main()
