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
    "7203.T",  # ãã¨ã¿
    "6758.T",  # ã½ãã¼
    "9984.T",  # ã½ãããã³ã¯ã°ã«ã¼ã
    "6861.T",  # ã­ã¼ã¨ã³ã¹
    "8306.T",  # ä¸è±UFJ
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
            "ja": "æã¬ã¿ã¼ãçæä¸­ã§ãã\nå°ããå¾ã¡ãã ããï¼1ã2åï¼...",
            "en": "Generating morning report.\nPlease wait (1-2 min)...",
            "ko": "ìì¹¨ ë í°ë¥¼ ìì± ì¤ìëë¤.\nì ì ê¸°ë¤ë ¤ì£¼ì¸ì...",
            "zh": "æ­£å¨çææ©æ¥ã\nè¯·ç¨å...",
        },
        "register_form": {
            "ja": "ð è³ç£æå ±ãç»é²ãã¾ãï¼\n\nä»¥ä¸ã®å½¢å¼ã§éã£ã¦ãã ããï¼\n\nååï¼ãã\nå¹´åï¼ããä¸å\nç·è³ç£ï¼ããä¸å\næ¯ææè³é¡ï¼ããä¸å\nç®æ¨è³ç£ï¼ããä¸å\nä¿ææ ªï¼éæå æ ªæ° åå¾ä¾¡æ ¼å\nãã¬ã¼ãéæï¼éæå",
            "en": "ð Register your asset info!\n\nPlease send in this format:\n\nName: XX\nAnnual income: XX\nTotal assets: XX\nMonthly investment: XX\nTarget assets: XX\nStocks owned: Stock name Shares Price\nTrading stocks: Stock name",
            "ko": "ð ìì° ì ë³´ë¥¼ ë±ë¡í©ëë¤ï¼\n\në¤ì íìì¼ë¡ ë³´ë´ì£¼ì¸ìï¼\n\nì´ë¦ï¼ãã\nì°ììï¼ãã\nì´ìì°ï¼ãã\nì í¬ìì¡ï¼ãã\nëª©íìì°ï¼ãã\në³´ì ì£¼ìï¼ì¢ëª©ëª ì£¼ì ê°ê²©\ní¸ë ì´ë ì¢ëª©ï¼ì¢ëª©ëª",
            "zh": "ð æ³¨åèµäº§ä¿¡æ¯ï¼\n\nè¯·æä»¥ä¸æ ¼å¼åéï¼\n\nå§åï¼ãã\nå¹´æ¶å¥ï¼ãã\næ»èµäº§ï¼ãã\næ¯ææèµé¢ï¼ãã\nç®æ èµäº§ï¼ãã\nææè¡ç¥¨ï¼è¡ç¥¨åç§° è¡æ° ä»·æ ¼\näº¤æè¡ç¥¨ï¼è¡ç¥¨åç§°",
        },
        "analyzing": {
            "ja": "ð è³ç£åæä¸­ã§ãã\nå°ããå¾ã¡ãã ãã...",
            "en": "ð Analyzing your assets.\nPlease wait...",
            "ko": "ð ìì° ë¶ì ì¤ìëë¤.\nì ì ê¸°ë¤ë ¤ì£¼ì¸ì...",
            "zh": "ð æ­£å¨åææ¨çèµäº§ã\nè¯·ç¨å...",
        },
        "no_assets": {
            "ja": "ã¾ã è³ç£æå ±ãç»é²ããã¦ãã¾ããã\nãç»é²ãã¨éã£ã¦æå ±ãç»é²ãã¦ãã ããð",
            "en": "No asset info registered yet.\nPlease send 'register' to add your infoð",
            "ko": "ìì§ ìì° ì ë³´ê° ììµëë¤.\n'ë±ë¡'ì ë³´ë´ì£¼ì¸ìð",
            "zh": "å°æªæ³¨åèµäº§ä¿¡æ¯ã\nè¯·åé'æ³¨å'ð",
        },
        "saved": {
            "ja": "â ä¿å­ãã¾ããï¼\nãåæãã¦ãã¨éãã¨è³ç£åæãã§ãã¾ãð",
            "en": "â Saved!\nSend 'analyze' to get your asset analysisð",
            "ko": "â ì ì¥íìµëë¤ï¼\n'ë¶ì'ì ë³´ë´ì£¼ì¸ìð",
            "zh": "â å·²ä¿å­ï¼\nåé'åæ'å³å¯ð",
        },
        "waiting": {
            "ja": "ç¢ºèªãã¦ãã¾ããå°ããå¾ã¡ãã ãã...",
            "en": "Checking. Please wait...",
            "ko": "íì¸ ì¤ìëë¤. ì ì ê¸°ë¤ë ¤ì£¼ì¸ì...",
            "zh": "æ­£å¨ç¡®è®¤ãè¯·ç¨å...",
        },
    }
    return messages.get(key, {}).get(lang, messages.get(key, {}).get("ja", ""))

