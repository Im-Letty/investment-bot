# 会社紹介の編集資料

確認日: 2026-09-24（日本時間）
対象データ: `static/company-profile-editorial.json`、schema version 1

## 掲載範囲

会社詳細で読むための事業紹介です。毎日のニュース、決算速報、株価の変動理由ではありません。`reviewed_on` は資料を確認・編集した日であり、会社発表日・株価取得日・各出典の更新日ではありません。

2026-09-24 に取得した本番一覧を基準に、次の **43社** を選びました。

- 高配当ランキングの先頭20社: 20/20社
- 年間配当ランキングの先頭20社: 20/20社（高配当との重複3社）
- 注目欄のNTT・日立製作所: 2/2社
- 保存時点の3%以上の上昇2社・急落3社: 5/5社（SMCは年間配当に含まれ、追加4社）

一覧の照合元は作業時の `/tmp/company-profile-top.json`、`/tmp/company-profile-yearly.json`、`/tmp/company-profile-scanner.json` と `static/company-focus.json` です。ランキングは変動します。この43社以外を調査済みとして表示せず、原稿のない会社は「紹介を準備中」等の正直な表示にしてください。上位20社より下の全社、3%未満のスキャナ銘柄全社を確認したという意味ではありません。

## 編集方針

- 各社を「どんな会社？」「暮らしとのつながり」「これから見るところ」の3区分で、各50〜100字を目安に独自に説明する。今回の129区分はすべてこの範囲内。
- 公式の会社概要、事業・製品紹介、IR資料を使用。難しい語は言い換えるか、文中で用途を説明する。広告的な「世界一」「必ず伸びる」などは使わない。
- `business` と `life` は出典で確認した事業・用途を短く説明する。`watch` はその事業から編集者が選んだ**確認すると理解が進む点**であり、会社の予想や出典の直接引用ではない。将来の売上・利益・株価の上昇を断定しない。
- 証券コード以外の株価、配当額、利回り、配当支払予定は固定原稿に入れない。これらの数値や日付は別の取得データと時点を用いる。
- 権利落ち日、配当基準日、支払日を同じものとして扱わない。今回の原稿には支払予定を推測して追加していない。
- 薬の研究結果と承認を混同しない。住宅ローン保証で返済が免除されるとは書かない。保険がすべての出来事を補償するとは書かない。
- 一次資料の文章をそのまま転載せず、本文・写真・ロゴを複製しない。出典URLは公式ページへのリンクとして保持する。

## 出典と確認範囲

各リンクは今回の調査で公式ページの本文または検索で取得できた公式本文を確認しています。表示を拒否されたページの制限回避は行っていません。検索で取得した公式本文のみを使った場合や、古い資料を安定した事業の確認に限って使った場合は下記に明記しています。

