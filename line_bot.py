from supabase import create_client
import os
import anthropic
import json
import yfinance as yf
import feedparser
from flask import Flask, request, abort
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
    "7203.T",  # トヨタ
    "6758.T",  # ソニー
    "9984.T",  # ソフトバンクグループ
    "6861.T",  # キーエンス
    "8306.T",  # 三菱UFJ
]

configuration = Configuration(access_token=LINE_CHANNEL_TOKEN)
handler       = WebhookHandler(LINE_CHANNEL_SECRET)

MORNING_KEYWORDS = [
    "朝レター", "おはよう", "レポート", "今日の分析", "今日",
    "good morning", "morning report", "morning", "today",
    "おはようございます", "朝", "굿모닝", "오늘", "早上好", "今天"
]

REGISTER_KEYWORDS = [
    "登録", "資産登録", "情報登録", "とうろく",
    "register", "sign up", "add info",
    "등록", "注册", "登記"
]

ANALYSIS_KEYWORDS = [
    "分析", "資産分析", "分析して", "ぶんせき",
    "analyze", "analysis", "check my assets",
    "분석", "分析", "查看"
]

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
    }
    return messages.get(key, {}).get(lang, messages.get(key, {}).get("ja", ""))

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
    today = date.today().strftime("%Y年%m月%d日")
    market = fetch_market_data()
    market_text = "\n".join([f"・{k}：{v['display']}" for k, v in market.items()])
    stocks_owned = user_info.get("stocks_owned", "未登録")
    prompt = f"""
あなたは個人資産アドバイザーです。今日は{today}です。
必ず{lang}言語で返答してください。

【ユーザーの資産情報】
・名前：{user_info.get('name', '未登録')}
・保有株：{stocks_owned}
・トレード銘柄：{user_info.get('stocks_traded', '未登録')}
・積立：{user_info.get('savings', '未登録')}
・目標資産：{user_info.get('target_asset', '未登録')}
・出費：{user_info.get('expenses', '未登録')}
・財務情報：{user_info.get('financial_info', '未登録')}

【市場データ】
{market_text}

以下の内容で分析してください：
1. 現在の保有株の評価と今日の動き
2. 目標資産までの道筋と期間
3. 積立シミュレーション
4. 的確なアドバイス
5. 改善できるポイント

・##や**は使わない
・見出しは【】で囲む
・絵文字を適度に使う
・具体的な数字を使う
・スマホで読みやすく
・個人情報は厳重に扱う
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

def generate_morning_report():
    market    = fetch_market_data()
    watchlist = fetch_watchlist()
    news      = fetch_news()
    today     = date.today().strftime("%Y年%m月%d日")
    weekday   = ["月","火","水","木","金","土","日"][date.today().weekday()]

    market_text    = "\n".join([f"・{k}：{v['display']}" for k, v in market.items()])
    watchlist_text = "\n".join([s["display"] for s in watchlist])
    news_text      = "\n".join([f"【{k}】\n{v}" for k, v in news.items()])

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    prompt = f"""
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
"""

    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1000,
        messages=[{"role": "user", "content": prompt}]
    )
    return msg.content[0].text

def answer_question(user_question, user_info=None, lang="ja"):
    market      = fetch_market_data()
    market_text = "\n".join([f"・{k}：{v['display']}" for k, v in market.items()])
    today       = date.today().strftime("%Y年%m月%d日")

    user_context = ""
    if user_info:
        user_context = f"""
【このユーザーの情報】
・名前：{user_info.get('name', '未登録')}
・保有株：{user_info.get('stocks_owned', '未登録')}
・積立：{user_info.get('savings', '未登録')}
・目標資産：{user_info.get('target_asset', '未登録')}
・出費：{user_info.get('expenses', '未登録')}
このユーザーの情報に合わせて答えること。個人情報は漏らさないこと。
"""

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    prompt = f"""
あなたは投資初心者の専属アナリストです。今日は{today}です。
必ず{lang}言語で返答してください。
{user_context}
現在の市場データ：
{market_text}

ユーザーの質問：「{user_question}」

・経済の知識がゼロの人にもわかるように
・専門用語は必ず（）で説明する
・不確かなことは書かない
・##や**などの記号は絶対に使わない
・見出しは【】で囲む
・絵文字を適度に使う
・スマホで読みやすい長さにする
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

@handler.add(MessageEvent, message=TextMessageContent)
def handle_message(event):
    user_text    = event.message.text.strip()
    reply_token  = event.reply_token
    line_user_id = event.source.user_id
    lang         = detect_language(user_text)

    with ApiClient(configuration) as api_client:
        api = MessagingApi(api_client)

        if any(kw in user_text for kw in MORNING_KEYWORDS):
            api.reply_message(ReplyMessageRequest(
                reply_token=reply_token,
                messages=[TextMessage(text=get_message(lang, "waiting_morning"))]
            ))
            report = generate_morning_report()
            send_line_message(report, user_id=line_user_id)

        elif any(kw in user_text for kw in REGISTER_KEYWORDS):
            api.reply_message(ReplyMessageRequest(
                reply_token=reply_token,
                messages=[TextMessage(text=get_message(lang, "register_form"))]
            ))

        elif any(kw in user_text for kw in ANALYSIS_KEYWORDS):
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

        elif "：" in user_text or ":" in user_text:
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
    send_line_message(report)
    return "OK"

@app.route("/alert", methods=["GET"])
def alert():
    if request.args.get("secret", "") != os.environ.get("CRON_SECRET", ""):
        abort(403)
    check_alerts()
    return "OK"

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
