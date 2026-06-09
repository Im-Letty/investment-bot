# v7 - green yellow bright
from supabase import create_client
import os
import anthropic
import json
import yfinance as yf
import feedparser
import requests
import threading
import time
import gc
from flask import Flask, request, abort, jsonify, redirect
from linebot.v3 import WebhookHandler
from linebot.v3.exceptions import InvalidSignatureError
from linebot.v3.messaging import (
    Configuration, ApiClient, MessagingApi,
    ReplyMessageRequest, TextMessage, PushMessageRequest
)
from linebot.v3.webhooks import MessageEvent, TextMessageContent, FollowEvent
from datetime import date, datetime
from datetime import timedelta
import base64
import re
import secrets as _secrets_mod
from urllib.parse import urlencode
try:
    from cryptography.fernet import Fernet
except Exception as _e_fernet:
    Fernet = None
try:
    from google_auth_oauthlib.flow import Flow
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build
except Exception as _e_google:
    Flow = None
    Credentials = None
    build = None

app = Flask(__name__)
APP_START_TIME = datetime.now()
APP_VERSION = "v41"

# === anthropic グローバルクライアント（メモリ節約: 毎回 new せず使い回す）===
_anthropic_client = None
def get_anthropic_client():
    global _anthropic_client
    if _anthropic_client is None:
        _anthropic_client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
    return _anthropic_client

