# Shareholder benefits calendar

The catalogue contains 21 companies: the original nine reviewed on 2026-09-25 and
twelve additions reviewed on 2026-10-17. The owner chose phased expansion using free
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
