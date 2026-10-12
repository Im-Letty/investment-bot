"""Reviewed PER imports cannot erase good published facts or export raw research."""
from copy import deepcopy
from datetime import datetime, timezone, timedelta
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from company_business import official_identity
from company_year_per import validate_year_per
from scripts.refresh_year_per_seed import refresh_seed, compile_reviews, read_document

NOW = datetime(2026, 10, 13, 3, tzinfo=timezone(timedelta(hours=9))).timestamp()
COMPANY = dict(symbol='1407.T', code='1407', name='ウエストホールディングス', exchange='Tokyo')


def row():
    return dict(symbol=COMPANY['symbol'], identity=official_identity(COMPANY['symbol'], COMPANY),
                kind='issuer_reported_fiscal_per', value=12.5, status='available', reason=None,
                unit='times', use_basis='independent_extraction_of_numeric_facts',
                basis='consolidated', accounting_standard='JGAAP',
                fiscal_period={'start': '2024-09-01', 'end': '2025-08-31'},
                price_basis='not_stated', price_reference_date=None,
                source_url='https://info.gbiz.go.jp/hojin/edinetDownload?docId=S100X68L',
                filed_on='2025-11-25', checked_on='2026-10-13', fetched_at=NOW-1000,
                pdf_sha256='a'*64, latest_filing_guaranteed=False,
                proof=dict(code=COMPANY['code'], source_company_name=COMPANY['name'],
                           filing_company_name=COMPANY['name'], official_code_match=True,
                           current_company_name_match=True, edinet_code='E00327',
                           current_edinet_code='E00327', corporate_number='9240001016913',
                           current_corporate_number='9240001016913', doc_id='S100X68L',
                           reviewed=True, review_method='strict_table_validation',
                           fiscal_period_verified=True, accounting_standard_verified=True,
                           ratio_row_verified=True, annual_report_verified=True, eps_row_verified=True,
                           source_eps_label='1株当たり当期純利益', source_page=2, basis='consolidated',
                           accounting_standard='JGAAP', latest_column_end='2025-08-31',
                           price_basis_evidence_kind='not_stated', source_ratio_text='12.50',
                           source_eps_text='135.09'))


def document(*rows):
    return {'schema_version': 1, 'items': list(rows)}


