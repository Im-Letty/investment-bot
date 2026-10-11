# 企業発表の自動取得と出典

更新日: 2026-10-11（日本時間）。選定候補は検証済みの日経225の225社です。公式RSSの直接取得11社に加え、20社の発表会社別RSSと大阪ガスの別経路を登録しました。会社別の登録範囲は31社、取得経路は横断RSSを含め33本です。ただし、225社の全発表を常時網羅する取得ではありません。

構成会社の事実は、日経公式の構成銘柄資料で日付・225件・証券コード（英字コードを含む）を検証します。保持するのは会社名とコードだけで、指数の構成比率や株価換算係数は保持・転載しません。10月1日入替後の構成を10月8日の原資料で確認しました。日次更新が失敗した場合は元の日付を保ち、14日を超えて古い資料を新規候補の確認に使いません。

重要な事業の変化（買収・再編、業績予想の変更、工場・設備投資、提携、新サービス、研究・実証）を選定候補にします。発表日を優先し、同じ日の中では事業の変化を優先します。この優先度は編集上の候補選びであり、株価の上昇予測や売買推奨ではありません。人事、採用募集、イベント告知、表彰、広告だけの記事は件数を埋めるために採用しません。製品が顧客に「採用」された発表と、社員採用は区別します。

## 225社を候補にする横断入口

