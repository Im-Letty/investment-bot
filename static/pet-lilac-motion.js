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
    {id:'body_feet',label:'足と歩調',face:'前を見て歩調を合わせる',motion:'片足を地面につけたまま反対の足を上げ交互に踏み出す'},
    {id:'body_ears',label:'耳',face:'耳の動きを気にする',motion:'左と右の耳を順に伏せてからぴんと立てる'},
    {id:'body_tail',label:'しっぽ',face:'振り返るように横を見る',motion:'付根をつないだまま尾を大きく左右へ振る'},
    {id:'body_head',label:'顔と首',face:'視線を左右へ移す',motion:'肩と手足を落ち着かせ頭だけを左右へかしげる'},
    {id:'body_joy',label:'全身でよろこぶ',face:'目を細め口を開いて笑う',motion:'手を広げて跳び耳と尾を弾ませ着地して落ち着く'}
  ].map(function(row){row.durationMs=6000;row.effect='none';return Object.freeze(row);}));
  var durations = Object.freeze(catalogue.concat(bodyCatalogue).reduce(function (result, item) { result[item.id] = item.durationMs; return result; }, {}));
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
  function outfitCoverage(id, inputX, inputY, torsoLayer) {
    var entry=outfitProfile(id), x=finite(inputX,-1), y=finite(inputY,-1), b=clothBounds;
    if (!entry) return 0;
    var mask=clothEllipse(x,y,b.x,b.y,b.rx,b.ry)*ramp(b.top,b.top+.008,y)*(1-ramp(b.hem-.006,b.hem,y));
    var paws=Math.max(clothEllipse(x,y,b.pawLX,b.pawLY,b.pawLRX,b.pawLRY),clothEllipse(x,y,b.pawRX,b.pawRY,b.pawRRX,b.pawRRY));
    if(!torsoLayer)mask*=1-paws;
    if (entry.style === 'vest') {
      var neck=1-ramp(.005,.012,Math.abs(x-.58)-Math.max(0,.755-y)*1.05);
      mask*=1-neck;
    } else if (entry.style === 'cape') {
      var opening=1-ramp(.0,.008,Math.abs(x-.58)-Math.max(0,y-.70)*.52-.018);
      mask*=1-opening; mask*=1-ramp(.866+.006*Math.cos((x-.28)*TAU*9),.874+.006*Math.cos((x-.28)*TAU*9),y);
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
  function evolutionPoint(path,inputX,inputY) {
    var profile=evolutionProfile(path), x=clamp(finite(inputX,.5),0,1), y=clamp(finite(inputY,.5),0,1);
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
  function evolutionFurColor(path,x,y,source,painted) {
    var profile=evolutionProfile(path), original=source.slice(0,3), color=(painted||source).slice(0,3);
    if(!profile.index)return color;
    var features=Math.max(clothEllipse(x,y,.4665,.429,.16,.145),clothEllipse(x,y,.7281,.3405,.137,.14),clothEllipse(x,y,.625,.48,.105,.095));
    var amount=furChroma(original)*furChroma(color)*(1-features)*.92;
    var lum=color[0]*.299+color[1]*.587+color[2]*.114, paletteLum=profile.rgb[0]*.299+profile.rgb[1]*.587+profile.rgb[2]*.114;
    return color.map(function(value,i){return value+(clamp(profile.rgb[i]*lum/Math.max(.2,paletteLum),0,1)-value)*amount;});
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
  function regionWeight(x, y, cx, cy, rx, ry) { var dx = (x - cx) / rx, dy = (y - cy) / ry; return Math.exp(-2 * (dx * dx + dy * dy)); }
  // Forward normalized coordinates. Boundary taper fixes all four frame edges, and
  // the foot line remains grounded. The exact same map positions the food prop.
  function growthPoint(stage, inputX, inputY, evolutionPath) {
    var profile = growthProfile(stage), branchPoint=evolutionPoint(evolutionPath,inputX,inputY), x=branchPoint.x, y=branchPoint.y;
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
  function feedingAnchor(stage, evolutionPath) {
    var profile = growthProfile(stage);
    var point = growthPoint(profile.key, .5 + (.628 - .5) * .88, .92 + (.499 - .92) * .88, evolutionPath);
    var x = .5 + (point.x - .5) * profile.overallScale, y = .92 + (point.y - .92) * profile.overallScale;
    return { x: x, y: y, foodLeft: x - .11, foodTop: y + .005 };
  }
  var mounted = typeof WeakMap === 'function' ? new WeakMap() : null;
  // WebGL 1 guarantees eight fragment texture units. Every expression keeps original cutout alpha.
  var assets = ['pet_lilac_original.webp', 'pet_lilac_half.webp', 'pet_lilac_closed.webp', 'pet_lilac_cutout.webp',
    'pet_lilac_sad.webp', 'pet_lilac_angry.webp', 'pet_lilac_surprise.webp', 'pet_lilac_delighted.webp', 'pet_lilac_torso_cleanplate_v1.png'];
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
      case 'cheer': p.faceDelighted = .85; p.wave = .65 + .45 * Math.abs(fast); p.pawSpread = 1; p.bounce = .6 * hop; p.bodyAngle = .035 * beat; p.tail += .9 * beat; p.stretch = .4; break;
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
  function identity() { return [1,0,0,1,0,0]; }
  function multiply(a,b) { return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]]; }
  function transform(m,p) { return {x:m[0]*p.x+m[2]*p.y+m[4],y:m[1]*p.x+m[3]*p.y+m[5]}; }
  function bone(pivot,angle,dx,dy,sx,sy) {
    var c=Math.cos(angle),s=Math.sin(angle),a=c*(sx||1),b=s*(sx||1),d=c*(sy||1),cc=-s*(sy||1);
    return [a,b,cc,d,pivot.x-a*pivot.x-cc*pivot.y+(dx||0),pivot.y-b*pivot.x-d*pivot.y+(dy||0)];
  }
  function isIn(name,list) { return list.indexOf(name)>=0; }
  // A pure frame of the hierarchical cutout rig. Matrices operate on coordinates
  // after growth/evolution, before the final normalized canvas projection.
  function rigFrame(p,seconds,age,stage,path,scale) {
    var profile=growthProfile(stage),name=p.situation,e=p.presence,a=Math.max(0,age),s=Math.max(0,seconds);
    var amount=profile.overallScale*clamp(finite(scale,1),.35,1.15)*(1-.12*e);
    var root=bone({x:.5,y:.92},-p.bodyAngle,p.shiftX,p.shiftY-p.bounce*.055+p.crouch*.012,
      1+.085*p.squash+.003*p.breath,1-.075*p.squash+.07*p.stretch-.055*p.crouch+.004*p.breath);
    var project=bone({x:.5,y:.92},0,0,0,amount,amount);root=multiply(project,root);
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
    var matrices={},angles={head:headAngle,ear_l:earL,ear_r:earR,tail:tail,arm_l:clamp(armL,-1.7,1.1),arm_r:clamp(armR,-1.1,1.7)};
    var headPivot=growthPoint(stage,.62,.675,path),head=multiply(root,bone(headPivot,headAngle));
    rigParts.forEach(function(part){
      var pivot=growthPoint(stage,part.pivot[0],part.pivot[1],path),angle=angles[part.id]||0,local=bone(pivot,angle);
      if(part.id==='head')matrices[part.id]=head;
      else if(part.parent==='head')matrices[part.id]=multiply(head,local);
      else if(part.id==='foot_l'||part.id==='foot_r'){
        var side=part.id==='foot_l'?1:-1,lift=Math.max(0,side*footStep),sole=growthPoint(stage,part.pivot[0],.92,path);
        local=bone(pivot,side*.42*lift,side*.018*footStep,-.025*lift);
        var m=multiply(root,local),current=transform(m,sole),targetY=.92-p.bounce*.055*amount-lift*(feetDemo ? .035 : .025)*amount;
        m[5]+=targetY-current.y;matrices[part.id]=m;
      }else matrices[part.id]=multiply(root,local);
    });
    // Fit only when an unusually tall combined gesture needs it. The correction
    // is shared by every bone and anchored at the floor, including planted feet.
    var bounds={minX:1,minY:1,maxX:0,maxY:0};
    rigParts.forEach(function(part){part.polygon.forEach(function(uv){var point=transform(matrices[part.id],growthPoint(stage,uv[0],uv[1],path));bounds.minX=Math.min(bounds.minX,point.x);bounds.minY=Math.min(bounds.minY,point.y);bounds.maxX=Math.max(bounds.maxX,point.x);bounds.maxY=Math.max(bounds.maxY,point.y);});});
    var fitScale=1;
    if(bounds.minY<.018)fitScale=Math.min(fitScale,(.92-.018)/(.92-bounds.minY));
    if(bounds.minX<.012)fitScale=Math.min(fitScale,(.5-.012)/(.5-bounds.minX));
    if(bounds.maxX>.988)fitScale=Math.min(fitScale,(.988-.5)/(bounds.maxX-.5));
    if(bounds.maxY>.96)fitScale=Math.min(fitScale,(.96-.92)/(bounds.maxY-.92));
    if(fitScale<1){var fit=bone({x:.5,y:.92},0,0,0,fitScale,fitScale);Object.keys(matrices).forEach(function(key){matrices[key]=multiply(fit,matrices[key]);});}
    var mouth=transform(matrices.head,growthPoint(stage,.628,.499-.010*p.chew,path));
    return {situation:name,elapsedMs:age*1000,matrices:matrices,angles:angles,mouth:mouth,pose:p,fitScale:fitScale};
  }
  function rigPose(seconds,situation,elapsedSeconds,stage,path,scale) {
    var age=Math.max(0,finite(elapsedSeconds,finite(seconds,0)));
    return rigFrame(pose(seconds,situation,age,stage,path),finite(seconds,0),age,stage,path,scale);
  }
  function rigPoint(frame,partId,x,y,stage,path) {
    var matrix=frame&&frame.matrices&&frame.matrices[partId];
    return transform(matrix||identity(),growthPoint(stage,finite(x,.5),finite(y,.5),path));
  }
  function torsoMaterialPoint(x,y) { return {x:clamp(finite(x,.5),0,1),y:clamp(finite(y,.7),.7,1)}; }
  // Ear clipping plus a one-pixel feather ring makes cropped meshes without
  // fragment polygon loops. Subdivision retains the existing growth curvature.
  function rigMesh(part,stage,path) {
    var poly=part.polygon.map(function(v){return {x:v[0],y:v[1]};}),area=0,cx=0,cy=0;
    poly.forEach(function(v,i){var next=poly[(i+1)%poly.length];area+=v.x*next.y-next.x*v.y;cx+=v.x;cy+=v.y;});
    if(area>0)poly.reverse();cx/=poly.length;cy/=poly.length;
    function cross(a,b,c){return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);}
    function inset(v,amount){var dx=cx-v.x,dy=cy-v.y,l=Math.hypot(dx,dy)||1;return {x:v.x+dx*amount/l,y:v.y+dy*amount/l};}
    var inner=poly.map(function(v){return inset(v,.0008);}),outer=poly.map(function(v){return inset(v,-.0008);}),indices=inner.map(function(_,i){return i;}),vertices=[];
    function add(a,b,c,aa,ba,ca,depth){
      if(cross(a,b,c)>0){var swap=b;b=c;c=swap;swap=ba;ba=ca;ca=swap;}
      var abLength=Math.hypot(a.x-b.x,a.y-b.y),acLength=Math.hypot(a.x-c.x,a.y-c.y),bcLength=Math.hypot(b.x-c.x,b.y-c.y),length=Math.max(abLength,acLength,bcLength);
      var grown=[growthPoint(stage,a.x,a.y,path),growthPoint(stage,b.x,b.y,path),growthPoint(stage,c.x,c.y,path)];
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
    'float paws=max(ce(p,vec2('+clothBounds.pawLX+','+clothBounds.pawLY+'),vec2('+clothBounds.pawLRX+','+clothBounds.pawLRY+')),ce(p,vec2('+clothBounds.pawRX+','+clothBounds.pawRY+'),vec2('+clothBounds.pawRRX+','+clothBounds.pawRRY+')));if(v_part<.5||v_part>1.5)mask*=1.-paws;',
    'if(kind<1.5){float neck=1.-smoothstep(.005,.012,abs(p.x-.58)-max(0.,.755-p.y)*1.05);mask*=1.-neck;}',
    'else if(kind<2.5){float opening=1.-smoothstep(.0,.008,abs(p.x-.58)-max(0.,p.y-.70)*.52-.018);mask*=1.-opening;mask*=1.-smoothstep(.866+.006*cos((p.x-.28)*6.2831853*9.),.874+.006*cos((p.x-.28)*6.2831853*9.),p.y);}',
    'else if(kind<3.5){float straps=max(cl(p,vec2(.375,.69),vec2(.455,.81),.014),cl(p,vec2(.735,.69),vec2(.69,.81),.014));float bib=smoothstep(.77,.778,p.y)*(1.-smoothstep(.145,.155,abs(p.x-.58)));mask*=max(straps,bib);}',
    'else if(kind<5.5){mask*=1.-ce(p,vec2(.58,.69),vec2(.079,.025));}',
    'else{float shoulder=max(cl(p,vec2(.38,.69),vec2(.44,.78),.017),cl(p,vec2(.738,.69),vec2(.69,.78),.017));float width=.132+max(0.,p.y-.766)*.65;float skirt=smoothstep(.756,.766,p.y)*(1.-smoothstep(width,width+.008,abs(p.x-.56)));mask*=max(shoulder,skirt);}',
    'return clamp(mask,0.,1.);}',
    'vec4 clothing(vec2 p,vec3 original,float kind){',
    'if(p.x<.26||p.x>.79||p.y<.688||p.y>.891)return vec4(0.);',
    'float mask=clothingMask(p,kind);if(mask<=0.)return vec4(0.);vec3 base='+vecColor(outfitCatalogue[0].color)+';vec3 trim='+vecColor(outfitCatalogue[0].trim)+';',
    outfitCatalogue.slice(1).map(function(entry){return 'if(kind>'+((entry.index-.5).toFixed(1))+'&&kind<'+((entry.index+.5).toFixed(1))+'){base='+vecColor(entry.color)+';trim='+vecColor(entry.trim)+';}';}).join(''),
    'float light=.85+.15*dot(original,vec3(.299,.587,.114));float weave=.006*sin(p.y*240.)*sin(p.x*190.);vec3 cloth=base*(light+weave);float seam=0.;',
    'if(kind<1.5){',
    'seam=max(cl(p,vec2(.405,.72),vec2(.43,.86),.0035),cl(p,vec2(.724,.725),vec2(.714,.858),.0035));',
    'seam=max(seam,cl(p,vec2(.579,.785),vec2(.579,.878),.0032));seam=max(seam,cl(p,vec2(.32,.87),vec2(.735,.87),.0035));',
    'float lapel=max(cb(p,vec2(.365,.728),vec2(.021,.032),.004),cb(p,vec2(.748,.727),vec2(.018,.029),.004));cloth=mix(cloth,base*.90,lapel*.35);',
    'float buttons=max(ce(p,vec2(.592,.841),vec2(.006)),ce(p,vec2(.592,.867),vec2(.006)));cloth=mix(cloth,trim,buttons*.75);',
    '}else if(kind<2.5){',
    'seam=max(cl(p,vec2(.54,.70),vec2(.465,.865),.004),cl(p,vec2(.62,.70),vec2(.71,.865),.004));',
    'float hem=cl(p,vec2(.295,.856),vec2(.44,.867),.0035)+cl(p,vec2(.72,.866),vec2(.773,.84),.0035);seam=max(seam,hem);',
    'float tie=max(ce(p,vec2(.372,.727),vec2(.016,.009)),ce(p,vec2(.399,.733),vec2(.016,.009)));cloth=mix(cloth,vec3(.96,.83,.83),tie*.9);',
    '}else if(kind<3.5){',
    'seam=max(cl(p,vec2(.578,.827),vec2(.578,.882),.003),cl(p,vec2(.438,.88),vec2(.72,.88),.0035));',
    'float pocket=cb(p,vec2(.583,.846),vec2(.05,.023),.008);float pocketIn=cb(p,vec2(.583,.844),vec2(.044,.017),.006);seam=max(seam,pocket*(1.-pocketIn));',
    'seam=max(seam,cl(p,vec2(.371,.697),vec2(.447,.806),.0028));float buttons=max(ce(p,vec2(.448,.801),vec2(.006)),ce(p,vec2(.69,.801),vec2(.006)));cloth=mix(cloth,vec3(.94,.85,.63),buttons*.8);',
    '}else if(kind<4.5){',
    'float ribs=.5+.5*sin(p.x*6.2831853*24.);cloth*=.97+.035*ribs;',
    'seam=max(cl(p,vec2(.315,.866),vec2(.741,.866),.003),cl(p,vec2(.332,.843),vec2(.337,.878),.003));',
    'float cable=cl(p,vec2(.346,.77),vec2(.367,.80),.0032)+cl(p,vec2(.367,.80),vec2(.346,.83),.0032)+cl(p,vec2(.346,.83),vec2(.367,.86),.0032);seam=max(seam,cable*.7);',
    '}else if(kind<5.5){',
    'float stars=max(max(cs(p,vec2(.337,.797),.029),cs(p,vec2(.407,.858),.025)),max(cs(p,vec2(.657,.859),.027),cs(p,vec2(.751,.817),.022)));cloth=mix(cloth,vec3(.97,.91,.73),stars*.9);',
    'seam=max(cl(p,vec2(.578,.745),vec2(.578,.88),.0035),cl(p,vec2(.32,.875),vec2(.745,.875),.0035));float buttons=max(ce(p,vec2(.59,.838),vec2(.0045)),ce(p,vec2(.59,.866),vec2(.0045)));cloth=mix(cloth,vec3(.94,.9,.84),buttons*.95);',
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
  var vertexSource = 'attribute vec2 a_position; attribute vec2 a_uv; attribute vec4 a_evolution; attribute float a_coverage; attribute float a_part; varying vec2 v_uv; varying vec4 v_evolution; varying float v_coverage; varying float v_part; void main(){v_uv=a_uv;v_evolution=a_evolution;v_coverage=a_coverage;v_part=a_part;gl_Position=vec4(a_position,0.,1.);}';
  var fragmentSource = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH', 'precision highp float;', '#else', 'precision mediump float;', '#endif',
    'varying vec2 v_uv; varying vec4 v_evolution; varying float v_coverage; varying float v_part; uniform sampler2D u_original,u_half,u_closed,u_alpha,u_sad,u_angry,u_surprise,u_delighted;',
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
    clothingShader, evolutionShader,
    'void main(){vec2 p=v_uv;float headPart=1.-step(.1,abs(v_part-6.));float torsoPart=1.-step(.1,abs(v_part-1.));',
    'float mouth=region(p,vec2(.628,.499),vec2(.080,.055))*headPart;p.y+=u_chew*.010*mouth;',
    'p.y+=(p.y-.499)*u_mouthOpen*.22*mouth;',
    // Negative narrowing is a one-eye glance with a crooked mouth, rather than
    // stretching both eyes open. The original positive range is unchanged.
    'float oneEye=max(0.,-u_eyeNarrow);float squint=max(0.,u_eyeNarrow);',
    'p.y+=oneEye*(p.x-.628)*.25*mouth;',
    // Values above the original squint range add a small nose/mouth scrunch.
    'float scrunch=max(0.,squint-1.);float nose=region(p,vec2(.621,.453),vec2(.07,.045));',
    'p.x+=(p.x-.621)*scrunch*.24*nose;p.y+=scrunch*.008*nose;',
    'float eyeL=eyeMask(p,vec2(.4665,.429),vec2(.135,.125));float eyeR=eyeMask(p,vec2(.7281,.3405),vec2(.115,.12));eyeL*=headPart;eyeR*=headPart;float eye=max(eyeL,eyeR);',
    'p.y+=.35*((p.y-.429)*(squint+oneEye)*eyeL+(p.y-.3405)*squint*eyeR);',
    'float iris=region(p,vec2(.4665,.429),vec2(.052,.059))+region(p,vec2(.7281,.3405),vec2(.045,.065));',
    'p-=u_look*iris*(1.-u_blink);vec2 uv=clamp(p,vec2(.0001),vec2(.9999));',
    'float face=1.-smoothstep(.82,1.08,length(rotation(.28)*(p-vec2(.60,.415))/vec2(.255,.215)))*headPart;',
    'vec3 original=texture2D(u_original,uv).rgb;',
    // Only the area hidden by the old arms uses generated material. The original
    // head, fur outside that patch and all source cutout alpha remain unchanged.
    'if(torsoPart>.5){float patch=max(ce(p,vec2(.518,.742),vec2(.215,.137)),ce(p,vec2(.742,.716),vec2(.14,.136)));patch=max(patch,1.-smoothstep(.695,.708,p.y));vec2 plateUV=vec2(uv.x,max(.7,uv.y));original=mix(original,texture2D(u_sad,plateUV).rgb,patch);',
    'float toes=smoothstep(.874,.89,p.y)*max(ce(p,vec2(.414,.907),vec2(.09,.035)),ce(p,vec2(.692,.897),vec2(.065,.035)));vec3 under=texture2D(u_original,vec2(uv.x,min(uv.y,.872))).rgb;original=mix(original,under,toes);}',
    'vec3 rgb=original;',
    // Pose scores select one face, not a permanent opacity. A held expression must
    // replace the old eyes completely; only the cue envelope fades between faces.
    'vec3 expression=rgb;float strongest=0.;float delighted=0.;',
    'if(headPart>.5&&u_face.x>strongest){strongest=u_face.x;expression=texture2D(u_sad,uv).rgb;}',
    'if(headPart>.5&&u_face.y>strongest){strongest=u_face.y;expression=texture2D(u_angry,uv).rgb;}',
    'if(headPart>.5&&u_face.z>strongest){strongest=u_face.z;expression=texture2D(u_surprise,uv).rgb;}',
    'if(headPart>.5&&u_face.w>strongest){strongest=u_face.w;expression=texture2D(u_delighted,uv).rgb;delighted=1.;}',
    'float weight=strongest>0.?u_presence:0.;rgb=mix(rgb,expression,face*weight);',
    // Delighted already has closed eyes. Neutral half-open blink frames would
    // paint the old pupils over that expression and create ghost eyes.
    'float blink=u_blink*(1.-delighted*u_presence);',
    'rgb=mix(rgb,texture2D(u_half,uv).rgb,eye*smoothstep(0.,.5,blink));',
    'rgb=mix(rgb,texture2D(u_closed,uv).rgb,eye*smoothstep(.5,1.,blink));',
    'rgb=evolvedFur(p,original,rgb);',
    'float blush=region(p,vec2(.405,.55),vec2(.062,.04))+region(p,vec2(.80,.445),vec2(.047,.037));',
    'rgb=mix(rgb,vec3(.99,.48,.67),clamp(blush*u_blush*.25,0.,.3));',
    'float fall=fract(u_phase*.85);float tears=max(droplet(p,vec2(.414,.51+.085*fall),vec2(.009,.018)),droplet(p,vec2(.78,.415+.07*fall),vec2(.008,.016)));',
    'rgb=mix(rgb,vec3(.43,.76,.98),tears*u_tear*.9*headPart);',
    'float sweat=droplet(p,vec2(.84,.31+.025*fract(u_phase*.7)),vec2(.011,.023));rgb=mix(rgb,vec3(.6,.83,1.),sweat*u_sweat*.85*headPart);',
    'vec2 mark=rotation(.3)*(p-vec2(.62,.245));float redMark=(1.-smoothstep(.003,.006,abs(abs(mark.x)-.012)))*(1.-smoothstep(.014,.02,abs(mark.y)));',
    'redMark=max(redMark,(1.-smoothstep(.003,.006,abs(abs(mark.y)-.012)))*(1.-smoothstep(.014,.02,abs(mark.x))));',
    'rgb=mix(rgb,vec3(.76,.13,.35),redMark*u_anger*.8*headPart);',
    'if(torsoPart>.5&&u_outfit>.5){vec4 garment=clothing(p,original,u_outfit);rgb=mix(rgb,garment.rgb,garment.a);}',
    'float a=texture2D(u_alpha,uv).a*v_coverage;if(p.x<0.||p.y<0.||p.x>1.||p.y>1.)a=0.;gl_FragColor=vec4(rgb*a,a);}'
  ].join('\n');

  function mount(canvas, options) {
    options = options || {};
    if (mounted && canvas && mounted.has(canvas)) mounted.get(canvas).destroy();
    var doc = canvas && canvas.ownerDocument, win = doc && doc.defaultView || environment;
    doc = doc || win && win.document;
    var gl, dead = false, loaded = false, readyNotified = false, pageVisible = true, frame = null, timer = null, observer = null;
    var media = null, removers = [], images = [], resources = [], locations = {};
    var phaseMs = 0, cue = 'idle', cueMs = 0, cueAnchor = 0, cueDuration = 0, last = null;
    var scale = clamp(finite(options.scale, 1), .35, 1.15), stageProfile = growthProfile(options.growthStage), branchProfile = evolutionProfile(options.evolutionPath), selectedOutfit = outfitProfile(options.outfit);
    var rigGeometry=[],restVertices=null,drawVertices=null,partAttribute=null,buffer=null,textures=[];
    var clock = typeof options.now === 'function' ? options.now : function () { return win.performance && win.performance.now ? win.performance.now() : Date.now(); };
    function listen(target, type, callback) {
      if (!target || typeof target.addEventListener !== 'function') return;
      target.addEventListener(type, callback);
      removers.push(function () { target.removeEventListener(type, callback); });
    }
    function cancel() { if (frame !== null) { win.cancelAnimationFrame(frame); frame = null; } last = null; }
    function destroy() {
      if (dead) return;
      dead = true; cancel();
      if (timer !== null) { win.clearTimeout(timer); timer = null; }
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
      values = values || {}; cue = known(name);
      cueDuration = cue === 'idle' ? 0 : clamp(finite(values.durationMs, durations[cue]), 0, 30000);
      cueMs = Math.max(0, finite(values.elapsedMs, 0)); cueAnchor = finite(clock(), 0);
      if (cue !== 'idle' && cueMs >= cueDuration) { cue = 'idle'; cueMs = 0; }
      if (loaded && !doc.hidden) paint();
      schedule();
    }
    var controller = { setSituation: setSituation, destroy: destroy };
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
    function resize() {
      if (dead) return;
      var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
      var css = rect && rect.width > 0 ? rect.width : canvas.clientWidth || 256;
      var side = Math.round(clamp(css * clamp(finite(win.devicePixelRatio, 1), 1, 2), 1, 768));
      if (canvas.width !== side || canvas.height !== side) { canvas.width = side; canvas.height = side; }
    }
    function paint() {
      if (dead || !loaded || !pageVisible || doc.hidden || canvas.isConnected === false) return;
      try {
        resize();
        var reduced = media && media.matches;
        var age = cueMs + Math.max(0, finite(clock(), cueAnchor) - cueAnchor);
        if (cue !== 'idle' && age >= cueDuration) { cue = 'idle'; cueMs = 0; cueDuration = 0; }
        var elapsed = cueDuration ? age / cueDuration * durations[cue] / 1000 : 0;
        var p = reduced ? pose(0, 'idle', 0, stageProfile.key, branchProfile.key) : pose(phaseMs / 1000, cue, elapsed, stageProfile.key, branchProfile.key);
        if (reduced) { p.tail = 0; }
        var rig=rigFrame(p,reduced?0:phaseMs/1000,elapsed,stageProfile.key,branchProfile.key,scale);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
        rigGeometry.forEach(function(part){
          var matrix=rig.matrices[part.id];
          for(var offset=part.start*5;offset<(part.start+part.count)*5;offset+=5){
            var point=transform(matrix,{x:restVertices[offset],y:restVertices[offset+1]});
            drawVertices[offset]=point.x*2-1;drawVertices[offset+1]=1-point.y*2;
          }
        });
        gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,drawVertices);
        p.scale = scale; p.anger = outfitUniform(selectedOutfit && selectedOutfit.id, p.anger);
        Object.keys(packedUniforms).forEach(function (key) {
          var fields = packedUniforms[key];
          gl.uniform4f(locations[key], p[fields[0]], p[fields[1]], p[fields[2]], p[fields[3]]);
        });
        rigGeometry.forEach(function(part){
          // A ninth texture is stored, never a ninth simultaneously active unit.
          // Only torso material temporarily borrows the unused sad-face sampler.
          if(part.id==='torso'){gl.activeTexture(gl.TEXTURE0+4);gl.bindTexture(gl.TEXTURE_2D,textures[8]);}
          gl.vertexAttrib1f(partAttribute,part.index);gl.drawArrays(gl.TRIANGLES,part.start,part.count);
          if(part.id==='torso'){gl.activeTexture(gl.TEXTURE0+4);gl.bindTexture(gl.TEXTURE_2D,textures[4]);}
        });
        if (!readyNotified) {
          readyNotified = true;
          if (typeof options.onReady === 'function') { try { options.onReady(); } catch (_) {} }
        }
        if(!dead&&cue==='feeding'&&feedingPhase(elapsed*1000).foodVisible&&typeof options.onPose==='function'){
          try{options.onPose({situation:'feeding',elapsedMs:elapsed*1000,mouthX:clamp(rig.mouth.x,0,1),mouthY:clamp(rig.mouth.y,0,1),
            foodLeft:clamp(rig.mouth.x-.11,0,1),foodTop:clamp(rig.mouth.y+.005,0,1)});}catch(_){}
        }
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
      gl.attachShader(program, shader(gl.VERTEX_SHADER, vertexSource));
      gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragmentSource));
      // Attribute zero always remains an enabled position array. The branch is
      // a constant attribute, leaving all fragment sampler/uniform limits intact.
      gl.bindAttribLocation(program, 0, 'a_position');
      gl.bindAttribLocation(program, 1, 'a_uv');
      gl.bindAttribLocation(program, 2, 'a_evolution');
      gl.bindAttribLocation(program, 3, 'a_coverage');
      gl.bindAttribLocation(program, 4, 'a_part');
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('link');
      gl.useProgram(program);
      buffer = own('createBuffer'); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      var parts=rigParts.map(function(part){return rigMesh(part,stageProfile.key,branchProfile.key);}),floatCount=parts.reduce(function(n,array){return n+array.length;},0),cursor=0;
      restVertices=new Float32Array(floatCount);
      parts.forEach(function(values,index){rigGeometry.push({id:rigParts[index].id,index:index,start:cursor/5,count:values.length/5});restVertices.set(values,cursor);cursor+=values.length;});
      drawVertices=new Float32Array(restVertices);gl.bufferData(gl.ARRAY_BUFFER,drawVertices,gl.DYNAMIC_DRAW);
      var position = gl.getAttribLocation(program, 'a_position'), uv = gl.getAttribLocation(program, 'a_uv');
      gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(uv); gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 20, 8);
      var coverage=gl.getAttribLocation(program,'a_coverage');gl.enableVertexAttribArray(coverage);gl.vertexAttribPointer(coverage,1,gl.FLOAT,false,20,16);
      partAttribute=gl.getAttribLocation(program,'a_part');gl.disableVertexAttribArray(partAttribute);
      var branchAttribute = gl.getAttribLocation(program, 'a_evolution');
      gl.disableVertexAttribArray(branchAttribute);
      gl.vertexAttrib4f(branchAttribute, branchProfile.rgb[0], branchProfile.rgb[1], branchProfile.rgb[2], branchProfile.index);
      Object.keys(packedUniforms).forEach(function (key) { locations[key] = gl.getUniformLocation(program, 'u_' + key); });
      var samplerNames = ['u_original', 'u_half', 'u_closed', 'u_alpha', 'u_sad', 'u_angry', 'u_surprise', 'u_delighted'];
      textures = assets.map(function (_, i) { if(i<8)gl.uniform1i(gl.getUniformLocation(program, samplerNames[i]), i); return own('createTexture'); });
      if (typeof win.matchMedia === 'function') media = win.matchMedia('(prefers-reduced-motion: reduce)');
      function preference() { cancel(); paint(); schedule(); }
      if (media) {
        if (media.addEventListener) listen(media, 'change', preference);
        else if (media.addListener) { media.addListener(preference); removers.push(function () { media.removeListener(preference); }); }
      }
      listen(doc, 'visibilitychange', function () { cancel(); if (!doc.hidden) { paint(); schedule(); } });
      listen(win, 'pagehide', function () { pageVisible = false; cancel(); });
      listen(win, 'pageshow', function () { pageVisible = true; paint(); schedule(); });
      listen(canvas, 'webglcontextlost', function (event) { if (event.preventDefault) event.preventDefault(); fail('context_lost'); });
      if (typeof win.ResizeObserver === 'function') { observer = new win.ResizeObserver(function () { paint(); }); observer.observe(canvas); }
      else listen(win, 'resize', paint);
      function load() {
        if (dead || loaded || images.length !== assets.length || !images.every(function (im) { return im.complete && im.naturalWidth > 0; })) return;
        try {
          var first = images[0];
          if (images.slice(0,8).some(function (im) { return im.naturalWidth !== first.naturalWidth || im.naturalHeight !== first.naturalHeight; })||images[8].naturalWidth!==images[8].naturalHeight) { fail('image_dimensions_mismatch'); return; }
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          images.forEach(function (im, i) {
            gl.activeTexture(gl.TEXTURE0 + (i<8?i:4)); gl.bindTexture(gl.TEXTURE_2D, textures[i]);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
          });
          gl.activeTexture(gl.TEXTURE0+4);gl.bindTexture(gl.TEXTURE_2D,textures[4]);
          loaded = true; canvas.hidden = false;
          if (timer !== null) { win.clearTimeout(timer); timer = null; }
          paint(); schedule();
        } catch (_) { fail('texture_failed'); }
      }
      assets.forEach(function () { var im = new win.Image(); im.onload = load; im.onerror = function () { fail('image_failed'); }; images.push(im); });
      setSituation(options.situation || 'idle', options);
      timer = win.setTimeout(function () { fail('image_timeout'); }, 15000);
      images.forEach(function (im, i) { if (!dead) im.src = assetRoot + assets[i]; });
      load();
    } catch (_) { fail('webgl_setup_failed'); }
    return controller;
  }
  return Object.freeze({ mount: mount, pose: pose, rigPose: rigPose, rigPoint: rigPoint, rigParts: rigParts, torsoMaterialPoint: torsoMaterialPoint, evolutionCatalogue: evolutionCatalogue, evolutionProfile: evolutionProfile, evolutionFurColor: evolutionFurColor, growthProfile: growthProfile, growthPoint: growthPoint, feedingAnchor: feedingAnchor, feedingPhase: feedingPhase, outfitCatalogue: outfitCatalogue, outfitProfile: outfitProfile, outfitCoverage: outfitCoverage, situationForAction: situationForAction,
    catalogue: catalogue, bodyCatalogue: bodyCatalogue, durations: durations, situations: Object.freeze(catalogue.map(function(row){return row.id;})), sourceType: '2d_image_motion' });
});