class RefreshReviewedPer(unittest.TestCase):
    def setUp(self):
        self.catalogue = Mock()
        self.catalogue.company.side_effect = lambda code: deepcopy(COMPANY) if code == '1407' else None

    def test_only_small_validator_proof_is_exported_and_original_dates_and_fraction_survive(self):
        reviewed = row()
        reviewed.update(raw_pdf_text='PRIVATE FULL CHAPTER', local_pdf_path='/private/contact', contact='private@example.test')
        reviewed['proof'].update(raw_table='PRIVATE FULL TABLE', source_eps_value=135.09, review_notes='PRIVATE REVIEW', source_table_columns=['PRIVATE'])
        compiled, report = compile_reviews([document(reviewed)], self.catalogue, now=NOW)
        output = compiled['items'][0]
        self.assertIsNotNone(validate_year_per(output, COMPANY, now=NOW))
        self.assertEqual(output['value'], 12.5)
        self.assertEqual(output['fetched_at'], NOW-1000)
        self.assertEqual(output['checked_on'], '2026-10-13')
        self.assertEqual(output['proof']['source_ratio_text'], '12.50')
        self.assertNotIn('PRIVATE', json.dumps(compiled))
        self.assertNotIn('local_pdf_path', output)
        self.assertEqual(report['source_requests'], 0)

    def test_malformed_duplicate_or_invalid_review_never_replaces_existing_file(self):
        invalid = row()
        invalid['proof']['annual_report_verified'] = False
        wrong_eps = row()
        wrong_eps['proof']['source_eps_label'] = '1株当たり純資産額'
        cases = [document(invalid), document(wrong_eps), document(row(), row()), {'schema_version': True, 'items': [row()]}, document()]
        with tempfile.TemporaryDirectory() as tmp:
            target, incoming = Path(tmp)/'seed.json', Path(tmp)/'review.json'
            original = json.dumps(document(row()), ensure_ascii=False).encode('utf-8')
            target.write_bytes(original)
            for candidate in cases:
                incoming.write_text(json.dumps(candidate, ensure_ascii=False), encoding='utf-8')
                with self.assertRaises(ValueError):
                    refresh_seed([incoming], target, merge_existing=True, catalogue=self.catalogue, now=NOW)
                self.assertEqual(target.read_bytes(), original)
            incoming.write_text('{"schema_version":1,"items":[],"items":[]}', encoding='utf-8')
            with self.assertRaises(ValueError):
                refresh_seed([incoming], target, merge_existing=True, catalogue=self.catalogue, now=NOW)
            self.assertEqual(target.read_bytes(), original)

    def test_duplicates_across_separate_reviews_are_rejected_before_any_write(self):
        with self.assertRaises(ValueError):
            compile_reviews([document(row()), document(row())], self.catalogue, now=NOW)

    def test_old_fiscal_year_is_retained_even_when_the_old_report_was_fetched_more_recently(self):
        older = row()
        older.update(fiscal_period={'start': '2023-09-01', 'end': '2024-08-31'}, filed_on='2024-11-25', fetched_at=NOW-1, value=1,
                     source_url='https://info.gbiz.go.jp/hojin/edinetDownload?docId=S100OLD1')
        older['proof'].update(doc_id='S100OLD1', latest_column_end='2024-08-31', source_ratio_text='1.0')
        with tempfile.TemporaryDirectory() as tmp:
            target, incoming = Path(tmp)/'seed.json', Path(tmp)/'review.json'
            original = json.dumps(document(row()), ensure_ascii=False).encode('utf-8')
            target.write_bytes(original)
            incoming.write_text(json.dumps(document(older), ensure_ascii=False), encoding='utf-8')
            report = refresh_seed([incoming], target, merge_existing=True, catalogue=self.catalogue, now=NOW)
            self.assertFalse(report['output_changed'])
            self.assertEqual(target.read_bytes(), original)
            self.assertEqual(report['retained_same_or_newer'], 1)

    def test_new_fiscal_year_or_later_submitted_filing_wins_over_old_cached_facts(self):
        newer = row()
        newer.update(fiscal_period={'start': '2025-09-01', 'end': '2026-08-31'}, filed_on='2026-10-01', value=20,
                     source_url='https://info.gbiz.go.jp/hojin/edinetDownload?docId=S100NEW1')
        newer['proof'].update(doc_id='S100NEW1', latest_column_end='2026-08-31', source_ratio_text='20.0')
        compiled, report = compile_reviews([document(newer)], self.catalogue, existing=document(row()), now=NOW)
        self.assertEqual(compiled['items'][0]['fiscal_period']['end'], '2026-08-31')
        self.assertEqual(compiled['items'][0]['value'], 20)
        self.assertEqual(report['accepted_new_or_updated'], 1)
        correction = row()
        correction.update(filed_on='2025-11-26', value=15,
                          source_url='https://info.gbiz.go.jp/hojin/edinetDownload?docId=S100FIX1')
        correction['proof'].update(doc_id='S100FIX1', source_ratio_text='15.0')
        compiled, _ = compile_reviews([document(correction)], self.catalogue, existing=document(row()), now=NOW)
        self.assertEqual(compiled['items'][0]['value'], 15)

    def test_same_document_correction_requires_actual_renewed_check_or_fetch(self):
        correction = row()
        correction['value'] = 15
        correction['proof']['source_ratio_text'] = '15.0'
        with self.assertRaises(ValueError):
            compile_reviews([document(correction)], self.catalogue, existing=document(row()), now=NOW)
        correction['fetched_at'] = NOW-500
        compiled, _ = compile_reviews([document(correction)], self.catalogue, existing=document(row()), now=NOW)
        self.assertEqual(compiled['items'][0]['value'], 15)
        self.assertEqual(compiled['items'][0]['fetched_at'], NOW-500)
        stale = deepcopy(correction)
        stale['value'] = 1
        stale['proof']['source_ratio_text'] = '1.0'
        stale['fetched_at'] = NOW-1000
        kept, _ = compile_reviews([document(stale)], self.catalogue, existing=compiled, now=NOW)
        self.assertEqual(kept['items'][0]['value'], 15)

    def test_atomic_replace_failure_preserves_original_and_cleans_temporary_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            target, incoming = Path(tmp)/'seed.json', Path(tmp)/'review.json'
            original = json.dumps(document(row()), ensure_ascii=False).encode('utf-8')
            target.write_bytes(original)
            newer = row()
            newer['fetched_at'] = NOW-500
            incoming.write_text(json.dumps(document(newer), ensure_ascii=False), encoding='utf-8')
            with patch('scripts.refresh_year_per_seed.os.replace', side_effect=OSError('replace refused')):
                with self.assertRaises(OSError):
                    refresh_seed([incoming], target, merge_existing=True, catalogue=self.catalogue, now=NOW)
            self.assertEqual(target.read_bytes(), original)
            self.assertEqual(list(Path(tmp).glob('.year-per-seed-*.tmp')), [])

    def test_compiler_uses_offline_catalogue_without_worker_or_network_requests(self):
        with tempfile.TemporaryDirectory() as tmp:
            incoming, target = Path(tmp)/'review.json', Path(tmp)/'new-seed.json'
            incoming.write_text(json.dumps(document(row()), ensure_ascii=False), encoding='utf-8')
            with patch('scripts.refresh_year_per_seed.StockSearch', return_value=self.catalogue) as constructor, patch('requests.Session.request', side_effect=AssertionError('network forbidden')):
                report = refresh_seed([incoming], target, now=NOW)
            constructor.assert_called_once_with(runtime_path=None)
            self.assertEqual(report['seed_items'], 1)
            self.assertEqual(json.loads(target.read_text())['items'][0]['fetched_at'], NOW-1000)
            self.catalogue.ensure_refresh_worker.assert_not_called()
            self.catalogue.refresh.assert_not_called()

    def test_nonfinite_json_numbers_and_overlong_proof_labels_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'review.json'
            path.write_text('{"schema_version":1,"items":[{"value":NaN}]}', encoding='utf-8')
            with self.assertRaises(ValueError):
                read_document(path)
        reviewed = row()
        reviewed['proof']['source_eps_label'] = '1株当たり当期純利益'+'原資料'*100
        with self.assertRaises(ValueError):
            compile_reviews([document(reviewed)], self.catalogue, now=NOW)


if __name__ == '__main__':
    unittest.main()
