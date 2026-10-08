# 企業発表の自動取得と出典

確認日: 2026-10-08（日本時間）。対象は日本の上場会社3社の固定情報源。全企業・全発表を網羅する収集ではありません。

## 使用する公式情報源

| 上場会社 | 新着情報 | 許可する本文 | 公開日・本文の確認 |
| --- | --- | --- | --- |
| NTT（9432.T） | [公式ニュースリリース一覧](https://group.ntt/jp/newsrelease/)に掲載された [RDF/RSS](https://group.ntt/jp/newsrelease/rss/release.rdf) | `https://group.ntt/jp/newsrelease/YYYY/MM/DD/*.html` のみ | RSSの `dc:date`、本文の `p.c-navi-2__txt`、同じ見出しの `NewsArticle.datePublished` を照合。本文は `div.contents` 内の `c-wrap-1 c-wrap-1--o-4`。発表主体を著者・本文で確認。 |
| KDDI（9433.T） | [公式RSS案内](https://www.kddi.com/rss-xml/)に掲載された [ニュースリリースRSS](https://newsroom.kddi.com/news/newsrelease.xml) | `https://newsroom.kddi.com/news/detail/kddi_nr-数字_数字.html` のみ | `pubDate`、`time.news-detail-heading1__date`、同じ見出しの `Article.datePublished` を照合。本文は `main#main` 内 `news-detail-main__content` の直接の `section`。IR記事はこのRSSに混ざっても除外。 |
| パナソニック ホールディングス（6752.T） | [公式RSS案内](https://news.panasonic.com/jp/rss/)の [プレスリリースRSS](https://news.panasonic.com/jp/rss/press/index.xml) | `https://news.panasonic.com/jp/press/jnYYMMDD-数字` のみ（拡張子なし） | `pubDate`、`p.p-detailHeader__date`、同じ見出しの `NewsArticle.datePublished` を照合。本文は `#nw-contents` 内の `TextItem__text` と本文モジュール内の見出し・表・リスト。本文冒頭の法人名で実際の発表主体を識別。 |

事業紹介の根拠は [NTT事業案内](https://group.ntt/jp/business/)、[KDDIの事業](https://www.kddi.com/corporate/ir/individual/operation/)、[パナソニックグループ事業領域](https://holdings.panasonic/jp/corporate/about/group-strategy/business-segments.html)。短い固定説明とそのURLを取得結果に添えます。事業会社による発表では、親会社の証券コードを扱うカードであっても `related_company` に実際の法人名を保持します。書き手はその子会社が発表したことを明示し、親会社自身の成果・発表として言い換えてはいけません。

2026-10-08の確認例:

- NTT [同日の発表](https://group.ntt/jp/newsrelease/2026/10/08/261008a.html)では、RSS時刻が15:00:00、記事の公開時刻が15:00:30と30秒異なりました。発表日は一致するため日単位の確認として扱い、公開時刻は未確定（`published_at=null`）とします。元の二つの時刻は確認用メタデータに残します。開催告知だけのためニュース候補には採用しません。
- KDDI [10月1日発表](https://newsroom.kddi.com/news/detail/kddi_nr-1180_4736.html)でRSSと本文の公開時刻の一致、本文抽出を確認しました。10月8日時点の72時間の対象には入りません。
- パナソニック [10月8日発表](https://news.panasonic.com/jp/press/jn261008-1)でRSSと記事の13:00公開、本文の日付を照合し、公開本文の取得が成功しました。実際の発表会社はパナソニック株式会社で、ホールディングスによる発表と同一視しません。現在の会社バッジは空なので、そこから法人名を推測せず本文冒頭を確認します。

## 取得量と日付の扱い

取得は通常15分ごとに本番サーバーの取得workerから呼び出します。取得処理自体はスケジューラやAIを呼びません。3本のRSSを並列に読み、各RSS先頭120項目までを検査し、候補を最大8件、本文を最大3件・1社1件に限定します。既に確認済み・待機中のURLは `exclude_urls` で本文の再取得を省きます。

基本の新着対象は過去72時間。未来の発表を除き、日付しか分からない資料は時刻を作りません。72時間の境界日に日付しかない資料は、境界後の発表と証明できないため除外します。発表日と実験日・発売予定日、記事確認日時を別々に保持します。

各リクエストは10秒、処理全体は40秒、レスポンスは1 MB、抽出本文は100〜20,000文字に制限。公開IPを確認してHTTPS接続先を固定し、転送・別ホスト・認証情報付きURL・任意の添付文書を取得しません。取得や本文・日付確認に失敗したものは補完しません。空の正常RSSと、取得失敗、本文確認失敗は診断結果で区別します。候補が少なくても3社を埋めません。

## 利用条件と転載の区別

公式RSSの公開は新着情報の購読手段を提供するものです。RSSがあることやrobotsの許可を、原文・画像・ロゴの再掲載許可と解釈しません。公開するのは確認した事実についての独自の短い説明と出典リンクです。原文は検証用の非公開入力・証拠としてのみ保管し、記事本文や写真を公開キャッシュ・リポジトリ・ログへ転載しません。これらの条件が独自要約に対する包括的な許諾を明記している、という判断もしていません。

- [NTTの著作権保護対象物の扱い](https://group.ntt/jp/copyright/)は、著作権保護対象物の個人利用以外の再利用・複製・再配布について書面による許可を規定しています。原文表現の流用と、事実を自分の言葉で説明することは区別します。[robots](https://group.ntt/robots.txt) は一般の取得を許可しています。
- [KDDIサイトポリシー](https://www.kddi.com/terms/sitepolicy/)は原文等の無許可の複製・改変・配布・公衆送信を制限し、通常のリンクは営利・非営利を問わず原則自由としています。フレーム表示やロゴを使った出典リンクは行いません。`https://newsroom.kddi.com/robots.txt` は確認時404でした。旧 `news.kddi.com` の本文やRSSは使いません。
- [パナソニック利用条件](https://www.panasonic.com/jp/about/terms-of-use.html)は著作物の無許可転載等を制限し、条件に従う通常リンクは連絡不要としています。[robots](https://news.panasonic.com/robots.txt) は `/jp/presskits/docs_n/` を禁止しています。今回のRSS・本文はそこに入りません。

## 今回採用しない情報源

- TDnetは [JPXの公式説明](https://www.jpx.co.jp/equities/listing/disclosure/tdnet/index.html)によると開示と同時掲載で、無料閲覧は31日分です。ただし [TDnet robots](https://www.release.tdnet.info/robots.txt) は全パス禁止、[JPX利用条件](https://www.jpx.co.jp/term-of-use/index.html)は二次利用・再配信等と高頻度取得に制約があります。公開閲覧可能という理由だけで本番の自動収集源にはしません。[正規API](https://www.jpx.co.jp/markets/paid-info-listing/tdnet/02.html)は有料なので、今回の追加費用なしという範囲では使いません。
- 日立のIR RSSは [公式終了案内](https://www.hitachi.com/ja-jp/ir/topics/rss/)で2025-09-16終了を確認。終了済みURLを新着情報源に設定しません。
- ソニーの公式サイトへの直接取得は確認時403だったため、制限の回避をせず今回の本文収集源から外しました。京セラのニュースルームは日付付きHTMLですが、今回の3社の固定RSS方式には含めません。

RSSには短い掲載期間や更新遅れがあり、正常に空だったとしても会社の全発表がないとは証明できません。今回の情報源と編集条件を満たす新着候補がなかった、と扱います。
