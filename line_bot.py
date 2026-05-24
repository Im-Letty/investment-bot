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
from flask import Flask, request, abort, jsonify, redirect
from linebot.v3 import WebhookHandler
from linebot.v3.exceptions import InvalidSignatureError
from linebot.v3.messaging import (
    Configuration, ApiClient, MessagingApi,
    ReplyMessageRequest, TextMessage, PushMessageRequest
)
from linebot.v3.webhooks import MessageEvent, TextMessageContent, FollowEvent
from datetime import date, datetime

app = Flask(__name__)
APP_START_TIME = datetime.now()
APP_VERSION = "v32"

ANTHROPIC_API_KEY   = os.environ.get("ANTHROPIC_API_KEY", "")
LINE_CHANNEL_SECRET = os.environ.get("LINE_CHANNEL_SECRET", "")
LINE_CHANNEL_TOKEN  = os.environ.get("LINE_CHANNEL_TOKEN", "")
LINE_USER_ID        = os.environ.get("LINE_USER_ID", "")
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
            "en": "📝 Register your asset info!\n\nPlease send in this format:\n\nName: XX\nAnnual income: XX\nTotal assets: XX\nMonthly investment: XX\nTarget assets: XX\nStocks owned: Stock name Shares Price\nTrading stocks: Stock name",
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
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
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
        if "名前：" in line or "名前:" in line or "Name:" in line or "name:" in line:
            data["name"] = line.split("：")[-1].split(":")[-1].strip()
        elif "年収：" in line or "年収:" in line or "income:" in line.lower():
            data["financial_info"] = line.strip()
        elif "総資産：" in line or "総資産:" in line or "total assets:" in line.lower():
            data["target_asset"] = line.strip()
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
                val   = hist["Close"].iloc[-1]
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
                val   = hist["Close"].iloc[-1]
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

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
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
            api.reply_message(ReplyMessageRequest(
                reply_token=reply_token,
                messages=[TextMessage(text=get_message(cmd_lang, "settings_text"))]
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
    try:
        res = supabase.table("users").select("line_user_id, lang").execute()
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
        try:
            if lang not in cache:
                cache[lang] = generate_morning_report(lang)
            send_line_message(cache[lang], user_id=uid)
            sent += 1
        except Exception as e:
            errors += 1
            print(f"[morning] send error to {uid}: {e}")

    return f"OK sent={sent} errors={errors} skipped={skipped} langs={list(cache.keys())}"

@app.route("/alert", methods=["GET"])
def alert():
    if request.args.get("secret", "") != os.environ.get("CRON_SECRET", ""):
        abort(403)
    check_alerts()
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
    if not symbol:
        return jsonify({"error": "symbol is required"}), 400
    try:
        t = yf.Ticker(symbol)
        hist = t.history(period="5d")
        info = t.info
        name = info.get("shortName") or info.get("longName") or symbol
        currency = info.get("currency") or ""
        if len(hist) >= 2:
            val = hist["Close"].iloc[-1]
            prev = hist["Close"].iloc[-2]
            pct = (val - prev) / prev * 100
            arrow = "▲" if pct >= 0 else "▼"
            return jsonify({
                "symbol": symbol,
                "name": name,
                "currency": currency,
                "price": round(val, 4),
                "pct": round(pct, 2),
                "display": f"{val:,.2f} {arrow}{abs(pct):.2f}%",
                "change": arrow + str(round(abs(pct), 2)) + "%"
            })
        elif len(hist) == 1:
            val = hist["Close"].iloc[-1]
            return jsonify({
                "symbol": symbol,
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
        })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/")
def index():
    with open("index.html", encoding="utf-8") as f:
        return f.read(), 200, {"Content-Type": "text/html"}

# Start translation preload in background (works for both gunicorn and direct run)
try:
    _preload_thread = threading.Thread(target=preload_translations, daemon=True)
    _preload_thread.start()
except Exception as _e:
    print("[preload] Could not start thread:", _e)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
