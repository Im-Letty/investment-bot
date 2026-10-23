# Shareholder benefits calendar

The catalogue contains 34 companies: the original nine reviewed on 2026-09-25,
fifteen additions reviewed on 2026-10-17, three on 2026-10-18, three on
2026-10-19, two on 2026-10-20 and two on 2026-10-23. The owner chose phased expansion using free
official sources only. This remains a partial, manually reviewed catalogue, not a
complete benefit-issuer list or automatic data updater. Missing records never mean
"no benefit". A build does not refresh the original nine's confirmation dates.

## Data and scheduling

`static/shareholder-benefits-data.js` holds company descriptions separately from an
explicit `schedules` array. `shareholder-benefits.js` renders these records. Both are
loaded before `dividend-calendar.js`; the view remains available without another fetch.

Each planned schedule combines the company's currently published recurring record
month/day with a separately checked market timetable:
https://info.monex.co.jp/stock/guide/record-date-schedule.html

| Company record date | Last cum-rights trade | Ex-rights trade |
| --- | --- | --- |
| 2026-09-30 | 2026-09-28 | 2026-09-29 |
| 2026-12-31 | 2026-12-28 | 2026-12-29 |
| 2027-02-28 | 2027-02-24 | 2027-02-25 |
| 2027-03-31 | 2027-03-29 | 2027-03-30 |

The company's formal record date is retained (including a non-trading date), never
replaced by the last exchange business day. These are labelled **現行制度に基づく予定**;
they are not represented as an explicit year-specific company announcement. No
unreviewed next-year dates are generated from the recurring months or dividend API.
Schedules with continuity conditions need their own holding explanation and must not
use the basic no-minimum-holding schedule helper.

## Reviewed programme sources

- 3088 MatsukiyoCocokara:
  https://www.matsukiyococokara.com/ir/stockinfo/benefits/
  100–499 shares, 2,000 points or donation, March/September ends. Application required;
  exact grant time is in the mailed guidance. Prescription exclusions apply.
- 3397 Toridoll:
  https://www.toridoll.com/ir/stock/shareholder/
  100–199 shares, 3,000 yen each March/September end; reuse the card for subsequent
  grants. 200+ shares with the same number at three consecutive half-year records
  qualifies for the separate one-year enhancement. Exact grant date left unspecified.
- 3563 FOOD & LIFE COMPANIES:
  https://food-and-life.co.jp/investor/stock/shareholder-benefit
  Two-for-one split effective July 2026: **100–199 shares receive 1,100 yen from
  September 2026**, not the old 1,650 yen. Three-year tier is 2,200 yen. December/June
  late-month distribution and January–June/July–December validity periods.
- 8153 MOS Food Services:
  https://www.mos.co.jp/company/ir/stockholder/yutai/
  100–299 shares, 1,000 yen each March/September end; November/June issue.
  The three-year 1,500-yen tier requires seven consecutive half-year registrations.
- 9202 ANA:
  https://www.ana.co.jp/group/investors/stock/benefit/how-to-use/
  September 2026: 100–199 shares give one domestic-flight benefit number, issued
  mid-November, valid December 2026 through May 2028. 100–499 shares also qualify
  for one Simple-fare 5% code with separate terms. No March-2026-only Peach offer.
  Do not roll these terms into March 2027: a new scale is announced at
  https://www.ana.co.jp/group/investors/stock/benefit/pdf/benefit-number-rule.pdf
- 3197 Skylark:
  https://corp.skylark.co.jp/ir/stock/incentive/
  100–299 shares, 2,000 yen per June/December end; September/March delivery.
  Electronic tickets since September 2025; a paper barcode can also be used.
- 9861 Yoshinoya:
  https://www.yoshinoya-holdings.com/ir/info/dividend/
  100–199 shares, four 500-yen tickets per February/August end; early May/mid-November
  delivery. Product exchange requires 200+ shares and is not included in the base tier.
- 8267 Aeon:
  https://www.aeon.info/ir/stock/benefit/
  Post-split base tier is **100 shares and 1% cashback**, not old 3%. Record dates
  February/August ends. New card around two months later, qualifying purchase cashback
  normally April/October. Not a fixed cash payment on card delivery.
- 9433 KDDI:
  https://www.kddi.com/corporate/ir/individual/stockholder/
  Reviewed 2026 programme: 200 shares and same shareholder number for at least one
  year, 2,000-yen equivalent for one to under five years. Applications closed August 31.
  Kept visible as next-date-unconfirmed; no new 2027 entitlement is asserted.

