# v7 - green yellow bright
from supabase import create_client
import os
import anthropic
import json
import yfinance as yf
import feedparser
from flask import Flask, request, abort, jsonify, redirect
from linebot.v3 import WebhookHandler
from linebot.v3.exceptions import InvalidSignatureError
from linebot.v3.messaging import (
    Configuration, ApiClient, MessagingApi,
    ReplyMessageRequest, TextMessage, PushMessageRequest
)
from linebot.v3.webhooks import MessageEvent, TextMessageContent
from datetime import date, datetime

app = Flask(__name__)

ANTHROPIC_API_KEY   = os.environ.get("ANTHROPIC_API_KEY", "")
LINE_CHANNEL_SECRET = os.environ.get("LINE_CHANNEL_SECRET", "")
LINE_CHANNEL_TOKEN  = os.environ.get("LINE_CHANNEL_TOKEN", "")
LINE_USER_ID        = os.environ.get("LINE_USER_ID", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

WATCHLIST = [
    "7203.T",  # Ã£ÂÂÃ£ÂÂ¨Ã£ÂÂ¿
    "6758.T",  # Ã£ÂÂ½Ã£ÂÂÃ£ÂÂ¼
    "9984.T",  # Ã£ÂÂ½Ã£ÂÂÃ£ÂÂÃ£ÂÂÃ£ÂÂ³Ã£ÂÂ¯Ã£ÂÂ°Ã£ÂÂ«Ã£ÂÂ¼Ã£ÂÂ
    "6861.T",  # Ã£ÂÂ­Ã£ÂÂ¼Ã£ÂÂ¨Ã£ÂÂ³Ã£ÂÂ¹
    "8306.T",  # Ã¤Â¸ÂÃ¨ÂÂ±UFJ
]

configuration = Configuration(access_token=LINE_CHANNEL_TOKEN)
handler       = WebhookHandler(LINE_CHANNEL_SECRET)

def get_user(line_user_id):
    res = supabase.table("users").select("*").eq("line_user_id", line_user_id).execute()
    return res.data[0] if res.data else None

def save_user(line_user_id, data={}):
    existing = get_user(line_user_id)
    data["updated_at"] = datetime.now().isoformat()
    if existing:
        supabase.table("users").update(data).eq("line_user_id", line_user_id).execute()
    else:
        data["line_user_id"] = line_user_id
        supabase.table("users").insert(data).execute()

def detect_language(text):
    if any('\u3040' <= c <= '\u30ff' or '\u4e00' <= c <= '\u9fff' for c in text):
        return "ja"
    if any('\uac00' <= c <= '\ud7a3' for c in text):
        return "ko"
    if any('\u4e00' <= c <= '\u9fff' for c in text):
        return "zh"
    return "en"

def get_message(lang, key):
    messages = {
        "waiting_morning": {
            "ja": "Ã¦ÂÂÃ£ÂÂ¬Ã£ÂÂ¿Ã£ÂÂ¼Ã£ÂÂÃ§ÂÂÃ¦ÂÂÃ¤Â¸Â­Ã£ÂÂ§Ã£ÂÂÃ£ÂÂ\nÃ¥Â°ÂÃ£ÂÂÃ£ÂÂÃ¥Â¾ÂÃ£ÂÂ¡Ã£ÂÂÃ£ÂÂ Ã£ÂÂÃ£ÂÂÃ¯Â¼Â1Ã£ÂÂ2Ã¥ÂÂÃ¯Â¼Â...",
            "en": "Generating morning report.\nPlease wait (1-2 min)...",
            "ko": "Ã¬ÂÂÃ¬Â¹Â¨ Ã«Â ÂÃ­ÂÂ°Ã«Â¥Â¼ Ã¬ÂÂÃ¬ÂÂ± Ã¬Â¤ÂÃ¬ÂÂÃ«ÂÂÃ«ÂÂ¤.\nÃ¬ÂÂ Ã¬ÂÂ ÃªÂ¸Â°Ã«ÂÂ¤Ã«Â Â¤Ã¬Â£Â¼Ã¬ÂÂ¸Ã¬ÂÂ...",
            "zh": "Ã¦Â­Â£Ã¥ÂÂ¨Ã§ÂÂÃ¦ÂÂÃ¦ÂÂ©Ã¦ÂÂ¥Ã£ÂÂ\nÃ¨Â¯Â·Ã§Â¨ÂÃ¥ÂÂ...",
        },
        "register_form": {
            "ja": "Ã°ÂÂÂ Ã¨Â³ÂÃ§ÂÂ£Ã¦ÂÂÃ¥Â Â±Ã£ÂÂÃ§ÂÂ»Ã©ÂÂ²Ã£ÂÂÃ£ÂÂ¾Ã£ÂÂÃ¯Â¼Â\n\nÃ¤Â»Â¥Ã¤Â¸ÂÃ£ÂÂ®Ã¥Â½Â¢Ã¥Â¼ÂÃ£ÂÂ§Ã©ÂÂÃ£ÂÂ£Ã£ÂÂ¦Ã£ÂÂÃ£ÂÂ Ã£ÂÂÃ£ÂÂÃ¯Â¼Â\n\nÃ¥ÂÂÃ¥ÂÂÃ¯Â¼ÂÃ£ÂÂÃ£ÂÂ\nÃ¥Â¹Â´Ã¥ÂÂÃ¯Â¼ÂÃ£ÂÂÃ£ÂÂÃ¤Â¸ÂÃ¥ÂÂ\nÃ§Â·ÂÃ¨Â³ÂÃ§ÂÂ£Ã¯Â¼ÂÃ£ÂÂÃ£ÂÂÃ¤Â¸ÂÃ¥ÂÂ\nÃ¦Â¯ÂÃ¦ÂÂÃ¦ÂÂÃ¨Â³ÂÃ©Â¡ÂÃ¯Â¼ÂÃ£ÂÂÃ£ÂÂÃ¤Â¸ÂÃ¥ÂÂ\nÃ§ÂÂ®Ã¦Â¨ÂÃ¨Â³ÂÃ§ÂÂ£Ã¯Â¼ÂÃ£ÂÂÃ£ÂÂÃ¤Â¸ÂÃ¥ÂÂ\nÃ¤Â¿ÂÃ¦ÂÂÃ¦Â ÂªÃ¯Â¼ÂÃ©ÂÂÃ¦ÂÂÃ¥ÂÂ Ã¦Â ÂªÃ¦ÂÂ° Ã¥ÂÂÃ¥Â¾ÂÃ¤Â¾Â¡Ã¦Â Â¼Ã¥ÂÂ\nÃ£ÂÂÃ£ÂÂ¬Ã£ÂÂ¼Ã£ÂÂÃ©ÂÂÃ¦ÂÂÃ¯Â¼ÂÃ©ÂÂÃ¦ÂÂÃ¥ÂÂ",
            "en": "Ã°ÂÂÂ Register your asset info!\n\nPlease send in this format:\n\nName: XX\nAnnual income: XX\nTotal assets: XX\nMonthly investment: XX\nTarget assets: XX\nStocks owned: Stock name Shares Price\nTrading stocks: Stock name",
            "ko": "Ã°ÂÂÂ Ã¬ÂÂÃ¬ÂÂ° Ã¬Â ÂÃ«Â³Â´Ã«Â¥Â¼ Ã«ÂÂ±Ã«Â¡ÂÃ­ÂÂ©Ã«ÂÂÃ«ÂÂ¤Ã¯Â¼Â\n\nÃ«ÂÂ¤Ã¬ÂÂ Ã­ÂÂÃ¬ÂÂÃ¬ÂÂ¼Ã«Â¡Â Ã«Â³Â´Ã«ÂÂ´Ã¬Â£Â¼Ã¬ÂÂ¸Ã¬ÂÂÃ¯Â¼Â\n\nÃ¬ÂÂ´Ã«Â¦ÂÃ¯Â¼ÂÃ£ÂÂÃ£ÂÂ\nÃ¬ÂÂ°Ã¬ÂÂÃ¬ÂÂÃ¯Â¼ÂÃ£ÂÂÃ£ÂÂ\nÃ¬Â´ÂÃ¬ÂÂÃ¬ÂÂ°Ã¯Â¼ÂÃ£ÂÂÃ£ÂÂ\nÃ¬ÂÂ Ã­ÂÂ¬Ã¬ÂÂÃ¬ÂÂ¡Ã¯Â¼ÂÃ£ÂÂÃ£ÂÂ\nÃ«ÂªÂ©Ã­ÂÂÃ¬ÂÂÃ¬ÂÂ°Ã¯Â¼ÂÃ£ÂÂÃ£ÂÂ\nÃ«Â³Â´Ã¬ÂÂ Ã¬Â£Â¼Ã¬ÂÂÃ¯Â¼ÂÃ¬Â¢ÂÃ«ÂªÂ©Ã«ÂªÂ Ã¬Â£Â¼Ã¬ÂÂ ÃªÂ°ÂÃªÂ²Â©\nÃ­ÂÂ¸Ã«Â ÂÃ¬ÂÂ´Ã«ÂÂ Ã¬Â¢ÂÃ«ÂªÂ©Ã¯Â¼ÂÃ¬Â¢ÂÃ«ÂªÂ©Ã«ÂªÂ",
            "zh": "Ã°ÂÂÂ Ã¦Â³Â¨Ã¥ÂÂÃ¨ÂµÂÃ¤ÂºÂ§Ã¤Â¿Â¡Ã¦ÂÂ¯Ã¯Â¼Â\n\nÃ¨Â¯Â·Ã¦ÂÂÃ¤Â»Â¥Ã¤Â¸ÂÃ¦Â Â¼Ã¥Â¼ÂÃ¥ÂÂÃ©ÂÂÃ¯Â¼Â\n\nÃ¥Â§ÂÃ¥ÂÂÃ¯Â¼ÂÃ£ÂÂÃ£ÂÂ\nÃ¥Â¹Â´Ã¦ÂÂ¶Ã¥ÂÂ¥Ã¯Â¼ÂÃ£ÂÂÃ£ÂÂ\nÃ¦ÂÂ»Ã¨ÂµÂÃ¤ÂºÂ§Ã¯Â¼ÂÃ£ÂÂÃ£ÂÂ\nÃ¦Â¯ÂÃ¦ÂÂÃ¦ÂÂÃ¨ÂµÂÃ©Â¢ÂÃ¯Â¼ÂÃ£ÂÂÃ£ÂÂ\nÃ§ÂÂ®Ã¦Â ÂÃ¨ÂµÂÃ¤ÂºÂ§Ã¯Â¼ÂÃ£ÂÂÃ£ÂÂ\nÃ¦ÂÂÃ¦ÂÂÃ¨ÂÂ¡Ã§Â¥Â¨Ã¯Â¼ÂÃ¨ÂÂ¡Ã§Â¥Â¨Ã¥ÂÂÃ§Â§Â° Ã¨ÂÂ¡Ã¦ÂÂ° Ã¤Â»Â·Ã¦Â Â¼\nÃ¤ÂºÂ¤Ã¦ÂÂÃ¨ÂÂ¡Ã§Â¥Â¨Ã¯Â¼ÂÃ¨ÂÂ¡Ã§Â¥Â¨Ã¥ÂÂÃ§Â§Â°",
        },
        "analyzing": {
            "ja": "Ã°ÂÂÂ Ã¨Â³ÂÃ§ÂÂ£Ã¥ÂÂÃ¦ÂÂÃ¤Â¸Â­Ã£ÂÂ§Ã£ÂÂÃ£ÂÂ\nÃ¥Â°ÂÃ£ÂÂÃ£ÂÂÃ¥Â¾ÂÃ£ÂÂ¡Ã£ÂÂÃ£ÂÂ Ã£ÂÂÃ£ÂÂ...",
            "en": "Ã°ÂÂÂ Analyzing your assets.\nPlease wait...",
            "ko": "Ã°ÂÂÂ Ã¬ÂÂÃ¬ÂÂ° Ã«Â¶ÂÃ¬ÂÂ Ã¬Â¤ÂÃ¬ÂÂÃ«ÂÂÃ«ÂÂ¤.\nÃ¬ÂÂ Ã¬ÂÂ ÃªÂ¸Â°Ã«ÂÂ¤Ã«Â Â¤Ã¬Â£Â¼Ã¬ÂÂ¸Ã¬ÂÂ...",
            "zh": "Ã°ÂÂÂ Ã¦Â­Â£Ã¥ÂÂ¨Ã¥ÂÂÃ¦ÂÂÃ¦ÂÂ¨Ã§ÂÂÃ¨ÂµÂÃ¤ÂºÂ§Ã£ÂÂ\nÃ¨Â¯Â·Ã§Â¨ÂÃ¥ÂÂ...",
        },
        "no_assets": {
            "ja": "Ã£ÂÂ¾Ã£ÂÂ Ã¨Â³ÂÃ§ÂÂ£Ã¦ÂÂÃ¥Â Â±Ã£ÂÂÃ§ÂÂ»Ã©ÂÂ²Ã£ÂÂÃ£ÂÂÃ£ÂÂ¦Ã£ÂÂÃ£ÂÂ¾Ã£ÂÂÃ£ÂÂÃ£ÂÂ\nÃ£ÂÂÃ§ÂÂ»Ã©ÂÂ²Ã£ÂÂÃ£ÂÂ¨Ã©ÂÂÃ£ÂÂ£Ã£ÂÂ¦Ã¦ÂÂÃ¥Â Â±Ã£ÂÂÃ§ÂÂ»Ã©ÂÂ²Ã£ÂÂÃ£ÂÂ¦Ã£ÂÂÃ£ÂÂ Ã£ÂÂÃ£ÂÂÃ°ÂÂÂ",
            "en": "No asset info registered yet.\nPlease send 'register' to add your infoÃ°ÂÂÂ",
            "ko": "Ã¬ÂÂÃ¬Â§Â Ã¬ÂÂÃ¬ÂÂ° Ã¬Â ÂÃ«Â³Â´ÃªÂ°Â Ã¬ÂÂÃ¬ÂÂµÃ«ÂÂÃ«ÂÂ¤.\n'Ã«ÂÂ±Ã«Â¡Â'Ã¬ÂÂ Ã«Â³Â´Ã«ÂÂ´Ã¬Â£Â¼Ã¬ÂÂ¸Ã¬ÂÂÃ°ÂÂÂ",
            "zh": "Ã¥Â°ÂÃ¦ÂÂªÃ¦Â³Â¨Ã¥ÂÂÃ¨ÂµÂÃ¤ÂºÂ§Ã¤Â¿Â¡Ã¦ÂÂ¯Ã£ÂÂ\nÃ¨Â¯Â·Ã¥ÂÂÃ©ÂÂ'Ã¦Â³Â¨Ã¥ÂÂ'Ã°ÂÂÂ",
        },
        "saved": {
            "ja": "Ã¢ÂÂ Ã¤Â¿ÂÃ¥Â­ÂÃ£ÂÂÃ£ÂÂ¾Ã£ÂÂÃ£ÂÂÃ¯Â¼Â\nÃ£ÂÂÃ¥ÂÂÃ¦ÂÂÃ£ÂÂÃ£ÂÂ¦Ã£ÂÂÃ£ÂÂ¨Ã©ÂÂÃ£ÂÂÃ£ÂÂ¨Ã¨Â³ÂÃ§ÂÂ£Ã¥ÂÂÃ¦ÂÂÃ£ÂÂÃ£ÂÂ§Ã£ÂÂÃ£ÂÂ¾Ã£ÂÂÃ°ÂÂÂ",
            "en": "Ã¢ÂÂ Saved!\nSend 'analyze' to get your asset analysisÃ°ÂÂÂ",
            "ko": "Ã¢ÂÂ Ã¬Â ÂÃ¬ÂÂ¥Ã­ÂÂÃ¬ÂÂµÃ«ÂÂÃ«ÂÂ¤Ã¯Â¼Â\n'Ã«Â¶ÂÃ¬ÂÂ'Ã¬ÂÂ Ã«Â³Â´Ã«ÂÂ´Ã¬Â£Â¼Ã¬ÂÂ¸Ã¬ÂÂÃ°ÂÂÂ",
            "zh": "Ã¢ÂÂ Ã¥Â·Â²Ã¤Â¿ÂÃ¥Â­ÂÃ¯Â¼Â\nÃ¥ÂÂÃ©ÂÂ'Ã¥ÂÂÃ¦ÂÂ'Ã¥ÂÂ³Ã¥ÂÂ¯Ã°ÂÂÂ",
        },
        "waiting": {
            "ja": "Ã§Â¢ÂºÃ¨ÂªÂÃ£ÂÂÃ£ÂÂ¦Ã£ÂÂÃ£ÂÂ¾Ã£ÂÂÃ£ÂÂÃ¥Â°ÂÃ£ÂÂÃ£ÂÂÃ¥Â¾ÂÃ£ÂÂ¡Ã£ÂÂÃ£ÂÂ Ã£ÂÂÃ£ÂÂ...",
            "en": "Checking. Please wait...",
            "ko": "Ã­ÂÂÃ¬ÂÂ¸ Ã¬Â¤ÂÃ¬ÂÂÃ«ÂÂÃ«ÂÂ¤. Ã¬ÂÂ Ã¬ÂÂ ÃªÂ¸Â°Ã«ÂÂ¤Ã«Â Â¤Ã¬Â£Â¼Ã¬ÂÂ¸Ã¬ÂÂ...",
            "zh": "Ã¦Â­Â£Ã¥ÂÂ¨Ã§Â¡Â®Ã¨Â®Â¤Ã£ÂÂÃ¨Â¯Â·Ã§Â¨ÂÃ¥ÂÂ...",
        },
    }
    return messages.get(key, {}).get(lang, messages.get(key, {}).get("ja", ""))

def detect_intent(text, lang="ja"):
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    prompt = f"""
Ã£ÂÂ¦Ã£ÂÂ¼Ã£ÂÂ¶Ã£ÂÂ¼Ã£ÂÂ®Ã£ÂÂ¡Ã£ÂÂÃ£ÂÂ»Ã£ÂÂ¼Ã£ÂÂ¸Ã£ÂÂÃ¨ÂªÂ­Ã£ÂÂÃ£ÂÂ§Ã£ÂÂÃ¦ÂÂÃ¥ÂÂ³Ã£ÂÂÃ¤Â»Â¥Ã¤Â¸ÂÃ£ÂÂ®6Ã£ÂÂ¤Ã£ÂÂÃ£ÂÂ1Ã£ÂÂ¤Ã£ÂÂ Ã£ÂÂÃ©ÂÂ¸Ã£ÂÂÃ£ÂÂ§Ã£ÂÂÃ£ÂÂ Ã£ÂÂÃ£ÂÂÃ£ÂÂ
Ã¥ÂÂÃ§Â­ÂÃ£ÂÂ¯Ã¥Â¿ÂÃ£ÂÂÃ£ÂÂÃ£ÂÂ®Ã¥ÂÂÃ¨ÂªÂ1Ã£ÂÂ¤Ã£ÂÂ Ã£ÂÂÃ¨Â¿ÂÃ£ÂÂÃ£ÂÂ¦Ã£ÂÂÃ£ÂÂ Ã£ÂÂÃ£ÂÂÃ£ÂÂÃ¤Â»ÂÃ£ÂÂ®Ã¨Â¨ÂÃ¨ÂÂÃ£ÂÂ¯Ã¤Â¸ÂÃ¥ÂÂÃ¤Â¸ÂÃ¨Â¦ÂÃ£ÂÂ§Ã£ÂÂÃ£ÂÂ

Ã©ÂÂ¸Ã¦ÂÂÃ¨ÂÂ¢Ã¯Â¼Â
- morning    Ã¢ÂÂ¦ Ã¦ÂÂÃ£ÂÂ¬Ã£ÂÂ¿Ã£ÂÂ¼Ã£ÂÂ»Ã¤Â»ÂÃ¦ÂÂ¥Ã£ÂÂ®Ã§ÂÂ¸Ã¥Â Â´Ã£ÂÂ»Ã£ÂÂÃ£ÂÂ¥Ã£ÂÂ¼Ã£ÂÂ¹Ã£ÂÂÃ¨Â¦ÂÃ£ÂÂÃ£ÂÂ
- register   Ã¢ÂÂ¦ Ã¦ÂÂÃ¥Â Â±Ã§ÂÂ»Ã©ÂÂ²Ã£ÂÂ»Ã¥ÂÂÃ¥ÂÂ Ã£ÂÂÃ£ÂÂÃ£ÂÂÃ£ÂÂ»Ã¥Â§ÂÃ£ÂÂÃ£ÂÂÃ£ÂÂÃ£ÂÂ»Ã¦ÂÂ°Ã¨Â¦ÂÃ§ÂÂ»Ã©ÂÂ²Ã£ÂÂ»Ã¤Â½Â¿Ã£ÂÂÃ£ÂÂÃ£ÂÂ
- analyze    Ã¢ÂÂ¦ Ã¨ÂÂªÃ¥ÂÂÃ£ÂÂ®Ã¨Â³ÂÃ§ÂÂ£Ã£ÂÂÃ¥ÂÂÃ¦ÂÂÃ£ÂÂÃ£ÂÂ¦Ã£ÂÂ»Ã£ÂÂÃ£ÂÂÃ£ÂÂ»Ã£ÂÂÃ£ÂÂ¼Ã£ÂÂÃ£ÂÂÃ£ÂÂ©Ã£ÂÂªÃ£ÂÂªÃ§Â¢ÂºÃ¨ÂªÂ
- save       Ã¢ÂÂ¦ Ã£ÂÂ³Ã£ÂÂ­Ã£ÂÂ³Ã¯Â¼ÂÃ¯Â¼ÂÃ£ÂÂ¾Ã£ÂÂÃ£ÂÂ¯:Ã¯Â¼ÂÃ£ÂÂÃ¥ÂÂ«Ã£ÂÂÃ¦ÂÂÃ¥Â Â±Ã¥ÂÂ¥Ã¥ÂÂ
- simulator  Ã¢ÂÂ¦ Ã£ÂÂ·Ã£ÂÂÃ£ÂÂ¥Ã£ÂÂ¬Ã£ÂÂ¼Ã£ÂÂ¿Ã£ÂÂ¼Ã£ÂÂ»Ã¦ÂÂÃ¨Â³ÂÃ¨Â¨ÂÃ§Â®ÂÃ£ÂÂ»Ã©ÂÂÃ§ÂÂ¨Ã¨Â¨ÂÃ§Â®ÂÃ£ÂÂÃ¨Â¦ÂÃ£ÂÂÃ£ÂÂ
- question   Ã¢ÂÂ¦ Ã¤Â¸ÂÃ¨Â¨ÂÃ¤Â»Â¥Ã¥Â¤ÂÃ£ÂÂ®Ã¨Â³ÂªÃ¥ÂÂÃ£ÂÂ»Ã©ÂÂÃ¨Â«ÂÃ£ÂÂ»Ã£ÂÂÃ£ÂÂ®Ã¤Â»Â

Ã£ÂÂ¦Ã£ÂÂ¼Ã£ÂÂ¶Ã£ÂÂ¼Ã£ÂÂ®Ã£ÂÂ¡Ã£ÂÂÃ£ÂÂ»Ã£ÂÂ¼Ã£ÂÂ¸Ã¯Â¼ÂÃ£ÂÂ{text}Ã£ÂÂ

Ã¥ÂÂÃ§Â­ÂÃ¯Â¼Â1Ã¥ÂÂÃ¨ÂªÂÃ£ÂÂ®Ã£ÂÂ¿Ã¯Â¼ÂÃ¯Â¼Â"""

    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=10,
        messages=[{"role": "user", "content": prompt}]
    )
    intent = msg.content[0].text.strip().lower()
    if intent not in ["morning", "register", "analyze", "save", "simulator", "question"]:
        intent = "question"
    return intent