[PR TIMESの公開RSS](https://prtimes.jp/index.rdf)から最新200件を確認し、発表企業（`dc:corp`）が225社の法人名と厳密に一致するものを選定します。空白・全角半角・端の「株式会社」「（株）」だけを正規化し、ブランド名や本文中の企業名、推測した親子関係では対象企業に結び付けません。子会社名が親会社名に似ているだけでは採用しません。

本文URLは `https://prtimes.jp/main/html/rd/p/9桁.9桁.html` に限定します。見出し、記事上部の発表企業と企業ID、RSSの企業ID、`NewsArticle.author`、本文の原発表日を照合します。`publisher=PR TIMES` は発表会社ではありません。記事本文だけを抽出し、会社概要・おすすめ記事・広告を本文に混ぜません。

RSSの時刻は更新・発見時刻の可能性があるため、原発表時刻には使いません。原発表日はRSSの2つの日付・画面・`datePublished`の一致が必須です。画面と`datePublished`の時刻・明示された時間帯が一致する場合のみ時刻を採用し、日本時間を証明できないローカル表記は日付だけを保持します。`dateModified`で原発表日を置き換えません。10月8日のIHI・キリンではこの差を確認し、発表日だけを検証しました。

同日19時台の最新RSSでは、三菱電機の鉄道車両への新システム導入で本文・原発表日を確認しました。三井不動産のデータセンター整備はRSSが10月8日、画面と`datePublished`が10月6日、`dateModified`が10月8日でした。日付が一致しないため採用せず、更新日を新しい発表日にしません。IHI・キリンはこの時点で最新200件の外に出ており、200件という収集範囲の限界も確認しました。

事業紹介は検証済みの事業説明と根拠リンクを優先します。未登録の場合は本文先頭1,800文字を説明の根拠とする `announcement_only` とし、本文で明示された実際の発表主体の仕事だけを説明します。普段の仕事が本文で分からない場合は不明と短く書き、記憶・業種・名称から推測しません。共同相手や子会社の仕事を上場会社の通常事業とせず、計画を実施済みとして扱いません。この同じ根拠を両レビューへ渡します。

当時の構成会社225件の事実は、本文から分離した非公開・上書き不可のsnapshotで保管し、日付とhashを要約・両レビューへ結び付けます。将来の構成入替で、当時正しく検証して掲載した7日期限内の記事を不正な記事に変えません。一方、次の新規作成の候補は現在の構成会社で確認します。

snapshotの保存キーは構成事実のhashと公式CSVのhashを併用し、同日の構成会社が同じでも原資料が更新された場合を区別します。PR TIMES候補は対応する保存証拠がなければ審査・公開しません。旧キーの証拠もCSVのhashまで一致した場合だけ使います。

RSSを自動連携に使う案内は[PR TIMES公式記事](https://prtimes.com/magazine/prtimes-press-release-secondary-use/)を確認しました。[利用規約](https://prtimes.jp/main/html/kiyaku)の原文転載と事実の独自説明は区別します。原文・写真を公開せず、短い独自説明と通常の出典リンクにします。無条件のAI転載許可を確認したとは扱いません。

[公式開発記事](https://developers.prtimes.com/2025/09/25/replace_legacy_search_function/)ではRSS作成は1時間に2回と説明されています。こちらが15分ごとに確認しても、発表と同時の取得は保証できません。また、最新200件にない発表やPR TIMESへ掲載されない発表は、この横断入口だけでは確認できません。APIの `coverage.candidate_company_count=225` は選定候補の範囲であり、`all_company_announcements_covered=false` と併せて提供します。

## 発表会社ごとのRSSで最新200件から埋もれる問題を減らす

横断RSSの200件から対象記事が消えても、登録した会社ごとのRSSでその会社の最新200件までを確認できます。登録したRSSは、PR TIMESの原発表ページに実際にある「RSS」リンクから確認し、発表企業名・企業ID・現在の構成会社を照合しました。企業ごとのRSSも全発表の網羅ではなく、配信企業がPR TIMESへ掲載した発表だけです。正常な応答に新着がなくても、会社の全公式発表がないとは扱いません。

| 発表会社（構成銘柄） | 登録した企業RSSのID |
| --- | --- |
| 東京ガス（9531） | [21766](https://prtimes.jp/companyrdf.php?company_id=21766) |
| 味の素（2802） | [59753](https://prtimes.jp/companyrdf.php?company_id=59753) |
| 三井住友フィナンシャルグループ（8316） | [74664](https://prtimes.jp/companyrdf.php?company_id=74664) |
| 東日本旅客鉄道（9020） | [17557](https://prtimes.jp/companyrdf.php?company_id=17557) |
| 東海旅客鉄道（9022） | [160429](https://prtimes.jp/companyrdf.php?company_id=160429) |
| 西日本旅客鉄道（9021） | [95753](https://prtimes.jp/companyrdf.php?company_id=95753) |
| 日本航空（9201） | [30684](https://prtimes.jp/companyrdf.php?company_id=30684) |
| 商船三井（9104） | [92744](https://prtimes.jp/companyrdf.php?company_id=92744) |
| 日清製粉グループ本社（2002） | [72829](https://prtimes.jp/companyrdf.php?company_id=72829) |
| 花王（4452） | [70897](https://prtimes.jp/companyrdf.php?company_id=70897) |
| イオン（8267） | [7505](https://prtimes.jp/companyrdf.php?company_id=7505) |
| 三菱UFJフィナンシャル・グループ（8306） | [79050](https://prtimes.jp/companyrdf.php?company_id=79050) |
| ソフトバンク（9434） | [13746](https://prtimes.jp/companyrdf.php?company_id=13746) |
| ENEOSホールディングス（5020） | [39629](https://prtimes.jp/companyrdf.php?company_id=39629) |
| みずほフィナンシャルグループ（8411） | [177612](https://prtimes.jp/companyrdf.php?company_id=177612) |
| 富士通（6702） | [93942](https://prtimes.jp/companyrdf.php?company_id=93942) |
| 日立製作所（6501） | [141666](https://prtimes.jp/companyrdf.php?company_id=141666) |
| 関西電力（9503） | [64489](https://prtimes.jp/companyrdf.php?company_id=64489) |
| 三井不動産（8801） | [51782](https://prtimes.jp/companyrdf.php?company_id=51782) |
| 大成建設（1801） | [179755](https://prtimes.jp/companyrdf.php?company_id=179755) |

大阪ガスは公式ホストのタイムアウトとは独立した、同社のグループ名で発表する[DaigasグループのRSS](https://prtimes.jp/companyrdf.php?company_id=139670)を追加しました。[同グループ公式説明](https://www.daigasgroup.com/)と[発表会社プロフィール](https://prtimes.jp/main/html/searchrlp/company_id/139670)を確認した固定経路です。企業名の似た綴りから親子関係を推測する機能は追加しません。画面のDaigasグループ・企業ID・`NewsArticle.author`の一致と、本文冒頭または署名の「大阪ガス株式会社」の発表を確認できたものだけを9532の候補にします。大阪ガスケミカルやDaigasエナジーなど、子会社だけの発表は大阪ガス自身の発表へ置き換えません。9月18日の親会社発表で本文と原発表日を読み取り確認し、10月5日の子会社の発表は除外しました。この過去記事の解析確認は新記事の審査・公開成功ではありません。

東京ガスの表記「東京ガス株式会社」と構成資料の正式名「東京瓦斯」は、確認済みの企業ID21766・証券コード9531の固定対応で扱います。企業IDの違う別会社や、同じ文字を含む子会社には広げません。発表日時は既存の原文照合を維持し、グループ配信の時間帯不明の時刻は日付だけにします。

## 使用する公式情報源

| 上場会社 | 新着情報 | 許可する本文 | 公開日・本文の確認 |
| --- | --- | --- | --- |
| NTT（9432.T） | [公式ニュースリリース一覧](https://group.ntt/jp/newsrelease/)に掲載された [RDF/RSS](https://group.ntt/jp/newsrelease/rss/release.rdf) | `https://group.ntt/jp/newsrelease/YYYY/MM/DD/*.html` のみ | RSSの `dc:date`、本文の `p.c-navi-2__txt`、同じ見出しの `NewsArticle.datePublished` を照合。本文は `div.contents` 内の `c-wrap-1 c-wrap-1--o-4`。発表主体を著者・本文で確認。 |
| KDDI（9433.T） | [公式RSS案内](https://www.kddi.com/rss-xml/)に掲載された [ニュースリリースRSS](https://newsroom.kddi.com/news/newsrelease.xml) | `https://newsroom.kddi.com/news/detail/kddi_nr-数字_数字.html` のみ | `pubDate`、`time.news-detail-heading1__date`、同じ見出しの `Article.datePublished` を照合。本文は `main#main` 内 `news-detail-main__content` の直接の `section`。IR記事はこのRSSに混ざっても除外。 |
| パナソニック ホールディングス（6752.T） | [公式RSS案内](https://news.panasonic.com/jp/rss/)の [プレスリリースRSS](https://news.panasonic.com/jp/rss/press/index.xml) | `https://news.panasonic.com/jp/press/jnYYMMDD-数字` のみ（拡張子なし） | `pubDate`、`p.p-detailHeader__date`、同じ見出しの `NewsArticle.datePublished` を照合。本文は `#nw-contents` 内の `TextItem__text` と本文モジュール内の見出し・表・リスト。本文冒頭の法人名で実際の発表主体を識別。 |
| トヨタ自動車（7203.T） | [公式RSS案内](https://global.toyota/jp/rss_feeds/)の [全ニュースRSS](https://global.toyota/export/jp/allnews_rss.xml) | `global.toyota/jp/newsroom/` の corporate・toyota・lexus の数字.html | 本文の同じ見出し・元の発表日とRSSを照合。時刻は補わず、発表主体を本文の署名・冒頭で確認。 |
| 本田技研工業（7267.T） | [公式RSS案内](https://global.honda/jp/rss/)の [ニュースRSS](https://global.honda/jp/rss/hotnews.xml) | `global.honda/jp/news/YYYY/` の固定リリース形式のみ | 同じ見出し・補助見出し・画面の発表日・同じ記事の `datePublished` を照合。不正な time 属性は使わず、HondaJet等の別主体は親会社へ帰属させない。 |
| ソフトバンクグループ（9984.T） | [プレスリリースRSS](https://group.softbank/news/press/index.rdf) | `group.softbank/news/press/YYYYMMDD` と枝番号のみ | 原文の見出し・time・本文を照合。画面の時刻とRSSが一致した場合だけ時刻を保持。 |
| 日本電気（6701.T） | [公式ニュース案内](https://jpn.nec.com/jpn/news/news.html)の [プレスRSS](https://jpn.nec.com/ja/press/press.xml) | `jpn.nec.com/press/YYYYMM/YYYYMMDD_数字.html` のみ | 画面の元の見出し・発表日・日本電気株式会社の発表主体を照合。問い合わせ以降は本文に含めない。 |
| 電通グループ（4324.T） | [ニュースリリースRSS](https://www.group.dentsu.com/jp/news/release/index.xml) | `www.group.dentsu.com/jp/news/release/6桁.html` のみ | 記事の見出し・発表日・本文を照合。ファンドや投資先だけの発表を、本文中の親会社名だけで採用しない。 |
| 三菱重工業（7011.T） | [公式RSS案内](https://www.mhi.com/jp/rss)の [ニュースRSS](https://www.mhi.com/jp/rss/mhi_news.xml) | `www.mhi.com/jp/news/6桁または8桁.html` のみ | 元の見出し・画面の発表日・本文を照合。確認した時刻属性には時間帯の矛盾があるため、時刻を作らず日付だけ保持。 |
| 大阪ガス（9532.T） | [公式RSS案内](https://www.osakagas.co.jp/company/press/about_rss/index.html)の [プレスRSS](https://www.osakagas.co.jp/company/press/rss/index.xml) | `www.osakagas.co.jp/company/press/prYYYY/数字_数字.html` のみ | 同じ見出し・元の発表日・本文の大阪ガス株式会社を確認。構成銘柄資料の正式名「大阪瓦斯」とコードで照合。PDFは取得しない。 |
| ブリヂストン（5108.T） | [公式プレスRSS](https://www.bridgestone.co.jp/corporate/news/rss/bridgestone_news.xml) | `www.bridgestone.co.jp/corporate/news/YYYYMMDD番号.html` のみ | 同じ見出し・元の発表日・本文の発表主体を確認。問い合わせ欄を除外し、広告だけの発表は重要度選定から除外。 |

追加8社のRSSと原文の実際の構造を2026-10-11に確認しました。追加取得元は、当時の日経225構成会社の保存証拠も必須です。原文の企業名が共同相手・親会社への言及や末尾の紹介にあるだけでは、発表主体とみなしません。固定の署名または本文冒頭の発表主体で確認します。事業説明未登録時はPR TIMESと同じ `announcement_only` 方針を使い、その記事本文の根拠と構成会社のsnapshotを両レビューへ渡します。

事業紹介の根拠は [NTT事業案内](https://group.ntt/jp/business/)、[KDDIの事業](https://www.kddi.com/corporate/ir/individual/operation/)、[パナソニックグループ事業領域](https://holdings.panasonic/jp/corporate/about/group-strategy/business-segments.html)。短い固定説明とそのURLを取得結果に添えます。事業会社による発表では、親会社の証券コードを扱うカードであっても `related_company` に実際の法人名を保持します。書き手はその子会社が発表したことを明示し、親会社自身の成果・発表として言い換えてはいけません。

2026-10-08の確認例:

- NTT [同日の発表](https://group.ntt/jp/newsrelease/2026/10/08/261008a.html)では、RSS時刻が15:00:00、記事の公開時刻が15:00:30と30秒異なりました。発表日は一致するため日単位の確認として扱い、公開時刻は未確定（`published_at=null`）とします。元の二つの時刻は確認用メタデータに残します。開催告知だけのためニュース候補には採用しません。
- KDDI [10月1日発表](https://newsroom.kddi.com/news/detail/kddi_nr-1180_4736.html)でRSSと本文の公開時刻の一致、本文抽出を確認しました。10月8日時点の72時間の対象には入りません。
- パナソニック [10月8日発表](https://news.panasonic.com/jp/press/jn261008-1)でRSSと記事の13:00公開、本文の日付を照合し、公開本文の取得が成功しました。実際の発表会社はパナソニック株式会社で、ホールディングスによる発表と同一視しません。現在の会社バッジは空なので、そこから法人名を推測せず本文冒頭を確認します。

## 取得量と日付の扱い

取得は通常15分ごとに本番サーバーの取得workerから呼び出します。取得処理自体はスケジューラやAIを呼びません。公式RSS11本、発表会社別RSS20本、大阪ガスの別経路1本、横断RSS1本を、最大3通信の並列処理・合計40秒で読みます。公式RSSと大阪ガスの別経路は各120件、発表会社別RSSと横断RSSは各200件までを検査し、本文確認の候補を最大8社、成功した本文を1回最大3件・1社1件に限定します。同じ会社の複数の見出しが別会社の候補枠を占めないよう、社ごとに選びます。本文確認に失敗した場合は、同じ予算内で次の別会社を確認します。配信元の固定順ではなく、発表日と編集上の優先度で候補を選びます。既に確認済み・待機中のURLは `exclude_urls` で本文の再取得を省きます。登録経路の増加で取得の時間上限や日次AI作成回数を増やしません。

非公開候補一覧は会社ニュース専用の100件単位のページ取得とし、1日300件・3日900件までを確認します。最初の30件だけで重要度を判定しません。60秒の確認予算や件数上限を超えた場合は一部だけで審査を始めず、取得済みの変更不可な本文を3日範囲のcacheで再利用します。朝版の保管・一覧取得の条件は変更しません。

公開一覧の3社への固定は撤廃しています。画面の表示件数・「もっと見る」は既存の最大6件の表示方針を維持し、この取得元追加では変更しません。新規AI作成は既存の費用保護（日次最大3回の作成・照合、失敗も消費、同じ本文の自動再課金なし）を維持します。この作成予算と「対象企業を3社に固定すること」は別です。1日3回の作成予算を増やしてはいません。

一部の配信元が失敗しても、本文・日付が検証済みの記事をほかの配信元の障害だけで止めません。取得健康度は `collection_health` と配信元ごとの固定診断へ分離します。一部失敗の空の取得を、225社すべてに新しい発表がないという意味にはしません。

通信失敗はDNS・TLS・タイムアウト・接続失敗の固定コードで区別し、例外の文章・応答本文・秘密値を診断へ含めません。証明書確認、接続先の公開IP確認、時間と件数の上限は維持します。2026-10-11の本番初回では大阪ガスだけ通信失敗があり、ローカル正常応答を本番正常応答と混同しません。

基本の新着対象は過去72時間。未来の発表を除き、日付しか分からない資料は時刻を作りません。72時間の境界日に日付しかない資料は、境界後の発表と証明できないため除外します。発表日と実験日・発売予定日、記事確認日時を別々に保持します。

各URLは合計10秒、処理全体は40秒、レスポンスは1 MB、抽出本文は100〜20,000文字に制限。DNSの全応答が公開IPであることを確認してHTTPS接続先を固定します。接続失敗・タイムアウトの場合だけ、同じDNS応答の2番目の公開IPまで同じ時間予算で試します。元のホスト名・TLSの証明書確認は維持し、証明書エラー・HTTPエラー・転送の場合は別IPを試しません。転送・別ホスト・認証情報付きURL・任意の添付文書を取得しません。取得や本文・日付確認に失敗したものは補完しません。空の正常RSSと、取得失敗、本文確認失敗は診断結果で区別します。候補が少なくても3社を埋めません。

## 利用条件と転載の区別

公式RSSの公開は新着情報の購読手段を提供するものです。RSSがあることやrobotsの許可を、原文・画像・ロゴの再掲載許可と解釈しません。公開するのは確認した事実についての独自の短い説明と出典リンクです。原文は検証用の非公開入力・証拠としてのみ保管し、記事本文や写真を公開キャッシュ・リポジトリ・ログへ転載しません。これらの条件が独自要約に対する包括的な許諾を明記している、という判断もしていません。

- [NTTの著作権保護対象物の扱い](https://group.ntt/jp/copyright/)は、著作権保護対象物の個人利用以外の再利用・複製・再配布について書面による許可を規定しています。原文表現の流用と、事実を自分の言葉で説明することは区別します。[robots](https://group.ntt/robots.txt) は一般の取得を許可しています。
- [KDDIサイトポリシー](https://www.kddi.com/terms/sitepolicy/)は原文等の無許可の複製・改変・配布・公衆送信を制限し、通常のリンクは営利・非営利を問わず原則自由としています。フレーム表示やロゴを使った出典リンクは行いません。`https://newsroom.kddi.com/robots.txt` は確認時404でした。旧 `news.kddi.com` の本文やRSSは使いません。
- [パナソニック利用条件](https://www.panasonic.com/jp/about/terms-of-use.html)は著作物の無許可転載等を制限し、条件に従う通常リンクは連絡不要としています。[robots](https://news.panasonic.com/robots.txt) は `/jp/presskits/docs_n/` を禁止しています。今回のRSS・本文はそこに入りません。

## 今回採用しない情報源

- TDnetは [JPXの無料閲覧案内](https://www.jpx.co.jp/listing/disclosure/01.html)でスクレイピング等による自動取得を控えるよう明記しています。[TDnet robots](https://www.release.tdnet.info/robots.txt)も全パス禁止です。無料閲覧を自動収集に転用したり、非公式の代理APIで制限を回避しません。[正規API](https://www.jpx.co.jp/markets/paid-info-listing/tdnet/02.html)は有料なので、今回の追加のデータ契約なしという範囲では使いません。
- 日立のIR RSSは [公式終了案内](https://www.hitachi.com/ja-jp/ir/topics/rss/)で2025-09-16終了を確認。終了済みURLを新着情報源に設定しません。
- ソニーの公式サイトへの直接取得は確認時403だったため、制限の回避をせず今回の本文収集源から外しました。京セラのニュースルームは日付付きHTMLですが、今回の固定RSS方式には含めません。
- 住友商事の案内されたRSSは記事URLが localhost だったため登録しません。キリン・武田のRSSは個人利用の条件があり、伊藤忠・アステラスも今回の用途でリンク等の条件が未解決のため追加しません。

RSSには短い掲載期間や更新遅れがあり、正常に空だったとしても会社の全発表がないとは証明できません。今回の情報源と編集条件を満たす新着候補がなかった、と扱います。