Excluded: Marui 8252 ended benefits after September 2022. Official notice:
https://www.0101maruigroup.co.jp/pdf/settlement/22_0805/22_0805_3.pdf

## Free official additions reviewed on 2026-10-17

Only independently written factual summaries are used, without source prose,
tables, photographs or voucher art. `benefits-data/reviewed-additions.json` and its
observation notes retain actual review scope; note hashes are not raw-page hashes.
The reviewed recent IR lists and linked amendments do not prove all past and
future changes absent.

- 3543 Komeda: https://komeda-holdings.co.jp/benefit/
  100+ shares, KOMECA 1,000 yen each February/August end. February-only extra
  1,000 yen requires 300+ current shares and the same shareholder number at seven
  consecutive half-year records. Do not require 300 shares across all seven.
  Confirmed 2026-February balance expiry is 2027-05-31; August expiry is unknown.
- 3387 Create Restaurants: https://www.createrestaurants.com/ir/stock/shareholder/
  All 11 basic tiers and four long-holding additions; current 100-share tier is
  1,500 yen each February/August end. Long additions use the minimum shares across
  three same-number half-year records, each with 800+ shares. Old SFP holding
  periods do not carry over. Conflicting individual-store applicability is not
  resolved or guaranteed.
- 9979 Daisyo: https://www.daisyo.co.jp/company/ir/invest.html
  All three tiers, 3,000/6,000/12,000 yen each February/August end. May-end and
  early-December delivery are approximate. Expiry and detailed redemption remain
  unconfirmed; an unstated holding condition is not converted to zero months.
- 2590 DyDo: https://holdings.dydo.co.jp/
  Public citation follows the homepage-link request; the actual programme URL
  remains in the internal manifest. 200+ shares for six months, January 20 and
  preceding July 20 same-number records: 6,000-yen products once a year. Shipping
  changed to late June from 2026. The five-year anniversary gift is one-time;
  discounted sales and gifts are not summed into an annual cash entitlement.
- 2809 Kewpie: https://lp.kewpie.com/ir/stocks-information/benefit/
  All four share/holding alternatives: 1,000/1,500/3,000/5,000 yen equivalent, not
  additive or freely selectable. Explicit 2026-11-30 eligibility and planned
  2027-03-06 delivery. Buying now cannot satisfy the earlier six-month registration.
  Unstated three-year registration counts or continuous 500-share history are not
  invented.

- 1738 NITTOH (Nagoya): https://www.nittoh-info.co.jp/ir/investor/
  1,000+ shares at March 31, rice gift vouchers equivalent to 5 kg once yearly.
  The September calendar component ended from fiscal 2026; the March rice benefit
  continues. Do not infer voucher count/cash value, delivery date or validity.
- 1771 Nippon Kanryu (Fukuoka): https://www.kanryu.co.jp/ir/stock/index.html
  1,000+ shares at September 30, QUO 3,000 yen for under three years or 5,000 yen
  for qualifying three-year holdings. Long eligibility needs the same number at
  13 consecutive quarterly records, each holding 1,000+ shares. Late December
  grant; do not confuse a 100-share trading lot with benefit eligibility. The
  historical programme start is not used as today's tier effective date.

These seven additions have `schedules: []`. Programme facts and delivery information
appear under next-date-unconfirmed; purchase deadlines are not fabricated. The
original 12 explicit schedules and all original nine deep values remain intact.

## Reviewed build and coverage

`scripts/build_benefits_catalogue.py` is offline: it validates issuer identity,
actual observation time/evidence hashes, manual review flags, effective versions,
all share/holding tiers and explicit schedules. It rejects accidental replacement
of the fixed original-nine snapshot. A deliberate amendment requires separate
audited re-review. Public JS omits internal evidence paths, hashes, transport times
and reviewer identities. Expired versions stop showing their old amounts as current.

The existing saved domestic-common-equity catalogue contains 3,797 unique companies
from Tokyo/Nagoya/Sapporo/Fukuoka sources dated 2026-09-30 through 2026-10-14. It is
not an independently refreshed October 17 universe or a count of benefit issuers.
Unreviewed, source-unavailable and held sources stay separate from explicit absence.

Create the reduced identity input from the canonical saved files, with no network:

