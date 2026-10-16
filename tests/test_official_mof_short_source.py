"""Synthetic short-release provenance contracts; no transport or provider use."""
from copy import deepcopy
from datetime import datetime
from hashlib import sha256
import json
import re
import unicodedata
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit

from official_mof_short_source import SCOPE, SHORT_EVIDENCE, valid_short_mof_record


URL = 'https://www.mof.go.jp/policy/international_policy/convention/dialogue/20991231235959.html'
TITLE = '架空の財務大臣の意見交換'
DAY = '2026-10-15'
DATELINE = '2026年10月15日'
ACTION = '財務大臣は架空の代表と経済政策について意見交換を行いました。'
FILLER = 'これは取得検証のための架空の資料であり、実際の会談や政策を示すものではありません。'


def digest(value):
    return sha256(value.encode('utf-8')).hexdigest()


def proof_digest(proof):
    projection = {key: proof[key] for key in (
        'version', 'title_sha256', 'body_sha256', 'published_date', 'published_at',
        'publication_precision', 'canonical_url', 'narrative_characters',
    )}
    payload = json.dumps(projection, ensure_ascii=False, sort_keys=True,
                         separators=(',', ':'), allow_nan=False).encode('utf-8')
    return sha256(payload).hexdigest()


def body(characters=88, *, narrative=ACTION, dateline=DATELINE):
    return (dateline + '\n' + narrative + FILLER * 4)[:characters]


def record(characters=88, *, narrative=ACTION, dateline=DATELINE):
    text = body(characters, narrative=narrative, dateline=dateline)
    compact = re.sub(r'\s+', '', unicodedata.normalize('NFKC', text))
    compact = compact.replace(unicodedata.normalize('NFKC', TITLE), '').replace(dateline, '')
    value = {
        'source': '財務省', 'source_scope': SCOPE,
        'url': URL, 'evidence_url': URL, 'title': TITLE,
        'body': text, 'body_sha256': digest(text),
        'published_date': DAY, 'published_at': None, 'publication_precision': 'day',
        SHORT_EVIDENCE: {
            'version': 1,
            'title_sha256': digest(TITLE), 'body_sha256': digest(text),
            'published_date': DAY, 'published_at': None, 'publication_precision': 'day',
            'canonical_url': URL, 'narrative_characters': len(compact),
        },
    }
    value[SHORT_EVIDENCE]['verified_content_sha256'] = proof_digest(value[SHORT_EVIDENCE])
    return value