def detect_intent(text, lang="ja"):
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    prompt = f"""
ã¦ã¼ã¶ã¼ã®ã¡ãã»ã¼ã¸ãèª­ãã§ãæå³ãä»¥ä¸ã®6ã¤ãã1ã¤ã ãé¸ãã§ãã ããã
åç­ã¯å¿ããã®åèª1ã¤ã ãè¿ãã¦ãã ãããä»ã®è¨èã¯ä¸åä¸è¦ã§ãã

é¸æè¢ï¼
- morning    â¦ æã¬ã¿ã¼ã»ä»æ¥ã®ç¸å ´ã»ãã¥ã¼ã¹ãè¦ãã
- register   â¦ æå ±ç»é²ã»åå ãããã»å§ãããã»æ°è¦ç»é²ã»ä½¿ããã
- analyze    â¦ èªåã®è³ç£ãåæãã¦ã»ããã»ãã¼ããã©ãªãªç¢ºèª
- save       â¦ ã³ã­ã³ï¼ï¼ã¾ãã¯:ï¼ãå«ãæå ±å¥å
- simulator  â¦ ã·ãã¥ã¬ã¼ã¿ã¼ã»æè³è¨ç®ã»éç¨è¨ç®ãè¦ãã
- question   â¦ ä¸è¨ä»¥å¤ã®è³ªåã»éè«ã»ãã®ä»

ã¦ã¼ã¶ã¼ã®ã¡ãã»ã¼ã¸ï¼ã{text}ã

åç­ï¼1åèªã®ã¿ï¼ï¼"""

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
        if "ååï¼" in line or "åå:" in line or "Name:" in line or "name:" in line:
            data["name"] = line.split("ï¼")[-1].split(":")[-1].strip()
        elif "å¹´åï¼" in line or "å¹´å:" in line or "income:" in line.lower():
            data["financial_info"] = line.strip()
        elif "ç·è³ç£ï¼" in line or "ç·è³ç£:" in line or "total assets:" in line.lower():
            data["target_asset"] = line.strip()
        elif "æ¯ææè³é¡ï¼" in line or "æ¯ææè³é¡:" in line or "monthly:" in line.lower():
            data["savings"] = line.strip()
        elif "ç®æ¨è³ç£ï¼" in line or "ç®æ¨è³ç£:" in line or "target:" in line.lower():
            data["target_asset"] = line.strip()
        elif "ä¿ææ ªï¼" in line or "ä¿ææ ª:" in line or "stocks owned:" in line.lower():
            data["stocks_owned"] = line.split("ï¼")[-1].split(":")[-1].strip()
        elif "ãã¬ã¼ãéæï¼" in line or "ãã¬ã¼ãéæ:" in line or "trading:" in line.lower():
            data["stocks_traded"] = line.split("ï¼")[-1].split(":")[-1].strip()
        elif "åºè²»ï¼" in line or "åºè²»:" in line or "expenses:" in line.lower():
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
        "æ¥çµ225":    "^N225",
        "ãã«å":     "JPY=X",
        "ç±³10å¹´éå©": "^TNX",
        "S&P500":    "^GSPC",
        "NYãã¦":     "^DJI",
        "VIXææææ°":"^VIX",
    }
    results = {}
    for label, symbol in tickers.items():
        try:
            hist = yf.Ticker(symbol).history(period="5d")
            if len(hist) >= 2:
                val   = hist["Close"].iloc[-1]
                prev  = hist["Close"].iloc[-2]
                pct   = (val - prev) / prev * 100
                arrow = "â²" if pct >= 0 else "â¼"
                results[label] = {
                    "display": f"{val:,.2f}ã{arrow}{abs(pct):.2f}%",
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
                arrow = "â²" if pct >= 0 else "â¼"
                results.append({
                    "symbol": symbol,
                    "name": name,
                    "display": f"{name}ï¼{symbol}ï¼ã{val:,.0f}åã{arrow}{abs(pct):.2f}%"
                })
        except Exception:
            pass
    return results

def fetch_news():
    rss = {
        "NHKçµæ¸":      "https://www.nhk.or.jp/rss/news/cat5.xml",
        "NHKæ ªã»ä¼æ¥­":  "https://www.nhk.or.jp/rss/news/cat4.xml",
        "ã­ã¤ã¿ã¼çµæ¸":  "https://feeds.reuters.com/reuters/businessNews",
        "ã­ã¤ã¿ã¼ç±³å½æ ª":"https://feeds.reuters.com/reuters/companyNews",
    }
    all_news = {}
    for label, url in rss.items():
        feed = feedparser.parse(url)
        all_news[label] = "\n".join([f"ã»{e.title}" for e in feed.entries[:7]])
    return all_news

def generate_morning_report():
    market    = fetch_market_data()
    watchlist = fetch_watchlist()
    news      = fetch_news()
    today     = date.today().strftime("%Yå¹´%mæ%dæ¥")
    weekday   = ["æ","ç«","æ°´","æ¨","é","å","æ¥"][date.today().weekday()]

    market_text    = "\n".join([f"ã»{k}ï¼{v['display']}" for k, v in market.items()])
    watchlist_text = "\n".join([s["display"] for s in watchlist])
    news_text      = "\n".join([f"ã{k}ã\n{v}" for k, v in news.items()])

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    prompt = f"""
ããªãã¯ãæ ªã®åå¿èã«æ¯æãä»æ¥ã®æè³å¤æ­ææããå±ãããæ­£ç¢ºã§è¦ªåãªåçã§ãã

ãçµ¶å¯¾ã«å®ãã«ã¼ã«ã
ã»å°éç¨èªã¯å¿ãï¼ï¼ã§èª¬æãã
ã»çç±ãå¿ãæ¸ã
ã»ä¸ç¢ºããªãã¨ã¯æ¸ããªã
ã»##ã**ãªã©ã®è¨å·ã¯çµ¶å¯¾ã«ä½¿ããªã
ã»è¦åºãã¯ããã§å²ã
ã»åºåãç·ã¯ âââââââ ãä½¿ã
ã»çµµæå­ãé©åº¦ã«ä½¿ã
ã»ã¹ããã®ç¸¦ç»é¢ã§èª­ã¿ãããããã1è¡ãç­ãã«ãã
ã»å¸å ´ã®é°å²æ°ð¢è½ã¡çãã¦ããð¡ããä¸å®ð´ãããã¯ã®ã©ããã ãã§è¡¨ç¤ºãã

ä»æ¥ï¼{today}ï¼{weekday}ææ¥ï¼

ãå¸å ´ãã¼ã¿ï¼åæ¥çµå¤ï¼ã
{market_text}

ãã¦ã©ãããªã¹ãéæã
{watchlist_text}

ãä»æ¥ã®ãã¥ã¼ã¹ï¼è¤æ°ã½ã¼ã¹ï¼ã
{news_text}

âï¸ {today}ï¼{weekday}ï¼ã®æã¬ã¿ã¼
âââââââââââââââââ
ä»æ¥ã®ä¸è¨ï¼ï¼ä»æ¥ã®ç¸å ´ãä¸æã§è¡¨ãï¼
âââââââââââââââââ

ââ ð å¸å ´ãã¼ã¿ ââ
ââ ð´ ãã«åã¨éå©ï¼ä»æ¥ã®å½±é¿ ââ
ââ ð° ä»æ¥ã®éè¦ãã¥ã¼ã¹ ââ
ââ ðï¸ ä»æ¥ã®ç¸å ´äºæ³ ââ
ââ ð¯ ä»æ¥ã®åå¼å¤æ­ææ ââ
ããã¤ãã¬ã¼ãã
ãã¹ã¤ã³ã°ãã¬ã¼ãã
ãç©ç«ã»æè³ä¿¡è¨ã
ââ ð ã¦ã©ãããªã¹ã ââ
{watchlist_text}
ââ ð¡ ä»æ¥ã®ä¸èª ââ
âââââââââââââââââ
ä»æ¥ãæ­£ç¢ºã«ãèªåã®ãã¼ã¹ã§ã
âââââââââââââââââ
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
        direction = "æ¥ä¸æð" if pct > 0 else "æ¥è½ð"
        prompt = f"""
æè³åå¿èåãã®ç·æ¥ã¢ã©ã¼ããæ¸ãã¦ãã ããã
ã»{name}ï¼{symbol}ï¼ãæ¬æ¥{abs(pct):.1f}%{direction}
ã»ç¾å¨å¤ï¼{price:,.0f}å
ã»å¸å ´ç¶æ³ï¼{market_ctx}

â¡ãç·æ¥ã{name}ã{direction}
ð ä»ä½ãèµ·ãã¦ããã
ð ãªãåãã¦ããã
ð ãã¤ãã¬ã¼ãã¸ã®å½±é¿
ð ã¹ã¤ã³ã°ãã¬ã¼ãã¸ã®å½±é¿
ð æ³¨æç¹ã»ãªã¹ã¯
âââââââââââââ
æçµå¤æ­ã¯ãèªèº«ã§ãé¡ããã¾ãã
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
            arrow = "â²" if pct >= 0 else "â¼"
            market_ctx = f"æ¥çµ225ï¼{val:,.0f}åï¼{arrow}{abs(pct):.1f}%ï¼"
            if abs(pct) >= 1.5:
                key = f"nikkei_{today_str}_{int(pct)}"
                if key not in state:
                    alert = make_alert("æ¥çµ225", "^N225", val, pct, market_ctx)
                    send_line_message(alert)
                    state[key] = now.isoformat()
    except Exception:
        pass

    try:
        usdjpy = yf.Ticker("JPY=X").history(period="2d")
        if len(usdjpy) >= 2:
            market_ctx += f"ããã«åï¼{usdjpy['Close'].iloc[-1]:.2f}å"
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
                                messages=[TextMessage(text=f"ð æè³ã·ãã¥ã¬ã¼ã¿ã¼ã¯ãã¡ãï¼\n{sim_url}")]
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
            return f.read(), 200, {"Content-Type": "text/html"}
            
@app.route("/")
def index():
    with open("index.html", encoding="utf-8") as f:
        return f.read(), 200, {"Content-Type": "text/html"}

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