ANTHROPIC_API_KEY   = os.environ.get("ANTHROPIC_API_KEY", "")
LINE_CHANNEL_SECRET = os.environ.get("LINE_CHANNEL_SECRET", "")
LINE_CHANNEL_TOKEN  = os.environ.get("LINE_CHANNEL_TOKEN", "")
LINE_USER_ID        = os.environ.get("LINE_USER_ID", "")
ADMIN_USER_ID       = os.environ.get("ADMIN_USER_ID", "") or os.environ.get("LINE_USER_ID", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

WATCHLIST = [
    "7203.T",  # トヨタ
    "6758.T",  # ソニー
    "9984.T",  # ソフトバンクグループ
    "6861.T",  # キーエンス
    "8306.T",  # 三菱UFJ
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

def get_user_lang(line_user_id):
    """Supabaseのusers.lang列から保存済み言語を取得。なければNone"""
    try:
        user = get_user(line_user_id)
        if user and user.get("lang"):
            return user["lang"]
    except Exception as e:
        print(f"[get_user_lang] error: {e}")
    return None

def set_user_lang(line_user_id, lang):
    """Supabaseのusers.lang列に言語を保存"""
    try:
        save_user(line_user_id, {"lang": lang})
    except Exception as e:
        print(f"[set_user_lang] error: {e}")

def detect_language(text):
    # ハングルがあれば韓国語
    if any('\uac00' <= c <= '\ud7a3' for c in text):
        return "ko"
    # ひらがな or カタカナがあれば日本語（日本語特有）
    if any('\u3040' <= c <= '\u309f' or '\u30a0' <= c <= '\u30ff' for c in text):
        return "ja"
    # 漢字のみなら中国語
    if any('\u4e00' <= c <= '\u9fff' for c in text):
        return "zh"
    return "en"

def get_message(lang, key):
    messages = {
        "waiting_morning": {
            "ja": "朝レターを生成中です。\n少々お待ちください（1〜2分）...",
            "en": "Generating morning report.\nPlease wait (1-2 min)...",
            "ko": "아침 레터를 생성 중입니다.\n잠시 기다려주세요...",
            "zh": "正在生成早报。\n请稍候...",
        },
        "register_form": {
            "ja": "📝 資産情報を登録します！\n\n以下の形式で送ってください：\n\n名前：〇〇\n年収：〇〇万円\n総資産：〇〇万円\n毎月投資額：〇〇万円\n目標資産：〇〇万円\n保有株：銘柄名 株数 取得価格円\nトレード銘柄：銘柄名",
            "en": "📝 Register your asset info!\n\nPlease send in this format:\n\nname: XX\nAnnual income: XX\nTotal assets: XX\nMonthly investment: XX\nTarget assets: XX\nStocks owned: Stock name Shares Price\nTrading stocks: Stock name",
            "ko": "📝 자산 정보를 등록합니다！\n\n다음 형식으로 보내주세요：\n\n이름：〇〇\n연수입：〇〇\n총자산：〇〇\n월 투자액：〇〇\n목표자산：〇〇\n보유주식：종목명 주수 가격\n트레이드 종목：종목명",
            "zh": "📝 注册资产信息！\n\n请按以下格式发送：\n\n姓名：〇〇\n年收入：〇〇\n总资产：〇〇\n每月投资额：〇〇\n目标资产：〇〇\n持有股票：股票名称 股数 价格\n交易股票：股票名称",
        },
        "analyzing": {
            "ja": "📊 資産分析中です。\n少々お待ちください...",
            "en": "📊 Analyzing your assets.\nPlease wait...",
            "ko": "📊 자산 분석 중입니다.\n잠시 기다려주세요...",
            "zh": "📊 正在分析您的资产。\n请稍候...",
        },
        "no_assets": {
            "ja": "まだ資産情報が登録されていません。\n「登録」と送って情報を登録してください😊",
            "en": "No asset info registered yet.\nPlease send 'register' to add your info😊",
            "ko": "아직 자산 정보가 없습니다.\n'등록'을 보내주세요😊",
            "zh": "尚未注册资产信息。\n请发送'注册'😊",
        },
        "saved": {
            "ja": "✅ 保存しました！\n「分析して」と送ると資産分析ができます😊",
            "en": "✅ Saved!\nSend 'analyze' to get your asset analysis😊",
            "ko": "✅ 저장했습니다！\n'분석'을 보내주세요😊",
            "zh": "✅ 已保存！\n发送'分析'即可😊",
        },
        "waiting": {
            "ja": "確認しています。少々お待ちください...",
            "en": "Checking. Please wait...",
            "ko": "확인 중입니다. 잠시 기다려주세요...",
            "zh": "正在确认。请稍候...",
        },
        "simulator_url": {
            "ja": "📊 投資シミュレーターはこちら！\n{url}",
            "en": "📊 Investment Simulator is here!\n{url}",
            "ko": "📊 투자 시뮬레이터는 여기에서!\n{url}",
            "zh": "📊 投资模拟器在这里！\n{url}",
        },
        "help_text": {
            "ja": "📚 使い方ガイド\n\n【コマンド】\n• 朝レター / ニュース → 今日の相場レター\n• 登録 → 資産情報を登録\n• 分析 / ポートフォリオ → 資産分析\n• シミュレーター → 投資シミュレーター\n• 設定 → 現在の設定を確認\n• ヘルプ → このメッセージを表示\n\n【言語切替】\n• lang ja → 日本語\n• lang en → English\n• lang ko → 한국어\n• lang zh → 中文",
            "en": "📚 How to Use\n\n[Commands]\n• morning / news → Today's market report\n• register → Register asset info\n• analyze / portfolio → Asset analysis\n• simulator → Investment simulator\n• settings → Check current settings\n• help → Show this message\n\n[Change Language]\n• lang ja → 日本語\n• lang en → English\n• lang ko → 한국어\n• lang zh → 中文",
            "ko": "📚 사용 안내\n\n[명령어]\n• 아침레터 / 뉴스 → 오늘의 시장 레터\n• 등록 → 자산 정보 등록\n• 분석 / 포트폴리오 → 자산 분석\n• 시뮬레이터 → 투자 시뮬레이터\n• 설정 → 현재 설정 확인\n• 도움말 → 이 메시지 표시\n\n[언어 변경]\n• lang ja → 日本語\n• lang en → English\n• lang ko → 한국어\n• lang zh → 中文",
            "zh": "📚 使用指南\n\n【命令】\n• 早报 / 新闻 → 今日市场早报\n• 注册 → 注册资产信息\n• 分析 / 投资组合 → 资产分析\n• 模拟器 → 投资模拟器\n• 设置 → 查看当前设置\n• 帮助 → 显示此消息\n\n【切换语言】\n• lang ja → 日本語\n• lang en → English\n• lang ko → 한국어\n• lang zh → 中文",
        },
        "settings_text": {
            "ja": "⚙️ 現在の設定\n\n• 言語：日本語 🇯🇵\n• 朝レター：毎朝8時に配信\n\n言語を変えたい場合は\nlang en / lang ko / lang zh\nのいずれかを送ってください。",
            "en": "⚙️ Current Settings\n\n• Language: English 🇬🇧\n• Morning Report: Delivered daily at 8 AM\n\nTo change language, send:\nlang ja / lang ko / lang zh",
            "ko": "⚙️ 현재 설정\n\n• 언어: 한국어 🇰🇷\n• 아침 레터: 매일 오전 8시 배달\n\n언어를 변경하려면:\nlang ja / lang en / lang zh\n중 하나를 보내주세요.",
            "zh": "⚙️ 当前设置\n\n• 语言：中文 🇨🇳\n• 早报：每天早上8点送达\n\n如需更改语言，请发送：\nlang ja / lang en / lang ko",
        },
        "lang_changed": {
            "ja": "✅ 言語を日本語に変更しました 🇯🇵",
            "en": "✅ Language changed to English 🇬🇧",
            "ko": "✅ 언어를 한국어로 변경했습니다 🇰🇷",
            "zh": "✅ 已将语言切换为中文 🇨🇳",
        },
        "market_header": {
            "ja": "📊 今日の相場",
            "en": "📊 Today's Market",
            "ko": "📊 오늘의 시장",
            "zh": "📊 今日市场",
        },
        "market_error": {
            "ja": "⚠️ 相場データを取得できませんでした。少し時間をおいて再度お試しください。",
            "en": "⚠️ Unable to fetch market data. Please try again in a moment.",
            "ko": "⚠️ 시장 데이터를 가져올 수 없습니다. 잠시 후 다시 시도해주세요.",
            "zh": "⚠️ 无法获取市场数据。请稍后再试。",
        },
        "news_header": {
            "ja": "📰 最新の市場ニュース",
            "en": "📰 Latest Market News",
            "ko": "📰 최신 시장 뉴스",
            "zh": "📰 最新市场新闻",
        },
        "news_error": {
            "ja": "⚠️ ニュースを取得できませんでした。少し時間をおいて再度お試しください。",
            "en": "⚠️ Unable to fetch news. Please try again in a moment.",
            "ko": "⚠️ 뉴스를 가져올 수 없습니다. 잠시 후 다시 시도해주세요.",
            "zh": "⚠️ 无法获取新闻。请稍后再试。",
        },
        "price_error": {
            "ja": "⚠️ 銘柄情報を取得できませんでした。銘柄コードをご確認ください（例：株価 7203 / price AAPL）",
            "en": "⚠️ Unable to fetch stock info. Please check the ticker symbol (e.g., price AAPL / 株価 7203)",
            "ko": "⚠️ 종목 정보를 가져올 수 없습니다. 종목 코드를 확인해주세요 (예: price AAPL)",
            "zh": "⚠️ 无法获取股票信息。请检查股票代码（例：price AAPL）",
        },
        "price_usage": {
            "ja": "💡 使い方：\n株価 7203 → トヨタ自動車\n株価 AAPL → Apple\nprice MSFT → Microsoft",
            "en": "💡 Usage:\nprice AAPL → Apple\nprice MSFT → Microsoft\nprice 7203.T → Toyota",
            "ko": "💡 사용법:\nprice AAPL → Apple\nprice MSFT → Microsoft\nprice 7203.T → Toyota",
            "zh": "💡 用法：\nprice AAPL → Apple\nprice MSFT → Microsoft\nprice 7203.T → 丰田",
        },
        "fx_header": {
            "ja": "💱 為替レート",
            "en": "💱 FX Rates",
            "ko": "💱 환율",
            "zh": "💱 汇率",
        },
        "fx_error": {
            "ja": "⚠️ 為替データを取得できませんでした。少し時間をおいて再度お試しください。",
            "en": "⚠️ Unable to fetch FX data. Please try again in a moment.",
            "ko": "⚠️ 환율 데이터를 가져올 수 없습니다. 잠시 후 다시 시도해주세요.",
            "zh": "⚠️ 无法获取汇率数据。请稍后再试。",
        },
        "welcome_text": {
            "ja": "👋 友だち追加ありがとうございます！\n\n📊 経済NEWSへようこそ\n投資・お金のニュースを毎朝お届けします。\n\n【最初に試してほしいこと】\n• 「朝レター」→ 今日の相場レター\n• 「相場」→ 主要指標サマリー\n• 「ニュース」→ 最新の市場ニュース\n• 「ヘルプ」→ 全コマンド一覧\n\n🌐 English / 한국어 / 中文 対応：\nlang en / lang ko / lang zh を送ってください。",
            "en": "👋 Thanks for adding me!\n\n📊 Welcome to Keizai NEWS\nDaily investment & money news every morning.\n\n[Try these first]\n• 'morning' → Today's market report\n• 'market' → Key index summary\n• 'news' → Latest market news\n• 'help' → All commands\n\n🌐 Other languages:\nlang ja / lang ko / lang zh",
            "ko": "👋 친구 추가 감사합니다！\n\n📊 경제NEWS에 오신 것을 환영합니다\n매일 아침 투자·돈 뉴스를 전해드립니다.\n\n[처음 시도해보세요]\n• '아침레터' → 오늘의 시장 레터\n• '시장' → 주요 지표 요약\n• '뉴스' → 최신 시장 뉴스\n• '도움말' → 전체 명령어\n\n🌐 다른 언어:\nlang ja / lang en / lang zh",
            "zh": "👋 感谢添加好友！\n\n📊 欢迎来到经济NEWS\n每天早上为您送上投资·金钱新闻。\n\n【请先尝试】\n• '早报' → 今日市场早报\n• '行情' → 主要指标摘要\n• '新闻' → 最新市场新闻\n• '帮助' → 全部命令\n\n🌐 其他语言：\nlang ja / lang en / lang ko",
        },
        "delivery_set": {
            "ja": "✅ 朝レターの配信時刻を {h}時 に設定しました 🕗\n（毎日この時刻にお届けします）",
            "en": "✅ Morning report delivery time set to {h}:00 🕗\n(Delivered daily at this time)",
            "ko": "✅ 아침 레터 배달 시각을 {h}시로 설정했습니다 🕗\n(매일 이 시간에 배달)",
            "zh": "✅ 早报推送时间已设定为 {h}:00 🕗\n（每天此时间送达）",
        },
        "delivery_usage": {
            "ja": "📌 使い方:\n「配信時刻 8」のように 0〜23 の数字を送ってください。\n例: 配信時刻 7 / 配信時刻 21",
            "en": "📌 Usage:\nSend a number 0–23, e.g.\n\"delivery 8\" or \"delivery 21\"",
            "ko": "📌 사용법:\n0〜23 사이의 숫자를 보내주세요. 예: 배달시각 7",
            "zh": "📌 使用方法:\n请发送 0〜23 之间的数字。例: 推送时间 8",
        },
        "delivery_error": {
            "ja": "❌ 時刻は 0〜23 の数字で指定してください。\n例: 配信時刻 8",
            "en": "❌ Please specify hour as 0–23.\nExample: delivery 8",
            "ko": "❌ 시각은 0〜23 사이의 숫자로 지정해주세요.\n예: 배달시각 8",
            "zh": "❌ 请用 0〜23 之间的数字指定时间。\n例: 推送时间 8",
        },
        "calc_usage": {
            "ja": "💡 複利計算の使い方：\n複利 元本(万円) 年利(%) 年数 [毎月積立(万円)]\n\n例：\n複利 100 5 10\n複利 100 5 10 3\n（元本100万、年利5%、10年、毎月3万円積立）",
            "en": "💡 Compound Calc Usage:\ncalc principal rate% years [monthly]\n\nExample:\ncalc 10000 5 10\ncalc 10000 5 10 300\n(principal $10k, 5%/yr, 10yr, monthly $300)",
            "ko": "💡 복리 계산 사용법:\ncalc 원금 연이율% 년수 [매월적립]\n\n예:\ncalc 1000 5 10\ncalc 1000 5 10 30",
            "zh": "💡 复利计算用法：\ncalc 本金 年利率% 年数 [每月定投]\n\n例：\ncalc 100 5 10\ncalc 100 5 10 3",
        },
        "calc_error": {
            "ja": "⚠️ 数値を正しく入力してください。\n例：複利 100 5 10",
            "en": "⚠️ Please enter valid numbers.\nExample: calc 10000 5 10",
            "ko": "⚠️ 숫자를 올바르게 입력해주세요.\n예: calc 1000 5 10",
            "zh": "⚠️ 请输入正确的数字。\n例：calc 100 5 10",
        },
        "sim_usage": {
            "ja": "💡 クイック試算の使い方：\nいくら必要 目標額(万円) 年数 年利(%)\n\n例：\nいくら必要 10000 30 5\n（30年後に1億円、年利5%で運用したい時の毎月積立額）",
            "en": "💡 Quick Simulation Usage:\nhowmuch target years rate%\n\nExample:\nhowmuch 1000000 30 5\n(Monthly savings needed to reach $1M in 30yr at 5%/yr)",
            "ko": "💡 빠른 시뮬레이션 사용법:\nhowmuch 목표액 년수 연이율%\n\n예:\nhowmuch 100000 30 5",
            "zh": "💡 快速试算用法：\nhowmuch 目标额 年数 年利率%\n\n例：\nhowmuch 10000 30 5",
        },
        "sim_error": {
            "ja": "⚠️ 数値を正しく入力してください。\n例：いくら必要 10000 30 5",
            "en": "⚠️ Please enter valid numbers.\nExample: howmuch 1000000 30 5",
            "ko": "⚠️ 숫자를 올바르게 입력해주세요.\n예: howmuch 100000 30 5",
            "zh": "⚠️ 请输入正确的数字。\n例：howmuch 10000 30 5",
        },
    }
    return messages.get(key, {}).get(lang, messages.get(key, {}).get("ja", ""))

def get_market_summary(lang="ja"):
    """日経・S&P500・ドル円・VIXの現在値を取得して文字列で返す"""
    try:
        symbols = [
            ("^N225",   {"ja": "日経225", "en": "Nikkei 225", "ko": "닛케이 225", "zh": "日经225"}),
            ("^GSPC",   {"ja": "S&P500", "en": "S&P 500",   "ko": "S&P 500",   "zh": "标普500"}),
            ("JPY=X",   {"ja": "ドル円", "en": "USD/JPY",   "ko": "달러/엔",   "zh": "美元/日元"}),
            ("^VIX",    {"ja": "VIX",    "en": "VIX",        "ko": "VIX",        "zh": "VIX"}),
        ]
        lines_out = [get_message(lang, "market_header"), ""]
        for sym, names in symbols:
            try:
                tk = yf.Ticker(sym)
                hist = tk.history(period="2d")
                if hist is None or hist.empty or len(hist) < 1:
                    continue
                price = float(hist["Close"].iloc[-1])
                if len(hist) >= 2:
                    prev = float(hist["Close"].iloc[-2])
                    diff = price - prev
                    pct = (diff / prev * 100.0) if prev else 0.0
                    arrow = "▲" if diff >= 0 else "▼"
                    lines_out.append(f"{names.get(lang, names['ja'])}  {price:,.2f}  {arrow}{abs(pct):.2f}%")
                else:
                    lines_out.append(f"{names.get(lang, names['ja'])}  {price:,.2f}")
            except Exception as e:
                print(f"[market] {sym} error: {e}")
                continue
        if len(lines_out) <= 2:
            return get_message(lang, "market_error")
        return "\n".join(lines_out)
    except Exception as e:
        print(f"[get_market_summary] error: {e}")
        return get_message(lang, "market_error")


def get_news_summary(lang="ja", limit=5):
    """最新の市場ニュースを取得して要約形式で返す（4言語対応）"""
    try:
        rss_sources = [
            ("https://www.nhk.or.jp/rss/news/cat5.xml",          "NHK"),
            ("https://feeds.reuters.com/reuters/businessNews",   "Reuters"),
            ("https://www.nhk.or.jp/rss/news/cat4.xml",          "NHK"),
        ]
        items = []
        for url, src in rss_sources:
            try:
                feed = feedparser.parse(url)
                for e in feed.entries[:3]:
                    items.append({"source": src, "title": e.title})
                    if len(items) >= limit:
                        break
                if len(items) >= limit:
                    break
            except Exception as e:
                print(f"[news] feed error {url}: {e}")
                continue
        if not items:
            return get_message(lang, "news_error")
        try:
            items = translate_news_items(items, lang)
        except Exception as e:
            print(f"[news] translate error: {e}")
        lines_out = [get_message(lang, "news_header"), ""]
        for it in items[:limit]:
            src = it.get("source", "")
            title = it.get("title", "")
            lines_out.append(f"[{src}] {title}")
        return "\n".join(lines_out)
    except Exception as e:
        print(f"[get_news_summary] error: {e}")
        return get_message(lang, "news_error")


def get_compound_calc(args, lang="ja"):
    """複利計算: 元本(万円) 年利(%) 年数 [毎月積立(万円)]"""
    try:
        parts = args.strip().split()
        if len(parts) < 3:
            return get_message(lang, "calc_usage")
        principal = float(parts[0])
        rate = float(parts[1]) / 100.0
        years = int(float(parts[2]))
        monthly = float(parts[3]) if len(parts) >= 4 else 0.0
        if years <= 0 or years > 100:
            return get_message(lang, "calc_error")
        # 年複利 + 毎月積立（年単位で簡略化: 毎月積立 -> 年間積立として複利乗せ）
        annual_add = monthly * 12.0
        balance = principal
        for _ in range(years):
            balance = balance * (1.0 + rate) + annual_add
        total_invested = principal + annual_add * years
        gain = balance - total_invested
        labels = {
            "ja": ("📈 複利計算結果", "元本", "年利", "年数", "毎月積立", "総投資額", "最終残高", "うち運用益"),
            "en": ("📈 Compound Calc Result", "Principal", "Annual rate", "Years", "Monthly", "Total invested", "Final balance", "Gain"),
            "ko": ("📈 복리 계산 결과", "원금", "연이율", "년수", "월적립", "총투자액", "최종잔액", "수익"),
            "zh": ("📈 复利计算结果", "本金", "年利率", "年数", "月定投", "总投资额", "最终余额", "收益"),
        }
        l = labels.get(lang, labels["ja"])
        unit = {"ja":"万円","en":"","ko":"","zh":"万"}.get(lang, "")
        msg = f"{l[0]}\n\n{l[1]}: {principal:,.1f}{unit}\n{l[2]}: {rate*100:.2f}%\n{l[3]}: {years}\n{l[4]}: {monthly:,.1f}{unit}\n\n{l[5]}: {total_invested:,.1f}{unit}\n{l[6]}: {balance:,.1f}{unit}\n{l[7]}: {gain:,.1f}{unit}"
        return msg
    except Exception as e:
        print(f"[get_compound_calc] error: {e}")
        return get_message(lang, "calc_error")

def get_savings_calc(args, lang="ja"):
    """クイック試算: 目標額(万円) 年数 年利(%) -> 必要な毎月積立額"""
    try:
        parts = args.strip().split()
        if len(parts) < 3:
            return get_message(lang, "sim_usage")
        target = float(parts[0])
        years = int(float(parts[1]))
        rate_annual = float(parts[2]) / 100.0
        if years <= 0 or years > 100:
            return get_message(lang, "sim_error")
        n = years * 12
        r = rate_annual / 12.0
        # 毎月積立FV式: FV = PMT * ((1+r)^n - 1) / r
        if r == 0:
            pmt = target / n
        else:
            factor = ((1.0 + r) ** n - 1.0) / r
            if factor == 0:
                return get_message(lang, "sim_error")
            pmt = target / factor
        total_paid = pmt * n
        gain = target - total_paid
        labels = {
            "ja": ("🎯 クイック試算結果", "目標額", "年数", "年利", "毎月積立必要額", "総積立額", "うち運用益"),
            "en": ("🎯 Quick Simulation Result", "Target", "Years", "Annual rate", "Monthly needed", "Total paid", "Gain"),
            "ko": ("🎯 빠른 시뮬레이션 결과", "목표액", "년수", "연이율", "월 필요액", "총 납입액", "수익"),
            "zh": ("🎯 快速试算结果", "目标额", "年数", "年利率", "月需金额", "总投入", "收益"),
        }
        l = labels.get(lang, labels["ja"])
        unit = {"ja":"万円","en":"","ko":"","zh":"万"}.get(lang, "")
        msg = f"{l[0]}\n\n{l[1]}: {target:,.1f}{unit}\n{l[2]}: {years}\n{l[3]}: {rate_annual*100:.2f}%\n\n{l[4]}: {pmt:,.2f}{unit}\n{l[5]}: {total_paid:,.1f}{unit}\n{l[6]}: {gain:,.1f}{unit}"
        return msg
    except Exception as e:
        print(f"[get_savings_calc] error: {e}")
        return get_message(lang, "sim_error")

def get_fx_summary(lang="ja"):
    """主要通貨ペア（USD/JPY, EUR/JPY, GBP/JPY, EUR/USD, GBP/USD）の現在値を取得"""
    try:
        pairs = [
            ("JPY=X", {"ja": "ドル円 (USD/JPY)", "en": "USD/JPY", "ko": "달러/엔 (USD/JPY)", "zh": "美元/日元 (USD/JPY)"}),
            ("EURJPY=X", {"ja": "ユーロ円 (EUR/JPY)", "en": "EUR/JPY", "ko": "유로/엔 (EUR/JPY)", "zh": "欧元/日元 (EUR/JPY)"}),
            ("GBPJPY=X", {"ja": "ポンド円 (GBP/JPY)", "en": "GBP/JPY", "ko": "파운드/엔 (GBP/JPY)", "zh": "英镑/日元 (GBP/JPY)"}),
            ("EURUSD=X", {"ja": "ユーロドル (EUR/USD)", "en": "EUR/USD", "ko": "유로/달러 (EUR/USD)", "zh": "欧元/美元 (EUR/USD)"}),
            ("GBPUSD=X", {"ja": "ポンドドル (GBP/USD)", "en": "GBP/USD", "ko": "파운드/달러 (GBP/USD)", "zh": "英镑/美元 (GBP/USD)"}),
        ]
        lines_out = [get_message(lang, "fx_header"), ""]
        for sym, names in pairs:
            try:
                tk = yf.Ticker(sym)
                hist = tk.history(period="2d")
                if hist is None or hist.empty or len(hist) < 1:
                    continue
                price = float(hist["Close"].iloc[-1])
                if len(hist) >= 2:
                    prev = float(hist["Close"].iloc[-2])
                    diff = price - prev
                    pct = (diff / prev * 100.0) if prev else 0.0
                    arrow = "▲" if diff >= 0 else "▼"
                    lines_out.append(f"{names.get(lang, names['ja'])} {price:,.4f} {arrow}{abs(pct):.2f}%")
                else:
                    lines_out.append(f"{names.get(lang, names['ja'])} {price:,.4f}")
            except Exception as e:
                print(f"[fx] {sym} error: {e}")
                continue
        if len(lines_out) <= 2:
            return get_message(lang, "fx_error")
        return "\n".join(lines_out)
    except Exception as e:
        print(f"[get_fx_summary] error: {e}")
        return get_message(lang, "fx_error")

def get_stock_price(symbol, lang="ja"):
    """個別銘柄の現在値・前日比を取得して文字列で返す"""
    try:
        symbol = (symbol or "").strip().upper()
        if not symbol:
            return get_message(lang, "price_usage")
        if symbol.isdigit() and len(symbol) == 4:
            symbol = symbol + ".T"
        tk = yf.Ticker(symbol)
        hist = tk.history(period="5d")
        if hist is None or hist.empty:
            return get_message(lang, "price_error")
        try:
            info = tk.info
            name = info.get("shortName") or info.get("longName") or symbol
            currency = info.get("currency") or ""
        except Exception:
            name = symbol
            currency = ""
        price = float(hist["Close"].iloc[-1])
        if len(hist) >= 2:
            prev = float(hist["Close"].iloc[-2])
            diff = price - prev
            pct = (diff / prev * 100.0) if prev else 0.0
            arrow = "▲" if diff >= 0 else "▼"
            return f"💹 {name} ({symbol})\n{price:,.2f} {currency}  {arrow}{abs(pct):.2f}%"
        else:
            return f"💹 {name} ({symbol})\n{price:,.2f} {currency}"
    except Exception as e:
        print(f"[get_stock_price] error: {e}")
        return get_message(lang, "price_error")


def detect_intent(text, lang="ja"):
    client = get_anthropic_client()
    prompt = f"""
ユーザーのメッセージを読んで、意図を以下の6つから1つだけ選んでください。
回答は必ずその単語1つだけ返してください。他の言葉は一切不要です。

選択肢：
- morning    … 朝レター・今日の相場・ニュースを見たい
- register   … 情報登録・参加したい・始めたい・新規登録・使いたい
- analyze    … 自分の資産を分析してほしい・ポートフォリオ確認
- save       … コロン（：または:）を含む情報入力
- simulator  … シミュレーター・投資計算・運用計算を見たい
- question   … 上記以外の質問・雑談・その他

ユーザーのメッセージ：「{text}」

回答（1単語のみ）："""

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
        if "名前：" in line or "名前:" in line or "name:" in line or "name:" in line:
            data["name"] = line.split("：")[-1].split(":")[-1].strip()
        elif "年収：" in line or "年収:" in line or "income:" in line.lower():
            data["financial_info"] = line.strip()
        elif "総資産：" in line or "総資産:" in line or "total assets:" in line.lower():
            data["total_assets"] = line.strip()
        elif "毎月投資額：" in line or "毎月投資額:" in line or "monthly:" in line.lower():
            data["savings"] = line.strip()
        elif "目標資産：" in line or "目標資産:" in line or "target:" in line.lower():
            data["target_asset"] = line.strip()
        elif "保有株：" in line or "保有株:" in line or "stocks owned:" in line.lower():
            data["stocks_owned"] = line.split("：")[-1].split(":")[-1].strip()
        elif "トレード銘柄：" in line or "トレード銘柄:" in line or "trading:" in line.lower():
            data["stocks_traded"] = line.split("：")[-1].split(":")[-1].strip()
        elif "出費：" in line or "出費:" in line or "expenses:" in line.lower():
            data["expenses"] = line.strip()
    if data:
        save_user(line_user_id, data)

def analyze_portfolio(user_info, lang="ja"):
    client = get_anthropic_client()
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
- name: {user_info.get('name', 'not registered')}
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


def get_user_delivery_hour(line_user_id):
    """ユーザーの配信時刻を取得（未設定なら 7）"""
    try:
        res = supabase.table("users").select("delivery_hour").eq("line_user_id", line_user_id).execute()
        if res.data and len(res.data) > 0:
            dh = res.data[0].get("delivery_hour")
            if dh is None:
                return 7
            return int(dh)
    except Exception as e:
        print(f"[get_user_delivery_hour] error: {e}")
    return 7


def set_user_delivery_hour(line_user_id, hour):
    """ユーザーの配信時刻を保存（既存ユーザー前提でupdate、なければinsert）"""
    try:
        h = int(hour)
        if h < 0 or h > 23:
            return False
        # まず update を試みる
        res = supabase.table("users").update({"delivery_hour": h}).eq("line_user_id", line_user_id).execute()
        # 該当行がない場合は insert
        if not res.data:
            supabase.table("users").insert({"line_user_id": line_user_id, "delivery_hour": h, "lang": "ja"}).execute()
        return True
    except Exception as e:
        print(f"[set_user_delivery_hour] error: {e}")
        return False


def build_settings_text(lang, delivery_hour):
    """配信時刻入りの設定テキストを生成（4言語対応）"""
    lang_label = {"ja": "日本語 🇯🇵", "en": "English 🇬🇧", "ko": "한국어 🇰🇷", "zh": "中文 🇨🇳"}.get(lang, "日本語 🇯🇵")
    if lang == "en":
        return (f"⚙️ Current Settings\n\n"
                f"• Language: {lang_label}\n"
                f"• Morning Report: Delivered daily at {delivery_hour}:00\n\n"
                f"To change language, send:\nlang ja / lang ko / lang zh\n\n"
                f"To change delivery time, send:\ndelivery 8 (any hour 0–23)")
    elif lang == "ko":
        return (f"⚙️ 현재 설정\n\n"
                f"• 언어: {lang_label}\n"
                f"• 아침 레터: 매일 {delivery_hour}시 배달\n\n"
                f"언어 변경:\nlang ja / lang en / lang zh\n\n"
                f"배달 시각 변경:\n배달시각 8 (0–23)")
    elif lang == "zh":
        return (f"⚙️ 当前设置\n\n"
                f"• 语言：{lang_label}\n"
                f"• 早报：每天{delivery_hour}:00送达\n\n"
                f"更改语言：\nlang ja / lang en / lang ko\n\n"
                f"更改推送时间：\n推送时间 8 (0–23)")
    else:
        return (f"⚙️ 現在の設定\n\n"
                f"• 言語：{lang_label}\n"
                f"• 朝レター：毎日 {delivery_hour}時 に配信\n\n"
                f"言語を変えたい場合は\nlang en / lang ko / lang zh\n\n"
                f"配信時刻を変えたい場合は\n「配信時刻 8」のように 0〜23 を送ってください")


def notify_admin(message, error=None):
    """エラーや重要イベントを管理者LINEに通知する。失敗してもメイン処理は止めない。"""
    try:
        if not ADMIN_USER_ID:
            return
        body = f"⚠️ [Keizai NEWS] {message}"
        if error:
            err_text = str(error)
            if len(err_text) > 500:
                err_text = err_text[:500] + "..."
            body += f"\n\nError: {err_text}"
        body += f"\n\nTime: {datetime.now().isoformat()}\nVersion: {APP_VERSION}"
        with ApiClient(configuration) as api_client:
            api = MessagingApi(api_client)
            api.push_message(PushMessageRequest(
                to=ADMIN_USER_ID,
                messages=[TextMessage(text=body[:4500])]
            ))
    except Exception as e:
        print(f"[notify_admin] failed to send: {e}")

def _rtp(sym, fb):
    try:
        lp = yf.Ticker(sym).fast_info["last_price"]
        return float(lp) if lp else fb
    except Exception:
        return fb

def fetch_market_data():
    tickers = {
        "日経225":    "^N225",
        "ドル円":     "JPY=X",
        "米10年金利": "^TNX",
        "S&P500":    "^GSPC",
        "NYダウ":     "^DJI",
        "VIX恐怖指数":"^VIX",
    }
    results = {}
    for label, symbol in tickers.items():
        try:
            hist = yf.Ticker(symbol).history(period="5d")
            if len(hist) >= 2:
                val   = _rtp(symbol, hist["Close"].iloc[-1])
                prev  = hist["Close"].iloc[-2]
                pct   = (val - prev) / prev * 100
                arrow = "▲" if pct >= 0 else "▼"
                results[label] = {
                    "display": f"{val:,.2f}　{arrow}{abs(pct):.2f}%",
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
                val   = _rtp(symbol, hist["Close"].iloc[-1])
                prev  = hist["Close"].iloc[-2]
                pct   = (val - prev) / prev * 100
                arrow = "▲" if pct >= 0 else "▼"
                results.append({
                    "symbol": symbol,
                    "name": name,
                    "display": f"{name}（{symbol}）　{val:,.0f}円　{arrow}{abs(pct):.2f}%"
                })
        except Exception:
            pass
    return results

# ===== Translation helpers (MyMemory API) =====
_translation_cache = {}  # {(text, target_lang): translated}

def translate_text(text, target_lang):
    """Translate Japanese text to target_lang (en/ko/zh) via MyMemory API.
    Returns original text on failure. Caches results in memory.
    """
    if not text or not target_lang or target_lang == "ja":
        return text
    key = (text, target_lang)
    if key in _translation_cache:
        return _translation_cache[key]
    lang_map = {"en": "en", "ko": "ko", "zh": "zh-CN"}
    tgt = lang_map.get(target_lang)
    if not tgt:
        return text
    try:
        resp = requests.get(
            "https://api.mymemory.translated.net/get",
            params={"q": text, "langpair": "ja|" + tgt},
            timeout=8
        )
        j = resp.json()
        translated = (j.get("responseData") or {}).get("translatedText") or text
        # MyMemory sometimes returns error messages in translatedText
        if translated and "MYMEMORY WARNING" not in translated.upper():
            _translation_cache[key] = translated
            return translated
    except Exception:
        pass
    return text

def translate_news_items(items, target_lang):
    """Translate list of {source, title} dicts. Source labels are handled on the frontend."""
    if not target_lang or target_lang == "ja":
        return items
    out = []
    for it in items:
        translated_title = translate_text(it.get("title", ""), target_lang)
        out.append({"source": it.get("source", ""), "title": translated_title})
    return out

def preload_translations():
    """Preload en/ko/zh translations of current news on server startup.
    Runs in a background thread so it does not block Flask startup.
    """
    try:
        time.sleep(3)  # small delay to let Flask fully initialize
        news = fetch_news()
        # Collect all titles
        titles = []
        for source, content in news.items():
            for line in content.split("\n"):
                title = line.strip().lstrip("・").strip()
                if title:
                    titles.append(title)
        # Translate to each target language one by one (avoid rate limit)
        for lang in ["en", "ko", "zh"]:
            for title in titles:
                try:
                    translate_text(title, lang)
                    time.sleep(0.2)  # ~5 req/s to be polite
                except Exception:
                    pass
            time.sleep(1)  # small pause between languages
        print("[preload] Translation cache warmed up:", len(_translation_cache), "entries")
    except Exception as e:
        print("[preload] Failed:", e)


def fetch_news():
    rss = {
        "NHK経済":      "https://www.nhk.or.jp/rss/news/cat5.xml",
        "NHK株・企業":  "https://www.nhk.or.jp/rss/news/cat4.xml",
        "ロイター経済":  "https://feeds.reuters.com/reuters/businessNews",
        "ロイター米国株":"https://feeds.reuters.com/reuters/companyNews",
    }
    all_news = {}
    for label, url in rss.items():
        feed = feedparser.parse(url)
        all_news[label] = "\n".join([f"・{e.title}" for e in feed.entries[:7]])
    return all_news

def generate_morning_report(lang="ja"):
    market    = fetch_market_data()
    watchlist = fetch_watchlist()
    news      = fetch_news()

    # 日付フォーマットを言語別に
    if lang == "en":
        today   = date.today().strftime("%B %d, %Y")
        weekday = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][date.today().weekday()]
    elif lang == "ko":
        today   = date.today().strftime("%Y년 %m월 %d일")
        weekday = ["월","화","수","목","금","토","일"][date.today().weekday()]
    elif lang == "zh":
        today   = date.today().strftime("%Y年%m月%d日")
        weekday = ["周一","周二","周三","周四","周五","周六","周日"][date.today().weekday()]
    else:
        today   = date.today().strftime("%Y年%m月%d日")
        weekday = ["月","火","水","木","金","土","日"][date.today().weekday()]

    market_text    = "\n".join([f"・{k}：{v['display']}" for k, v in market.items()])
    watchlist_text = "\n".join([s["display"] for s in watchlist])
    news_text      = "\n".join([f"【{k}】\n{v}" for k, v in news.items()])

    prompts = {
        "ja": f"""
あなたは、株の初心者に毎朝「今日の投資判断材料」を届ける、正確で親切な先生です。

【絶対に守るルール】
・専門用語は必ず（）で説明する
・理由を必ず書く
・不確かなことは書かない
・##や**などの記号は絶対に使わない
・見出しは【】で囲む
・区切り線は ━━━━━━━ を使う
・絵文字を適度に使う
・スマホの縦画面で読みやすいよう、1行を短めにする
・市場の雰囲気🟢落ち着いている🟡やや不安🔴パニックのどれかだけで表示する

今日：{today}（{weekday}曜日）

【市場データ（前日終値）】
{market_text}

【ウォッチリスト銘柄】
{watchlist_text}

【今日のニュース（複数ソース）】
{news_text}

☀️ {today}（{weekday}）の朝レター
─────────────────
今日の一言：（今日の相場を一文で表す）
─────────────────

━━ 📊 市場データ ━━
━━ 💴 ドル円と金利：今日の影響 ━━
━━ 📰 今日の重要ニュース ━━
━━ 🗓️ 今日の相場予想 ━━
━━ 🎯 今日の取引判断材料 ━━
【デイトレード】
【スイングトレード】
【積立・投資信託】
━━ 🔍 ウォッチリスト ━━
{watchlist_text}
━━ 💡 今日の一語 ━━
─────────────────
今日も正確に、自分のペースで。
─────────────────
""",
        "en": f"""
You are a precise, kind teacher delivering today's investment insights to beginner stock investors every morning.

[Strict Rules]
- Always explain technical terms in parentheses
- Always state reasons
- Do not write anything uncertain
- Never use ## or ** symbols
- Wrap headings with 【】
- Use ━━━━━━━ as divider
- Use emojis moderately
- Keep lines short for mobile portrait reading
- Show market mood as 🟢calm / 🟡slightly anxious / 🔴panic only

Today: {today} ({weekday})

[Market data (previous close)]
{market_text}

[Watchlist stocks]
{watchlist_text}

[Today's news (multiple sources)]
{news_text}

Please write the entire morning report in ENGLISH.

☀️ Morning Report for {today} ({weekday})
─────────────────
Today's one-liner: (express today's market in one sentence)
─────────────────

━━ 📊 Market Data ━━
━━ 💴 USD/JPY and Rates: Today's Impact ━━
━━ 📰 Today's Key News ━━
━━ 🗓️ Today's Market Outlook ━━
━━ 🎯 Today's Trading Decision Materials ━━
【Day Trade】
【Swing Trade】
【Accumulation & Mutual Funds】
━━ 🔍 Watchlist ━━
{watchlist_text}
━━ 💡 Word of the Day ━━
─────────────────
Stay accurate, at your own pace.
─────────────────
""",
        "ko": f"""
당신은 주식 초보자에게 매일 아침 '오늘의 투자 판단 자료'를 전하는 정확하고 친절한 선생님입니다.

【반드시 지킬 규칙】
・전문 용어는 반드시 ()로 설명한다
・이유를 반드시 쓴다
・불확실한 것은 쓰지 않는다
・##나 ** 같은 기호는 절대 사용하지 않는다
・제목은 【】로 감싼다
・구분선은 ━━━━━━━ 을 사용한다
・이모지를 적절히 사용한다
・스마트폰 세로 화면에서 읽기 좋게 한 줄을 짧게 한다
・시장 분위기는 🟢안정 🟡약간 불안 🔴패닉 중 하나로만 표시한다

오늘：{today} ({weekday})

【시장 데이터(전일 종가)】
{market_text}

【워치리스트 종목】
{watchlist_text}

【오늘의 뉴스(여러 출처)】
{news_text}

전체 리포트를 한국어로 작성해 주세요.

☀️ {today} ({weekday}) 아침 레터
─────────────────
오늘의 한 마디: (오늘의 시장을 한 문장으로 표현)
─────────────────

━━ 📊 시장 데이터 ━━
━━ 💴 달러/엔과 금리: 오늘의 영향 ━━
━━ 📰 오늘의 주요 뉴스 ━━
━━ 🗓️ 오늘의 시장 전망 ━━
━━ 🎯 오늘의 거래 판단 자료 ━━
【데이 트레이드】
【스윙 트레이드】
【적립·투자신탁】
━━ 🔍 워치리스트 ━━
{watchlist_text}
━━ 💡 오늘의 한 단어 ━━
─────────────────
오늘도 정확하게, 자신의 페이스로.
─────────────────
""",
        "zh": f"""
你是一位准确而亲切的老师，每天早上为股票初学者送上"今日投资判断材料"。

【必须遵守的规则】
・专业术语必须用()进行说明
・必须写明理由
・不确定的事情不写
・绝对不使用##或**等符号
・标题用【】括起来
・分隔线使用 ━━━━━━━
・适度使用表情符号
・为了在手机竖屏方便阅读，每行尽量短
・市场气氛只显示🟢平静🟡略有不安🔴恐慌之一

今天：{today} ({weekday})

【市场数据（前日收盘）】
{market_text}

【关注列表】
{watchlist_text}

【今日新闻（多个来源）】
{news_text}

请用中文撰写整篇早报。

☀️ {today} ({weekday}) 早报
─────────────────
今日一句话：(用一句话表达今日行情)
─────────────────

━━ 📊 市场数据 ━━
━━ 💴 美元/日元与利率：今日影响 ━━
━━ 📰 今日重要新闻 ━━
━━ 🗓️ 今日市场预测 ━━
━━ 🎯 今日交易判断材料 ━━
【日内交易】
【波段交易】
【定投·基金】
━━ 🔍 关注列表 ━━
{watchlist_text}
━━ 💡 今日一词 ━━
─────────────────
今天也以准确、自己的节奏。
─────────────────
""",
    }
    prompt = prompts.get(lang, prompts["ja"])

    client = get_anthropic_client()
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
- name: {user_info.get('name', 'not registered')}
- Stocks owned: {user_info.get('stocks_owned', 'not registered')}
- Savings: {user_info.get('savings', 'not registered')}
- Target assets: {user_info.get('target_asset', 'not registered')}
- Expenses: {user_info.get('expenses', 'not registered')}
Respond based on this user's profile. Keep personal info confidential.
"""

    lang_names = {"ja": "Japanese", "en": "English", "ko": "Korean", "zh": "Chinese"}
    lang_name = lang_names.get(lang, "English")

    client = get_anthropic_client()
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

    client = get_anthropic_client()

    def make_alert(name, symbol, price, pct, market_ctx, lang="ja"):
        if lang == "en":
            direction = "Surging📈" if pct > 0 else "Plunging📉"
            prompt = f"""Write an emergency alert for beginner investors in ENGLISH.
- {name} ({symbol}) is {direction} {abs(pct):.1f}% today
- Current price: {price:,.0f}
- Market context: {market_ctx}

⚡[URGENT] {name} is {direction}
📍 What is happening now
📍 Why it is moving
📍 Impact on day trading
📍 Impact on swing trading
📍 Cautions & risks
─────────────
Final decision is yours.
"""
        elif lang == "ko":
            direction = "급등📈" if pct > 0 else "급락📉"
            prompt = f"""투자 초보자를 위한 긴급 알림을 한국어로 작성해 주세요.
・{name} ({symbol})이(가) 오늘 {abs(pct):.1f}% {direction}
・현재가: {price:,.0f}
・시장 상황: {market_ctx}

⚡【긴급】{name}이(가) {direction}
📍 지금 무슨 일이 일어나고 있는가
📍 왜 움직이고 있는가
📍 데이트레이드에의 영향
📍 스윙트레이드에의 영향
📍 주의점·리스크
─────────────
최종 판단은 본인이 하시기 바랍니다.
"""
        elif lang == "zh":
            direction = "急涨📈" if pct > 0 else "急跌📉"
            prompt = f"""请用中文为投资初学者撰写紧急提醒。
・{name}（{symbol}）今日{abs(pct):.1f}%{direction}
・当前价：{price:,.0f}
・市场情况：{market_ctx}

⚡【紧急】{name}{direction}
📍 现在发生了什么
📍 为什么在波动
📍 对日内交易的影响
📍 对波段交易的影响
📍 注意事项·风险
─────────────
最终判断请自行决定。
"""
        else:
            direction = "急上昇📈" if pct > 0 else "急落📉"
            prompt = f"""
投資初心者向けの緊急アラートを書いてください。
・{name}（{symbol}）が本日{abs(pct):.1f}%{direction}
・現在値：{price:,.0f}円
・市場状況：{market_ctx}

⚡【緊急】{name}が{direction}
📍 今何が起きているか
📍 なぜ動いているか
📍 デイトレードへの影響
📍 スイングトレードへの影響
📍 注意点・リスク
─────────────
最終判断はご自身でお願いします。
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
            arrow = "▲" if pct >= 0 else "▼"
            market_ctx = f"日経225：{val:,.0f}円（{arrow}{abs(pct):.1f}%）"
            if abs(pct) >= 1.5:
                key = f"nikkei_{today_str}_{int(pct)}"
                if key not in state:
                    alert = make_alert("日経225", "^N225", val, pct, market_ctx)
                    send_line_message(alert)
                    state[key] = now.isoformat()
    except Exception:
        pass

    try:
        usdjpy = yf.Ticker("JPY=X").history(period="2d")
        if len(usdjpy) >= 2:
            market_ctx += f"　ドル円：{usdjpy['Close'].iloc[-1]:.2f}円"
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
    except Exception as e:
        print(f"[callback] handler error: {e}")
        try:
            notify_admin("callback handler error", e)
        except Exception:
            pass
    return "OK"

@handler.add(FollowEvent)
def handle_follow(event):
    """友だち追加時に4言語の歓迎メッセージを送信"""
    line_user_id = event.source.user_id
    reply_token = event.reply_token
    try:
        existing = get_user(line_user_id)
        if not existing:
            set_user_lang(line_user_id, "ja")
        lang = get_user_lang(line_user_id) or "ja"
    except Exception as e:
        print(f"[follow] user setup error: {e}")
        lang = "ja"
    try:
        with ApiClient(configuration) as api_client:
            api = MessagingApi(api_client)
            api.reply_message(ReplyMessageRequest(
                reply_token=reply_token,
                messages=[TextMessage(text=get_message(lang, "welcome_text"))]
            ))
    except Exception as e:
        print(f"[follow] reply error: {e}")

@handler.add(MessageEvent, message=TextMessageContent)
def handle_message(event):
    user_text    = event.message.text.strip()
    reply_token  = event.reply_token
    line_user_id = event.source.user_id

    # 言語判定：保存済みがあればそれを優先、なければメッセージから判定して保存
    stored_lang = get_user_lang(line_user_id)
    detected = detect_language(user_text)
    if stored_lang:
        # 既存ユーザー：保存済み言語を使用。ただし明確に違う言語で送ってきたら更新
        if detected != stored_lang and len(user_text) >= 4:
            set_user_lang(line_user_id, detected)
            lang = detected
        else:
            lang = stored_lang
    else:
        # 新規ユーザー：検出した言語を保存
        lang = detected
        set_user_lang(line_user_id, lang)

    with ApiClient(configuration) as api_client:
        api = MessagingApi(api_client)

        # ===== 軽量コマンド判定（API呼び出し前の早期処理） =====
        text_lower = user_text.lower().strip()
        if _line_admin_command(api, line_user_id, reply_token, text_lower): return

        # 言語切替コマンド: "lang ja" / "lang en" / "lang ko" / "lang zh"
        if text_lower.startswith("lang "):
            target = text_lower[5:].strip()
            if target in ("ja", "en", "ko", "zh"):
                set_user_lang(line_user_id, target)
                api.reply_message(ReplyMessageRequest(
                    reply_token=reply_token,
                    messages=[TextMessage(text=get_message(target, "lang_changed"))]
                ))
                return

        # ヘルプコマンド（キーワードの言語で返信＆ユーザー言語を更新）
        help_map = {
            "ヘルプ": "ja", "へるぷ": "ja",
            "help": "en",
            "도움말": "ko", "도움": "ko",
            "帮助": "zh", "幫助": "zh",
        }
        msg_key = text_lower if text_lower in help_map else user_text.strip()
        if msg_key in help_map:
            cmd_lang = help_map[msg_key]
            set_user_lang(line_user_id, cmd_lang)
            api.reply_message(ReplyMessageRequest(
                reply_token=reply_token,
                messages=[TextMessage(text=get_message(cmd_lang, "help_text"))]
            ))
            return

        # 設定確認コマンド（キーワードの言語で返信＆ユーザー言語を更新）
        settings_map = {
            "設定": "ja", "せってい": "ja",
            "settings": "en", "setting": "en",
            "설정": "ko",
            "设置": "zh", "設置": "zh",
        }
        msg_key2 = text_lower if text_lower in settings_map else user_text.strip()
        if msg_key2 in settings_map:
            cmd_lang = settings_map[msg_key2]
            set_user_lang(line_user_id, cmd_lang)
            dh = get_user_delivery_hour(line_user_id)
            api.reply_message(ReplyMessageRequest(
                reply_token=reply_token,
                messages=[TextMessage(text=build_settings_text(cmd_lang, dh))]
            ))
            return

        # 相場コマンド（キーワードの言語で返信＆ユーザー言語を更新）
        market_map = {
            "相場": "ja", "そうば": "ja",
            "market": "en",
            "시장": "ko",
            "行情": "zh", "市场": "zh",
        }
        msg_key3 = text_lower if text_lower in market_map else user_text.strip()
        if msg_key3 in market_map:
            cmd_lang = market_map[msg_key3]
            set_user_lang(line_user_id, cmd_lang)
            api.reply_message(ReplyMessageRequest(
                reply_token=reply_token,
                messages=[TextMessage(text=get_market_summary(cmd_lang))]
            ))
            return

        # ニュースコマンド（キーワードの言語で返信＆ユーザー言語を更新）
        news_map = {
            "ニュース": "ja", "にゅーす": "ja",
            "news": "en",
            "뉴스": "ko",
            "新闻": "zh", "新聞": "zh",
        }
        msg_key4 = text_lower if text_lower in news_map else user_text.strip()
        if msg_key4 in news_map:
            cmd_lang = news_map[msg_key4]
            set_user_lang(line_user_id, cmd_lang)
            api.reply_message(ReplyMessageRequest(
                reply_token=reply_token,
                messages=[TextMessage(text=get_news_summary(cmd_lang))]
            ))
            return

        # 為替コマンド（キーワードの言語で返信＆ユーザー言語を更新）
        fx_map = {
            "為替": "ja", "かわせ": "ja",
            "fx": "en", "forex": "en",
            "환율": "ko",
            "汇率": "zh", "匯率": "zh",
        }
        msg_key5 = text_lower if text_lower in fx_map else user_text.strip()
        if msg_key5 in fx_map:
            cmd_lang = fx_map[msg_key5]
            set_user_lang(line_user_id, cmd_lang)
            api.reply_message(ReplyMessageRequest(
                reply_token=reply_token,
                messages=[TextMessage(text=get_fx_summary(cmd_lang))]
            ))
            return

        # 朝レター手動再送コマンド
        morning_map = {
            "朝レター": "ja", "あさレター": "ja", "朝レポート": "ja",
            "morning": "en", "morning report": "en",
            "아침레터": "ko", "조간": "ko",
            "早报": "zh", "早報": "zh",
        }
        msg_key6 = text_lower if text_lower in morning_map else user_text.strip()
        if msg_key6 in morning_map:
            cmd_lang = morning_map[msg_key6]
            set_user_lang(line_user_id, cmd_lang)
            api.reply_message(ReplyMessageRequest(
                reply_token=reply_token,
                messages=[TextMessage(text=get_message(cmd_lang, "waiting_morning"))]
            ))
            report = generate_morning_report(cmd_lang)
            send_line_message(report, user_id=line_user_id)
            return

        # 複利計算コマンド: "複利 100 5 10" / "calc 10000 5 10"
        calc_prefixes = {
            "複利 ": "ja", "ふくり ": "ja",
            "calc ": "en", "compound ": "en",
            "복리 ": "ko",
            "复利 ": "zh", "複利 ": "zh",
        }
        matched_calc = None
        for pfx, pfx_lang in calc_prefixes.items():
            if text_lower.startswith(pfx.lower()) or user_text.strip().startswith(pfx):
                matched_calc = (pfx, pfx_lang)
                break
        if matched_calc:
            pfx, cmd_lang = matched_calc
            stripped = user_text.strip()
            if stripped.lower().startswith(pfx.lower()):
                args_part = stripped[len(pfx):].strip()
            else:
                args_part = stripped[len(pfx):].strip()
            set_user_lang(line_user_id, cmd_lang)
            api.reply_message(ReplyMessageRequest(
                reply_token=reply_token,
                messages=[TextMessage(text=get_compound_calc(args_part, cmd_lang))]
            ))
            return

        # クイック試算コマンド: "いくら必要 10000 30 5" / "howmuch 1000000 30 5"
        sim_prefixes = {
            "いくら必要 ": "ja", "いくらひつよう ": "ja", "試算 ": "ja",
            "howmuch ": "en", "sim ": "en", "simulate ": "en",
            "얼마필요 ": "ko",
            "需要多少 ": "zh", "试算 ": "zh",
        }
        matched_sim = None
        for pfx, pfx_lang in sim_prefixes.items():
            if text_lower.startswith(pfx.lower()) or user_text.strip().startswith(pfx):
                matched_sim = (pfx, pfx_lang)
                break
        if matched_sim:
            pfx, cmd_lang = matched_sim
            stripped = user_text.strip()
            if stripped.lower().startswith(pfx.lower()):
                args_part = stripped[len(pfx):].strip()
            else:
                args_part = stripped[len(pfx):].strip()
            set_user_lang(line_user_id, cmd_lang)
            api.reply_message(ReplyMessageRequest(
                reply_token=reply_token,
                messages=[TextMessage(text=get_savings_calc(args_part, cmd_lang))]
            ))
            return

        # 配信時刻コマンド: "配信時刻 8" / "delivery 8" / "배달시각 8" / "推送时间 8"
        delivery_prefixes = {
            "配信時刻 ": "ja", "配信時間 ": "ja", "はいしんじこく ": "ja",
            "delivery ": "en", "deliver ": "en", "delivery time ": "en",
            "배달시각 ": "ko", "배달시간 ": "ko",
            "推送时间 ": "zh", "推送時間 ": "zh", "配送时间 ": "zh",
        }
        matched_delivery = None
        for pfx, pfx_lang in delivery_prefixes.items():
            if text_lower.startswith(pfx.lower()) or user_text.strip().startswith(pfx):
                matched_delivery = (pfx, pfx_lang)
                break
        if matched_delivery:
            pfx, cmd_lang = matched_delivery
            stripped = user_text.strip()
            if stripped.lower().startswith(pfx.lower()):
                args_part = stripped[len(pfx):].strip()
            else:
                args_part = stripped[len(pfx):].strip()
            set_user_lang(line_user_id, cmd_lang)
            if not args_part:
                api.reply_message(ReplyMessageRequest(
                    reply_token=reply_token,
                    messages=[TextMessage(text=get_message(cmd_lang, "delivery_usage"))]
                ))
                return
            try:
                hour = int(args_part.split()[0])
            except Exception:
                api.reply_message(ReplyMessageRequest(
                    reply_token=reply_token,
                    messages=[TextMessage(text=get_message(cmd_lang, "delivery_error"))]
                ))
                return
            if hour < 0 or hour > 23:
                api.reply_message(ReplyMessageRequest(
                    reply_token=reply_token,
                    messages=[TextMessage(text=get_message(cmd_lang, "delivery_error"))]
                ))
                return
            ok = set_user_delivery_hour(line_user_id, hour)
            if ok:
                msg = get_message(cmd_lang, "delivery_set").replace("{h}", str(hour))
                api.reply_message(ReplyMessageRequest(
                    reply_token=reply_token,
                    messages=[TextMessage(text=msg)]
                ))
            else:
                api.reply_message(ReplyMessageRequest(
                    reply_token=reply_token,
                    messages=[TextMessage(text=get_message(cmd_lang, "delivery_error"))]
                ))
            return

        # 株価コマンド: "株価 7203" / "price AAPL" / "주가 005930" / "股价 600519"
        price_prefixes = {
            "株価 ": "ja", "かぶか ": "ja",
            "price ": "en",
            "주가 ": "ko",
            "股价 ": "zh", "股價 ": "zh",
        }
        matched_prefix = None
        for pfx, pfx_lang in price_prefixes.items():
            if text_lower.startswith(pfx.lower()) or user_text.strip().startswith(pfx):
                matched_prefix = (pfx, pfx_lang)
                break
        if matched_prefix:
            pfx, cmd_lang = matched_prefix
            stripped = user_text.strip()
            if stripped.lower().startswith(pfx.lower()):
                symbol_part = stripped[len(pfx):].strip()
            else:
                symbol_part = stripped[len(pfx):].strip()
            set_user_lang(line_user_id, cmd_lang)
            api.reply_message(ReplyMessageRequest(
                reply_token=reply_token,
                messages=[TextMessage(text=get_stock_price(symbol_part, cmd_lang))]
            ))
            return

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
            sim_url = "https://investment-bot-ta24.onrender.com"
            api.reply_message(ReplyMessageRequest(
                reply_token=reply_token,
                                messages=[TextMessage(text=get_message(lang, "simulator_url").replace("{url}", sim_url))]
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

    # 全ユーザーをループし、各自の保存済み言語でレポート生成・送信
    sent = 0
    errors = 0
    from datetime import timezone, timedelta
    jst_now = datetime.now(timezone.utc) + timedelta(hours=9)
    cur_hour = jst_now.hour
    force = request.args.get("force", "") == "1"
    try:
        res = supabase.table("users").select("line_user_id, lang, delivery_hour").execute()
        users = res.data or []
    except Exception as e:
        users = []
        print(f"[morning] users fetch error: {e}")

    # ユーザーがいない場合はオーナー(LINE_USER_ID)にだけ日本語で送る（後方互換）
    if not users:
        report = generate_morning_report("ja")
        send_line_message(report)
        return "OK (fallback: owner only)"

    # 言語ごとにレポートをキャッシュ（同じ言語のユーザーには同じレポート → APIコスト節約）
    cache = {}
    skipped = 0
    for u in users:
        uid  = u.get("line_user_id")
        lang = (u.get("lang") or "ja").lower()
        if lang not in ("ja", "en", "ko", "zh"):
            lang = "ja"
        # LINEの正規ユーザーIDは "U" で始まる33文字。それ以外（test123等のダミー）はスキップ
        if not uid or not (isinstance(uid, str) and len(uid) == 33 and uid.startswith("U")):
            skipped += 1
            print(f"[morning] skip invalid line_user_id: {uid!r}")
            continue
        # 配信時刻チェック（force=1 なら全員に送る）
        try:
            dh = int(u.get("delivery_hour")) if u.get("delivery_hour") is not None else 7
        except Exception:
            dh = 7
        if False and not force and dh != cur_hour:
            skipped += 1
            continue
        try:
            if lang not in cache:
                cache[lang] = generate_morning_report(lang)
            send_line_message(cache[lang], user_id=uid)
            sent += 1
            # 3ユーザーごとに gc を走らせてメモリ解放
            if sent % 3 == 0:
                gc.collect()
        except Exception as e:
            errors += 1
            print(f"[morning] send error to {uid}: {e}")
            try:
                notify_admin(f"morning send error to {uid}", e)
            except Exception:
                pass

    return f"OK sent={sent} errors={errors} skipped={skipped} langs={list(cache.keys())}"

@app.route("/alert", methods=["GET"])
def alert():
    if request.args.get("secret", "") != os.environ.get("CRON_SECRET", ""):
        abort(403)
    check_alerts()
    return "OK"

# ===== 有料サービスのコスト通知（管理者LINE専用） =====
# 今後、新しく有料サービスを使い始めたら PAID_SERVICES に1行追加するだけで通知に乗ります。
# 無料プランのサービスはここに入れません。
PAID_SERVICES = [
    {"name": "Anthropic (Claude API)", "kind": "anthropic"},
    {"name": "Google Gemini API",      "kind": "gemini"},
]

def _cost_anthropic():
    """Claude API のクレジット残高/利用額を返す。取得できなければ None。"""
    key = os.environ.get("ANTHROPIC_ADMIN_KEY", "") or os.environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        return None
    try:
        # Anthropic は自動取得APIが限られるため、環境変数の手動値があれば優先表示する
        manual = os.environ.get("ANTHROPIC_BALANCE_USD", "")
        if manual:
            return f"残高 ${manual}"
        return None
    except Exception:
        return None

def _cost_gemini():
    """Google Cloud (Gemini) の当月費用を返す。手動値があれば優先。"""
    manual = os.environ.get("GEMINI_COST_JPY", "")
    if manual:
        return f"当月 ¥{manual}"
    return None

def build_cost_report():
    """有料サービスの費用サマリ文字列を作る。"""
    lines = ["💴 有料サービスの費用"]
    getters = {"anthropic": _cost_anthropic, "gemini": _cost_gemini}
    for svc in PAID_SERVICES:
        fn = getters.get(svc["kind"])
        val = None
        try:
            val = fn() if fn else None
        except Exception:
            val = None
        lines.append(f"・{svc['name']}: {val if val else '取得不可（手動確認）'}")
    lines.append(f"\n集計時刻: {datetime.now().isoformat(timespec='minutes')}")
    return "\n".join(lines)

@app.route("/cost", methods=["GET"])
def cost():
    if request.args.get("secret", "") != os.environ.get("CRON_SECRET", ""):
        abort(403)
    report = build_cost_report()
    notify_admin(report)
    return "OK"


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

@app.route("/simulator")
def simulator():
    with open("simulator.html", encoding="utf-8") as f:
            return f.read(), 200, {"Content-Type": "text/html; charset=utf-8"}

# === Receipt OCR (Gemini 1.5 Flash) ===
_ocr_usage = {}
OCR_MONTHLY_LIMIT = int(os.environ.get("OCR_MONTHLY_LIMIT", "50"))

@app.route("/api/ocr-receipt", methods=["POST"])
def api_ocr_receipt():
    raw_text = ""
    try:
        if "image" not in request.files:
            return jsonify({"error": "image required"}), 400
        user_key = request.form.get("user_id") or request.remote_addr or "anon"
        now_month = datetime.now().strftime("%Y-%m")
        rec = _ocr_usage.get(user_key, {"count": 0, "month": now_month})
        if rec.get("month") != now_month:
            rec = {"count": 0, "month": now_month}
        if rec["count"] >= OCR_MONTHLY_LIMIT:
            return jsonify({"error": "monthly_limit", "limit": OCR_MONTHLY_LIMIT, "used": rec["count"]}), 429
        api_key = os.environ.get("GEMINI_API_KEY", "")
        if not api_key:
            return jsonify({"error": "GEMINI_API_KEY not set"}), 500
        from PIL import Image
        import google.generativeai as genai
        import io as _io
        img = Image.open(request.files["image"].stream)
        img.thumbnail((1024, 1024))
        if img.mode != "RGB":
            img = img.convert("RGB")
        buf = _io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        buf.seek(0)
        img_for_api = Image.open(buf)
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.5-flash")
        prompt = ("Extract receipt data as JSON only. No markdown, no commentary. "
                  "Schema: {\"date\":\"YYYY-MM-DD\",\"store\":\"...\",\"items\":[{\"name\":\"...\",\"price\":123,\"category\":\"food|daily|hobby|transport|medical|other\"}],\"total\":1234}. "
                  "Prices are integers in yen. If unreadable, use null for that field.")
        resp = model.generate_content([prompt, img_for_api])
        raw_text = (getattr(resp, "text", "") or "").strip()
        t = raw_text
        if t.startswith("```"):
            t = t.strip("`")
            if t.lower().startswith("json"):
                t = t[4:].strip()
        data = json.loads(t)
        rec["count"] = rec.get("count", 0) + 1
        _ocr_usage[user_key] = rec
        try:
            img.close(); img_for_api.close(); buf.close()
        except Exception:
            pass
        gc.collect()
        return jsonify({"ok": True, "data": data, "usage": rec["count"], "limit": OCR_MONTHLY_LIMIT})
    except json.JSONDecodeError:
        return jsonify({"error": "ai_response_not_json", "raw": raw_text[:500]}), 502
    except Exception as e:
        _e=str(e); _l=locals().get("lang","ja"); _m={"ja":{"429":"AIの利用上限に達しました。明日もう一度お試しください。","404":"AIモデルが見つかりません。管理者に連絡してください。","default":"エラーが発生しました。しばらくしてからお試しください。"},"en":{"429":"AI quota exceeded. Try again tomorrow.","404":"AI model not found.","default":"An error occurred. Try again later."},"ko":{"429":"AI 사용 한도에 도달했습니다.","404":"AI 모델을 찾을 수 없습니다.","default":"오류가 발생했습니다."},"zh":{"429":"AI使用配额已用完。","404":"找不到AI模型。","default":"发生错误。"}}; _c="429" if "429" in _e else ("404" if "404" in _e else "default"); return jsonify({"error": _m.get(_l,_m["ja"]).get(_c), "code": _c}), 500
AI_ADVICE_MONTHLY_LIMIT = int(os.environ.get("AI_ADVICE_MONTHLY_LIMIT", "20"))
_ai_advice_usage = {}
_ai_advice_cache = {}  # cache: {key: {"ts": epoch, "data": dict}}
ADVICE_CACHE_TTL_SEC = int(os.environ.get("ADVICE_CACHE_TTL_SEC", 21600))
@app.route("/api/ai-advice", methods=["POST"])
def api_ai_advice():
    try:
        body = request.get_json(silent=True) or {}
        user_key = body.get("user_id") or request.remote_addr or "anon"
        lang = (body.get("lang") or "ja").lower()
        if lang not in ("ja","en","ko","zh"): lang = "ja"
        summary = body.get("summary") or {}
        _cache_key = (user_key, lang, json.dumps(summary, sort_keys=True, ensure_ascii=False))
        _cached = _ai_advice_cache.get(_cache_key)
        if _cached and (time.time() - _cached.get("ts", 0)) < ADVICE_CACHE_TTL_SEC: return jsonify({"ok": True, "data": _cached["data"], "cached": True})
        now_month = datetime.now().strftime("%Y-%m")
        rec = _ai_advice_usage.get(user_key, {"count": 0, "month": now_month})
        if rec.get("month") != now_month: rec = {"count": 0, "month": now_month}
        if rec["count"] >= AI_ADVICE_MONTHLY_LIMIT: return jsonify({"error": "monthly_limit", "limit": AI_ADVICE_MONTHLY_LIMIT, "used": rec["count"]}), 429
        api_key = os.environ.get("GEMINI_API_KEY", "")
        if not api_key: return jsonify({"error": "GEMINI_API_KEY not set"}), 500
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        lang_names = {"ja":"Japanese","en":"English","ko":"Korean","zh":"Chinese"}
        prompt = "Analyze the budget below. Respond ONLY in " + lang_names[lang] + ". Return strict JSON: {\"summary\":string,\"trend\":string,\"savings_tips\":[string,string,string],\"investment_advice\":string,\"score\":number}. score is 0-100. Each string max 120 chars. No markdown.\n\nData:\n" + json.dumps(summary, ensure_ascii=False)[:6000]
        model = genai.GenerativeModel("gemini-2.5-flash")
        resp = model.generate_content(prompt)
        raw = (getattr(resp, "text", "") or "").strip()
        t = raw
        if t.startswith("```"):
            t = t.strip("`")
            if t.lower().startswith("json"): t = t[4:].strip()
        data = json.loads(t)
        _ai_advice_cache[_cache_key] = {"ts": time.time(), "data": data}
        rec["count"] = rec.get("count", 0) + 1
        _ai_advice_usage[user_key] = rec
        gc.collect()
        return jsonify({"ok": True, "data": data, "usage": rec["count"], "limit": AI_ADVICE_MONTHLY_LIMIT})
    except json.JSONDecodeError:
        return jsonify({"error": "ai_response_not_json"}), 502
    except Exception as e:
        _e=str(e); _l=locals().get("lang","ja"); _m={"ja":{"429":"AIの利用上限に達しました。明日もう一度お試しください。","404":"AIモデルが見つかりません。管理者に連絡してください。","default":"エラーが発生しました。しばらくしてからお試しください。"},"en":{"429":"AI quota exceeded. Try again tomorrow.","404":"AI model not found.","default":"An error occurred. Try again later."},"ko":{"429":"AI 사용 한도에 도달했습니다.","404":"AI 모델을 찾을 수 없습니다.","default":"오류가 발생했습니다."},"zh":{"429":"AI使用配额已用完。","404":"找不到AI模型。","default":"发生错误。"}}; _c="429" if "429" in _e else ("404" if "404" in _e else "default"); return jsonify({"error": _m.get(_l,_m["ja"]).get(_c), "code": _c}), 500
        
@app.route("/kakeibo")
def kakeibo():
    with open("kakeibo.html", encoding="utf-8") as f:
        return f.read(), 200, {"Content-Type": "text/html; charset=utf-8"}
            

@app.route("/api/morning-data", methods=["GET"])
def api_morning_data():
    try:
        market = fetch_market_data()
        today = date.today().strftime("%Y/%m/%d")
        weekdays = ["月","火","水","木","金","土","日"]
        weekday = weekdays[date.today().weekday()]
        result = {
            "date": today + "(" + weekday + ")",
            "market": {},
            "updated": datetime.now().strftime("%H:%M")
        }
        for k, v in market.items():
            result["market"][k] = {
                "price": v.get("price", "--"),
                "change": v.get("change", "--"),
                "display": v.get("display", "--")
            }
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e), "date": date.today().strftime("%Y/%m/%d"), "market": {}}), 200

@app.route("/api/quote", methods=["GET"])
def api_quote():
    symbol = request.args.get("symbol", "").strip().upper()
    light = request.args.get("light", "") == "1"
    if not symbol:
        return jsonify({"error": "symbol is required"}), 400
    try:
        t = yf.Ticker(symbol)
        hist = t.history(period="5d")
        if light:
            info = {}
            name = symbol
            currency = ""
        else:
            info = t.info
            name = info.get("shortName") or info.get("longName") or symbol
            currency = info.get("currency") or ""
        _sym_u = symbol.upper()
        _is_index = _sym_u.startswith("^")
        _is_fx = _sym_u.endswith("=X")
        _is_stock = (not _is_index) and (not _is_fx)
        details = None
        if _is_stock and not light:
            try:
                details = {
                    "marketCap": info.get("marketCap"),
                    "per": info.get("trailingPE"),
                    "volume": info.get("volume") or info.get("regularMarketVolume"),
                    "high52": info.get("fiftyTwoWeekHigh"),
                    "low52": info.get("fiftyTwoWeekLow"),
                    "sector": info.get("sector"),
                    "dividendYield": info.get("dividendYield"),
                }
            except Exception:
                details = None
        if len(hist) >= 2:
            val = _rtp(symbol, hist["Close"].iloc[-1])
            prev = hist["Close"].iloc[-2]
            pct = (val - prev) / prev * 100
            if (val is None) or (val != val) or (val in (float("inf"), float("-inf"))) or (val <= 0) or (abs(pct) > 50):
                return jsonify({"error": "invalid data", "symbol": symbol}), 422
            arrow = "▲" if pct >= 0 else "▼"
            return jsonify({
                "symbol": symbol,
                "details": details,
                "name": name,
                "currency": currency,
                "price": round(val, 4),
                "pct": round(pct, 2),
                "display": f"{val:,.2f} {arrow}{abs(pct):.2f}%",
                "change": arrow + str(round(abs(pct), 2)) + "%"
            })
        elif len(hist) == 1:
            val = _rtp(symbol, hist["Close"].iloc[-1])
            return jsonify({
                "symbol": symbol,
                "details": details,
                "name": name,
                "currency": currency,
                "price": round(val, 4),
                "pct": 0,
                "display": f"{val:,.2f}",
                "change": "--"
            })
        else:
            return jsonify({"error": "No data found for: " + symbol}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500


_LOOKUP_CACHE = {}
_LOOKUP_TTL = 300


# === JPX 上場銘柄辞書（日本語名→コード） ===
_JPX_DICT = {}
_JPX_DICT_TS = 0
_ALIAS = {"アストロステーション": "186A"}
_JPX_BASE = "https://www.jpx.co.jp"
_JPX_PAGE = "/markets/statistics-equities/misc/01.html"

def _load_jpx_dict():
    """JPXの上場銘柄一覧(Excel)を取得して {コード: 社名} を返す。取得失敗時は空の辞書。"""
    try:
        import re as _re
        import pandas as _pd
        _ua = {"User-Agent": "Mozilla/5.0"}
        _page = requests.get(_JPX_BASE + _JPX_PAGE, headers=_ua, timeout=20)
        _m = _re.search(r"href=\"([^\"]*data_j\.xls)", _page.text)
        if not _m:
            return {}
        _href = _m.group(1)
        if _href.startswith("http"):
            _xls_url = _href
        else:
            _xls_url = _JPX_BASE + _href
        _resp = requests.get(_xls_url, headers=_ua, timeout=30)
        import io as _io
        _df = _pd.read_excel(_io.BytesIO(_resp.content), dtype=str)
        _out = {}
        for _, _row in _df.iterrows():
            _code = str(_row.get("コード", "")).strip()
            _name = str(_row.get("銘柄名", "")).strip()
            _mkt = str(_row.get("市場・商品区分", ""))
            if not _code or not _name:
                continue
            if "内国株式" not in _mkt:
                continue
            if len(_code) != 4:
                continue
            _out[_code] = _name
        return _out
    except Exception as _e:
        print("[jpx] load error: " + str(_e))
        return {}

def _jpx_refresh():
    global _JPX_DICT, _JPX_DICT_TS
    _d = _load_jpx_dict()
    if _d:
        _JPX_DICT = _d
        _JPX_DICT_TS = time.time()
        print("[jpx] loaded " + str(len(_d)) + " stocks")

def _jpx_loop():
    time.sleep(20)
    _jpx_refresh()
    while True:
        time.sleep(86400)
        _jpx_refresh()

try:
    threading.Thread(target=_jpx_loop, daemon=True).start()
except Exception as _e:
    print("[jpx] thread start error: " + str(_e))

@app.route("/api/lookup", methods=["GET"])
def api_lookup():
    q = (request.args.get("q") or "").strip()
    if not q:
        return jsonify({"results": []})
    key = q.lower()
    # 日本語クエリで辞書が未ロードなら遅延ロード
    if (not _JPX_DICT) and any(("ぁ" <= _c <= "ん") or ("ァ" <= _c <= "ヶ") or ("一" <= _c <= "鿿") for _c in q):
        try:
            _jpx_refresh()
        except Exception:
            pass
    # 日本語（かな/漢字）を含む場合は JPX 辞書を部分一致検索
    if _JPX_DICT and any(("ぁ" <= _c <= "ん") or ("ァ" <= _c <= "ヶ") or ("一" <= _c <= "鿿") for _c in q):
        _jres = []
        for _code, _nm in _JPX_DICT.items():
            if q in _nm:
                _jres.append({"symbol": _code + ".T", "name": _nm, "exchange": "Tokyo", "type": "EQUITY"})
        for _al, _cd in _ALIAS.items():
            if (_al in q or q in _al) and _cd in _JPX_DICT:
                _sym = _cd + ".T"
                if not any(r["symbol"] == _sym for r in _jres):
                    _jres.append({"symbol": _sym, "name": _JPX_DICT[_cd], "exchange": "Tokyo", "type": "EQUITY"})
        if _jres:
            _LOOKUP_CACHE[key] = {"ts": time.time(), "data": _jres}
            return jsonify({"results": _jres})
    now = time.time()
    cached = _LOOKUP_CACHE.get(key)
    if cached and (now - cached["ts"]) < _LOOKUP_TTL:
        return jsonify({"results": cached["data"]})
    try:
        resp = requests.get(
            "https://query1.finance.yahoo.com/v1/finance/search",
            params={"q": q, "quotesCount": 8, "newsCount": 0, "lang": "ja-JP", "region": "JP"},
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
            timeout=8,
        )
        j = resp.json()
        quotes = j.get("quotes") or []
        results = []
        for it in quotes:
            sym = (it.get("symbol") or "")
            if not sym:
                continue
            name = (it.get("shortname") or it.get("longname") or sym)
            exch = (it.get("exchDisp") or it.get("exchange") or "")
            qtype = (it.get("quoteType") or "")
            results.append({"symbol": sym, "name": name, "exchange": exch, "type": qtype})
        _LOOKUP_CACHE[key] = {"ts": now, "data": results}
        return jsonify({"results": results})
    except Exception as e:
        return jsonify({"results": [], "error": str(e)}), 200

@app.route("/api/lookup_all", methods=["GET"])
def api_lookup_all():
    if (not _JPX_DICT):
        try:
            _jpx_refresh()
        except Exception:
            pass
    items = []
    for _code, _nm in _JPX_DICT.items():
        items.append({"code": _code, "name": _nm})
    for _al, _cd in _ALIAS.items():
        if _cd in _JPX_DICT:
            items.append({"code": _cd, "name": _al})
    return jsonify({"count": len(items), "items": items})

@app.route("/api/morning-news", methods=["GET"])
def api_morning_news():
    try:
        lang = (request.args.get("lang") or "ja").lower()
        news = fetch_news()
        items = []
        for source, content in news.items():
            for line in content.split("\n"):
                title = line.strip().lstrip("・").strip()
                if title:
                    items.append({"source": source, "title": title})
        items = translate_news_items(items, lang)
        return jsonify({"news": items, "updated": datetime.now().strftime("%H:%M"), "lang": lang})
    except Exception as e:
        return jsonify({"error": str(e), "news": []}), 200

@app.route("/health")
def health():
    """サーバ稼働状態を JSON で返す"""
    try:
        uptime_sec = int((datetime.now() - APP_START_TIME).total_seconds())
        supabase_ok = False
        try:
            r = supabase.table("users").select("line_user_id", count="exact").limit(1).execute()
            supabase_ok = True
        except Exception as e:
            print(f"[health] supabase check error: {e}")
        return jsonify({
            "status": "ok",
            "version": APP_VERSION,
            "uptime_sec": uptime_sec,
            "uptime_human": f"{uptime_sec // 3600}h{(uptime_sec % 3600) // 60}m{uptime_sec % 60}s",
            "supabase": "ok" if supabase_ok else "error",
            "started_at": APP_START_TIME.isoformat(),
            "admin_configured": bool(ADMIN_USER_ID),
        })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/chat", methods=["POST"])
def api_chat():
    """ページ内 AI チャットウィジェット用エンドポイント。

    リクエスト JSON:
        {"messages": [{"role": "user"|"assistant", "content": "..."}, ...]}
    レスポンス JSON:
        {"reply": "..."}  / エラー時は {"error": "..."}
    """
    try:
        # Rate limit check
        _rl_ok, _rl_reason = _rl_check_and_consume()
        if not _rl_ok:
            if _rl_reason == "global_daily":
                _msg = "本日の AI チャット利用上限に達しました。明日また試してね！"
            elif _rl_reason == "ip_daily":
                _msg = "本日のあなたの利用回数（1日" + str(RL_IP_PER_DAY) + "回）に達しました。明日また試してね！"
            else:
                _msg = "少し間をあけてからもう一度送信してね（1分あたり" + str(RL_IP_PER_MIN) + "回まで）。"
            return jsonify({"reply": _msg, "rate_limited": True})
        data = request.get_json(silent=True) or {}
        msgs = data.get("messages") or []
        # サニタイズ: role と content(文字列) のみを残し、直近 20 件に制限
        safe_msgs = []
        for m in msgs[-20:]:
            if not isinstance(m, dict):
                continue
            role = m.get("role")
            content = m.get("content")
            if role in ("user", "assistant") and isinstance(content, str) and content.strip():
                safe_msgs.append({"role": role, "content": content.strip()[:2000]})
        if not safe_msgs or safe_msgs[-1]["role"] != "user":
            return jsonify({"error": "no user message"}), 400

        system_prompt = (
            "あなたは「経済NEWS」サイトの AI アシスタントです。"
            "投資、相場、資産運用、家計簿、経済ニュースについて、"
            "初心者にも分かりやすく丁寧に日本語で回答してください。"
            "回答は簡潔に、必要に応じて箇条書きも使い、"
            "300文字程度を目安にしてください。"
            "金融商品の勧誘や断定的な投資助言は避け、"
            "最終的な判断は本人が行うよう促してください。"
        )

        if data.get("mode") == "teacher":
            system_prompt = TEACHER_PROMPT
        client = get_anthropic_client()
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=512,
            system=system_prompt,
            messages=safe_msgs,
        )
        reply = msg.content[0].text if msg.content else ""
        return jsonify({"reply": reply})
    except Exception as e:
        print(f"[api_chat] error: {e}")
        return jsonify({"error": str(e)}), 500


# ---- Rate limiter (in-memory, per-day) ----
# グローバル上限: 1日200リクエスト、IP単位: 1分5回 / 1日10回
RL_GLOBAL_PER_DAY = 200
RL_IP_PER_DAY = 10
RL_IP_PER_MIN = 5
_RL_STATE = {"day": None, "global": 0, "ip_day": {}, "ip_min": {}}

def _client_ip():
    try:
        xff = request.headers.get("X-Forwarded-For", "")
        if xff:
            return xff.split(",")[0].strip()
        return request.remote_addr or "unknown"
    except Exception:
        return "unknown"

def _rl_check_and_consume():
    """Returns (allowed: bool, reason: str). Consumes a slot on True."""
    try:
        today = date.today().isoformat()
        now_min = int(time.time() // 60)
        if _RL_STATE.get("day") != today:
            _RL_STATE["day"] = today
            _RL_STATE["global"] = 0
            _RL_STATE["ip_day"] = {}
            _RL_STATE["ip_min"] = {}
        if _RL_STATE["global"] >= RL_GLOBAL_PER_DAY:
            return False, "global_daily"
        ip = _client_ip()
        if _RL_STATE["ip_day"].get(ip, 0) >= RL_IP_PER_DAY:
            return False, "ip_daily"
        mkey = (ip, now_min)
        if _RL_STATE["ip_min"].get(mkey, 0) >= RL_IP_PER_MIN:
            return False, "ip_minute"
        # consume
        _RL_STATE["global"] += 1
        _RL_STATE["ip_day"][ip] = _RL_STATE["ip_day"].get(ip, 0) + 1
        _RL_STATE["ip_min"][mkey] = _RL_STATE["ip_min"].get(mkey, 0) + 1
        # prune ip_min if too big
        if len(_RL_STATE["ip_min"]) > 500:
            cutoff = now_min - 2
            _RL_STATE["ip_min"] = {k: v for k, v in _RL_STATE["ip_min"].items() if k[1] >= cutoff}
        return True, "ok"
    except Exception:
        return True, "ok"


_CHAT_SUGG_CACHE = {}

@app.route("/api/chat-suggestions", methods=["POST"])
def api_chat_suggestions():
    """\u30c1\u30e3\u30c3\u30c8\u753b\u9762\u306b\u8868\u793a\u3059\u308b\u30b5\u30b8\u30a7\u30b9\u30c8\u30c1\u30c3\u30d7\u3092\u751f\u6210\u3002"""
    try:
        # Rate limit check (suggestions): on block, fall back to defaults
        _rl_ok, _rl_reason = _rl_check_and_consume()
        if not _rl_ok:
            return jsonify({"chips": ["NISAって何？", "PERって何？", "ドルコスト平均法って？", "インフレって何？"], "fallback": True})
        data = request.get_json(silent=True) or {}
        interests = data.get("interests") or []
        safe_interests = []
        if isinstance(interests, list):
            for it in interests[:10]:
                if isinstance(it, str):
                    s = it.strip()[:60]
                    if s:
                        safe_interests.append(s)

        today_key = date.today().isoformat()
        interests_key = ",".join(sorted(safe_interests))
        cache_key = f"{today_key}|{interests_key}"

        cached = _CHAT_SUGG_CACHE.get(cache_key)
        if cached is not None:
            return jsonify({"chips": cached, "cached": True})

        try:
            news_dict = fetch_news()
            news_lines = []
            for source, content in news_dict.items():
                for line in content.split("\n"):
                    title = line.strip().lstrip("\u30fb").strip()
                    if title:
                        news_lines.append(title)
            news_text = "\n".join(news_lines[:24])
        except Exception as ne:
            news_text = ""
            print(f"[chat-suggestions] news fetch err: {ne}")

        interests_text = ", ".join(safe_interests) if safe_interests else "\u7121\u3057"

        # ステージ判定：興味トピックの件数でチップの混ぜ方を変える
        _n_interests = len(safe_interests)
        if _n_interests == 0:
            stage_label = "beginner"
            mix_rule = (
                "\u521d\u56de\u5229\u7528\u8005\u5411\u3051\u3002\u4ee5\u4e0b\u306e\u30eb\u30fc\u30eb\u3067\u6b63\u78ba\u306b4\u3064\u9078\u3076\uff1a\\n"
                "(1) 1\u3064\u76ee\u306f\u5fc5\u305a\u300cNISA\u3063\u3066\u4f55\uff1f\u300d\\n"
                "(2) 2\u3064\u76ee\u306f\u5fc5\u305a\u300cPER\u3063\u3066\u4f55\uff1f\u300d\\n"
                "(3) 3\u3064\u76ee\u30fb4\u3064\u76ee\u306f\u4eca\u65e5\u306e\u30cb\u30e5\u30fc\u30b9\u898b\u51fa\u3057\u304b\u3089\u3001\u521d\u5fc3\u8005\u304c\u300c\u3053\u308c\u96e3\u3057\u305d\u3046\u300d\u3068\u611f\u3058\u305d\u3046\u306a\u7d4c\u6e08\u30fb\u91d1\u878d\u7528\u8a9e\u30922\u3064"
            )
        elif _n_interests <= 2:
            stage_label = "intermediate"
            mix_rule = (
                "\u3084\u3084\u6163\u308c\u305f\u30e6\u30fc\u30b6\u30fc\u5411\u3051\u3002\u4ee5\u4e0b\u306e\u30eb\u30fc\u30eb\u3067\u6b63\u78ba\u306b4\u3064\u9078\u3076\uff1a\\n"
                "(1) 1\u3064\u76ee\u306f\u5fc5\u305a\u300cNISA\u3063\u3066\u4f55\uff1f\u300d\u307e\u305f\u306f\u300cPER\u3063\u3066\u4f55\uff1f\u300d\u306e\u3069\u3061\u3089\u304b\u4e00\u3064\\n"
                "(2) 2\u3064\u76ee\u306f\u4eca\u65e5\u306e\u30cb\u30e5\u30fc\u30b9\u898b\u51fa\u3057\u304b\u3089\u8a71\u984c\u306e\u96e3\u3057\u3044\u7d4c\u6e08\u7528\u8a9e\u30921\u3064\\n"
                "(3) 3\u3064\u76ee\u30fb4\u3064\u76ee\u306f\u30e6\u30fc\u30b6\u30fc\u306e\u95a2\u5fc3\u30c8\u30d4\u30c3\u30af\u306b\u95a2\u9023\u3057\u305f\u6ce2\u53ca\u8cea\u554f\u30922\u3064\uff08\u4f8b\uff1aPER\u3092\u805e\u3044\u305f\u4eba\u306b\u306fPBR\u3084ROE\u306a\u3069\uff09"
            )
        else:
            stage_label = "advanced"
            mix_rule = (
                "\u5341\u5206\u6163\u308c\u305f\u30e6\u30fc\u30b6\u30fc\u5411\u3051\u3002\u4ee5\u4e0b\u306e\u30eb\u30fc\u30eb\u3067\u6b63\u78ba\u306b4\u3064\u9078\u3076\uff1a\\n"
                "(1) 1\u3064\u76ee\u30fb2\u3064\u76ee\u306f\u4eca\u65e5\u306e\u30cb\u30e5\u30fc\u30b9\u898b\u51fa\u3057\u304b\u3089\u30db\u30c3\u30c8\u306a\u7d4c\u6e08\u7528\u8a9e\u30922\u3064\\n"
                "(3) 3\u3064\u76ee\u30fb4\u3064\u76ee\u306f\u30e6\u30fc\u30b6\u30fc\u306e\u95a2\u5fc3\u30c8\u30d4\u30c3\u30af\u306e\u8db3\u3057\u3066\u3044\u3057\u305d\u3046\u306a\u4e0a\u7d1a\u30c8\u30d4\u30c3\u30af\u30922\u3064\uff08\u4f8b\uff1a\u30c6\u30af\u30cb\u30ab\u30eb\u5206\u6790\u3001\u51e6\u5206\u52b9\u679c\u3001\u30aa\u30d7\u30b7\u30e7\u30f3\u306a\u3069\uff09"
            )

        prompt = (
            "\u3042\u306a\u305f\u306f\u300c\u7d4c\u6e08NEWS\u300d\u30b5\u30a4\u30c8\u306eAI\u30c1\u30e3\u30c3\u30c8\u306e\u8cea\u554f\u63d0\u6848\u30c1\u30c3\u30d7\u3092\u4f5c\u308b\u30a2\u30b7\u30b9\u30bf\u30f3\u30c8\u3060\u3002\\n\\n"
            + "\u4ee5\u4e0b\u306f\u4eca\u65e5\u306e\u65e5\u672c\u306e\u7d4c\u6e08\u30cb\u30e5\u30fc\u30b9\u306e\u898b\u51fa\u3057\u4e00\u89a7\uff1a\\n"
            + news_text
            + "\\n\\n\u30e6\u30fc\u30b6\u30fc\u306e\u6700\u8fd1\u30bf\u30c3\u30d7\u3057\u305f\u95a2\u5fc3\u30c8\u30d4\u30c3\u30af\uff1a"
            + interests_text
            + "\\n\\n[\u9078\u5b9a\u30eb\u30fc\u30eb]\\n"
            + mix_rule
            + "\\n\\n[\u51fa\u529b\u5f62\u5f0f]\\n\u30ad\u30fc\u30ef\u30fc\u306f\u300c\u3063\u3066\u4f55\uff1f\u300d\u3064\u304d\u306e\u77ed\u3044\u8cea\u554f\u5f62\u5f0f\u3001\u5404\u300120\u6587\u5b57\u4ee5\u5185\u3002JSON\u914d\u5217\u306e\u307f\u3092\u8fd4\u3057\u3001\u4ed6\u306e\u8aac\u660e\u6587\u306f\u4e00\u5207\u542b\u3081\u306a\u3044\u3053\u3068\u3002\\n\u4f8b\uff1a[\"NISA\u3063\u3066\u4f55\uff1f\", \"PER\u3063\u3066\u4f55\uff1f\", \"\u6700\u9ad8\u5024\u3063\u3066\u4f55\uff1f\", \"\u88dc\u6b63\u4e88\u7b97\u3063\u3066\u4f55\uff1f\"]"
        )

        client = get_anthropic_client()
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}],
        )
        reply = msg.content[0].text if msg.content else "[]"
        chips = []
        try:
            s_i = reply.find("[")
            e_i = reply.rfind("]")
            if s_i != -1 and e_i != -1 and e_i > s_i:
                chips = json.loads(reply[s_i:e_i+1])
        except Exception:
            chips = []
        clean = []
        if isinstance(chips, list):
            for c in chips:
                if isinstance(c, str):
                    s = c.strip()
                    if s and len(s) <= 36:
                        clean.append(s)
                if len(clean) >= 4:
                    break
        if not clean:
            clean = ["NISA\u3063\u3066\u4f55\uff1f", "PER\u3063\u3066\u4f55\uff1f", "\u30c9\u30eb\u30b3\u30b9\u30c8\u5e73\u5747\u6cd5\u3063\u3066\uff1f", "\u30a4\u30f3\u30d5\u30ec\u3063\u3066\u4f55\uff1f"]

        if len(_CHAT_SUGG_CACHE) > 50:
            _CHAT_SUGG_CACHE.clear()
        _CHAT_SUGG_CACHE[cache_key] = clean
        return jsonify({"chips": clean, "cached": False})
    except Exception as e:
        print(f"[api_chat_suggestions] error: {e}")
        return jsonify({
            "chips": ["NISA\u3063\u3066\u4f55\uff1f", "PER\u3063\u3066\u4f55\uff1f", "\u30c9\u30eb\u30b3\u30b9\u30c8\u5e73\u5747\u6cd5\u3063\u3066\uff1f", "\u30a4\u30f3\u30d5\u30ec\u3063\u3066\u4f55\uff1f"],
            "error": str(e)
        }), 200