class VerifiedShortMofRecordTests(unittest.TestCase):
    def test_registered_supporting_pdf_parents_cannot_use_short_exception(self):
        import official_mof_short_source as short_source
        import official_news_sources as sources

        self.assertIs(sources.MOF_SUPPORTING_PDFS, short_source.MOF_SUPPORTING_PDFS)
        value = record()
        self.assertIs(valid_short_mof_record(value), True)
        specification = {
            'path': '/policy/international_policy/convention/dialogue/synthetic.pdf',
            'title': '架空の補足資料', 'document_date': DAY, 'signature': '架空の署名',
        }
        with patch.dict(sources.MOF_SUPPORTING_PDFS, {urlsplit(URL).path: specification}):
            self.assertIs(valid_short_mof_record(value), False)
        self.assertIs(valid_short_mof_record(value), True)
        for path in sources.MOF_SUPPORTING_PDFS:
            with self.subTest(registered_parent=path):
                value = record()
                value['url'] = value['evidence_url'] = 'https://www.mof.go.jp' + path
                value[SHORT_EVIDENCE]['canonical_url'] = value['url']
                value[SHORT_EVIDENCE]['verified_content_sha256'] = proof_digest(value[SHORT_EVIDENCE])
                self.assertIs(valid_short_mof_record(value), False)

    def test_valid_short_boundaries_and_input_are_preserved(self):
        self.assertEqual(SCOPE, 'mof_verified_short_dialogue_html_v1')
        self.assertEqual(SHORT_EVIDENCE, 'short_html_evidence')
        for characters in (80, 88, 99):
            with self.subTest(characters=characters):
                value = record(characters)
                before = deepcopy(value)
                self.assertEqual(len(value['body']), characters)
                self.assertGreaterEqual(value[SHORT_EVIDENCE]['narrative_characters'], 60)
                self.assertIs(valid_short_mof_record(value), True)
                self.assertEqual(value, before)

    def test_short_exception_does_not_accept_79_or_100_characters(self):
        for characters in (0, 79, 100, 101):
            with self.subTest(characters=characters):
                self.assertIs(valid_short_mof_record(record(characters)), False)

    def test_valid_second_precision_is_bound_to_the_same_publication(self):
        value = record()
        stamp = datetime.fromisoformat('2026-10-15T12:00:00+09:00').timestamp()
        value.update(published_at=stamp, publication_precision='second')
        value[SHORT_EVIDENCE].update(published_at=stamp, publication_precision='second')
        value[SHORT_EVIDENCE]['verified_content_sha256'] = proof_digest(value[SHORT_EVIDENCE])
        self.assertIs(valid_short_mof_record(value), True)
        value[SHORT_EVIDENCE]['published_at'] = stamp + 1
        self.assertIs(valid_short_mof_record(value), False)
        for bad in (True, 0, -1, float('nan'), float('inf'), '2026-10-15T12:00:00+09:00'):
            with self.subTest(second_timestamp=bad):
                value = record()
                value.update(published_at=bad, publication_precision='second')
                value[SHORT_EVIDENCE].update(published_at=bad, publication_precision='second')
                self.assertIs(valid_short_mof_record(value), False)

    def test_scope_without_complete_proof_is_rejected(self):
        for value in (None, [], '', 1, True):
            with self.subTest(value=value):
                self.assertIs(valid_short_mof_record(value), False)
        for key in (
            'source', 'source_scope', 'url', 'evidence_url', 'title', 'body',
            'body_sha256', 'published_date', 'published_at', 'publication_precision', SHORT_EVIDENCE,
        ):
            with self.subTest(missing=key):
                value = record()
                del value[key]
                self.assertIs(valid_short_mof_record(value), False)
        value = record()
        value['source_scope'] = 'unverified_short_release'
        self.assertIs(valid_short_mof_record(value), False)

    def test_evidence_requires_exact_bounded_fields(self):
        for key in record()[SHORT_EVIDENCE]:
            with self.subTest(missing=key):
                value = record()
                del value[SHORT_EVIDENCE][key]
                self.assertIs(valid_short_mof_record(value), False)
        for bad in (None, [], '', 1, True):
            with self.subTest(proof=bad):
                value = record()
                value[SHORT_EVIDENCE] = bad
                self.assertIs(valid_short_mof_record(value), False)
        value = record()
        value[SHORT_EVIDENCE]['untrusted_free_text'] = 'fixture marker'
        self.assertIs(valid_short_mof_record(value), False)
        for key, bad in (
            ('version', True), ('version', 1.0), ('version', 2),
            ('verified_content_sha256', 'x' * 64), ('verified_content_sha256', 'A' * 64),
            ('verified_content_sha256', '0' * 63), ('verified_content_sha256', None),
            ('verified_content_sha256', '0' * 64),
            ('narrative_characters', True), ('narrative_characters', 70.0),
            ('narrative_characters', '70'), ('narrative_characters', -1),
            ('narrative_characters', 10**100),
        ):
            with self.subTest(key=key, bad=bad):
                value = record()
                value[SHORT_EVIDENCE][key] = bad
                self.assertIs(valid_short_mof_record(value), False)

    def test_body_and_title_replacement_cannot_reuse_old_proof(self):
        value = record()
        value['body'] = value['body'].replace('架空の代表', '架空の相手')
        value['body_sha256'] = digest(value['body'])
        self.assertIs(valid_short_mof_record(value), False)
        value = record()
        value['title'] += 'の追加情報'
        self.assertIs(valid_short_mof_record(value), False)
        for key in ('body_sha256', 'title_sha256'):
            with self.subTest(proof_hash=key):
                value = record()
                value[SHORT_EVIDENCE][key] = '0' * 64
                self.assertIs(valid_short_mof_record(value), False)
        value = record()
        value['body_sha256'] = '0' * 64
        self.assertIs(valid_short_mof_record(value), False)

    def test_same_official_url_is_required_in_all_three_places(self):
        variants = (
            URL.replace('www.mof.go.jp', 'example.test'),
            URL.replace('www.mof.go.jp', 'www.mof.go.jp.example.test'),
            URL.replace('https://', 'http://'),
            URL.replace('https://', 'https://user@'),
            URL.replace('www.mof.go.jp', 'www.mof.go.jp:443'),
            URL + '?page=1', URL + '#main',
            URL.replace('20991231235959.html', '2099123123595.html'),
            URL.replace('20991231235959.html', '209912312359599.html'),
            URL.replace('dialogue/', 'another/'),
            'https://www.mof.go.jp/public_relations/conference/my20261015.html',
        )
        for url in variants:
            with self.subTest(url=url):
                value = record()
                value['url'] = value['evidence_url'] = url
                value[SHORT_EVIDENCE]['canonical_url'] = url
                self.assertIs(valid_short_mof_record(value), False)
        for location in ('url', 'evidence_url', 'canonical_url'):
            with self.subTest(location=location):
                value = record()
                other = URL.replace('20991231235959', '20991231235958')
                if location == 'canonical_url':
                    value[SHORT_EVIDENCE][location] = other
                else:
                    value[location] = other
                self.assertIs(valid_short_mof_record(value), False)

    def test_other_issuer_or_empty_title_cannot_use_mof_scope(self):
        for key, bad in (
            ('source', '金融庁'), ('source', '総務省統計局'),
            ('source', '日本銀行'), ('source', None),
            ('title', ''), ('title', ' \n '), ('title', None),
        ):
            with self.subTest(key=key, bad=bad):
                value = record()
                value[key] = bad
                self.assertIs(valid_short_mof_record(value), False)

    def test_publication_fields_must_agree_with_body_and_proof(self):
        for key, bad in (
            ('published_date', '2026-10-14'), ('published_date', '2026-2-30'),
            ('published_date', '2026-10-15T00:00:00'), ('published_date', None),
            ('published_at', True), ('published_at', 1),
            ('publication_precision', 'minute'), ('publication_precision', None),
        ):
            with self.subTest(key=key, bad=bad):
                value = record()
                value[key] = bad
                self.assertIs(valid_short_mof_record(value), False)
        for key, bad in (
            ('published_date', '2026-10-14'), ('published_at', 1),
            ('publication_precision', 'second'),
        ):
            value = record()
            value[SHORT_EVIDENCE][key] = bad
            self.assertIs(valid_short_mof_record(value), False)
        value = record(dateline='2026年10月14日')
        self.assertIs(valid_short_mof_record(value), False)

    def test_narrative_requires_issuer_target_action_and_completed_verb(self):
        for narrative in (
            '架空の担当者は架空の代表と経済政策について意見交換を行いました。',
            '財務大臣は架空の代表と経済政策について説明を聞きました。',
            '財務大臣が意見交換を行いました。',
            '財務大臣は架空の代表と経済政策について意見交換を行う予定です。',
            '財務大臣が参加しました。架空の代表と経済政策について意見交換を行いました。',
            '記事一覧。関連リンク。会議資料。' * 4,
        ):
            with self.subTest(narrative=narrative):
                self.assertIs(valid_short_mof_record(record(narrative=narrative)), False)
        value = record(narrative=ACTION + 'お問い合わせ先は架空の窓口です。')
        self.assertIs(valid_short_mof_record(value), False)

    def test_title_and_dateline_padding_cannot_supply_narrative_length(self):
        value = record(narrative=ACTION + TITLE * 8)
        self.assertLess(value[SHORT_EVIDENCE]['narrative_characters'], 60)
        self.assertIs(valid_short_mof_record(value), False)
        value = record()
        value['body'] = (DATELINE + '\n' + TITLE * 8)[:88]
        value['body_sha256'] = digest(value['body'])
        value[SHORT_EVIDENCE]['body_sha256'] = value['body_sha256']
        value[SHORT_EVIDENCE]['narrative_characters'] = 76
        self.assertIs(valid_short_mof_record(value), False)
        value = record()
        value[SHORT_EVIDENCE]['narrative_characters'] += 1
        self.assertIs(valid_short_mof_record(value), False)


if __name__ == '__main__':
    unittest.main()