```sh
python3 -B - <<'PY'
import json
from pathlib import Path
from japan_equity_catalogue import merge_companies
rows, _ = merge_companies(
    json.loads(Path('static/jpx-company-catalogue.json').read_text()),
    json.loads(Path('static/japan-equity-supplement.json').read_text()))
Path('/tmp/benefits-identities.json').write_text(json.dumps({
    'schema_version': 1, 'as_of': min(row['as_of'] for row in rows),
    'items': [{k: row[k] for k in ('code', 'symbol', 'name')} for row in rows]
}, ensure_ascii=False))
PY
python3 -B scripts/build_benefits_catalogue.py \
  --additions benefits-data/reviewed-additions.json \
  --identities /tmp/benefits-identities.json --evidence-root benefits-data \
  --as-of YYYY-MM-DD --output-dir /tmp/benefits-reviewed-build
```

Supply the actual JST review day. Review the generated diff and verification,
copy the generated JS to `static/shareholder-benefits-data.js`, and run the benefits
tests. This does not acquire new source facts, deploy or update confirmation dates.

## Maintenance

Re-read official amendments, share splits, abolition and continuity requirements before
changing terms or verification dates. Add each future schedule only after checking the
record date, trading deadline and applicable tier. The UI shows coverage counts
and keeps companies with no future schedule in the unconfirmed section. It must
not silently drop them or manufacture the next cycle. Keep existing month navigation;
do not restore the removed internal calendar search as part of data expansion.

## Further bounded review on 2026-10-17

- 1301 Kyokuyo: https://www.kyokuyo.co.jp/ir/forinvestors/index.html
  The two current official HTML programme pages and a separate reviewer agree:
  100–299 shares receive company products worth 2,500 yen; 300+ shares receive
  6,000 yen equivalent. March 31 is the recurring record date; grant is planned
  each July. Holding duration and application/selection details are unstated; no
  trade date, precise dispatch/arrival date or product expiry is inferred.
  The supplementary PDF could not be visually checked and is not the authority
  for these conditions. Dynamic IR list completeness and future amendments are
  unconfirmed. The existing nine records and seven additions remain unchanged.

The same bounded batch reviewed 1777 Kawasaki Setsubi's explicit current statement
that it offers no shareholder benefit. For 1832 Hokkai Denko, the observed
October 2026 game invitation closed applications in June; current programme and
recent amendment coverage remain unconfirmed, with a separate public-link hold.
Neither company is added as an active programme, and an expired invitation is not
classified as abolition or evidence that the company offers no other benefit.

## Latest bounded addition on 2026-10-17

- 1332 Nissui: https://www.nissui.co.jp/ir/share_information/shareholders_benefit.html
  All two current tiers: 500–999 shares receive company products worth 3,000 yen;
  1,000+ shares receive 5,000 yen equivalent. The recurring record date is March 31
  and dispatch is planned during July. The 100-share trading lot is separate from
  the 500-share benefit minimum. Holding duration is unstated; tiers are not added
  together. The ended paper-guide enclosure does not mean programme abolition.
  No purchase deadline, exact dispatch/arrival date or expiry is inferred.
  General/link terms and IR-specific disclaimers were read separately; only short
  independently written facts are stored. Dynamic IR history and every future
  amendment remain unverified. Existing 17 programmes and 12 schedules are intact.

The same batch leaves 2137 Hikari Heights Varus as programme/explicit-absence
unconfirmed. 2058 Higashimaru has an observed programme, but its usage-conditions
page returned 429; host access is held and it is not published. These are distinct
from an explicit statement that no benefit exists.

## Sapporo addition reviewed on 2026-10-17

- 2218 Nichiryo Baking: https://www.nichiryo-pan.co.jp/ir/memo.html
  The current single tier is 100+ shares (one trading lot is 100 shares), with
  company products equivalent to a sales price of 2,000 yen per registered name
  at March 31. Unstated holding duration, same-number/continuity requirements,
  applications, selection and expiry remain unconfirmed. The July 2026 company
  dispatch statement is historical; next dispatch/arrival and purchase deadline
  are unknown. No future schedule is fabricated. Identity matches the issuer and
  Sapporo listing. Short independent facts were reviewed separately; limited
  terms/amendment observations do not establish a general reuse licence or
  comprehensive absence of future changes. The authored observation-note SHA
  is not a raw-page SHA. All previous 18 programmes and 12 schedules are retained.

The same bounded batch holds 1333 UMIOS for unresolved commercial-purpose source
conditions; its 2026 rewards are not projected into later years. 2467 VLC Security
explicitly states in its current official FAQ that no shareholder benefit is
provided. Failed searches, unstated conditions and old stock-information dates
are not used to infer current absence.