def parse_and_save_user_info(line_user_id, text):
    data = {}
    lines = text.strip().split("\n")
    for line in lines:
        if "Ã¥ÂÂÃ¥ÂÂÃ¯Â¼Â" in line or "Ã¥ÂÂÃ¥ÂÂ:" in line or "Name:" in line or "name:" in line:
            data["name"] = line.split("Ã¯Â¼Â")[-1].split(":")[-1].strip()
        elif "Ã¥Â¹Â´Ã¥ÂÂÃ¯Â¼Â" in line or "Ã¥Â¹Â´Ã¥ÂÂ:" in line or "income:" in line.lower():
            data["financial_info"] = line.strip()
        elif "Ã§Â·ÂÃ¨Â³ÂÃ§ÂÂ£Ã¯Â¼Â" in line or "Ã§Â·ÂÃ¨Â³ÂÃ§ÂÂ£:" in line or "total assets:" in line.lower():
            data["target_asset"] = line.strip()
        elif "Ã¦Â¯ÂÃ¦ÂÂÃ¦ÂÂÃ¨Â³ÂÃ©Â¡ÂÃ¯Â¼Â" in line or "Ã¦Â¯ÂÃ¦ÂÂÃ¦ÂÂÃ¨Â³ÂÃ©Â¡Â:" in line or "monthly:" in line.lower():
            data["savings"] = line.strip()
        elif "Ã§ÂÂ®Ã¦Â¨ÂÃ¨Â³ÂÃ§ÂÂ£Ã¯Â¼Â" in line or "Ã§ÂÂ®Ã¦Â¨ÂÃ¨Â³ÂÃ§ÂÂ£:" in line or "target:" in line.lower():
            data["target_asset"] = line.strip()
        elif "Ã¤Â¿ÂÃ¦ÂÂÃ¦Â ÂªÃ¯Â¼Â" in line or "Ã¤Â¿ÂÃ¦ÂÂÃ¦Â Âª:" in line or "stocks owned:" in line.lower():
            data["stocks_owned"] = line.split("Ã¯Â¼Â")[-1].split(":")[-1].strip()
        elif "Ã£ÂÂÃ£ÂÂ¬Ã£ÂÂ¼Ã£ÂÂÃ©ÂÂÃ¦ÂÂÃ¯Â¼Â" in line or "Ã£ÂÂÃ£ÂÂ¬Ã£ÂÂ¼Ã£ÂÂÃ©ÂÂÃ¦ÂÂ:" in line or "trading:" in line.lower():
            data["stocks_traded"] = line.split("Ã¯Â¼Â")[-1].split(":")[-1].strip()
        elif "Ã¥ÂÂºÃ¨Â²Â»Ã¯Â¼Â" in line or "Ã¥ÂÂºÃ¨Â²Â»:" in line or "expenses:" in line.lower():
            data["expenses"] = line.strip()
    if data:
        save_user(line_user_id, data)