@app.route("/sw.js")
def service_worker():
    try:
        with open("static/sw.js", encoding="utf-8") as f:
            body = f.read()
    except Exception:
        return "", 404
    return body, 200, {"Content-Type": "application/javascript", "Service-Worker-Allowed": "/", "Cache-Control": "no-cache"}


@app.route("/")
def index():
    with open("index.html", encoding="utf-8") as f:
        return f.read(), 200, {"Content-Type": "text/html"}

# Start translation preload in background (works for both gunicorn and direct run)
# PRELOAD_TRANSLATIONS=0 で無効化可能（メモリ節約）
if os.environ.get("PRELOAD_TRANSLATIONS", "1") != "0":
    try:
        _preload_thread = threading.Thread(target=preload_translations, daemon=True)
        _preload_thread.start()
    except Exception as _e:
        print("[preload] Could not start thread:", _e)
else:
    print("[preload] Skipped (PRELOAD_TRANSLATIONS=0)")

# === KEEP-ALIVE (self-ping & cache warmer) ===
# KEEPALIVE=0 で無効化
if os.environ.get("KEEPALIVE", "1") != "0":
    def _keep_alive_loop():
        time.sleep(60)
        base = os.environ.get("RENDER_EXTERNAL_URL") or f"http://127.0.0.1:{int(os.environ.get('PORT', 5000))}"
        last_warm = 0
        while True:
            try:
                requests.get(f"{base}/health", timeout=15)
            except Exception as _e:
                print(f"[keepalive] ping error: {_e}")
            now = time.time()
            if now - last_warm > 3000:
                try:
                    requests.get(f"{base}/api/dividend/top?limit=20", timeout=30)
                    cur_month = datetime.now().strftime("%Y-%m")
                    requests.get(f"{base}/api/dividend/calendar?month={cur_month}", timeout=30)
                    last_warm = now
                    print("[keepalive] dividend caches warmed")
                except Exception as _e:
                    print(f"[keepalive] warmup error: {_e}")
            time.sleep(600)
    try:
        _keepalive_thread = threading.Thread(target=_keep_alive_loop, daemon=True)
        _keepalive_thread.start()
        print("[keepalive] thread started")
    except Exception as _e:
        print("[keepalive] Could not start thread:", _e)
