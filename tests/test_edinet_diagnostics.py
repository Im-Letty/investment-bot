import unittest
import json
import requests
from unittest.mock import Mock
from regional_edinet import EdinetAnnualDividends, safe_edinet_diagnostic
from company_profile_api import read_editorial, annual_dividend_result
from tests.test_regional_edinet import Response, NOW, IDENTITY, COMPANY, DESCRIPTOR

class DiagnosticsTests(unittest.TestCase):
    def provider(self, response=None, error=None):
        session=Mock(); session.__enter__=Mock(return_value=session); session.__exit__=Mock(return_value=False)
        if error: session.get.side_effect=error
        else: session.get.return_value=response
        return EdinetAnnualDividends('fixture-private',identities=(IDENTITY,),session_factory=lambda:session,clock=lambda:NOW)
    def test_http_failure_reports_only_fixed_status_and_phase(self):
        p=self.provider(Response(b'private Subscription-Key=secret',status=503))
        self.assertEqual(p.fetch(COMPANY,DESCRIPTOR)['status'],'fetch_error')
        self.assertEqual(p.last_diagnostic,{'phase':'filing','reason':'http_error','http_status':503})
        self.assertNotIn('private',json.dumps(p.last_diagnostic))
    def test_timeout_does_not_expose_credential_bearing_exception(self):
        p=self.provider(error=requests.Timeout('Subscription-Key=private'))
        p.fetch(COMPANY,DESCRIPTOR)
        self.assertEqual(p.last_diagnostic,{'phase':'filing','reason':'network_timeout'})
    def test_untrusted_diagnostics_cannot_expose_url_or_raw_messages(self):
        self.assertIsNone(safe_edinet_diagnostic({'phase':'filing','reason':'https://private'}))
        self.assertEqual(safe_edinet_diagnostic({'phase':'daily_index','reason':'api_status','api_status':404,'url':'private','message':'private'}),{'phase':'daily_index','reason':'api_status','api_status':404})
    def test_profile_api_keeps_only_fixed_diagnostic(self):
        result=annual_dividend_result({'configured':True,'status':'fetch_error','diagnostic':{'phase':'daily_index','reason':'http_error','http_status':503,'body':'private'}},COMPANY)
        self.assertEqual(result['diagnostic'],{'phase':'daily_index','reason':'http_error','http_status':503})
    def test_regional_editorial_is_loaded_with_primary_sources(self):
        rows=read_editorial()
        for symbol in ('1832.JP','2058.JP'):
            self.assertIn(symbol,rows)
            self.assertTrue(rows[symbol]['sources'])