## Tokyo addition reviewed on 2026-10-17

- 1375 Yukiguni Factory: https://www.yukiguni-factory.co.jp/ir/benefit/
  All three product-set tiers: 100+, 300+ and 1,000+ shares at both the prior
  September-end and March-end records qualify for 3,000/5,000/7,000 yen equivalent.
  The same shareholder number must appear at both consecutive records, with at
  least six months of continuous ownership; use the lower of the two holdings.
  One set per shareholder, without adding or freely selecting tiers. Selling all
  shares and rebuying can change the shareholder number and invalidate eligibility.
  WEB or postcard application is required; domestic shipping only. Guidance is
  expected late April–early May and shipment June–July end. WEB permits dispatch
  date selection; postcards are processed in order. The 2026 applications and
  shipments have ended. Next deadlines, precise dispatch/arrival dates, product
  contents and expiry remain unconfirmed, so no future schedule is generated.
  Current HTML conditions and identity were reviewed separately. Unexposed dynamic
  IR rows do not prove an empty history or absence of future changes. Observed
  inquiry-reply restrictions are scoped separately from independent programme
  facts; no general reuse licence is claimed. Only short independently written
  facts and an actual source link are published. The observation-note SHA is not
  a raw-page SHA. All previous 19 programmes and 12 explicit schedules are retained.

The same bounded batch leaves 2928 RIZAP as a nonpublic candidate because further
conditions remain unverified, and 272A Green Cross Holdings as programme/explicit
absence unknown. Neither is classified as a benefit issuer with a published
programme or as an explicit non-issuer.


## Further Sapporo addition reviewed on 2026-10-17

- 2976 Nippon Grande: https://www.nippon-grande.co.jp/ir/benefits.html
  All six QUO-card alternatives at the recurring March 31 record date: 100–299
  shares receive 1,000/2,000 yen, 300–499 receive 3,000/4,000 yen and 500+ receive
  5,000/6,000 yen for under one year/at least one year respectively. Long eligibility
  requires the same shareholder number at five consecutive March/June/September/
  December-end records. The necessary historical share count at each record is
  unstated; current 100/300/500-share brackets are not imposed retrospectively. A
  changed shareholder number restarts counting at the following record. The amounts
  are alternatives, without adding them or offering a free choice. Dispatch is
  planned with the resolution notice after the June shareholders meeting; actual
  dispatch/arrival, application requirements, expiry and the next purchase deadline
  remain unconfirmed. No schedule is fabricated. The current HTML supplies the
  numbers; historical disclosure titles and an unexposed dynamic IR list do not
  prove complete amendment coverage. Short independent facts and ordinary source
  links are distinct from reproducing protected content; no general reuse grant is
  claimed. All previous 20 programmes and 12 schedules are retained.

The same batch retains 259A K.UNO as a source-conditions hold after explicit
information-use and prior-contact link requirements. 2919 Marutai remains an
unpublished candidate: the current HTML confirms a 100-share minimum and annual
own products, while full tiers and reward details are unconfirmed. Its homepage
link/new-window condition is separate from those factual gaps. Two historical
PDFs were unavailable and were not retried or used as current numerical authority.


## Further Tokyo addition reviewed on 2026-10-17

- 1379 Hokuto: https://www.hokto-kinoko.co.jp/
  Public citation follows the homepage-only link policy; the programme URL is
  retained internally. At March 31, 100+ shares qualify for one product choice
  worth 4,000/1,800/1,400 yen, without adding the three choices. An additional
  3,000-yen Visa prepaid card requires 500+ shares at three consecutive half-year
  records with the same shareholder number (one year), each holding at least 500.
  Products are planned for late October–early November; qualifying cards for late
  June. Card validity is two years from issuance. Application/choice cutoff, product
  expiry, next exact dispatch/arrival and purchase deadline remain unconfirmed.
  No future schedule is generated. Dynamic IR history and the programme's original
  effective date remain unconfirmed; a completed bounded review is not an exhaustive
  guarantee of future amendments. All prior 21 programmes and 12 schedules remain intact.

The same batch retains 353A Elevator Communications as unknown: a historical one-time
programme is not repeated into another year, and the timing amendment's body was
unavailable. TRUCK-ONE 3047 has an explicit abolition notice; historical tiers are
not treated as a current benefit. Neither is added to the active catalogue.

## Nagoya addition reviewed on 2026-10-17