else:
    print("[keepalive] Skipped (KEEPALIVE=0)")


# === 配当金機能 (yfinance) ===
# 日本株マッピング: ティッカー↔会社名 (代表的な高配当銘柄 + 主要銘柄)
JP_STOCKS = {
    # === トヨタグループ・自動車 ===
    "7201": "日産自動車", "7202": "いすづ自動車", "7203": "トヨタ自動車",
    "7205": "日野自動車", "7211": "三菱自動車", "7261": "マツダ",
    "7267": "ホンダ", "7269": "スズキ", "7270": "SUBARU", "7272": "ヤマハ発動機",
    "7276": "小森", "7282": "豊田合成", "7309": "シマノ", "7732": "トプコン",
    "7733": "オリンパス", "7741": "HOYA", "7751": "キヤノン",
    "7752": "リコー", "7762": "シチズン", "7832": "バンダイナムHD",
    "7974": "任天堂",
    # === 電気・電子機器 ===
    "6098": "リクルートHD", "6178": "日本郵便", "6273": "SMC",
    "6301": "コマツ", "6326": "クボタ", "6367": "ダイキン工業",
    "6501": "日立製作所", "6502": "東芝", "6503": "三菱電機",
    "6504": "富士電機", "6506": "安川電機", "6594": "ニデック",
    "6645": "オムロン", "6701": "NEC", "6702": "富士通",
    "6723": "ルネサスエレクトロニクス", "6724": "セイコーエプソン",
    "6752": "パナソニックHD", "6753": "シャープ", "6758": "ソニーG",
    "6762": "TDK", "6770": "アルプスアルパイン", "6841": "横河電機",
    "6857": "アドバンテスト", "6861": "キーエンス",
    "6869": "シスメックス", "6902": "デンソー", "6920": "レーザーテック",
    "6952": "カシオ", "6954": "ファナック", "6963": "ローム",
    "6971": "京セラ", "6976": "太陽誘電", "6981": "村田製作所",
    "6988": "日東電工",
    # === 機械・重工業 ===
    "6113": "アマダ", "6273": "SMC", "6305": "日立建機",
    "6326": "クボタ", "6361": "荒田工業", "6471": "日本精工",
    "6472": "NTN", "6473": "ジェイテクト", "6479": "ミネベア",
    "7011": "三菱重工業", "7012": "川崎重工業", "7013": "IHI",
    "7270": "SUBARU", "7741": "HOYA",
    # === 金融・銀行・保険 ===
    "8001": "伊藤忠商事", "8002": "丸紅", "8031": "三井物産",
    "8053": "住友商事", "8058": "三菱商事", "8113": "ユニ・チャーム",
    "8267": "イオン", "8306": "三菱UFJ FG", "8308": "りそなHD",
    "8316": "三井住友FG", "8331": "千葉銀行", "8354": "ふくおかFG",
    "8355": "静岡銀行", "8411": "みずほFG", "8473": "SBI HD",
    "8591": "オリックスG", "8593": "三菱HCキャピタル",
    "8601": "大和証券G", "8604": "野村HD", "8628": "松井証券",
    "8630": "SOMPO HD", "8697": "JPX", "8725": "MS＆AD",
    "8750": "第四生命HD", "8766": "東京海上", "8795": "T＆D HD",
    # === 不動産 ===
    "3003": "ヒューリック", "3231": "野村不動産HD",
    "3289": "東急不動産HD", "3291": "イロヴビコーG",
    "8801": "三井不動産", "8802": "三菱地所", "8804": "東京建物",
    "8830": "住友不動産",
    # === 通信・IT ===
    "9432": "NTT", "9433": "KDDI", "9434": "ソフトバンク",
    "9435": "光通信", "9613": "NTTデータ",
    "4307": "野村総合研究所", "4324": "電通グループ",
    "4385": "メルカリ", "4661": "OLC", "4689": "LINEヤフー",
    "4704": "トレンドマイクロ", "4751": "サイバーエージェント",
    "4755": "楽天グループ", "4768": "大冬",
    # === 化学・素材 ===
    "3401": "帝人", "3402": "東レ", "3405": "クラレ",
    "3407": "旭化成", "4005": "住友化学", "4021": "日産化学",
    "4042": "東ソー", "4061": "デンカ化学", "4063": "信越化学",
    "4183": "三井化学", "4188": "三菱ケミカルグループス",
    "4204": "東洋点氟", "4452": "花王", "4901": "富士フイルムHD",
    "4911": "資生堂",
    # === 製薬 ===
    "4502": "武田薬品", "4503": "アステラス製薬",
    "4506": "大日本住友製薬", "4507": "塩野義製薬",
    "4519": "中外製薬", "4523": "エーザイ", "4528": "小野薬品",
    "4543": "テルモ", "4568": "第一三共", "4578": "大堀製薬",
    # === 食品・飲料 ===
    "2002": "日清製粉G", "2201": "森永製菓", "2229": "カルビー",
    "2267": "ヤクルト本社", "2269": "明治ホールディングス",
    "2282": "日本ハム", "2502": "アサヒビール",
    "2503": "キリンHD", "2587": "サントリーHD",
    "2801": "キッコーマン", "2802": "味の素", "2914": "JT",
    # === 小売・サービス ===
    "3086": "J.フロントリテイリングHD", "3092": "ZOZO",
    "3099": "三越伊勢丹HD", "3197": "すきや", "3382": "セブン＆アイHD",
    "3399": "丸万", "3543": "コメダ中見せ", "7164": "全国保険",
    "7532": "パンパシフィックスHD", "8267": "イオン",
    "9843": "ニトリ", "9983": "ファーストリテ", "9984": "ソフトバンクG",
    # === 鉄鋼・金属・鉱業 ===
    "5020": "ENEOS", "5101": "横浜ゴム", "5108": "ブリジストン",
    "5201": "AGC", "5232": "住友大阪セメント", "5301": "東海カーボン",
    "5332": "TOTO", "5333": "日本碑子", "5401": "日本製鉄",
    "5406": "神戸製鋼所", "5411": "JFE", "5631": "日本製鋼所",
    "5703": "日本軽金属", "5706": "三井金属鉱業",
    "5713": "住友金属鉱山", "5714": "DOWA HD", "5801": "古河電気工業",
    "5802": "住友電気工業", "5803": "フジクラ",
    # === エネルギー・資源 ===
    "1605": "INPEX", "1662": "石油資源開発", "1721": "コムシスモーターHD",
    "1925": "大和ハウス工業", "1928": "積水ハウス",
    "1963": "日揮", "5019": "出光興産",
    # === 電力・ガス ===
    "9501": "東電", "9502": "中部電力", "9503": "関西電力",
    "9504": "中国電力", "9508": "九州電力", "9531": "東京ガス",
    "9532": "大阪ガス", "9533": "東邦ガス",
    # === 運輸・物流 ===
    "9020": "JR東日本", "9021": "JR西日本", "9022": "JR東海",
    "9064": "ヤマトホールディングス", "9101": "日本郵船",
    "9104": "商船三井", "9107": "川崎汽船", "9147": "NIPPON EXPRESS HD",
    "9201": "JAL", "9202": "ANA HD", "9301": "三菱倉庫",
    # === その他・サービス ===
    "2412": "ベネフィットOne", "2613": "Jオイルミルズ",
    "2768": "双日", "2784": "アルフレッサHD", "4519": "中外製薬",
    "9437": "NTTドコモ",
}