def analyze_portfolio(user_info, lang="ja"):
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    today = date.today().strftime("%Y-%m-%d")
    market = fetch_market_data()
    market_text = "\n".join([f"- {k}: {v['display']}" for k, v in market.items()])
    stocks_owned = user_info.get("stocks_owned", "not registered")
    lang_names = {"ja": "Japanese", "en": "English", "ko": "Korean", "zh": "Chinese"}
    lang_name = lang_names.get(lang, "English")
    prompt = f"""
You are a personal asset advisor. Today is {today}.
You MUST respond in {lang_name} only.

User asset information:
- Name: {user_info.get('name', 'not registered')}
- Stocks owned: {stocks_owned}
- Trading stocks: {user_info.get('stocks_traded', 'not registered')}
- Savings/Investment: {user_info.get('savings', 'not registered')}
- Target assets: {user_info.get('target_asset', 'not registered')}
- Expenses: {user_info.get('expenses', 'not registered')}
- Financial info: {user_info.get('financial_info', 'not registered')}

Market data:
{market_text}

Please analyze:
1. Current stock evaluation and today's movement
2. Path and timeline to target assets (with specific numbers)
3. Savings simulation
4. Accurate advice for current situation
5. Points for improvement

Rules:
- Never use ## or **
- Use emoji moderately
- Use specific numbers
- Keep readable on smartphone
- Handle personal info carefully
"""
    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1000,
        messages=[{"role": "user", "content": prompt}]
    )
    return msg.content[0].text