- 3032 Golf Do: https://www.golfdo.co.jp/ir/incentives/
  Three nonadditive coupon tiers at March 31 and September 30: 100–499 shares
  receive one coupon, 500–999 receive three and 1,000+ receive five. Holders of
  500+ shares also receive one soap item; its type cannot be selected. Holding
  duration and same-number/continuity conditions are unstated. Each coupon is
  usable once for a 20% discount on one club and 10% on multiple equipment items
  purchased together. Store and online redemption are alternatives; entering the
  online code prevents later store use. Online redemption requires free membership.
  Franchise stock, special orders, labour, shipping and fees are excluded, and
  other discounts/coupons/campaigns cannot be combined. Coupons/codes are not reissued.
  March-record coupons are valid July–December of that year; September-record
  coupons January–June of the next year. Dispatch is planned for late June or
  early–mid December, respectively, without claiming actual arrival. Returned
  gifts are held for six months after dispatch and cannot be resent afterwards.
  Gift applications/cutoffs and soap expiry remain unconfirmed. QUO eligibility
  ends with September 30, 2026; it is not added to future normal tiers. October 1
  is the usage-guide revision date, not the programme's original start or current
  tier effective date. No purchase deadline or future schedule is fabricated.
  Current HTML, issuer identity, FAQ and IR disclaimer were reviewed; dynamic
  disclosure history and all future amendments remain unconfirmed. Only short
  independent facts are published, without a general reuse-licence claim or source
  prose/table/voucher art. All prior 22 programmes and 12 schedules remain intact.

The same batch leaves 3849 Nippon Techno Lab and 3824 Media Five as unknown.
An unexplained exchange dash, unexposed dynamic IR rows and a 2025 shareholder
social-event notice do not establish current absence or a recurring future benefit.

## Further Sapporo review on 2026-10-17

- 3977 Fusion: https://www.fusion.co.jp/ir/for-investor/yuutai
  At the annual February-end record, exactly 100 shares receive a digital gift
  worth 1,000 yen and 200+ shares receive 2,000 yen. The amount for 101–199 shares
  is unconfirmed; it is not filled with zero or treated as ineligible. Holding
  duration, same-number and continuity requirements are unstated. WEB selection
  and completion of receipt within the selection period are required; the exact
  cutoff, multiple/split exchanges and gift validity remain unknown. Late May is
  the planned dispatch of guidance, not actual gift arrival. The February 18, 2026
  announcement changes exchange destinations for the February 2026 record; it is
  not used as the programme's original announcement or tier effective date.
  All eight destinations remain in the record. No purchase deadline or future
  schedule is created. The exact share boundaries and amendment scope were
  corrected and independently reviewed before adoption. The evidence-bundle SHA
  identifies authored observation notes, not raw primary-page bytes. All prior
  23 programmes and 12 explicit schedules remain intact.

The same batch classifies 137A Cocolive from its explicit current official FAQ
statement that no shareholder benefit is provided. JB Eleven 3066 remains an
unpublished active-programme candidate: unread usage-condition changes and their
correction, plus detailed long-holding tests, still need review. A failed PDF
render is not numerical-table authority. Neither company is added to the active
catalogue, and source failures never imply programme absence.

## Nagoya addition reviewed on 2026-10-18

- 3419 ArtGreen: https://artgreen.co.jp/ir/benefit/
  The single displayed tier is 100+ shares at the recurring October 31 record,
  receiving one pink midi Phalaenopsis orchid pot with one stem, worth 4,500 yen
  equivalent. A trading lot is separately confirmed as 100 shares. The dedicated
  application form is enclosed with the shareholders-meeting notice planned for
  mid-January; this is not the plant's dispatch date. Application cutoff, choice,
  substitution, plant dispatch/arrival and unstated holding/continuity tests remain
  unknown. The first programme record was October 31, 2018; it is not a current-tier
  effective date or announcement date. No purchase deadline or schedule is created.
  Current HTML/FAQ, stock identity and IR disclaimer were independently reviewed.
  Dynamic IR announcement rows were not exposed; all amendments and future changes
  are not guaranteed absent. The observation-bundle SHA is not a raw-page SHA.
  All prior 24 programmes and 12 explicit schedules remain unchanged.

The same batch leaves 5953 Showa Manufacturing as source-unavailable after a single
issuer timeout, with a separate researcher wait. FSE identity facts and its source
link-contact condition do not establish benefit absence. 1383 Bergearth remains
unknown after two actual IR links returned 404; a readable 2022 benefit announcement
is historical and is not promoted to a current programme. Neither failure means
that the company offers no benefit.