# メモリキャッシュ (1時間TTL)
_dividend_cache = {}
_DIV_CACHE_TTL = 21600  # 1h

def _div_cache_get(key):
    v = _dividend_cache.get(key)
    if not v: return None
    if time.time() - v[0] > _DIV_CACHE_TTL:
        _dividend_cache.pop(key, None)
        return None
    return v[1]

def _div_cache_set(key, value):
    _dividend_cache[key] = (time.time(), value)

def _resolve_jp_ticker(q):
    """ティッカー(7203)や会社名(トヨタ)から 7203.T 形式に解決"""
    if not q: return None, None
    q = q.strip()
    # 数字のみならティッカー
    if q.isdigit() and q in JP_STOCKS:
        return f"{q}.T", JP_STOCKS[q]
    # .T 付き
    if q.endswith(".T") and q[:-2].isdigit() and q[:-2] in JP_STOCKS:
        return q, JP_STOCKS[q[:-2]]
    # 会社名部分一致
    ql = q.lower()
    for code, name in JP_STOCKS.items():
        if ql in name.lower() or ql == code:
            return f"{code}.T", name
    return None, None

def _get_dividend_info(ticker, name):
    """yfinanceで配当情報を取得 (キャッシュ付き)"""
    cached = _div_cache_get(f"div_{ticker}")
    if cached is not None:
        return cached
    try:
        t = yf.Ticker(ticker)
        info = t.info or {}
        divs = t.dividends  # pandas Series
        annual = 0.0
        history = []
        if divs is not None and len(divs) > 0:
            try:
                # 過去5年分を集計
                from datetime import datetime as _dt, timedelta as _td
                cutoff = _dt.now(divs.index.tz) - _td(days=365*5) if hasattr(divs.index, 'tz') and divs.index.tz else None
                # 年間合計
                by_year = divs.groupby(divs.index.year).sum()
                history = [{"year": int(y), "total": round(float(v), 2)} for y, v in by_year.tail(5).items()]
                # 直近年1年間の配当
                if len(history) > 0:
                    annual = history[-1]["total"]
                # トライリング配当もinfoから取りる
                td = info.get("trailingAnnualDividendRate")
                if td: annual = float(td)
            except Exception as _e:
                pass
        price = info.get("currentPrice") or info.get("regularMarketPrice") or 0
        # 配当利回り計算: annual_dividend / price * 100 を優先（最も信頼できる）
        # yfinance の dividendYield はスケール不安定（%だったり小数だったり）なのでフォールバックのみ
        if price and annual and price > 0:
            yield_pct = (annual / price) * 100
        else:
            dy = info.get("dividendYield") or 0
            # dividendYield が >1 なら既に%表示、≤1 なら小数表示と判定
            yield_pct = dy if dy > 1 else dy * 100
        # 次期配当見込み日
        ex_div_ts = info.get("exDividendDate")
        ex_div_date = None
        if ex_div_ts:
            try:
                ex_div_date = datetime.fromtimestamp(ex_div_ts).strftime("%Y-%m-%d")
            except Exception:
                ex_div_date = None
        result = {
            "ticker": ticker,
            "code": ticker.replace(".T", ""),
            "name": name,
            "price": round(float(price), 2) if price else None,
            "annual_dividend": round(float(annual), 2) if annual else 0,
            "yield_pct": round(float(yield_pct), 2) if yield_pct else 0,
            "payout_ratio": round(float(info.get("payoutRatio") or 0) * 100, 1),
            "ex_dividend_date": ex_div_date,
            "history": history,
            "currency": info.get("currency", "JPY"),
        }
        _div_cache_set(f"div_{ticker}", result)
        return result
    except Exception as e:
        print(f"[dividend] error for {ticker}: {e}")
        return None

