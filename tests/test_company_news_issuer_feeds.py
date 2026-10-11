"""Fictional original releases exercise fixed issuer RSS and group attribution."""
from datetime import datetime, timedelta
from unittest.mock import patch
import unittest

import company_news_additional as additional
import company_news_issuer_feeds as issuers
import company_news_sources as collection
from company_news_catalogue import CompanyNewsCatalogue
from tests.test_company_news_prtimes import article, feed, feed_item, BODY

NOW = datetime(2026, 10, 8, 18, tzinfo=additional.JST)
SINCE = NOW - timedelta(hours=72)
DAY = '2026-10-08'
GROUP = '大阪ガス（発表配信）'


def catalogue():
    configs = list(issuers.SOURCES.values()) + [additional.SOURCES[GROUP]]
    return CompanyNewsCatalogue({cfg['symbol']: {'code': cfg['symbol'][:4], 'symbol': cfg['symbol'],
        'name': cfg['name'], 'business': None, 'business_sources': []} for cfg in configs},
        {'as_of': DAY, 'retrieved_at': NOW.timestamp(), 'source_sha256': 'b' * 64})


class IssuerFeedTests(unittest.TestCase):
    def setUp(self):
        self.cat = catalogue()
        self.label = 'PR TIMES / 東京ガス'
        self.cfg = issuers.SOURCES[self.label]
        self.url = 'https://prtimes.jp/main/html/rd/p/000001234.000021766.html'

    def payload(self, **changes):
        values = dict(issuer=self.cfg['issuer'], url=self.url)
        values.update(changes)
        return feed(feed_item(**values))

    def test_registered_feed_is_exact_and_current_member_required(self):
        good = issuers.FEEDS[self.label]
        self.assertEqual(collection._safe_url(good), good)
        self.assertEqual(issuers.safe_feed_url(good, self.label), good)
        for value in (good + '&extra=1', good + '#x', good.replace('21766', '9999'),
                      good.replace('https:', 'http:'), good.replace('prtimes.jp', 'user@prtimes.jp'),
                      good.replace('company_id=21766', 'company_id=021766')):
            self.assertIsNone(issuers.safe_feed_url(value))
        records = issuers.parse_feed(self.payload(), self.label, NOW, SINCE, self.cat)
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]['symbol'], '9531.T')
        self.assertEqual(records[0]['source'], 'PR TIMES')
        self.assertEqual(records[0]['collection_channel'], self.label)
        empty = CompanyNewsCatalogue({}, self.cat.provenance)
        self.assertEqual(issuers.parse_feed(self.payload(), self.label, NOW, SINCE, empty), [])

    def test_wrong_company_feed_item_and_subsidiary_never_resolve_to_parent(self):
        for changes in ({'issuer': '東京ガスの子会社株式会社'},
                        {'url': self.url.replace('000021766', '000013970')},
                        {'issuer': '大阪ガス株式会社'}):
            self.assertEqual(issuers.parse_feed(self.payload(**changes), self.label, NOW, SINCE, self.cat), [])
        self.assertIsNone(issuers.match_member(self.cfg['issuer'], '9999', self.cat))

    def test_issuer_feed_retains_original_extractor_and_safe_diagnostics(self):
        payload = article(author=self.cfg['issuer'], company_label=self.cfg['issuer'], company_id='21766')
        diagnostics = {}
        def download(url, deadline):
            return (self.payload(), url) if url == issuers.FEEDS[self.label] else (payload, url)
        with patch.object(collection, 'FEEDS', {self.label: issuers.FEEDS[self.label]}), \
             patch('company_news_catalogue.load_current_snapshot', return_value=self.cat), \
             patch.object(collection, '_download', side_effect=download):
            records = collection.collect_company_articles(NOW, since=SINCE, diagnostics=diagnostics)
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]['name'], '東京瓦斯')
        self.assertNotIn('collection_channel', records[0])
        self.assertEqual(diagnostics[self.label]['returned'], 1)
        self.assertEqual(diagnostics[self.label]['status'], 'collected')
        wrong = article(author='別会社', company_label=self.cfg['issuer'], company_id='21766')
        item = issuers.parse_feed(self.payload(), self.label, NOW, SINCE, self.cat)[0]
        from company_news_prtimes import extract_article
        self.assertIsNone(extract_article(wrong, item, self.url, NOW, SINCE,
            catalogue=issuers.bound_catalogue(self.label, self.cat)))


