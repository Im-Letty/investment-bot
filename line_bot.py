from supabase import create_client
import os
import anthropic
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

def parse_and_save_user_info(line_user_id, text):
    data = {}
    lines = text.strip().split("\n")
    for line in lines:
        if "名前：" in line or "名前:" in line:
            data["name"] = line.split("：")[-1].split(":")[-1].strip()
        elif "年収：" in line or "年収:" in line:
            data["financial_info"] = line.strip()
        elif "総資産：" in line or "総資産:" in line:
            data["target_asset"] = line.strip()
        elif "毎月投資額：" in line or "毎月投資額:" in line:
            data["savings"] = line.strip()
        elif "目標資産：" in line or "目標資産:" in line:
            data["target_asset"] = line.strip()
        elif "保有株：" in line or "保有株:" in line:
            data["stocks_owned"] = line.split("：")[-1].split(":")[-1].strip()
        elif "トレード銘柄：" in line or "トレード銘柄:" in line:
            data["stocks_traded"] = line.split("：")[-1].split(":")[-1].strip()
        elif "出費：" in line or "出費:" in line:
            data["expenses"] = line.strip()
    if data:
        save_user(line_user_id, data)

def detect_intent(text):
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=50,
        messages=[{"role": "user", "content": f"""
以下のメッセージの意図を判断して、以下の単語だけで答えてください：
- morning（朝レター・今日の相場・おはようなど、どの言語でも）
- register（登録・資産登録・registerなど、どの言語でも）
- analysis（分析・資産分析・analyzeなど、どの言語でも）
- save_info（名前：〇〇、保有株：〇〇など、情報を保存しようとしている）
- other（それ以外）

メッセージ：「{text}」

1単語だけ答えてください。
"""}]
    )
    return msg.content[0].text.strip().lower()

def analyze_portfolio(user_info):
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    today = date.today().strftime("%Y年%m月%d日")
    market = fetch_market_data()
    market_text = "\n".join([f"・{k}：{v['display']}" for k, v in market.items()])
    stocks_owned = user_info.get("stocks_owned", "未登録")
    prompt = f"""
あなたは個人資産アドバイザーです。今日は{today}です。

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
2. 目標資産までの道筋と期間（具体的な数字で）
3. 積立シミュレーション
4. 今の状況への的確なアドバイス
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

【読者について】
・デイトレード・スイングトレード・投資信託・積立をすべて実施している完全な初心者
・経済用語はほぼ知らない。でも毎日少しずつプロを目指して成長したい
・毎朝の時間は限られている。読みやすく、続けたくなる長さにすること
・このレター1通で「今日どう動くか」の材料が全部そろうようにすること
・最終的な売買判断は読者自身が行う

【絶対に守るルール】
・専門用語は必ず（）で説明する　例：「金利（お金を借りるコスト）が上昇」
・理由を必ず書く。「〇〇が動いた」だけで終わらない
・複数のニュースソースを比較・統合してまとめる。重複は省く
・不確かなことは書かない。わからないときは「今日は判断が難しい状況です」と正直に書く
・曖昧な表現（「〜かもしれません」「〜の可能性があります」）は使わない
・確実な事実と、事実から読み取れることだけを書く
・人前で話しても恥ずかしくない正確さを保つ
・長すぎず、でも漏れなく。「もっと読みたい」と思える絶妙な長さにすること
・##や**などの記号は絶対に使わない
・見出しは【】で囲む
・区切り線は ━━━━━━━ を使う
・絵文字を適度に使う
・株価は必ず「円」と「％」と「前日比○円」を両方書く
・スマホの縦画面で読みやすいよう、1行を短めにする
・市場の雰囲気🟢落ち着いている（20以下）🟡やや不安（20〜30）🔴パニック（30以上）のどれかで表示する
・冒頭に株価を一覧で表示する（日経225、ドル円など）
・「情報を持っていません」は書かない
・最後の締めの言葉は明るく楽しい感じにする
・市場の雰囲気は「VIX」という言葉を使わず🟢落ち着いている🟡やや不安🔴パニックのどれかだけで表示する
・金利の数字は「平均より高い/低い/普通」も一緒に書く
・毎日同じドル円の説明をしない。今日特有の理由を書く
・些細なニュースでも必ず拾って簡単に説明する
・デイトレをしている人には今日注目の銘柄とアドバイスを書く
・長期投資については触れない。質問された時だけ答える
・「無視して」という言葉は使わない
・正確な事実だけを書く。推測は推測と明記する

今日：{today}（{weekday}曜日）

【市場データ（前日終値）】
{market_text}

【ウォッチリスト銘柄】
{watchlist_text}

【今日のニュース（複数ソース）】
{news_text}

---
以下の形式で書いてください。

☀️ {today}（{weekday}）の朝レター
─────────────────
今日の一言：（今日の相場を一文で表す）
─────────────────

━━ 📊 市場データ ━━
各指標の数値と、初心者向けの一言コメント。

━━ 💴 ドル円と金利：今日の影響 ━━
・今日のドル円と金利の状況
・円安か円高か
・日本株への影響

━━ 📰 今日の重要ニュース（複数ソース統合） ━━
▶【見出し】
→ どういうこと？
→ 何が上がりやすい・下がりやすいか

━━ 🗓️ 今日の相場予想 ━━
・全体の方向感と根拠

━━ 🎯 今日の取引判断材料 ━━
【デイトレード】
【スイングトレード】
【積立・投資信託】

━━ 🔍 ウォッチリスト ━━
{watchlist_text}

━━ 💡 今日の一語 ━━
【用語】
・意味：
・たとえると：
・投資での使い方：

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

def answer_question(user_question, user_info=None):
    market      = fetch_market_data()
    market_text = "\n".join([f"・{k}：{v['display']}" for k, v in market.items()])
    today       = date.today().strftime("%Y年%m月%d日")

    user_context = ""
    if user_info:
        user_context = f"""
