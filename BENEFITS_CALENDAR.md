# Shareholder benefits calendar

Company IR reviewed on 2026-09-25. The catalogue contains nine reviewed companies,
including five with a September 2026 deadline. This is a partial, manually reviewed
catalogue, not all Japanese listed companies, a popularity ranking or an automatic
benefit-data updater. Missing search results must not be described as "no benefit".

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

## Maintenance

Re-read official amendments, share splits, abolition and continuity requirements before
changing terms or verification dates. Add each future schedule only after checking the
record date, trading deadline and applicable tier. The UI shows coverage counts,
searches across months, and keeps companies with no future schedule in the unconfirmed
section. It must not silently drop those companies or manufacture the next cycle.