def send_line_message(text, user_id=None):
    uid = user_id or LINE_USER_ID
    with ApiClient(configuration) as api_client:
        api = MessagingApi(api_client)
        chunks = [text[i:i+4500] for i in range(0, len(text), 4500)]
        for chunk in chunks:
            api.push_message(PushMessageRequest(
                to=uid,
                messages=[TextMessage(text=chunk)]
            ))

def fetch_market_data():
    tickers = {
        "Ã¦ÂÂ¥Ã§ÂµÂ225":    "^N225",
        "Ã£ÂÂÃ£ÂÂ«Ã¥ÂÂ":     "JPY=X",
        "Ã§Â±Â³10Ã¥Â¹Â´Ã©ÂÂÃ¥ÂÂ©": "^TNX",
        "S&P500":    "^GSPC",
        "NYÃ£ÂÂÃ£ÂÂ¦":     "^DJI",
        "VIXÃ¦ÂÂÃ¦ÂÂÃ¦ÂÂÃ¦ÂÂ°":"^VIX",
    }
    results = {}
    for label, symbol in tickers.items():
        try:
            hist = yf.Ticker(symbol).history(period="5d")
            if len(hist) >= 2:
                val   = hist["Close"].iloc[-1]
                prev  = hist["Close"].iloc[-2]
                pct   = (val - prev) / prev * 100
                arrow = "Ã¢ÂÂ²" if pct >= 0 else "Ã¢ÂÂ¼"
                results[label] = {
                    "display": f"{val:,.2f}Ã£ÂÂ{arrow}{abs(pct):.2f}%",
                    "pct": pct,
                    "value": val
                }
        except Exception:
            pass
    return results