| 銘柄 | 会社 | 確認した公式資料 | 確認メモ |
| --- | --- | --- | --- |
| 7261.T | マツダ | [会社概要](https://www.mazda.com/ja/about/outline/) | 乗用車の開発・生産・販売、整備などの事業を確認。特定の新車計画や販売予想は採用しない。 |
| 3291.T | 飯田グループホールディングス | [企業情報・事業紹介](https://www.ighd.co.jp/corporate/)<br>[分譲戸建住宅事業](https://www.ighd.co.jp/sumai/detached_houses.html) | 戸建分譲を中心とする住まい関連事業と、土地仕入れから販売までの仕事、費用削減の工夫を確認。 |
| 3231.T | 野村不動産ホールディングス | [事業紹介](https://www.nomura-re-hd.co.jp/service/) | 住宅・オフィス・商業施設などの開発、賃貸、管理・仲介を確認。 |
| 7270.T | SUBARU | [企業概要・事業紹介](https://www.subaru.co.jp/outline/) | 自動車と航空宇宙の両事業を確認。地域別構成比などは記載しない。 |
| 8628.T | 松井証券 | [松井証券の取組説明・事業概要](https://www.matsui.co.jp/company/recruit/freshman/companyinfo/business/) | 個人向けオンライン証券、日本株・米国株・投資信託などの取扱いを確認。業績と株式市場の関係も公式説明にある。 |
| 5411.T | JFEホールディングス | [JFEグループの事業](https://www.jfe-holdings.co.jp/g-about/business.html) | 鉄鋼・エンジニアリング・商社の事業区分を確認。個別の設備導入ニュースは含めない。 |
| 1928.T | 積水ハウス | [事業内容](https://www.sekisuihouse.co.jp/company/info/business/) | 戸建・賃貸・分譲、管理、リフォーム、海外事業を確認。 |
| 7202.T | いすゞ自動車 | [企業情報・事業紹介](https://www.isuzu-global.com/ja/company.html) | 商用車、動力系、販売後支援、電動車の取組みを確認。電動車が普及済みとは書かない。 |
| 5714.T | DOWAホールディングス | [事業モデル](https://hd.dowa.co.jp/ja/ir/strategy/business_model.html) | リサイクルと製錬、電子材料などの事業のつながり、身近な製品への用途を確認。 |
| 7267.T | 本田技研工業 | [会社概要](https://global.honda/jp/guide/corporate-profile/) | 四輪・二輪・動力製品を確認。自動車と二輪の業績を見る点は編集上の観点。 |
| 5406.T | 神戸製鋼所 | [KOBELCOについて](https://www.kobelco.co.jp/about-kobelco/) | 鉄鋼・アルミ、機械、建設機械、電力などの事業を確認。 |
| 2914.T | 日本たばこ産業 | [JTの事業・加工食品事業](https://www.jti.co.jp/recruit/business/index.html)<br>[加工食品事業](https://www.jti.co.jp/food/index.html) | たばこと加工食品を確認。加工食品ページで冷凍うどん・米飯・パックご飯を確認。過去の医薬事業は紹介しない。 |
| 3003.T | ヒューリック | [事業紹介](https://www.hulic.co.jp/business/) | 都心駅近のオフィス・商業施設、開発・建替え、ホテル・旅館事業を確認。公式ページの検索本文を利用。直接表示は確認画面となったため回避操作は行っていない。 |
| 1925.T | 大和ハウス工業 | [大和ハウスグループの強み](https://www.daiwahouse.co.jp/ir/strength/) | 戸建・賃貸・商業・物流などの事業、用地・建築・運営を確認。 |
| 7164.T | 全国保証 | [全国保証の事業](https://www.zenkoku.co.jp/business/business.html)<br>[事業等のリスク](https://www.zenkoku.co.jp/ir/philosophy/policy_risk.html) | 保証の仕組みを確認。立替払い後も借り手の返済義務は残る点を省略しない。公式リスク説明で住宅市場・立替払いに関するリスクを確認。 |
| 4042.T | 東ソー | [製品情報](https://www.tosoh.co.jp/product/) | 基礎化学から電子材料、医療検査に関わる製品まで、製品情報の用途を確認。 |
| 3289.T | 東急不動産ホールディングス | [都市開発事業](https://www.tokyu-fudosan-hd.co.jp/business/development/)<br>[戦略投資事業](https://www.tokyu-fudosan-hd.co.jp/business/investment/) | 都市開発と戦略投資の両ページで住宅・オフィス・商業、再生可能エネルギー・物流施設を確認。鉄道事業者と混同しない。 |
| 5201.T | AGC | [AGCの事業](https://www.agc.com/company/business/index.html) | 建築・自動車ガラス、電子材料、化学品、医薬品の開発製造受託を確認。 |
| 8804.T | 東京建物 | [住宅事業](https://tatemono.com/enterprise/living.html)<br>[事業紹介](https://recruit.tatemono.com/recruit/shinsotsu/about/biz02.html) | 住宅ページと公式採用サイトの事業紹介でオフィス・住宅・商業・宿泊施設などを確認。 |
| 7751.T | キヤノン | [事業内容](https://global.canon/ja/ir/business.html) | プリンティング、医療、イメージング、産業用装置の事業を確認。 |
| 6273.T | SMC | [SMCについて](https://www.smcworld.com/about/ja-jp/)<br>[エアシリンダ](https://www.smcworld.com/select/air/ja-jp/index.html) | 自動化制御機器と空気圧機器を確認。空気で物を動かす説明は公式エアシリンダページでも確認。 |
| 9435.T | 光通信 | [事業セグメント](https://www.hikari.co.jp/business_segment/) | 現行事業セグメントの電気・ガス、通信、飲料、保険、金融、業務支援、取次販売を確認。 |
| 9983.T | ファーストリテイリング | [事業概要](https://www.fastretailing.com/jp/about/business/aboutfr.html) | 衣料ブランドと、企画から生産管理・販売までの仕組みを確認。 |
| 6861.T | キーエンス | [ビジネスモデル](https://www.keyence.co.jp/investor/business-model/)<br>[画像処理システム](https://www.keyence.co.jp/products/vision/vision-sys/) | センサー・計測・画像検査による工場支援を確認。傷や寸法の検査は製品ページを併用。 |
| 7309.T | シマノ | [シマノの事業](https://www.shimano.com/jp/recruitment/vision/) | 自転車部品、釣具を確認。自転車完成品メーカーと誤解させない説明とする。 |
| 6367.T | ダイキン工業 | [事業概要](https://www.daikin.co.jp/corporate/overview/business) | 空調・化学・フィルターの事業を確認。省エネ製品の選ばれ方は見るポイントであり売上予想ではない。 |
| 6920.T | レーザーテック | [事業内容](https://www.lasertec.co.jp/company/business.html) | 半導体関連の検査・計測、回路を写す原版などの欠陥検査を確認。 |
| 7741.T | HOYA | [事業紹介](https://www.hoya.com/business/) | 眼鏡・コンタクト・内視鏡などの医療と、半導体・表示装置・記録装置向け材料を確認。 |
| 5706.T | 三井金属 | [会社概要](https://www.mitsui-kinzoku.com/company/c_gaiyo/)<br>[機能材料事業紹介](https://em.mitsui-kinzoku.com/business-unit/) | 現行会社概要で社名を三井金属と確認。機能材料のページで極薄銅箔・排ガス浄化材料を確認。 |
| 9101.T | 日本郵船 | [事業紹介](https://www.nyk.com/profile/service/) | 自動車輸送、資源・エネルギー輸送、物流を確認。運賃が将来上がるとは書かない。 |
| 5713.T | 住友金属鉱山 | [事業紹介](https://www.smm.co.jp/business/) | 資源・製錬・材料、ニッケルから電池材料につながる事業を確認。 |
| 7974.T | 任天堂 | [会社概要](https://www.nintendo.co.jp/corporate/outline/index.html)<br>[2024年3月期 経営方針説明会 質疑応答](https://www.nintendo.co.jp/ir/pdf/2023/231109.pdf) | 会社概要の家庭用レジャー機器と、公式IR説明のゲーム機・ソフトの一体開発を確認。補足IRは2023年の資料であり、最新製品や販売予想の根拠に使わない。 |
| 8766.T | 東京海上ホールディングス | [東京海上グループについて](https://www.tokiomarinehd.com/company/about/) | 国内損害保険・生命保険と海外保険の事業を確認。保険の支払条件は契約ごとに異なることを残す。 |
| 4519.T | 中外製薬 | [ロシュとの戦略的アライアンス](https://www.chugai-pharm.co.jp/profile/strategy/roche_alliance.html)<br>[開発パイプライン](https://www.chugai-pharm.co.jp/ir/product/pipeline.html) | ロシュとの協力、研究開発と開発分野を確認。開発中の薬の効果・承認を確定扱いしない。 |
| 4021.T | 日産化学 | [製品情報](https://www.nissanchem.co.jp/products/) | 半導体・表示装置向け機能材料、農業化学品、医薬関連の製品を確認。日産自動車とは混同しない。 |
| 6504.T | 富士電機 | [製品・ソリューション](https://www.fujielectric.co.jp/products/) | 受配電・電力制御、産業設備、半導体、自動販売機などの製品を確認。 |
| 4502.T | 武田薬品工業 | [注力疾患領域](https://www.takeda.com/jp/science/areas-of-focus/)<br>[研究開発](https://www.takeda.com/jp/science/research-and-development/) | 公式の注力疾患領域と研究開発を確認。製品ごとの効果や新薬の成功確率を評価しない。 |
| 9432.T | NTT | [NTTグループの事業](https://group.ntt/jp/business/) | 通信、法人の情報システム、データセンターなどの事業を確認。現在の注目ニュースとは別の安定的な会社紹介とする。 |
| 6501.T | 日立製作所 | [製品・ソリューション](https://www.hitachi.com/ja-jp/products/) | 公式製品ページのデジタル、エネルギー、鉄道などの分野を確認。現在の注目ニュースとは別の会社紹介とする。 |
| 6857.T | アドバンテスト | [解説：半導体テスト](https://www.advantest.com/ja/about/business/) | 半導体の製造中・完成後・設計評価での試験の役割を確認。個別の株価変化の原因として結び付けない。 |
| 6098.T | リクルートホールディングス | [ビジネスモデル](https://recruit-holdings.com/ja/about/business/) | Indeed等の採用支援、人材派遣、住宅・美容・飲食等の情報と業務支援を確認。 |
| 9501.T | 東京電力ホールディングス | [グループ会社一覧](https://www.tepco.co.jp/about/corporateinfo/group/)<br>[特別事業計画](https://www.tepco.co.jp/about/corporateinfo/business_plan/overall_special_plan.html)<br>[原子力の取り組み](https://www.tepco.co.jp/electricity/mechanism_and_facilities/power_generation/nuclear_power/index-j.html) | グループの電力事業と、賠償・廃炉の責任を公式ページで確認。再稼働の予定など変化の大きい情報は原稿に固定しない。 |
| 8725.T | MS&ADインシュアランスグループホールディングス | [サステナビリティレポート2023・事業の概要](https://www.ms-ad-hd.com/ja/csr/report/main/02/teaserItems1/0/linkList/017/link/sus_report2023.pdf) | 公式2023年レポートの事業概要で国内損害保険・生命保険・海外事業を確認。現行HTMLは403だったため迂回せず、ブランド構成・統合予定・数値は書かず安定した事業説明に限定する。 |

## 保守時の確認

会社分割・事業売却・社名変更・上場廃止などが分かった場合は、数値の更新とは別に原稿を再確認する必要があります。公式ページの内容が変わった場合は事業紹介を見直し、確認日を実際に再確認した日へ更新します。確認していない原稿の日付だけを自動で新しくしないでください。

この資料は会社を知るための編集根拠です。売買の推奨順位や、値上がりしやすさの評価は付けていません。

## 配当支払時期の補足調査（会社紹介本文とは別）

調査日: 2026-09-24（日本時間）。支払時期を公式資料で確認し、権利落ち日や株主確定日から推測していません。この節はデータ実装側へ渡す資料メモです。会社紹介JSONには数値や支払日を加えていません。

| 銘柄 | 公式資料・資料の日付 | 確認できた内容 | 表示に使える範囲 |
| --- | --- | --- | --- |
| 9432.T NTT | [IR・株式カレンダー](https://group.ntt/jp/ir/shares/calendar/)（ページ最終更新2026-08-07、調査2026-09-24） | 2026年度の11月に中間配当金支払の予定を掲載。2026-06-01の期末配当金支払も掲載。 | **次回は2026年11月予定**という月単位まで。日付は未確認なので月初・月末などを補完しない。6月1日は過去の支払。 |
| 7261.T マツダ | [2026年3月期 決算短信](https://www.mazda.com/content/dam/mazda/corporate/mazda-com/ja/pdf/investors/library/result/2026/result20260512_j.pdf)（公表2026-05-12、調査2026-09-24） | 配当支払開始予定日は2026-06-25と記載。 | 既に過ぎた期末の予定日。2026年秋以降の次回支払予定には使わない。 |
| 7261.T マツダ | [IRでよくあるご質問](https://www.mazda.com/ja/investors/faq/)（調査2026-09-24） | 期末3月31日・中間9月30日の株主確定日を記載。 | 支払日ではない。次回支払日や一般的な支払月は、このFAQから確認できない。 |
| 6273.T SMC | [2026年3月期 決算短信・JPX公開](https://www2.jpx.co.jp/disc/62730/140120260513531318.pdf)（会社公表2026-05-14、調査2026-09-24） | 配当支払開始予定日は2026-06-29と記載。 | 既に過ぎた期末の予定日。次回予定には流用しない。 |
| 6273.T SMC | [2026年3月期 中間期 決算短信・JPX公開](https://www2.jpx.co.jp/disc/62730/140120251112598811.pdf)（会社公表2025-11-13、調査2026-09-24） | 配当支払開始予定日は2025-12-01と記載。 | 前年の予定日。2026年12月1日と年だけ変えて表示しない。 |
| 6273.T SMC | [IRカレンダー](https://www.smcworld.com/ir/ja-jp/calendar.html)、[株式情報](https://www.smcworld.com/ir/ja-jp/holder.html)、[FAQ](https://www.smcworld.com/ir/ja-jp/faq.html)（調査2026-09-24） | 今後の決算発表予定日と配当の基準日は確認。次回の配当支払日や月の明記は確認できなかった。 | 次回支払時期は未確認のままとする。2026-11-13は決算発表の予定であり、配当支払日ではない。 |

実装する場合は、NTTの月単位情報を `dividend_payment_period: "2026-11"` として、予定であること・出典URL・実際の確認日を一緒に扱えます。日を含む `dividend_payment_date` へ変換すると、確認していない日付をつくるため避けます。資料更新や日付経過に応じて再確認し、過去の予定を次回予定のまま残さないことが必要です。