class OsakaGroupTests(unittest.TestCase):
    def setUp(self):
        self.cat = catalogue()
        self.url = 'https://prtimes.jp/main/html/rd/p/000000123.000139670.html'
        self.title = '大阪ガス、検証用の設備の共同開発を開始'
        self.issuer = 'Daigasグループ'

    def payload(self, **changes):
        values = dict(issuer=self.issuer, url=self.url, title=self.title)
        values.update(changes)
        return feed(feed_item(**values)).replace(b'<channel>',
            b'<channel rdf:about="https://prtimes.jp/companyrdf.php?company_id=139670">')

    def item(self):
        return additional.parse_feed(self.payload(), GROUP, NOW, SINCE, self.cat)[0]

    def extract(self, **changes):
        values = dict(author=self.issuer, company_label=self.issuer, company_id='139670',
                      title=self.title, body=BODY.replace('株式会社 架空テスト工業', '大阪ガス株式会社'))
        values.update(changes)
        return additional.extract_article(article(**values), self.item(), self.url, NOW, SINCE,
                                           catalogue=self.cat)

    def test_osaka_parent_original_works_on_independent_feed_and_body_host(self):
        self.assertEqual(additional.safe_url(additional.FEEDS[GROUP], GROUP), additional.FEEDS[GROUP])
        record = self.extract()
        self.assertIsNotNone(record)
        self.assertEqual(record['related_company'], '大阪ガス株式会社')
        self.assertEqual(record['name'], '大阪瓦斯')
        self.assertIsNone(record['published_at'])
        self.assertTrue(additional.valid_identity(record, self.cat))

    def test_resource_rights_acquisition_is_an_investment_candidate(self):
        from company_news_selection import priority
        self.assertEqual(priority('西豪州の検証用プロジェクトの権益取得について'), (4, 'investment'))

    def test_subsidiary_and_later_parent_mention_do_not_become_parent_news(self):
        for text in (BODY.replace('株式会社 架空テスト工業', '大阪ガスケミカル株式会社'),
                     BODY + '\n大阪ガス株式会社は協力会社です。',
                     BODY.replace('株式会社 架空テスト工業', '大阪ガス株式会社の取引先')):
            self.assertIsNone(self.extract(body=text))

    def test_profile_author_original_clock_and_original_date_are_required(self):
        for changes in ({'author': '別会社'}, {'company_id': '3079'},
                        {'company_label': '大阪ガス株式会社'}, {'visible': '2026-10-07 11:00:02'},
                        {'published': '2026-10-08 19:00:00', 'visible': '2026-10-08 19:00:00'}):
            self.assertIsNone(self.extract(**changes))
        self.assertEqual(additional.parse_feed(self.payload(issuer='大阪ガスケミカル株式会社'),
            GROUP, NOW, SINCE, self.cat), [])
        self.assertIsNone(additional.safe_url(self.url.replace('000139670', '000003079'), GROUP))

    def test_day_only_group_evidence_never_claims_after_a_partial_day_cutoff(self):
        item = self.item()
        payload = article(author=self.issuer, company_label=self.issuer, company_id='139670',
                          title=self.title, body=BODY.replace('株式会社 架空テスト工業', '大阪ガス株式会社'))
        self.assertIsNone(additional.extract_article(payload, item, self.url, NOW,
            datetime(2026, 10, 8, 10, tzinfo=additional.JST), catalogue=self.cat))

    def test_different_article_metadata_url_is_rejected(self):
        payload = article(author=self.issuer, company_label=self.issuer, company_id='139670',
                          title=self.title, body=BODY.replace('株式会社 架空テスト工業', '大阪ガス株式会社'))
        payload = payload.replace(b'"publisher":', b'"url":"https://prtimes.jp/main/html/rd/p/000000124.000139670.html","publisher":')
        self.assertIsNone(additional.extract_article(payload, self.item(), self.url, NOW, SINCE,
                                                     catalogue=self.cat))


if __name__ == '__main__':
    unittest.main()