@app.route("/api/dividend/list", methods=["GET"])
def api_dividend_list():
    """軽量な銘柄リスト (yfinanceを呼ばず、JP_STOCKSのマッピングだけ返す)"""
    items = [{"code": code, "name": name} for code, name in JP_STOCKS.items()]
    return jsonify({"items": items, "count": len(items)})

@app.route("/api/dividend/search", methods=["GET"])
def api_dividend_search():
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"error": "q required"}), 400
    ticker, name = _resolve_jp_ticker(q)
    if not ticker:
        return jsonify({"error": "not found", "query": q}), 404
    info = _get_dividend_info(ticker, name)
    if not info:
        return jsonify({"error": "fetch failed", "ticker": ticker}), 500
    return jsonify(info)

@app.route("/api/dividend/top", methods=["GET"])
def api_dividend_top():
    """高配当利回りランキング（部分スキャン+バックグラウンド警告）"""
    try:
        limit = int(request.args.get("limit", 30))
    except:
        limit = 30
    cached = _div_cache_get("top_yield")
    if cached:
        return jsonify({"items": cached[:limit], "cached": True})
    # キャッシュなし→限定スキャン（Renderワーカータイムアウト回避）
    results = _scan_dividends_partial(min(limit * 3, 60))
    results.sort(key=lambda x: x.get("yield_pct", 0), reverse=True)
    # 部分結果は短時間キャッシュ。全件はバックグラウンド warmer が後で上書き
    _div_cache_set("top_yield", results)
    # warmer disabled (RAM-bound on Render free tier)
    return jsonify({"items": results[:limit], "cached": False, "partial": True})