def fetch_watchlist():
    results = []
    for symbol in WATCHLIST:
        try:
            t    = yf.Ticker(symbol)
            hist = t.history(period="5d")
            name = t.info.get("shortName") or symbol
            if len(hist) >= 2:
                val   = hist["Close"].iloc[-1]
                prev  = hist["Close"].iloc[-2]
                pct   = (val - prev) / prev * 100
                arrow = "Ã¢ÂÂ²" if pct >= 0 else "Ã¢ÂÂ¼"
                results.append({
                    "symbol": symbol,
                    "name": name,
                    "display": f"{name}Ã¯Â¼Â{symbol}Ã¯Â¼ÂÃ£ÂÂ{val:,.0f}Ã¥ÂÂÃ£ÂÂ{arrow}{abs(pct):.2f}%"
                })
        except Exception:
            pass
    return results

def fetch_news():
    rss = {
        "NHKÃ§ÂµÂÃ¦Â¸Â":      "https://www.nhk.or.jp/rss/news/cat5.xml",
        "NHKÃ¦Â ÂªÃ£ÂÂ»Ã¤Â¼ÂÃ¦Â¥Â­":  "https://www.nhk.or.jp/rss/news/cat4.xml",
        "Ã£ÂÂ­Ã£ÂÂ¤Ã£ÂÂ¿Ã£ÂÂ¼Ã§ÂµÂÃ¦Â¸Â":  "https://feeds.reuters.com/reuters/businessNews",
        "Ã£ÂÂ­Ã£ÂÂ¤Ã£ÂÂ¿Ã£ÂÂ¼Ã§Â±Â³Ã¥ÂÂ½Ã¦Â Âª":"https://feeds.reuters.com/reuters/companyNews",
    }
    all_news = {}
    for label, url in rss.items():
        feed = feedparser.parse(url)
        all_news[label] = "\n".join([f"Ã£ÂÂ»{e.title}" for e in feed.entries[:7]])
    return all_news