## Further Nagoya addition reviewed on 2026-10-18

- 377A Agent IG Holdings: https://a-gent.co.jp/ir/stock/
  The single displayed tier grants a 3,000-yen digital gift to holders of 100+
  shares on the December-end register. Nagoya Main identity and the separate
  100-share trading unit agree with saved StockSearch identity. Holding duration,
  same-number, continuous-register and historical share-count tests are unstated;
  they remain unknown rather than zero. The advertised exchange destinations are
  examples, not additive gifts or a guaranteed closed list. Application, selection,
  split-exchange rules, deadlines and gift expiry remain unconfirmed. Guidance is
  planned with the shareholders-meeting notice in early March of the following
  year; this is not the gift's actual dispatch or arrival. Announcement, first
  programme year and current-tier effective dates remain unknown. Dynamic IR news
  rows were not exposed, so the limited history review does not establish absence
  of amendments. No purchase deadline or year-specific schedule is fabricated.
  The read IR disclaimer is not a blanket reuse grant; unlocated general terms
  are not treated as permission or prohibition. Only short independent facts and
  the source link are adopted after a separate saved-fact review. The evidence
  bundle hashes authored notes, not primary-page bytes. All prior 25 programmes,
  nine fixed records and 12 explicit schedules remain unchanged.

The same bounded batch keeps 8398 Chikuho Bank and 1417 Mirait One under distinct
source-conditions holds. A hold or an unread programme is not benefit absence, and
these companies are not added to the active catalogue.


## Fukuoka year-specific addition reviewed on 2026-10-18

- 8554 Minami Nippon Bank: https://nangin.jp/
  Public citation follows the homepage-only link request; the actual programme
  page remains internal. This is the July 1, 2026 edition, for the March 31, 2026
  register only: 100–999 shares receive one coupon and 1,000+ receive two,
  without adding brackets. Each coupon allows one lump-sum deposit of 100,000 to
  5,000,000 yen into a one-year Super time deposit. The first term adds 0.3
  percentage points to the applicable base rate, not a fixed total rate of 0.3%.
  Handling runs July 1, 2026–June 30, 2027. Keep account, single-branch/counter,
  nontransfer/reissue, renewal, early-termination, tax and separate collateral
  overdraft conditions in the public detail. The issuer reports coupons already
  sent; exact dispatch, individual arrival and separately printed expiry are
  unknown. Buying now cannot meet the past register. No annual repetition, 2027
  entitlement or next purchase deadline is inferred. Holding duration is unstated.
  Copyright/content-use consent and source expression are separate from short
  independent facts; no general reuse grant is claimed. Only limited IR-list
  labels were checked, not every amendment. All previous 26 records and 12
  explicit schedules are preserved; this record has no schedule.

The same bounded batch verifies Interlife 1418's explicit abolition after its
February 2023 register benefit. It leaves OKWEB 3808 unknown: missing programme
information is not explicit nonimplementation, and media-service terms are not
expanded into a corporate IR prohibition or licence.


## Further independently reviewed additions on 2026-10-19

- 9942 ジョイフル: https://corporate.joyfull.co.jp/ir-complimentary
  100–499 shares: 15%割引の優待券5枚.
  500–999 shares: 15%割引の優待券10枚.
  1000+ shares: 500円の優待食事券20枚.
  2月末分は5月中旬、8月末分は10月下旬の送付予定。実発送日・個別到着日は未確認。優待券は発効日から1年間有効で、券面記載の期限を過ぎると利用できません。個々の券の発効日・期限日は未確認です。
  Holding duration remains unknown wherever its value is null; conditions are
  retained in the reviewed catalogue. No next purchase deadline or new schedule
  is inferred, and the bounded amendment review is not a claim of no future change.

All previous27 companies,18 reviewed additions,nine fixed records and12 explicit
schedules retain their original facts and confirmation dates. This remains partial
coverage. Other companies in this bounded batch are not added by this publication.


## Additional independently reviewed company on 2026-10-19

- 6025 日本ＰＣサービス: https://www.j-pcs.jp/ir/benefits
  500–999 shares: 5,000円引きサービス券6枚（額面合計30,000円相当）とリモートサポート券1枚.
  1000+ shares: 5,000円引きサービス券10枚（額面合計50,000円相当）とリモートサポート券1枚.
  毎年11月の株主総会翌日に発送予定。実発送・到着日は未確認。サービス券の具体的期限・譲渡条件は未記載。リモートサポート券は総会開催月の翌月1日から1年間、会員証に記載の期限内で繰り返し利用可。
  Holding duration remains unknown wherever its value is null; conditions are
  retained in the reviewed catalogue. No next purchase deadline or new schedule
  is inferred, and the bounded amendment review is not a claim of no future change.

