"""Candidate supplement uses official-format fixtures, never live credentials."""
from copy import deepcopy
from datetime import datetime, timezone
from io import BytesIO
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock
from zipfile import ZipFile, ZIP_DEFLATED

import requests

import regional_edinet as module
from regional_edinet import (EdinetAnnualDividends, EdinetIdentity, match_identity,
                             parse_annual_dividend, parse_annual_zip, parse_edinet_code_list)

NOW = datetime(2026, 10, 11, 12, tzinfo=timezone.utc).timestamp()
IDENTITY = EdinetIdentity('6147', 'E01507', '株式会社ヤマザキ', '61470',
                          '9080401005540', '2026-10-11')
COMPANY = dict(code='6147', symbol='6147.JP', name='ヤマザキ', provider_symbol=None)
DESCRIPTOR = dict(docID='S100TEST', edinetCode='E01507', secCode='61470',
                  filerName='株式会社ヤマザキ', docTypeCode='120', periodStart='2025-04-01',
                  periodEnd='2026-03-31', submitDateTime='2026-06-26 09:00',
                  withdrawalStatus='0', docInfoEditStatus='0', disclosureStatus='0', legalStatus='1', xbrlFlag='1')


def xbrl(value='20.00', *, extra_facts='', scenario=True):
    member = ('<xbrli:scenario><xbrldi:explicitMember dimension="jppfs_cor:ConsolidatedOrNonConsolidatedAxis">'
              'jppfs_cor:NonConsolidatedMember</xbrldi:explicitMember></xbrli:scenario>') if scenario else ''
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance"
 xmlns:xbrldi="http://xbrl.org/2006/xbrldi" xmlns:iso4217="http://www.xbrl.org/2003/iso4217"
 xmlns:jpcrp_cor="http://disclosure.edinet-fsa.go.jp/taxonomy/jpcrp/2025-11-01/jpcrp_cor"
 xmlns:jpdei_cor="http://disclosure.edinet-fsa.go.jp/taxonomy/jpdei/2025-11-01/jpdei_cor"
 xmlns:jppfs_cor="http://disclosure.edinet-fsa.go.jp/taxonomy/jppfs/2025-11-01/jppfs_cor"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
 <xbrli:context id="CurrentYearDuration_NonConsolidatedMember"><xbrli:entity>
  <xbrli:identifier scheme="http://disclosure.edinet-fsa.go.jp">E01507-000</xbrli:identifier></xbrli:entity>
  <xbrli:period><xbrli:startDate>2025-04-01</xbrli:startDate><xbrli:endDate>2026-03-31</xbrli:endDate></xbrli:period>
  {member}</xbrli:context>
 <xbrli:unit id="JPYPerShares"><xbrli:divide><xbrli:unitNumerator><xbrli:measure>iso4217:JPY</xbrli:measure></xbrli:unitNumerator>
  <xbrli:unitDenominator><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unitDenominator></xbrli:divide></xbrli:unit>
 <jpdei_cor:EDINETCodeDEI>E01507</jpdei_cor:EDINETCodeDEI><jpdei_cor:SecurityCodeDEI>61470</jpdei_cor:SecurityCodeDEI>
 <jpdei_cor:FilerNameInJapaneseDEI>株式会社ヤマザキ</jpdei_cor:FilerNameInJapaneseDEI>
 <jpcrp_cor:DividendPaidPerShareSummaryOfBusinessResults contextRef="CurrentYearDuration_NonConsolidatedMember"
  unitRef="JPYPerShares" decimals="2">{value}</jpcrp_cor:DividendPaidPerShareSummaryOfBusinessResults>
 {extra_facts}</xbrli:xbrl>'''.encode()


def zipped(data=None, *, name='XBRL/PublicDoc/annual.xbrl', extras=None):
    output = BytesIO()
    with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
        archive.writestr(name, xbrl() if data is None else data)
        for file_name, payload in (extras or {}).items():
            archive.writestr(file_name, payload)
    return output.getvalue()


class Response:
    def __init__(self, body, status=200, content_type='application/octet-stream', headers=None):
        self.body, self.status_code = body, status
        self.headers = {'Content-Type': content_type, **(headers or {})}
        self.raw, self.parts = self, [body]
    def __enter__(self): return self
    def __exit__(self, *args): return None
    def read1(self, *args, **kwargs): return self.parts.pop(0) if self.parts else b''


class IdentityTests(unittest.TestCase):
    def code_list(self, rows='E01507,株式会社ヤマザキ,61470,9080401005540\n'):
        return ('ダウンロード実行日,2026年10月11日現在,件数,1件\n'
                'ＥＤＩＮＥＴコード,提出者名,証券コード,提出者法人番号\n' + rows).encode('cp932')

    def test_official_dated_csv_and_fixed_zip_fields(self):
        rows = parse_edinet_code_list(self.code_list())
        self.assertEqual(rows, (IDENTITY,))
        archive = zipped(self.code_list(), name='EdinetcodeDlInfo.csv')
        self.assertEqual(parse_edinet_code_list(archive), rows)
        self.assertEqual(match_identity(COMPANY, rows), IDENTITY)

    def test_name_code_and_local_exchange_all_required(self):
        for key, value in [('code', '7203'), ('name', '別会社'), ('symbol', '6147.T'),
                           ('provider_symbol', '6147.T'), ('corporate_number', '1234567890123')]:
            company = {**COMPANY, key: value}
            self.assertIsNone(match_identity(company, (IDENTITY,)))
        self.assertIsNone(match_identity(COMPANY, (IDENTITY, IDENTITY)))
        self.assertEqual(match_identity({**COMPANY, 'name': ' 株式会社　ヤマザキ '}, (IDENTITY,)), IDENTITY)

    def test_no_fuzzy_transliteration_or_old_name_guess(self):
        rows = (EdinetIdentity('1738', 'E00000', '株式会社ニットー', '17380', '', '2026-10-11'),)
        company = dict(code='1738', symbol='1738.JP', name='ＮＩＴＴＯＨ')
        self.assertIsNone(match_identity(company, rows))

    def test_officially_verified_spelling_requires_exact_corporation_and_date(self):
        identity = EdinetIdentity('1738', 'E05065', '株式会社ニットー', '17380',
                                   '1180001013107', '2026-10-12')
        company = dict(code='1738', symbol='1738.JP', name='ＮＩＴＴＯＨ', provider_symbol=None)
        self.assertEqual(match_identity(company, (identity,)), identity)
        for field, value in (('edinet_code', 'E00000'), ('corporate_number', '1234567890123'),
                             ('as_of', '2026-10-11'), ('name', '別会社')):
            changed = {**identity.__dict__, field: value}
            self.assertIsNone(match_identity(company, (EdinetIdentity(**changed),)))
        self.assertIsNone(match_identity({**company, 'name': 'NITOH'}, (identity,)))

    def test_actual_name_change_keeps_old_filing_name_on_same_verified_corporation(self):
        identity = EdinetIdentity('3055', 'E03003', '株式会社ＴＳＵＭＵＧＵ　ＨＯＬＤＩＮＧＳ',
                                   '30550', '2430001032501', '2026-10-12')
        company = dict(code='3055', symbol='3055.JP', name='ほくやく・竹山ホールディングス',
                       provider_symbol=None)
        self.assertEqual(match_identity(company, (identity,)), identity)
        row = {**DESCRIPTOR, 'edinetCode': identity.edinet_code, 'secCode': identity.security_code,
               'JCN': identity.corporate_number, 'filerName': '株式会社ほくやく・竹山ホールディングス'}
        payload = xbrl().replace(b'E01507', b'E03003').replace(b'61470', b'30550').replace(
                  '株式会社ヤマザキ'.encode(), '株式会社ほくやく・竹山ホールディングス'.encode())
        fact = parse_annual_dividend(payload, identity, row, NOW + 86400)
        self.assertIsNotNone(fact)
        self.assertEqual(fact['edinet_code'], 'E03003')
        self.assertEqual(fact['security_code'], '30550')
        # Even a verified historic name cannot override a different corporation.
        self.assertIsNone(parse_annual_dividend(payload, identity,
            {**row, 'JCN': '1234567890123'}, NOW + 86400))

    def test_ambiguous_malformed_and_oversize_code_lists_rejected(self):
        inputs = [b'not csv', self.code_list('E01507,ヤマザキ,61470,9080401005540\nE09999,ヤマザキ,61470,9080401005540\n'),
                  self.code_list().replace(b'E01507', b'E../07'), b'x' * (module.MAX_CODE_LIST_BYTES + 1),
                  zipped(self.code_list(), name='../EdinetcodeDlInfo.csv')]
        for payload in inputs:
            with self.subTest(payload=payload[:20]), self.assertRaises(ValueError):
                parse_edinet_code_list(payload)


class FilingHintTests(unittest.TestCase):
    def test_current_public_seed_has_only_date_and_identity_not_amount(self):
        observed = datetime(2026, 10, 12, 12, tzinfo=timezone.utc).timestamp()
        hints = module.load_filing_hints(identities=module.load_identity_seed(observed_at=observed),
                                         observed_at=observed)
        self.assertEqual(len(hints), 1)
        self.assertEqual(hints[0]['submitted_date'], '2026-06-25')
        self.assertEqual(hints[0]['code'], '6147')
        self.assertEqual(hints[0]['fiscal_period']['end'], '2026-03-31')
        for key in ('value', 'amount', 'dividend', 'doc_id', 'latest_filing_guaranteed'):
            self.assertNotIn(key, hints[0])

    def hint_file(self, folder, **updates):
        row = {'code': '6147', 'edinet_code': 'E01507', 'security_code': '61470',
               'name': '株式会社ヤマザキ', 'corporate_number': '9080401005540',
               'identity_as_of': '2026-10-11', 'submitted_date': '2026-06-25',
               'fiscal_period': {'start': '2025-04-01', 'end': '2026-03-31'},
               'source_url': 'https://www.yamazaki-iron.co.jp/ir/library/pdf/securitiesreport_2026_full.pdf',
               'verified_at': '2026-10-11T21:00:00+09:00', **updates}
        path = Path(folder) / 'hint.json'
        path.write_text(json.dumps({'version': 1, 'hints': [row]}))
        return path

    def test_hint_reference_cannot_carry_credentials_queries_or_relative_urls(self):
        with tempfile.TemporaryDirectory() as folder:
            for url in ('https://secret@example.com/report.pdf', 'https://example.com/report.pdf?key=secret',
                        'https://example.com/report.pdf#secret', '/report.pdf', 'http://example.com/report.pdf'):
                path = self.hint_file(folder, source_url=url)
                self.assertEqual(module.load_filing_hints(path, identities=(IDENTITY,), observed_at=NOW), ())

    def test_extra_amount_or_oversize_hints_are_never_used(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.hint_file(folder, value=10)
            self.assertEqual(module.load_filing_hints(path, identities=(IDENTITY,), observed_at=NOW), ())
            path.write_bytes(b' ' * 100_001)
            self.assertEqual(module.load_filing_hints(path, identities=(IDENTITY,), observed_at=NOW), ())

    def test_changed_issuer_or_future_verification_invalidates_old_hint(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.hint_file(folder)
            identities = (module.EdinetIdentity('6147', 'E01507', '別会社', '61470',
                          '9080401005540', '2026-10-11'),)
            self.assertEqual(module.load_filing_hints(path, identities=identities, observed_at=NOW), ())
            path = self.hint_file(folder, verified_at='2026-10-12T21:00:00+09:00')
            self.assertEqual(module.load_filing_hints(path, identities=(IDENTITY,), observed_at=NOW), ())


class FactTests(unittest.TestCase):
    def parse(self, payload=None, descriptor=None):
        return parse_annual_dividend(xbrl() if payload is None else payload, IDENTITY,
                                     DESCRIPTOR if descriptor is None else descriptor, NOW)

    def test_filed_period_direct_fact_and_dates_are_distinct(self):
        fact = self.parse()
        self.assertEqual(fact['value'], 20)
        self.assertEqual(fact['fiscal_period'], {'start': '2025-04-01', 'end': '2026-03-31'})
        self.assertEqual(fact['filing_submitted_at'], '2026-06-26 09:00')
        self.assertEqual(fact['fetched_at'], NOW)
        self.assertEqual(fact['kind'], 'filed_fiscal_period_dividend')
        self.assertEqual(fact['unit'], 'JPY/share')
        self.assertFalse(fact['latest_filing_guaranteed'])
        self.assertEqual(fact['split_adjustment'], 'as_reported')
        self.assertNotIn('market_cap', fact)
        self.assertNotIn('price', fact)
        self.assertNotIn('payment_date', fact)

    def test_zero_is_available_only_when_actual_numeric_zero_reported(self):
        self.assertEqual(self.parse(xbrl('0'))['value'], 0)
        self.assertIsNone(self.parse(xbrl().replace(b'>20.00<', b'><')))

    def test_raw_identity_and_descriptor_cannot_be_guessed(self):
        for original, changed in [(b'E01507', b'E99999'), (b'61470', b'72030'),
                                  ('株式会社ヤマザキ'.encode(), '株式会社別会社'.encode())]:
            self.assertIsNone(self.parse(xbrl().replace(original, changed)))
        for key, value in [('docID', '../S100TEST'), ('secCode', '6147'), ('edinetCode', 'E99999'),
                           ('filerName', '別会社'), ('docTypeCode', '130'), ('withdrawalStatus', '1'),
                           ('docInfoEditStatus', '2'), ('disclosureStatus', '2'), ('legalStatus', '0'), ('xbrlFlag', '0'),
                           ('periodEnd', '2027-03-31'), ('submitDateTime', '2027-06-26 09:00'),
                           ('submitDateTime', '2026-10-11 23:59'),
                           ('JCN', '1234567890123')]:
            self.assertIsNone(self.parse(descriptor={**DESCRIPTOR, key: value}), (key, value))

    def test_period_entity_measure_and_dimension_exact(self):
        for original, changed in [(b'2025-04-01', b'2024-04-01'), (b'E01507-000', b'E01507-001?'),
                                  (b'iso4217:JPY', b'iso4217:USD'), (b'xbrli:shares', b'xbrli:pure'),
                                  (b'NonConsolidatedMember</', b'ConsolidatedMember</'),
                                  (b'ConsolidatedOrNonConsolidatedAxis', b'OtherAxis')]:
            self.assertIsNone(self.parse(xbrl().replace(original, changed)), (original, changed))
        self.assertIsNotNone(self.parse(xbrl(scenario=False)))

    def test_interim_policy_and_other_namespaces_not_annual(self):
        for replacement in ['InterimDividendPaidPerShareSummaryOfBusinessResults',
                            'DividendPerShareDividendsOfSurplus']:
            self.assertIsNone(self.parse(xbrl().replace(module.TAG.encode(), replacement.encode())))
        self.assertIsNone(self.parse(xbrl().replace(b'/taxonomy/jpcrp/', b'/spoof/jpcrp/')))

    def test_nil_negative_nonfinite_comma_and_overprecision_not_available(self):
        for value in ['-1', 'NaN', 'INF', '1,000', '20.123456789', '1000000001']:
            self.assertIsNone(self.parse(xbrl(value)))
        self.assertIsNone(self.parse(xbrl().replace(b'decimals="2"', b'decimals="2" xsi:nil="true"')))

    def test_duplicate_conflicting_facts_are_ambiguous(self):
        duplicate = ('<jpcrp_cor:DividendPaidPerShareSummaryOfBusinessResults '
                     'contextRef="CurrentYearDuration_NonConsolidatedMember" unitRef="JPYPerShares" '
                     'decimals="2">30</jpcrp_cor:DividendPaidPerShareSummaryOfBusinessResults>')
        self.assertIsNone(self.parse(xbrl(extra_facts=duplicate)))
        self.assertEqual(self.parse(xbrl(extra_facts=duplicate.replace('>30<', '>20<')))['value'], 20)

    def test_entities_rebinding_and_external_doctype_rejected(self):
        self.assertIsNone(self.parse(b'<!DOCTYPE x [<!ENTITY a SYSTEM "file:///private/key">]>' + xbrl()))
        self.assertIsNone(self.parse(xbrl().replace(b'<xbrli:measure>iso4217:JPY',
                                                   b'<xbrli:measure xmlns:iso4217="https://evil.invalid/">iso4217:JPY')))

    def test_utf16_utf32_or_non_utf8_declaration_cannot_bypass_entity_guard(self):
        raw = '<!DOCTYPE x [<!ENTITY a SYSTEM "file:///private/key">]>' + xbrl().decode()
        for encoding in ['utf-16', 'utf-16-le', 'utf-32', 'utf-32-be']:
            self.assertIsNone(self.parse(raw.encode(encoding)))
        self.assertIsNone(self.parse(xbrl().replace(b'encoding="UTF-8"', b'encoding="ISO-8859-1"')))

    def test_duplicate_xml_ids_cannot_reassign_context_or_unit(self):
        duplicate = '<xbrli:context id="CurrentYearDuration_NonConsolidatedMember"/>'
        self.assertIsNone(self.parse(xbrl(extra_facts=duplicate)))
        self.assertIsNone(self.parse(xbrl(extra_facts='<xbrli:unit id="JPYPerShares"/>')))

    def test_future_identity_observation_is_not_verified(self):
        identity = EdinetIdentity('6147', 'E01507', '株式会社ヤマザキ', '61470',
                                  '9080401005540', '2026-10-12')
        self.assertIsNone(parse_annual_dividend(xbrl(), identity, DESCRIPTOR, NOW))

    def test_archive_only_public_xbrl_not_audit_html_or_duplicate_instance(self):
        self.assertEqual(parse_annual_zip(zipped(extras={'XBRL/PublicDoc/prose.htm': b'private prose'}),
                                         IDENTITY, DESCRIPTOR, NOW)['value'], 20)
        for name in ['XBRL/AuditDoc/annual.xbrl', '../XBRL/PublicDoc/annual.xbrl', 'XBRL/PublicDoc/prose.htm']:
            self.assertIsNone(parse_annual_zip(zipped(name=name), IDENTITY, DESCRIPTOR, NOW))
        self.assertIsNone(parse_annual_zip(zipped(extras={'XBRL/PublicDoc/second.xbrl': xbrl()}),
                                          IDENTITY, DESCRIPTOR, NOW))
        self.assertIsNone(parse_annual_zip(b'not zip', IDENTITY, DESCRIPTOR, NOW))


class ProviderTests(unittest.TestCase):
    def setUp(self):
        self.now = NOW
        self.session = Mock()
        self.session.__enter__ = Mock(return_value=self.session)
        self.session.__exit__ = Mock(return_value=False)
        self.factory = Mock(return_value=self.session)
        self.provider = EdinetAnnualDividends('fixture-credential', identities=(IDENTITY,),
                                               session_factory=self.factory, clock=lambda: self.now)

    def test_no_key_means_no_session_or_communication(self):
        for key in [None, '', 123]:
            provider = EdinetAnnualDividends(key, identities=(IDENTITY,), session_factory=self.factory)
            self.assertEqual(provider.fetch(COMPANY, DESCRIPTOR)['status'], 'not_configured')
        self.factory.assert_not_called()

    def test_unconfirmed_company_and_filing_never_send_request(self):
        self.assertEqual(self.provider.fetch({**COMPANY, 'name': '別会社'}, DESCRIPTOR)['status'], 'identity_unconfirmed')
        self.assertEqual(self.provider.fetch(COMPANY, {**DESCRIPTOR, 'docTypeCode': '180'})['status'], 'filing_unconfirmed')
        self.factory.assert_not_called()

    def test_single_bounded_fixed_origin_request_and_minute_throttle(self):
        self.session.get.return_value = Response(zipped())
        result = self.provider.fetch(COMPANY, DESCRIPTOR)
        self.assertEqual(result['data'], {'historical_dividend_per_share': 20})
        call = self.session.get.call_args
        self.assertEqual(call.args[0], module.API_BASE + 'S100TEST')
        self.assertEqual(call.kwargs['params']['type'], 1)
        self.assertFalse(call.kwargs['allow_redirects'])
        self.assertTrue(call.kwargs['stream'])
        self.assertEqual(self.provider.fetch(COMPANY, DESCRIPTOR)['status'], 'provider_waiting')
        self.session.get.assert_called_once()
        self.assertNotIn('fixture-credential', json.dumps(result))

    def test_http_200_json_error_is_not_zero_or_success(self):
        self.session.get.return_value = Response(b'{"metadata":{"status":"404","message":"private"}}',
                                                 content_type='application/json; charset=utf-8')
        result = self.provider.fetch(COMPANY, DESCRIPTOR)
        self.assertEqual(result['status'], 'fetch_error')
        self.assertEqual(result['data'], {})
        self.assertNotIn('private', json.dumps(result))

    def test_http_and_json_429_share_bounded_backoff_without_retry(self):
        for status in [429, 200]:
            provider = EdinetAnnualDividends('fixture-credential', identities=(IDENTITY,),
                                             session_factory=self.factory, clock=lambda: self.now)
            self.session.get.return_value = Response(b'{"StatusCode":429,"message":"private"}', status=status,
                                                     content_type='application/json', headers={'Retry-After': '1000'})
            self.assertEqual(provider.fetch(COMPANY, DESCRIPTOR)['status'], 'rate_limited')
            self.now += 999
            self.assertEqual(provider.fetch(COMPANY, DESCRIPTOR)['status'], 'provider_waiting')
            self.now += 1
        self.assertEqual(self.session.get.call_count, 2)

    def test_redirect_network_failure_oversize_and_wrong_type_never_leak(self):
        for response in [Response(b'private', status=302), Response(b'private', content_type='text/html'),
                         Response(b'x' * (module.MAX_ZIP_BYTES + 1))]:
            self.session.get.return_value = response
            result = self.provider.fetch(COMPANY, DESCRIPTOR)
            self.assertNotEqual(result['status'], 'available')
            self.assertEqual(result['data'], {})
            self.now += 60
        self.session.get.side_effect = requests.Timeout('url?Subscription-Key=private')
        result = self.provider.fetch(COMPANY, DESCRIPTOR)
        self.assertEqual(result['status'], 'fetch_error')
        self.assertNotIn('private', json.dumps(result))

    def test_locked_request_is_not_queued_or_duplicated(self):
        self.provider._lock.acquire()
        try:
            self.assertEqual(self.provider.fetch(COMPANY, DESCRIPTOR)['status'], 'provider_waiting')
            self.factory.assert_not_called()
        finally:
            self.provider._lock.release()

    def test_fork_recreates_inherited_lock_without_connecting(self):
        previous = self.provider._lock
        self.provider._reset_process()
        self.assertIsNot(self.provider._lock, previous)
        self.factory.assert_not_called()


if __name__ == '__main__':
    unittest.main()
