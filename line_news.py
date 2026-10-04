"""Pure LINE news routing and formatting; no AI, network, or delivery calls."""

import unicodedata
from urllib.parse import urlsplit

from line_language import normalize_language


_JAPANESE_NEWS_NAMES = (
    'ニュース', 'にゅーす', '今日のニュース', '本日のニュース',
    '最新ニュース', '最新のニュース', '経済ニュース', '今日の経済ニュース',
    '本日の経済ニュース', '市場ニュース', '相場のニュース',
)
_NEWS_REQUESTS = frozenset(
    name + suffix
    for name in _JAPANESE_NEWS_NAMES
    for suffix in ('', 'を教えて', 'を教えてください', 'を見せて', 'を見せてください')
) | frozenset((
    'news', "today's news", 'todays news', 'latest news',
    '뉴스', '오늘 뉴스', '오늘의 뉴스', '최신 뉴스', '오늘 경제 뉴스',
    '新闻', '新聞', '今日新闻', '今日新聞', '今天的新闻', '最新新闻', '今天的经济新闻',
))


def is_news_request(text):
    """Recognize complete common requests, without capturing news questions."""
    if not isinstance(text, str):
        return False
    normalized = unicodedata.normalize('NFKC', text).casefold()
    normalized = ' '.join(normalized.split()).rstrip('。.!? ').strip()
    return normalized in _NEWS_REQUESTS


_MESSAGES = {
    'ja': {
        'heading': 'ニュース見出し', 'published': '発表', 'unknown_date': '発表日不明',
        'unknown_source': '出典不明',
        'empty_today': '本日発表されたニュースの見出しは、まだ確認できていません。',
        'refreshing': 'ニュースを取得しています。少し待ってから、もう一度「ニュース」と送ってください。',
        'unavailable': 'ニュースを取得できませんでした。時間をおいて、もう一度「ニュース」と送ってください。',
        'translation_pending': '翻訳を準備中のため、原文の見出しを含みます。',
        'link_omitted': '記事リンクは表示できないため省略しました。',
    },
    'en': {
        'heading': 'News headlines', 'published': 'Published', 'unknown_date': 'Publication date unavailable',
        'unknown_source': 'Source unavailable',
        'empty_today': 'No headlines published today have been confirmed yet.',
        'refreshing': 'News is loading. Please send “news” again in a moment.',
        'unavailable': 'News could not be retrieved. Please send “news” again later.',
        'translation_pending': 'Some headlines appear in their original language while translation is pending.',
        'link_omitted': 'The article link could not be displayed and was omitted.',
    },
    'ko': {
        'heading': '뉴스 제목', 'published': '발표', 'unknown_date': '발표일 확인 불가',
        'unknown_source': '출처 확인 불가',
        'empty_today': '오늘 발표된 뉴스 제목은 아직 확인되지 않았습니다.',
        'refreshing': '뉴스를 불러오고 있습니다. 잠시 후 “뉴스”를 다시 보내 주세요.',
        'unavailable': '뉴스를 가져오지 못했습니다. 나중에 “뉴스”를 다시 보내 주세요.',
        'translation_pending': '번역을 준비 중이므로 원문 제목이 포함되어 있습니다.',
        'link_omitted': '기사 링크를 표시할 수 없어 생략했습니다.',
    },
    'zh': {
        'heading': '新闻标题', 'published': '发布', 'unknown_date': '发布日期不明',
        'unknown_source': '来源不明',
        'empty_today': '暂未确认今天发布的新闻标题。',
        'refreshing': '正在获取新闻，请稍后再次发送“新闻”。',
        'unavailable': '未能获取新闻，请稍后再次发送“新闻”。',
        'translation_pending': '翻译尚未完成，因此部分标题保留原文。',
        'link_omitted': '文章链接无法显示，已省略。',
    },
}


def _short_text(value, limit):
    text = ' '.join(str(value or '').split())
    return text if len(text) <= limit else text[:limit - 1] + '…'


def _display_url(value):
    # Preserve a usable URL in full. Truncating a URL can point to another page.
    if not isinstance(value, str) or not value or len(value) > 900:
        return None
    if any(character.isspace() or ord(character) < 32 for character in value) or '\\' in value:
        return None
    try:
        parsed = urlsplit(value)
        if parsed.scheme.lower() not in ('http', 'https') or not parsed.hostname:
            return None
        if parsed.username is not None or parsed.password is not None:
            return None
        parsed.port
    except ValueError:
        return None
    return value


def format_news_reply(selected, lang='ja', translation_pending=False):
    """Format only the selected headlines, retaining their publication dates.

    The selector owns date, source, and deduplication policy. This formatter does
    not substitute older articles, reviewed editions, or fabricated summaries.
    Individual field limits keep all three complete entries below 4,000 chars.
    """
    messages = _MESSAGES[normalize_language(lang)]
    edition = _short_text(selected.get('edition_date'), 32)
    heading = '📰 ' + (edition + ' | ' if edition else '') + messages['heading']
    articles = [item for item in selected.get('news', [])[:3]
                if isinstance(item, dict) and str(item.get('title') or '').strip()]
    if not articles:
        status = selected.get('selection_status', 'unavailable')
        if status not in ('empty_today', 'refreshing', 'unavailable'):
            status = 'unavailable'
        return heading + '\n\n' + messages[status]

    lines = [heading]
    if translation_pending:
        lines.extend(('', messages['translation_pending']))
    for number, article in enumerate(articles, 1):
        title = _short_text(article.get('title'), 240)
        source = _short_text(article.get('source'), 70) or messages['unknown_source']
        published = _short_text(article.get('published_date'), 32) or messages['unknown_date']
        lines.extend(('', f'{number}. {title}',
                      f'{source} | {messages["published"]}: {published}',
                      _display_url(article.get('url')) or messages['link_omitted']))
    return '\n'.join(lines)