All previous28 companies,19 reviewed additions,nine fixed records and12 explicit
schedules retain their original facts and confirmation dates. This remains partial
coverage. Other companies in this bounded batch are not added by this publication.


## Additional current-HTML review on 2026-10-19

- 6623 愛知電機: https://www.aichidenki.jp/ir/shareholder-benefits.html
  The single displayed tier grants a3,000-yen catalogue gift for100+ shares
  at the recurring March31 record after at least one year of continuous holding.
  The same shareholder number must show at least100 shares at3 consecutive
  March/September-end registers; changing the number loses continuity eligibility.
  The number can change after lending, selling all and repurchasing, cross-broker
  transactions, identity/address/inheritance/legal-representative changes or a
  broker transfer; the examples do not claim a number change is inevitable.
  Application/selection procedures, dispatch/arrival and expiry are unstated in
  the currentHTML. No year-specific purchase deadline or new schedule is created.
  Supplemental amendmentPDF text was read, but its tables were not visually
  verified, so it supplies no adopted numerical or version-date authority.
  Issuer/code/market agree with the dated official sources and saved StockSearch
  identity; the2024 trading-unit observation is not a current-day refresh and is
  not published as a fresh unit fact. The observation-bundle SHA is not a raw-page
  SHA. Privacy/footer observations do not establish a general reuse licence or
  blanket independent-fact prohibition. Only short original programme facts are
  published; limited latestIR headings do not prove complete amendment coverage.

All previous29 companies,20 reviewed additions,nine fixed records and12 explicit
schedules retain their original facts and confirmation dates. This remains partial
coverage; the other2 reviewed companies are not active-programme additions.


## Additional current-HTML review on 2026-10-20

- 160A アズパートナーズ: https://www.as-partners.co.jp/ir/stock/shareholder/
  100–199 shares receive, according to the contracted payment plan, a discount
  of two months of management fees under monthly plan A or 200,000 yen under
  initial-payment plan B/C. At 200+ shares these become three months or
  300,000 yen. The alternatives are not added together. The trading unit is
  separately observed as 100 shares. The issuer-operated care home's new
  admission must be for the shareholder or a relative within the third degree;
  existing residents and applications through senior-housing referral businesses,
  including online referrals, are excluded. March-end records apply to new
  contracts from April 1 to September 30; September-end records apply from
  October 1 to the following March 31. These are contract windows, not shipping
  dates or voucher expiry dates. Holding duration, same-number/register tests,
  applications, stacking with other discounts, multiple/repeated contracts,
  dispatch/arrival, voucher expiry and programme/current-tier start dates remain
  unknown. No purchase deadline or schedule is inferred. Current HTML, stock
  identity, company outline and source/link conditions were independently
  reviewed; the dynamic IR index exposed no article rows, which does not prove
  absence of amendments. Only short independent facts are used. The evidence
  SHA identifies the authored observation note, not the original page bytes.

All previous 30 companies, 21 reviewed additions, nine fixed records and 12
explicit schedules retain their facts and confirmation dates. Coverage remains
partial; the other company in the bounded review is not an active addition.


## Further current-HTML addition reviewed on 2026-10-20

- 8228 Maruichi Sansho: https://www.maruichi.com/ir/stock_information/benefit/
  Four nonadditive September-end brackets: 100-199 shares receive 2,000 yen
  equivalent in curry products; 200-499 receive 3,000 yen in processed foods;
  500-999 choose one of three 4,000-yen product options; 1,000+ choose either a
  two-item food-and-product combination or one of four 7,000-yen product options.
  The same shareholder number must appear at the March and September records
  with at least 100 shares at each, for the stated six-month holding test.
  The September share count determines the tier; its higher tier need not be
  held at March. Gifts are planned from mid-December; actual dispatch/arrival,
  application deadlines and food expiry remain unconfirmed. Announcement and
  tier-start dates are unknown, and no future purchase deadline or schedule is
  inferred. Numeric authority is the current issuer HTML, with a separate
  review of the authored factual note and numeric transcription. Stock identity
  and the 100-share trading unit are dated March 31, 2026. General copyright and
  normal new-window link conditions were read; no blanket reuse grant is claimed.
  The IR-specific disclaimer and complete amendment history remain unconfirmed.
  An unverified third-party PDF was not executed after automatic approval review
  rejected it; none of its dates, text or values is used. No source prose, table,
  image or voucher art is reproduced. The note SHA is not a raw-page SHA.