【このユーザーの情報】
・名前：{user_info.get('name', '未登録')}
・投資スタイル：{user_info.get('investment_style', '未登録')}
・保有株：{user_info.get('stocks_owned', '未登録')}
・売買履歴：{user_info.get('stocks_traded', '未登録')}
・積立：{user_info.get('savings', '未登録')}
・目標資産：{user_info.get('target_asset', '未登録')}
・出費：{user_info.get('expenses', '未登録')}
・メモ：{user_info.get('memo', '')}
このユーザーの情報に合わせて、必要な情報だけ答えること。個人情報は他人に漏らさないこと。
"""

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    prompt = f"""
あなたは投資初心者の専属アナリストです。今日は{today}です。
{user_context}
現在の市場データ：
{market_text}

ユーザーの質問：「{user_question}」
・必ずユーザーが送った言語と同じ言語で返答する

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
    import json
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

    with ApiClient(configuration) as api_client:
        api = MessagingApi(api_client)

        intent = detect_intent(user_text)

        if intent == "morning":
            api.reply_message(ReplyMessageRequest(
                reply_token=reply_token,
                messages=[TextMessage(text="朝レターを生成中です。\n少々お待ちください（1〜2分）...")]
            ))
            report = generate_morning_report()
            send_line_message(report, user_id=line_user_id)

        elif intent == "register":
            api.reply_message(ReplyMessageRequest(
                reply_token=reply_token,
                messages=[TextMessage(text="📝 資産情報を登録します！\n\n以下の形式で送ってください：\n\n名前：〇〇\n年収：〇〇万円\n総資産：〇〇万円\n毎月投資額：〇〇万円\n目標資産：〇〇万円\n保有株：銘柄名 株数 取得価格円\nトレード銘柄：銘柄名\n\n例）\n名前：レッティ\n年収：500万円\n総資産：200万円\n毎月投資額：5万円\n目標資産：1000万円\n保有株：トヨタ 100株 2500円\nトレード銘柄：ソニー")]
            ))

        elif intent == "analysis":
            api.reply_message(ReplyMessageRequest(
                reply_token=reply_token,
                messages=[TextMessage(text="📊 資産分析中です。\n少々お待ちください...")]
            ))
            user_info = get_user(line_user_id)
            if not user_info or not user_info.get("stocks_owned"):
                send_line_message("まだ資産情報が登録されていません。\n「登録」と送って情報を登録してください😊", user_id=line_user_id)
            else:
                analysis = analyze_portfolio(user_info)
                send_line_message(analysis, user_id=line_user_id)

        elif intent == "save_info":
            parse_and_save_user_info(line_user_id, user_text)
            api.reply_message(ReplyMessageRequest(
                reply_token=reply_token,
                messages=[TextMessage(text="✅ 保存しました！\n「分析して」と送ると資産分析ができます😊")]
            ))

        else:
            api.reply_message(ReplyMessageRequest(
                reply_token=reply_token,
                messages=[TextMessage(text="確認しています。少々お待ちください...")]
            ))
            user_info = get_user(line_user_id)
            answer = answer_question(user_text, user_info)
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
