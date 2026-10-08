"""Editorial priority for verified business announcements, not price forecasts."""
import re

_ROUTINE = re.compile(r"人事|役員|定款|株主名簿|株主総会|取得状況|説明会|登壇|講演|出展|フォーラム|Forum|受賞|表彰|キャンペーン|セミナー|募集|新卒採用|社員採用|人材採用|採用情報", re.I)
_CATEGORIES = (
    (5, 'business_change', r'買収|合併|事業譲渡|事業売却|事業撤退|事業再編|会社分割|生産停止|事業停止'),
    (5, 'earnings_change', r'業績予想|上方修正|下方修正|決算短信|決算発表|増益|減益|赤字|黒字'),
    (4, 'investment', r'工場|設備投資|増産|新設|生産能力|大型受注'),
    (4, 'partnership', r'資本提携|業務提携|提携|共同事業|共同開発'),
    (3, 'new_service', r'発売|提供開始|販売開始|導入|採用|供給|稼働|事業開始|新サービス'),
    (2, 'research', r'開発|実証|実験|研究|協業|連携|取り組み.{0,5}開始'),
)


def priority(title):
    """A discovery hint. The original body and two reviews remain mandatory."""
    if not isinstance(title, str) or _ROUTINE.search(title):
        return (0, None)
    for score, category, pattern in _CATEGORIES:
        if re.search(pattern, title):
            return score, category
    return (0, None)


def candidate_order(item):
    from datetime import date
    score, _ = priority(item.get('title'))
    # Prefer today's announcements over an older, higher-scored announcement.
    return (-date.fromisoformat(item['published_date']).toordinal(), -score,
            -(item.get('published_at') or 0), item.get('symbol', ''), item['url'])