All previous 31 companies, 22 reviewed additions, nine fixed records and 12
explicit schedules retain their original values and confirmation dates. This
addition has no schedule and does not establish all-company coverage. Public
publication is verified separately from this reviewed repository build.


## Additional independently reviewed PDF-backed company on 2026-10-23

- 9914 Uematsu Shokai:
  https://uematsushokai.jp/cms/wp-content/uploads/2026/02/20260213kabunushiyutaihinmokuhenko.pdf
  From the March 20, 2026 register, the former QUO benefit becomes a choice-based
  digital gift: 100–999 shares receive 500 yen equivalent, 1,000–2,999 receive
  1,000 yen, and 3,000+ receive 3,000 yen. These brackets and exchange choices
  are not additive. Eligibility uses the annual March 20 register; one lot is
  100 shares. Holding duration and same-number/continuity tests are unstated.
  Annual late-June dispatch refers to the guidance enclosed with the post-AGM
  resolution notice, not actual gift arrival. Web selection and completion of
  receipt within the selection period are required; the exact dates and gift
  expiry remain unknown. QUO remains selectable and is separately mailed after
  the selection period. Exchange destinations are planned examples and may
  change. The February 13, 2026 announcement date and March 20 tier-effective
  date are distinct from the unknown original programme start.
  Both PDF pages and all three brackets received separate visual/fact review.
  Actual PDF SHA and authored-note SHA are stored separately. The dated Tokyo
  listing label is not copied into current local Nagoya identity. Earlier
  current HTML supports the ongoing programme; bounded disclosure review does
  not guarantee all amendments absent. General terms and an IR-specific
  disclaimer remain unlocated; no blanket reuse licence is claimed. Only short
  independent facts are published, without source tables, images or long prose.

All previous 32 companies, 23 reviewed additions, nine fixed records and 12
explicit schedules retain their values and confirmation dates. No new purchase
deadline or 2027 schedule is inferred; coverage remains partial.


## Additional current-HTML company reviewed on 2026-10-23

- 1766 Token Corporation:
  https://www.token.co.jp/ir/investors/shareholder_privilege/
  The annual April-end register has three nonadditive brackets. At 100–999
  shares, choose four weekday golf coupons (5,000 yen per person, up to four
  people per coupon) or a 4,000-yen Heartmarkshop discount coupon; a separate
  hotel accommodation 30% discount coupon covers up to ten people. At
  1,000–1,999 shares, choose a weekday one-year golf card or a 5,000-yen shop
  coupon, plus one of rice 5 kg, water 500 ml x48 or shochu 720 ml x5. At 2,000+
  shares, choose an all-day one-year card or a 6,000-yen shop coupon, plus one
  of rice 10 kg, water 500 ml x96 or shochu 720 ml x10. Both upper brackets
  separately offer an optional one-night free hotel pair invitation. The public
  conditions retain the two golf courses, per-person coupon discount, card
  shareholder-only scope and the three designated Tado Onsen facilities.
  Separate service-use privileges have their own contract/application tests;
  the annual April-end gift record is not imposed on every service contract.
  Construction-contract customers receive designated housing equipment at
  0.5%/1.0%/1.5% of base construction price by the same brackets, with an
  application and transaction proof at preliminary agreement. For 100+ share
  individuals and relatives within the third degree, rental brokerage fees
  are discounted 100%/70% for managed properties and 50%/30% for other
  properties (shareholder/family). Entry-application paperwork, late-application
  caveats and franchise, business-property, corporate and stacking exclusions
  remain explicit. A one-year golf-card duration is confirmed separately from
  its unknown exact start/end dates. Unstated holding/continuity conditions,
  programme/tier start, ordinary selection deadlines, exact coupon expiry and
  dispatch/arrival dates remain unknown. No purchase deadline or schedule is
  inferred. Root read FAQ, linking conditions, current IR index and calendar;
  the separate reviewer read the programme HTML. Six displayed IR rows do not
  prove exhaustive amendment coverage. Only independently authored facts are
  used, with observation-note SHA separate from original HTML byte SHA.

All previous 33 companies, 24 reviewed additions, nine fixed records and 12
explicit schedules retain their values and confirmation dates. This addition
has no schedule and coverage remains partial. Build and public verification
are separate steps.