def generate_morning_report():
    market    = fetch_market_data()
    watchlist = fetch_watchlist()
    news      = fetch_news()
    today     = date.today().strftime("%YÃ¥Â¹Â´%mÃ¦ÂÂ%dÃ¦ÂÂ¥")
    weekday   = ["Ã¦ÂÂ","Ã§ÂÂ«","Ã¦Â°Â´","Ã¦ÂÂ¨","Ã©ÂÂ","Ã¥ÂÂ","Ã¦ÂÂ¥"][date.today().weekday()]

    market_text    = "\n".join([f"Ã£ÂÂ»{k}Ã¯Â¼Â{v['display']}" for k, v in market.items()])
    watchlist_text = "\n".join([s["display"] for s in watchlist])
    news_text      = "\n".join([f"Ã£ÂÂ{k}Ã£ÂÂ\n{v}" for k, v in news.items()])

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    prompt = f"""
Ã£ÂÂÃ£ÂÂªÃ£ÂÂÃ£ÂÂ¯Ã£ÂÂÃ¦Â ÂªÃ£ÂÂ®Ã¥ÂÂÃ¥Â¿ÂÃ¨ÂÂÃ£ÂÂ«Ã¦Â¯ÂÃ¦ÂÂÃ£ÂÂÃ¤Â»ÂÃ¦ÂÂ¥Ã£ÂÂ®Ã¦ÂÂÃ¨Â³ÂÃ¥ÂÂ¤Ã¦ÂÂ­Ã¦ÂÂÃ¦ÂÂÃ£ÂÂÃ£ÂÂÃ¥Â±ÂÃ£ÂÂÃ£ÂÂÃ£ÂÂÃ¦Â­Â£Ã§Â¢ÂºÃ£ÂÂ§Ã¨Â¦ÂªÃ¥ÂÂÃ£ÂÂªÃ¥ÂÂÃ§ÂÂÃ£ÂÂ§Ã£ÂÂÃ£ÂÂ

Ã£ÂÂÃ§ÂµÂ¶Ã¥Â¯Â¾Ã£ÂÂ«Ã¥Â®ÂÃ£ÂÂÃ£ÂÂ«Ã£ÂÂ¼Ã£ÂÂ«Ã£ÂÂ
Ã£ÂÂ»Ã¥Â°ÂÃ©ÂÂÃ§ÂÂ¨Ã¨ÂªÂÃ£ÂÂ¯Ã¥Â¿ÂÃ£ÂÂÃ¯Â¼ÂÃ¯Â¼ÂÃ£ÂÂ§Ã¨ÂªÂ¬Ã¦ÂÂÃ£ÂÂÃ£ÂÂ
Ã£ÂÂ»Ã§ÂÂÃ§ÂÂ±Ã£ÂÂÃ¥Â¿ÂÃ£ÂÂÃ¦ÂÂ¸Ã£ÂÂ
Ã£ÂÂ»Ã¤Â¸ÂÃ§Â¢ÂºÃ£ÂÂÃ£ÂÂªÃ£ÂÂÃ£ÂÂ¨Ã£ÂÂ¯Ã¦ÂÂ¸Ã£ÂÂÃ£ÂÂªÃ£ÂÂ
Ã£ÂÂ»##Ã£ÂÂ**Ã£ÂÂªÃ£ÂÂ©Ã£ÂÂ®Ã¨Â¨ÂÃ¥ÂÂ·Ã£ÂÂ¯Ã§ÂµÂ¶Ã¥Â¯Â¾Ã£ÂÂ«Ã¤Â½Â¿Ã£ÂÂÃ£ÂÂªÃ£ÂÂ
Ã£ÂÂ»Ã¨Â¦ÂÃ¥ÂÂºÃ£ÂÂÃ£ÂÂ¯Ã£ÂÂÃ£ÂÂÃ£ÂÂ§Ã¥ÂÂ²Ã£ÂÂ
Ã£ÂÂ»Ã¥ÂÂºÃ¥ÂÂÃ£ÂÂÃ§Â·ÂÃ£ÂÂ¯ Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ Ã£ÂÂÃ¤Â½Â¿Ã£ÂÂ
Ã£ÂÂ»Ã§ÂµÂµÃ¦ÂÂÃ¥Â­ÂÃ£ÂÂÃ©ÂÂ©Ã¥ÂºÂ¦Ã£ÂÂ«Ã¤Â½Â¿Ã£ÂÂ
Ã£ÂÂ»Ã£ÂÂ¹Ã£ÂÂÃ£ÂÂÃ£ÂÂ®Ã§Â¸Â¦Ã§ÂÂ»Ã©ÂÂ¢Ã£ÂÂ§Ã¨ÂªÂ­Ã£ÂÂ¿Ã£ÂÂÃ£ÂÂÃ£ÂÂÃ£ÂÂÃ£ÂÂÃ£ÂÂ1Ã¨Â¡ÂÃ£ÂÂÃ§ÂÂ­Ã£ÂÂÃ£ÂÂ«Ã£ÂÂÃ£ÂÂ
Ã£ÂÂ»Ã¥Â¸ÂÃ¥Â Â´Ã£ÂÂ®Ã©ÂÂ°Ã¥ÂÂ²Ã¦Â°ÂÃ°ÂÂÂ¢Ã¨ÂÂ½Ã£ÂÂ¡Ã§ÂÂÃ£ÂÂÃ£ÂÂ¦Ã£ÂÂÃ£ÂÂÃ°ÂÂÂ¡Ã£ÂÂÃ£ÂÂÃ¤Â¸ÂÃ¥Â®ÂÃ°ÂÂÂ´Ã£ÂÂÃ£ÂÂÃ£ÂÂÃ£ÂÂ¯Ã£ÂÂ®Ã£ÂÂ©Ã£ÂÂÃ£ÂÂÃ£ÂÂ Ã£ÂÂÃ£ÂÂ§Ã¨Â¡Â¨Ã§Â¤ÂºÃ£ÂÂÃ£ÂÂ

Ã¤Â»ÂÃ¦ÂÂ¥Ã¯Â¼Â{today}Ã¯Â¼Â{weekday}Ã¦ÂÂÃ¦ÂÂ¥Ã¯Â¼Â

Ã£ÂÂÃ¥Â¸ÂÃ¥Â Â´Ã£ÂÂÃ£ÂÂ¼Ã£ÂÂ¿Ã¯Â¼ÂÃ¥ÂÂÃ¦ÂÂ¥Ã§ÂµÂÃ¥ÂÂ¤Ã¯Â¼ÂÃ£ÂÂ
{market_text}

Ã£ÂÂÃ£ÂÂ¦Ã£ÂÂ©Ã£ÂÂÃ£ÂÂÃ£ÂÂªÃ£ÂÂ¹Ã£ÂÂÃ©ÂÂÃ¦ÂÂÃ£ÂÂ
{watchlist_text}

Ã£ÂÂÃ¤Â»ÂÃ¦ÂÂ¥Ã£ÂÂ®Ã£ÂÂÃ£ÂÂ¥Ã£ÂÂ¼Ã£ÂÂ¹Ã¯Â¼ÂÃ¨Â¤ÂÃ¦ÂÂ°Ã£ÂÂ½Ã£ÂÂ¼Ã£ÂÂ¹Ã¯Â¼ÂÃ£ÂÂ
{news_text}

Ã¢ÂÂÃ¯Â¸Â {today}Ã¯Â¼Â{weekday}Ã¯Â¼ÂÃ£ÂÂ®Ã¦ÂÂÃ£ÂÂ¬Ã£ÂÂ¿Ã£ÂÂ¼
Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
Ã¤Â»ÂÃ¦ÂÂ¥Ã£ÂÂ®Ã¤Â¸ÂÃ¨Â¨ÂÃ¯Â¼ÂÃ¯Â¼ÂÃ¤Â»ÂÃ¦ÂÂ¥Ã£ÂÂ®Ã§ÂÂ¸Ã¥Â Â´Ã£ÂÂÃ¤Â¸ÂÃ¦ÂÂÃ£ÂÂ§Ã¨Â¡Â¨Ã£ÂÂÃ¯Â¼Â
Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ

Ã¢ÂÂÃ¢ÂÂ Ã°ÂÂÂ Ã¥Â¸ÂÃ¥Â Â´Ã£ÂÂÃ£ÂÂ¼Ã£ÂÂ¿ Ã¢ÂÂÃ¢ÂÂ
Ã¢ÂÂÃ¢ÂÂ Ã°ÂÂÂ´ Ã£ÂÂÃ£ÂÂ«Ã¥ÂÂÃ£ÂÂ¨Ã©ÂÂÃ¥ÂÂ©Ã¯Â¼ÂÃ¤Â»ÂÃ¦ÂÂ¥Ã£ÂÂ®Ã¥Â½Â±Ã©ÂÂ¿ Ã¢ÂÂÃ¢ÂÂ
Ã¢ÂÂÃ¢ÂÂ Ã°ÂÂÂ° Ã¤Â»ÂÃ¦ÂÂ¥Ã£ÂÂ®Ã©ÂÂÃ¨Â¦ÂÃ£ÂÂÃ£ÂÂ¥Ã£ÂÂ¼Ã£ÂÂ¹ Ã¢ÂÂÃ¢ÂÂ
Ã¢ÂÂÃ¢ÂÂ Ã°ÂÂÂÃ¯Â¸Â Ã¤Â»ÂÃ¦ÂÂ¥Ã£ÂÂ®Ã§ÂÂ¸Ã¥Â Â´Ã¤ÂºÂÃ¦ÂÂ³ Ã¢ÂÂÃ¢ÂÂ
Ã¢ÂÂÃ¢ÂÂ Ã°ÂÂÂ¯ Ã¤Â»ÂÃ¦ÂÂ¥Ã£ÂÂ®Ã¥ÂÂÃ¥Â¼ÂÃ¥ÂÂ¤Ã¦ÂÂ­Ã¦ÂÂÃ¦ÂÂ Ã¢ÂÂÃ¢ÂÂ
Ã£ÂÂÃ£ÂÂÃ£ÂÂ¤Ã£ÂÂÃ£ÂÂ¬Ã£ÂÂ¼Ã£ÂÂÃ£ÂÂ
Ã£ÂÂÃ£ÂÂ¹Ã£ÂÂ¤Ã£ÂÂ³Ã£ÂÂ°Ã£ÂÂÃ£ÂÂ¬Ã£ÂÂ¼Ã£ÂÂÃ£ÂÂ
Ã£ÂÂÃ§Â©ÂÃ§Â«ÂÃ£ÂÂ»Ã¦ÂÂÃ¨Â³ÂÃ¤Â¿Â¡Ã¨Â¨ÂÃ£ÂÂ
Ã¢ÂÂÃ¢ÂÂ Ã°ÂÂÂ Ã£ÂÂ¦Ã£ÂÂ©Ã£ÂÂÃ£ÂÂÃ£ÂÂªÃ£ÂÂ¹Ã£ÂÂ Ã¢ÂÂÃ¢ÂÂ
{watchlist_text}
Ã¢ÂÂÃ¢ÂÂ Ã°ÂÂÂ¡ Ã¤Â»ÂÃ¦ÂÂ¥Ã£ÂÂ®Ã¤Â¸ÂÃ¨ÂªÂ Ã¢ÂÂÃ¢ÂÂ
Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
Ã¤Â»ÂÃ¦ÂÂ¥Ã£ÂÂÃ¦Â­Â£Ã§Â¢ÂºÃ£ÂÂ«Ã£ÂÂÃ¨ÂÂªÃ¥ÂÂÃ£ÂÂ®Ã£ÂÂÃ£ÂÂ¼Ã£ÂÂ¹Ã£ÂÂ§Ã£ÂÂ
Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
"""

    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1000,
        messages=[{"role": "user", "content": prompt}]
    )
    return msg.content[0].text