@app.route("/api/dividend/calendar", methods=["GET"])
def api_dividend_calendar():
    """権利落ち日カレンダー（部分スキャン+バックグラウンド警告）"""
    month = request.args.get("month", "")
    cached = _div_cache_get(f"cal_{month}")
    if cached:
        return jsonify({"days": cached, "cached": True})
    # 限定スキャン
    results = _scan_dividends_partial(80)
    by_day = {}
    for info in results:
        if info and info.get("ex_dividend_date"):
            d = info["ex_dividend_date"]
            if month and not d.startswith(month):
                continue
            by_day.setdefault(d, []).append({
                "code": info.get("code"), "name": info.get("name"),
                "yield_pct": info.get("yield_pct", 0),
                "annual_dividend": info.get("annual_dividend", 0),
            })
    days = sorted(by_day.items())
    out = [{"date": d, "items": items} for d, items in days]
    _div_cache_set(f"cal_{month}", out)
    # warmer disabled (RAM-bound on Render free tier)
    return jsonify({"days": out, "cached": False, "partial": True})

@app.route("/api/dividend/yearly", methods=["GET"])
def api_dividend_yearly():
    """年間配当総額ランキング（共有キャッシュ+部分スキャン）"""
    try:
        limit = int(request.args.get("limit", 30))
    except:
        limit = 30
    cached = _div_cache_get("yearly")
    if cached:
        sorted_items = sorted(cached, key=lambda x: x.get("annual_dividend", 0), reverse=True)
        return jsonify({"items": sorted_items[:limit], "cached": True})
    # top_yieldのキャッシュも使う
    cached_top = _div_cache_get("top_yield")
    if cached_top:
        sorted_items = sorted(cached_top, key=lambda x: x.get("annual_dividend", 0), reverse=True)
        return jsonify({"items": sorted_items[:limit], "cached": True, "source": "top_yield"})
    # 限定スキャン
    results = _scan_dividends_partial(min(limit * 3, 60))
    results.sort(key=lambda x: x.get("annual_dividend", 0), reverse=True)
    _div_cache_set("yearly", results)
    # warmer disabled (RAM-bound on Render free tier)
    return jsonify({"items": results[:limit], "cached": False, "partial": True})

# === 配当データ並列スキャン ヘルパー ===
def _div_cache_set_short(key, value):
    """部分結果は短期キャッシュ（5分）。warmerが完了したら上書きされる"""
    _dividend_cache[key] = (time.time() - _DIV_CACHE_TTL + 300, value)

def _scan_dividends_partial(n, hard_timeout=15):
    """JP_STOCKSの先頭n銘柄を並列スキャン。タイムアウト時は未完了タスクをキャンセル"""
    from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
    items = list(JP_STOCKS.items())[:n]
    if not items:
        return []
    def _one(item):
        code, name = item
        try:
            return _get_dividend_info(f"{code}.T", name)
        except Exception:
            return None
    ex = ThreadPoolExecutor(max_workers=12)
    try:
        futs = [ex.submit(_one, it) for it in items]
        deadline = time.time() + hard_timeout
        results = []
        remaining = set(futs)
        while remaining and time.time() < deadline:
            timeout_left = max(0.1, deadline - time.time())
            done, remaining = wait(remaining, timeout=timeout_left, return_when=FIRST_COMPLETED)
            for fut in done:
                try:
                    info = fut.result(timeout=0.01)
                    if info:
                        results.append(info)
                except Exception:
                    pass
        # 未完了タスクはキャンセル（実行中のものは止められないが、待たない）
        for fut in remaining:
            fut.cancel()
        return results
    finally:
        # wait=Falseで未完了スレッドを置き去りにする（プロセス終了時に消える）
        try:
            ex.shutdown(wait=False, cancel_futures=True)
        except TypeError:
            # Python<3.9
            ex.shutdown(wait=False)

# === バックグラウンドwarmer（全213銘柄をゆっくり収集してキャッシュ） ===
_DIV_WARMER_STARTED = False
_DIV_WARMER_LOCK = threading.Lock()

def _ensure_dividend_warmer():
    global _DIV_WARMER_STARTED
    with _DIV_WARMER_LOCK:
        if _DIV_WARMER_STARTED:
            return
        _DIV_WARMER_STARTED = True
    try:
        t = threading.Thread(target=_dividend_warmer_run, daemon=True)
        t.start()
        print("[dividend] warmer thread started")
    except Exception as e:
        print(f"[dividend] warmer start failed: {e}")
        with _DIV_WARMER_LOCK:
            _DIV_WARMER_STARTED = False

def _dividend_warmer_run():
    """全銘柄をバックグラウンドで収集してキャッシュ。小バッチで実行してメモリ圧迫を避ける"""
    try:
        from concurrent.futures import ThreadPoolExecutor
        all_items = list(JP_STOCKS.items())
        batch = 10
        results = []
        for i in range(0, len(all_items), batch):
            chunk = all_items[i:i+batch]
            ex = ThreadPoolExecutor(max_workers=6)
            try:
                def _one(item):
                    code, name = item
                    try:
                        return _get_dividend_info(f"{code}.T", name)
                    except Exception:
                        return None
                for info in ex.map(_one, chunk, timeout=60):
                    if info:
                        results.append(info)
            except Exception as e:
                print(f"[dividend] warmer batch {i} error: {e}")
            finally:
                try:
                    ex.shutdown(wait=False, cancel_futures=True)
                except TypeError:
                    ex.shutdown(wait=False)
            # 各バッチ後にキャッシュを更新（部分的に利用可能に）
            if results:
                top = sorted([r for r in results if r.get("yield_pct", 0) > 0],
                             key=lambda x: x.get("yield_pct", 0), reverse=True)
                yearly = sorted([r for r in results if r.get("annual_dividend", 0) > 0],
                                key=lambda x: x.get("annual_dividend", 0), reverse=True)
                _div_cache_set("top_yield", top)
                _div_cache_set("yearly", yearly)
            time.sleep(0.5)  # Yahoo へのレート緩和
        print(f"[dividend] warmer done: {len(results)} stocks total")
    except Exception as e:
        print(f"[dividend] warmer error: {e}")
    finally:
        # 次回再起動時に再度走らせるためフラグを残す（成功でも保持）
        pass

# warmer is now strictly on-demand only (manual /api/dividend/warmup or env DIVIDEND_WARMER=1)
# auto-kick disabled to avoid OOM on Render free tier


_SCANNER_CACHE = {"ts": 0, "data": None}
_SCANNER_TTL = 600

_SCANNER_TICKERS_JP = [
    "7203.T","6758.T","9984.T","6861.T","8035.T","6098.T","8306.T","9433.T",
    "9432.T","7974.T","6367.T","6594.T","4063.T","8316.T","6902.T","7741.T",
    "9983.T","4502.T","6981.T","6273.T","6857.T","6501.T","6502.T","6503.T",
    "7011.T","7267.T","7269.T","7270.T","8001.T","8002.T","8031.T","8053.T",
    "8058.T","8411.T","8591.T","8604.T","8725.T","8766.T","8801.T","8802.T",
    "8830.T","9020.T","9021.T","9022.T","9101.T","9104.T","9201.T","9202.T",
    "9501.T","9502.T"
]

_SCANNER_TICKERS_US = [
    "AAPL","MSFT","GOOGL","AMZN","META","TSLA","NVDA","BRK-B","JPM","V",
    "JNJ","WMT","PG","XOM","MA","UNH","HD","CVX","LLY","ABBV",
    "MRK","PFE","BAC","KO","PEP","ADBE","CSCO","TMO","ABT","COST",
    "AVGO","ACN","MCD","DHR","CRM","NFLX","NKE","WFC","ORCL","DIS",
    "INTC","AMD","QCOM","TXN","INTU","IBM","UPS","CAT","BA","GS"
]


def _build_scanner_data():
    syms = _SCANNER_TICKERS_JP + _SCANNER_TICKERS_US
    results = []
    try:
        data = yf.download(syms, period="3d", group_by="ticker", threads=True, progress=False, auto_adjust=False)
        for s in syms:
            try:
                df = data[s]
                closes = df["Close"].dropna()
                if len(closes) >= 2:
                    val = float(closes.iloc[-1])
                    prev = float(closes.iloc[-2])
                    if prev > 0:
                        pct = (val - prev) / prev * 100.0
                        results.append({
                            "symbol": s,
                            "price": round(val, 4),
                            "prev": round(prev, 4),
                            "pct": round(pct, 2)
                        })
            except Exception:
                continue
    except Exception:
        for s in syms:
            try:
                t = yf.Ticker(s)
                hist = t.history(period="3d")
                if len(hist) >= 2:
                    val = float(hist["Close"].iloc[-1])
                    prev = float(hist["Close"].iloc[-2])
                    if prev > 0:
                        pct = (val - prev) / prev * 100.0
                        results.append({
                            "symbol": s,
                            "price": round(val, 4),
                            "prev": round(prev, 4),
                            "pct": round(pct, 2)
                        })
            except Exception:
                continue
    results.sort(key=lambda r: r["pct"], reverse=True)
    return results


@app.route("/api/scanner", methods=["GET"])
def api_scanner():
    try:
        threshold = float(request.args.get("threshold", "3"))
    except Exception:
        threshold = 3.0
    threshold = abs(threshold)
    try:
        limit = int(request.args.get("limit", "10"))
    except Exception:
        limit = 10
    limit = max(1, min(20, limit))
    now = time.time()
    cached = _SCANNER_CACHE.get("data")
    cache_age = now - _SCANNER_CACHE.get("ts", 0)
    if not cached or cache_age >= _SCANNER_TTL:
        try:
            cached = _build_scanner_data()
            _SCANNER_CACHE["ts"] = now
            _SCANNER_CACHE["data"] = cached
        except Exception as e:
            return jsonify({"error": str(e), "surges": [], "drops": []}), 200
    pro = request.args.get("pro") == "1"
    if pro:
        pool = cached
    else:
        pool = [r for r in cached if str(r.get("symbol", "")).endswith(".T")]
    surges = [r for r in pool if r["pct"] >= threshold][:limit]
    drops_all = sorted([r for r in pool if r["pct"] <= -threshold], key=lambda r: r["pct"])
    drops = drops_all[:limit]
    return jsonify({
        "threshold": threshold,
        "updated_at": _SCANNER_CACHE.get("ts", 0),
        "cache_age_sec": int(now - _SCANNER_CACHE.get("ts", now)),
        "total_scanned": len(cached),
        "surges": surges,
        "drops": drops
    })



# ============================================================
# Gmail 連携 (家計簿 - メールから出費自動取り込み)
# ============================================================

GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
GMAIL_REDIRECT_URI = os.environ.get("GMAIL_REDIRECT_URI", "").strip()
TOKEN_ENCRYPTION_KEY = os.environ.get("TOKEN_ENCRYPTION_KEY", "")

# OAuth state を一時保存（プロセス内メモリ。短時間なのでOK）
_gmail_oauth_states = {}

def _get_fernet():
    """Fernet 暗号化オブジェクト。キーが無い/不正な場合はNoneを返す"""
    if not Fernet or not TOKEN_ENCRYPTION_KEY:
        return None
    try:
        return Fernet(TOKEN_ENCRYPTION_KEY.encode() if isinstance(TOKEN_ENCRYPTION_KEY, str) else TOKEN_ENCRYPTION_KEY)
    except Exception as e:
        print(f"[gmail] Fernet init error: {e}")
        return None

def _encrypt_token(plain_text):
    if not plain_text:
        return ""
    f = _get_fernet()
    if not f:
        return ""
    try:
        return f.encrypt(plain_text.encode()).decode()
    except Exception as e:
        print(f"[gmail] encrypt error: {e}")
        return ""

def _decrypt_token(cipher_text):
    if not cipher_text:
        return ""
    f = _get_fernet()
    if not f:
        return ""
    try:
        return f.decrypt(cipher_text.encode()).decode()
    except Exception as e:
        print(f"[gmail] decrypt error: {e}")
        return ""

def _build_gmail_flow(state=None):
    """Google OAuth Flow を生成"""
    if not Flow:
        return None
    client_config = {
        "web": {
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [GMAIL_REDIRECT_URI],
        }
    }
    flow = Flow.from_client_config(client_config, scopes=GMAIL_SCOPES, state=state)
    flow.redirect_uri = GMAIL_REDIRECT_URI
    return flow

@app.route("/gmail/connect", methods=["GET"])
def gmail_connect():
    """ユーザーが家計簿UIから「Gmail連携」を押したら、ここでGoogle認証画面に飛ばす"""
    line_user_id = request.args.get("line_user_id", "").strip()
    if not line_user_id:
        return "missing line_user_id", 400
    if not (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET and GMAIL_REDIRECT_URI):
        return "Gmail integration is not configured", 503
    flow = _build_gmail_flow()
    if not flow:
        return "Gmail libraries not available", 503
    state = _secrets_mod.token_urlsafe(24)
    _gmail_oauth_states[state] = {
        "line_user_id": line_user_id,
        "ts": time.time(),
    }
    # 古いstateを掃除
    cutoff = time.time() - 600
    for k in list(_gmail_oauth_states.keys()):
        if _gmail_oauth_states[k].get("ts", 0) < cutoff:
            _gmail_oauth_states.pop(k, None)
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
        state=state,
    )
    _gmail_oauth_states[state]["code_verifier"] = flow.code_verifier
    return redirect(auth_url)

@app.route("/oauth/gmail/callback", methods=["GET"])
def gmail_oauth_callback():
    """Googleからリダイレクトで戻ってくる先"""
    state = request.args.get("state", "")
    code = request.args.get("code", "")
    error = request.args.get("error", "")
    if error:
        return f"Authorization error: {error}", 400
    if not state or state not in _gmail_oauth_states:
        return "Invalid or expired state", 400
    info = _gmail_oauth_states.pop(state)
    line_user_id = info.get("line_user_id")
    if not line_user_id:
        return "Invalid session", 400
    flow = _build_gmail_flow(state=state)
    if not flow:
        return "Gmail libraries not available", 503
    try:
        flow.code_verifier = info.get("code_verifier")
        flow.fetch_token(code=code)
    except Exception as e:
        print(f"[gmail] token fetch error: {e}")
        return "Failed to exchange token", 400
    creds = flow.credentials
    enc_access = _encrypt_token(creds.token or "")
    enc_refresh = _encrypt_token(creds.refresh_token or "")
    expiry_iso = creds.expiry.isoformat() if creds.expiry else None
    gmail_addr = ""
    try:
        if build:
            svc = build("gmail", "v1", credentials=creds, cache_discovery=False)
            profile = svc.users().getProfile(userId="me").execute()
            gmail_addr = profile.get("emailAddress", "")
    except Exception as e:
        print(f"[gmail] profile fetch error: {e}")
    try:
        record = {
            "line_user_id": line_user_id,
            "encrypted_access_token": enc_access,
            "encrypted_refresh_token": enc_refresh,
            "token_expiry": expiry_iso,
            "gmail_address": gmail_addr,
            "scope": " ".join(GMAIL_SCOPES),
            "is_active": True,
            "updated_at": datetime.now().isoformat(),
        }
        existing = supabase.table("user_gmail_tokens").select("id").eq("line_user_id", line_user_id).execute()
        if existing.data:
            supabase.table("user_gmail_tokens").update(record).eq("line_user_id", line_user_id).execute()
        else:
            supabase.table("user_gmail_tokens").insert(record).execute()
    except Exception as e:
        print(f"[gmail] supabase save error: {e}")
        return "Failed to save credentials", 500
    return """<!doctype html><html><head><meta charset='utf-8'><title>Gmail連携完了</title>
    <meta name='viewport' content='width=device-width,initial-scale=1'>
    <style>body{font-family:sans-serif;text-align:center;padding:40px 20px;background:#f7f9fc}
    .card{background:#fff;border-radius:12px;padding:32px;max-width:420px;margin:0 auto;box-shadow:0 4px 16px rgba(0,0,0,.06)}
    h1{color:#1a8a3a}p{color:#555;line-height:1.6}</style></head>
    <body><div class='card'><h1>✅ Gmail連携が完了しました</h1>
    <p>このウィンドウを閉じて、家計簿の画面に戻ってください。</p></div></body></html>"""

def _get_gmail_credentials(line_user_id):
    try:
        res = supabase.table("user_gmail_tokens").select("*").eq("line_user_id", line_user_id).eq("is_active", True).execute()
        if not res.data:
            return None
        row = res.data[0]
        access = _decrypt_token(row.get("encrypted_access_token", ""))
        refresh = _decrypt_token(row.get("encrypted_refresh_token", ""))
        if not access and not refresh:
            return None
        if not Credentials:
            return None
        creds = Credentials(
            token=access or None,
            refresh_token=refresh or None,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=GOOGLE_CLIENT_ID,
            client_secret=GOOGLE_CLIENT_SECRET,
            scopes=GMAIL_SCOPES,
        )
        return creds
    except Exception as e:
        print(f"[gmail] get creds error: {e}")
        return None

_EXPENSE_AMOUNT_PATTERNS = [
    re.compile(r"(?:利用金額|ご利用金額|金額|合計|請求金額|お支払金額|ご請求金額)[\s\S]{0,12}?([0-9,]+)\s*円"),
    re.compile(r"([0-9,]+)\s*円(?:のお支払|のご利用|をご利用|を承りました|の決済)"),
    re.compile(r"¥\s*([0-9,]+)"),
    re.compile(r"JPY\s*([0-9,]+)"),
]
_EXPENSE_MERCHANT_PATTERNS = [
    re.compile(r"(?:ご利用先|利用先|店舗名|加盟店|ご利用店舗)[\s\S]{0,4}?[:：]\s*([^\n\r]+)"),
]

