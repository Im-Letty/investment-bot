"""Disclosure PER is not a price/EPS calculation or a live-provider value."""
from copy import deepcopy
from datetime import datetime, timezone, timedelta
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from company_business import official_identity
from company_year_per import CompanyYearPERs, enrich_search_per, validate_year_per, source_number

NOW = datetime(2026, 10, 13, 3, tzinfo=timezone(timedelta(hours=9))).timestamp()
COMPANY = dict(symbol='1407.T', code='1407', name='ウエストホールディングス', exchange='Tokyo')


def fixture(company=COMPANY):
    return dict(symbol=company['symbol'], identity=official_identity(company['symbol'], company),
                kind='issuer_reported_fiscal_per', value=12, status='available', reason=None,
                unit='times', use_basis='independent_extraction_of_numeric_facts',
                basis='consolidated', accounting_standard='JGAAP',
                fiscal_period={'start': '2024-09-01', 'end': '2025-08-31'},
                price_basis='not_stated', price_reference_date=None,
                source_url='https://info.gbiz.go.jp/hojin/edinetDownload?docId=S100X68L',
                filed_on='2025-11-25', checked_on='2026-10-13', fetched_at=NOW-1000,
                pdf_sha256='a'*64, latest_filing_guaranteed=False,
                proof=dict(code=company['code'], source_company_name=company['name'],
                           filing_company_name=company['name'], official_code_match=True,
                           current_company_name_match=True, edinet_code='E00327',
                           current_edinet_code='E00327', corporate_number='9240001016913',
                           current_corporate_number='9240001016913', doc_id='S100X68L',
                           reviewed=True, review_method='strict_table_validation',
                           fiscal_period_verified=True, accounting_standard_verified=True,
                           ratio_row_verified=True, annual_report_verified=True, eps_row_verified=True,
                           source_eps_label='1株当たり当期純利益', source_page=2, basis='consolidated',
                           accounting_standard='JGAAP', latest_column_end='2025-08-31',
                           price_basis_evidence_kind='not_stated', source_ratio_text='12.0',
                           source_eps_text='135.09'))