def answer_question(user_question, user_info=None, lang="ja"):
    market      = fetch_market_data()
    market_text = "\n".join([f"- {k}: {v['display']}" for k, v in market.items()])
    today       = date.today().strftime("%Y-%m-%d")

    user_context = ""
    if user_info:
        user_context = f"""
User profile:
- Name: {user_info.get('name', 'not registered')}
- Stocks owned: {user_info.get('stocks_owned', 'not registered')}
- Savings: {user_info.get('savings', 'not registered')}
- Target assets: {user_info.get('target_asset', 'not registered')}
- Expenses: {user_info.get('expenses', 'not registered')}
Respond based on this user's profile. Keep personal info confidential.
"""

    lang_names = {"ja": "Japanese", "en": "English", "ko": "Korean", "zh": "Chinese"}
    lang_name = lang_names.get(lang, "English")

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    prompt = f"""
You are an investment analyst for beginners. Today is {today}.
You MUST respond in {lang_name} only. Do not use any other language.
{user_context}
Current market data:
{market_text}

User question: "{user_question}"

Rules:
- Explain in simple terms anyone can understand
- Always explain financial terms in parentheses
- Do not write uncertain information
- Never use ## or ** symbols
- Use emoji moderately
- Keep response readable on smartphone
"""
    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=800,
        messages=[{"role": "user", "content": prompt}]
    )
    return msg.content[0].text

def check_alerts():
    state_file = "/tmp/alert_state.json"
    try:
        with open(state_file) as f:
            state = json.load(f)
    except Exception:
        state = {}

    today_str = date.today().isoformat()
    now = datetime.now()
    if not (9 <= now.hour < 15 or (now.hour == 15 and now.minute <= 30)):
        return

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    def make_alert(name, symbol, price, pct, market_ctx):
        direction = "Ã¦ÂÂ¥Ã¤Â¸ÂÃ¦ÂÂÃ°ÂÂÂ" if pct > 0 else "Ã¦ÂÂ¥Ã¨ÂÂ½Ã°ÂÂÂ"
        prompt = f"""
Ã¦ÂÂÃ¨Â³ÂÃ¥ÂÂÃ¥Â¿ÂÃ¨ÂÂÃ¥ÂÂÃ£ÂÂÃ£ÂÂ®Ã§Â·ÂÃ¦ÂÂ¥Ã£ÂÂ¢Ã£ÂÂ©Ã£ÂÂ¼Ã£ÂÂÃ£ÂÂÃ¦ÂÂ¸Ã£ÂÂÃ£ÂÂ¦Ã£ÂÂÃ£ÂÂ Ã£ÂÂÃ£ÂÂÃ£ÂÂ
Ã£ÂÂ»{name}Ã¯Â¼Â{symbol}Ã¯Â¼ÂÃ£ÂÂÃ¦ÂÂ¬Ã¦ÂÂ¥{abs(pct):.1f}%{direction}
Ã£ÂÂ»Ã§ÂÂ¾Ã¥ÂÂ¨Ã¥ÂÂ¤Ã¯Â¼Â{price:,.0f}Ã¥ÂÂ
Ã£ÂÂ»Ã¥Â¸ÂÃ¥Â Â´Ã§ÂÂ¶Ã¦Â³ÂÃ¯Â¼Â{market_ctx}

Ã¢ÂÂ¡Ã£ÂÂÃ§Â·ÂÃ¦ÂÂ¥Ã£ÂÂ{name}Ã£ÂÂ{direction}
Ã°ÂÂÂ Ã¤Â»ÂÃ¤Â½ÂÃ£ÂÂÃ¨ÂµÂ·Ã£ÂÂÃ£ÂÂ¦Ã£ÂÂÃ£ÂÂÃ£ÂÂ
Ã°ÂÂÂ Ã£ÂÂªÃ£ÂÂÃ¥ÂÂÃ£ÂÂÃ£ÂÂ¦Ã£ÂÂÃ£ÂÂÃ£ÂÂ
Ã°ÂÂÂ Ã£ÂÂÃ£ÂÂ¤Ã£ÂÂÃ£ÂÂ¬Ã£ÂÂ¼Ã£ÂÂÃ£ÂÂ¸Ã£ÂÂ®Ã¥Â½Â±Ã©ÂÂ¿
Ã°ÂÂÂ Ã£ÂÂ¹Ã£ÂÂ¤Ã£ÂÂ³Ã£ÂÂ°Ã£ÂÂÃ£ÂÂ¬Ã£ÂÂ¼Ã£ÂÂÃ£ÂÂ¸Ã£ÂÂ®Ã¥Â½Â±Ã©ÂÂ¿
Ã°ÂÂÂ Ã¦Â³Â¨Ã¦ÂÂÃ§ÂÂ¹Ã£ÂÂ»Ã£ÂÂªÃ£ÂÂ¹Ã£ÂÂ¯
Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
Ã¦ÂÂÃ§ÂµÂÃ¥ÂÂ¤Ã¦ÂÂ­Ã£ÂÂ¯Ã£ÂÂÃ¨ÂÂªÃ¨ÂºÂ«Ã£ÂÂ§Ã£ÂÂÃ©Â¡ÂÃ£ÂÂÃ£ÂÂÃ£ÂÂ¾Ã£ÂÂÃ£ÂÂ
"""
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=400,
            messages=[{"role": "user", "content": prompt}]
        )
        return msg.content[0].text

    market_ctx = ""
    try:
        n225 = yf.Ticker("^N225").history(period="2d")
        if len(n225) >= 2:
            val  = n225["Close"].iloc[-1]
            opn  = n225["Open"].iloc[0]
            pct  = (val - opn) / opn * 100
            arrow = "Ã¢ÂÂ²" if pct >= 0 else "Ã¢ÂÂ¼"
            market_ctx = f"Ã¦ÂÂ¥Ã§ÂµÂ225Ã¯Â¼Â{val:,.0f}Ã¥ÂÂÃ¯Â¼Â{arrow}{abs(pct):.1f}%Ã¯Â¼Â"
            if abs(pct) >= 1.5:
                key = f"nikkei_{today_str}_{int(pct)}"
                if key not in state:
                    alert = make_alert("Ã¦ÂÂ¥Ã§ÂµÂ225", "^N225", val, pct, market_ctx)
                    send_line_message(alert)
                    state[key] = now.isoformat()
    except Exception:
        pass

    try:
        usdjpy = yf.Ticker("JPY=X").history(period="2d")
        if len(usdjpy) >= 2:
            market_ctx += f"Ã£ÂÂÃ£ÂÂÃ£ÂÂ«Ã¥ÂÂÃ¯Â¼Â{usdjpy['Close'].iloc[-1]:.2f}Ã¥ÂÂ"
    except Exception:
        pass

    for symbol in WATCHLIST:
        try:
            t    = yf.Ticker(symbol)
            hist = t.history(period="2d")
            name = t.info.get("shortName") or symbol
            if len(hist) >= 2:
                val  = hist["Close"].iloc[-1]
                opn  = hist["Open"].iloc[0]
                pct  = (val - opn) / opn * 100
                if abs(pct) >= 3.0:
                    key = f"{symbol}_{today_str}_{int(pct)}"
                    if key not in state:
                        alert = make_alert(name, symbol, val, pct, market_ctx)
                        send_line_message(alert)
                        state[key] = now.isoformat()
        except Exception:
            pass

    with open(state_file, "w") as f:
        json.dump(state, f)