def _parse_expense_from_text(text):
    if not text:
        return None
    amount = None
    for pat in _EXPENSE_AMOUNT_PATTERNS:
        m = pat.search(text)
        if m:
            try:
                amount = float(m.group(1).replace(",", ""))
                break
            except Exception:
                continue
    if amount is None or amount <= 0:
        return None
    merchant = None
    for pat in _EXPENSE_MERCHANT_PATTERNS:
        m = pat.search(text)
        if m:
            merchant = m.group(1).strip()[:80]
            break
    return {"amount": amount, "merchant": merchant or ""}

def _extract_message_body(payload):
    """Gmail API のメッセージ payload からテキスト本文を抽出"""
    def _walk(p):
        if not p:
            return ""
        mime = p.get("mimeType", "")
        body = p.get("body", {})
        data = body.get("data")
        if data and mime.startswith("text/"):
            try:
                return base64.urlsafe_b64decode(data.encode()).decode("utf-8", errors="ignore")
            except Exception:
                return ""
        parts = p.get("parts") or []
        chunks = []
        for sub in parts:
            chunks.append(_walk(sub))
        return "\n".join([c for c in chunks if c])
    return _walk(payload)

def sync_gmail_for_user(line_user_id, max_messages=20):
    """ユーザーのGmailから決済通知メールを取り込んでSupabaseに保存"""
    creds = _get_gmail_credentials(line_user_id)
    if not creds or not build:
        return {"ok": False, "reason": "not_connected"}
    try:
        svc = build("gmail", "v1", credentials=creds, cache_discovery=False)
        q = "(利用 OR 決済 OR お支払い OR ご請求 OR 引き落とし) newer_than:30d"
        resp = svc.users().messages().list(userId="me", q=q, maxResults=max_messages).execute()
        msgs = resp.get("messages", []) or []
        imported = 0
        skipped = 0
        for m in msgs:
            mid = m.get("id")
            if not mid:
                continue
            try:
                existing = supabase.table("gmail_imported_expenses").select("id").eq("gmail_message_id", mid).execute()
                if existing.data:
                    skipped += 1
                    continue
            except Exception:
                pass
            try:
                full = svc.users().messages().get(userId="me", id=mid, format="full").execute()
            except Exception as e:
                print(f"[gmail] fetch msg error: {e}")
                continue
            payload = full.get("payload", {})
            headers = {h.get("name", "").lower(): h.get("value", "") for h in payload.get("headers", [])}
            subject = headers.get("subject", "")
            email_from = headers.get("from", "")
            date_hdr = headers.get("date", "")
            body_text = _extract_message_body(payload)
            snippet = (full.get("snippet") or "")[:300]
            text_for_parse = (subject + "\n" + body_text + "\n" + snippet)
            parsed = _parse_expense_from_text(text_for_parse)
            if not parsed:
                continue
            try:
                received_at = None
                try:
                    from email.utils import parsedate_to_datetime
                    if date_hdr:
                        received_at = parsedate_to_datetime(date_hdr).isoformat()
                except Exception:
                    received_at = None
                supabase.table("gmail_imported_expenses").insert({
                    "line_user_id": line_user_id,
                    "gmail_message_id": mid,
                    "email_from": email_from[:200],
                    "email_subject": subject[:300],
                    "email_received_at": received_at,
                    "amount": parsed["amount"],
                    "merchant": parsed["merchant"][:120],
                    "category": None,
                    "currency": "JPY",
                    "raw_snippet": snippet,
                    "status": "imported",
                }).execute()
                imported += 1
            except Exception as e:
                print(f"[gmail] insert error: {e}")
        try:
            supabase.table("user_gmail_tokens").update({
                "last_synced_at": datetime.now().isoformat()
            }).eq("line_user_id", line_user_id).execute()
        except Exception:
            pass
        return {"ok": True, "imported": imported, "skipped": skipped, "scanned": len(msgs)}
    except Exception as e:
        print(f"[gmail] sync error: {e}")
        return {"ok": False, "reason": "sync_error", "error": str(e)}

@app.route("/api/gmail/status", methods=["GET"])
def api_gmail_status():
    line_user_id = request.args.get("line_user_id", "").strip()
    if not line_user_id:
        return jsonify({"connected": False, "reason": "missing_user"}), 400
    try:
        res = supabase.table("user_gmail_tokens").select("gmail_address,is_active,last_synced_at,updated_at").eq("line_user_id", line_user_id).execute()
        if not res.data:
            return jsonify({"connected": False})
        row = res.data[0]
        return jsonify({
            "connected": bool(row.get("is_active")),
            "gmail_address": row.get("gmail_address", ""),
            "last_synced_at": row.get("last_synced_at"),
            "updated_at": row.get("updated_at"),
        })
    except Exception as e:
        return jsonify({"connected": False, "error": str(e)}), 500

@app.route("/api/gmail/sync_now", methods=["POST"])
def api_gmail_sync_now():
    data = request.get_json(silent=True) or {}
    line_user_id = (data.get("line_user_id") or "").strip()
    if not line_user_id:
        return jsonify({"ok": False, "reason": "missing_user"}), 400
    result = sync_gmail_for_user(line_user_id, max_messages=30)
    return jsonify(result)

@app.route("/api/gmail/disconnect", methods=["POST"])
def api_gmail_disconnect():
    data = request.get_json(silent=True) or {}
    line_user_id = (data.get("line_user_id") or "").strip()
    if not line_user_id:
        return jsonify({"ok": False, "reason": "missing_user"}), 400
    try:
        supabase.table("user_gmail_tokens").update({"is_active": False}).eq("line_user_id", line_user_id).execute()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route("/api/gmail/imported", methods=["GET"])
def api_gmail_imported():
    line_user_id = request.args.get("line_user_id", "").strip()
    limit = int(request.args.get("limit", "50"))
    if not line_user_id:
        return jsonify({"items": [], "reason": "missing_user"}), 400
    try:
        res = supabase.table("gmail_imported_expenses").select("*").eq("line_user_id", line_user_id).order("email_received_at", desc=True).limit(limit).execute()
        return jsonify({"items": res.data or []})
    except Exception as e:
        return jsonify({"items": [], "error": str(e)}), 500

@app.route("/gmail/sync_all", methods=["GET"])
def gmail_sync_all():
    """全アクティブユーザーのGmailを定期同期 (cron用)"""
    if request.args.get("secret", "") != os.environ.get("CRON_SECRET", ""):
        abort(403)
    try:
        res = supabase.table("user_gmail_tokens").select("line_user_id").eq("is_active", True).execute()
        users = [r["line_user_id"] for r in (res.data or []) if r.get("line_user_id")]
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
    total_imported = 0
    for uid in users:
        try:
            r = sync_gmail_for_user(uid, max_messages=20)
            if r.get("ok"):
                total_imported += r.get("imported", 0)
        except Exception as e:
            print(f"[gmail cron] error for {uid}: {e}")
    return jsonify({"ok": True, "users": len(users), "imported": total_imported})

# ============================================================
# Gmail 連携 ここまで
# ============================================================
# ============================================================
# メール転送方式（Cloudflare Email Worker から受信）
# ============================================================

INBOUND_MAIL_DOMAIN = os.environ.get("INBOUND_MAIL_DOMAIN", "").strip()
INBOUND_MAIL_SECRET = os.environ.get("INBOUND_MAIL_SECRET", "").strip()

def _get_or_create_mail_code(line_user_id):
    """ユーザーごとの転送用コードを取得（無ければ生成して users テーブルに保存）"""
    try:
        res = supabase.table("users").select("mail_code").eq("line_user_id", line_user_id).execute()
        if res.data and res.data[0].get("mail_code"):
            return res.data[0]["mail_code"]
    except Exception as e:
        print(f"[mail] get code error: {e}")
    code = _secrets_mod.token_hex(5)
    try:
        upd = supabase.table("users").update({"mail_code": code}).eq("line_user_id", line_user_id).execute()
        if not upd.data:
            supabase.table("users").insert({"line_user_id": line_user_id, "mail_code": code, "lang": "ja"}).execute()
    except Exception as e:
        print(f"[mail] set code error: {e}")
    return code

def _find_user_by_mail_code(code):
    if not code:
        return None
    try:
        res = supabase.table("users").select("line_user_id").eq("mail_code", code).execute()
        if res.data:
            return res.data[0].get("line_user_id")
    except Exception as e:
        print(f"[mail] find user error: {e}")
    return None

@app.route("/api/mail/address", methods=["GET"])
def api_mail_address():
    """家計簿画面に表示する、ユーザー専用の転送先アドレスを返す"""
    line_user_id = request.args.get("user_id", "").strip()
    if not line_user_id:
        return jsonify({"ok": False, "reason": "missing_user"}), 400
    if not INBOUND_MAIL_DOMAIN:
        return jsonify({"ok": False, "reason": "not_configured"}), 200
    code = _get_or_create_mail_code(line_user_id)
    address = f"receipt+{code}@{INBOUND_MAIL_DOMAIN}"
    return jsonify({"ok": True, "address": address})

@app.route("/inbound/mail", methods=["POST"])
def inbound_mail():
    """Cloudflare Email Worker から転送メールを受信して家計簿に保存"""
    if INBOUND_MAIL_SECRET:
        if request.headers.get("X-Inbound-Secret", "") != INBOUND_MAIL_SECRET:
            abort(403)
    data = request.get_json(force=True, silent=True) or {}
    to_addr = (data.get("to") or "").strip()
    subject = (data.get("subject") or "")
    body_text = (data.get("text") or data.get("body") or "")
    email_from = (data.get("from") or "")
    mid = (data.get("message_id") or _secrets_mod.token_hex(8))
    code = None
    m = re.search(r"receipt\+([0-9a-zA-Z]+)@", to_addr)
    if m:
        code = m.group(1)
    line_user_id = _find_user_by_mail_code(code)
    if not line_user_id:
        return jsonify({"ok": False, "reason": "unknown_recipient"}), 200
    text_for_parse = (subject + "\n" + body_text)
    parsed = _parse_expense_from_text(text_for_parse)
    if not parsed:
        return jsonify({"ok": False, "reason": "no_expense_found"}), 200
    try:
        existing = supabase.table("gmail_imported_expenses").select("id").eq("gmail_message_id", mid).execute()
        if existing.data:
            return jsonify({"ok": True, "skipped": True})
    except Exception:
        pass
    try:
        supabase.table("gmail_imported_expenses").insert({
            "line_user_id": line_user_id,
            "gmail_message_id": mid,
            "email_from": email_from[:200],
            "email_subject": subject[:300],
            "email_received_at": datetime.now().isoformat(),
            "amount": parsed["amount"],
            "merchant": parsed["merchant"][:120],
            "category": None,
            "currency": "JPY",
            "raw_snippet": body_text[:300],
            "status": "imported",
        }).execute()
    except Exception as e:
        print(f"[mail] insert error: {e}")
        return jsonify({"ok": False, "reason": "db_error"}), 500
    return jsonify({"ok": True, "imported": 1, "amount": parsed["amount"], "merchant": parsed["merchant"]})



@app.route("/api/messages", methods=["GET", "POST"])
def api_messages():
    if request.method == "GET":
        res = supabase.table("messages").select("*").order("id", desc=True).limit(100).execute()
        rows = list(reversed(res.data or []))
        return jsonify({"ok": True, "messages": rows})
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()[:20] or "名無しさん"
    body = (data.get("body") or "").strip()
    if not body:
        return jsonify({"ok": False, "reason": "empty"}), 400
    if len(body) > 200:
        return jsonify({"ok": False, "reason": "too_long"}), 400
    ng_words = ["振込", "儲かります", "必ず儲", "lineで検索", "@で検索", "稼げる"]
    low = body.lower()
    if any(w.lower() in low for w in ng_words):
        return jsonify({"ok": False, "reason": "ng_word"}), 400
    try:
        supabase.table("messages").insert({"name": name, "body": body}).execute()
    except Exception as e:
        print(f"[messages] insert error: {e}")
        return jsonify({"ok": False, "reason": "db_error"}), 500
    return jsonify({"ok": True})


ALLOWED_SYMBOLS = {
    "N225": "日経平均",
    "SP500": "S&P500",
    "DJI": "ダウ平均",
    "IXIC": "ナスダック",
    "7203.T": "トヨタ",
    "6758.T": "ソニー",
    "9984.T": "ソフトバンクG",
    "8306.T": "三菱UFJ",
}

@app.route("/api/stock-comments", methods=["GET", "POST"])
def api_stock_comments():
    if request.method == "GET":
        symbol = (request.args.get("symbol") or "").strip()
        if symbol not in ALLOWED_SYMBOLS:
            return jsonify({"ok": False, "reason": "bad_symbol"}), 400
        try:
            res = supabase.table("stock_comments").select("*").eq("symbol", symbol).order("id", desc=True).limit(100).execute()
            rows = list(reversed(res.data or []))
        except Exception as e:
            print(f"[stock_comments] get error: {e}")
            return jsonify({"ok": False, "reason": "db_error"}), 500
        return jsonify({"ok": True, "comments": rows})
    data = request.get_json(silent=True) or {}
    symbol = (data.get("symbol") or "").strip()
    if symbol not in ALLOWED_SYMBOLS:
        return jsonify({"ok": False, "reason": "bad_symbol"}), 400
    name = (data.get("name") or "").strip()[:20] or "名無しさん"
    body = (data.get("body") or "").strip()
    if not body:
        return jsonify({"ok": False, "reason": "empty"}), 400
    if len(body) > 200:
        return jsonify({"ok": False, "reason": "too_long"}), 400
    ng_words = ["振込", "儲かります", "必ず儲", "lineで検索", "@で検索", "稼げる", "絶対儲か", "元本保証"]
    low = body.lower()
    if any(w.lower() in low for w in ng_words):
        return jsonify({"ok": False, "reason": "ng_word"}), 400
    try:
        supabase.table("stock_comments").insert({"symbol": symbol, "name": name, "body": body}).execute()
    except Exception as e:
        print(f"[stock_comments] insert error: {e}")
        return jsonify({"ok": False, "reason": "db_error"}), 500
    return jsonify({"ok": True})


ADMIN_PASS = os.environ.get("ADMIN_PASS", "")

def check_admin(req):
    pw = req.headers.get("X-Admin-Pass")
    if not pw:
        body = req.get_json(silent=True) or {}
        pw = body.get("pass") or req.args.get("pass")
    return bool(ADMIN_PASS) and pw == ADMIN_PASS

@app.route("/api/admin/stats", methods=["GET", "POST"])
def admin_stats():
    if not ADMIN_PASS:
        return jsonify({"ok": False, "reason": "not_configured"}), 503
    if not check_admin(request):
        return jsonify({"ok": False, "reason": "auth"}), 401
    out = {"ok": True, "users": 0, "messages": 0, "today_messages": 0}
    try:
        u = supabase.table("users").select("*", count="exact").limit(1).execute()
        out["users"] = u.count or 0
    except Exception as e:
        print(f"[admin] users count error: {e}")
    try:
        m = supabase.table("messages").select("*", count="exact").limit(1).execute()
        out["messages"] = m.count or 0
        today = date.today().isoformat()
        tm = supabase.table("messages").select("*", count="exact").gte("created_at", today).limit(1).execute()
        out["today_messages"] = tm.count or 0
    except Exception as e:
        print(f"[admin] messages count error: {e}")
    return jsonify(out)


def _line_admin_command(api, line_user_id, reply_token, text_lower):
    """Letty本人や許可した人からの管理コマンドに反応。処理したらTrue。"""
    try:
        allowed = set()
        if ADMIN_USER_ID:
            allowed.add(ADMIN_USER_ID)
        _extra = os.environ.get("ADMIN_LINE_IDS", "")
        for _x in _extra.split(","):
            _x = _x.strip()
            if _x:
                allowed.add(_x)
        if line_user_id not in allowed:
            return False
        if text_lower not in ("統計", "管理", "状況", "stats", "admin"):
            return False
        a_users = a_msgs = a_today = 0
        try:
            _u = supabase.table("users").select("*", count="exact").limit(1).execute()
            a_users = _u.count or 0
        except Exception as e:
            print(f"[admin-line] users err: {e}")
        try:
            _m = supabase.table("messages").select("*", count="exact").limit(1).execute()
            a_msgs = _m.count or 0
            _today = date.today().isoformat()
            _tm = supabase.table("messages").select("*", count="exact").gte("created_at", _today).limit(1).execute()
            a_today = _tm.count or 0
        except Exception as e:
            print(f"[admin-line] msgs err: {e}")
        txt = (
            "📊 管理ダッシュボード\n"
            "────────────\n"
            f"👥 利用者数: {a_users}人\n"
            f"💬 コミュニティ投稿: {a_msgs}件\n"
            f"📝 今日の投稿: {a_today}件\n"
            "────────────\n"
            "「統計」と送ればいつでも確認できます。"
        )
        api.reply_message(ReplyMessageRequest(
            reply_token=reply_token,
            messages=[TextMessage(text=txt)]
        ))
        return True
    except Exception as e:
        print(f"[admin-line] error: {e}")
        return False


TEACHER_PROMPT = (
    "あなたは「経済NEWS」サイトの『投資の先生』です。投資初心者に、やさしく辛抱強く教える先生として振る舞ってください。"
    "教える順番は次の通り: (1)目的(なぜ・いつまでに・いくら必要か) (2)生活防衛資金の確保 (3)無理のない毎月の積立額 (4)自動化・仕組み化 (5)長期・分散・低コストの考え方 (6)ときどき点検。"
    "一度にたくさん説明せず、質問を1つずつ投げかけ、相手の答えを受け止めてから次のステップに進んでください。"
    "専門用語は身近な例えで噛み砕いて説明してください。"
    "リスクは正直に伝えてください: 投資はお金が増えることも減ることもあり、元本は保証されません。一時的に2〜3割下がることもあります。"
    "次のことは絶対にしないでください: 個別の投資助言、特定の金融商品・銘柄・証券会社のおすすめ、『買い時』『今が買い』などタイミングの断定、利回りや儲けの保証、『必ず儲かる』といった表現。"
    "もし特定の商品や『何を買えばいい?』と聞かれたら、やんわり断り、考え方の整理にやさしく戻してください。最終的な判断は必ず本人が行うよう促してください。"
    "返答はあたたかく、簡潔に(目安250〜350文字)、必要なら箇条書きも使ってください。最後はいつも、次の小さな一歩をやさしく促す形で締めてください。"
    "大切な姿勢: 焺らせない・脅さない・断定しない。少額からでいい、わからないところは立ち止まっていい、続けられる範囲が正解、という温度感で伴走してください。"
)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
