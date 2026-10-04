"""Explicit LINE language preferences; stock codes never change delivery language."""

import unicodedata


SUPPORTED_LANGUAGES = frozenset(("ja", "en", "ko", "zh"))


def normalize_language(value):
    value = value.strip().lower() if isinstance(value, str) else ""
    return value if value in SUPPORTED_LANGUAGES else "ja"


def language_command(text):
    """Return a language only for a complete, explicit language-change command."""
    if not isinstance(text, str):
        return None
    text = unicodedata.normalize("NFKC", text).strip().casefold()
    parts = text.split()
    if len(parts) == 2 and parts[0] == "lang" and parts[1] in SUPPORTED_LANGUAGES:
        return parts[1]
    return {
        "日本語": "ja", "日本語で": "ja", "日本語にして": "ja",
        "日本語にしてください": "ja", "日本語に変更": "ja",
        "日本語に変更して": "ja", "日本語に変更してください": "ja",
        "english": "en", "英語": "en",
        "한국어": "ko", "韓国語": "ko",
        "中文": "zh", "中国語": "zh",
    }.get(text)