@app.route("/callback", methods=["POST"])
def callback():
    signature = request.headers.get("X-Line-Signature", "")
    body = request.get_data(as_text=True)
    try:
        handler.handle(body, signature)
    except InvalidSignatureError:
        abort(400)
    return "OK"

@handler.add(MessageEvent, message=TextMessageContent)
def handle_message(event):
    user_text    = event.message.text.strip()
    reply_token  = event.reply_token
    line_user_id = event.source.user_id
    lang         = detect_language(user_text)

    with ApiClient(configuration) as api_client:
        api = MessagingApi(api_client)

        intent = detect_intent(user_text, lang)

        if intent == "morning":
            api.reply_message(ReplyMessageRequest(
                reply_token=reply_token,
                messages=[TextMessage(text=get_message(lang, "waiting_morning"))]
            ))
            report = generate_morning_report()
            send_line_message(report, user_id=line_user_id)

        elif intent == "register":
            api.reply_message(ReplyMessageRequest(
                reply_token=reply_token,
                messages=[TextMessage(text=get_message(lang, "register_form"))]
            ))

        elif intent == "analyze":
            api.reply_message(ReplyMessageRequest(
                reply_token=reply_token,
                messages=[TextMessage(text=get_message(lang, "analyzing"))]
            ))
            user_info = get_user(line_user_id)
            if not user_info or not user_info.get("stocks_owned"):
                send_line_message(get_message(lang, "no_assets"), user_id=line_user_id)
            else:
                analysis = analyze_portfolio(user_info, lang)
                send_line_message(analysis, user_id=line_user_id)

        elif intent == "simulator":
            sim_url = f"https://investment-bot-ta24.onrender.com/simulator?uid={line_user_id}"
            api.reply_message(ReplyMessageRequest(
                reply_token=reply_token,
                                messages=[TextMessage(text=f"Ã°ÂÂÂ Ã¦ÂÂÃ¨Â³ÂÃ£ÂÂ·Ã£ÂÂÃ£ÂÂ¥Ã£ÂÂ¬Ã£ÂÂ¼Ã£ÂÂ¿Ã£ÂÂ¼Ã£ÂÂ¯Ã£ÂÂÃ£ÂÂ¡Ã£ÂÂÃ¯Â¼Â\n{sim_url}")]
            ))

        elif intent == "save":
            parse_and_save_user_info(line_user_id, user_text)
            api.reply_message(ReplyMessageRequest(
                reply_token=reply_token,
                messages=[TextMessage(text=get_message(lang, "saved"))]
            ))

        else:
            api.reply_message(ReplyMessageRequest(
                reply_token=reply_token,
                messages=[TextMessage(text=get_message(lang, "waiting"))]
            ))
            user_info = get_user(line_user_id)
            answer = answer_question(user_text, user_info, lang)
            save_user(line_user_id, {"conversation_history": user_text})
            chunks = [answer[i:i+4500] for i in range(0, len(answer), 4500)]
            for chunk in chunks:
                send_line_message(chunk, user_id=line_user_id)

@app.route("/morning", methods=["GET"])
def morning():
    if request.args.get("secret", "") != os.environ.get("CRON_SECRET", ""):
        abort(403)
    report = generate_morning_report()
    try:
        all_users = supabase.table("users").select("line_user_id").execute()
        for u in all_users.data:
            uid = u.get("line_user_id")
            if uid:
                send_line_message(report, user_id=uid)
    except Exception:
        send_line_message(report)
    return "OK"

@app.route("/alert", methods=["GET"])
def alert():
    if request.args.get("secret", "") != os.environ.get("CRON_SECRET", ""):
        abort(403)
    check_alerts()
    return "OK"

@app.route("/api/user-data", methods=["GET"])
def api_user_data():
    uid = request.args.get("uid", "")
    if not uid:
        return jsonify({"error": "no uid"}), 400
    user = get_user(uid)
    if not user:
        return jsonify({}), 404
    safe = {
        "name": user.get("name"),
        "savings": user.get("savings"),
        "target_asset": user.get("target_asset"),
        "financial_info": user.get("financial_info"),
        "stocks_owned": user.get("stocks_owned"),
        "stocks_traded": user.get("stocks_traded"),
        "expenses": user.get("expenses"),
        "updated_at": user.get("updated_at"),
    }
    return jsonify(safe)

@app.route("/api/save-user-data", methods=["POST"])
def api_save_user_data():
    try:
        body = request.get_json(force=True) or {}
        uid = body.get("uid", "")
        if not uid:
            return jsonify({"error": "no uid"}), 400
        data = {}
        if body.get("name"): data["name"] = body["name"]
        if body.get("savings"): data["savings"] = body["savings"]
        if body.get("target_asset"): data["target_asset"] = body["target_asset"]
        if body.get("financial_info"): data["financial_info"] = body["financial_info"]
        if body.get("stocks_owned"): data["stocks_owned"] = body["stocks_owned"]
        if body.get("stocks_traded"): data["stocks_traded"] = body["stocks_traded"]
        if body.get("expenses"): data["expenses"] = body["expenses"]
        save_user(uid, data)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/simulator")
def simulator():
    with open("simulator.html", encoding="utf-8") as f:
            return f.read(), 200, {"Content-Type": "text/html; charset=utf-8"}
            
@app.route("/")
def index():
    with open("index.html", encoding="utf-8") as f:
        return f.read(), 200, {"Content-Type": "text/html; charset=utf-8"}

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
