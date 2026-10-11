"""BOJ decision facts only; no source prose is persisted or sent to AI.

The bounded reader first verifies the whole document and actual publication
date. This boundary retains only one unambiguous adopted overnight-rate target.
It is not a blanket permission to reproduce or rewrite BOJ prose commercially.
"""
from decimal import Decimal, InvalidOperation
from datetime import date
from hashlib import sha256
import math
import re
import unicodedata
from urllib.parse import urlsplit

from morning_news_window import DEFERRED_REASONS, _verified_article
from official_news_sources import _article_path, _BOJ_TOPIC

SCOPE = 'boj_policy_rate_facts_v1'
TITLE = '日本銀行の短期金利目標'
_HASH = re.compile(r'[0-9a-f]{64}')
_DECISION = re.compile(r'日本銀行は、本日、政策委員会・金融政策決定会合において、'
    r'(?:次回金融政策決定会合までの)?金融市場調節方針を、以下のとおりとすることを決定した'
    r'(?:\(賛成[0-9]反対[0-9]\)|\(全員一致\))?(?:\(注\))?。')
_HEADER = re.compile(r'^(?:1)?([0-9]{4})年([0-9]{1,2})月([0-9]{1,2})日日本銀行'
    r'(?:金融市場調節方針(?:の変更)?について|当面の金融政策運営について)?(?:1[.、])?')
_TARGET = re.compile(r'無担保コールレート\(オーバーナイト物\)を、?(-?\d+(?:\.\d+)?)%程度で推移するよう促す[0-9]*。')
_KEEP = ('source', 'url', 'evidence_url', 'published_at', 'published_date',
         'publication_precision', 'observed_at', 'body_verified_at',
         'selection_route', 'deferred_from', 'deferred_reason', 'requires_correction_review')
_FACT_FIELDS = frozenset(_KEEP + ('title', 'body', 'body_sha256', 'source_scope',
                                 'policy_rate_percent', 'original_body_sha256'))


def _rate(value):
    try:
        if not isinstance(value, str) or not re.fullmatch(r'-?\d+(?:\.\d{1,4})?', value):
            return None
        number = Decimal(value)
        if not Decimal('-5') <= number <= Decimal('20'):
            return None
        return format(number.normalize(), 'f')
    except InvalidOperation:
        return None


def _body(day, rate):
    # Independently composed labels and scope explanation, not source prose.
    return (f'日本銀行の金融政策決定について確認した事実データ。\n'
            f'発表日: {day}\n対象: 銀行間の翌日返済の資金取引\n'
            f'指標: 無担保コールレート(オーバーナイト物)\n目標水準: {rate}%程度\n'
            '確認範囲はこの決定の短期金利目標です。以前の目標との比較は含みません。'
            '利上げ・利下げ・据え置きの区別、適用開始日、決定理由、景気の評価、'
            '将来の方針、他の制度の利率は、この事実データの確認対象外です。')


def valid_policy_fact_record(row):
    if not _verified_article(row):
        return False
    try:
        if 'observed_at' in row and (type(row['observed_at']) not in (int, float)
                or not math.isfinite(row['observed_at'])
                or not 0 < row['observed_at'] <= row['body_verified_at']):
            return False
        if 'requires_correction_review' in row and type(row['requires_correction_review']) is not bool:
            return False
        if 'selection_route' in row and row['selection_route'] not in (
                'main', 'carryover', 'date_only', 'deferred', 'intraday'):
            return False
        if 'deferred_reason' in row and row['deferred_reason'] not in DEFERRED_REASONS:
            return False
        if 'deferred_from' in row and (not isinstance(row['deferred_from'], str)
                or date.fromisoformat(row['deferred_from']).isoformat() != row['deferred_from']):
            return False
        parsed = urlsplit(row['url'])
        return (row.get('source') == '日本銀行' and row.get('source_scope') == SCOPE
                and set(row).issubset(_FACT_FIELDS)
                and row.get('title') == TITLE and parsed.hostname == 'www.boj.or.jp'
                and row.get('evidence_url') == row['url']
                and parsed.port in (None, 443) and not parsed.query and not parsed.fragment
                and _article_path(parsed.hostname, parsed.path)
                and isinstance(row.get('policy_rate_percent'), str)
                and _rate(row['policy_rate_percent']) == row['policy_rate_percent']
                and isinstance(row.get('original_body_sha256'), str)
                and bool(_HASH.fullmatch(row['original_body_sha256']))
                and row['body'] == _body(row['published_date'], row['policy_rate_percent'])
                and not any(k in row for k in ('original_body', 'raw_body', 'supporting_documents')))
    except (TypeError, ValueError):
        return False


def policy_facts(row):
    """Drop prose before storage/fingerprinting/AI; ambiguity fails closed."""
    if valid_policy_fact_record(row):
        return dict(row)
    if not _verified_article(row) or row.get('source_scope') == SCOPE:
        return None
    try:
        parsed = urlsplit(row['url'])
        if (row.get('source') != '日本銀行' or parsed.hostname != 'www.boj.or.jp'
                or parsed.port not in (None, 443) or parsed.query or parsed.fragment
                or not _article_path(parsed.hostname, parsed.path)
                or not _BOJ_TOPIC.fullmatch(row['title'])):
            return None
        text = re.sub(r'\s+', '', unicodedata.normalize('NFKC', row['body']))
        header = _HEADER.match(text)
        if (not header or date(*map(int, header.groups())).isoformat() != row['published_date']
                or text.count('日本銀行は、本日、政策委員会・金融政策決定会合において、') != 1):
            return None
        decision = _DECISION.match(text, header.end())
        if not decision:
            return None
        # The adopted target must immediately follow the board decision,
        # before other institution rates or dissenting proposals.
        rest = text[decision.end():decision.end() + 240]
        target = _TARGET.match(rest)
        if target is None or len(_TARGET.findall(rest)) != 1:
            return None
        rate = _rate(target[1])
        if rate is None:
            return None
        body = _body(row['published_date'], rate)
        result = {key: row[key] for key in _KEEP if key in row}
        result.update(title=TITLE, body=body, body_sha256=sha256(body.encode()).hexdigest(),
                      source_scope=SCOPE, policy_rate_percent=rate,
                      original_body_sha256=row['body_sha256'])
        return result if valid_policy_fact_record(result) else None
    except (TypeError, ValueError):
        return None
