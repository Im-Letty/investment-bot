/* Original B: local 2D image motion. No game state, rewards, storage or network APIs. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PetLilacMotion = api;
})(typeof window !== 'undefined' ? window : null, function (environment) {
  'use strict';
  var PI = Math.PI, TAU = PI * 2;
  var groups = [
    ['happy', '喜び', [['joy', '喜ぶ', 3800], ['laugh', '大笑い', 5000], ['excited', 'わくわく', 4800], ['proud', '得意げ', 5000], ['love', 'だいすき', 5600], ['grateful', 'ありがとう', 5200]]],
    ['feeling', '悲しみ・怒り', [['sad', '悲しい', 6000], ['cry', '泣く', 6200], ['lonely', 'さみしい', 5800], ['disappointed', 'がっかり', 5000], ['angry', '怒る', 5200], ['sulky', 'すねる', 5500]]],
    ['wonder', '驚き・考え', [['surprise', 'びっくり', 4200], ['scared', 'こわい', 5200], ['nervous', 'そわそわ', 5600], ['confused', '困る', 5500], ['curious', 'きになる', 5400], ['thinking', '考える', 6200]]],
    ['social', 'ふれあい', [['greeting', 'おかえり', 4200], ['petted', 'なでられる', 4600], ['shy', 'はにかむ', 5400], ['embarrassed', 'あせる', 5000], ['apology', 'ごめんね', 5400], ['cheer', '応援', 5200]]],
    ['calm', 'くつろぎ', [['idle', 'ふだん', 0], ['resting', 'おやすみ', 6500], ['sleepy', 'うとうと', 6200], ['yawn', 'あくび', 5600], ['relaxed', 'のんびり', 6200], ['bored', 'ひま', 6000]]],
    ['action', 'アクション', [['feeding', 'ごはん', 8400], ['moving', '移動', 1600], ['caught', 'キャッチ', 1500], ['dance', 'ダンス', 6500], ['celebrate', 'お祝い', 6000], ['determined', 'やるぞ', 5400]]]
  ];
  var existingDescriptions = {"joy":{"face":"目を細めて明るく笑う","motion":"両手を開いて小さく跳ね耳と尾を弾ませる","keywords":["喜び","うれしい","歓喜","joy"],"effect":"sparkle"},"laugh":{"face":"目を閉じ口を大きく開いて笑う","motion":"肩とおなかを揺らし笑い声に合わせて体を弾ませる","keywords":["笑う","爆笑","大笑い","laugh"],"effect":"sparkle"},"excited":{"face":"楽しみで顔をほころばせる","motion":"手を上げて細かく弾み尾をすばやく振る","keywords":["わくわく","興奮","楽しみ","excited"],"effect":"sparkle"},"proud":{"face":"目を細めて得意そうに笑う","motion":"胸を張りあごを上げ両手を開く","keywords":["誇らしい","得意","自信","proud"],"effect":"sparkle"},"love":{"face":"うれしそうに笑い頬を染める","motion":"胸へ手を集め体をゆっくり寄せる","keywords":["愛情","好き","大好き","love"],"effect":"hearts"},"grateful":{"face":"目をやさしく閉じて笑う","motion":"両手を揃え何度かおじぎをする","keywords":["感謝","ありがとう","お礼","grateful"],"effect":"hearts"},"sad":{"face":"悲しげに目と口元を下げる","motion":"うつむきながら体を沈め耳と尾を下げる","keywords":["悲しみ","かなしい","しょんぼり","sad"],"effect":"tears"},"cry":{"face":"泣き顔になり涙を流す","motion":"胸へ手を寄せしゃくり上げるように肩を震わせる","keywords":["泣く","涙","号泣","cry"],"effect":"tears"},"lonely":{"face":"さびしげに遠くを探す","motion":"体を傾け小さく首を動かし手を胸へ集める","keywords":["寂しい","さみしい","孤独","lonely"],"effect":"quiet"},"disappointed":{"face":"目と口元を落とし下を見る","motion":"体がしゅんと沈み手と耳が垂れる","keywords":["失望","がっかり","落胆","disappointed"],"effect":"quiet"},"angry":{"face":"目と眉をしかめてにらむ","motion":"両手を広げて足踏みし尾を強く動かす","keywords":["怒り","おこる","ぷんぷん","angry"],"effect":"anger"},"sulky":{"face":"半目で横を向いてすねる","motion":"手を胸に寄せ体を斜めに背ける","keywords":["すねる","不満","ふてくされる","sulky"],"effect":"anger"},"surprise":{"face":"目と口を丸く大きく開く","motion":"一度跳ねて両手と耳を立てる","keywords":["驚き","びっくり","驚く","surprise"],"effect":"wonder"},"scared":{"face":"こわがって目と口を開く","motion":"身を縮め手を集めて細かく震える","keywords":["怖い","こわい","恐れ","scared"],"effect":"sweat"},"nervous":{"face":"緊張して視線を左右に動かす","motion":"足を踏み替え耳と手を落ち着かなく動かす","keywords":["緊張","そわそわ","落ち着かない","nervous"],"effect":"sweat"},"confused":{"face":"目を丸くして考え込む","motion":"首を左右にかしげ手を少し開く","keywords":["困る","混乱","わからない","confused"],"effect":"wonder"},"curious":{"face":"気になるものへ目を向ける","motion":"耳を立て首をかしげながら前へ寄る","keywords":["好奇心","きになる","興味","curious"],"effect":"wonder"},"thinking":{"face":"目を細め少し上を見つめる","motion":"胸の前へ手を上げ首をかしげて考える","keywords":["考える","思案","思考","thinking"],"effect":"wonder"},"greeting":{"face":"会えてうれしそうに笑う","motion":"首をかしげ手と尾を振って迎える","keywords":["挨拶","あいさつ","おかえり","greeting"],"effect":"sparkle"},"petted":{"face":"うれしそうに目を閉じる","motion":"首を傾け体を寄せ耳をゆっくり動かす","keywords":["なでる","なでられる","撫でる","petted"],"effect":"hearts"},"shy":{"face":"頬を染めてはにかむ","motion":"胸の前へ手を集め小さく左右に揺れる","keywords":["照れる","恥ずかしい","はにかみ","shy"],"effect":"hearts"},"embarrassed":{"face":"焦って目を丸くし頬を染める","motion":"手をばたつかせ小さく足を踏み替える","keywords":["焦る","あせる","赤面","embarrassed"],"effect":"sweat"},"apology":{"face":"申し訳なさそうに目を伏せる","motion":"手を揃え耳を下げて深くおじぎする","keywords":["謝る","ごめん","謝罪","apology"],"effect":"quiet"},"cheer":{"face":"笑顔で元気よく応援する","motion":"両手を大きく上げ小さく跳ねる","keywords":["応援","がんばれ","声援","cheer"],"effect":"sparkle"},"idle":{"face":"自然にまばたきして見回す","motion":"呼吸しながら時々首と手を動かす","keywords":["通常","待機","ふつう","ふだん","idle"],"effect":"none"},"resting":{"face":"静かに目を閉じる","motion":"体を丸め呼吸をゆっくりにして休む","keywords":["休む","おやすみ","休息","resting"],"effect":"sleep"},"sleepy":{"face":"まぶたが重くなり目を閉じる","motion":"首と体が少しずつ下がってうとうとする","keywords":["眠い","うとうと","眠気","sleepy"],"effect":"sleep"},"yawn":{"face":"目を閉じ口を大きく動かす","motion":"背と手を伸ばしながらあくびをする","keywords":["あくび","欠伸","眠たい","yawn"],"effect":"sleep"},"relaxed":{"face":"目を閉じてくつろぐ","motion":"体をゆったり傾け尾と耳の力を抜く","keywords":["のんびり","リラックス","くつろぐ","relaxed"],"effect":"sleep"},"bored":{"face":"半目で視線を左右へ向ける","motion":"体を沈め手を寄せて片足を小さく動かす","keywords":["ひま","退屈","つまらない","bored"],"effect":"quiet"},"feeding":{"face":"食べものを見てから満面の笑顔になる","motion":"手を寄せてもぐもぐ食べ喜んで跳ねて落ち着く","keywords":["食事","ごはん","食べる","もぐもぐ","feeding"],"effect":"none"},"moving":{"face":"前を見て歩く","motion":"左右の足を交互に動かし体と耳が上下する","keywords":["歩く","移動","歩行","moving"],"effect":"sparkle"},"caught":{"face":"うれしそうに笑う","motion":"手を寄せて受け取り短く跳ねる","keywords":["キャッチ","受け取る","成功","caught"],"effect":"sparkle"},"dance":{"face":"楽しそうに目を細めて笑う","motion":"足を踏み替え両手と体を左右へ大きく振る","keywords":["ダンス","踊る","おどる","dance"],"effect":"sparkle"},"celebrate":{"face":"口を開いて晴れやかに笑う","motion":"両手と耳を大きく広げ繰り返し跳ねる","keywords":["祝う","お祝い","パーティー","celebrate"],"effect":"sparkle"},"determined":{"face":"目を細めてきりっと前を見る","motion":"耳を立て身を沈めてから胸を張る","keywords":["決意","やる気","がんばる","determined"],"effect":"anger"}};
  var addedPerformances = [
  {
    "id": "content",
    "label": "満足する",
    "group": "happy",
    "durationMs": 5400,
    "face": "目をやさしく細める",
    "motion": "おなかへ手を添えてゆっくり息を吐く",
    "keywords": [
      "満足",
      "充実",
      "satisfaction"
    ],
    "effect": "quiet"
  },
  {
    "id": "relieved",
    "label": "ほっとする",
    "group": "happy",
    "durationMs": 5600,
    "face": "目を閉じて口元をゆるめる",
    "motion": "力を抜き耳と肩をすっと下げる",
    "keywords": [
      "安堵",
      "安心",
      "relief"
    ],
    "effect": "quiet"
  },
  {
    "id": "gentlesmile",
    "label": "にっこり",
    "group": "happy",
    "durationMs": 4800,
    "face": "小さくやさしく笑う",
    "motion": "跳ねずに首をかしげて手を開く",
    "keywords": [
      "微笑み",
      "穏やかな笑顔",
      "enjoyment"
    ],
    "effect": "hearts"
  },
  {
    "id": "ecstatic",
    "label": "大はしゃぎ",
    "group": "happy",
    "durationMs": 5800,
    "face": "目を細め大きく笑う",
    "motion": "しゃがむ予備動作から大きく連続で跳ねる",
    "keywords": [
      "歓喜",
      "大喜び",
      "ecstasy"
    ],
    "effect": "sparkle"
  },
  {
    "id": "amused",
    "label": "くすくす笑う",
    "group": "happy",
    "durationMs": 5200,
    "face": "笑いをこらえて目を細める",
    "motion": "胸元に手を寄せ肩を小さく揺らす",
    "keywords": [
      "おかしい",
      "面白い",
      "amusement"
    ],
    "effect": "sparkle"
  },
  {
    "id": "hopeful",
    "label": "希望をふくらませる",
    "group": "happy",
    "durationMs": 6000,
    "face": "目を上げて期待する",
    "motion": "胸を開き少しずつ背を伸ばす",
    "keywords": [
      "希望",
      "期待",
      "hope"
    ],
    "effect": "sparkle"
  },
  {
    "id": "triumphant",
    "label": "勝ち誇る",
    "group": "happy",
    "durationMs": 5600,
    "face": "きりっと笑う",
    "motion": "身を沈めてから両手を高く広げる",
    "keywords": [
      "勝利",
      "達成",
      "triumph"
    ],
    "effect": "sparkle"
  },
  {
    "id": "touched",
    "label": "感動する",
    "group": "happy",
    "durationMs": 6200,
    "face": "うるんだ目で笑う",
    "motion": "胸に手を寄せ静かに震えてうなずく",
    "keywords": [
      "感動",
      "胸がいっぱい",
      "感激"
    ],
    "effect": "hearts"
  },
  {
    "id": "admiring",
    "label": "あこがれる",
    "group": "happy",
    "durationMs": 6000,
    "face": "尊敬のまなざしで見上げる",
    "motion": "手を合わせて前へ身を乗り出す",
    "keywords": [
      "憧れ",
      "称賛",
      "admiration"
    ],
    "effect": "sparkle"
  },
  {
    "id": "beauty",
    "label": "美しさに見とれる",
    "group": "happy",
    "durationMs": 6400,
    "face": "目をやわらかく見開く",
    "motion": "ゆっくり見上げ開いた手を止める",
    "keywords": [
      "きれい",
      "美しい",
      "美的感動",
      "aesthetic appreciation"
    ],
    "effect": "sparkle"
  },
  {
    "id": "bittersweet",
    "label": "泣き笑い",
    "group": "happy",
    "durationMs": 6400,
    "face": "涙から笑顔へ移る",
    "motion": "縮こまった体を少しずつ開く",
    "keywords": [
      "嬉し泣き",
      "うれし泣き",
      "複雑",
      "bittersweet"
    ],
    "effect": "tears"
  },
  {
    "id": "annoyed",
    "label": "いらいらする",
    "group": "feeling",
    "durationMs": 5400,
    "face": "目を細め口を結ぶ",
    "motion": "手を腰へ寄せ片足を小刻みに動かす",
    "keywords": [
      "イライラ",
      "苛立ち",
      "annoyance"
    ],
    "effect": "anger"
  },
  {
    "id": "frustrated",
    "label": "くやしがる",
    "group": "feeling",
    "durationMs": 5800,
    "face": "しかめ顔で下を見る",
    "motion": "小さく足を踏み握った手を下げる",
    "keywords": [
      "悔しい",
      "もどかしい",
      "frustration"
    ],
    "effect": "anger"
  },
  {
    "id": "furious",
    "label": "カンカンに怒る",
    "group": "feeling",
    "durationMs": 5400,
    "face": "強くにらむ",
    "motion": "大きく足踏みし耳としっぽを張る",
    "keywords": [
      "激怒",
      "怒り",
      "憤り",
      "fury"
    ],
    "effect": "anger"
  },
  {
    "id": "disgusted",
    "label": "いやがる",
    "group": "feeling",
    "durationMs": 5200,
    "face": "目と鼻元をしかめる",
    "motion": "顔をそむけ手で押し返す",
    "keywords": [
      "嫌悪",
      "嫌",
      "disgust"
    ],
    "effect": "quiet"
  },
  {
    "id": "repulsed",
    "label": "うえっとする",
    "group": "feeling",
    "durationMs": 4200,
    "face": "口をすぼめて目を閉じる",
    "motion": "大きくのけぞりすぐ顔をそらす",
    "keywords": [
      "強い嫌悪",
      "うえっ",
      "ぞわっ",
      "revulsion"
    ],
    "effect": "quiet"
  },
  {
    "id": "contempt",
    "label": "あきれる",
    "group": "feeling",
    "durationMs": 5600,
    "face": "半目で横を見る",
    "motion": "片側に傾きゆっくり首を振る",
    "keywords": [
      "呆れる",
      "軽蔑",
      "うんざり",
      "contempt"
    ],
    "effect": "quiet"
  },
  {
    "id": "jealous",
    "label": "うらやましがる",
    "group": "feeling",
    "durationMs": 5800,
    "face": "横目でじっと見る",
    "motion": "横目で相手を見て手を自分の胸へ集める",
    "keywords": [
      "羨望",
      "うらやましい",
      "envy"
    ],
    "effect": "quiet"
  },
  {
    "id": "guilty",
    "label": "うしろめたい",
    "group": "feeling",
    "durationMs": 5800,
    "face": "目を伏せてちらっと見る",
    "motion": "背中を丸め手をもじもじさせる",
    "keywords": [
      "罪悪感",
      "後ろめたい",
      "guilt"
    ],
    "effect": "sweat"
  },
  {
    "id": "regretful",
    "label": "後悔する",
    "group": "feeling",
    "durationMs": 6200,
    "face": "悲しい顔で下を見る",
    "motion": "手を胸に寄せ深くうなだれる",
    "keywords": [
      "後悔",
      "しまった",
      "regret"
    ],
    "effect": "quiet"
  },
  {
    "id": "holding_tears",
    "label": "涙をこらえる",
    "group": "feeling",
    "durationMs": 6200,
    "face": "まばたきして口を結ぶ",
    "motion": "こみ上げる動きを抑えて肩を震わせる",
    "keywords": [
      "我慢泣き",
      "悲しみ",
      "涙目"
    ],
    "effect": "tears"
  },
  {
    "id": "awed",
    "label": "圧倒される",
    "group": "wonder",
    "durationMs": 6200,
    "face": "目を大きくして見上げる",
    "motion": "後ろへ重心を移し手をゆっくり開く",
    "keywords": [
      "畏敬",
      "畏怖",
      "圧巻",
      "awe"
    ],
    "effect": "wonder"
  },
  {
    "id": "entranced",
    "label": "夢中で見入る",
    "group": "wonder",
    "durationMs": 6600,
    "face": "視線を一点に止める",
    "motion": "前へ身を乗り出し耳を立てて静止する",
    "keywords": [
      "夢中",
      "没頭",
      "魅了",
      "entrancement"
    ],
    "effect": "none"
  },
  {
    "id": "anxious",
    "label": "心配する",
    "group": "wonder",
    "durationMs": 6200,
    "face": "眉を寄せて見回す",
    "motion": "両手を胸へ寄せ小さく縮こまる",
    "keywords": [
      "不安",
      "心配",
      "anxiety"
    ],
    "effect": "sweat"
  },
  {
    "id": "panic",
    "label": "あわてふためく",
    "group": "wonder",
    "durationMs": 4800,
    "face": "目を大きく開く",
    "motion": "左右へすばやく踏み替え手をばたつかせる",
    "keywords": [
      "パニック",
      "慌てる",
      "panic"
    ],
    "effect": "sweat"
  },
  {
    "id": "horrified",
    "label": "ぞっとする",
    "group": "wonder",
    "durationMs": 5000,
    "face": "口と目を開いて固まる",
    "motion": "耳と尾を下げて後ずさりする",
    "keywords": [
      "恐怖",
      "戦慄",
      "horror"
    ],
    "effect": "sweat"
  },
  {
    "id": "suspicious",
    "label": "うたがう",
    "group": "wonder",
    "durationMs": 6000,
    "face": "目を細めて横を見る",
    "motion": "片側へゆっくり傾き距離を取る",
    "keywords": [
      "疑い",
      "疑念",
      "不信",
      "suspicion"
    ],
    "effect": "wonder"
  },
  {
    "id": "realization",
    "label": "ひらめく",
    "group": "wonder",
    "durationMs": 4200,
    "face": "目をぱっと開いて笑う",
    "motion": "沈んだ姿勢から顔と片手を上げる",
    "keywords": [
      "気づき",
      "なるほど",
      "発見",
      "ひらめき"
    ],
    "effect": "sparkle"
  },
  {
    "id": "anticipating",
    "label": "待ちきれない",
    "group": "wonder",
    "durationMs": 5800,
    "face": "目を輝かせて前を見る",
    "motion": "つま先で小さく弾み手を胸へ集める",
    "keywords": [
      "期待",
      "わくわく待ち",
      "anticipation"
    ],
    "effect": "sparkle"
  },
  {
    "id": "nostalgic",
    "label": "なつかしむ",
    "group": "wonder",
    "durationMs": 6600,
    "face": "遠くを見て微笑む",
    "motion": "ゆっくり体を傾け胸へ手を添える",
    "keywords": [
      "懐かしい",
      "思い出",
      "nostalgia"
    ],
    "effect": "quiet"
  },
  {
    "id": "startled",
    "label": "びくっとする",
    "group": "wonder",
    "durationMs": 2800,
    "face": "一瞬大きく目を見開く",
    "motion": "短く跳ねて素早く身を縮める",
    "keywords": [
      "びっくり反射",
      "驚愕",
      "startle"
    ],
    "effect": "wonder"
  },
  {
    "id": "trusting",
    "label": "しんらいする",
    "group": "social",
    "durationMs": 6200,
    "face": "目をやさしく細める",
    "motion": "前へ寄り手をそっと差し出す",
    "keywords": [
      "信頼",
      "任せる",
      "trust"
    ],
    "effect": "hearts"
  },
  {
    "id": "affectionate",
    "label": "あまえる",
    "group": "social",
    "durationMs": 6000,
    "face": "うれしそうに見上げる",
    "motion": "体をすり寄せ耳をゆるめる",
    "keywords": [
      "甘える",
      "愛情"
    ],
    "effect": "hearts"
  },
  {
    "id": "empathic",
    "label": "いっしょに悲しむ",
    "group": "social",
    "durationMs": 6400,
    "face": "悲しげに相手を見る",
    "motion": "身を低くして相手へ手を差し出す",
    "keywords": [
      "共感",
      "共苦",
      "empathic pain"
    ],
    "effect": "tears"
  },
  {
    "id": "compassionate",
    "label": "いたわる",
    "group": "social",
    "durationMs": 6400,
    "face": "やさしく心配する",
    "motion": "両手で包むように前へ伸ばす",
    "keywords": [
      "思いやり",
      "慈しみ",
      "sympathy",
      "compassion"
    ],
    "effect": "hearts"
  },
  {
    "id": "comforting",
    "label": "なぐさめる",
    "group": "social",
    "durationMs": 6000,
    "face": "おだやかに微笑む",
    "motion": "ゆっくり手を上下させ相手へうなずく",
    "keywords": [
      "慰め",
      "よしよし",
      "comfort"
    ],
    "effect": "hearts"
  },
  {
    "id": "awkward",
    "label": "きまずそうにする",
    "group": "social",
    "durationMs": 5800,
    "face": "視線をそらして口を結ぶ",
    "motion": "手を寄せ左右へそわそわ動く",
    "keywords": [
      "気まずい",
      "居心地",
      "awkwardness"
    ],
    "effect": "sweat"
  },
  {
    "id": "respectful",
    "label": "うやまう",
    "group": "social",
    "durationMs": 5800,
    "face": "まっすぐ見てから目を伏せる",
    "motion": "背筋を伸ばして丁寧に深くおじぎする",
    "keywords": [
      "尊敬",
      "敬意",
      "respect"
    ],
    "effect": "none"
  },
  {
    "id": "forgiving",
    "label": "ゆるす",
    "group": "social",
    "durationMs": 6000,
    "face": "少ししかめた顔から笑顔になる",
    "motion": "閉じた手を広げてゆっくりうなずく",
    "keywords": [
      "許す",
      "仲直り",
      "forgiveness"
    ],
    "effect": "hearts"
  },
  {
    "id": "longing",
    "label": "会いたがる",
    "group": "social",
    "durationMs": 6400,
    "face": "遠くを探してさびしげに見る",
    "motion": "手を伸ばしてから胸へ戻す",
    "keywords": [
      "会いたい",
      "恋しい",
      "longing"
    ],
    "effect": "quiet"
  },
  {
    "id": "heartflutter",
    "label": "ときめく",
    "group": "social",
    "durationMs": 5800,
    "face": "頬を染めて見つめる",
    "motion": "胸を押さえて小さく弾む",
    "keywords": [
      "恋",
      "ときめき",
      "romance"
    ],
    "effect": "hearts"
  },
  {
    "id": "peaceful",
    "label": "やすらぐ",
    "group": "calm",
    "durationMs": 6800,
    "face": "やわらかく目を閉じる",
    "motion": "肩を落としゆっくり一定に呼吸する",
    "keywords": [
      "平穏",
      "穏やか",
      "peace"
    ],
    "effect": "quiet"
  },
  {
    "id": "secure",
    "label": "安心しきる",
    "group": "calm",
    "durationMs": 6600,
    "face": "警戒を解いて笑う",
    "motion": "耳と手をゆるめ少し前にもたれる",
    "keywords": [
      "安全",
      "安心感",
      "security"
    ],
    "effect": "hearts"
  },
  {
    "id": "savoring",
    "label": "味わう",
    "group": "calm",
    "durationMs": 5800,
    "face": "目を閉じて口元をゆるめる",
    "motion": "手を揃えゆっくり小さくうなずく",
    "keywords": [
      "おいしさ",
      "味",
      "満喫",
      "savor"
    ],
    "effect": "none"
  },
  {
    "id": "meditating",
    "label": "じっと集中する",
    "group": "calm",
    "durationMs": 6400,
    "face": "目を閉じて静かに集中する",
    "motion": "手を揃えて背を伸ばし動きを鎮める",
    "keywords": [
      "瞑想",
      "集中",
      "meditation"
    ],
    "effect": "none"
  },
  {
    "id": "deep_sleep",
    "label": "ぐっすり眠る",
    "group": "calm",
    "durationMs": 7000,
    "face": "しっかり目を閉じる",
    "motion": "体を深く丸めゆったり寝息を立てる",
    "keywords": [
      "熟睡",
      "睡眠",
      "すやすや",
      "sleep"
    ],
    "effect": "sleep"
  },
  {
    "id": "stretching",
    "label": "のびをする",
    "group": "calm",
    "durationMs": 5200,
    "face": "目を閉じ口を少し開く",
    "motion": "両手を上げて大きく背を伸ばす",
    "keywords": [
      "伸び",
      "ストレッチ",
      "stretch"
    ],
    "effect": "none"
  },
  {
    "id": "tired",
    "label": "ぐったりする",
    "group": "calm",
    "durationMs": 6200,
    "face": "重たいまぶたで下を見る",
    "motion": "手と耳を下げ体を重く沈める",
    "keywords": [
      "疲れ",
      "疲労",
      "くたくた",
      "tired"
    ],
    "effect": "quiet"
  },
  {
    "id": "bored_fidget",
    "label": "退屈でそわそわ",
    "group": "calm",
    "durationMs": 6000,
    "face": "半目で横を見回す",
    "motion": "片足としっぽを小さく揺らす",
    "keywords": [
      "退屈",
      "落ち着かない",
      "fidget"
    ],
    "effect": "quiet"
  },
  {
    "id": "patient",
    "label": "おとなしく待つ",
    "group": "calm",
    "durationMs": 6400,
    "face": "前を見て静かにまばたきする",
    "motion": "手を揃えて姿勢を保つ",
    "keywords": [
      "辛抱",
      "待機",
      "待つ",
      "patience"
    ],
    "effect": "none"
  },
  {
    "id": "refreshed",
    "label": "すっきり目覚める",
    "group": "calm",
    "durationMs": 5400,
    "face": "閉じた目を開いて笑う",
    "motion": "耳を立てて背伸びし手を開く",
    "keywords": [
      "すっきり",
      "起きる",
      "目覚め",
      "refresh"
    ],
    "effect": "sparkle"
  },
  {
    "id": "hungry",
    "label": "おなかぺこぺこ",
    "group": "action",
    "durationMs": 5800,
    "face": "食べものを探して見回す",
    "motion": "おなかへ手を当てて前かがみになる",
    "keywords": [
      "空腹",
      "食欲",
      "craving",
      "hungry"
    ],
    "effect": "quiet"
  },
  {
    "id": "thirsty",
    "label": "のどがかわく",
    "group": "action",
    "durationMs": 5400,
    "face": "口を少し開いて前を見る",
    "motion": "手を少し上げ口を開けて控えめに揺れる",
    "keywords": [
      "喉",
      "水",
      "渇き",
      "thirst"
    ],
    "effect": "quiet"
  },
  {
    "id": "asking",
    "label": "おねだりする",
    "group": "action",
    "durationMs": 5600,
    "face": "目を丸くして見上げる",
    "motion": "両手を合わせて小さく身を乗り出す",
    "keywords": [
      "お願い",
      "おねだり",
      "欲しい",
      "beg"
    ],
    "effect": "hearts"
  },
  {
    "id": "refusing",
    "label": "いらないよ",
    "group": "action",
    "durationMs": 5000,
    "face": "しかめ顔で横を向く",
    "motion": "手を前へ伸ばして押し返す",
    "keywords": [
      "拒否",
      "遠慮",
      "拒む",
      "refuse"
    ],
    "effect": "none"
  },
  {
    "id": "agreeing",
    "label": "うなずく",
    "group": "action",
    "durationMs": 4200,
    "face": "目を合わせて微笑む",
    "motion": "ゆっくり二度うなずく",
    "keywords": [
      "賛成",
      "同意",
      "納得",
      "yes"
    ],
    "effect": "none"
  },
  {
    "id": "disagreeing",
    "label": "いやいや首振り",
    "group": "action",
    "durationMs": 4400,
    "face": "目を閉じて口を結ぶ",
    "motion": "首を左右に振り手を胸へ戻す",
    "keywords": [
      "反対",
      "否定",
      "いいえ",
      "no"
    ],
    "effect": "none"
  },
  {
    "id": "mischievous",
    "label": "いたずら顔",
    "group": "action",
    "durationMs": 5800,
    "face": "横目でにやっと笑う",
    "motion": "首をかしげてそっと手を伸ばす",
    "keywords": [
      "いたずら",
      "にやり",
      "悪戯",
      "mischief"
    ],
    "effect": "sparkle"
  },
  {
    "id": "playful",
    "label": "遊びにさそう",
    "group": "action",
    "durationMs": 5800,
    "face": "期待した顔で目を丸くする",
    "motion": "身を低くしてから手を伸ばし弾む",
    "keywords": [
      "遊ぼう",
      "遊び心",
      "playful"
    ],
    "effect": "sparkle"
  },
  {
    "id": "sneezing",
    "label": "くしゃみする",
    "group": "action",
    "durationMs": 3600,
    "face": "目を閉じて口を開く",
    "motion": "息を吸ってから短く前へはねる",
    "keywords": [
      "くしゃみ",
      "ハクション",
      "sneeze"
    ],
    "effect": "none"
  },
  {
    "id": "full",
    "label": "おなかいっぱい",
    "group": "action",
    "durationMs": 6200,
    "face": "目を細め満足そうに笑う",
    "motion": "おなかをなでて後ろへゆったりもたれる",
    "keywords": [
      "満腹",
      "食後",
      "satiated"
    ],
    "effect": "quiet"
  },
  {
    "id": "walk_joy",
    "label": "うれしく歩く",
    "group": "action",
    "durationMs": 6200,
    "face": "明るく笑う",
    "motion": "腕を振り軽く弾んで歩く",
    "keywords": [
      "スキップ",
      "喜び歩き",
      "joyful walk"
    ],
    "effect": "sparkle"
  },
  {
    "id": "walk_angry",
    "label": "怒って歩く",
    "group": "action",
    "durationMs": 6200,
    "face": "目を細めてにらむ",
    "motion": "肩を張り速く硬い足取りで歩く",
    "keywords": [
      "怒り歩き",
      "足踏み",
      "angry walk"
    ],
    "effect": "anger"
  },
  {
    "id": "walk_sad",
    "label": "悲しく歩く",
    "group": "action",
    "durationMs": 6600,
    "face": "目を伏せてうつむく",
    "motion": "頭と手を下げ重たく歩く",
    "keywords": [
      "とぼとぼ",
      "悲しみ歩き",
      "sad walk"
    ],
    "effect": "quiet"
  }
];
  var basePerformances = groups.reduce(function (list, group) {
    return list.concat(group[2].map(function (item) {
      var detail = existingDescriptions[item[0]];
      return { id: item[0], label: item[1], group: group[0], groupLabel: group[1], durationMs: item[2],
        face: detail.face, motion: detail.motion, keywords: detail.keywords, effect: detail.effect };
    }));
  }, []);
  var catalogue = Object.freeze(basePerformances.concat(addedPerformances).map(function (entry) {
    var group = groups.filter(function (row) { return row[0] === entry.group; })[0];
    return Object.freeze({ id: entry.id, label: entry.label, group: entry.group, groupLabel: group[1], durationMs: entry.durationMs,
      face: entry.face, motion: entry.motion, keywords: Object.freeze(entry.keywords.slice()), effect: entry.effect });
  }));
  var bodyCatalogue = Object.freeze([
    {id:'body_hands',label:'手と腕',face:'自然に前を見る',motion:'左右の腕を順に持ち上げて大きく手を振る'},
    {id:'body_flap',label:'両手をバタバタ',durationMs:6600,face:'うれしそうに前を見て笑う',motion:'両腕を同時に左右へ大きく広げ上下にバタバタ振ってから落ち着く'},
    {id:'body_feet',label:'足と歩調',face:'前を見て歩調を合わせる',motion:'片足を地面につけたまま反対の足を上げ交互に踏み出す'},
    {id:'body_ears',label:'耳',face:'耳の動きを気にする',motion:'左と右の耳を順に伏せてからぴんと立てる'},
    {id:'body_tail',label:'しっぽ',face:'振り返るように横を見る',motion:'付根をつないだまま尾を大きく左右へ振る'},
    {id:'body_head',label:'顔と首',face:'視線を左右へ移す',motion:'肩と手足を落ち着かせ頭だけを左右へかしげる'},
    {id:'body_joy',label:'全身でよろこぶ',face:'目を細め口を開いて笑う',motion:'手を広げて跳び耳と尾を弾ませ着地して落ち着く'}
  ].map(function(row){row.durationMs=row.durationMs||6000;row.effect='none';return Object.freeze(row);}));
  var directionCatalogue=Object.freeze([
    {id:'direction_left',label:'左を向く',durationMs:6000,face:'左側の本当の横顔を見せる',motion:'左へ向いて少し止まり正面へ戻る'},
    {id:'direction_right',label:'右を向く',durationMs:6000,face:'右側の本当の横顔を見せる',motion:'右へ向いて少し止まり正面へ戻る'},
    {id:'direction_back',label:'後ろを向く',durationMs:6500,face:'目や口のない後ろ姿を見せる',motion:'背中を向けて少し止まり正面へ戻る'},
    {id:'direction_spin',label:'ぐるっと一周',durationMs:6800,face:'横顔と後ろ姿を順に見せる',motion:'同じ向きへ一周回って正面へ戻る'}
  ].map(function(row){row.effect='none';return Object.freeze(row);}));
  // Room routes are presentation-only and do not appear in the public emotion,
  // body demonstration or direction catalogues.
  var roomWalkDurations = Object.freeze({room_walk_left:6000,room_walk_right:6000});
  var durations = Object.freeze(catalogue.concat(bodyCatalogue,directionCatalogue).reduce(function (result, item) { result[item.id] = item.durationMs; return result; }, {room_walk_left:6000,room_walk_right:6000}));
  var outfitCatalogue = Object.freeze([
    { id: 'cloth_cream_vest', label: 'はじめてベスト', price: 0, style: 'vest', color: [.94,.88,.75], trim: [.70,.59,.43] },
    { id: 'cloth_rose_cape', label: 'ももいろケープ', price: 30, style: 'cape', color: [.87,.61,.70], trim: [.63,.37,.47] },
    { id: 'cloth_sky_overalls', label: 'そらいろサロペット', price: 45, style: 'overalls', color: [.58,.75,.84], trim: [.31,.48,.59] },
    { id: 'cloth_mint_knit', label: 'ミントのニット', price: 40, style: 'knit', color: [.63,.78,.69], trim: [.33,.51,.42] },
    { id: 'cloth_star_pajamas', label: '星のおやすみ服', price: 55, style: 'pajamas', color: [.64,.65,.81], trim: [.38,.39,.57] },
    { id: 'cloth_flower_dress', label: 'お花のワンピース', price: 65, style: 'dress', color: [.94,.78,.66], trim: [.66,.46,.35] }
  ].map(function (entry, index) { entry.index = index + 1; Object.freeze(entry.color); Object.freeze(entry.trim); return Object.freeze(entry); }));
  function outfitProfile(id) {
    if (typeof id !== 'string') return null;
    for (var i = 0; i < outfitCatalogue.length; i++) if (outfitCatalogue[i].id === id) return outfitCatalogue[i];
    return null;
  }
  // Shared bounds drive both shader constants and the pure coverage QA helper.
  var clothBounds = Object.freeze({ x: .525, y: .79, rx: .258, ry: .125, top: .688, hem: .891,
    pawLX: .527, pawLY: .743, pawLRX: .153, pawLRY: .100, pawRX: .718, pawRY: .729, pawRRX: .091, pawRRY: .091 });
  function ramp(a, b, value) { return smooth((value-a)/(b-a)); }
  function clothEllipse(x, y, cx, cy, rx, ry) { var dx=(x-cx)/rx, dy=(y-cy)/ry; return 1-ramp(.96,1.02,Math.sqrt(dx*dx+dy*dy)); }
  function clothLine(x, y, ax, ay, bx, by, width) {
    var vx=bx-ax, vy=by-ay, t=clamp(((x-ax)*vx+(y-ay)*vy)/(vx*vx+vy*vy),0,1);
    return 1-ramp(width,width+.003,Math.hypot(x-ax-vx*t,y-ay-vy*t));
  }
  function outfitCoverage(id, inputX, inputY, torsoLayer, backView) {
    var entry=outfitProfile(id), x=finite(inputX,-1), y=finite(inputY,-1), b=clothBounds;
    if (!entry) return 0;
    var mask=clothEllipse(x,y,b.x,b.y,b.rx,b.ry)*ramp(b.top,b.top+.008,y)*(1-ramp(b.hem-.006,b.hem,y));
    var paws=Math.max(clothEllipse(x,y,b.pawLX,b.pawLY,b.pawLRX,b.pawLRY),clothEllipse(x,y,b.pawRX,b.pawRY,b.pawRRX,b.pawRRY));
    if(!torsoLayer)mask*=1-paws;
    if (entry.style === 'vest') {
      var neck=1-ramp(.005,.012,Math.abs(x-.58)-Math.max(0,.755-y)*1.05);
      if(!backView)mask*=1-neck;
    } else if (entry.style === 'cape') {
      var opening=1-ramp(.0,.008,Math.abs(x-.58)-Math.max(0,y-.70)*.52-.018);
      if(!backView)mask*=1-opening; mask*=1-ramp(.866+.006*Math.cos((x-.28)*TAU*9),.874+.006*Math.cos((x-.28)*TAU*9),y);
    } else if (entry.style === 'overalls') {
      var straps=Math.max(clothLine(x,y,.375,.69,.455,.81,.014),clothLine(x,y,.735,.69,.69,.81,.014));
      var bib=ramp(.77,.778,y)*(1-ramp(.145,.155,Math.abs(x-.58)));
      mask*=Math.max(straps,bib);
    } else if (entry.style === 'knit' || entry.style === 'pajamas') {
      var collar=clothEllipse(x,y,.58,.69,.079,.025);
      mask*=1-collar;
    } else if (entry.style === 'dress') {
      var shoulder=Math.max(clothLine(x,y,.38,.69,.44,.78,.017),clothLine(x,y,.738,.69,.69,.78,.017));
      var width=.132+Math.max(0,y-.766)*.65;
      var skirt=ramp(.756,.766,y)*(1-ramp(width,width+.008,Math.abs(x-.56)));
      mask*=Math.max(shoulder,skirt);
    }
    return clamp(mask,0,1);
  }
  function outfitUniform(id, anger) { var entry=outfitProfile(id); return (entry ? entry.index*2 : 0)+clamp(finite(anger,0),0,1); }
  function vecColor(values) { return 'vec3('+values.map(function (v) { return v.toFixed(3); }).join(',')+')'; }
  var evolutionCatalogue = Object.freeze([
    { key: 'balanced', label: 'のんびり', colorName: '薄紫', color: '#b5a0d9', earScale: 1, earDrop: 0, cheekWidth: 1, cheekRound: 1, bodyWidth: 1, bodyHeight: 1, tailScale: 1, tailLift: 0, cadence: 1, movingCadence: 1, bounce: 1 },
    { key: 'fruit', label: 'はなほっぺ', colorName: '桃色', color: '#d99eae', earScale: .96, earDrop: .004, cheekWidth: 1.18, cheekRound: 1.12, bodyWidth: 1.01, bodyHeight: 1, tailScale: 1.05, tailLift: -.003, cadence: 1.01, movingCadence: 1, bounce: 1.02 },
    { key: 'hearty', label: 'ぽかぽか', colorName: 'はちみつ色', color: '#d2ad70', earScale: 1.01, earDrop: 0, cheekWidth: 1.07, cheekRound: 1.06, bodyWidth: 1.12, bodyHeight: 1.04, tailScale: 1.12, tailLift: 0, cadence: .97, movingCadence: .97, bounce: .98 },
    { key: 'sweet', label: 'おやつっこ', colorName: '杏色', color: '#dfa88b', earScale: .88, earDrop: .014, cheekWidth: 1.12, cheekRound: 1.10, bodyWidth: 1.06, bodyHeight: .96, tailScale: .94, tailLift: .009, cadence: .99, movingCadence: .98, bounce: 1.01 },
    { key: 'active', label: 'そよかぜ', colorName: '空色', color: '#92b4d1', earScale: 1.12, earDrop: -.012, cheekWidth: .97, cheekRound: .98, bodyWidth: .97, bodyHeight: 1.04, tailScale: 1.17, tailLift: -.012, cadence: 1.08, movingCadence: 1.08, bounce: 1.08 },
    { key: 'calm', label: 'まどろみ', colorName: 'ミント色', color: '#9dbfb0', earScale: 1.04, earDrop: .020, cheekWidth: 1.07, cheekRound: 1.07, bodyWidth: 1.06, bodyHeight: .96, tailScale: 1.12, tailLift: .005, cadence: .88, movingCadence: .92, bounce: .90 }
  ].map(function (entry,index) { entry.index=index; entry.rgb=Object.freeze([1,3,5].map(function(start){return parseInt(entry.color.slice(start,start+2),16)/255;})); return Object.freeze(entry); }));
  function evolutionProfile(key) {
    if (typeof key === 'string') for (var i=0;i<evolutionCatalogue.length;i++) if(evolutionCatalogue[i].key===key)return evolutionCatalogue[i];
    return evolutionCatalogue[0];
  }
  // A birth origin belongs to the chosen egg for the pet's whole life. Care
  // evolution remains a separate input; neither one rewrites the other.
  var eggOrigins=Object.freeze([
    {key:'lilac',label:'すみれのたまご',colorName:'薄紫',color:'#b5a0d9',earScale:1,earDrop:0,cheekWidth:1,cheekRound:1,bodyWidth:1,bodyHeight:1,tailScale:1,tailLift:0},
    {key:'mint',label:'しずくのたまご',colorName:'ミント',color:'#98c8be',earScale:1.07,earDrop:-.003,cheekWidth:.99,cheekRound:1,bodyWidth:.96,bodyHeight:1.015,tailScale:1.08,tailLift:-.002},
    {key:'apricot',label:'ひだまりのたまご',colorName:'杏色',color:'#e6bb8e',earScale:.94,earDrop:.003,cheekWidth:1.06,cheekRound:1.035,bodyWidth:1.06,bodyHeight:.99,tailScale:.93,tailLift:.002}
  ].map(function(entry,index){entry.index=index;entry.rgb=Object.freeze([1,3,5].map(function(start){return parseInt(entry.color.slice(start,start+2),16)/255;}));return Object.freeze(entry);}));
  function eggOriginProfile(key){if(typeof key==='string')for(var i=0;i<eggOrigins.length;i++)if(eggOrigins[i].key===key)return eggOrigins[i];return eggOrigins[0];}
  var eggVisualProfiles={};
  function eggVisualProfile(path,eggOrigin){
    var origin=eggOriginProfile(eggOrigin),care=evolutionProfile(path);if(!origin.index)return care;
    var key=origin.key+':'+care.key;if(eggVisualProfiles[key])return eggVisualProfiles[key];
    var result={};Object.keys(care).forEach(function(field){result[field]=care[field];});
    [['earScale',.82,1.16],['cheekWidth',.94,1.24],['cheekRound',.95,1.15],['bodyWidth',.94,1.17],['bodyHeight',.95,1.06],['tailScale',.87,1.22]].forEach(function(row){result[row[0]]=clamp(care[row[0]]*origin[row[0]],row[1],row[2]);});
    result.earDrop=clamp(care.earDrop+origin.earDrop,-.015,.026);result.tailLift=clamp(care.tailLift+origin.tailLift,-.018,.018);
    // Birth hue remains dominant; care adds a small, persistent variation.
    result.rgb=Object.freeze(origin.rgb.map(function(value,i){return care.index?value*.78+care.rgb[i]*.22:value;}));
    result.color='#'+result.rgb.map(function(value){return Math.round(value*255).toString(16).padStart(2,'0');}).join('');
    result.index=care.index||1;result.eggOrigin=origin.key;result.colorName=origin.colorName;return eggVisualProfiles[key]=Object.freeze(result);
  }
  function evolutionPoint(path,inputX,inputY,eggOrigin) {
    var profile=eggVisualProfile(path,eggOrigin), x=clamp(finite(inputX,.5),0,1), y=clamp(finite(inputY,.5),0,1);
    if(!profile.index)return {x:x,y:y};
    var leftEar=regionWeight(x,y,.17,.345,.18,.15), rightEar=regionWeight(x,y,.82,.16,.15,.17);
    var dx=(profile.earScale-1)*((x-.29)*leftEar+(x-.76)*rightEar);
    var dy=(profile.earScale-1)*((y-.39)*leftEar+(y-.25)*rightEar)+profile.earDrop*(leftEar+rightEar);
    var leftCheek=regionWeight(x,y,.397,.575,.145,.105), rightCheek=regionWeight(x,y,.795,.482,.13,.105);
    dx+=(x-.59)*(profile.cheekWidth-1)*Math.max(leftCheek,rightCheek);
    dy+=(profile.cheekRound-1)*((y-.575)*leftCheek+(y-.482)*rightCheek);
    var belly=regionWeight(x,y,.53,.80,.26,.18);
    dx+=(x-.55)*(profile.bodyWidth-1)*belly;
    dy+=(y-.92)*(profile.bodyHeight-1)*belly;
    var tail=regionWeight(x,y,.155,.728,.13,.18);
    dx+=(profile.tailScale-1)*(x-.25)*tail;
    dy+=((profile.tailScale-1)*(y-.72)+profile.tailLift)*tail;
    var edge=smooth(x/.06)*smooth((1-x)/.06)*smooth(y/.06)*smooth((1-y)/.06);
    return {x:x+dx*edge,y:y+dy*edge*smooth(Math.abs(y-.92)/.055)};
  }
  // Reference color sampling is also useful for verifying protected face features.
  function furChroma(rgb) {
    // B's hands and crown are pink-lilac: red can exceed blue there. Green
    // separation catches that fur while the warm skin gate retains cream/pink ears.
    return ramp(.012,.045,Math.min(rgb[0],rgb[2])-rgb[1])*(1-ramp(.16,.26,rgb[0]-rgb[2]));
  }
  function evolutionFurColor(path,x,y,source,painted,eggOrigin) {
    var profile=eggVisualProfile(path,eggOrigin), original=source.slice(0,3), color=(painted||source).slice(0,3);
    if(!profile.index)return color;
    var features=Math.max(clothEllipse(x,y,.4665,.429,.16,.145),clothEllipse(x,y,.7281,.3405,.137,.14),clothEllipse(x,y,.625,.48,.105,.095));
    var amount=furChroma(original)*furChroma(color)*(1-features)*.92;
    var lum=color[0]*.299+color[1]*.587+color[2]*.114, paletteLum=profile.rgb[0]*.299+profile.rgb[1]*.587+profile.rgb[2]*.114;
    return color.map(function(value,i){return value+(clamp(profile.rgb[i]*lum/Math.max(.2,paletteLum),0,1)-value)*amount;});
  }
  function eggOriginColor(eggOrigin,cell,x,y,source) {
    var origin=eggOriginProfile(eggOrigin),color=source.slice(0,3);if(!origin.index)return color;
    var features=cell===2?Math.max(clothEllipse(x,y,.238,.661,.061,.063),clothEllipse(x,y,.339,.653,.061,.063),clothEllipse(x,y,.295,.705,.052,.040)):0;
    var amount=furChroma(color)*(1-features)*.92,lum=color[0]*.299+color[1]*.587+color[2]*.114,targetLum=Math.max(.2,origin.rgb[0]*.299+origin.rgb[1]*.587+origin.rgb[2]*.114);
    return color.map(function(value,i){return value+(clamp(origin.rgb[i]*lum/targetLum,0,1)-value)*amount;});
  }
  // Geometry stages use the same original and facial textures. No stage grants EXP.
  var growthProfiles = Object.freeze({
    egg: Object.freeze({ key: 'egg', label: 'うまれたて', overallScale: .70, headWidth: 1.12, headHeight: 1.08, bodyWidth: .86, bodyHeight: .72, earScale: .78, tailScale: .68, cadence: 1.18, movingCadence: 1.16 }),
    baby: Object.freeze({ key: 'baby', label: 'よちよち', overallScale: .82, headWidth: 1.07, headHeight: 1.04, bodyWidth: .96, bodyHeight: .86, earScale: .89, tailScale: .84, cadence: 1.10, movingCadence: 1.08 }),
    child: Object.freeze({ key: 'child', label: 'こども', overallScale: .92, headWidth: 1, headHeight: 1, bodyWidth: 1, bodyHeight: 1, earScale: 1, tailScale: 1, cadence: 1, movingCadence: 1 }),
    final: Object.freeze({ key: 'final', label: 'わかもの', overallScale: .98, headWidth: .98, headHeight: .98, bodyWidth: 1.03, bodyHeight: 1.05, earScale: 1.04, tailScale: 1.06, cadence: .96, movingCadence: .97 }),
    adult: Object.freeze({ key: 'adult', label: 'おとな', overallScale: 1, headWidth: .95, headHeight: .96, bodyWidth: 1.08, bodyHeight: 1.10, earScale: 1.08, tailScale: 1.12, cadence: .90, movingCadence: .94 }),
    companion: Object.freeze({ key: 'companion', label: 'なかよしの姿', overallScale: 1, headWidth: 1.02, headHeight: .99, bodyWidth: 1.11, bodyHeight: 1.08, earScale: 1.03, tailScale: 1.18, cadence: .84, movingCadence: .90 })
  });
  function growthProfile(name) { return Object.prototype.hasOwnProperty.call(growthProfiles, name) ? growthProfiles[name] : growthProfiles.child; }
  // Appearance is read-only presentation. Canonical EXP milestones and their
  // saved evolution history remain owned by the game core.
  var eggSourceRects=Object.freeze([[116,82,536,591],[720,82,1140,591],[99,648,721,1189],[721,678,1142,1189]].map(function(row){return Object.freeze(row.map(function(n){return n/1254;}));}));
  var toothMouthMasks=Object.freeze({
    mature:Object.freeze({x:.628,y:.511,rx:.10,ry:.067,floor:.455}),
    baby:Object.freeze({x:.58051,y:.54,rx:.085,ry:.057,floor:.505}),
    egg:Object.freeze({x:.295,y:.705,rx:.045,ry:.03,floor:.697})
  });
  var referenceAsset='pet_lilac_reference_v2.png';
  var appearanceCatalogue=Object.freeze([
    ['egg','たまご',0,'egg',0,.64],['egg_cracked','ひびのたまご',5,'egg',1,.64],['hatching','もうすぐうまれる',10,'egg',2,.67],
    ['newborn','うまれたて',15,'baby',null,.62,0],['baby','あかちゃん',30,'baby',null,.72,.2],['toddler','よちよち',45,'baby',null,.81,.4],
    ['child','こども',75,'baby',null,.90,.6],['juvenile','わかもの',110,'baby',null,.96,.8],
    ['grown','育った姿',200,'baby',null,1,1],['adult','おとな',400,'baby',null,1.04,1.08],['companion','なかよしの姿',800,'baby',null,1.07,1.16]
  ].map(function(row){return Object.freeze({key:row[0],label:row[1],min:row[2],family:row[3],stillCell:row[4],overallScale:row[5],
    visualAge:row[3]==='baby'?row[6]:null,
    stillRect:row[3]==='egg'?eggSourceRects[row[4]]:null,
    stillBaseAsset:row[3]==='egg'?'pet_lilac_egg_stages_v1.png':referenceAsset,
    stillMouthMask:row[3]==='egg'&&row[4]!==2?null:toothMouthMasks[row[3]],
    stillAsset:row[3]==='egg'?'pet_lilac_tooth_egg_stages_v1.png':referenceAsset});}));
  var legacyAppearance=Object.freeze({key:null,label:'育った姿',min:null,family:'mature',stillCell:null,overallScale:null,stillBaseAsset:'pet_lilac_cutout.webp',stillMouthMask:toothMouthMasks.mature,stillAsset:'pet_lilac_tooth_original_v1.png'});
  function appearanceProfile(key){if(typeof key==='string')for(var i=0;i<appearanceCatalogue.length;i++)if(appearanceCatalogue[i].key===key)return appearanceCatalogue[i];return legacyAppearance;}
  var nurseryLandmarks=Object.freeze({floor:.923445,headPivot:Object.freeze([.55,.645]),mouth:Object.freeze([.58051,.52638]),
    eyes:Object.freeze([.44318,.43534,.68435,.40677]),torso:Object.freeze([.55,.78,.185,.13]),tail:Object.freeze([.285,.756,.085,.11])});
  function appearancePoint(key,inputX,inputY,path,eggOrigin){
    var appearance=appearanceProfile(key),x=finite(inputX,.5),y=finite(inputY,.5);
    if(appearance.family!=='baby')return {x:x,y:y};
    var age=appearance.visualAge,branch=eggVisualProfile(path,eggOrigin);
    var head=1-smooth((y-.60)/.12),width=(.89+.14*age)*(1-head)+(1.035-.055*age)*head;
    var floor=nurseryLandmarks.floor,dx=(x-.55)*(width-1),dy=(y-floor)*(-.15+.18*age)*(1-head);
    var ears=regionWeight(x,y,.17,.35,.15,.16)+regionWeight(x,y,.85,.34,.14,.15),earScale=(.86+.16*age)*branch.earScale;
    dx+=(x-.55)*(earScale-1)*ears*.65;dy+=((y-.40)*(earScale-1)+branch.earDrop)*ears*.65;
    var cheek=regionWeight(x,y,.55,.555,.30,.15),belly=regionWeight(x,y,.55,.79,.20,.14),tail=regionWeight(x,y,.285,.756,.095,.12);
    dx+=(x-.55)*(branch.cheekWidth-1)*cheek*.6+(x-.55)*(branch.bodyWidth-1)*belly*.7+(x-.34)*((.76+.25*age)*branch.tailScale-1)*tail*.65;
    dy+=(y-.55)*(branch.cheekRound-1)*cheek*.6+(y-floor)*(branch.bodyHeight-1)*belly*.7+((y-.756)*(branch.tailScale-1)+branch.tailLift)*tail*.6;
    var edge=smooth(x/.04)*smooth((1-x)/.04)*smooth(y/.04)*smooth((1-y)/.04),ground=smooth(Math.abs(y-floor)/.05);
    return {x:x+dx*edge,y:.92+(y-floor+dy*edge*ground)};
  }
  function nurseryClothingCoverage(outfit,x,y){var b=nurseryLandmarks.torso;return outfitCoverage(outfit,.525+(x-b[0])*.258/b[2],.79+(y-b[1])*.125/b[3],true);}
  // The smile sheet has a different cheek outline from the adopted B. Borrow
  // only its eyes and mouth, retaining B's own brows, fur, chin and silhouette.
  var nurserySmileRegions=Object.freeze([
    [.44318,.43534,.140,.145,.28], [.68435,.40677,.133,.145,.28],
    [.58051,.523,.093,.077,0]
  ].map(function(row){return Object.freeze(row);}));
  function nurserySmileCoverage(x,y){
    if(!Number.isFinite(x)||!Number.isFinite(y))return 0;
    return nurserySmileRegions.reduce(function(mask,r,index){
      var dx=x-r[0],dy=y-r[1],c=Math.cos(r[4]),s=Math.sin(r[4]);
      var weight=1-ramp(.85,1.1,Math.hypot((c*dx+s*dy)/r[2],(-s*dx+c*dy)/r[3]));
      if(index===0)weight*=ramp(.325,.340,y);if(index===1)weight*=ramp(.295,.310,y);
      return Math.max(mask,weight);
    },0);
  }
  // Material changes select one image at the blink's closed midpoint. These
  // thresholds are shared by the pure QA helpers and both born-face shaders.
  var faceMaterialThresholds=Object.freeze({half:.25,closed:.75,handover:.5,donorOpaqueAlphaByte:252});
  var eyePaintRegions=Object.freeze({
    mature:Object.freeze([[.4665,.429,.135,.125],[.7281,.3405,.115,.12]].map(function(row){return Object.freeze(row);})),
    baby:Object.freeze([[.44318,.43534,.120,.124],[.68435,.40677,.111,.119]].map(function(row){return Object.freeze(row);}))
  });
  function eyePaintCoverage(appearanceKey,x,y){
    if(!Number.isFinite(x)||!Number.isFinite(y)||appearanceProfile(appearanceKey).family==='egg')return 0;
    var family=appearanceProfile(appearanceKey).family==='baby'?'baby':'mature',c=Math.cos(.28),s=Math.sin(.28);
    return eyePaintRegions[family].reduce(function(mask,r){var dx=x-r[0],dy=y-r[1];return Math.max(mask,1-ramp(.85,1.1,Math.hypot((c*dx+s*dy)/r[2],(-s*dx+c*dy)/r[3])));},0);
  }
  function faceDonorOpacity(alpha){return ramp(.90,faceMaterialThresholds.donorOpaqueAlphaByte/255,clamp(finite(alpha,0),0,1));}
  function faceMaterialPhase(presence,active,delighted,blink,sleep){
    var amount=clamp(finite(presence,0),0,1),weight=active&&amount>=faceMaterialThresholds.handover?1:0;
    var handover=active||sleep?1-Math.abs(amount*2-1):0;
    var closedBlink=Math.max(clamp(finite(blink,0),0,1),handover)*(delighted&&weight?0:1);
    return {weight:weight,handover:handover,blink:closedBlink,frame:closedBlink>=faceMaterialThresholds.closed?2:closedBlink>=faceMaterialThresholds.half?1:0,
      mouthWeight:sleep?(amount>=faceMaterialThresholds.handover?1:0):weight};
  }
  function nurserySmilePhase(presence,active){
    var phase=faceMaterialPhase(presence,active,true,0,false);
    return {weight:phase.weight,blink:phase.blink};
  }
  function eyePaintShader(family){return 'float eyePaintMask=max('+eyePaintRegions[family].map(function(r){return 'eyeMask(uv,vec2('+r.slice(0,2).join(',')+'),vec2('+r.slice(2).join(',')+'))';}).join(',')+')*headPart;';}
  var faceMaterialShader=[
    'float faceWeight(float presence){return step('+faceMaterialThresholds.handover+',presence);}',
    'float faceHandover(float presence){return 1.-abs(presence*2.-1.);}',
    'float blinkFrame(float amount){return amount>='+faceMaterialThresholds.closed+'?2.:amount>='+faceMaterialThresholds.half+'?1.:0.;}',
    'float faceDonorOpacity(float alpha){return smoothstep(.90,'+faceMaterialThresholds.donorOpaqueAlphaByte+'./255.,alpha);}'
  ].join('\n');
  function regionWeight(x, y, cx, cy, rx, ry) { var dx = (x - cx) / rx, dy = (y - cy) / ry; return Math.exp(-2 * (dx * dx + dy * dy)); }
  // Forward normalized coordinates. Boundary taper fixes all four frame edges, and
  // the foot line remains grounded. The exact same map positions the food prop.
  function growthPoint(stage, inputX, inputY, evolutionPath, eggOrigin) {
    var profile = growthProfile(stage), branchPoint=evolutionPoint(evolutionPath,inputX,inputY,eggOrigin), x=branchPoint.x, y=branchPoint.y;
    if (profile.key === 'child') return { x: x, y: y };
    var head = 1 - smooth((y - .58) / .20);
    var width = profile.bodyWidth + (profile.headWidth - profile.bodyWidth) * head;
    var dx = (x - .59) * (width - 1) * Math.sin(PI * x);
    var dy = (y - .92) * (profile.bodyHeight - 1) + (y - .66) * (profile.headHeight - profile.bodyHeight) * head;
    var leftEar = regionWeight(x, y, .17, .345, .18, .15), rightEar = regionWeight(x, y, .82, .16, .15, .17);
    dx += (profile.earScale - 1) * ((x - .29) * leftEar + (x - .76) * rightEar);
    dy += (profile.earScale - 1) * ((y - .39) * leftEar + (y - .25) * rightEar);
    var tail = regionWeight(x, y, .155, .728, .13, .18);
    dx += (profile.tailScale - 1) * (x - .25) * tail;
    dy += (profile.tailScale - 1) * (y - .72) * tail;
    var edge = smooth(x / .06) * smooth((1 - x) / .06) * smooth(y / .06) * smooth((1 - y) / .06);
    // Regional ear/tail displacement also settles at the feet instead of lifting them.
    var grounded = smooth(Math.abs(y - .92) / .055);
    return { x: x + dx * edge, y: y + dy * edge * grounded };
  }
  function feedingAnchor(stage, evolutionPath, appearanceKey, eggOrigin) {
    var appearance=appearanceProfile(appearanceKey);
    if(appearance.family==='egg')return {x:.5,y:.5,foodLeft:.39,foodTop:.505,foodVisible:false};
    // Use the same neck attachment and fixed camera as the drawn mouth. The
    // former cue-wide .88 inset no longer exists in the independent rig.
    var mouth=rigPose(0,'idle',0,stage,evolutionPath,1,appearanceKey,eggOrigin).mouth,x=mouth.x,y=mouth.y;
    return { x: x, y: y, foodLeft: x - .11, foodTop: y + .005 };
  }
  var mounted = typeof WeakMap === 'function' ? new WeakMap() : null;
  // WebGL 1 guarantees eight fragment texture units. Every expression keeps original cutout alpha.
  var assets = ['pet_lilac_original.webp', 'pet_lilac_half.webp', 'pet_lilac_closed.webp', 'pet_lilac_cutout.webp',
    'pet_lilac_sad.webp', 'pet_lilac_angry.webp', 'pet_lilac_surprise.webp', 'pet_lilac_delighted.webp', 'pet_lilac_torso_cleanplate_v1.png', 'pet_lilac_turnaround_v1.png',
    'pet_lilac_tooth_original_v1.png','pet_lilac_tooth_surprise_v1.png','pet_lilac_tooth_delighted_v1.png','pet_lilac_tooth_turnaround_v1.png','pet_lilac_tooth_sleep_v1.png'];
  var babyAssets=Object.freeze([referenceAsset,'pet_lilac_baby_expressions_v1.png','pet_lilac_baby_turnaround_v1.png',
    referenceAsset,'pet_lilac_tooth_baby_expressions_v1.png','pet_lilac_tooth_baby_turnaround_v1.png',
    'pet_lilac_reference_half_v1.png','pet_lilac_reference_closed_v1.png']);
  var eggAssets=Object.freeze(['pet_lilac_egg_stages_v1.png','pet_lilac_tooth_egg_stages_v1.png']);
  function appearanceAssets(key){var family=appearanceProfile(key).family;return family==='baby'?babyAssets:family==='egg'?eggAssets:Object.freeze(assets.slice());}
  function toothFaceBinding(p,situation,appearanceKey){
    var family=appearanceProfile(appearanceKey).family,winner=0,strongest=0;
    ['faceSad','faceAngry','faceSurprise','faceDelighted'].forEach(function(key,index){if(finite(p&&p[key],0)>strongest){strongest=p[key];winner=index+1;}});
    var closed=['resting','sleepy','deep_sleep'].indexOf(situation)>=0;
    return {winner:winner,closed:closed,oldFaceAsset:family==='baby'?(winner?1:0):(winner?winner+3:0),
      defaultMouthAsset:family==='baby'?3:10,
      expressionMouthAsset:closed?(family==='baby'?1:14):family==='baby'?(winner>=3?4:1):(winner===3?11:winner===4?12:winner?winner+3:0)};
  }
  // Mouth material never replaces the original face, silhouette or body. These
  // compact masks also describe the safe local-patch fallback to the UI.
  function toothMouthRegion(appearanceKey){
    var m=appearanceProfile(appearanceKey).stillMouthMask;
    return m?{center:[m.x,m.y],radii:[m.rx,m.ry],floor:m.floor}:null;
  }
  function toothMouthCoverage(appearanceKey,x,y){var m=toothMouthRegion(appearanceKey);return m&&Number.isFinite(x)&&Number.isFinite(y)?clothEllipse(x,y,m.center[0],m.center[1],m.radii[0],m.radii[1])*ramp(m.floor,m.floor+.008,y):0;}
  var packedUniforms = {
    motionA: ['breath', 'tilt', 'ear', 'tail'], motionB: ['wave', 'wiggle', 'blink', 'chew'],
    motionC: ['bounce', 'step', 'scale', 'presence'], body: ['bodyAngle', 'shiftX', 'shiftY', 'squash'],
    gesture: ['stretch', 'crouch', 'pawSpread', 'mouthOpen'], face: ['faceSad', 'faceAngry', 'faceSurprise', 'faceDelighted'],
    effect: ['tear', 'blush', 'sweat', 'anger'], detail: ['eyeNarrow', 'lookX', 'lookY', 'effectPhase']
  };
  function finite(n, fallback) { return typeof n === 'number' && Number.isFinite(n) ? n : fallback; }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function smooth(n) { n = clamp(n, 0, 1); return n * n * (3 - 2 * n); }
  function known(name) { return Object.prototype.hasOwnProperty.call(durations, name) ? name : 'idle'; }
  function pulse(t, at, width) {
    var x = (t - at) / width;
    if (x < 0 || x > 1) return 0;
    return x < .35 ? smooth(x / .35) : x < .5 ? 1 : 1 - smooth((x - .5) / .5);
  }
  function envelope(t, duration) {
    return smooth(t / Math.min(.45, duration * .22)) * smooth((duration - t) / Math.min(.8, duration * .28));
  }
  function armFlapPhase(age) {
    var open=smooth((age-.2)/.7)*(1-smooth((age-5.7)/.5));
    var drive=smooth((age-.9)/.4)*(1-smooth((age-5.2)/.55));
    return {open:open,drive:drive,flap:.64*Math.sin((age-.9)*TAU*1.85)*drive};
  }
  // The mature source has a broad chest-facing palm. Its straight crop becomes
  // exposed when turned outward, so this cue rounds only that palm's coverage.
  // Sampling and source RGB stay unchanged; the shoulder end remains opaque.
  function armFlapCoverage(x,y) {
    var ax=.39,ay=.721,dx=.158,dy=.029;
    var t=clamp(((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy),0,1),radius=.04+.027*smooth(t);
    var distance=Math.hypot(x-ax-dx*t,y-ay-dy*t)/radius;
    return 1-smooth((distance-.86)/.17);
  }
  // Public cue timeline uses absolute elapsed milliseconds, including when a view resumes.
  // The caller can schedule one boundary timer; this helper never starts a timer or changes a pet.
  function feedingPhase(elapsedMs) {
    var age = Math.max(0, finite(elapsedMs, 0)), phase, label, start, end;
    if (age < 1200) { phase = 'anticipation'; label = 'ごはん、うれしいな'; start = 0; end = 1200; }
    else if (age < 4400) { phase = 'chewing'; label = 'もぐもぐ…'; start = 1200; end = 4400; }
    else if (age < 7200) { phase = 'joy'; label = 'おいしい！'; start = 4400; end = 7200; }
    else if (age < durations.feeding) { phase = 'settling'; label = 'ごちそうさま'; start = 7200; end = durations.feeding; }
    else { phase = 'idle'; label = 'ふだん'; start = durations.feeding; end = null; }
    return { phase: phase, label: label, foodVisible: phase === 'anticipation' || phase === 'chewing',
      foodProgress: clamp((age - 1200) / 3200, 0, 1), phaseProgress: end === null ? 1 : clamp((age - start) / (end - start), 0, 1),
      nextBoundaryMs: end, done: end === null };
  }
  // Keep the displayed angle continuous across a new direction request. Angle
  // differences live on a circle; 350 -> 10 is +20, never a -340 degree turn.
  function shortestYawDelta(from,to) {
    var a=finite(from,0),b=finite(to,0),raw=b%360-a%360,delta=((raw+180)%360+360)%360-180;
    return delta===-180&&b>a?180:delta;
  }
  function roomWalkFrame(name,elapsedMs,reducedMotion,initialYaw) {
    var valid=Object.prototype.hasOwnProperty.call(roomWalkDurations,name),age=Math.max(0,finite(elapsedMs,0)),direction=name==='room_walk_left'?-1:1;
    var done=!valid||age>=6000,x=0,yaw=0,progress=0,speed=0,footPhase=0,travel=0,phase='idle';
    if(!done&&!reducedMotion){
      var from=shortestYawDelta(0,initialYaw),outYaw=from+shortestYawDelta(from,direction*90),backYaw=outYaw-direction*180;
      if(age<650){phase='turning_out';yaw=from+(outYaw-from)*smooth(age/650);}
      else if(age<2400){phase='walking_out';progress=(age-650)/1750;var out=smooth(progress);x=direction*out;yaw=outYaw;speed=4*progress*(1-progress);footPhase=TAU*3.5*out;travel=direction;}
      else if(age<3150){phase='turning_back';x=direction;yaw=outYaw-direction*180*smooth((age-2400)/750);footPhase=TAU*3.5;}
      else if(age<4900){phase='walking_back';progress=(age-3150)/1750;var back=smooth(progress);x=direction*(1-back);yaw=backYaw;speed=4*progress*(1-progress);footPhase=TAU*(3.5+3.5*back);travel=-direction;}
      else{phase='settling';yaw=backYaw+shortestYawDelta(backYaw,0)*smooth((age-4900)/1100);footPhase=TAU*7;}
    }
    return {id:valid?name:null,durationMs:valid?6000:0,done:done,x:x,walking:speed>0,speed:speed,phase:phase,yawDeg:yaw,footPhase:footPhase,travel:travel};
  }
  function directionFrame(name,elapsedMs,reducedMotion,initialYaw) {
    var room=roomWalkFrame(name,elapsedMs,reducedMotion,initialYaw),row=room.id?{id:room.id,durationMs:6000}:directionCatalogue.filter(function(item){return item.id===name;})[0],age=Math.max(0,finite(elapsedMs,0));
    var done=!row||age>=row.durationMs,yaw=0;
    if(room.id)yaw=room.yawDeg;
    else if(!done){
      var target=name==='direction_left'?-90:name==='direction_right'?90:name==='direction_back'?180:360;
      if(reducedMotion)yaw=name==='direction_spin'?0:target;
      else {
        var from=shortestYawDelta(0,initialYaw);
        if(name==='direction_spin')yaw=from+(360-from)*smooth((age-650)/5500);
        else {
          var enterEnd=name==='direction_back'?2200:1900,holdEnd=name==='direction_back'?4200:3900,returnEnd=name==='direction_back'?5800:5350;
          var goal=from+shortestYawDelta(from,target);
          yaw=age>holdEnd?goal+shortestYawDelta(goal,0)*smooth((age-holdEnd)/(returnEnd-holdEnd)):from+(goal-from)*smooth((age-650)/(enterEnd-650));
        }
      }
    }
    var normalized=((yaw%360)+360)%360,index=normalized/22.5,current=Math.floor(index)%16,fraction=index-Math.floor(index);
    var result={id:row?row.id:null,yawDeg:yaw,currentIndex:current,nextIndex:(current+1)%16,
      blend:reducedMotion?0:smooth((fraction-.46)/.08),front:normalized<.000001||normalized>359.999999,done:done};
    if(room.id)result.roomWalk=room;return result;
  }
  // Adjacent drawings have different eye, mouth and silhouette positions.
  // Crossfading whole drawings makes a translucent second pet, even with
  // premultiplied additive blending. Drawing and touch picking must own the
  // same single, fully opaque view throughout every turn.
  function directionSourceIndex(frame) { return frame.blend < .5 ? frame.currentIndex : frame.nextIndex; }
  // Village travel owns a persistent facing, separate from timed room cues.
  // These are the saved directional drawings, not a claim of volumetric 360.
  function locomotionFrame(value, seconds, reduced) {
    if (!value || !Number.isFinite(value.yawDeg)) return null;
    var yaw = ((value.yawDeg % 360) + 360) % 360, index = Math.floor(yaw / 22.5), fraction = yaw / 22.5 - index;
    var blend = smooth((fraction - .46) / .08), selected = blend < .5 ? index : (index + 1) % 16;
    var walking = !!value.walking, phase = Number.isFinite(value.distance) ? value.distance / .42 * TAU : Math.max(0, finite(seconds, 0)) * TAU * 1.8;
    return { id: 'village_locomotion', yawDeg: yaw, currentIndex: index, nextIndex: (index + 1) % 16,
      blend: blend, front: selected === 0, done: false,
      roomWalk: { x: 0, walking: walking, speed: walking ? 1 : 0, phase: walking ? 'walking' : 'idle',
        yawDeg: yaw, footPhase: reduced ? 0 : phase, travel: walking ? 1 : 0 } };
  }
  // Materials and landmarks belong to each real view, never to a flattened
  // frontal face. View zero deliberately uses the unchanged original B image.
  var directionViews=Object.freeze([[0.55,0.92,0.03,0.6,0.675,[0.525,0.79,0.258,0.125],[0.4665,0.429,0.7281,0.3405],[0.16,0.145,0.137,0.14],[0.527,0.743,0.718,0.729],[0.155,0.728,0.115,0.19],[0.625,0.48,0.105,0.095],[0.03,0.025,0.945,0.93]],[0.5177411,0.953748,0.0733652,0.57,0.68,[0.54,0.8,0.26,0.135],[0.5128357,0.4497756,0.7367077,0.3978536],[0.13622,0.12,0.107512,0.12],[0.48,0.73,0.71,0.71],[0.22,0.76,0.14,0.17],[0.68,0.51,0.09,0.08],[0.0685805,0.0733652,0.9106858,0.9569378]],[0.5363906,0.953748,0.0701754,0.61,0.68,[0.57,0.8,0.26,0.135],[0.6164672,0.4537189,0.8091025,0.4049876],[0.130478,0.121124,0.087416,0.12],[0.57,0.73,0.77,0.7],[0.22,0.75,0.15,0.19],[0.79,0.51,0.09,0.08],[0.0988836,0.0701754,0.9314195,0.9569378]],[0.5623347,0.9569378,0.076555,0.67,0.69,[0.61,0.8,0.25,0.135],[0.7314195,0.4664469,0.8675954,0.4251034],[0.110383,0.121124,0.075,0.12],[0.7,0.73,0.86,0.7],[0.25,0.75,0.18,0.18],[0.92,0.52,0.07,0.08],[0.1004785,0.076555,0.9425837,0.9569378]],[0.5470762,0.9489633,0.0558214,0.65,0.69,[0.58,0.8,0.26,0.135],[0.7812299,0.4414894,-2,-2],[0.075933,0.12,0.1,0.13],[0.68,0.75,-2,-2],[0.23,0.72,0.16,0.19],[0.88,0.53,0.08,0.08],[0.0861244,0.0558214,0.8867624,0.9489633]],[0.5251596,0.9457735,0.0366826,0.58,0.69,[0.6,0.8,0.26,0.135],[-2,-2,-2,-2],[0.1,0.13,0.1,0.13],[0.82,0.77,-2,-2],[0.28,0.72,0.18,0.19],[-2,-2,0.08,0.08],[0.122807,0.0366826,0.8979266,0.9457735]],[0.5329364,0.9457735,0.046252,0.57,0.69,[0.58,0.81,0.26,0.135],[-2,-2,-2,-2],[0.1,0.13,0.1,0.13],[0.87,0.78,-2,-2],[0.29,0.72,0.18,0.19],[-2,-2,0.08,0.08],[0.1339713,0.046252,0.9601276,0.9457735]],[0.5351673,0.9425837,0.062201,0.56,0.69,[0.56,0.81,0.27,0.135],[-2,-2,-2,-2],[0.1,0.13,0.1,0.13],[-2,-2,-2,-2],[0.425,0.74,0.15,0.19],[-2,-2,0.08,0.08],[0.1164274,0.062201,0.9457735,0.9457735]],[0.5153392,0.9441786,0.0510367,0.51,0.69,[0.51,0.82,0.27,0.135],[-2,-2,-2,-2],[0.1,0.13,0.1,0.13],[-2,-2,-2,-2],[0.55,0.77,0.135,0.2],[-2,-2,0.08,0.08],[0.0637959,0.0510367,0.969697,0.9441786]],[0.5127876,0.9505582,0.0669856,0.46,0.69,[0.46,0.81,0.27,0.135],[-2,-2,-2,-2],[0.1,0.13,0.1,0.13],[0.15,0.77,-2,-2],[0.69,0.77,0.16,0.2],[-2,-2,0.08,0.08],[0.1068581,0.0669856,0.8724083,0.9505582]],[0.499275,0.9505582,0.0574163,0.45,0.69,[0.45,0.81,0.26,0.135],[-2,-2,-2,-2],[0.1,0.13,0.1,0.13],[0.16,0.77,-2,-2],[0.76,0.75,0.18,0.2],[-2,-2,0.08,0.08],[0.1371611,0.0574163,0.9314195,0.9505582]],[0.4968049,0.953748,0.0669856,0.41,0.69,[0.42,0.81,0.26,0.135],[0.1888764,0.4297058,-2,-2],[0.075,0.12,0.1,0.13],[0.19,0.76,-2,-2],[0.78,0.75,0.17,0.2],[0.1,0.54,0.07,0.08],[0.1323764,0.0669856,0.9266348,0.953748]],[0.4638351,0.9362041,0.0398724,0.41,0.69,[0.44,0.81,0.26,0.135],[0.2525561,0.3982873,-2,-2],[0.081675,0.12,0.1,0.13],[0.32,0.76,-2,-2],[0.84,0.72,0.12,0.18],[0.12,0.53,0.08,0.08],[0.1403509,0.0398724,0.9282297,0.9362041]],[0.4761936,0.9393939,0.0334928,0.44,0.69,[0.45,0.81,0.26,0.135],[0.2255743,0.376582,0.4075728,0.4150417],[0.084545,0.123995,0.127608,0.123995],[0.29,0.76,0.48,0.73],[0.82,0.73,0.12,0.17],[0.28,0.54,0.09,0.08],[0.1132376,0.0334928,0.9138756,0.9393939]],[0.4846426,0.9362041,0.0334928,0.5,0.69,[0.5,0.81,0.27,0.135],[0.2512477,0.394183,0.4801505,0.4271089],[0.116124,0.123995,0.139091,0.132608],[0.38,0.76,0.61,0.75],[0.81,0.74,0.1,0.15],[0.47,0.54,0.1,0.08],[0.1052632,0.0334928,0.9441786,0.9393939]],[0.5246005,0.9362041,0.0366826,0.52,0.69,[0.52,0.81,0.27,0.135],[0.4078037,0.4390801,0.6547938,0.3940143],[0.139091,0.123995,0.130478,0.132608],[0.39,0.76,0.66,0.75],[-2,-2,0.1,0.1],[0.49,0.53,0.1,0.08],[0.0398724,0.0366826,0.923445,0.9362041]]].map(function(row,index){
    var result={index:index,centerX:row[0],groundY:row[1],topY:row[2],headX:row[3],neckY:row[4],
      torso:row[5],eyes:row[6],eyeRadii:row[7],paws:row[8],tail:row[9],mouth:row[10],bounds:row[11]};
    ['torso','eyes','eyeRadii','paws','tail','mouth','bounds'].forEach(function(key){Object.freeze(result[key]);});return Object.freeze(result);
  }));
  var nurseryDirectionViews=Object.freeze([[0.5,0.923445,0.060606,0.55,0.645,[0.55,0.78,0.185,0.13],[0.44318,0.43534,0.68435,0.40677],[0.13,0.12,0.12,0.12],[0.376,0.75,0.73,0.75],[0.285,0.756,0.085,0.11],[0.58051,0.52638,0.09,0.085],[0.06459,0.06061,0.96332,0.92743],[0,0,1,1],1],[0.5,0.9866666666666667,0.006666666666666667,0.5680633802816901,0.6739333333333334,[0.5680633802816901,0.8306833333333333,0.25389084507042253,0.151525],[0.5309274776648641,0.4583544303797468,0.7826372552014909,0.4210050614605929],[0.15588908450704222,0.13557499999999992,0.12102992957746482,0.13857500000000006],[0.3472887323943662,0.7888833333333334,0.722605633802817,0.7784333333333333],[0.2479401408450703,0.8202333333333333,0.12142605633802817,0.15675],[0.7446830985915494,0.5276333333333334,0.09934859154929578,0.08360000000000001],[0.007042253521126761,0.006666666666666667,0.9929577464788732,0.9933333333333333],[0.266347687400319,0.008771929824561403,0.49282296650717705,0.24800637958532695],0.9466666666666667],[0.5,0.9900990099009901,0.006600660066006601,0.62201171875,0.6771617161716171,[0.62201171875,0.8323597359735974,0.28166015625,0.15002475247524752],[0.6316046851432882,0.46395273011464044,0.8723112824675323,0.4212528395696713],[0.162392578125,0.14314356435643566,0.10965820312500006,0.13423267326732674],[0.3403515625,0.790973597359736,0.7567187500000001,0.7806270627062706],[0.23013671874999986,0.822013201320132,0.13470703125,0.1551980198019802],[0.7812109375,0.5323102310231024,0.11021484375,0.08277227722772278],[0.0078125,0.006600660066006601,0.9921875,0.9933993399339934],[0.5255183413078149,0.006379585326953748,0.7296650717703349,0.24800637958532695],0.8448844884488449],[0.5,0.9900332225913622,0.006644518272425249,0.6030180180180176,0.6783388704318937,[0.6030180180180176,0.8345681063122923,0.32479729729729734,0.15102159468438536],[0.7680699567492026,0.4576777617584989,0.9234234234234234,0.40339220143381715],[0.15077702702702694,0.14110465116279075,0.10591216216216216,0.12498338870431892],[0.7301126126126127,0.7929069767441861,-2,-2],[0.15112612612612591,0.8241528239202658,0.15533783783783783,0.15622923588039866],[0.9701801801801807,0.5325249169435217,0.1270945945945946,0.08332225913621263],[0.009009009009009009,0.006644518272425249,0.990990990990991,0.9933554817275747],[0.7982456140350878,0.007177033492822967,0.9752791068580542,0.24720893141945774],0.7375415282392026],[0.5,0.9900332225913622,0.006644518272425249,0.5913636363636363,0.6932890365448507,[0.5913636363636363,0.8495182724252489,0.32775000000000004,0.15102159468438536],[0.8415909090909092,0.45138930836605257,-2,-2],[0.11123863636363641,0.1411046511627907,0.1,0.12],[0.7481136363636363,0.8078571428571427,-2,-2],[0.13536363636363644,0.8391029900332224,0.15675,0.15622923588039866],[0.9903636363636363,0.5474750830564785,0.12825,0.08332225913621263],[0.00909090909090909,0.006644518272425249,0.990909090909091,0.9933554817275747],[0.046251993620414676,0.2535885167464115,0.22169059011164274,0.49362041467304624],0.7308970099667774],[0.5,0.9932659932659933,0.006734006734006734,0.5945021645021644,0.6958922558922561,[0.5945021645021644,0.854225589225589,0.31214285714285717,0.15305555555555556],[0.9138075854493763,0.4179104477611941,-2,-2],[0.10178571428571428,0.12666666666666665,0.1,0.12],[0.7709307359307361,0.8120033670033668,-2,-2],[0.21450216450216456,0.8436700336700335,0.14928571428571427,0.15833333333333333],[-2,-2,0.09,0.08],[0.008658008658008658,0.006734006734006734,0.9913419913419913,0.9932659932659933],[0.28548644338118023,0.2551834130781499,0.4696969696969697,0.4920255183413078],0.7777777777777778],[0.5,0.9932659932659933,0.006734006734006734,0.5328838174273857,0.6958922558922561,[0.5328838174273857,0.854225589225589,0.2991908713692946,0.15305555555555556],[-2,-2,-2,-2],[0.1,0.12,0.1,0.12],[0.7410165975103736,0.8120033670033668,-2,-2],[0.22068464730290432,0.8436700336700335,0.14309128630705395,0.15833333333333333],[-2,-2,0.09,0.08],[0.008298755186721992,0.006734006734006734,0.991701244813278,0.9932659932659933],[0.5350877192982456,0.2551834130781499,0.7272727272727273,0.4920255183413078],0.8114478114478114],[0.5,0.9932659932659933,0.006734006734006734,0.5123265306122449,0.6958922558922561,[0.5123265306122449,0.854225589225589,0.29430612244897963,0.15305555555555556],[-2,-2,-2,-2],[0.1,0.12,0.1,0.12],[-2,-2,-2,-2],[0.3971632653061227,0.8436700336700335,0.14075510204081632,0.15833333333333333],[-2,-2,0.09,0.08],[0.00816326530612245,0.006734006734006734,0.9918367346938776,0.9932659932659933],[0.7799043062200957,0.2551834130781499,0.9752791068580542,0.4920255183413078],0.8249158249158249],[0.5,0.9933554817275747,0.006644518272425249,0.4654340836012862,0.7082392026578075,[0.4654340836012862,0.8644684385382058,0.23184887459807074,0.15102159468438536],[-2,-2,-2,-2],[0.1,0.12,0.1,0.12],[-2,-2,-2,-2],[0.47551446945337617,0.8540531561461792,0.11088424437299035,0.15622923588039866],[-2,-2,0.09,0.08],[0.006430868167202572,0.006644518272425249,0.9935691318327974,0.9933554817275747],[0.009569377990430622,0.5,0.25757575757575757,0.7400318979266348],1.0332225913621262],[0.5,0.9931972789115646,0.006802721088435374,0.3877566539923955,0.701292517006803,[0.3877566539923955,0.8612414965986392,0.2741634980988593,0.1546173469387755],[-2,-2,-2,-2],[0.1,0.12,0.1,0.12],[-2,-2,-2,-2],[0.5784790874524715,0.8505782312925168,0.13112167300380229,0.15994897959183674],[-2,-2,0.09,0.08],[0.0076045627376425855,0.006802721088435374,0.9923954372623575,0.9931972789115646],[0.2886762360446571,0.5055821371610846,0.4984051036682616,0.7400318979266348],0.8945578231292517],[0.5,0.9931972789115646,0.006802721088435374,0.32587500000000014,0.701292517006803,[0.32587500000000014,0.8612414965986392,0.3004375,0.1546173469387755],[-2,-2,-2,-2],[0.1,0.12,0.1,0.12],[0.07768749999999992,0.8185884353741495,-2,-2],[0.6785625000000001,0.8505782312925168,0.1436875,0.15994897959183674],[-2,-2,0.09,0.08],[0.008333333333333333,0.006802721088435374,0.9916666666666667,0.9931972789115646],[0.5526315789473685,0.5055821371610846,0.7440191387559809,0.7400318979266348],0.8163265306122449],[0.5,0.9931972789115646,0.006802721088435374,0.34141393442622975,0.701292517006803,[0.34141393442622975,0.8612414965986392,0.29551229508196725,0.1546173469387755],[-2,-2,-2,-2],[0.1,0.12,0.1,0.12],[0.13584016393442616,0.8185884353741495,-2,-2],[0.7782581967213114,0.8505782312925168,0.14133196721311475,0.15994897959183674],[-0.069733606557377,0.5520068027210883,0.11563524590163934,0.0853061224489796],[0.00819672131147541,0.006802721088435374,0.9918032786885246,0.9931972789115646],[0.7910685805422647,0.5055821371610846,0.9856459330143541,0.7400318979266348],0.8299319727891157],[0.5,0.9933333333333333,0.006666666666666667,0.382266355140187,0.7222666666666668,[0.382266355140187,0.8790166666666664,0.3369392523364486,0.151525],[0.20984792062081062,0.4449100257069411,-2,-2],[0.13959112149532715,0.138575,0.1,0.12],[0.147873831775701,0.8372166666666665,-2,-2],[0.895,0.8685666666666665,0.1611448598130841,0.15675],[-0.08651869158878504,0.5759666666666665,0.13184579439252336,0.08360000000000001],[0.009345794392523364,0.006666666666666667,0.9906542056074766,0.9933333333333333],[0.04226475279106858,0.7472089314194578,0.21291866028708134,0.9864433811802232],0.7133333333333334],[0.5,0.99,0.006666666666666667,0.348734693877551,0.7256000000000002,[0.348734693877551,0.8823499999999997,0.29430612244897963,0.151525],[0.3610064691375676,0.4391418563922942,0.1379473528541852,0.41062801932367166],[0.16233673469387752,0.14157499999999998,0.1109081632653061,0.12657500000000002],[0.2719591836734694,0.8405499999999999,0.7070204081632654,0.8301],[0.7965918367346937,0.8718999999999998,0.14075510204081632,0.15675],[0.1567959183673468,0.5792999999999999,0.11516326530612245,0.08360000000000001],[0.00816326530612245,0.006666666666666667,0.9918367346938776,0.9933333333333333],[0.291866028708134,0.7464114832535885,0.48724082934609253,0.9856459330143541],0.8166666666666667],[0.5,0.99,0.006666666666666667,0.37876923076923086,0.7222666666666668,[0.37876923076923086,0.8790166666666664,0.2773269230769231,0.151525],[0.40707156767283376,0.45978375527426124,0.16558704453441306,0.4104729214340197],[0.15989423076923076,0.138575,0.12527884615384619,0.135575],[0.25819230769230767,0.8372166666666665,0.6681538461538462,0.8267666666666665],[0.7646153846153845,0.8685666666666665,0.13263461538461538,0.15675],[0.14967307692307677,0.5759666666666665,0.10851923076923077,0.08360000000000001],[0.007692307692307693,0.006666666666666667,0.9923076923076923,0.9933333333333333],[0.5414673046251993,0.7472089314194578,0.7488038277511961,0.9864433811802232],0.8666666666666667],[0.5,0.9899328859060402,0.006711409395973154,0.47994642857142855,0.7204026845637586,[0.47994642857142855,0.878204697986577,0.25751785714285713,0.1525419463087248],[0.5030778164924511,0.44630326840181156,0.24170400632577785,0.4475160355630398],[0.15168749999999995,0.13648489932885907,0.1291875,0.13346476510067112],[0.33439285714285755,0.8361241610738254,0.7150714285714287,0.8256040268456375],[-2,-2,0.1,0.1],[0.23362499999999986,0.5731208053691274,0.10076785714285715,0.08416107382550336],[0.007142857142857143,0.006711409395973154,0.9928571428571429,0.9932885906040269],[0.7703349282296651,0.7488038277511961,0.9936204146730463,0.9864433811802232],0.9395973154362416]].map(function(row,index){var result={index:index,centerX:row[0],groundY:row[1],topY:row[2],headX:row[3],neckY:row[4],torso:row[5],eyes:row[6],eyeRadii:row[7],paws:row[8],tail:row[9],mouth:row[10],bounds:row[11],sourceRect:row[12],aspect:row[13]};['torso','eyes','eyeRadii','paws','tail','mouth','bounds','sourceRect'].forEach(function(key){Object.freeze(result[key]);});return Object.freeze(result);}));
  var nurseryFaceMaps=Object.freeze([[0,[1.0647591684,-0.1729827803,0.0251023871,0.0330269307,1.1261030946,-0.0342860172],[0.01036682615629984,0.015151515151515152,0.3333333333333333,0.3365231259968102]],[1,[1.047080786,-0.1924878425,0.0298734068,-0.0052243861,0.6040465978,0.2436360001],[0.34290271132376393,0.015151515151515152,0.6634768740031898,0.3365231259968102]],[2,[1.3099708821,-0.1978539475,-0.1305808407,0.0022551161,0.7415470213,0.1699570315],[0.671451355661882,0.012759170653907496,0.9936204146730463,0.3365231259968102]],[3,[1.0847026788,-0.1400857484,-0.005856907,0.0343448755,1.137491903,-0.0419028684],[0.008771929824561403,0.3444976076555024,0.33413078149920256,0.6666666666666666]],[4,[1.0618886863,-0.1913507539,0.0143795583,0.0527992294,1.0246117345,0.0033489294],[0.34210526315789475,0.34609250398724084,0.664274322169059,0.6666666666666666]],[5,[1.0516329358,-0.1078085494,-0.0187971521,0.0216179767,1.1262723402,-0.0371055076],[0.6698564593301436,0.34290271132376393,0.9944178628389154,0.6666666666666666]],[6,[1.3450105391,-0.1483080234,-0.1470273353,-0.0502662886,0.897470783,0.0861091732],[0.008771929824561403,0.6738437001594896,0.3373205741626794,0.9944178628389154]],[7,[1.0674356699,0.0,-0.0378487155,0.0,1.0929162833,-0.039921561],[0.34210526315789475,0.6738437001594896,0.6650717703349283,0.992822966507177]],[8,[1.0704410155,-0.1039007366,-0.0316395183,0.0092802989,1.0884784622,-0.0273580128],[0.6698564593301436,0.6738437001594896,0.9944178628389154,0.9944178628389154]]].map(function(row){return Object.freeze({cell:row[0],matrix:Object.freeze(row[1]),sourceRect:Object.freeze(row[2])});}));
  function nurseryFaceUV(cell,x,y){var row=nurseryFaceMaps[Math.max(0,Math.min(8,Math.round(finite(cell,0))))],m=row.matrix,r=row.sourceRect;var u=(row.cell%3+m[0]*x+m[1]*y+m[2])/3,v=(Math.floor(row.cell/3)+m[3]*x+m[4]*y+m[5])/3;return {x:clamp(u,r[0],r[2]),y:clamp(v,r[1],r[3])};}
  function directionView(index,appearanceKey) { var views=appearanceProfile(appearanceKey).family==='baby'?nurseryDirectionViews:directionViews;return views[((Math.round(finite(index,0))%16)+16)%16]; }
  function directionCellUV(index,x,y,width,height,appearanceKey) {
    var view=directionView(index,appearanceKey),i=view.index,w=Math.max(4,finite(width,1254)),h=Math.max(4,finite(height,w));
    if(view.sourceRect){var r=view.sourceRect;return {x:r[0]+clamp(finite(x,.5),.0001,.9999)*(r[2]-r[0]),y:r[1]+clamp(finite(y,.5),.0001,.9999)*(r[3]-r[1])};}
    return {x:(i%4+clamp(finite(x,.5),2/w,1-2/w))/4,y:(Math.floor(i/4)+clamp(finite(y,.5),2/h,1-2/h))/4};
  }
  function rawDirectionPoint(index,inputX,inputY,stage,path,appearanceKey,eggOrigin) {
    var view=directionView(index,appearanceKey),x=finite(inputX,.5),y=finite(inputY,.5),profile=growthProfile(stage),branch=eggVisualProfile(path,eggOrigin),appearance=appearanceProfile(appearanceKey);
    if(!view.index)return appearance.family==='baby'?appearancePoint(appearance.key,x,y,path,eggOrigin):growthPoint(stage,x,y,path,eggOrigin);
    if(appearance.family==='baby'){var age=appearance.visualAge;profile={headWidth:1.035-.055*age,headHeight:1,bodyWidth:.89+.14*age,bodyHeight:.85+.18*age,earScale:.86+.16*age,tailScale:.76+.25*age};}
    var head=1-smooth((y-view.neckY+.08)/.18),center=view.torso[0]+(view.headX-view.torso[0])*head;
    var width=profile.bodyWidth+(profile.headWidth-profile.bodyWidth)*head;
    var dx=(x-center)*(width-1),dy=(y-view.groundY)*(profile.bodyHeight-1)+(y-view.neckY)*(profile.headHeight-profile.bodyHeight)*head;
    var cheek=regionWeight(x,y,view.headX,view.neckY-.12,.28,.16),belly=regionWeight(x,y,view.torso[0],view.torso[1],view.torso[2],view.torso[3]);
    dx+=(x-view.headX)*(branch.cheekWidth-1)*cheek+(x-view.torso[0])*(branch.bodyWidth-1)*belly;
    dy+=(y-view.neckY+.12)*(branch.cheekRound-1)*cheek+(y-view.groundY)*(branch.bodyHeight-1)*belly;
    var ears=regionWeight(x,y,view.headX-.27,.23,.17,.16)+regionWeight(x,y,view.headX+.27,.20,.17,.16);
    dx+=(x-view.headX)*(profile.earScale*branch.earScale-1)*ears;
    dy+=((y-.32)*(profile.earScale*branch.earScale-1)+branch.earDrop)*ears;
    if(view.tail[0]>=0){var tail=regionWeight(x,y,view.tail[0],view.tail[1],view.tail[2],view.tail[3]);
      dx+=(x-view.torso[0])*(profile.tailScale*branch.tailScale-1)*tail;
      dy+=((y-view.tail[1])*(profile.tailScale*branch.tailScale-1)+branch.tailLift)*tail;}
    // Fix the source sole line before aligning it to the original .92 floor.
    var ground=smooth(Math.abs(y-view.groundY)/.05),normal=.89/(view.groundY-view.topY);
    // Atlas views have different silhouettes. A gentler local shape field keeps
    // tiny ears and narrow side profiles unfolded at every growth/path pairing.
    return {x:.4875+(x+dx*.55-(view.bounds[0]+view.bounds[2])*.5)*normal*(view.aspect||1),y:.92+(y+dy*.55*ground-view.groundY)*normal};
  }
  // Align each measured source silhouette to the same front-pose height once
  // per appearance/path. Camera direction changes width, never character size.
  var directionHeightCache={};
  function directionHeight(index,stage,path,appearanceKey,eggOrigin) {
    var view=directionView(index,appearanceKey),key=[view.index,stage,path,appearanceKey,eggOriginProfile(eggOrigin).key].join(':');
    if(directionHeightCache[key])return directionHeightCache[key];
    var min=Infinity,max=-Infinity;
    for(var row=0;row<=24;row++)for(var col=0;col<=24;col++){
      var b=view.bounds,p=rawDirectionPoint(index,b[0]+(b[2]-b[0])*col/24,b[1]+(b[3]-b[1])*row/24,stage,path,appearanceKey,eggOrigin);
      min=Math.min(min,p.y);max=Math.max(max,p.y);
    }
    return directionHeightCache[key]=max-min;
  }
  function directionPoint(index,inputX,inputY,stage,path,appearanceKey,eggOrigin) {
    var point=rawDirectionPoint(index,inputX,inputY,stage,path,appearanceKey,eggOrigin),view=directionView(index,appearanceKey);
    if(view.index&&appearanceProfile(appearanceKey).family==='baby'){
      var factor=directionHeight(0,stage,path,appearanceKey,eggOrigin)/directionHeight(index,stage,path,appearanceKey,eggOrigin);
      point={x:.4875+(point.x-.4875)*factor,y:.92+(point.y-.92)*factor};
    }
    return point;
  }
  // Opaque toe/sole landmarks measured in each real source rectangle. The
  // partially hidden far foot stays hidden; no extra leg image is invented.
  var nurseryFootLandmarks=Object.freeze([[[0.457367,0.914188,0.92823,0.408293,0.507177],[0.63036,0.91183,0.925837,0.57815,0.681021]],[[0.506947,0.977598,0.993333,0.443662,0.566901],[0.69049,0.972103,0.986667,0.626761,0.753521]],[[0.539872,0.978766,0.993399,0.453125,0.617188],[0.726649,0.97152,0.986799,0.652344,0.800781]],[[0.544225,0.978776,0.993355,0.441441,0.63964],[0.71156,0.96315,0.976744,0.648649,0.779279]],[[0.504648,0.978834,0.993355,0.395455,0.609091],[0.652408,0.966009,0.980066,0.613636,0.695455]],[[0.454758,0.974222,0.986532,0.398268,0.510823],[0.669206,0.980774,0.993266,0.5671,0.770563]],[[0.455095,0.974261,0.986532,0.39834,0.510373],[0.665781,0.980819,0.993266,0.568465,0.763485]],[[0.420031,0.976779,0.989899,0.359184,0.481633],[0.643421,0.980441,0.993266,0.55102,0.734694]],[[0.419541,0.979072,0.993355,0.360129,0.4791],[0.600559,0.979042,0.993355,0.533762,0.665595]],[[0.396449,0.98042,0.993197,0.315589,0.479087],[0.59548,0.976228,0.989796,0.539924,0.657795]],[[0.339986,0.980648,0.993197,0.25,0.425],[0.552691,0.976531,0.989796,0.491667,0.620833]],[[0.342487,0.980584,0.993197,0.254098,0.42623],[0.550149,0.976602,0.989796,0.491803,0.614754]],[[0.30546,0.962544,0.976667,0.252336,0.350467],[0.451798,0.978905,0.993333,0.35514,0.551402]],[[0.273536,0.962873,0.976667,0.208163,0.338776],[0.452099,0.977644,0.993333,0.371429,0.538776]],[[0.272168,0.965893,0.98,0.211538,0.334615],[0.433109,0.978454,0.993333,0.357692,0.515385]],[[0.361427,0.973097,0.986577,0.3,0.425],[0.532556,0.98049,0.993289,0.464286,0.607143]]].map(function(row){
    function foot(v){return Object.freeze({x:v[0],y:v[1],soleY:v[2],minX:v[3],maxX:v[4]});}
    return Object.freeze({left:foot(row[0]),right:foot(row[1])});
  }));
  function roomWalkDeform(index,x,y,point,frame,appearanceKey) {
    if(!frame||!frame.walking||appearanceProfile(appearanceKey).family==='egg')return {x:point.x,y:point.y};
    var view=directionView(index,appearanceKey),speed=clamp(finite(frame.speed,0),0,1),step=Math.sin(finite(frame.footPhase,0)),swing=Math.cos(finite(frame.footPhase,0));
    if(appearanceProfile(appearanceKey).family==='baby'){
      var feet=nurseryFootLandmarks[view.index],middle=(feet.left.x+feet.right.x)/2,gap=feet.right.x-feet.left.x;
      var right=smooth((x-middle+gap*.32)/(gap*.64)),left=1-right;
      var within=smooth((x-feet.left.minX+.07)/.07)*(1-smooth((x-feet.right.maxX)/.07));
      var legL=smooth((y-feet.left.soleY+.22)/.17)*within*left,legR=smooth((y-feet.right.soleY+.22)/.17)*within*right;
      var lower=clamp(legL+legR,0,1),lift=.045*speed*(legL*Math.max(0,step)+legR*Math.max(0,-step));
      var hips=smooth((y-view.neckY)/.18)*(1-smooth((y-view.groundY+.10)/.09));
      return {x:point.x+finite(frame.travel,0)*.014*swing*speed*(legR-legL)+.006*step*speed*hips,
        y:point.y-lift-.008*Math.abs(step)*speed*(1-lower)};
    }

    var lower=smooth((y-(view.groundY-.145))/.10),center=view.torso[0],width=view.torso[2];
    var within=1-smooth((Math.abs(x-center)-width*.95)/(width*.65));
    var right=smooth((x-center+.07)/.14),left=1-right,feet=lower*within;
    var dx=finite(frame.travel,0)*.018*swing*speed*feet*(right-left);
    var lift=.027*speed*feet*(left*Math.max(0,step)+right*Math.max(0,-step));
    // Only the lifted foot leaves the floor. The upper-body bounce fades away
    // before the sole line, while source UVs/alpha stay on the same continuous mesh.
    return {x:point.x+dx,y:point.y-lift-.005*Math.abs(step)*speed*(1-lower)};
  }
  function roomWalkPoint(index,x,y,frame,stage,path,appearanceKey,eggOrigin) {
    return roomWalkDeform(index,x,y,directionPoint(index,x,y,stage,path,appearanceKey,eggOrigin),frame,appearanceKey);
  }
  function roomWalkBounds(bounds,frame) {
    return frame&&frame.id?{minX:bounds.minX-.022,minY:bounds.minY-.007,maxX:bounds.maxX+.022,maxY:bounds.maxY}:bounds;
  }
  function directionMesh(index,stage,path,appearanceKey,eggOrigin) {
    var columns=24,values=new Float32Array(columns*columns*6*5),cursor=0;
    function vertex(x,y){var point=directionPoint(index,x,y,stage,path,appearanceKey,eggOrigin);values[cursor++]=point.x;values[cursor++]=point.y;values[cursor++]=x;values[cursor++]=y;values[cursor++]=1;}
    for(var row=0;row<columns;row++)for(var col=0;col<columns;col++){var x=col/columns,y=row/columns,right=(col+1)/columns,bottom=(row+1)/columns;vertex(x,y);vertex(x,bottom);vertex(right,y);vertex(right,y);vertex(x,bottom);vertex(right,bottom);}
    return values;
  }
  function directionBounds(index,stage,path,appearanceKey,eggOrigin) {
    var source=directionView(index,appearanceKey).bounds,bounds={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
    for(var row=0;row<=24;row++)for(var col=0;col<=24;col++){
      var point=directionPoint(index,source[0]+(source[2]-source[0])*col/24,source[1]+(source[3]-source[1])*row/24,stage,path,appearanceKey,eggOrigin);
      bounds.minX=Math.min(bounds.minX,point.x);bounds.minY=Math.min(bounds.minY,point.y);bounds.maxX=Math.max(bounds.maxX,point.x);bounds.maxY=Math.max(bounds.maxY,point.y);
    }return bounds;
  }
  function fitDirectionMatrix(matrix,bounds) {
    var fit=1;
    [[bounds.minX,bounds.minY],[bounds.minX,bounds.maxY],[bounds.maxX,bounds.minY],[bounds.maxX,bounds.maxY]].forEach(function(value){
      var p=transform(matrix,{x:value[0],y:value[1]});
      if(p.x<.012)fit=Math.min(fit,(.5-.012)/(.5-p.x));if(p.x>.988)fit=Math.min(fit,(.988-.5)/(p.x-.5));
      if(p.y<.018)fit=Math.min(fit,(.92-.018)/(.92-p.y));if(p.y>.96)fit=Math.min(fit,(.96-.92)/(p.y-.92));
    });
    return {matrix:fit<1?multiply(bone({x:.5,y:.92},0,0,0,fit,fit),matrix):matrix.slice(),fitScale:fit,bounds:bounds};
  }
  // A single camera fit includes every view and the room gait allowance.
  // Apply it to the frontal rig too, so changing source cannot refit the pet.
  var nurseryPresentationBounds={};
  function nurseryPresentationScale(stage,path,appearanceKey,amount,eggOrigin) {
    var key=[stage,path,appearanceKey,eggOriginProfile(eggOrigin).key].join(':'),bounds=nurseryPresentationBounds[key];
    if(!bounds){
      bounds={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
      function include(p){bounds.minX=Math.min(bounds.minX,p.x);bounds.minY=Math.min(bounds.minY,p.y);bounds.maxX=Math.max(bounds.maxX,p.x);bounds.maxY=Math.max(bounds.maxY,p.y);}
      for(var index=0;index<16;index++){var b=directionBounds(index,stage,path,appearanceKey,eggOrigin);include({x:b.minX,y:b.minY});include({x:b.maxX,y:b.maxY});}
      nurseryRigParts.forEach(function(part){part.polygon.forEach(function(p){include(appearancePoint(appearanceKey,p[0],p[1],path,eggOrigin));});});
      // One fixed camera also reserves room for outstretched arms and jumps.
      // Starting a hand gesture must never shrink the entire pet toward its feet.
      bounds={minX:bounds.minX-.085,minY:bounds.minY-.080,maxX:bounds.maxX+.085,maxY:bounds.maxY+.012};
      nurseryPresentationBounds[key]=bounds;
    }
    return fitDirectionMatrix(bone({x:.5,y:.92},0,0,0,amount,amount),bounds).fitScale;
  }
  function directionProjection(index,stage,path,matrix,appearanceKey,roomFrame,eggOrigin) {return fitDirectionMatrix(matrix||identity(),roomWalkBounds(directionBounds(index,stage,path,appearanceKey,eggOrigin),roomFrame));}
  function directionClothingCoverage(index,outfit,x,y,appearanceKey) {
    var view=directionView(index,appearanceKey),b=view.torso,shear=Math.sin(view.index*TAU/16)*.12;
    var qx=.525+(x-b[0]+shear*(y-b[1]))*.258/b[2],qy=.79+(y-b[1])*.125/b[3];
    var mask=outfitCoverage(outfit,qx,qy,true,view.index>4&&view.index<12);
    var paws=Math.max(clothEllipse(x,y,view.paws[0],view.paws[1],b[2]*.58,b[3]*.72),clothEllipse(x,y,view.paws[2],view.paws[3],b[2]*.48,b[3]*.68));
    var tail=view.tail[0]>=0?clothEllipse(x,y,view.tail[0],view.tail[1],view.tail[2],view.tail[3]):0;
    return mask*(1-Math.max(paws,tail));
  }
  // Measured crown-fur chroma relative to the selected front image. Preserve
  // each view's luminance/shading and protect cream, eyes, mouth and clothing.
  var nurseryDirectionChroma=Object.freeze([[1,0],[0.82789,-0.05293],[0.76408,-0.08909],[0.6651,-0.14194],[0.70036,-0.13036],[0.72892,-0.12053],[0.68422,-0.14557],[0.6373,-0.15703],[0.65081,-0.16322],[0.66765,-0.15746],[0.66286,-0.15498],[0.65458,-0.15962],[0.70653,-0.13467],[0.73282,-0.11512],[0.78737,-0.07004],[0.85198,-0.041]].map(function(row){return Object.freeze(row);}));
  function directionMaterialColor(index,x,y,source,appearanceKey) {
    var view=directionView(index,appearanceKey),color=source.slice(0,3);
    if(!view.index||appearanceProfile(appearanceKey).family!=='baby')return color;
    var features=Math.max(clothEllipse(x,y,view.eyes[0],view.eyes[1],view.eyeRadii[0],view.eyeRadii[1]),clothEllipse(x,y,view.eyes[2],view.eyes[3],view.eyeRadii[2],view.eyeRadii[3]),clothEllipse(x,y,view.mouth[0],view.mouth[1],view.mouth[2],view.mouth[3]));
    var amount=furChroma(color)*(1-features),c=nurseryDirectionChroma[view.index],lum=color[0]*.299+color[1]*.587+color[2]*.114;
    var red=c[0]*(color[0]-lum)-c[1]*(color[2]-lum),blue=c[1]*(color[0]-lum)+c[0]*(color[2]-lum);
    var target=[lum+red,lum-(.299*red+.114*blue)/.587,lum+blue];
    return color.map(function(value,i){return value+(clamp(target[i],0,1)-value)*amount;});
  }
  function directionFurColor(index,path,x,y,source,appearanceKey,eggOrigin) {
    var view=directionView(index,appearanceKey),profile=eggVisualProfile(path,eggOrigin),color=directionMaterialColor(index,x,y,source,appearanceKey);
    if(!profile.index)return color;
    var eyes=Math.max(clothEllipse(x,y,view.eyes[0],view.eyes[1],view.eyeRadii[0],view.eyeRadii[1]),clothEllipse(x,y,view.eyes[2],view.eyes[3],view.eyeRadii[2],view.eyeRadii[3]));
    var mouth=clothEllipse(x,y,view.mouth[0],view.mouth[1],view.mouth[2],view.mouth[3]),amount=furChroma(color)*(1-Math.max(eyes,mouth))*.92;
    var lum=color[0]*.299+color[1]*.587+color[2]*.114,targetLum=Math.max(.2,profile.rgb[0]*.299+profile.rgb[1]*.587+profile.rgb[2]*.114);
    return color.map(function(value,i){return value+(clamp(profile.rgb[i]*lum/targetLum,0,1)-value)*amount;});
  }
  // These performances use the same cutout and face keyframes, but have their own
  // anticipation, posture, gaze and recovery. A low face score still selects a
  // whole keyframe; differences in its score alone are never an acting choice.
  function additionalPose(p, name, age, duration, profile, branch) {
    var lift = smooth((age - .45) / .75), release = smooth((age - duration + 1.65) / .9);
    var hold = lift * (1 - release), slow = Math.sin(age * TAU * .32);
    var settle = 1 - release, q, r, stride;
    switch (name) {
      case 'content':
        p.eyeNarrow = .65; p.mouthOpen = .35; p.stretch = .38; p.pawSpread = -.5; p.wave = .25;
        p.tilt = .036 * (pulse(age, 1.4, 1.1) + pulse(age, 3.15, 1.15));
        p.breath = .55 * Math.sin(age * TAU / 5); p.ear -= .25; p.tail += .15 * slow; break;
      case 'relieved':
        q = smooth((age - 1.1) / 1.1); p.blink = q;
        p.faceSad = age < 1.1 ? .5 : 0; p.eyeNarrow = .45 * q; p.mouthOpen = .35 * q;
        p.stretch = .45 * (1 - q); p.crouch = .55 * q; p.squash = .35 * pulse(age, 1.05, 2.2);
        p.wave = .7 * (1 - q) - .3 * q; p.pawSpread = -.4 * (1 - q) + .4 * q;
        p.ear -= .85 * q; p.tail -= .5 * q; p.breath = Math.sin(Math.min(1, age / 3.4) * TAU) * .95; break;
      case 'gentlesmile':
        p.eyeNarrow = .48; p.blush = .3; p.mouthOpen = .25; p.tilt = -.055;
        p.pawSpread = .65 * lift; p.wave = .4; p.bodyAngle = -.022 * hold;
        p.ear += .15; p.tail += .3 * slow; p.bounce = 0; break;
      case 'ecstatic':
        q = Math.pow(Math.max(0, Math.sin((age - .8) * TAU * .92)), 2) * lift;
        p.faceDelighted = 1; p.crouch = .95 * (1 - lift); p.bounce = 1.12 * q * settle;
        p.squash = .7 * (1 - q) * hold; p.stretch = .9 * q; p.wave = 1.45 * lift;
        p.pawSpread = 1.2 * lift; p.bodyAngle = .055 * Math.sin(age * TAU * .46);
        p.ear += 1.1 * q; p.tail += 1.3 * Math.sin(age * TAU * 1.84); p.mouthOpen = -.45; break;
      case 'amused':
        p.faceDelighted = 1; p.eyeNarrow = .2; p.mouthOpen = .9;
        q = Math.sin(age * TAU * 3.2) * (.55 + .45 * Math.sin(age * PI * .7));
        p.squash = .22 * q; p.tilt = .035; p.bodyAngle = .016 * q; p.wave = .9;
        p.pawSpread = -.65; p.ear += .25 * q; p.tail *= .35; p.crouch = .24; break;
      case 'hopeful':
        p.lookY = -.014; p.lookX = -.002; p.eyeNarrow = -.08; p.mouthOpen = -.15;
        p.stretch = 1.05 * lift; p.wave = .45 + .45 * lift; p.pawSpread = .75 * lift;
        p.tilt = -.07 * lift; p.bodyAngle = -.015; p.ear += .95 * lift;
        p.tail += .4 * slow; p.crouch = .3 * (1 - lift); break;
      case 'triumphant':
        q = pulse(age, .8, 1.8); p.faceDelighted = 1; p.eyeNarrow = .3; p.mouthOpen = -.25;
        p.crouch = .8 * (1 - lift); p.bounce = 1.05 * q; p.stretch = 1.25 * lift;
        p.wave = 1.55 * lift; p.pawSpread = 1.3 * lift; p.tilt = -.09 * lift;
        p.ear += 1.1; p.tail += .85 * lift; p.bodyAngle = -.025; break;
      case 'touched':
        p.faceSad = age < 1.7 ? 1 : 0; p.faceDelighted = age >= 1.7 ? 1 : 0;
        p.blink = Math.max(p.blink, pulse(age, 1.42, .5)); p.tear = .3; p.blush = .3;
        p.wave = .95; p.pawSpread = -.95; p.crouch = .2;
        p.bodyAngle = .008 * Math.sin(age * TAU * 3.5); p.tilt = .04 * pulse(age, 2.4, 2.1);
        p.ear -= .4; p.tail *= .4; break;
      case 'admiring':
        p.lookY = -.014; p.lookX = -.008; p.stretch = .45; p.bodyAngle = .035;
        p.tilt = -.06; p.wave = .85; p.pawSpread = -.85; p.shiftX = .01 * lift;
        p.ear += 1.05; p.tail += .35; p.eyeNarrow = .12; p.blush = .25; break;
      case 'beauty':
        q = smooth((age - .8) / 2.4); p.lookX = .011 * Math.cos(q * PI); p.lookY = -.013 * q;
        p.faceSurprise = .3; p.mouthOpen = .95; p.wave = .35 + .35 * q; p.pawSpread = .85 * q;
        p.tilt = -.045 * q; p.stretch = .3; p.bodyAngle = -.018; p.ear += .6;
        p.tail *= .25; p.breath *= .5; break;
      case 'bittersweet':
        q = smooth((age - 2.0) / 1.2); p.faceSad = age < 2.6 ? 1 : 0; p.faceDelighted = age >= 2.6 ? 1 : 0;
        p.blink = Math.max(p.blink, pulse(age, 2.35, .55)); p.tear = .85 * (1 - .6 * q);
        p.crouch = .8 * (1 - q); p.stretch = .55 * q; p.wave = .9; p.pawSpread = -.85 + 1.55 * q;
        p.ear -= .9 * (1 - q); p.tail += -.6 + q; p.tilt = .075 * (1 - q) - .025 * q;
        p.bodyAngle = .012 * Math.sin(age * TAU * 2.2) * (1 - q); break;
      case 'annoyed':
        p.faceAngry = 1; p.eyeNarrow = .68; p.mouthOpen = .6; p.anger = .3;
        p.step = .55 * Math.pow(Math.max(0, Math.sin(age * TAU * 1.6)), 3);
        p.tilt = -.035; p.pawSpread = .65; p.wave = -.15; p.ear += .3;
        p.tail += 1.05 * Math.sin(age * TAU * .8); p.bodyAngle = -.018; break;
      case 'frustrated':
        q = pulse(age, .8, 1.0) + pulse(age, 2.25, 1.0) + pulse(age, 3.7, .9);
        p.faceAngry = 1; p.lookY = .014; p.eyeNarrow = .35; p.mouthOpen = .65;
        p.crouch = .45 + .4 * q; p.step = -.8 * q; p.squash = .4 * q;
        p.wave = -.75; p.pawSpread = -.5; p.tilt = .08; p.ear -= .65; p.anger = .6; p.tail -= .4; break;
      case 'furious':
        q = Math.sin(age * TAU * 2.1); p.faceAngry = 1; p.eyeNarrow = .9; p.anger = 1;
        p.step = q; p.squash = .8 * Math.abs(q); p.bodyAngle = .065 * q;
        p.wave = .65; p.pawSpread = 1.2; p.stretch = .35; p.tilt = -.06;
        p.ear += 1.5; p.tail += 1.2; p.mouthOpen = -.3; break;
      case 'disgusted':
        q = smooth((age - .5) / .3); p.faceAngry = 1; p.eyeNarrow = 1.4; p.mouthOpen = 1.2;
        p.tilt = -.085 * q; p.bodyAngle = -.065 * q; p.shiftX = -.022 * q;
        p.stretch = .2; p.wave = 1.0; p.pawSpread = 1.05; p.ear -= .95; p.tail -= .85;
        p.crouch = .3 * pulse(age, .45, 1.1); p.lookX = .014; break;
      case 'repulsed':
        q = pulse(age, .5, 1.0); p.faceSurprise = 1; p.blink = 1; p.eyeNarrow = 1.6; p.mouthOpen = 1.8;
        p.bodyAngle = -.08 * q; p.shiftX = -.025 * q; p.crouch = .75 * q;
        p.tilt = -.082 * (q + .25 * settle); p.squash = .55 * q; p.wave = .95;
        p.pawSpread = 1.15; p.ear -= 1.3; p.tail -= 1.0; break;
      case 'contempt':
        p.eyeNarrow = -1.15; p.mouthOpen = .65; p.lookX = .014; p.lookY = .01;
        p.bodyAngle = -.055; p.stretch = .5; p.shiftX = -.012; p.tilt = -.075 + .018 * slow;
        p.wave = -.3; p.pawSpread = .25; p.ear -= .35; p.tail *= .2; break;
      case 'jealous':
        p.faceSad = 1; p.eyeNarrow = .38; p.lookX = .015; p.lookY = -.003;
        p.wave = .95; p.pawSpread = -.95 * lift; p.shiftX = .013 * lift;
        p.tilt = -.05; p.bodyAngle = .035; p.crouch = .25; p.ear -= .45;
        p.tail += .4 * Math.sin(age * PI * .8); break;
      case 'guilty':
        q = pulse(age, 1.6, .65) + pulse(age, 3.8, .65); p.faceSad = 1;
        p.lookY = .014 - .018 * q; p.lookX = -.01 + .012 * q; p.sweat = .6;
        p.crouch = .65; p.tilt = .065; p.wave = .75; p.pawSpread = -.7;
        p.wiggle = .35 * Math.sin(age * TAU * 1.3); p.ear -= .9; p.tail -= .55; break;
      case 'regretful':
        q = smooth((age - .6) / 1.7); p.faceSad = 1; p.lookY = .018; p.eyeNarrow = .5;
        p.tilt = .105 * q; p.crouch = 1.1 * q; p.stretch = -.4 * q;
        p.wave = .9; p.pawSpread = -.85; p.ear -= 1.4 * q; p.tail -= 1.1 * q;
        p.breath *= .4; p.bodyAngle = .03 * q; break;
      case 'holding_tears':
        q = pulse(age, .8, .4) + pulse(age, 2.2, .4) + pulse(age, 3.6, .4);
        p.faceSad = 1; p.blink = Math.max(p.blink, q); p.mouthOpen = 1.25; p.tear = .2;
        p.bodyAngle = .009 * Math.sin(age * TAU * 4.4); p.squash = .10 * Math.sin(age * TAU * 3.3);
        p.wave = .25; p.pawSpread = -.4; p.crouch = .45; p.ear -= .95; p.tail -= .85; break;
      case 'awed':
        p.faceSurprise = 1; p.mouthOpen = .5; p.lookY = -.016;
        p.stretch = .65; p.bodyAngle = -.04; p.shiftX = -.012; p.wave = .25 + .6 * lift;
        p.pawSpread = .9 * lift; p.tilt = -.07; p.ear += .85; p.tail *= .1; p.breath *= .4; break;
      case 'entranced':
        p.eyeNarrow = -.12; p.lookX = -.01; p.lookY = -.003; p.stretch = .6;
        p.bodyAngle = .045; p.shiftX = .02 * lift; p.tilt = -.035;
        p.wave = .1; p.pawSpread = -.2; p.ear += 1.2; p.tail *= .05; p.breath *= .3; break;
      case 'anxious':
        p.faceSad = 1; p.eyeNarrow = .25; p.lookX = .012 * Math.sin(age * PI * .75); p.lookY = .004;
        p.sweat = .8; p.crouch = .7; p.wave = .95; p.pawSpread = -.9; p.tilt = .035;
        p.ear -= .7; p.tail -= .7; p.breath *= 1.25; p.bodyAngle = .012 * slow; break;
      case 'panic':
        q = Math.sin(age * TAU * 2.7); p.faceSurprise = 1; p.mouthOpen = -.45; p.sweat = 1;
        p.step = q; p.shiftX = .025 * Math.sin(age * TAU * 1.35); p.bodyAngle = .075 * q;
        p.wave = .6 + .65 * Math.sin(age * TAU * 3.4); p.pawSpread = .95;
        p.ear += .9 * q; p.tail += 1.15 * q; p.bounce = .25 * Math.abs(q); break;
      case 'horrified':
        q = smooth((age - .5) / .5); p.faceSurprise = 1; p.mouthOpen = -.65; p.sweat = .85;
        p.shiftX = -.022 * q; p.bodyAngle = -.045; p.crouch = .75 * q; p.tilt = -.025;
        p.wave = -.45; p.pawSpread = -.65; p.ear -= 1.5 * q; p.tail -= 1.4 * q;
        p.breath = .1 * Math.sin(age * TAU * .8); break;
      case 'suspicious':
        p.eyeNarrow = .85; p.mouthOpen = .5; p.lookX = .015 * Math.sin(age * PI * .52);
        p.lookY = -.002; p.tilt = .045 * Math.sin(age * PI * .52); p.stretch = .35;
        p.bodyAngle = .04; p.shiftX = .014 * Math.sin(age * PI * .52);
        p.wave = .1; p.pawSpread = -.3; p.ear += .25; p.tail *= .2; break;
      case 'realization':
        q = smooth((age - .9) / .35); p.faceSurprise = age < 1.8 ? 1 : 0;
        p.eyeNarrow = .3 * smooth((age - 1.8) / .4); p.blink = Math.max(p.blink, pulse(age, 1.58, .45));
        p.crouch = .65 * (1 - q); p.stretch = .9 * q; p.tilt = .06 - .13 * q;
        p.wave = .25 + .95 * q; p.wiggle = .7 * q; p.pawSpread = .15;
        p.ear += .85 * q; p.tail += .65 * q; p.bounce = .3 * pulse(age, 1.0, .8); break;
      case 'anticipating':
        q = Math.sin(age * TAU * 1.45); p.lookY = -.009; p.lookX = -.003;
        p.step = .65 * q; p.bounce = .32 * Math.pow(Math.max(0, q), 2);
        p.wave = .9; p.pawSpread = -.9; p.stretch = .25; p.tilt = -.045;
        p.ear += .75 + .25 * q; p.tail += .8 * Math.sin(age * TAU * .73); break;
      case 'nostalgic':
        p.eyeNarrow = .45; p.mouthOpen = .25; p.lookX = .012; p.lookY = -.007;
        p.bodyAngle = -.03 * Math.sin(age * PI * .25); p.tilt = -.05;
        p.wave = .75; p.pawSpread = -.4; p.ear -= .35; p.tail += .2 * slow;
        p.breath = .5 * Math.sin(age * TAU / 6.4); break;
      case 'startled':
        q = pulse(age, .35, .85); r = smooth((age - .95) / .5); p.faceSurprise = 1;
        p.bounce = .9 * q; p.stretch = .7 * q; p.crouch = .7 * r; p.wave = .9 * q - .3 * r;
        p.pawSpread = 1.05 * q - .7 * r; p.ear += 1.0 * q - .9 * r;
        p.tail += .7 * q - .5 * r; p.tilt = -.06 * q + .055 * r; p.mouthOpen = .25; break;
      case 'trusting':
        p.eyeNarrow = .45; p.mouthOpen = .25; p.bodyAngle = .045 * lift; p.shiftX = .01 * lift;
        p.wave = 1.0 * lift; p.pawSpread = .55 * lift; p.tilt = -.025;
        p.ear -= .3; p.tail += .4 * Math.sin(age * PI * .6); p.stretch = .25; break;
      case 'affectionate':
        p.faceDelighted = 1; p.blush = .6; p.lookY = -.01;
        p.bodyAngle = .055 * Math.sin(age * PI * .6); p.shiftX = .018 * Math.sin(age * PI * .6);
        p.tilt = -.065; p.wave = .65; p.pawSpread = -.75; p.ear -= .75;
        p.tail += .65 * Math.sin(age * TAU * .6); p.crouch = .3; break;
      case 'empathic':
        p.faceSad = 1; p.lookX = -.01; p.lookY = .008; p.tear = .25;
        p.crouch = .8; p.tilt = .065; p.bodyAngle = .035; p.shiftX = .01;
        p.wave = .65 * lift; p.pawSpread = .35; p.ear -= .95; p.tail -= .65; break;
      case 'compassionate':
        p.eyeNarrow = .35; p.lookY = .009; p.tilt = .045;
        p.crouch = .4; p.bodyAngle = .025; p.wave = .95; p.pawSpread = .65 * (1 - .5 * lift);
        p.wiggle = .15 * Math.sin(age * PI * .6); p.ear -= .5; p.tail *= .4; break;
      case 'comforting':
        p.eyeNarrow = .5; p.mouthOpen = .3;
        q = .5 - .5 * Math.cos(age * TAU * .55); p.wave = .45 + .55 * q;
        p.wiggle = .25 * Math.sin(age * TAU * .55); p.pawSpread = .5;
        p.tilt = .045 * q; p.ear -= .25; p.tail += .15 * slow; p.crouch = .15; break;
      case 'awkward':
        q = Math.sin(age * TAU * .85); p.eyeNarrow = .2; p.mouthOpen = .9;
        p.lookX = -.012; p.lookY = .008; p.sweat = .6; p.pawSpread = -.85; p.wave = .55;
        p.step = .45 * q; p.shiftX = .012 * q; p.bodyAngle = .025 * q;
        p.tilt = .05; p.ear -= .7; p.tail += .3 * q; break;
      case 'respectful':
        q = smooth((age - .9) / .9) * (1 - smooth((age - 3.9) / .75));
        p.lookY = .014 * q; p.eyeNarrow = .2 * q; p.blink = q;
        p.stretch = .6 * (1 - q); p.crouch = 1.15 * q; p.tilt = .11 * q;
        p.bodyAngle = .045 * q; p.wave = .15; p.pawSpread = -.8; p.ear -= 1.0 * q; p.tail -= .4; break;
      case 'forgiving':
        q = smooth((age - 1.6) / 1.2); p.faceAngry = age < 1.9 ? 1 : 0;
        p.eyeNarrow = .45 * (1 - q); p.blink = Math.max(p.blink, pulse(age, 1.65, .55));
        p.pawSpread = -.8 + 1.7 * q; p.wave = .6; p.tilt = .035 * pulse(age, 3.2, 1.5);
        p.crouch = .25 * (1 - q); p.ear += -.4 + .65 * q; p.tail += .4 * q; break;
      case 'longing':
        q = pulse(age, .75, 3.6); p.faceSad = 1; p.lookX = .014; p.lookY = -.008;
        p.wave = .3 + .8 * q; p.pawSpread = -.8 + 1.45 * q; p.shiftX = .014 * q;
        p.bodyAngle = .04 * q; p.tilt = -.04 + .06 * (1 - q);
        p.ear -= .65; p.tail -= .7; p.crouch = .3; break;
      case 'heartflutter':
        q = pulse(age, 1.15, .75) + .6 * pulse(age, 3.2, .65);
        p.blush = 1; p.eyeNarrow = .25; p.lookY = -.009; p.wave = .95; p.pawSpread = -1;
        p.bounce = .65 * q; p.squash = .25 * (1 - q); p.bodyAngle = .018 * Math.sin(age * TAU * 1.7);
        p.tilt = -.04; p.ear += .35 * q; p.tail += .65 * q; break;
      case 'peaceful':
        p.blink = 1; p.breath = .8 * Math.sin(age * TAU / 6.2); p.eyeNarrow = .15;
        p.ear -= .55; p.tail *= .08; p.wave = -.25; p.pawSpread = .35;
        p.crouch = .25; p.tilt = 0; p.bodyAngle = 0; break;
      case 'secure':
        p.eyeNarrow = .65; p.mouthOpen = .3; p.bodyAngle = .05 * lift; p.shiftX = .011 * lift;
        p.tilt = .025; p.crouch = .45; p.wave = -.55; p.pawSpread = .3;
        p.ear -= 1.0; p.tail -= .35; p.breath = .65 * Math.sin(age * TAU / 5.5); break;
      case 'savoring':
        q = pulse(age, 1.1, 1.55) + pulse(age, 3.05, 1.55);
        p.blink = 1; p.mouthOpen = .7; p.tilt = .055 * q; p.wave = .85; p.pawSpread = -.9;
        p.ear -= .35; p.tail += .35 * slow; p.chew = .18 * Math.sin(age * TAU * .6);
        p.crouch = .15; p.squash = .08 * q; break;
      case 'meditating':
        p.blink = 1; p.eyeNarrow = .2; p.stretch = .65; p.tilt = -.012;
        p.wave = .65; p.pawSpread = -.8; p.ear += .15; p.tail = 0;
        p.breath = .45 * Math.sin(age * TAU / 5); p.bodyAngle = 0; break;
      case 'deep_sleep':
        p.blink = 1; p.breath = 1.1 * Math.sin(age * TAU / 5.8);
        p.crouch = 1.2; p.squash = .55; p.stretch = -.35; p.tilt = .09;
        p.bodyAngle = .025; p.wave = -.6; p.pawSpread = -.35; p.ear -= 1.3; p.tail -= .8; break;
      case 'stretching':
        q = pulse(age, .55, 3.75); p.blink = 1; p.mouthOpen = -.35 * q;
        p.stretch = 1.4 * q; p.squash = -.25 * q; p.wave = 1.45 * q; p.pawSpread = 1.1 * q;
        p.tilt = -.10 * q; p.bodyAngle = -.025 * q; p.ear += .7 * q; p.tail += .6 * q; break;
      case 'tired':
        q = smooth((age - .5) / 2); p.eyeNarrow = .95; p.lookY = .016; p.mouthOpen = .45;
        p.crouch = 1.15 * q; p.stretch = -.45 * q; p.tilt = .10 * q; p.wave = -.85;
        p.pawSpread = .25; p.ear -= 1.45 * q; p.tail -= 1.0; p.breath *= .55; break;
      case 'bored_fidget':
        q = Math.sin(age * TAU * 1.2); p.eyeNarrow = .8; p.mouthOpen = .65;
        p.lookX = .014 * Math.sin(age * PI * .65); p.tilt = -.045; p.wave = -.2;
        p.pawSpread = .3; p.step = .55 * Math.pow(Math.max(0, q), 3);
        p.tail += .95 * Math.sin(age * TAU * .6); p.crouch = .3; p.ear -= .55; break;
      case 'patient':
        p.eyeNarrow = .15; p.mouthOpen = .5; p.lookX = 0; p.lookY = 0;
        p.wave = .45; p.pawSpread = -.65; p.stretch = .3; p.ear += .25;
        p.tail *= .1; p.breath *= .55; p.tilt = 0; p.bodyAngle = 0; break;
      case 'refreshed':
        q = smooth((age - 1.0) / 1.2); p.blink = 1 - q; p.eyeNarrow = .15 * q;
        p.stretch = 1.1 * pulse(age, .75, 2.8); p.wave = 1.15 * q; p.pawSpread = .95 * q;
        p.tilt = .06 * (1 - q) - .05 * q; p.ear += -.6 + 1.6 * q;
        p.tail += .7 * q; p.crouch = .65 * (1 - q); p.bodyAngle = -.02 * q; break;
      case 'hungry':
        p.lookX = .014 * Math.sin(age * PI * .55); p.lookY = .01; p.mouthOpen = -.15;
        p.wave = .35; p.pawSpread = -.6; p.crouch = .55; p.tilt = .055;
        p.bodyAngle = .04; p.shiftX = .012; p.ear -= .45;
        p.squash = .2 * Math.sin(age * TAU * .7); p.tail -= .45; break;
      case 'thirsty':
        p.faceSurprise = 1; p.mouthOpen = .7; p.lookY = -.003; p.eyeNarrow = .35;
        p.wave = .65; p.pawSpread = -.2; p.bodyAngle = .028 * Math.sin(age * PI * .55);
        p.tilt = -.035; p.ear -= .65; p.tail -= .4; p.crouch = .35; break;
      case 'asking':
        q = pulse(age, .8, 1.5) + pulse(age, 3.0, 1.5); p.lookY = -.015;
        p.wave = .95; p.pawSpread = -1; p.bodyAngle = .045; p.shiftX = .012;
        p.tilt = -.055 + .035 * q; p.crouch = .35 * q; p.ear += .6;
        p.tail += .55 * slow; p.eyeNarrow = .05; break;
      case 'refusing':
        q = .5 + .5 * Math.sin(age * TAU * .8); p.eyeNarrow = .45; p.mouthOpen = .85;
        p.tilt = .075 * Math.sin(age * TAU * .8); p.wave = .9; p.pawSpread = .6 + .55 * q;
        p.wiggle = .4 * Math.sin(age * TAU * .8); p.bodyAngle = -.025;
        p.ear -= .15; p.tail *= .3; break;
      case 'agreeing':
        q = pulse(age, .55, 1.25) + pulse(age, 2.05, 1.25);
        p.eyeNarrow = .3; p.mouthOpen = .3; p.tilt = .085 * q; p.crouch = .25 * q;
        p.wave = .35; p.pawSpread = -.25; p.ear -= .2 * q; p.tail += .35; break;
      case 'disagreeing':
        p.blink = 1; p.mouthOpen = 1.0; p.tilt = .10 * Math.sin(age * TAU * .9);
        p.wave = .65; p.pawSpread = -.65; p.ear -= .35; p.tail -= .25;
        p.bodyAngle = -.02 * Math.sin(age * TAU * .9); break;
      case 'mischievous':
        q = pulse(age, 1.2, 2.4); p.eyeNarrow = -.85; p.mouthOpen = .3; p.lookX = -.013;
        p.tilt = .075; p.bodyAngle = .045 * q; p.shiftX = .016 * q;
        p.wave = .3 + .75 * q; p.wiggle = .8 * q; p.pawSpread = .55 * q;
        p.ear += .45; p.tail += .85 * Math.sin(age * PI * .65); break;
      case 'playful':
        q = pulse(age, .9, 1.3) + .65 * pulse(age, 3.25, 1.2); p.lookY = -.007;
        p.crouch = .8 * (1 - lift); p.bounce = .75 * q; p.wave = 1.2 * q;
        p.pawSpread = 1.05 * q; p.tilt = -.06; p.bodyAngle = .04 * Math.sin(age * PI * .65);
        p.ear += .85; p.tail += 1.1 * Math.sin(age * TAU * .85); break;
      case 'sneezing':
        q = pulse(age, 1.15, .55); r = pulse(age, .35, 1.25);
        p.blink = Math.max(p.blink, pulse(age, .95, .9)); p.mouthOpen = -1.1 * q;
        p.stretch = .6 * r - .45 * q; p.crouch = 1.1 * q; p.squash = .7 * q;
        p.tilt = -.055 * r + .11 * q; p.bodyAngle = .065 * q; p.wave = .35 + .6 * q;
        p.pawSpread = -.6; p.ear += .5 * r - 1.0 * q; p.tail -= .6 * q; break;
      case 'full':
        p.eyeNarrow = .75; p.mouthOpen = .4; p.bodyAngle = -.065; p.shiftX = -.014;
        p.crouch = .55; p.squash = .35; p.tilt = -.055; p.wave = .15;
        p.pawSpread = -.65; p.wiggle = .4 * Math.sin(age * TAU * .6);
        p.ear -= .6; p.tail -= .3; p.breath = .95 * Math.sin(age * TAU / 4.5); break;
      case 'walk_joy':
        stride = age * TAU * 1.65 * profile.movingCadence * branch.movingCadence;
        p.faceDelighted = 1; p.step = Math.sin(stride); p.bounce = .65 * Math.pow(Math.max(0, Math.sin(stride)), 2);
        p.wave = .4 + .6 * Math.sin(stride); p.wiggle = .7 * Math.cos(stride); p.pawSpread = .65;
        p.bodyAngle = .035 * Math.sin(stride); p.shiftX = .018 * Math.sin(age * PI * .55);
        p.ear += .7 * Math.sin(stride); p.tail += .9 * Math.sin(stride * .5); p.tilt = -.035; break;
      case 'walk_angry':
        stride = age * TAU * 2.35 * profile.movingCadence * branch.movingCadence;
        p.faceAngry = 1; p.eyeNarrow = .55; p.anger = .8; p.step = Math.sin(stride);
        p.squash = .45 * Math.pow(Math.max(0, Math.sin(stride)), 2); p.wave = -.25;
        p.pawSpread = 1.15; p.bodyAngle = .055 * Math.sin(stride); p.stretch = .35;
        p.shiftX = .024 * Math.sin(age * PI * .7); p.ear += 1.0; p.tail += 1.1; p.tilt = -.05; break;
      case 'walk_sad':
        stride = age * TAU * .78 * profile.movingCadence * branch.movingCadence;
        p.faceSad = 1; p.lookY = .016; p.eyeNarrow = .3; p.step = .65 * Math.sin(stride);
        p.crouch = .7 + .15 * Math.abs(p.step); p.wave = -.75; p.pawSpread = -.25;
        p.bodyAngle = .018 * Math.sin(stride); p.shiftX = .01 * Math.sin(age * PI * .28);
        p.ear -= 1.05; p.tail -= .85; p.tilt = .075; p.bounce = .05 * Math.abs(p.step); break;
      case 'body_head': p.lookX=.014*Math.sin(age*TAU*.4);p.lookY=.005*Math.cos(age*TAU*.4);break;
      case 'body_tail': p.lookX=-.012;p.lookY=.002;break;
      case 'body_flap':
        var flap=armFlapPhase(age);
        p.wave=0;p.wiggle=0;p.faceDelighted=.65*flap.drive;
        p.crouch=.10*pulse(age,.04,.85);p.tilt=.012*Math.sin(age*TAU*.43)*flap.open;
        p.ear+=.12*Math.sin(age*TAU*.63-.7)*flap.open;
        p.tail+=.20*Math.sin(age*TAU*.45-.9)*flap.open;break;
      case 'body_joy':
        q=Math.pow(Math.max(0,Math.sin((age-.65)*TAU*.9)),2)*lift;
        p.faceDelighted=1;p.bounce=.9*q;p.squash=.45*(1-q)*hold;p.wave=1.2*lift;
        p.pawSpread=1.1*lift;p.ear+=.8*q;p.tail+=Math.sin(age*TAU*1.1);break;
    }
  }
  // Pure profiles in seconds. Emotions ease in and settle to the exact underlying idle pose.
  function pose(seconds, situation, elapsedSeconds, growthStage, evolutionPath) {
    var profile = growthProfile(growthStage), branch=evolutionProfile(evolutionPath), rawSeconds = Math.max(0, finite(seconds, 0));
    var s = rawSeconds * profile.cadence * branch.cadence, t = s % 12, name = known(situation);
    var age = Math.max(0, finite(elapsedSeconds, rawSeconds)), duration = durations[name] / 1000;
    if (name !== 'idle' && age >= duration) name = 'idle';
    var tilt = Math.sin((t - 2.8) / 4.2 * PI) * envelope(t - 2.8, 4.2);
    if (t < 2.8 || t > 7) tilt = 0;
    var wave = smooth((t - 7.2) / .7) * smooth((10.1 - t) / .7);
    var p = { situation: name, breath: Math.sin(s * TAU / 4),
      blink: Math.min(1, pulse(t, 1.65, .28) + pulse(t, 4.9, .26) + pulse(t, 5.28, .24) + pulse(t, 10.4, .3)),
      tilt: tilt * .026 + Math.sin(s * TAU / 12) * .0025,
      ear: Math.sin(s * TAU / 6) * .35 + tilt * .4,
      tail: Math.sin(s * TAU / 6) * .25,
      wave: wave, wiggle: Math.sin((t - 7.2) * TAU * 1.45) * wave,
      chew: 0, bounce: 0, step: 0,
      lookX: Math.sin(s * TAU / 12) * .00065, lookY: Math.sin(s * TAU / 6) * .00035,
      presence: 0, bodyAngle: 0, shiftX: 0, shiftY: 0, squash: 0, stretch: 0, crouch: 0, pawSpread: 0,
      faceSad: 0, faceAngry: 0, faceSurprise: 0, faceDelighted: 0, tear: 0, blush: 0, sweat: 0, anger: 0,
      eyeNarrow: 0, mouthOpen: 0, effectPhase: 0 };
    if (name === 'idle') return p;
    // The side-view room mesh owns its gait. Keep the frontal idle and original
    // size intact while turning, instead of applying a second body translation.
    if(Object.prototype.hasOwnProperty.call(roomWalkDurations,name))return p;
    var e = envelope(age, duration), beat = Math.sin(age * TAU), fast = Math.sin(age * TAU * 2.4);
    var hop = Math.pow(Math.max(0, Math.sin(age * TAU * 1.15)), 2);
    var nod = .5 - .5 * Math.cos(age * TAU * .65);
    p.presence = e; p.effectPhase = age;
    p.wave *= 1 - e; p.wiggle *= 1 - e; p.tilt *= 1 - e;
    // The profile values below are intentional acting choices: bows, recoils, hunches,
    // stomps, hiding paws and sweeping dance steps, rather than one reused wobble.
    switch (name) {
      case 'joy': p.faceDelighted = .75; p.bounce = hop; p.wave = .9; p.wiggle = fast; p.ear += .6 * beat; p.tail += .8 * beat; p.squash = .4 * (1 - hop); break;
      case 'laugh': p.faceDelighted = 1; p.blink = Math.max(p.blink, .95 * e); p.mouthOpen = .7 + .3 * fast; p.squash = .65 * fast; p.bodyAngle = .038 * beat; p.crouch = .25; p.wave = .3; p.ear += .8 * fast; break;
      case 'excited': p.faceDelighted = .85; p.bounce = .7 * Math.abs(fast); p.pawSpread = .65; p.wave = .9; p.stretch = .55 * fast; p.tail += 1.4 * fast; p.lookY = -.008; break;
      case 'proud': p.faceDelighted = .35; p.stretch = .8; p.bodyAngle = -.035; p.tilt = -.075; p.pawSpread = 1; p.wave = .35; p.eyeNarrow = .35; p.tail += .75; p.shiftY = -.006; break;
      case 'love': p.faceDelighted = .65; p.blush = 1; p.bodyAngle = .055 * Math.sin(age * PI * .6); p.tilt = .065; p.wave = .75; p.pawSpread = -.7; p.lookX = -.007; p.ear -= .55; break;
      case 'grateful': p.faceDelighted = .45; p.blink = Math.max(p.blink, e * .85); p.tilt = .065 * nod; p.bodyAngle = .03 * nod; p.crouch = .8 * nod; p.pawSpread = -.65; p.wave = .7; p.ear -= .7 * nod; break;
      case 'sad': p.faceSad = 1; p.tilt = .065; p.crouch = .85; p.ear -= 1.1; p.tail -= .8; p.wave = -.5; p.lookY = .012; p.bodyAngle = .02 * Math.sin(age * PI * .4); break;
      case 'cry': p.faceSad = 1; p.tear = 1; p.crouch = .9; p.squash = .35 * fast; p.bodyAngle = .018 * Math.sin(age * TAU * 3.4); p.pawSpread = -.9; p.wave = 1; p.ear -= 1.25; p.mouthOpen = .2 + .2 * fast; break;
      case 'lonely': p.faceSad = .8; p.bodyAngle = -.048; p.tilt = .075 * Math.sin(age * PI * .36); p.shiftX = -.012; p.pawSpread = -.6; p.ear -= .8; p.tail -= .9; p.lookX = .009 * Math.sin(age * PI * .36); p.crouch = .45; break;
      case 'disappointed': p.faceSad = .9; p.crouch = Math.min(1, age / .7); p.squash = .65; p.tilt = .08; p.ear -= 1.35; p.wave = -.8; p.lookY = .014; p.stretch = -.3; break;
      case 'angry': p.faceAngry = 1; p.anger = 1; p.step = .8 * Math.sin(age * TAU * 1.7); p.squash = .45 * Math.abs(p.step); p.bodyAngle = .04 * Math.sin(age * TAU * 1.7); p.pawSpread = .85; p.wave = .55; p.ear += .8; p.tail += 1.3 * beat; p.tilt = -.025; break;
      case 'sulky': p.faceAngry = .7; p.faceSad = .25; p.bodyAngle = -.065; p.tilt = -.075; p.pawSpread = -.75; p.wave = .55; p.eyeNarrow = .6; p.lookX = .014; p.ear -= .65; p.crouch = .3; break;
      case 'surprise': p.faceSurprise = 1; p.bounce = .9 * pulse(age, .12, 1.25); p.stretch = .75; p.pawSpread = 1; p.wave = .95; p.tilt = -.04; p.ear += 1.25; p.mouthOpen = 1; p.shiftX = -.015 * pulse(age, .12, 1.25); break;
      case 'scared': p.faceSurprise = .9; p.sweat = .7; p.bodyAngle = .025 * Math.sin(age * TAU * 5.6); p.shiftX = -.022; p.crouch = .9; p.pawSpread = -.9; p.wave = .9; p.ear -= 1.4; p.tail -= 1.2; p.mouthOpen = .45; break;
      case 'nervous': p.faceSurprise = .45; p.sweat = 1; p.step = .55 * Math.sin(age * TAU * 1.4); p.bodyAngle = .025 * beat; p.lookX = .012 * Math.sin(age * PI * 1.2); p.wave = .45; p.pawSpread = -.4; p.ear += .4 * fast; break;
      case 'confused': p.faceSurprise = .4; p.tilt = .11 * Math.sin(age * PI * .7); p.pawSpread = .7; p.wave = .35 + .3 * nod; p.lookY = -.006; p.ear += .55 * Math.sin(age * PI * .7); p.bodyAngle = -.02; break;
      case 'curious': p.faceSurprise = .3; p.tilt = -.095; p.shiftX = .022 * nod; p.stretch = .6; p.lookX = -.012; p.lookY = -.005; p.wave = .3; p.ear += 1.15; p.tail += .5; break;
      case 'thinking': p.tilt = .075; p.wave = .95; p.pawSpread = -.3; p.eyeNarrow = .45; p.lookX = .01; p.lookY = -.009; p.ear -= .35; p.bodyAngle = .012 * Math.sin(age * PI * .4); p.faceSurprise = .12; break;
      case 'greeting': p.wave = 1; p.wiggle = Math.sin(age * TAU * 1.5); p.tilt = .05; p.faceDelighted = .45; p.pawSpread = .7; p.tail += .8 * beat; break;
      case 'petted': p.blink = Math.max(p.blink, e); p.tilt = .075; p.ear += .5 * Math.sin(age * PI); p.faceDelighted = .45; p.bodyAngle = .035 * nod; p.blush = .55; p.crouch = .25; break;
      case 'shy': p.faceDelighted = .2; p.blush = .9; p.pawSpread = -1; p.wave = 1.1; p.tilt = .065; p.bodyAngle = .045 * Math.sin(age * PI * .65); p.lookY = .007; p.ear -= .85; p.crouch = .3; break;
      case 'embarrassed': p.faceSurprise = .55; p.blush = .85; p.sweat = .65; p.wiggle = Math.sin(age * TAU * 2); p.wave = .9; p.pawSpread = .5; p.tilt = -.055; p.step = .45 * fast; p.ear += .45 * fast; break;
      case 'apology': p.faceSad = .65; p.blink = Math.max(p.blink, e * .8); p.crouch = .85 * nod; p.tilt = .095 * nod; p.bodyAngle = .04 * nod; p.ear -= 1.1; p.wave = .3; p.pawSpread = -.85; break;
      case 'cheer': p.faceDelighted = .85; p.wave = .65 + .45 * Math.abs(fast); p.pawSpread = 1; p.tilt = -.025 + .012 * Math.sin(age * TAU * .6); p.tail += .5 * Math.sin(age * TAU * .55); p.stretch = .15; break;
      case 'resting': p.blink = Math.max(p.blink, e); p.breath = (1 - e) * p.breath + e * .55 * Math.sin(s * TAU / 6); p.tilt = .065; p.ear -= .7; p.tail *= .2; p.crouch = .8; p.squash = .25; break;
      case 'sleepy': p.blink = Math.max(p.blink, e * (.65 + .35 * nod)); p.tilt = .10 * nod; p.crouch = .45 + .35 * nod; p.ear -= .85; p.bodyAngle = .025 * Math.sin(age * PI * .5); p.eyeNarrow = .55; break;
      case 'yawn': p.faceSurprise = .7 * nod; p.blink = Math.max(p.blink, e * .9); p.mouthOpen = nod; p.stretch = .9 * nod; p.pawSpread = .8 * nod; p.wave = .8; p.tilt = -.065 * nod; p.ear += .55 * nod; break;
      case 'relaxed': p.blink = Math.max(p.blink, e * .75); p.tilt = -.045; p.bodyAngle = .035 * Math.sin(age * PI * .4); p.crouch = .35; p.ear -= .45; p.tail += .4 * Math.sin(age * PI * .5); p.faceDelighted = .25; p.breath *= .6; break;
      case 'bored': p.faceSad = .25; p.eyeNarrow = .8; p.tilt = .075; p.crouch = .65; p.wave = .65; p.pawSpread = -.25; p.lookX = .014 * Math.sin(age * PI * .45); p.ear -= .9; p.step = .2 * Math.sin(age * TAU * .65); break;
      case 'feeding': {
        var reach = 1 - smooth((age - 1.1) / .6);
        var munch = smooth((age - 1.05) / .45) * (1 - smooth((age - 4.05) / .55));
        var celebrating = smooth((age - 4.4) / .35) * (1 - smooth((age - 7.0) / .8));
        var settle = smooth((age - 7.0) / .8), jaw = Math.sin((age - 1.2) * TAU * 2.2);
        var happyBeat = Math.sin((age - 4.4) * TAU * 1.2), happyHop = Math.pow(Math.max(0, happyBeat), 2);
        p.chew = munch > 0 ? munch * jaw : 0;
        p.wave = .35 * reach + munch * (.8 + .12 * beat) + 1.15 * celebrating + .4 * settle;
        p.pawSpread = -.4 * reach - .9 * munch + .95 * celebrating - .25 * settle;
        p.wiggle = .15 * munch * beat + .8 * celebrating * happyBeat;
        p.tilt = -.035 * reach + .028 * munch * jaw - .035 * celebrating + .035 * settle * nod;
        p.bounce = .95 * celebrating * happyHop;
        p.bodyAngle = .065 * celebrating * happyBeat;
        p.squash = .12 * munch * beat + .3 * celebrating * (1 - happyHop) + .08 * settle;
        p.stretch = .3 * reach + .55 * celebrating;
        p.crouch = .25 * reach + .16 * munch + .15 * settle;
        p.ear += .35 * reach + .2 * munch * jaw + .9 * celebrating;
        p.tail += .25 * reach + .3 * munch * beat + 1.2 * celebrating * happyBeat;
        p.lookX = .008 * reach; p.lookY = .01 * reach + .006 * munch;
        p.mouthOpen = .25 * reach + .3 * munch * (.5 + .5 * jaw) + .55 * celebrating;
        // Close the original eyes just before the happy face appears. The happy
        // keyframe stays whole and crisp, then the normal cue envelope releases it.
        p.blink = Math.max(p.blink, pulse(age, 4.12, .5) * e);
        p.faceDelighted = age >= 4.4 ? 1 : 0;
        p.blush = .35 * celebrating;
        break;
      }
      case 'moving': p.step = Math.sin(age * TAU * 2 * profile.movingCadence * branch.movingCadence); p.bounce = .25 * Math.abs(p.step); p.bodyAngle = .035 * p.step; p.shiftX = .018 * Math.sin(age * PI * 1.2); p.wave = .25; p.ear += .4 * p.step; break;
      case 'caught': p.bounce = .75 * Math.pow(Math.sin(age * PI * 1.4), 2); p.wave = 1; p.pawSpread = -.3; p.faceDelighted = .8; p.ear += .85; p.tail += .7; p.stretch = .5; break;
      case 'dance': p.faceDelighted = .75; p.bodyAngle = .085 * Math.sin(age * PI * 1.3); p.shiftX = .025 * Math.sin(age * PI * 1.3); p.step = Math.sin(age * TAU * 1.3); p.bounce = .35 * Math.abs(p.step); p.wave = .7; p.wiggle = fast; p.pawSpread = .8 * beat; p.tail += 1.1 * beat; break;
      case 'celebrate': p.faceDelighted = 1; p.bounce = .95 * hop; p.wave = 1.15; p.pawSpread = 1.1; p.stretch = .65; p.bodyAngle = .05 * beat; p.ear += 1; p.tail += 1.2 * fast; p.mouthOpen = .6; break;
      case 'determined': p.faceAngry = .4; p.eyeNarrow = .25; p.crouch = .65 * nod; p.stretch = .55 * (1 - nod); p.pawSpread = .35; p.wave = .85; p.ear += .9; p.tilt = -.045; p.squash = .3 * nod; p.tail += .7; break;
      default: {
        var originalBlink = p.blink;
        additionalPose(p, name, age, duration, profile, branch);
        p.blink = originalBlink + (p.blink - originalBlink) * e;
        break;
      }
    }
    // All acting offsets, including facial keyframes, share the same release envelope.
    ['bounce', 'step', 'chew', 'bodyAngle', 'shiftX', 'shiftY', 'squash', 'stretch', 'crouch', 'pawSpread',
      'faceSad', 'faceAngry', 'faceSurprise', 'faceDelighted', 'tear', 'blush', 'sweat', 'anger', 'eyeNarrow', 'mouthOpen'].forEach(function (key) { p[key] *= e; });
    p.tilt *= e;
    // Retain the idle motion while releasing a cue; no frozen hold or sudden final snap.
    var idle = pose(rawSeconds, 'idle', 0, profile.key, branch.key);
    p.bounce *= branch.bounce;
    p.tilt += idle.tilt * (1 - e);
    p.breath = idle.breath + (p.breath - idle.breath) * e;
    p.ear = idle.ear + (p.ear - idle.ear) * e;
    p.tail = idle.tail + (p.tail - idle.tail) * e;
    p.wave = idle.wave * (1 - e) + p.wave * e;
    p.wiggle = idle.wiggle * (1 - e) + p.wiggle * e;
    p.lookX = idle.lookX * (1 - e) + p.lookX * e;
    p.lookY = idle.lookY * (1 - e) + p.lookY * e;
    p.blink = clamp(p.blink, 0, 1);
    p.effectPhase *= e;
    return p;
  }
  // Every limb has its own cutout mesh and pivot. Source UVs never move with a
  // different limb; only vertices move. Rear layers overlap at their sockets.
  var rigParts = Object.freeze([
    {id:'tail',parent:'root',pivot:[.266,.786],polygon:[[.295,.722],[.285,.835],[.225,.846],[.17,.835],[.115,.813],[.083,.781],[.07,.736],[.064,.687],[.051,.659],[.073,.623],[.109,.611],[.146,.617],[.182,.631],[.212,.654],[.239,.688],[.27,.713]]},
    {id:'torso',parent:'root',pivot:[.56,.79],polygon:[[.212,.695],[.23,.636],[.289,.607],[.406,.624],[.546,.639],[.712,.601],[.79,.62],[.829,.68],[.835,.751],[.81,.817],[.767,.873],[.714,.9],[.615,.915],[.476,.917],[.344,.918],[.271,.897],[.224,.835],[.208,.756]]},
    {id:'foot_l',parent:'root',pivot:[.414,.884],polygon:[[.352,.879],[.404,.876],[.453,.881],[.478,.899],[.477,.918],[.454,.93],[.4,.929],[.365,.92],[.348,.902]]},
    {id:'foot_r',parent:'root',pivot:[.69,.876],polygon:[[.65,.873],[.686,.864],[.717,.871],[.738,.891],[.728,.91],[.699,.918],[.67,.911],[.649,.896]]},
    {id:'ear_l',parent:'head',pivot:[.281,.355],polygon:[[0.328833,0.299868],[0.304453,0.383608],[0.269473,0.440848],[0.221773,0.484308],[0.175133,0.502328],[0.121073,0.491728],[0.073373,0.463108],[0.039453,0.420708],[0.028853,0.376188],[0.036273,0.324248],[0.068073,0.280788],[0.068073,0.242628],[0.089273,0.209768],[0.126373,0.190688],[0.175133,0.189628],[0.230253,0.199168],[0.281133,0.238388]]},
    {id:'ear_r',parent:'head',pivot:[.77,.258],polygon:[[0.707697,0.238609],[0.701427,0.177999],[0.703517,0.104849],[0.724417,0.056779],[0.756812,0.037969],[0.787117,0.035879],[0.813242,0.053644],[0.832052,0.067229],[0.863402,0.067229],[0.895797,0.084994],[0.912517,0.116344],[0.908337,0.149784],[0.930282,0.173819],[0.944912,0.207259],[0.934462,0.241744],[0.911472,0.269959],[0.873852,0.285634],[0.816377,0.291904],[0.768307,0.279364]]},
    {id:'head',parent:'root',pivot:[.62,.675],polygon:[[.211,.53],[.21,.455],[.222,.368],[.248,.299],[.287,.25],[.337,.203],[.396,.162],[.449,.139],[.4,.116],[.401,.086],[.418,.052],[.453,.026],[.493,.026],[.536,.043],[.564,.076],[.575,.12],[.636,.118],[.7,.132],[.752,.162],[.789,.195],[.832,.235],[.865,.277],[.897,.316],[.922,.359],[.937,.41],[.947,.463],[.941,.509],[.929,.543],[.886,.573],[.831,.611],[.767,.64],[.708,.644],[.674,.652],[.646,.648],[.616,.646],[.58,.662],[.537,.679],[.518,.686],[.438,.687],[.356,.683],[.287,.663],[.251,.642],[.231,.611],[.219,.575]]},
    {id:'arm_l',parent:'root',pivot:[.374,.705],polygon:[[.366,.704],[.397,.682],[.44,.689],[.489,.696],[.536,.688],[.584,.673],[.615,.656],[.639,.662],[.655,.681],[.664,.708],[.663,.738],[.648,.774],[.625,.798],[.59,.817],[.546,.828],[.5,.828],[.457,.819],[.42,.8],[.391,.77],[.373,.739]]},
    {id:'arm_r',parent:'root',pivot:[.794,.65],polygon:[[.792,.591],[.814,.614],[.823,.64],[.829,.67],[.837,.711],[.831,.749],[.805,.777],[.778,.796],[.746,.804],[.714,.797],[.689,.779],[.672,.751],[.66,.72],[.655,.693],[.665,.671],[.691,.657],[.723,.655],[.754,.65]]}
  ].map(function(part,index){part.index=index;Object.freeze(part.pivot);part.polygon.forEach(Object.freeze);Object.freeze(part.polygon);return Object.freeze(part);}));
  // The nursery drawing has its own silhouette and attachment points. None of
  // the adult's cropped paws, eyes or face imagery is used for this family.
  var nurseryRigParts=Object.freeze([
    {id:'tail',parent:'root',pivot:[.345,.80],polygon:[[.36,.705],[.368,.82],[.34,.858],[.295,.858],[.255,.845],[.228,.821],[.216,.776],[.214,.728],[.219,.69],[.246,.666],[.282,.66],[.321,.67],[.347,.689]]},
    {id:'torso',parent:'root',pivot:[.55,.79],polygon:[[.332,.65],[.39,.623],[.51,.625],[.65,.631],[.704,.66],[.735,.725],[.742,.793],[.716,.866],[.67,.902],[.58,.916],[.459,.913],[.385,.89],[.344,.848],[.326,.778]]},
    {id:'foot_l',parent:'root',pivot:[.452,.898],polygon:[[.397,.888],[.432,.877],[.478,.883],[.506,.901],[.509,.924],[.489,.937],[.442,.937],[.409,.928],[.397,.909]]},
    {id:'foot_r',parent:'root',pivot:[.628,.897],polygon:[[.568,.883],[.614,.876],[.665,.883],[.692,.903],[.691,.932],[.657,.943],[.604,.939],[.572,.925]]},
    {id:'ear_l',parent:'head',pivot:[.28,.32],polygon:[[.316,.267],[.292,.349],[.255,.417],[.217,.488],[.166,.512],[.12,.496],[.09,.453],[.079,.417],[.056,.392],[.053,.353],[.063,.316],[.084,.289],[.104,.254],[.139,.224],[.183,.211],[.232,.218],[.294,.235]]},
    {id:'ear_r',parent:'head',pivot:[.76,.31],polygon:[[.724,.253],[.763,.217],[.816,.204],[.869,.201],[.916,.21],[.949,.238],[.95,.272],[.971,.301],[.978,.34],[.97,.371],[.979,.4],[.967,.443],[.93,.474],[.882,.483],[.834,.466],[.793,.422],[.762,.372]]},
    {id:'head',parent:'root',pivot:[.55,.645],polygon:[[.212,.44],[.216,.365],[.23,.305],[.25,.26],[.286,.22],[.335,.185],[.395,.157],[.434,.139],[.408,.145],[.41,.109],[.427,.08],[.458,.055],[.502,.047],[.55,.053],[.59,.079],[.617,.12],[.611,.147],[.648,.148],[.689,.164],[.737,.212],[.784,.254],[.822,.306],[.85,.365],[.871,.425],[.883,.49],[.877,.549],[.849,.592],[.803,.594],[.77,.612],[.74,.624],[.713,.633],[.70,.636],[.685,.639],[.675,.646],[.65,.650],[.60,.650],[.55,.652],[.50,.657],[.45,.658],[.42,.659],[.40,.653],[.379,.653],[.35,.647],[.32,.638],[.269,.607],[.233,.558],[.217,.499]]},
    {id:'arm_l',parent:'root',pivot:[.411,.666],polygon:[[.389,.65],[.417,.641],[.443,.657],[.456,.694],[.453,.734],[.439,.771],[.421,.796],[.398,.813],[.368,.814],[.342,.797],[.321,.769],[.319,.738],[.332,.709],[.353,.687],[.374,.671]]},
    {id:'arm_r',parent:'root',pivot:[.675,.659],polygon:[[.648,.641],[.685,.642],[.72,.665],[.752,.7],[.779,.736],[.797,.765],[.796,.794],[.774,.816],[.736,.82],[.706,.798],[.688,.766],[.673,.736],[.66,.706]]}
  ].map(function(part,index){part.index=index;Object.freeze(part.pivot);part.polygon.forEach(Object.freeze);Object.freeze(part.polygon);return Object.freeze(part);}));
  function identity() { return [1,0,0,1,0,0]; }
  function multiply(a,b) { return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]]; }
  function transform(m,p) { return {x:m[0]*p.x+m[2]*p.y+m[4],y:m[1]*p.x+m[3]*p.y+m[5]}; }
  function bone(pivot,angle,dx,dy,sx,sy) {
    var c=Math.cos(angle),s=Math.sin(angle),a=c*(sx||1),b=s*(sx||1),d=c*(sy||1),cc=-s*(sy||1);
    return [a,b,cc,d,pivot.x-a*pivot.x-cc*pivot.y+(dx||0),pivot.y-b*pivot.x-d*pivot.y+(dy||0)];
  }
  function isIn(name,list) { return list.indexOf(name)>=0; }
  // A limb follows its socket position, not the torso's changing proportions.
  // The head and hands keep their own rotation and rigid, uniform scale.
  function socketMatrix(root,torso,pivot,angle,anchor) {
    var matrix=multiply(root,bone(pivot,angle)),socket=transform(torso,anchor||pivot),rest=transform(matrix,pivot);
    matrix[4]+=socket.x-rest.x;matrix[5]+=socket.y-rest.y;return matrix;
  }
  function flightAmount(p) {
    return isIn(p.situation,['joy','excited','ecstatic','triumphant','surprise','startled','caught','celebrate','playful','body_joy','feeding'])?p.bounce:0;
  }
  // The little body carries weight over two separate feet. Quiet standing has
  // occasional small transfers; emotions have their own knees and footwork.
  function lowerBodyFrame(p,seconds,age,step) {
    var name=p.situation,e=p.presence,s=Math.max(0,seconds),a=Math.max(0,age),cycle=s%9;
    var idleStep=.34*Math.sin((cycle-2)*TAU/2.8)*pulse(cycle,2,2.8);
    var idle={step:idleStep,sway:.004*Math.sin(s*TAU/6)+.007*idleStep,drop:.002*(1-Math.cos(s*TAU/6)),bend:0,toeIn:0,lift:.045};
    if(name==='idle')return idle;
    if(Object.prototype.hasOwnProperty.call(roomWalkDurations,name))return {step:0,sway:0,drop:0,bend:0,toeIn:0,lift:.055};
    var authoredStep=isIn(name,['angry','nervous','embarrassed','bored','moving','dance','annoyed','frustrated','furious','panic','anticipating','awkward','bored_fidget','walk_joy','walk_angry','walk_sad']);
    var focused=name.indexOf('body_')===0||name.indexOf('direction_')===0;
    var active={step:authoredStep?step:0,sway:focused?0:.002*Math.sin(a*TAU*.37),drop:0,bend:.012*p.crouch,toeIn:0,lift:.055};
    if(name==='body_feet'){active.step=Math.sin(a*TAU*.85);active.sway=.012*active.step;active.drop=.008*Math.abs(active.step);active.bend=.010*Math.abs(active.step);}
    else if(isIn(name,['body_hands','body_flap','body_head','body_ears','body_tail','cheer','greeting','proud','grateful','petted','thinking','confused','asking','refusing','agreeing','disagreeing','laugh','amused','love','shy','trusting','affectionate','compassionate','comforting','mischievous','hungry','thirsty','savoring','full','content','heartflutter','forgiving','curious','gentlesmile','admiring','beauty','awed','entranced','contempt','suspicious','nostalgic','patient'])){
      active.step=0;active.sway=0;active.drop=0;active.bend=0;
    }else if(isIn(name,['joy','laugh','excited','celebrate','dance','body_joy','victory','playful','delighted'])){
      active.step=authoredStep?step:.68*Math.sin(a*TAU*1.35)*(1-.75*p.bounce);
      active.sway=.013*active.step;active.bend=.015*(1-p.bounce);active.drop=.004*Math.abs(active.step);
    }else if(isIn(name,['angry','frustrated','furious','walk_angry','stubborn','disagreeing'])){
      active.step=authoredStep?step:.72*Math.sin(a*TAU*1.6);active.sway=.010*active.step;active.bend=.014;active.drop=.008*Math.max(0,-Math.sin(a*TAU*3.2));
    }else if(isIn(name,['sad','cry','lonely','disappointed','sulky','regretful','empathic','walk_sad','holding_tears','guilty','longing'])){
      active.step=authoredStep?step:0;active.toeIn=.12;active.sway=.003*Math.sin(a*TAU*.31);active.bend=.020;active.drop=.010;active.lift=.035;
    }else if(isIn(name,['resting','deep_sleep','sleepy','tired','meditating','relaxed'])){
      active.step=0;active.toeIn=.10;active.bend=.026;active.drop=.012;
    }else if(isIn(name,['scared','nervous','anxious','worried','startled','embarrassed'])){
      active.step=authoredStep?step:.35*Math.sin(a*TAU*2);active.sway=.005*Math.sin(a*TAU*3);active.bend=.019;active.toeIn=.06;active.lift=.035;
    }else if(name==='feeding'){
      var happy=smooth((a-4.4)/.35)*(1-smooth((a-7)/.8));
      active.step=.62*happy*Math.sin((a-4.4)*TAU*1.4);
      active.sway=.013*active.step;active.bend=.005+.007*happy;active.drop=.006*happy*Math.abs(active.step);
    }else if(isIn(name,['moving','walk_joy','hop','jump','run','skip'])){
      active.sway=.014*step;active.bend=.014*Math.abs(step);active.drop=.006*Math.abs(step);
    }
    var result={};Object.keys(idle).forEach(function(key){result[key]=idle[key]*(1-e)+active[key]*e;});return result;
  }
  function lowerBodyTorsoPoint(lower,x,y,point) {
    if(!lower)return point;
    var knee=smooth((y-.79)/.12),right=smooth((x-.49)/.12),leftLift=Math.max(0,lower.step),rightLift=Math.max(0,-lower.step);
    // The same continuous belly mesh follows the lifted leg at its socket.
    // UVs and the garment stay attached; there is no extra foot painted on it.
    // A bent knee lowers the hips, not the planted belly/ankle edge. Compress
    // the lower body back toward the same floor instead of sinking through it.
    var planted=smooth((y-.78)/.12),settle=(lower.drop+lower.bend)/Math.max(.9,1-lower.bend*.6);
    return {x:point.x+(-.012*leftLift*(1-right)+.012*rightLift*right)*knee,
      y:point.y-.030*(leftLift*(1-right)+rightLift*right)*knee-settle*planted};
  }
  // A pure frame of the hierarchical cutout rig. Matrices operate on coordinates
  // after growth/evolution, before the final normalized canvas projection.
  function rigFrame(p,seconds,age,stage,path,scale,appearanceKey,eggOrigin) {
    var appearance=appearanceProfile(appearanceKey),nursery=appearance.family==='baby',parts=nursery?nurseryRigParts:rigParts;
    function point(x,y){return nursery?appearancePoint(appearance.key,x,y,path,eggOrigin):growthPoint(stage,x,y,path,eggOrigin);}
    var profile=growthProfile(stage),name=p.situation,e=p.presence,a=Math.max(0,age),s=Math.max(0,seconds);
    var baseAmount=(nursery?appearance.overallScale:profile.overallScale)*clamp(finite(scale,1),.35,1.15);
    if(nursery)baseAmount*=nurseryPresentationScale(stage,path,appearance.key,baseAmount,eggOrigin);
    var amount=baseAmount,flight=flightAmount(p);
    // Only genuine flight is shared by every body part. Breathing, posture and
    // squash belong to the torso; a raised hand cannot resize the head or feet.
    var root=bone({x:.5,y:.92},0,0,-flight*.055);
    var project=bone({x:.5,y:.92},0,0,0,amount,amount);root=multiply(project,root);
    var posture=multiply(root,bone({x:.5,y:.92},-p.bodyAngle,p.shiftX,p.shiftY-(p.bounce-flight)*.010,
      1+.085*p.squash+.003*p.breath,1-.075*p.squash+.07*p.stretch-.055*p.crouch+.004*p.breath));
    var headAngle=-p.tilt*1.15,earL=.22*p.ear,earR=-.18*p.ear+.025*Math.sin(s*TAU*.7),tail=.28*p.tail;
    var armL=-.58*p.wave-.18*p.pawSpread+.16*p.wiggle,armR=.83*p.wave+.2*p.pawSpread+.3*p.wiggle;
    var footStep=p.step,feetDemo=false;
    var base={head:headAngle,earL:earL,earR:earR,tail:tail,armL:armL,armR:armR,step:footStep};
    if(isIn(name,['love','grateful','cry','sulky','shy','apology','touched','admiring','bittersweet','jealous','guilty','regretful','holding_tears','anxious','anticipating','nostalgic','awkward','longing','heartflutter','savoring','meditating','patient','asking','disagreeing'])){
      armL=-.13*p.wave+.1*p.wiggle;armR=.18*p.wave+.14*p.wiggle;
    }
    if(isIn(name,['sad','lonely','disappointed','frustrated','regretful','empathic','deep_sleep','tired','walk_sad'])){armL=.55*e+.08*p.wiggle;armR=-.52*e+.08*p.wiggle;}
    if(isIn(name,['moving','walk_joy','walk_angry','walk_sad'])){
      var stride=footStep;armL=.45*stride;armR=.45*stride;
      if(name==='walk_joy'){armL-=.3*e;armR+=.4*e;}
      if(name==='walk_angry'){armL=.17*stride+.3*e;armR=.17*stride-.25*e;}
      if(name==='walk_sad'){armL=.5*e+.12*stride;armR=-.5*e+.12*stride;}
    }
    if(name==='greeting'){armL=-.12*e;armR=e*(1.05+.35*Math.sin(a*TAU*1.6));}
    if(name==='feeding'){
      var phase=feedingPhase(a*1000),chewing=phase.phase==='chewing';
      if(phase.phase==='anticipation'||chewing){armL=-.25*e+(chewing ? .06*p.chew : 0);armR=.48*e+(chewing ? .1*p.chew : 0);}
    }
    if(name==='body_hands'){
      var left=pulse(a,.45,2.25),right=pulse(a,2.55,2.5);
      armL=-1.6*left*e;armR=1.6*right*e;headAngle=0;earL=0;earR=0;tail=0;footStep=0;
    }else if(name==='body_flap'){
      var flap=armFlapPhase(a);
      // The adult's paws begin across its chest; the baby's hang downward.
      // Rotate each real cutout from its own shoulder toward the outside,
      // then use one shared beat so both hands rise and fall together.
      armL=(nursery?1.18:-3.296)*flap.open+flap.flap;
      armR=(nursery?-.91:-2.266)*flap.open-flap.flap;footStep=0;
    }else if(name==='body_feet'){
      footStep=Math.sin(a*TAU*.85)*e;feetDemo=true;armL=0;armR=0;headAngle=0;earL=0;earR=0;tail=0;
    }else if(name==='body_ears'){
      earL=(-.8*pulse(a,.4,1.6)+.36*pulse(a,3.9,1.3))*e;
      earR=(.8*pulse(a,2.2,1.6)-.36*pulse(a,3.9,1.3))*e;
      armL=0;armR=0;headAngle=0;tail=0;footStep=0;
    }else if(name==='body_tail'){
      tail=.72*Math.sin(a*TAU*.72)*e;armL=0;armR=0;headAngle=0;earL=0;earR=0;footStep=0;
    }else if(name==='body_head'){
      headAngle=.19*Math.sin(a*TAU*.4)*e;armL=0;armR=0;earL=0;earR=0;tail=0;footStep=0;
    }
    // The underlying idle may already be waving when a cue arrives. Fade the
    // cue-specific limb routing too, rather than snapping those idle bones away.
    headAngle=base.head+(headAngle-base.head)*e;earL=base.earL+(earL-base.earL)*e;
    earR=base.earR+(earR-base.earR)*e;tail=base.tail+(tail-base.tail)*e;
    armL=base.armL+(armL-base.armL)*e;armR=base.armR+(armR-base.armR)*e;footStep=base.step+(footStep-base.step)*e;
    var lower=nursery?lowerBodyFrame(p,s,a,footStep):null;
    if(lower)footStep=lower.step;
    var bodyRoot=lower?multiply(posture,bone(point(.55,.79),-.4*lower.sway,lower.sway,lower.drop+lower.bend,1,1-lower.bend*.6)):posture;
    var flapDemo=name==='body_flap';
    var matrices={},angles={head:headAngle,ear_l:earL,ear_r:earR,tail:tail,
      arm_l:clamp(armL,flapDemo?-4.05:-1.7,flapDemo?1.9:1.1),arm_r:clamp(armR,flapDemo?-3.05:-1.1,1.7)};
    var headPivot=nursery?point(nurseryLandmarks.headPivot[0],nurseryLandmarks.headPivot[1]):point(.62,.675),head=socketMatrix(root,bodyRoot,headPivot,headAngle);
    parts.forEach(function(part){
      var pivot=point(part.pivot[0],part.pivot[1]),angle=angles[part.id]||0,local=bone(pivot,angle);
      if(part.id==='head')matrices[part.id]=head;
      else if(part.parent==='head')matrices[part.id]=multiply(head,local);
      else if(part.id==='foot_l'||part.id==='foot_r'){
        var side=part.id==='foot_l'?1:-1,lift=Math.max(0,side*footStep),footLandmark=nursery?(part.id==='foot_l'?nurseryFootLandmarks[0].left:nurseryFootLandmarks[0].right):null,sole=point(footLandmark?footLandmark.x:part.pivot[0],footLandmark?footLandmark.soleY:.92);
        local=lower?bone(point(part.pivot[0],.865),side*(.28*lift+lower.toeIn),-side*.020*lift,0,1-.12*lift,1-.15*lift):bone(pivot,side*.42*lift,side*.018*footStep,-.025*lift);
        var m=multiply(root,local),current=transform(m,sole),targetY=.92-flight*.055*amount-lift*(lower?lower.lift:feetDemo ? .035 : .025)*amount;
        m[5]+=targetY-current.y;matrices[part.id]=m;
      }else if(part.id==='arm_l'||part.id==='arm_r'||part.id==='tail')matrices[part.id]=socketMatrix(root,bodyRoot,pivot,angle,lowerBodyTorsoPoint(lower,part.pivot[0],part.pivot[1],pivot));
      else matrices[part.id]=multiply(bodyRoot,local);
    });
    // Fit only when an unusually tall combined gesture needs it. The correction
    // is shared by every bone and anchored at the floor, including planted feet.
    var bounds={minX:1,minY:1,maxX:0,maxY:0};
    parts.forEach(function(part){part.polygon.forEach(function(uv){var rest=point(uv[0],uv[1]);if(part.id==='torso')rest=lowerBodyTorsoPoint(lower,uv[0],uv[1],rest);var p=transform(matrices[part.id],rest);bounds.minX=Math.min(bounds.minX,p.x);bounds.minY=Math.min(bounds.minY,p.y);bounds.maxX=Math.max(bounds.maxX,p.x);bounds.maxY=Math.max(bounds.maxY,p.y);});});
    var fitScale=1;
    if(bounds.minY<.018)fitScale=Math.min(fitScale,(.92-.018)/(.92-bounds.minY));
    if(bounds.minX<.012)fitScale=Math.min(fitScale,(.5-.012)/(.5-bounds.minX));
    if(bounds.maxX>.988)fitScale=Math.min(fitScale,(.988-.5)/(bounds.maxX-.5));
    if(bounds.maxY>.96)fitScale=Math.min(fitScale,(.96-.92)/(bounds.maxY-.92));
    if(fitScale<1){var fit=bone({x:.5,y:.92},0,0,0,fitScale,fitScale);Object.keys(matrices).forEach(function(key){matrices[key]=multiply(fit,matrices[key]);});}
    var mouth=transform(matrices.head,nursery?point(nurseryLandmarks.mouth[0],nurseryLandmarks.mouth[1]-.010*p.chew):point(.628,.499-.010*p.chew));
    var result={situation:name,elapsedMs:age*1000,matrices:matrices,angles:angles,mouth:mouth,pose:p,fitScale:fitScale,flight:flight,eggOrigin:eggOriginProfile(eggOrigin).key};if(nursery){result.appearanceKey=appearance.key;result.lowerBody=lower;}return result;
  }
  function rigPose(seconds,situation,elapsedSeconds,stage,path,scale,appearanceKey,eggOrigin) {
    var age=Math.max(0,finite(elapsedSeconds,finite(seconds,0)));
    return rigFrame(pose(seconds,situation,age,stage,path),finite(seconds,0),age,stage,path,scale,appearanceKey,eggOrigin);
  }
  function rigPoint(frame,partId,x,y,stage,path,eggOrigin) {
    var matrix=frame&&frame.matrices&&frame.matrices[partId];eggOrigin=eggOrigin===undefined&&frame?frame.eggOrigin:eggOrigin;
    var point=frame&&frame.appearanceKey?appearancePoint(frame.appearanceKey,x,y,path,eggOrigin):growthPoint(stage,finite(x,.5),finite(y,.5),path,eggOrigin);
    if(partId==='torso')point=lowerBodyTorsoPoint(frame&&frame.lowerBody,x,y,point);
    return transform(matrix||identity(),point);
  }
  // Picking follows the triangles that were painted, then classifies their
  // source UV. It does not divide the canvas into fixed touch zones.
  function touchMesh(vertices,stride,start,count,x,y,accept) {
    for(var at=(start+count-3)*stride;at>=start*stride;at-=stride*3){
      var a=at,b=at+stride,c=at+stride*2,abx=vertices[b]-vertices[a],aby=vertices[b+1]-vertices[a+1],acx=vertices[c]-vertices[a],acy=vertices[c+1]-vertices[a+1];
      var det=abx*acy-aby*acx;if(Math.abs(det)<1e-12)continue;
      var dx=x-vertices[a],dy=y-vertices[a+1],wb=(dx*acy-dy*acx)/det,wc=(abx*dy-aby*dx)/det,wa=1-wb-wc;
      if(wa<-.000001||wb<-.000001||wc<-.000001)continue;
      var hit=accept({x:vertices[a+2]*wa+vertices[b+2]*wb+vertices[c+2]*wc,y:vertices[a+3]*wa+vertices[b+3]*wb+vertices[c+3]*wc,
        coverage:vertices[a+4]*wa+vertices[b+4]*wb+vertices[c+4]*wc,volume:stride===9?vertices[a+8]*wa+vertices[b+8]*wb+vertices[c+8]*wc:0});
      if(hit)return hit;
    }
    return null;
  }
  function touchFace(family,x,y) {
    var cheeks=family==='baby'?[[.342,.553,.105,.075],[.775,.521,.105,.075]]:[[.405,.55,.10,.075],[.80,.445,.085,.07]];
    for(var i=0;i<cheeks.length;i++){var c=cheeks[i];if(clothEllipse(x,y,c[0],c[1],c[2],c[3])>.5)return {part:'cheek',side:i?'right':'left'};}
    return {part:'head',side:null};
  }
  function touchDirection(index,x,y,appearanceKey) {
    var view=directionView(index,appearanceKey),family=appearanceProfile(appearanceKey).family;
    for(var i=0;i<4;i+=2)if(view.paws[i]>=0&&clothEllipse(x,y,view.paws[i],view.paws[i+1],Math.max(.035,view.torso[2]*.28),Math.max(.035,view.torso[3]*.40))>.5)
      return {part:'hand',side:i?'right':'left'};
    if(y>view.neckY+.012)return null;
    if(!view.index)return touchFace(family,x,y);
    for(var eye=0;eye<4;eye+=2)if(view.eyes[eye]>=0){
      var sign=view.eyes[eye]<view.headX?-1:1,rx=view.eyeRadii[eye],ry=view.eyeRadii[eye+1];
      if(clothEllipse(x,y,view.eyes[eye]+sign*Math.min(.10,rx*.7),view.eyes[eye+1]+ry*.96,rx*.80,ry*.65)>.5)
        return {part:'cheek',side:sign<0?'left':'right'};
    }
    return {part:'head',side:null};
  }
  function torsoMaterialPoint(x,y) { return {x:clamp(finite(x,.5),0,1),y:clamp(finite(y,.7),.7,1)}; }
  // Born B uses one continuous 3D arm from its shoulder to its fingertip.
  // The legacy mature drawing retains its separate chest-facing palm layout.
  var handVolumeProfiles=Object.freeze({
    mature:Object.freeze({
      arm_l:Object.freeze({center:Object.freeze([.533,.748]),major:.117,minor:.070,depth:.058,angle:-.28,shoulder:Object.freeze([.374,.705]),proximal:.104}),
      arm_r:Object.freeze({center:Object.freeze([.748,.737]),major:.078,minor:.055,depth:.046,angle:.65,shoulder:Object.freeze([.794,.650]),proximal:.090})
    }),
    baby:Object.freeze({
      arm_l:Object.freeze({center:Object.freeze([.372,.773]),major:.040,minor:.034,depth:.029,angle:1.93,shoulder:Object.freeze([.411,.666]),proximal:.093}),
      arm_r:Object.freeze({center:Object.freeze([.752,.780]),major:.040,minor:.033,depth:.029,angle:1.02,shoulder:Object.freeze([.675,.659]),proximal:.112})
    })
  });
  function handWristTwist(rig,seconds,age,side) {
    var p=rig.pose,name=p.situation,e=p.presence,sign=side==='arm_l'?1:-1;
    var yaw=.075*Math.sin(seconds*1.1+(sign>0?0:1.8))+.35*p.pawSpread+.20*p.wiggle;
    if(name==='body_hands')yaw=sign*(.35+1.85*Math.sin(age*TAU*.7))*pulse(age,sign>0?.45:2.55,sign>0?2.25:2.5)*e;
    else if(name==='body_flap'){var flap=armFlapPhase(age);yaw=sign*(.45+1.65*Math.sin((age-.9)*TAU*.925))*flap.open*e;}
    else if(name==='body_joy'||name==='joy'||name==='celebrate'||name==='dance')yaw+=sign*1.45*Math.sin(age*TAU*.65)*e;
    else if(name==='feeding')yaw=sign*(age<4.4?.72+.20*p.chew:1.35*Math.sin((age-4.4)*TAU*.65))*e;
    return clamp(yaw,-2.25,2.25);
  }
  function handVolumeState(rig,seconds,age,stage,path,appearanceKey,eggOrigin) {
    return {rig:rig,seconds:seconds,age:age,stage:stage,path:path,appearanceKey:appearanceKey,
      family:appearanceProfile(appearanceKey).family,eggOrigin:eggOriginProfile(eggOrigin).key,twists:{arm_l:handWristTwist(rig,seconds,age,'arm_l'),arm_r:handWristTwist(rig,seconds,age,'arm_r')}};
  }
  function handVolumeFrame(seconds,situation,elapsedSeconds,stage,path,scale,appearanceKey,eggOrigin) {
    var s=Math.max(0,finite(seconds,0)),age=Math.max(0,finite(elapsedSeconds,s));
    return handVolumeState(rigPose(s,situation,age,stage,path,scale,appearanceKey,eggOrigin),s,age,stage,path,appearanceKey,eggOrigin);
  }
  var handVolumeRows=20,handVolumeColumns=24,handVolumeMaxFloats=(handVolumeRows*handVolumeColumns*6+12000)*9;
  var handSphereTemplate=(function(){var data=new Float64Array((handVolumeRows+1)*handVolumeColumns*4),i=0;for(var row=0;row<=handVolumeRows;row++){var along=2*row/handVolumeRows-1,radius=Math.sqrt(Math.max(0,1-along*along));for(var col=0;col<handVolumeColumns;col++){var theta=col/handVolumeColumns*TAU;data[i++]=along;data[i++]=radius;data[i++]=Math.cos(theta);data[i++]=Math.sin(theta);}}return data;}());
  function handProximalCoverage(profile,x,y){var dx=profile.center[0]-profile.shoulder[0],dy=profile.center[1]-profile.shoulder[1],length=Math.hypot(dx,dy),along=((x-profile.shoulder[0])*dx+(y-profile.shoulder[1])*dy)/length;return (1-smooth((Math.hypot(x-profile.shoulder[0],y-profile.shoulder[1])-profile.proximal+.012)/.022))*smooth((along+.025)/.013);}
  function handUpperShader(family){var left=handVolumeProfiles[family].arm_l,right=handVolumeProfiles[family].arm_r;return 'float handUpperMask(vec2 p){vec2 shoulder=v_part<7.5?vec2('+left.shoulder.join(',')+'):vec2('+right.shoulder.join(',')+');vec2 center=v_part<7.5?vec2('+left.center.join(',')+'):vec2('+right.center.join(',')+');float radius=v_part<7.5?'+left.proximal+':'+right.proximal+';float along=dot(p-shoulder,normalize(center-shoulder));return (1.-smoothstep(radius-.012,radius+.010,length(p-shoulder)))*smoothstep(-.025,-.012,along);}';}
  function handVolumeMesh(frame,side,target) {
    if(!frame||!frame.rig||frame.family==='egg'||(side!=='arm_l'&&side!=='arm_r'))return new Float32Array(0);
    var profile=handVolumeProfiles[frame.family==='baby'?'baby':'mature'][side],m=frame.rig.matrices[side],twist=frame.twists[side];
    if(frame.family==='baby'){
      // Preserve the measured fingertip and socket. Extending the same convex
      // surface through the forearm removes the dangling flat crop behind it.
      var dx=profile.center[0]-profile.shoulder[0],dy=profile.center[1]-profile.shoulder[1],length=Math.hypot(dx,dy);
      // The two half-ellipsoids share their widest ring at the original palm.
      // Only the shoulder half extends; fingertip, palm width and UVs stay put.
      profile={center:profile.center,major:profile.major,proximalMajor:length+.012,minor:profile.minor,depth:profile.depth,angle:Math.atan2(dy,dx)};
    }
    var rows=handVolumeRows,columns=handVolumeColumns,grid=frame.scratch||new Float64Array((rows+1)*columns*10),out=target||new Float32Array(handVolumeMaxFloats),cursor=0;
    var source=frame.family==='baby'?null:frame.sourceMeshes&&frame.sourceMeshes[side];
    if(frame.family!=='baby'&&!source)source=rigMesh(rigParts[side==='arm_l'?7:8],frame.stage,frame.path,frame.appearanceKey,frame.eggOrigin);
    // Only the legacy chest-facing hand keeps a proximal image. Born B never
    // emits this second flat layer, including while waving or turning its wrist.
    if(source)
    for(var i=0;i<source.length;i+=15){
      var w0=source[i+4]*handProximalCoverage(profile,source[i+2],source[i+3]),w1=source[i+9]*handProximalCoverage(profile,source[i+7],source[i+8]),w2=source[i+14]*handProximalCoverage(profile,source[i+12],source[i+13]);
      if(Math.max(w0,w1,w2)<=0)continue;
      for(var k=0;k<3;k++){var at=i+k*5,x,y;if(frame.projected){var base=frame.starts[side]+at;x=frame.projected[base];y=frame.projected[base+1];}else{x=(m[0]*source[at]+m[2]*source[at+1]+m[4])*2-1;y=1-(m[1]*source[at]+m[3]*source[at+1]+m[5])*2;}
        out[cursor++]=x;out[cursor++]=y;out[cursor++]=source[at+2];out[cursor++]=source[at+3];out[cursor++]=k===0?w0:k===1?w1:w2;out[cursor++]=0;out[cursor++]=0;out[cursor++]=1;out[cursor++]=0;}
    }
    var ax=Math.cos(profile.angle),ay=Math.sin(profile.angle),nx=-ay,ny=ax,co=Math.cos(twist),si=Math.sin(twist),det=m[0]*m[3]-m[1]*m[2],depthScale=Math.sqrt(Math.abs(det));
    for(var n=0;n<handSphereTemplate.length/4;n++){
      var offset=n*4,g=n*10,along=handSphereTemplate[offset],radius=handSphereTemplate[offset+1],cos=handSphereTemplate[offset+2],sin=handSphereTemplate[offset+3];
      var halfMajor=along<0&&profile.proximalMajor?profile.proximalMajor:profile.major;
      var a=profile.minor*radius*cos,b=profile.depth*radius*sin,cross=a*co-b*si,x=profile.center[0]+ax*halfMajor*along+nx*cross,y=profile.center[1]+ay*halfMajor*along+ny*cross;
      var point=frame.family==='baby'?appearancePoint(frame.appearanceKey,x,y,frame.path,frame.eggOrigin):growthPoint(frame.stage,x,y,frame.path,frame.eggOrigin);
      grid[g]=m[0]*point.x+m[2]*point.y+m[4];grid[g+1]=m[1]*point.x+m[3]*point.y+m[5];grid[g+2]=(a*si+b*co)*depthScale;
      grid[g+3]=profile.center[0]+ax*halfMajor*along+nx*a;grid[g+4]=profile.center[1]+ay*halfMajor*along+ny*a;grid[g+5]=1-smooth((sin+.15)/.3);
      var na=along/halfMajor,nn=radius*cos/profile.minor,nz=radius*sin/profile.depth,nCross=nn*co-nz*si,localX=ax*na+nx*nCross,localY=ay*na+ny*nCross;
      var wx=(m[3]*localX-m[1]*localY)/det,wy=(-m[2]*localX+m[0]*localY)/det,wz=(nn*si+nz*co)/depthScale,length=Math.hypot(wx,wy,wz);
      grid[g+6]=wx/length;grid[g+7]=wy/length;grid[g+8]=Math.abs(wz/length);grid[g+9]=smooth(wz/length/.09);
    }
    function vertex(g){out[cursor++]=grid[g]*2-1;out[cursor++]=1-grid[g+1]*2;out[cursor++]=grid[g+3];out[cursor++]=grid[g+4];out[cursor++]=grid[g+9];out[cursor++]=grid[g+6];out[cursor++]=grid[g+7];out[cursor++]=grid[g+8];out[cursor++]=1+grid[g+5];}
    function triangle(a,b,c){var face=(grid[b]-grid[a])*(grid[c+1]-grid[a+1])-(grid[b+1]-grid[a+1])*(grid[c]-grid[a]);if(face<=1e-12)return;vertex(a);vertex(b);vertex(c);}
    for(var rr=0;rr<rows;rr++)for(var cc=0;cc<columns;cc++){var a=(rr*columns+cc)*10,b=((rr+1)*columns+cc)*10,c=(rr*columns+(cc+1)%columns)*10,d=((rr+1)*columns+(cc+1)%columns)*10;triangle(a,c,b);triangle(c,d,b);}
    if(cursor>out.length)throw new RangeError('hand_mesh_capacity');
    return out.subarray(0,cursor);
  }
  function rigMesh(part,stage,path,appearanceKey,eggOrigin) {
    function point(x,y){return appearanceProfile(appearanceKey).family==='baby'?appearancePoint(appearanceKey,x,y,path,eggOrigin):growthPoint(stage,x,y,path,eggOrigin);}
    var poly=part.polygon.map(function(v){return {x:v[0],y:v[1]};}),area=0,cx=0,cy=0;
    poly.forEach(function(v,i){var next=poly[(i+1)%poly.length];area+=v.x*next.y-next.x*v.y;cx+=v.x;cy+=v.y;});
    if(area>0)poly.reverse();cx/=poly.length;cy/=poly.length;
    function cross(a,b,c){return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);}
    function inset(v,amount){var dx=cx-v.x,dy=cy-v.y,l=Math.hypot(dx,dy)||1;return {x:v.x+dx*amount/l,y:v.y+dy*amount/l};}
    var inner=poly.map(function(v){return inset(v,.0008);}),outer=poly.map(function(v){return inset(v,-.0008);}),indices=inner.map(function(_,i){return i;}),vertices=[];
    function add(a,b,c,aa,ba,ca,depth){
      if(cross(a,b,c)>0){var swap=b;b=c;c=swap;swap=ba;ba=ca;ca=swap;}
      var abLength=Math.hypot(a.x-b.x,a.y-b.y),acLength=Math.hypot(a.x-c.x,a.y-c.y),bcLength=Math.hypot(b.x-c.x,b.y-c.y),length=Math.max(abLength,acLength,bcLength);
      var grown=[point(a.x,a.y),point(b.x,b.y),point(c.x,c.y)];
      // Long thin triangles may cross a curved growth field even when that
      // field is unfolded. Refine those until their straight edges agree.
      if(depth<14&&(length>.065||cross(grown[0],grown[1],grown[2])>=0)){
        if(abLength===length){var ab={x:(a.x+b.x)/2,y:(a.y+b.y)/2};add(a,ab,c,aa,(aa+ba)/2,ca,depth+1);add(ab,b,c,(aa+ba)/2,ba,ca,depth+1);}
        else if(acLength===length){var ac={x:(a.x+c.x)/2,y:(a.y+c.y)/2};add(a,b,ac,aa,ba,(aa+ca)/2,depth+1);add(ac,b,c,(aa+ca)/2,ba,ca,depth+1);}
        else{var bc={x:(b.x+c.x)/2,y:(b.y+c.y)/2};add(a,b,bc,aa,ba,(ba+ca)/2,depth+1);add(a,bc,c,aa,(ba+ca)/2,ca,depth+1);}return;
      }
      [a,b,c].forEach(function(v,i){var point=grown[i];vertices.push(point.x,point.y,v.x,v.y,[aa,ba,ca][i]);});
    }
    var attempts=0;
    while(indices.length>3&&attempts++<poly.length*poly.length){
      var found=false;
      for(var i=0;i<indices.length;i++){
        var ai=indices[(i+indices.length-1)%indices.length],bi=indices[i],ci=indices[(i+1)%indices.length],a=inner[ai],b=inner[bi],c=inner[ci];
        if(cross(a,b,c)>=-.00000001)continue;
        var contains=indices.some(function(j){var v=inner[j];return j!==ai&&j!==bi&&j!==ci&&cross(a,b,v)<=0&&cross(b,c,v)<=0&&cross(c,a,v)<=0;});
        if(contains)continue;add(a,b,c,1,1,1,0);indices.splice(i,1);found=true;break;
      }
      if(!found)throw new Error('rig_polygon');
    }
    if(indices.length===3)add(inner[indices[0]],inner[indices[1]],inner[indices[2]],1,1,1,0);
    poly.forEach(function(_,i){var next=(i+1)%poly.length;add(outer[i],outer[next],inner[i],0,0,1,0);add(inner[i],outer[next],inner[next],1,0,1,0);});
    return new Float32Array(vertices);
  }
  function growth(exp) { return exp >= 110 ? 3 : exp >= 45 ? 2 : exp >= 15 ? 1 : 0; }
  // Returning null is deliberate: rejected/unconfirmed saves must not look successful.
  function situationForAction(action, before, after, result) {
    if (!result || result.ok !== true || !action || typeof action.type !== 'string') return null;
    var name = null;
    if ((action.type === 'care' && action.kind === 'feed') || action.type === 'useItem') name = 'feeding';
    else if (before && before.pet && after && after.pet &&
        growth(finite(after.pet.exp, 0)) > growth(finite(before.pet.exp, 0))) name = 'joy';
    else if (action.type === 'care') name = action.kind === 'play' ? 'petted' : action.kind === 'rest' ? 'resting' : null;
    else if (action.type === 'finishMinigame' && action.score > 0) name = 'caught';
    else if (action.type === 'chooseSpecies' || action.type === 'rename') name = 'greeting';
    else if (['buyItem', 'equip', 'equipClothing', 'chooseAppearance', 'transferLegacy'].indexOf(action.type) >= 0) name = 'joy';
    else if (action.type === 'advanceMarketDay' && result.reward && result.reward.dividend > 0) name = 'joy';
    return name ? { situation: name, durationMs: durations[name] } : null;
  }

  var clothingShader = [
    'float ce(vec2 p,vec2 c,vec2 r){return 1.-smoothstep(.96,1.02,length((p-c)/r));}',
    'float cl(vec2 p,vec2 a,vec2 b,float w){vec2 v=b-a;float t=clamp(dot(p-a,v)/dot(v,v),0.,1.);return 1.-smoothstep(w,w+.003,length(p-a-v*t));}',
    'float cb(vec2 p,vec2 c,vec2 h,float r){vec2 q=abs(p-c)-h+vec2(r);float d=length(max(q,vec2(0.)))+min(max(q.x,q.y),0.)-r;return 1.-smoothstep(-.002,.002,d);}',
    'float cs(vec2 p,vec2 c,float size){vec2 q=(p-c)/size;float angle=atan(q.y+.000001,q.x+.000001);float edge=.46+.24*cos(5.*angle);return 1.-smoothstep(edge-.04,edge+.04,length(q));}',
    'float cf(vec2 p,vec2 c){float petals=0.;for(int i=0;i<5;i++){float a=float(i)*6.2831853/5.;vec2 offset=vec2(cos(a),sin(a))*.010;petals=max(petals,ce(p,c+offset,vec2(.0075)));}return petals;}',
    'float clothingMask(vec2 p,float kind){',
    'float mask=ce(p,vec2('+clothBounds.x+','+clothBounds.y+'),vec2('+clothBounds.rx+','+clothBounds.ry+'))*smoothstep('+clothBounds.top+','+(clothBounds.top+.008)+',p.y)*(1.-smoothstep('+(clothBounds.hem-.006)+','+clothBounds.hem+',p.y));',
    'float paws=max(ce(p,vec2('+clothBounds.pawLX+','+clothBounds.pawLY+'),vec2('+clothBounds.pawLRX+','+clothBounds.pawLRY+')),ce(p,vec2('+clothBounds.pawRX+','+clothBounds.pawRY+'),vec2('+clothBounds.pawRRX+','+clothBounds.pawRRY+')));if(v_part<.5||(v_part>1.5&&v_part<9.5))mask*=1.-paws;',
    'bool backView=v_part>9.5&&u_motionA.z>.5;if(kind<1.5){float neck=(!backView?1.:0.)*(1.-smoothstep(.005,.012,abs(p.x-.58)-max(0.,.755-p.y)*1.05));mask*=1.-neck;}',
    'else if(kind<2.5){float opening=(!backView?1.:0.)*(1.-smoothstep(.0,.008,abs(p.x-.58)-max(0.,p.y-.70)*.52-.018));mask*=1.-opening;mask*=1.-smoothstep(.866+.006*cos((p.x-.28)*6.2831853*9.),.874+.006*cos((p.x-.28)*6.2831853*9.),p.y);}',
    'else if(kind<3.5){float straps=max(cl(p,vec2(.375,.69),vec2(.455,.81),.014),cl(p,vec2(.735,.69),vec2(.69,.81),.014));float bib=smoothstep(.77,.778,p.y)*(1.-smoothstep(.145,.155,abs(p.x-.58)));mask*=max(straps,bib);}',
    'else if(kind<5.5){mask*=1.-ce(p,vec2(.58,.69),vec2(.079,.025));}',
    'else{float shoulder=max(cl(p,vec2(.38,.69),vec2(.44,.78),.017),cl(p,vec2(.738,.69),vec2(.69,.78),.017));float width=.132+max(0.,p.y-.766)*.65;float skirt=smoothstep(.756,.766,p.y)*(1.-smoothstep(width,width+.008,abs(p.x-.56)));mask*=max(shoulder,skirt);}',
    'return clamp(mask,0.,1.);}',
    'vec4 clothing(vec2 p,vec3 original,float kind){',
    'bool backView=v_part>9.5&&u_motionA.z>.5;',
    'if(p.x<.26||p.x>.79||p.y<.688||p.y>.891)return vec4(0.);',
    'float mask=clothingMask(p,kind);if(mask<=0.)return vec4(0.);vec3 base='+vecColor(outfitCatalogue[0].color)+';vec3 trim='+vecColor(outfitCatalogue[0].trim)+';',
    outfitCatalogue.slice(1).map(function(entry){return 'if(kind>'+((entry.index-.5).toFixed(1))+'&&kind<'+((entry.index+.5).toFixed(1))+'){base='+vecColor(entry.color)+';trim='+vecColor(entry.trim)+';}';}).join(''),
    'float light=.85+.15*dot(original,vec3(.299,.587,.114));float weave=.006*sin(p.y*240.)*sin(p.x*190.);vec3 cloth=base*(light+weave);float seam=0.;',
    'if(kind<1.5){',
    'seam=max(cl(p,vec2(.405,.72),vec2(.43,.86),.0035),cl(p,vec2(.724,.725),vec2(.714,.858),.0035));',
    'seam=max(seam,cl(p,vec2(.579,.785),vec2(.579,.878),.0032));seam=max(seam,cl(p,vec2(.32,.87),vec2(.735,.87),.0035));',
    'float lapel=max(cb(p,vec2(.365,.728),vec2(.021,.032),.004),cb(p,vec2(.748,.727),vec2(.018,.029),.004));cloth=mix(cloth,base*.90,lapel*.35*(backView?0.:1.));',
    'float buttons=max(ce(p,vec2(.592,.841),vec2(.006)),ce(p,vec2(.592,.867),vec2(.006)));cloth=mix(cloth,trim,buttons*.75*(backView?0.:1.));',
    '}else if(kind<2.5){',
    'seam=max(cl(p,vec2(.54,.70),vec2(.465,.865),.004),cl(p,vec2(.62,.70),vec2(.71,.865),.004));',
    'float hem=cl(p,vec2(.295,.856),vec2(.44,.867),.0035)+cl(p,vec2(.72,.866),vec2(.773,.84),.0035);seam=max(seam,hem);',
    'float tie=max(ce(p,vec2(.372,.727),vec2(.016,.009)),ce(p,vec2(.399,.733),vec2(.016,.009)));cloth=mix(cloth,vec3(.96,.83,.83),tie*.9*(backView?0.:1.));',
    '}else if(kind<3.5){',
    'seam=max(cl(p,vec2(.578,.827),vec2(.578,.882),.003),cl(p,vec2(.438,.88),vec2(.72,.88),.0035));',
    'float pocket=(backView?0.:1.)*cb(p,vec2(.583,.846),vec2(.05,.023),.008);float pocketIn=cb(p,vec2(.583,.844),vec2(.044,.017),.006);seam=max(seam,pocket*(1.-pocketIn));',
    'seam=max(seam,cl(p,vec2(.371,.697),vec2(.447,.806),.0028));float buttons=max(ce(p,vec2(.448,.801),vec2(.006)),ce(p,vec2(.69,.801),vec2(.006)));cloth=mix(cloth,vec3(.94,.85,.63),buttons*.8*(backView?0.:1.));',
    '}else if(kind<4.5){',
    'float ribs=.5+.5*sin(p.x*6.2831853*24.);cloth*=.97+.035*ribs;',
    'seam=max(cl(p,vec2(.315,.866),vec2(.741,.866),.003),cl(p,vec2(.332,.843),vec2(.337,.878),.003));',
    'float cable=cl(p,vec2(.346,.77),vec2(.367,.80),.0032)+cl(p,vec2(.367,.80),vec2(.346,.83),.0032)+cl(p,vec2(.346,.83),vec2(.367,.86),.0032);seam=max(seam,cable*.7);',
    '}else if(kind<5.5){',
    'float stars=max(max(cs(p,vec2(.337,.797),.029),cs(p,vec2(.407,.858),.025)),max(cs(p,vec2(.657,.859),.027),cs(p,vec2(.751,.817),.022)));cloth=mix(cloth,vec3(.97,.91,.73),stars*.9);',
    'seam=max(cl(p,vec2(.578,.745),vec2(.578,.88),.0035),cl(p,vec2(.32,.875),vec2(.745,.875),.0035));float buttons=max(ce(p,vec2(.59,.838),vec2(.0045)),ce(p,vec2(.59,.866),vec2(.0045)));cloth=mix(cloth,vec3(.94,.9,.84),buttons*.95*(backView?0.:1.));',
    '}else{',
    'float flowers=max(cf(p,vec2(.352,.813)),max(cf(p,vec2(.454,.862)),cf(p,vec2(.692,.846))));cloth=mix(cloth,vec3(.99,.95,.87),flowers*.95);',
    'float centers=max(ce(p,vec2(.352,.813),vec2(.0045)),max(ce(p,vec2(.454,.862),vec2(.0045)),ce(p,vec2(.692,.846),vec2(.0045))));cloth=mix(cloth,vec3(.87,.66,.29),centers*.9);',
    'seam=max(cl(p,vec2(.33,.877),vec2(.73,.877),.0035),cl(p,vec2(.406,.804),vec2(.731,.804),.004));',
    '}',
    'cloth=mix(cloth,trim,clamp(seam,0.,1.)*.48);return vec4(cloth,mask);}'
  ].join('\n');
  var evolutionShader = [
    'float furSelect(vec3 c){return smoothstep(.012,.045,min(c.r,c.b)-c.g)*(1.-smoothstep(.16,.26,c.r-c.b));}',
    'vec3 evolvedFur(vec2 p,vec3 original,vec3 painted){if(v_evolution.a<.5)return painted;',
    'float features=max(max(ce(p,vec2(.4665,.429),vec2(.16,.145)),ce(p,vec2(.7281,.3405),vec2(.137,.14))),ce(p,vec2(.625,.48),vec2(.105,.095)));',
    'float amount=furSelect(original)*furSelect(painted)*(1.-features)*.92;',
    'float lum=dot(painted,vec3(.299,.587,.114));float targetLum=max(.2,dot(v_evolution.rgb,vec3(.299,.587,.114)));',
    'vec3 tinted=clamp(v_evolution.rgb*lum/targetLum,vec3(0.),vec3(1.));return mix(painted,tinted,amount);}'
  ].join('\n');
  // A turn borrows the same eight vectors after the frontal pass. No frontal
  // eye, mouth, tear or alpha coordinates are applied to a side/back cell.
  var turnShader=[
    'vec4 turnImage(vec2 p){float index=floor(v_part-10.+.1);vec4 source;',
    'if(index<.5){source=vec4(texture2D(u_original,p).rgb,texture2D(u_alpha,p).a);}',
    'else{vec2 safe=clamp(p,u_detail.xy,vec2(1.)-u_detail.xy);vec2 tile=vec2(mod(index,4.),floor(index/4.));source=texture2D(u_sad,(tile+safe)/4.);}',
    'if(source.a<.01)return vec4(0.);vec3 color=source.rgb;vec3 tooth;',
    'if(index<.5)tooth=texture2D(u_angry,p).rgb;else{vec2 safe=clamp(p,u_detail.xy,vec2(1.)-u_detail.xy);vec2 tile=vec2(mod(index,4.),floor(index/4.));tooth=texture2D(u_angry,(tile+safe)/4.).rgb;}',
    'float toothMask=index<.5?toothPatch(p):ce(p,u_motionC.xy+vec2(0.,u_motionC.w*.18),u_motionC.zw*vec2(.85,.65))*step(-1.,u_motionC.x);color=mix(color,tooth,toothMask);',
    'float eyes=max(ce(p,u_motionB.xy,u_face.xy),ce(p,u_motionB.zw,u_face.zw));float mouth=ce(p,u_motionC.xy,u_motionC.zw);',
    'if(v_evolution.a>.5){float amount=furSelect(color)*(1.-max(eyes,mouth))*.92;float lum=dot(color,vec3(.299,.587,.114));float targetLum=max(.2,dot(v_evolution.rgb,vec3(.299,.587,.114)));vec3 target=clamp(v_evolution.rgb*lum/targetLum,vec3(0.),vec3(1.));color=mix(color,target,amount);}',
    'if(u_motionA.w>.5){vec2 q=vec2(.525+(p.x-u_body.x+u_detail.z*(p.y-u_body.y))*.258/u_body.z,.79+(p.y-u_body.y)*.125/u_body.w);',
    'vec4 garment=clothing(q,source.rgb,u_motionA.w);float paws=max(ce(p,u_gesture.xy,vec2(u_body.z*.58,u_body.w*.72)),ce(p,u_gesture.zw,vec2(u_body.z*.48,u_body.w*.68)));',
    'float tail=u_effect.x>=0.?ce(p,u_effect.xy,u_effect.zw):0.;color=mix(color,garment.rgb,garment.a*(1.-max(paws,tail)));}',
    'float a=source.a*u_motionA.x*v_coverage;return vec4(color*a,a);}'
  ].join('\n');
  var vertexSource = 'attribute vec2 a_position; attribute vec2 a_uv; attribute vec4 a_evolution; attribute float a_coverage; attribute float a_part; attribute float a_mouthMode; attribute vec4 a_handVolume; varying vec2 v_uv; varying vec4 v_evolution; varying float v_coverage; varying float v_part; varying float v_mouthMode; varying vec4 v_handVolume; void main(){v_uv=a_uv;v_evolution=a_evolution;v_coverage=a_coverage;v_part=a_part;v_mouthMode=a_mouthMode;v_handVolume=a_handVolume;gl_Position=vec4(a_position,0.,1.);}';
  var fragmentSource = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH', 'precision highp float;', '#else', 'precision mediump float;', '#endif',
    'varying vec2 v_uv; varying vec4 v_evolution; varying float v_coverage; varying float v_part; varying float v_mouthMode; varying vec4 v_handVolume; uniform sampler2D u_original,u_half,u_closed,u_alpha,u_sad,u_angry,u_surprise,u_delighted;',
    'uniform vec4 u_motionA,u_motionB,u_motionC,u_body,u_gesture,u_face,u_effect,u_detail;',
    '#define u_breath u_motionA.x', '#define u_tilt u_motionA.y', '#define u_ear u_motionA.z', '#define u_tail u_motionA.w',
    '#define u_wave u_motionB.x', '#define u_wiggle u_motionB.y', '#define u_blink u_motionB.z', '#define u_chew u_motionB.w',
    '#define u_bounce u_motionC.x', '#define u_step u_motionC.y', '#define u_scale u_motionC.z', '#define u_presence u_motionC.w',
    '#define u_bodyAngle u_body.x', '#define u_shiftX u_body.y', '#define u_shiftY u_body.z', '#define u_squash u_body.w',
    '#define u_stretch u_gesture.x', '#define u_crouch u_gesture.y', '#define u_pawSpread u_gesture.z', '#define u_mouthOpen u_gesture.w',
    '#define u_tear u_effect.x', '#define u_blush u_effect.y', '#define u_sweat u_effect.z', '#define u_anger mod(u_effect.w,2.)', '#define u_outfit floor(u_effect.w/2.)',
    '#define u_eyeNarrow u_detail.x', '#define u_look u_detail.yz', '#define u_phase u_detail.w',
    'float region(vec2 p,vec2 c,vec2 r){vec2 q=(p-c)/r;return exp(-dot(q,q)*2.);}',
    'mat2 rotation(float a){return mat2(cos(a),-sin(a),sin(a),cos(a));}',
    'float eyeMask(vec2 p,vec2 c,vec2 r){return 1.-smoothstep(.85,1.1,length(rotation(.28)*(p-c)/r));}',
    'float droplet(vec2 p,vec2 c,vec2 r){vec2 q=(p-c)/r;return 1.-smoothstep(.75,1.05,dot(q,q));}',
    clothingShader, evolutionShader,faceMaterialShader,handUpperShader('mature'),
    'vec3 handMaterial(vec2 p,vec3 source){vec2 seed=v_part<7.5?vec2(.530,.750):vec2(.760,.735);vec3 back=texture2D(u_original,seed+(p-seed)*.14).rgb;vec3 front=mix(back,source,furSelect(source));return mix(front,back,clamp(v_handVolume.w-1.,0.,1.)*.8);}',
    'float toothPatch(vec2 p){return ce(p,vec2(.628,.511),vec2(.10,.067))*smoothstep(.455,.463,p.y);}',
    turnShader,
    'void main(){if(v_part>9.5){gl_FragColor=turnImage(v_uv);return;}vec2 p=v_uv;float headPart=1.-step(.1,abs(v_part-6.));float torsoPart=1.-step(.1,abs(v_part-1.));float volume=step(.5,v_handVolume.w);vec3 handNormal=v_handVolume.xyz/max(.001,length(v_handVolume.xyz));',
    'float mouth=region(p,vec2(.628,.499),vec2(.080,.055))*headPart;p.y+=u_chew*.010*mouth;',
    'p.y+=(p.y-.499)*u_mouthOpen*.22*mouth;',
    // Negative narrowing is a one-eye glance with a crooked mouth, rather than
    // stretching both eyes open. The original positive range is unchanged.
    'float oneEye=max(0.,-u_eyeNarrow);float squint=max(0.,u_eyeNarrow);',
    'p.y+=oneEye*(p.x-.628)*.25*mouth;',
    // Values above the original squint range add a small nose/mouth scrunch.
    'float scrunch=max(0.,squint-1.);float nose=region(p,vec2(.621,.453),vec2(.07,.045));',
    'p.x+=(p.x-.621)*scrunch*.24*nose;p.y+=scrunch*.008*nose;',
    'float eyeL=eyeMask(p,vec2(.4665,.429),vec2(.135,.125));float eyeR=eyeMask(p,vec2(.7281,.3405),vec2(.115,.12));eyeL*=headPart;eyeR*=headPart;',
    'p.y+=.35*((p.y-.429)*(squint+oneEye)*eyeL+(p.y-.3405)*squint*eyeR);',
    'float iris=region(p,vec2(.4665,.429),vec2(.052,.059))+region(p,vec2(.7281,.3405),vec2(.045,.065));',
    'p-=u_look*iris*(1.-u_blink);vec2 uv=clamp(p,vec2(.0001),vec2(.9999));',
    eyePaintShader('mature'),
    'float face=1.-smoothstep(.82,1.08,length(rotation(.28)*(p-vec2(.60,.415))/vec2(.255,.215)))*headPart;',
    'vec3 original=texture2D(u_original,uv).rgb;',
    'if(volume>.5)original=handMaterial(uv,original);',
    // Only the area hidden by the old arms uses generated material. The original
    // head, fur outside that patch and all source cutout alpha remain unchanged.
    'if(torsoPart>.5){float patch=max(ce(p,vec2(.518,.742),vec2(.215,.137)),ce(p,vec2(.742,.716),vec2(.14,.136)));patch=max(patch,1.-smoothstep(.695,.708,p.y));vec2 plateUV=vec2(uv.x,max(.7,uv.y));original=mix(original,texture2D(u_sad,plateUV).rgb,patch);',
    'float toes=smoothstep(.874,.89,p.y)*max(ce(p,vec2(.414,.907),vec2(.09,.035)),ce(p,vec2(.692,.897),vec2(.065,.035)));vec3 under=texture2D(u_original,vec2(uv.x,min(uv.y,.872))).rgb;original=mix(original,under,toes);}',
    'vec3 rgb=original;',
    // Pose scores select one face, not a permanent opacity. A held expression must
    // replace the old eyes completely at a closed blink; body easing is separate.
    'vec3 expression=rgb;float strongest=0.;float delighted=0.;float toothCell=0.;',
    'if(headPart>.5&&u_face.x>strongest){strongest=u_face.x;expression=texture2D(u_sad,uv).rgb;toothCell=3.;}',
    'if(headPart>.5&&u_face.y>strongest){strongest=u_face.y;expression=texture2D(u_sad,uv).rgb;toothCell=4.;}',
    'if(headPart>.5&&u_face.z>strongest){strongest=u_face.z;expression=texture2D(u_sad,uv).rgb;toothCell=5.;}',
    'if(headPart>.5&&u_face.w>strongest){strongest=u_face.w;expression=texture2D(u_sad,uv).rgb;toothCell=6.;delighted=1.;}',
    'float weight=strongest>0.?faceWeight(u_presence):0.;rgb=mix(rgb,expression,face*weight);',
    // Delighted already has closed eyes. Neutral half-open blink frames would
    // paint the old pupils over that expression and create ghost eyes.
    'float handover=strongest>0.||v_mouthMode>.5?faceHandover(u_presence):0.;float blink=max(u_blink,handover)*(1.-delighted*weight);',
    'float lid=blinkFrame(blink);if(lid>.5){vec4 blinkDonor;if(lid>1.5)blinkDonor=texture2D(u_closed,uv);else blinkDonor=texture2D(u_half,uv);rgb=mix(rgb,blinkDonor.rgb,eyePaintMask*faceDonorOpacity(blinkDonor.a));}',
    'if(headPart>.5){vec3 toothBase=texture2D(u_angry,uv).rgb;vec3 toothExpression=texture2D(u_surprise,uv).rgb;vec3 tooth=mix(toothBase,toothExpression,v_mouthMode>.5?faceWeight(u_presence):weight);rgb=mix(rgb,tooth,toothPatch(uv));}',
    'rgb=evolvedFur(p,original,rgb);',
    'if(volume>.5){float diffuse=max(0.,dot(handNormal,normalize(vec3(-.35,-.60,.72))));rgb*=.90+.12*diffuse;rgb+=vec3(.012,.0108,.0084)*max(0.,handNormal.y);}',
    'float blush=region(p,vec2(.405,.55),vec2(.062,.04))+region(p,vec2(.80,.445),vec2(.047,.037));',
    'rgb=mix(rgb,vec3(.99,.48,.67),clamp(blush*u_blush*.25,0.,.3));',
    'float fall=fract(u_phase*.85);float tears=max(droplet(p,vec2(.414,.51+.085*fall),vec2(.009,.018)),droplet(p,vec2(.78,.415+.07*fall),vec2(.008,.016)));',
    'rgb=mix(rgb,vec3(.43,.76,.98),tears*u_tear*.9*headPart);',
    'float sweat=droplet(p,vec2(.84,.31+.025*fract(u_phase*.7)),vec2(.011,.023));rgb=mix(rgb,vec3(.6,.83,1.),sweat*u_sweat*.85*headPart);',
    'vec2 mark=rotation(.3)*(p-vec2(.62,.245));float redMark=(1.-smoothstep(.003,.006,abs(abs(mark.x)-.012)))*(1.-smoothstep(.014,.02,abs(mark.y)));',
    'redMark=max(redMark,(1.-smoothstep(.003,.006,abs(abs(mark.y)-.012)))*(1.-smoothstep(.014,.02,abs(mark.x))));',
    'rgb=mix(rgb,vec3(.76,.13,.35),redMark*u_anger*.8*headPart);',
    'if(torsoPart>.5&&u_outfit>.5){vec4 garment=clothing(p,original,u_outfit);rgb=mix(rgb,garment.rgb,garment.a);}',
    'float a=texture2D(u_alpha,uv).a*v_coverage;if(volume>.5)a=v_coverage;else if(v_part>6.5&&v_part<8.5)a*=handUpperMask(uv);if(p.x<0.||p.y<0.||p.x>1.||p.y>1.)a=0.;gl_FragColor=vec4(rgb*a,a);}'
  ].join('\n');

  function nurseryFragmentSource(){
    // These substitutions are source-family landmarks, not another drawing of
    // the adult face. Each sampler below points only at nursery assets.
    var replacements=[
      ['vec2(.530,.750):vec2(.760,.735)','vec2(.375,.758):vec2(.742,.767)'],
      ['vec2(.4665,.429)','vec2(.44318,.43534)'],['vec2(.7281,.3405)','vec2(.68435,.40677)'],
      ['vec2(.628,.499)','vec2(.58051,.52638)'],['vec2(.625,.48)','vec2(.58051,.51638)'],
      ['vec2(.628,.511),vec2(.10,.067)','vec2(.58051,.54),vec2(.085,.057)'],['smoothstep(.455,.463,p.y)','smoothstep(.505,.513,p.y)'],
      ['vec2(.621,.453)','vec2(.57697,.48134)'],['vec2(.60,.415)','vec2(.555,.435)'],['vec2(.255,.215)','vec2(.315,.265)'],
      ['vec2(.135,.125)','vec2(.112,.115)'],['vec2(.115,.12)','vec2(.111,.119)'],
      ['p.y-.499','p.y-.52638'],['p.x-.628','p.x-.58051'],['p.x-.621','p.x-.57697'],['p.y-.429','p.y-.43534'],['p.y-.3405','p.y-.40677'],
      ['vec2(.405,.55)','vec2(.342,.553)'],['vec2(.80,.445)','vec2(.775,.521)'],
      ['vec2(.414,.51+','vec2(.397,.497+'],['vec2(.78,.415+','vec2(.740,.477+'],['vec2(.84,.31+','vec2(.83,.34+'],['vec2(.62,.245)','vec2(.58,.28)'],
      ['vec2(.518,.742),vec2(.215,.137)','vec2(.382,.737),vec2(.105,.105)'],['vec2(.742,.716),vec2(.14,.136)','vec2(.725,.735),vec2(.095,.10)'],
      ['smoothstep(.695,.708,p.y)','smoothstep(.65,.666,p.y)'],['max(.7,uv.y)','max(.67,uv.y)'],
      ['vec2(.414,.907),vec2(.09,.035)','vec2(.452,.914),vec2(.062,.03)'],['vec2(.692,.897),vec2(.065,.035)','vec2(.628,.912),vec2(.058,.03)']
    ];
    var result=fragmentSource.replace(eyePaintShader('mature'),'__EYE_PAINT_MASK__');
    replacements.forEach(function(row){result=result.split(row[0]).join(row[1]);});
    var featureMask=nurserySmileRegions.map(function(r){return 'eyeMask(p,vec2('+r[0]+','+r[1]+'),vec2('+r[2]+','+r[3]+'))';});
    featureMask[0]+='*smoothstep(.325,.340,p.y)';featureMask[1]+='*smoothstep(.295,.310,p.y)';
    // eyeMask uses a .28-radian registration; the mouth keeps unrotated UVs.
    featureMask[2]='1.-smoothstep(.85,1.1,length((p-vec2(.58051,.523))/vec2(.093,.077)))';
    var oldFace='float face=1.-smoothstep(.82,1.08,length(rotation(.28)*(p-vec2(.555,.435))/vec2(.315,.265)))*headPart;';
    result=result.replace(oldFace,oldFace+'if(u_face.w>max(max(u_face.x,u_face.y),u_face.z))face=max(max('+featureMask[0]+','+featureMask[1]+'),'+featureMask[2]+')*headPart;');
    result=result.replace('__EYE_PAINT_MASK__',eyePaintShader('baby'));
    result=result.replace(handUpperShader('mature'),handUpperShader('baby'));
    var maps=nurseryFaceMaps.map(function(row){var m=row.matrix,r=row.sourceRect;return 'if(cell>'+((row.cell-.5).toFixed(1))+'&&cell<'+((row.cell+.5).toFixed(1))+'){q=vec2(dot(vec3(p,1.),vec3('+m.slice(0,3).join(',')+')),dot(vec3(p,1.),vec3('+m.slice(3).join(',')+')));rect=vec4('+r.join(',')+');}';}).join('\n');
    var helper='varying vec4 v_sourceRect;\nvec4 nurserySample(sampler2D im,vec2 p,float cell){vec2 q=p;vec4 rect=vec4(0.,0.,1.,1.);'+maps+'vec2 tile=vec2(mod(cell,3.),floor(cell/3.));return texture2D(im,clamp((tile+q)/3.,rect.xy,rect.zw));}\n';
    var chromaCases=nurseryDirectionChroma.map(function(c,index){return 'if(index>'+((index-.5).toFixed(1))+'&&index<'+((index+.5).toFixed(1))+')c=vec2('+c.map(function(v){return v.toFixed(5);}).join(',')+');';}).join('');
    var chromaHelper='vec3 nurseryDirectionColor(float index,vec3 color,float featureMask){if(index<.5)return color;vec2 c=vec2(1.,0.);'+chromaCases+'float lum=dot(color,vec3(.299,.587,.114));vec2 d=color.rb-vec2(lum);vec2 q=vec2(c.x*d.x-c.y*d.y,c.y*d.x+c.x*d.y);vec3 target=clamp(vec3(lum+q.x,lum-(.299*q.x+.114*q.y)/.587,lum+q.y),vec3(0.),vec3(1.));return mix(color,target,furSelect(color)*featureMask); }\n';
    result=result.replace('vec4 turnImage(vec2 p){',chromaHelper+'vec4 turnImage(vec2 p){');
    result=result.replace('float mouth=ce(p,u_motionC.xy,u_motionC.zw);','float mouth=ce(p,u_motionC.xy,u_motionC.zw);color=nurseryDirectionColor(index,color,1.-max(eyes,mouth));');
    // Unit four is the expression sheet for the front and the separate 16-view
    // sheet only while turning. Expanded view rectangles preserve overhanging fur.
    result=result.replace('vec2 tile=vec2(mod(index,4.),floor(index/4.));source=texture2D(u_sad,(tile+safe)/4.);','source=texture2D(u_sad,mix(v_sourceRect.xy,v_sourceRect.zw,safe));');
    result=result.replace('vec2 tile=vec2(mod(index,4.),floor(index/4.));tooth=texture2D(u_angry,(tile+safe)/4.).rgb;','tooth=texture2D(u_angry,mix(v_sourceRect.xy,v_sourceRect.zw,safe)).rgb;');
    // Blink materials share the full-resolution reference UVs. Enlarging a
    // 3x3 expression cell here used to blur the lids and surrounding cream fur.
    // The existing eye-only paint mask keeps the reference face/body intact.
    [3,4,5,6].forEach(function(cell){
      var guard=cell===6?'float donorEye=eyePaintMask;float donorFur=max(furSelect(expressionDonor.rgb)*smoothstep(.25,.50,dot(expressionDonor.rgb,vec3(.299,.587,.114))),furSelect(original)*smoothstep(.50,.65,dot(original,vec3(.299,.587,.114))))*(1.-donorEye);':'';
      result=result.replace('expression=texture2D(u_sad,uv).rgb;toothCell='+cell+'.;','vec4 expressionDonor=nurserySample(u_sad,uv,'+cell+'.);'+guard+'expression=mix(rgb,expressionDonor.rgb,faceDonorOpacity(expressionDonor.a)'+(cell===6?'*(1.-donorFur)':'')+');toothCell='+cell+'.;');
    });
    result=result.replace('vec3 toothExpression=texture2D(u_surprise,uv).rgb;','vec3 toothExpression=nurserySample(u_surprise,uv,v_mouthMode>.5?2.:toothCell).rgb;');
    result=result.replace('texture2D(u_sad,plateUV).rgb','nurserySample(u_sad,plateUV,7.).rgb');
    result=result.replace('original=mix(original,nurserySample(u_sad,plateUV,7.).rgb,patch);','original=nurserySample(u_sad,plateUV,7.).rgb;');
    result=result.replace('vec4 garment=clothing(p,original,u_outfit);','vec2 dressUV=vec2(.525+(p.x-.55)*.258/.185,.79+(p.y-.78)*.125/.13);vec4 garment=clothing(dressUV,original,u_outfit);');
    result=result.replace('float a=texture2D(u_alpha,uv).a*v_coverage;','float a=texture2D(u_alpha,uv).a*v_coverage;if(torsoPart>.5)a=nurserySample(u_sad,vec2(uv.x,max(.67,uv.y)),7.).a*v_coverage;');
    return result.replace('float region(vec2 p,vec2 c,vec2 r){',helper+'float region(vec2 p,vec2 c,vec2 r){');
  }
  var eggFragmentSource=[
    'precision mediump float;varying vec2 v_uv;varying vec4 v_evolution;varying float v_coverage;varying float v_part;',
    'uniform sampler2D u_original,u_half,u_closed,u_alpha,u_sad,u_angry,u_surprise,u_delighted;',
    'uniform vec4 u_motionA,u_motionB,u_motionC,u_body,u_gesture,u_face,u_effect,u_detail;',
    'float eggRegion(vec2 p,vec2 c,vec2 r){return 1.-smoothstep(.96,1.02,length((p-c)/r));}',
    'vec3 eggColor(vec2 p,vec3 color){if(v_evolution.a<16.)return color;float features=0.;if(u_motionA.x>1.5)features=max(max(eggRegion(p,vec2(.238,.661),vec2(.061,.063)),eggRegion(p,vec2(.339,.653),vec2(.061,.063))),eggRegion(p,vec2(.295,.705),vec2(.052,.040)));float fur=smoothstep(.012,.045,min(color.r,color.b)-color.g)*(1.-smoothstep(.16,.26,color.r-color.b));float amount=fur*(1.-features)*.92;float lum=dot(color,vec3(.299,.587,.114));float targetLum=max(.2,dot(v_evolution.rgb,vec3(.299,.587,.114)));return mix(color,clamp(v_evolution.rgb*lum/targetLum,vec3(0.),vec3(1.)),amount);}',
    'void main(){if(v_part<0.||v_evolution.a<-.5)discard;vec4 rect=vec4('+eggSourceRects[0].join(',')+');',
    'if(u_motionA.x>.5&&u_motionA.x<1.5)rect=vec4('+eggSourceRects[1].join(',')+');if(u_motionA.x>1.5)rect=vec4('+eggSourceRects[2].join(',')+');',
    'vec2 p=mix(rect.xy,rect.zw,clamp(v_uv,vec2(.0001),vec2(.9999)));vec4 source=texture2D(u_sad,p);if(source.a<.01)discard;float mask=0.;if(u_motionA.x>1.5){vec2 q=(p-vec2(.295,.705))/vec2(.045,.03);mask=(1.-smoothstep(.96,1.02,length(q)))*smoothstep(.697,.705,p.y);}source.rgb=mix(source.rgb,texture2D(u_angry,p).rgb,mask);source.rgb=eggColor(p,source.rgb);float a=source.a*v_coverage;gl_FragColor=vec4(source.rgb*a,a);}'
  ].join('\n');

  function mount(canvas, options) {
    options = options || {};
    if (mounted && canvas && mounted.has(canvas)) mounted.get(canvas).destroy();
    var doc = canvas && canvas.ownerDocument, win = doc && doc.defaultView || environment;
    doc = doc || win && win.document;
    var gl, dead = false, loaded = false, readyNotified = false, pageVisible = true, frame = null, timer = null, cueTimer=null, cueTimerVersion=0,observer = null;
    var media = null, removers = [], images = [], resources = [], locations = {};
    var phaseMs = 0, cue = 'idle', cueMs = 0, cueAnchor = 0, cueDuration = 0, cueInitialYaw = 0, last = null, locomotion = null;
    var scale = clamp(finite(options.scale, 1), .35, 1.15), stageProfile = growthProfile(options.growthStage), branchProfile = evolutionProfile(options.evolutionPath), selectedOutfit = outfitProfile(options.outfit);
    var appearance=appearanceProfile(options.appearanceKey),family=appearance.family,assetFiles=appearanceAssets(options.appearanceKey),eggOrigin=eggOriginProfile(options.eggOrigin).key;
    var materialProfile=eggVisualProfile(branchProfile.key,eggOrigin),originProfile=eggOriginProfile(eggOrigin);
    if(family==='egg'&&originProfile.index)materialProfile=originProfile;
    var sourceSlots=family==='baby'?[0,6,7,0,1,1,1,1,1,2]:family==='egg'?[0,0,0,0,0,0,0,0,0,0]:[0,1,2,3,4,5,6,7,8,9];
    var assetTextures=[],textureImages=[],sourceRectAttribute=null,mouthAttribute=null,volumeAttribute=null;
    var rigGeometry=[],restVertices=null,drawVertices=null,partAttribute=null,buffer=null,textures=[];
    var turnBuffer=null,turnVertices=null,turnMeshes={},turnBounds={},boundVertexBuffer=null,position=null,uv=null,coverage=null;
    var handBuffer=null,handVertices=null,handScratch=null,handSourceMeshes={},handSourceStarts={};
    var lastHitFrame=null,hitAlpha=[];
    var clock = typeof options.now === 'function' ? options.now : function () { return win.performance && win.performance.now ? win.performance.now() : Date.now(); };
    function listen(target, type, callback) {
      if (!target || typeof target.addEventListener !== 'function') return;
      target.addEventListener(type, callback);
      removers.push(function () { target.removeEventListener(type, callback); });
    }
    function cancel() { if (frame !== null) { win.cancelAnimationFrame(frame); frame = null; } last = null; }
    function destroy() {
      if (dead) return;
      dead = true;lastHitFrame=null;hitAlpha=[];cancel();
      if (timer !== null) { win.clearTimeout(timer); timer = null; }
      if(cueTimer!==null){win.clearTimeout(cueTimer);cueTimer=null;}
      images.forEach(function (image) {
        image.onload = null; image.onerror = null;
        if (typeof image.removeAttribute === 'function') image.removeAttribute('src');
      });
      removers.forEach(function (remove) { remove(); }); removers = [];
      if (observer) observer.disconnect();
      resources.reverse().forEach(function (r) { try { gl[r[0]](r[1]); } catch (_) {} }); resources = [];
      // Each UI rebuild owns a fresh canvas; release the old GPU context promptly.
      try {
        var release = options.releaseContextOnDestroy === true && gl && typeof gl.getExtension === 'function' && gl.getExtension('WEBGL_lose_context');
        if (release) release.loseContext();
      } catch (_) {}
      if (mounted && mounted.get(canvas) === controller) mounted.delete(canvas);
    }
    function fail(code) {
      if (dead) return;
      if (canvas) canvas.hidden = true;
      destroy();
      if (typeof options.onError === 'function') { try { options.onError(code); } catch (_) {} }
    }
    function setSituation(name, values) {
      if (dead) return;
      values = values || {};
      // A live replacement starts at the last successfully painted direction.
      // Explicit elapsedMs is a seek/restore, not a request to blend from the old
      // view. Hidden, detached, egg and reduced-motion previews stay stateless.
      var previousYaw=lastHitFrame&&lastHitFrame.turn?lastHitFrame.turn.yawDeg:0;
      var continueTurn=loaded&&pageVisible&&!doc.hidden&&canvas.isConnected!==false&&family!=='egg'&&!(media&&media.matches)&&!Object.prototype.hasOwnProperty.call(values,'elapsedMs');
      cue = known(name);
      cueInitialYaw=continueTurn&&directionFrame(cue,0).id?previousYaw:0;
      if(family==='egg'&&Object.prototype.hasOwnProperty.call(roomWalkDurations,cue))cue='idle';
      cueDuration = cue === 'idle' ? 0 : clamp(finite(values.durationMs, durations[cue]), 0, 30000);
      cueMs = Math.max(0, finite(values.elapsedMs, 0)); cueAnchor = finite(clock(), 0);
      if (cue !== 'idle' && cueMs >= cueDuration) { cue = 'idle'; cueMs = 0; }
      if (loaded && !doc.hidden) paint();
      armCueExpiry();schedule();
    }
    function sourceAlpha(index,x,y) {
      if(x<0||x>1||y<0||y>1)return 0;
      var cached=hitAlpha[index];
      if(cached===undefined){
        hitAlpha[index]=false;
        try{
          var im=images[index],surface=doc.createElement('canvas'),w=im.naturalWidth,h=im.naturalHeight;
          surface.width=w;surface.height=h;var context=surface.getContext('2d',{willReadFrequently:true});
          if(!context)return 0;
          context.drawImage(im,0,0,w,h);var rgba=context.getImageData(0,0,w,h).data,alpha=new Uint8Array(w*h);
          for(var pixel=0;pixel<alpha.length;pixel++)alpha[pixel]=rgba[pixel*4+3];
          cached=hitAlpha[index]={width:w,height:h,alpha:alpha};surface.width=surface.height=0;
        }catch(_){return 0;}
      }
      if(!cached)return 0;
      var px=clamp(x*cached.width-.5,0,cached.width-1),py=clamp(y*cached.height-.5,0,cached.height-1),left=Math.floor(px),top=Math.floor(py),right=Math.min(left+1,cached.width-1),bottom=Math.min(top+1,cached.height-1),fx=px-left,fy=py-top;
      return ((cached.alpha[top*cached.width+left]*(1-fx)+cached.alpha[top*cached.width+right]*fx)*(1-fy)+(cached.alpha[bottom*cached.width+left]*(1-fx)+cached.alpha[bottom*cached.width+right]*fx)*fy)/255;
    }
    function hitTest(x,y) {
      if(dead||!loaded||!lastHitFrame||family==='egg'||!pageVisible||doc.hidden||canvas.hidden||canvas.isConnected===false||!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>1||y<0||y>1)return null;
      var painted=lastHitFrame,px=x*2-1,py=1-y*2;
      if(painted.turn){
        var entries=[[directionSourceIndex(painted.turn),1]];
        for(var entry=0;entry<entries.length;entry++){
          var index=entries[entry][0],weight=entries[entry][1];if(weight<.2)continue;
          var mesh=turnMeshes[index],bounds=turnBounds[index];if(!mesh||!bounds)continue;
          var matrix=fitDirectionMatrix(painted.rig.matrices.torso,roomWalkBounds(bounds,painted.turn.roomWalk)).matrix;
          turnVertices.set(mesh);
          for(var offset=0;offset<mesh.length;offset+=5){
            var rest={x:mesh[offset],y:mesh[offset+1]};if(painted.turn.roomWalk)rest=roomWalkDeform(index,mesh[offset+2],mesh[offset+3],rest,painted.turn.roomWalk,appearance.key);
            var point=transform(matrix,rest);turnVertices[offset]=point.x*2-1;turnVertices[offset+1]=1-point.y*2;
          }
          var hit=touchMesh(turnVertices,5,0,mesh.length/5,px,py,function(sample){
            var region=touchDirection(index,sample.x,sample.y,appearance.key);if(!region)return null;
            var uv=index?directionCellUV(index,sample.x,sample.y,textureImages[9].naturalWidth,textureImages[9].naturalHeight,appearance.key):sample;
            return sourceAlpha(index?sourceSlots[9]:sourceSlots[3],uv.x,uv.y)*sample.coverage*weight>=.25?region:null;
          });
          if(hit)return hit;
        }
        return null;
      }
      var hands=handVolumeState(painted.rig,painted.seconds,painted.elapsed,stageProfile.key,branchProfile.key,appearance.key,eggOrigin);
      hands.sourceMeshes=handSourceMeshes;hands.projected=drawVertices;hands.starts=handSourceStarts;hands.scratch=handScratch;
      for(var side=1;side>=0;side--){
        var id=side?'arm_r':'arm_l',hand=handVolumeMesh(hands,id,handVertices),profile=handVolumeProfiles[family][id];
        var selected=touchMesh(hand,9,0,hand.length/9,px,py,function(sample){
          var alpha=sample.volume>.5?1:sourceAlpha(sourceSlots[3],sample.x,sample.y)*handProximalCoverage(profile,sample.x,sample.y);
          return alpha*sample.coverage>=.25?{part:'hand',side:side?'right':'left'}:null;
        });
        if(selected)return selected;
      }
      for(var part=rigGeometry.length-1;part>=0;part--){
        var geometry=rigGeometry[part];if(geometry.id!=='head'&&geometry.id!=='ear_l'&&geometry.id!=='ear_r')continue;
        var face=touchMesh(drawVertices,5,geometry.start,geometry.count,px,py,function(sample){
          if(sourceAlpha(sourceSlots[3],sample.x,sample.y)*sample.coverage<.25)return null;
          return geometry.id==='head'?touchFace(family,sample.x,sample.y):{part:'head',side:null};
        });
        if(face)return face;
      }
      return null;
    }
    var controller = { setSituation: setSituation, destroy: destroy, hitTest:hitTest,
      setLocomotion: function (value) {
        if (dead || family === 'egg') return false;
        if (value && !Number.isFinite(value.yawDeg)) return false;
        var next = value ? { yawDeg: value.yawDeg, walking: !!value.walking, distance: Number.isFinite(value.distance) ? value.distance : 0 } : null;
        if (JSON.stringify(next) === JSON.stringify(locomotion)) return true;
        locomotion = next;
        if (loaded && media && media.matches) paint();
        schedule(); return true;
      },
      refreshFrame: function () { if (!dead && loaded) paint(); } };
    if (!canvas || !win || !doc || typeof win.Image !== 'function' || !win.requestAnimationFrame || !win.cancelAnimationFrame) { fail('environment_unavailable'); return controller; }
    if (mounted) mounted.set(canvas, controller);
    var assetRoot = options.assetRoot == null ? '/static/' : options.assetRoot;
    if (typeof assetRoot !== 'string' || !/^\/(?!\/)/.test(assetRoot) || /[\\:?#]/.test(assetRoot)) { fail('asset_root_invalid'); return controller; }
    if (assetRoot.charAt(assetRoot.length - 1) !== '/') assetRoot += '/';
    function own(method) {
      var value = gl[method]();
      if (!value) throw new Error('allocation');
      resources.push([{ createShader: 'deleteShader', createProgram: 'deleteProgram', createBuffer: 'deleteBuffer', createTexture: 'deleteTexture' }[method], value]);
      return value;
    }
    function shader(type, source) {
      var value = gl.createShader(type);
      if (!value) throw new Error('allocation');
      resources.push(['deleteShader', value]);
      gl.shaderSource(value, source); gl.compileShader(value);
      if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new Error('compile');
      return value;
    }
    function active() { return !dead && loaded && pageVisible && !doc.hidden && !(media && media.matches) && canvas.isConnected !== false; }
    function armCueExpiry() {
      var version=++cueTimerVersion;
      if(cueTimer!==null){win.clearTimeout(cueTimer);cueTimer=null;}
      // Reduced motion deliberately has no RAF. A static side/back preview still
      // needs one finite deadline to redraw the actual original front pose.
      if(dead||!loaded||!pageVisible||doc.hidden||canvas.isConnected===false||!media||!media.matches||!directionFrame(cue,0).id||cueDuration<=0)return;
      var remaining=cueDuration-cueMs-Math.max(0,finite(clock(),cueAnchor)-cueAnchor);
      cueTimer=win.setTimeout(function(){if(dead||version!==cueTimerVersion)return;cueTimer=null;paint();armCueExpiry();schedule();},Math.max(0,remaining));
    }
    function resize() {
      if (dead) return;
      var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
      var css = rect && rect.width > 0 ? rect.width : canvas.clientWidth || 256;
      var side = Math.round(clamp(css * clamp(finite(win.devicePixelRatio, 1), 1, 2), 1, 768));
      if (canvas.width !== side || canvas.height !== side) { canvas.width = side; canvas.height = side; }
    }
    function bindVertices(value) {
      gl.bindBuffer(gl.ARRAY_BUFFER,value);
      if(volumeAttribute!==null){gl.disableVertexAttribArray(volumeAttribute);gl.vertexAttrib4f(volumeAttribute,0,0,1,0);}
      if(boundVertexBuffer===value)return;
      gl.vertexAttribPointer(position,2,gl.FLOAT,false,20,0);gl.vertexAttribPointer(uv,2,gl.FLOAT,false,20,8);gl.vertexAttribPointer(coverage,1,gl.FLOAT,false,20,16);
      boundVertexBuffer=value;
    }
    function paintHand(frame,part){
      if(!handBuffer){handBuffer=own('createBuffer');handVertices=new Float32Array(handVolumeMaxFloats);handScratch=new Float64Array((handVolumeRows+1)*handVolumeColumns*10);gl.bindBuffer(gl.ARRAY_BUFFER,handBuffer);gl.bufferData(gl.ARRAY_BUFFER,handVertices,gl.DYNAMIC_DRAW);}
      frame.scratch=handScratch;
      var vertices=handVolumeMesh(frame,part.id,handVertices);
      gl.bindBuffer(gl.ARRAY_BUFFER,handBuffer);gl.vertexAttribPointer(position,2,gl.FLOAT,false,36,0);gl.vertexAttribPointer(uv,2,gl.FLOAT,false,36,8);gl.vertexAttribPointer(coverage,1,gl.FLOAT,false,36,16);
      gl.enableVertexAttribArray(volumeAttribute);gl.vertexAttribPointer(volumeAttribute,4,gl.FLOAT,false,36,20);boundVertexBuffer=handBuffer;
      gl.bufferSubData(gl.ARRAY_BUFFER,0,vertices);gl.vertexAttrib1f(partAttribute,part.index);gl.drawArrays(gl.TRIANGLES,0,vertices.length/9);bindVertices(buffer);
    }
    function paintTurn(frame,rig) {
      // Only the visible view has working vertices. Ordinary
      // frontal frames never build or upload a turnaround mesh.
      if(!turnBuffer){turnBuffer=own('createBuffer');turnVertices=new Float32Array(24*24*6*5);bindVertices(turnBuffer);gl.bufferData(gl.ARRAY_BUFFER,turnVertices,gl.DYNAMIC_DRAW);}
      gl.activeTexture(gl.TEXTURE0+4);gl.bindTexture(gl.TEXTURE_2D,textures[9]);
      [[directionSourceIndex(frame),1]].forEach(function(entry){
        var index=entry[0],weight=entry[1];if(weight<=0)return;
        gl.activeTexture(gl.TEXTURE0+5);gl.bindTexture(gl.TEXTURE_2D,assetTextures[index===0?(family==='baby'?3:10):(family==='baby'?5:13)]);
        var view=directionView(index,appearance.key),mesh=turnMeshes[index]||(turnMeshes[index]=directionMesh(index,stageProfile.key,branchProfile.key,appearance.key,eggOrigin));
        var bounds=turnBounds[index]||(turnBounds[index]=directionBounds(index,stageProfile.key,branchProfile.key,appearance.key,eggOrigin));
        var matrix=fitDirectionMatrix(rig.matrices.torso,roomWalkBounds(bounds,frame.roomWalk)).matrix;
        turnVertices.set(mesh);
        for(var offset=0;offset<mesh.length;offset+=5){var rest={x:mesh[offset],y:mesh[offset+1]};if(frame.roomWalk)rest=roomWalkDeform(index,mesh[offset+2],mesh[offset+3],rest,frame.roomWalk,appearance.key);var point=transform(matrix,rest);turnVertices[offset]=point.x*2-1;turnVertices[offset+1]=1-point.y*2;}
        bindVertices(turnBuffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,turnVertices);
        gl.uniform4f(locations.motionA,weight,index,index>4&&index<12?1:0,selectedOutfit?selectedOutfit.index:0);
        gl.uniform4f(locations.motionB,view.eyes[0],view.eyes[1],view.eyes[2],view.eyes[3]);
        gl.uniform4f(locations.motionC,view.mouth[0],view.mouth[1],view.mouth[2],view.mouth[3]);
        gl.uniform4f(locations.body,view.torso[0],view.torso[1],view.torso[2],view.torso[3]);
        gl.uniform4f(locations.gesture,view.paws[0],view.paws[1],view.paws[2],view.paws[3]);
        gl.uniform4f(locations.face,view.eyeRadii[0],view.eyeRadii[1],view.eyeRadii[2],view.eyeRadii[3]);
        gl.uniform4f(locations.effect,view.tail[0],view.tail[1],view.tail[2],view.tail[3]);
        gl.uniform4f(locations.detail,2/textureImages[9].naturalWidth,2/textureImages[9].naturalHeight,Math.sin(index*TAU/16)*.12,0);
        if(sourceRectAttribute!==null){var rect=view.sourceRect||[0,0,1,1];gl.vertexAttrib4f(sourceRectAttribute,rect[0],rect[1],rect[2],rect[3]);}
        gl.vertexAttrib1f(partAttribute,10+index);gl.drawArrays(gl.TRIANGLES,0,mesh.length/5);
      });
      gl.activeTexture(gl.TEXTURE0+4);gl.bindTexture(gl.TEXTURE_2D,textures[4]);
      gl.activeTexture(gl.TEXTURE0+5);gl.bindTexture(gl.TEXTURE_2D,textures[5]);
      bindVertices(buffer);
    }
    function paintEgg(p,elapsed,reduced){
      var rect=appearance.stillRect,aspect=(rect[2]-rect[0])/(rect[3]-rect[1]),turn=directionFrame(cue,elapsed*1000,reduced);
      var rock=reduced?0:p.tilt*.55+p.wave*.055+p.wiggle*.025,angle=rock+(turn.id?Math.sin(turn.yawDeg*PI/180)*.12:0);
      var amount=appearance.overallScale*scale*(1-.06*p.presence),matrix=multiply(bone({x:.5,y:.92},0,0,0,amount,amount),bone({x:.5,y:.92},angle,p.shiftX*.6,p.shiftY*.5-p.bounce*.04,1+.025*p.squash,1-.025*p.squash+.003*p.breath));
      for(var i=0;i<restVertices.length;i+=5){var point=transform(matrix,{x:.5+(restVertices[i+2]-.5)*.89*aspect,y:.92+(restVertices[i+3]-.996)*.89});drawVertices[i]=point.x*2-1;drawVertices[i+1]=1-point.y*2;}
      bindVertices(buffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,drawVertices);gl.uniform4f(locations.motionA,appearance.stillCell,0,0,0);
      gl.activeTexture(gl.TEXTURE0+5);gl.bindTexture(gl.TEXTURE_2D,assetTextures[1]);gl.vertexAttrib1f(partAttribute,0);gl.drawArrays(gl.TRIANGLES,0,6);gl.bindTexture(gl.TEXTURE_2D,textures[5]);
    }
    function paint() {
      if (dead || !loaded || !pageVisible || doc.hidden || canvas.isConnected === false) return;
      try {
        resize();
        var reduced = media && media.matches;
        var observedCue=cue,observedAnchor=cueAnchor,observedDuration=cueDuration;
        var age = cueMs + Math.max(0, finite(clock(), cueAnchor) - cueAnchor);
        var endedDirection=cue!=='idle'&&age>=cueDuration?directionFrame(cue,0).id:null;
        if (cue !== 'idle' && age >= cueDuration) { cue = 'idle'; cueMs = 0; cueDuration = 0; }
        var elapsed = cueDuration ? age / cueDuration * durations[cue] / 1000 : 0;
        var turn=locomotionFrame(locomotion,phaseMs/1000,reduced)||directionFrame(cue,elapsed*1000,reduced,cueInitialYaw);
        var p = reduced ? pose(0, 'idle', 0, stageProfile.key, branchProfile.key) : pose(phaseMs / 1000, locomotion && locomotion.walking ? 'moving' : cue, elapsed, stageProfile.key, branchProfile.key);
        if (locomotion && !reduced) {
          p.situation = 'moving'; p.presence = 1;
          p.step = locomotion.walking ? Math.sin(turn.roomWalk.footPhase) : 0;
          p.bounce = .25 * Math.abs(p.step); p.bodyAngle = .035 * p.step;
          p.shiftX = 0; p.wave = locomotion.walking ? .25 : 0;
        }
        if (reduced) { p.tail = 0; }
        var rig=family==='egg'?null:rigFrame(p,reduced?0:phaseMs/1000,elapsed,stageProfile.key,branchProfile.key,scale,appearance.key,eggOrigin);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
        if(family==='egg')paintEgg(p,elapsed,reduced);
        else if(turn.id&&!turn.front&&!turn.done)paintTurn(turn,rig);
        else {
        rigGeometry.forEach(function(part){
          var matrix=rig.matrices[part.id];
          for(var offset=part.start*5;offset<(part.start+part.count)*5;offset+=5){
            var rest={x:restVertices[offset],y:restVertices[offset+1]};
            if(part.id==='torso')rest=lowerBodyTorsoPoint(rig.lowerBody,restVertices[offset+2],restVertices[offset+3],rest);
            var point=transform(matrix,rest);
            drawVertices[offset]=point.x*2-1;drawVertices[offset+1]=1-point.y*2;
            drawVertices[offset+4]=restVertices[offset+4];
          }
        });
        bindVertices(buffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,drawVertices);
        p.scale = scale; p.anger = outfitUniform(selectedOutfit && selectedOutfit.id, p.anger);
        Object.keys(packedUniforms).forEach(function (key) {
          var fields = packedUniforms[key];
          gl.uniform4f(locations[key], p[fields[0]], p[fields[1]], p[fields[2]], p[fields[3]]);
        });
        var hands=handVolumeState(rig,reduced?0:phaseMs/1000,elapsed,stageProfile.key,branchProfile.key,appearance.key,eggOrigin);
        hands.sourceMeshes=handSourceMeshes;hands.projected=drawVertices;hands.starts=handSourceStarts;
        rigGeometry.forEach(function(part){
          if(part.id==='arm_l'||part.id==='arm_r'){paintHand(hands,part);return;}
          // Local mouth donors and the clean torso reuse existing sampler units;
          // every other part retains the exact original material and alpha.
          if(part.id==='torso'){gl.activeTexture(gl.TEXTURE0+4);gl.bindTexture(gl.TEXTURE_2D,textures[8]);}
          if(part.id==='head'){
            var mouth=toothFaceBinding(p,p.situation,appearance.key);
            [mouth.oldFaceAsset,mouth.defaultMouthAsset,mouth.expressionMouthAsset].forEach(function(index,offset){gl.activeTexture(gl.TEXTURE0+4+offset);gl.bindTexture(gl.TEXTURE_2D,assetTextures[index]);});
            if(mouthAttribute!==null)gl.vertexAttrib1f(mouthAttribute,mouth.closed?1:0);
          }
          gl.vertexAttrib1f(partAttribute,part.index);gl.drawArrays(gl.TRIANGLES,part.start,part.count);
          if(part.id==='torso'){gl.activeTexture(gl.TEXTURE0+4);gl.bindTexture(gl.TEXTURE_2D,textures[4]);}
          if(part.id==='head'){
            for(var unit=4;unit<=6;unit++){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,textures[unit]);}
            if(mouthAttribute!==null)gl.vertexAttrib1f(mouthAttribute,0);
          }
        });
        }
        lastHitFrame={rig:rig,turn:family!=='egg'&&turn.id&&!turn.front&&!turn.done?turn:null,seconds:reduced?0:phaseMs/1000,elapsed:elapsed};
        if (!readyNotified) {
          readyNotified = true;
          if (typeof options.onReady === 'function') { try { options.onReady(); } catch (_) {} }
        }
        if(!dead&&family!=='egg'&&cue===observedCue&&cueAnchor===observedAnchor&&cue==='feeding'&&feedingPhase(elapsed*1000).foodVisible&&typeof options.onPose==='function'){
          try{options.onPose({situation:'feeding',elapsedMs:elapsed*1000,mouthX:clamp(rig.mouth.x,0,1),mouthY:clamp(rig.mouth.y,0,1),
            foodLeft:clamp(rig.mouth.x-.11,0,1),foodTop:clamp(rig.mouth.y+.005,0,1)});}catch(_){}
        }
        if(!dead&&family!=='egg'&&cueAnchor===observedAnchor&&typeof options.onPose==='function'){
          if(cue===observedCue&&turn.id&&!turn.done){
            var packet={situation:cue,elapsedMs:elapsed*1000,yawDeg:turn.yawDeg};
            if(turn.roomWalk){var walk=turn.roomWalk;packet.roomX=walk.x;packet.walking=walk.walking;packet.speed=walk.speed;packet.phase=walk.phase;packet.footPhase=walk.footPhase;}
            try{options.onPose(packet);}catch(_){}
          }else if(endedDirection&&cue==='idle'){
            var endPacket={situation:endedDirection,elapsedMs:observedDuration,yawDeg:0,done:true};
            if(Object.prototype.hasOwnProperty.call(roomWalkDurations,endedDirection)){endPacket.roomX=0;endPacket.walking=false;endPacket.speed=0;endPacket.phase='idle';endPacket.footPhase=TAU*7;}
            try{options.onPose(endPacket);}catch(_){}
          }
        }
        // Optional scene consumers must upload before the drawing buffer is released.
        // Their lifecycle or upload errors must not break the original pet renderer.
        if (!dead && typeof options.onFrame === 'function') { try { options.onFrame(canvas); } catch (_) {} }
      } catch (_) { fail('render_failed'); }
    }
    function schedule() {
      if (frame !== null || !active()) return;
      frame = win.requestAnimationFrame(tick);
    }
    function tick() {
      frame = null;
      if (!active()) { last = null; return; }
      var stamp = finite(clock(), 0);
      var delta = last === null ? 0 : clamp(stamp - last, 0, 100);
      last = stamp; phaseMs += delta;
      paint(); schedule();
    }
    try {
      gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false });
      if (!gl) { fail('webgl_unavailable'); return controller; }
      gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
      var program = own('createProgram');
      var vertex=family==='baby'?vertexSource.replace('void main(){','attribute vec4 a_sourceRect;varying vec4 v_sourceRect;void main(){v_sourceRect=a_sourceRect;'):vertexSource;
      gl.attachShader(program, shader(gl.VERTEX_SHADER, vertex));
      gl.attachShader(program, shader(gl.FRAGMENT_SHADER, family==='baby'?nurseryFragmentSource():family==='egg'?eggFragmentSource:fragmentSource));
      // Attribute zero always remains an enabled position array. The branch is
      // a constant attribute, leaving all fragment sampler/uniform limits intact.
      gl.bindAttribLocation(program, 0, 'a_position');
      gl.bindAttribLocation(program, 1, 'a_uv');
      gl.bindAttribLocation(program, 2, 'a_evolution');
      gl.bindAttribLocation(program, 3, 'a_coverage');
      gl.bindAttribLocation(program, 4, 'a_part');
      if(family==='baby')gl.bindAttribLocation(program,5,'a_sourceRect');
      if(family!=='egg')gl.bindAttribLocation(program,6,'a_mouthMode');
      if(family!=='egg')gl.bindAttribLocation(program,7,'a_handVolume');
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('link');
      gl.useProgram(program);
      buffer = own('createBuffer'); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      var selectedParts=family==='baby'?nurseryRigParts:rigParts;
      var parts=family==='egg'?[new Float32Array([0,0,0,0,1,0,1,0,1,1,1,0,1,0,1,1,0,1,0,1,0,1,0,1,1,1,1,1,1,1])]:selectedParts.map(function(part){return rigMesh(part,stageProfile.key,branchProfile.key,appearance.key,eggOrigin);}),floatCount=parts.reduce(function(n,array){return n+array.length;},0),cursor=0;
      restVertices=new Float32Array(floatCount);
      parts.forEach(function(values,index){var id=family==='egg'?'egg':selectedParts[index].id;rigGeometry.push({id:id,index:index,start:cursor/5,count:values.length/5});if(id==='arm_l'||id==='arm_r'){handSourceMeshes[id]=values;handSourceStarts[id]=cursor;}restVertices.set(values,cursor);cursor+=values.length;});
      drawVertices=new Float32Array(restVertices);gl.bufferData(gl.ARRAY_BUFFER,drawVertices,gl.DYNAMIC_DRAW);
      position = gl.getAttribLocation(program, 'a_position'); uv = gl.getAttribLocation(program, 'a_uv');
      gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(uv); gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 20, 8);
      coverage=gl.getAttribLocation(program,'a_coverage');gl.enableVertexAttribArray(coverage);gl.vertexAttribPointer(coverage,1,gl.FLOAT,false,20,16);boundVertexBuffer=buffer;
      partAttribute=gl.getAttribLocation(program,'a_part');gl.disableVertexAttribArray(partAttribute);
      var branchAttribute = gl.getAttribLocation(program, 'a_evolution');
      gl.disableVertexAttribArray(branchAttribute);
      gl.vertexAttrib4f(branchAttribute, materialProfile.rgb[0], materialProfile.rgb[1], materialProfile.rgb[2], family==='egg'&&originProfile.index?16+originProfile.index:materialProfile.index);
      if(family==='baby'){sourceRectAttribute=gl.getAttribLocation(program,'a_sourceRect');gl.disableVertexAttribArray(sourceRectAttribute);gl.vertexAttrib4f(sourceRectAttribute,0,0,1,1);}
      if(family!=='egg'){mouthAttribute=gl.getAttribLocation(program,'a_mouthMode');if(mouthAttribute>=0){gl.disableVertexAttribArray(mouthAttribute);gl.vertexAttrib1f(mouthAttribute,0);}else mouthAttribute=null;}
      if(family!=='egg'){volumeAttribute=gl.getAttribLocation(program,'a_handVolume');if(volumeAttribute<0)throw new Error('volume_attribute');gl.disableVertexAttribArray(volumeAttribute);gl.vertexAttrib4f(volumeAttribute,0,0,1,0);}
      Object.keys(packedUniforms).forEach(function (key) { locations[key] = gl.getUniformLocation(program, 'u_' + key); });
      var samplerNames = ['u_original', 'u_half', 'u_closed', 'u_alpha', 'u_sad', 'u_angry', 'u_surprise', 'u_delighted'];
      samplerNames.forEach(function(name,i){gl.uniform1i(gl.getUniformLocation(program,name),i);});
      assetTextures=assetFiles.map(function(){return own('createTexture');});textures=sourceSlots.map(function(index){return assetTextures[index];});
      if (typeof win.matchMedia === 'function') media = win.matchMedia('(prefers-reduced-motion: reduce)');
      function preference() { cancel(); paint(); armCueExpiry();schedule(); }
      if (media) {
        if (media.addEventListener) listen(media, 'change', preference);
        else if (media.addListener) { media.addListener(preference); removers.push(function () { media.removeListener(preference); }); }
      }
      listen(doc, 'visibilitychange', function () { cancel(); if (!doc.hidden) paint();armCueExpiry();schedule(); });
      listen(win, 'pagehide', function () { pageVisible = false; cancel();armCueExpiry(); });
      listen(win, 'pageshow', function () { pageVisible = true; paint();armCueExpiry();schedule(); });
      listen(canvas, 'webglcontextlost', function (event) { if (event.preventDefault) event.preventDefault(); fail('context_lost'); });
      if (typeof win.ResizeObserver === 'function') { observer = new win.ResizeObserver(function () { paint(); }); observer.observe(canvas); }
      else listen(win, 'resize', paint);
      function load() {
        if (dead || loaded || images.length !== assetFiles.length || !images.every(function (im) { return im.complete && im.naturalWidth > 0; })) return;
        try {
          var first = images[0];
          if (family==='mature'?(images.slice(0,8).some(function (im) { return im.naturalWidth !== first.naturalWidth || im.naturalHeight !== first.naturalHeight; })||images.slice(8).some(function(im){return im.naturalWidth!==im.naturalHeight;})):images.some(function(im){return im.naturalWidth!==im.naturalHeight||im.naturalWidth<4;})) { fail('image_dimensions_mismatch'); return; }
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          images.forEach(function (im, i) {
            gl.activeTexture(gl.TEXTURE0 + (i<8?i:4)); gl.bindTexture(gl.TEXTURE_2D, assetTextures[i]);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
          });
          textureImages=sourceSlots.map(function(index){return images[index];});
          for(var unit=0;unit<8;unit++){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,textures[unit]);}
          loaded = true; canvas.hidden = false;
          if (timer !== null) { win.clearTimeout(timer); timer = null; }
          paint();armCueExpiry();schedule();
        } catch (_) { fail('texture_failed'); }
      }
      assetFiles.forEach(function () { var im = new win.Image(); im.onload = load; im.onerror = function () { fail('image_failed'); }; images.push(im); });
      setSituation(options.situation || 'idle', options);
      timer = win.setTimeout(function () { fail('image_timeout'); }, 15000);
      images.forEach(function (im, i) { if (!dead) im.src = assetRoot + assetFiles[i]; });
      load();
    } catch (_) { fail('webgl_setup_failed'); }
    return controller;
  }
  return Object.freeze({ mount: mount, pose: pose, rigPose: rigPose, rigPoint: rigPoint, rigParts: rigParts, torsoMaterialPoint: torsoMaterialPoint, eggOrigins:eggOrigins,eggOriginProfile:eggOriginProfile,eggVisualProfile:eggVisualProfile,eggOriginColor:eggOriginColor,evolutionCatalogue: evolutionCatalogue, evolutionProfile: evolutionProfile, evolutionFurColor: evolutionFurColor, growthProfile: growthProfile, growthPoint: growthPoint, appearanceCatalogue:appearanceCatalogue,appearanceProfile:appearanceProfile,feedingAnchor: feedingAnchor, feedingPhase: feedingPhase, outfitCatalogue: outfitCatalogue, outfitProfile: outfitProfile, outfitCoverage: outfitCoverage, situationForAction: situationForAction,
    appearanceAssets:appearanceAssets,appearancePoint:appearancePoint,toothFaceBinding:toothFaceBinding,toothMouthRegion:toothMouthRegion,toothMouthCoverage:toothMouthCoverage,handVolumeFrame:handVolumeFrame,handVolumeMesh:handVolumeMesh,handVolumeProfiles:handVolumeProfiles,nurseryLandmarks:nurseryLandmarks,nurseryFootLandmarks:nurseryFootLandmarks,nurseryRigParts:nurseryRigParts,nurseryFaceMaps:nurseryFaceMaps,nurseryFaceUV:nurseryFaceUV,nurseryDirectionViews:nurseryDirectionViews,nurseryClothingCoverage:nurseryClothingCoverage,nurserySmileCoverage:nurserySmileCoverage,nurserySmilePhase:nurserySmilePhase,eyePaintRegions:eyePaintRegions,eyePaintCoverage:eyePaintCoverage,faceMaterialThresholds:faceMaterialThresholds,faceMaterialPhase:faceMaterialPhase,faceDonorOpacity:faceDonorOpacity,
    catalogue: catalogue, bodyCatalogue: bodyCatalogue, armFlapCoverage: armFlapCoverage, directionCatalogue: directionCatalogue, directionFrame: directionFrame,locomotionFrame:locomotionFrame,shortestYawDelta:shortestYawDelta,roomWalkFrame:roomWalkFrame,roomWalkPoint:roomWalkPoint,
    directionViews:directionViews,directionPoint:directionPoint,directionCellUV:directionCellUV,directionClothingCoverage:directionClothingCoverage,directionFurColor:directionFurColor,directionProjection:directionProjection,
    durations: durations, situations: Object.freeze(catalogue.map(function(row){return row.id;})), sourceType: '2d_image_motion' });
});