class CompanyYearPer(unittest.TestCase):
    def test_reported_ratio_retains_annual_scope_and_unknown_price_date(self):
        fact=validate_year_per(fixture(), COMPANY, now=NOW)
        self.assertEqual(fact['value'], 12)
        self.assertEqual(fact['fiscal_period']['end'], '2025-08-31')
        self.assertEqual(fact['price_basis'], 'not_stated')
        self.assertIsNone(fact['price_reference_date'])
        self.assertFalse(fact['latest_filing_guaranteed'])
        self.assertNotIn('price',fact); self.assertNotIn('forecast_eps',fact)

    def test_explicit_period_end_definition_requires_its_own_evidence(self):
        row=fixture();row.update(price_basis='period_end_explicit',price_reference_date='2025-08-31')
        self.assertIsNone(validate_year_per(row,COMPANY,now=NOW))
        row['proof']['price_basis_evidence_kind']='report_note'
        self.assertEqual(validate_year_per(row,COMPANY,now=NOW)['price_reference_date'],'2025-08-31')
        row['price_reference_date']='2026-10-13'
        self.assertIsNone(validate_year_per(row,COMPANY,now=NOW))

    def test_source_numbers_reject_false_zero_nonfinite_negative_and_malformed_commas(self):
        for value in [0, -1, True, float('inf'), float('nan'), '12', 12.000000001]:
            row=fixture();row['value']=value
            self.assertIsNone(validate_year_per(row,COMPANY,now=NOW))
        for token in ['1,2','1,23,456','1e2','12<script>','12円','(12.0)','--']:
            self.assertIsNone(source_number(token))
        self.assertEqual(float(source_number('1,234.50')),1234.5)
        self.assertEqual(float(source_number('△3.25')),-3.25)
        row=fixture();row.update(value=12.345678);row['proof']['source_ratio_text']='12.345678'
        self.assertEqual(validate_year_per(row,COMPANY,now=NOW)['value'],12.345678)

    def test_same_period_positive_eps_must_be_known_and_match_value_token(self):
        row=fixture();row['proof']['source_eps_label']='1株当たり当期純損益金額'
        self.assertIsNotNone(validate_year_per(row,COMPANY,now=NOW))
        for token in ['0.00','-4.25',None,'unknown']:
            row=fixture();row['proof']['source_eps_text']=token
            self.assertIsNone(validate_year_per(row,COMPANY,now=NOW))
        row=fixture();row['proof']['source_ratio_text']='13'
        self.assertIsNone(validate_year_per(row,COMPANY,now=NOW))
        row=fixture();row['proof']['source_eps_label']='1株当たり親会社所有者帰属持分'
        self.assertIsNone(validate_year_per(row,COMPANY,now=NOW))
        row=fixture();row['proof']['annual_report_verified']=False
        self.assertIsNone(validate_year_per(row,COMPANY,now=NOW))

    def test_loss_or_omission_never_becomes_zero(self):
        row=fixture();row.update(status='not_presented',value=None,reason='loss_eps')
        row['proof'].update(source_ratio_text='—',source_eps_text='△12.3',not_presented_verified=True,loss_eps_verified=True)
        row['proof']['source_eps_label']='1株当たり当期純損益'
        fact=validate_year_per(row,COMPANY,now=NOW);self.assertIsNone(fact['value']);self.assertEqual(fact['reason'],'loss_eps')
        row['proof']['source_ratio_text']='-2.5';self.assertIsNotNone(validate_year_per(row,COMPANY,now=NOW))
        row['proof']['source_ratio_text']='12';self.assertIsNone(validate_year_per(row,COMPANY,now=NOW))
        row['reason']='ratio_not_disclosed';row['proof']['source_ratio_text']='—';self.assertIsNotNone(validate_year_per(row,COMPANY,now=NOW))
        for token in [None,'no data','1,2','0']:
            row['proof']['source_ratio_text']=token;self.assertIsNone(validate_year_per(row,COMPANY,now=NOW))

    def test_standalone_cannot_replace_a_consolidated_or_unspecified_table(self):
        row=fixture();row['basis']=row['proof']['basis']='standalone'
        self.assertIsNone(validate_year_per(row,COMPANY,now=NOW))
        row['proof']['standalone_scope_verified']=True
        self.assertIsNotNone(validate_year_per(row,COMPANY,now=NOW))
        row['accounting_standard']='IFRS'
        self.assertIsNone(validate_year_per(row,COMPANY,now=NOW))

    def test_identity_document_period_and_actual_acquisition_are_bound(self):
        for changes in [dict(source_url=fixture()['source_url']+'&token=secret'),dict(source_url='https://example.org/report.pdf'),dict(pdf_sha256='bad'),dict(fetched_at=NOW+1),dict(filed_on='2025-08-30'),dict(checked_on='2026-10-14'),dict(fiscal_period={'start':'2025-08-31','end':'2025-08-31'})]:
            row=fixture();row.update(changes);self.assertIsNone(validate_year_per(row,COMPANY,now=NOW))
        for field,value in [('current_corporate_number','9240001016914'),('current_company_name_match',False),('filing_company_name','別会社'),('latest_column_end','2024-08-31'),('reviewed',False),('ratio_row_verified',False)]:
            row=fixture();row['proof'][field]=value;self.assertIsNone(validate_year_per(row,COMPANY,now=NOW))

    def test_regional_identity_does_not_borrow_a_tokyo_ratio(self):
        regional=dict(symbol='1869.JP',code='1869',name='名工建設',exchange='Nagoya')
        row=fixture(regional)
        self.assertEqual(validate_year_per(row,regional,now=NOW)['exchange'],'Nagoya')
        self.assertIsNone(validate_year_per(row,COMPANY,now=NOW))

    def test_seed_duplicates_fail_closed_and_never_use_network(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'seed.json';row=fixture()
            with patch('requests.Session',side_effect=AssertionError('network')):
                p.write_text(json.dumps(dict(schema_version=1,items=[row])));service=CompanyYearPERs(p,now=lambda:NOW)
                self.assertEqual(service.get('1407.T',COMPANY)['value'],12)
                p.write_text(json.dumps(dict(schema_version=1,items=[row,row])));service=CompanyYearPERs(p,now=lambda:NOW)
                self.assertIsNone(service.get('1407.T',COMPANY))
                self.assertIsNone(CompanyYearPERs(Path(tmp)/'missing').get('1407.T',COMPANY))

    def test_search_joins_cached_facts_in_the_single_response_without_mutating_catalogue(self):
        catalogue=Mock();catalogue.company.return_value=COMPANY
        service=Mock();service.get.return_value=validate_year_per(fixture(),COMPANY,now=NOW)
        original={'results':[dict(symbol='1407.T',name=COMPANY['name'],verified=True)],'catalogue_as_of':'2026-09-30'}
        with patch('requests.Session',side_effect=AssertionError('network')):
            enriched=enrich_search_per(original,catalogue,service)
        self.assertEqual(enriched['results'][0]['year_per']['value'],12)
        self.assertNotIn('year_per',original['results'][0]);self.assertEqual(enriched['catalogue_as_of'],original['catalogue_as_of'])
        service.get.assert_called_once_with('1407.T',COMPANY)
        service.get.return_value=None
        self.assertEqual(enrich_search_per(original,catalogue,service)['results'][0]['year_per_status'],'unconfirmed')
        service.get.reset_mock();original['results'][0]['name']='別会社'
        self.assertNotIn('year_per',enrich_search_per(original,catalogue,service)['results'][0]);service.get.assert_not_called()

class YearPerApi(unittest.TestCase):
    def app(self, fact, *, injected=True):
        from flask import Flask
        from company_profile_api import register_company_profiles
        app=Flask(__name__);catalogue=Mock();catalogue.company.return_value=COMPANY
        profile=Mock();profile.get.return_value={'symbol':'1407.T','name':COMPANY['name'],'status':'ready','refreshing':False,'data':{'currency':'JPY','issuer_reported_fiscal_per':99999},'year_per':{'value':99999},'source':{}}
        dividends=Mock();dividends.lookup.return_value={}
        years=Mock();years.get.return_value=fact
        register_company_profiles(app,profile,catalogue,dividends,editorial={},year_pers=years if injected else None)
        return app.test_client(),years

    def test_profile_fact_uses_same_saved_record_as_lookup_and_never_provider_per(self):
        fact=validate_year_per(fixture(),COMPANY,now=NOW);client,service=self.app(fact)
        for purpose in ['preview','detail']:
            response=client.get('/api/company-profile?symbol=1407.T&purpose='+purpose);body=response.get_json()
            self.assertEqual(response.status_code,200);self.assertEqual(body['year_per'],fact)
            self.assertEqual(body['data']['issuer_reported_fiscal_per'],12)
            self.assertIsNone(body['source']['fields']['issuer_reported_fiscal_per']['as_of'])
            self.assertEqual(body['source']['fields']['issuer_reported_fiscal_per']['fiscal_period_end'],'2025-08-31')
            self.assertIn(fact['source_url'],[r['url'] for r in body['sources']])
        self.assertEqual(service.get.call_count,2)

    def test_unconfirmed_or_disabled_service_cannot_keep_untrusted_provider_value(self):
        client,service=self.app(None)
        body=client.get('/api/company-profile?symbol=1407.T').get_json()
        self.assertIsNone(body['year_per']);self.assertEqual(body['year_per_status'],'unconfirmed')
        self.assertNotIn('issuer_reported_fiscal_per',body['data'])
        client,service=self.app(None,injected=False)
        body=client.get('/api/company-profile?symbol=1407.T').get_json()
        self.assertNotIn('year_per',body);self.assertNotIn('issuer_reported_fiscal_per',body['data'])

    def test_current_only_request_skips_annual_read_and_preserves_default_api_fact(self):
        fact=validate_year_per(fixture(),COMPANY,now=NOW);client,service=self.app(fact)
        for purpose in ['preview','detail']:
            body=client.get('/api/company-profile?symbol=1407.T&purpose='+purpose+'&per=current').get_json()
            self.assertIsNone(body['data']['current_per']);self.assertEqual(body['field_status']['current_per'],'unconfirmed')
            self.assertNotIn('year_per',body);self.assertNotIn('year_per_status',body)
            self.assertNotIn('issuer_reported_fiscal_per',body['data']);self.assertNotIn('issuer_reported_fiscal_per',body['source']['fields'])
            self.assertNotIn(fact['source_url'],[row['url'] for row in body['sources']])
        service.get.assert_not_called()
        original=client.get('/api/company-profile?symbol=1407.T').get_json()
        self.assertEqual(original['year_per'],fact);self.assertEqual(original['data']['issuer_reported_fiscal_per'],12)
        service.get.assert_called_once_with('1407.T',COMPANY)

if __name__=='__main__':unittest.main()
