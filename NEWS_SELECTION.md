# Website news selection

The website uses a fixed pair of news publishers: `NHK経済` and `ロイター経済`, listed in `WEB_NEWS_SOURCES`. An explicitly reviewed Reuters article from an attributed distribution page is still Reuters reporting; independent commentary by the host is not eligible. A missing RSS feed does not authorize automatic publisher substitution. The shared raw cache also serves the existing LINE/report flow; its other categories are not eligible for the website.

## Today first

- Use the article's original publication time, converted to Japan time (UTC+09:00).
- Never substitute an edit timestamp, retrieval time, or a guessed date.
- Missing, invalid, future-dated publications and invalid article URLs are excluded.
- Select two or three distinct, important current-day economic developments for a published edition, with Japanese economic and household relevance central. Multiple reports about one event count as one topic. The raw feed fallback remains newest-first, up to three articles.
- Deduplicate by normalized title or article URL. Differently worded reports about the same event still need editorial comparison; this is not semantic AI deduplication.
- When no eligible articles have been confirmed, show that state without padding the current-day list with older stories.
- A source outage is separate from a successfully checked feed with no eligible articles.
- Recompute selection at request time. Browser caches require policy version 4 and the current Japan-time edition date, including after midnight and delayed responses.

## One short daily summary

The front of the card shows one short headline and **200–300 Japanese characters for the two or three topics combined**. Opening Read more shows each news item with its own plain Japanese headline and **200–300 characters per article**. These individual summaries are readable together without another disclosure click or leaving the site. Publisher names remain small, with publication times and original article links alongside each summary.

`news-digests.json` holds reviewed Japanese copy. Each record contains `edition_date`, `lang: "ja"`, `headline` (1–80 characters), `summary` (200–300 characters), and `article_refs`. Every reference contains the verified `source`, normalized `url`, original `published_at` of the linked article, and its exact `title`. The authored Japanese text keeps its language marker when a reader changes the interface language.

The optional `article_summaries` list adds a `headline` (1–80 characters) and `summary` (200–300 characters) to each article's exact `source`, normalized `url`, `published_at` and original `title`. It must cover all reference articles exactly once. Partial, duplicate, mismatched or malformed copy invalidates the reviewed digest; a missing list retains the older link-only behavior. Original source titles remain in the provenance records. Both initial HTML and browser rendering use the same reviewed copy. Short paragraphs are authored with line breaks, and all rendered text is escaped.

An edition explicitly approved for publication uses `publication_mode: "curated"` and an actual `reviewed_at` timestamp. It requires two or three distinct references published on the edition's Japan date. The review must be on that same date, no earlier than any reference's publication and no later than now. The review covers every topic in the edition. RSS absence alone does not revoke a checked article, and unrelated new feed entries do not silently change the scope of its summary. A conflicting source, title or original publication timestamp observed at the same URL invalidates the edition. Multiple competing reviewed editions are ambiguous and are not published automatically.

Unmarked legacy records remain tied to the exact current live selection before headline translation. All text in either path must meet the current 200–300 character limit.

Before adding a review, read the source content, confirm its publication date, and combine overlapping events. Write for a middle-school reader: replace unfamiliar terms or explain them briefly at first use. Cover what happened, a supported effect on daily life or companies, and a concrete next development to watch. Distinguish reported facts, general economic mechanisms and possible future effects. Do not invent causes from a headline, imply that prices must move in one direction, or manufacture a Japan-related consequence. Established background sources may verify a mechanism; they are not counted or presented as another piece of today's news.

If no valid edition is available, keep current article links available and show that today's summary is not yet published. Do not fabricate extra topics or substitute older events just to reach two or three. This is a reviewed publication path; it does not yet generate future daily summaries automatically.

## Immediate first display

The root HTML includes the current news card and an inert `knInitialNews` JSON payload. `news_initial.py` starts the feed refresh without waiting for it, then renders the current curated edition or usable current feed selection. The API and HTML use the same curated selection. A published edition has `delivery: "published"`, `fetched_at: null` and a publication-date label; it is not a freshly fetched RSS response. Source-level fetch diagnostics remain separate. Cold fallback for a legacy record never revives a rejected curated edition.

The browser reads embedded content immediately, keeps it readable during pending or unavailable requests, and accepts subsequent published editions from the API. A confirmed identity conflict can replace it with live article data without the invalid summary. Published content is never saved as fresh RSS data, remains separate per interface language and expires at Japan midnight. Expanded article panels and focus survive the initial JavaScript handover.

The HTML remains revalidated on each visit. Its ETag includes the Japan date and rendered content, so a prior-day edition cannot return through an unchanged conditional response. Render's existing compression remains in use. This removes the extra news-request wait once the page arrives; network and server startup time still affect the page itself. A new day's authored summary still requires publication through the reviewed path above.

### Reviewed edition: 2026-09-22

- Body: 224 Japanese characters covering **two developments**, currency movements and US shares.
- Reuters article: [Yen squeezed as hawkish turn grips central banks](https://www.marketscreener.com/news/yen-squeezed-as-hawkish-turn-grips-central-banks-ce785adbd08ef321), Tom Westbrook / Reuters. The linked distribution page states first publication September 21, 2026 20:53 EDT, or September 22 09:53 JST. Its later modification at 01:28 EDT / 14:28 JST is not used as publication. This is the linked page's original timestamp, not a claim about the inaccessible Reuters-hosted original.
- NHK article: [Nasdaq record](https://news.web.nhk/newsweb/na/nd-20260922de51819), published September 22 09:25 JST about the September 21 US session. The index explanation was checked against the [Nasdaq Composite definition](https://indexes.nasdaq.com/Index/Overview/COMP).
- The possible effect of a weaker yen on imported food/fuel and household costs is background explanation supported by the [Bank of Japan's March 2022 press-conference record](https://www.boj.or.jp/about/press/kaiken_2022/kk220322a.htm). No past numeric data or policy decision is presented as today's news.
- Interest-rate developments are a watchpoint, not a prediction that yen or share prices will rise or fall. The copy does not claim household prices have already risen because of today's trading.
- Individual detail bodies: Reuters 220 characters and NHK 258 characters, including paragraph breaks. Each article has a separate plain-language Japanese headline. The combined 224-character front summary remains unchanged.
- The Reuters detail's 157-yen range and concern about possible official currency intervention were rechecked in the [same Reuters report distributed by Yahoo Finance](https://ca.finance.yahoo.com/news/yen-squeezed-hawkish-turn-grips-052642961.html). A possible intervention is not a confirmed decision. Publication metadata still refers to the originally linked MarketScreener page.
- Stock-index background was checked against the [Japan Exchange Group explanation](https://www.jpx.co.jp/faq/stock_price_index.html). General explanations are not additional current news reports or forecasts about every individual share.

## Important older context

`news-supplements.json` contains explicit editorial approvals and is initially empty. Only add a record after checking why it is important context for current economic news:

```json
[
  {
    "url": "https://publisher.example/article",
    "reason": "A short, plain-language explanation of why this earlier article matters now."
  }
]
```

Approval cannot invent an article or override its publication date. The URL must match an article currently obtained from the fixed sources. The article must have been published before the current edition, within seven Japan calendar days. At most one approved older article appears, in the separately labeled and dated supplement section. It never fills a vacant current-day slot. Empty, missing or invalid approval files approve nothing.

This change does not create an automated generation/publication schedule, sign up for paid news access, or send LINE messages. The existing Reuters feed may be unavailable; reconnecting licensed content or selecting a different fixed publisher requires a separate sourcing decision.
