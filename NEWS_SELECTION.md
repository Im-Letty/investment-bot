# Website news selection

The website uses a fixed pair of news publishers: `NHK経済` and `ロイター経済`, listed in `WEB_NEWS_SOURCES`. An explicitly reviewed Reuters article from an attributed distribution page is still Reuters reporting; independent commentary by the host is not eligible. A missing RSS feed does not authorize automatic publisher substitution. The shared raw cache also serves the existing LINE/report flow; its other categories are not eligible for the website.

## Today first

- Use the article's original publication time, converted to Japan time (UTC+09:00).
- Never substitute an edit timestamp, retrieval time, or a guessed date.
- Missing, invalid, future-dated publications and invalid article URLs are excluded.
- Select up to three distinct, important current-day economic developments (normally two or three; one is valid on a quiet morning) for a published edition, with Japanese economic and household relevance central. Multiple reports about one event count as one topic. The raw feed fallback remains newest-first, up to three articles.
- Deduplicate by normalized title or article URL. Differently worded reports about the same event still need editorial comparison; this is not semantic AI deduplication.
- When no eligible articles have been confirmed, show that state without padding the current-day list with older stories.
- A source outage is separate from a successfully checked feed with no eligible articles.
- Recompute selection at request time. Live RSS caches require policy version 4 and the current Japan-time date. Curated publications keep their actual edition date until a newer validated edition is released, including across midnight and temporary source outages.

## One short daily summary

The front of the card shows one short headline and **200–300 Japanese characters for the two or three topics combined**. Opening Read more shows each news item with its own plain Japanese headline and **200–300 characters per article**. These individual summaries are readable together without another disclosure click or leaving the site. Publisher names are listed once beside the footer publication date, without repeating them on each article. Publication times and original article links remain alongside each summary.

`news-digests.json` holds reviewed Japanese copy. Each record contains `edition_date`, `lang: "ja"`, `headline` (1–80 characters), `summary` (200–300 characters), and `article_refs`. Every reference contains the verified `source`, normalized `url`, original `published_at` of the linked article, and its exact `title`. The authored Japanese text keeps its language marker when a reader changes the interface language.

The optional `article_summaries` list adds a `headline` (1–80 characters) and `summary` (200–300 characters) to each article's exact `source`, normalized `url`, `published_at` and original `title`. It must cover all reference articles exactly once. Partial, duplicate, mismatched or malformed copy invalidates the reviewed digest; a missing list retains the older link-only behavior. Original source titles remain in the provenance records. Both initial HTML and browser rendering use the same reviewed copy. Short paragraphs are authored with line breaks, and all rendered text is escaped.

An edition explicitly approved for publication uses `publication_mode: "curated"` and an actual `reviewed_at` timestamp. It requires one to three distinct references published on the edition's Japan date; do not invent a second topic on a quiet day. The review must be on that same date, no earlier than any reference's publication and no later than now. The review covers every topic in the edition. RSS absence alone does not revoke a checked article, and unrelated new feed entries do not silently change the scope of its summary. A conflicting source, title or original publication timestamp observed at the same URL invalidates the edition. The latest released edition is selected by edition date and release timestamp. Equal latest dates/timestamps are ambiguous and revoke cached publication. An optional `publish_at` timestamp must be on the edition date and no earlier than `reviewed_at`; it gates prepared editions until their release time. Morning editions use 08:00 Japan time. A delayed or failed new edition leaves the previous publication under its original date.

Unmarked legacy records remain tied to the exact current live selection before headline translation. All text in either path must meet the current 200–300 character limit.

Before adding a review, read the source content, confirm its publication date, and combine overlapping events. Write for a middle-school reader: replace unfamiliar terms or explain them briefly at first use. Cover what happened, a supported effect on daily life or companies, and a concrete next development to watch. Distinguish reported facts, general economic mechanisms and possible future effects. Do not invent causes from a headline, imply that prices must move in one direction, or manufacture a Japan-related consequence. Established background sources may verify a mechanism; they are not counted or presented as another piece of today's news.

If no valid edition has ever been published, keep current article links available and show that today's summary is not yet published. Do not fabricate extra topics or substitute older events just to reach two or three. The automatic website producer described below uses independently retrieved bodies, Claude drafting, and a separate Gemini editorial check. Automated review can miss errors; it is not a guarantee of factual correctness.

## Immediate first display

The root HTML includes the current news card and an inert `knInitialNews` JSON payload. `news_initial.py` starts the feed refresh without waiting for it, then renders the current curated edition or usable current feed selection. The API and HTML use the same curated selection. A published edition has `delivery: "published"`, `fetched_at: null` and a publication-date label; it is not a freshly fetched RSS response. Source-level fetch diagnostics remain separate. Cold fallback for a legacy record never revives a rejected curated edition.

The browser reads embedded content immediately, keeps it readable during pending or unavailable requests, and accepts subsequent published editions from the API. A confirmed identity conflict sets `publication_revoked` and replaces it with live article data without the invalid summary. Published content is persisted separately from RSS under `kn_published_news_v1_<lang>`, stays separate per interface language, and does not disappear at midnight. The browser checks the 08:00 JST publication boundary once, then uses the normal two-minute refresh interval; it does not poll every second when the visible edition is older. Expanded article panels and focus survive the initial JavaScript handover.

The HTML remains revalidated on each visit. Its ETag includes the Japan date and rendered content, so changed publications and dates are revalidated. Prepared editions are omitted until `publish_at`, and their release changes the ETag. Render's existing compression remains in use. This removes the extra news-request wait once the page arrives; network and server startup time still affect the page itself. A new day's authored summary still requires publication through the reviewed path above.

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

The legacy Reuters RSS may be unavailable. The website producer uses approved publisher article pages and explicitly attributed Reuters distribution pages, with original publication metadata and article bodies verified separately from search. It does not bypass access restrictions or substitute publishers. No LINE messages are sent.


## Publication operation and 08:00 release

`publish_news.py issue.json --check-only` validates a reviewed edition without writing. Running it without `--check-only` atomically replaces only that edition date in `news-digests.json`, retains the latest 30 editions and leaves all published data unchanged on invalid input or write failure. It does not collect source content, generate copy, send LINE or call AI. A producer must run before 08:00, verify source content, set the actual `reviewed_at`, and set `publish_at` to that day's 08:00 JST (or the actual later publication time when late). Do not backdate a late review to pretend that it was ready at 08:00.

The server runs `daily_news_runtime.py` every 30 seconds after a serving worker receives its first request (the external wake/check supplies this even without visitors). Startup is deferred until after Gunicorn fork; inherited locks, threads and HTTP pools are reset in each child process. Preparation begins at 07:45 Japan time; verified prepared editions are released at 08:00. Late editions keep their actual review/release time. A dated edition already checked into the repository takes precedence over unnecessary regeneration.

`daily_news_producer.py` collects independently verified current-day article bodies. Gemini Search may discover candidate URLs; its snippets or generated text are never used as source articles. Claude writes one 200–300-character combined summary and one 200–300-character summary per selected article. Gemini separately checks all copy against source bodies for facts, dates, economic relevance, distinct topics, readability, unsupported outlook and copied wording. Every check must pass. Invalid lengths or source indexes get at most one repair. Measured character counts accompany length repair, including one format repair after editorial rewrite. Editorial rejection gets at most three rewrites, each followed by a fresh independent review; repeated rejection never publishes. No eligible body or a failed editorial check leaves the previous edition untouched.

`daily_news_sources.py` fixes the publishers to NHK and Reuters, allowing explicitly Reuters-attributed articles distributed by MarketScreener, Euronext or Newsweek Japan. Dates must be original timezone-bearing publication metadata on the article; modified/retrieval dates and search snippets are never substituted. Access-denied pages are skipped. Redirects, response bytes, duration and article counts are bounded. Missing current articles do not authorize old articles presented as today.

Private Supabase Storage bucket `website-news` stores daily attempt claims and validated editions before local publication. Only a server service key is accepted; the bucket must be private. Unique create-only attempt claims coordinate workers and survive restart; there are at most eleven generation attempts per Japan day, at least 5 minutes apart. A successful edition prevents additional paid generation that day. The runtime restores durable copy to `NEWS_RUNTIME_PATH` (default `/tmp/kn-daily-news.json`) and merges it with committed editions. The browser and initial HTML both read this merged publication history without waiting for AI or Storage.

Existing `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `SUPABASE_URL` and service-role `SUPABASE_KEY` are required. Optional model overrides are `NEWS_GEMINI_MODEL` and `NEWS_CLAUDE_MODEL`; defaults match the existing application's Gemini 2.5 Flash and Claude Haiku 4.5. `DAILY_NEWS_ENABLED=0` stops automatic paid generation while retaining published content. AI provider charges follow the existing account plans; retries and output sizes are bounded. No new paid hosting plan or news subscription is created.

`.github/workflows/daily-website-news.yml` starts an external wake/check at 07:32 JST to keep the Render instance reachable through preparation/publication, then verifies the actual public news API. Manual dispatch is supported. The server owns generation and publication; the workflow cannot supply arbitrary prompts or dates and uses no secrets. `/api/news-publication` exposes only operational status/configuration names, never key values or provider responses. A delayed GitHub cron or sleeping/unavailable free host can delay preparation; this is an 08:00 target with recovery, not an exact-time availability guarantee. The workflow reports failure if the current public edition cannot be confirmed.

## Immediate market display

`market_snapshot.py` supplies verified saved prices in the initial HTML (`knInitialMarket`) and through `/api/morning-data` without awaiting Yahoo requests. The server refreshes at most three quotes concurrently in one background job. The frontend displays these values or newer local values immediately, then refreshes independently of news. Each quote retains its original retrieval timestamp; stale values display that timestamp in JST. Snapshots older than seven days are rejected. `market-snapshot.json` is a verified deployment seed, not live or fictional pricing. Runtime snapshots are saved to `MARKET_SNAPSHOT_PATH` (default `/tmp/kn-market-snapshot-v1.json`); ephemeral hosting and a first unseen custom symbol still need a successful upstream refresh. Network delivery and hosting startup remain outside this local cache guarantee.

### Reviewed edition: 2026-09-23

- Two distinct developments: oil supply/price and the yen. Combined copy 228 characters, detail copy 229 and 232 characters, including line breaks. Market figures explicitly describe the reports' observation times.
- Reuters oil article distributed by [MarketScreener Saudi Arabia](https://sa.marketscreener.com/news/oil-falls-1-on-better-supply-outlook-hopes-for-us-iran-talks-ce785ad9db88f522): first publication 2026-09-23 07:45 +03, or 13:45 JST. Facts and the 04:21 GMT market observation were cross-checked in the complete attributed [Euronext distribution](https://live.euronext.com/en/financial-news/oil-falls-1-better-supply-outlook-hopes-us-iran-talks). The supply restart was on Tuesday; the article and price report are Wednesday's. No completed peace agreement is claimed.
- Reuters currency article distributed by [MarketScreener Hong Kong](https://hk.marketscreener.com/news/dollar-holds-near-2-month-high-as-markets-weigh-rate-hikes-iran-diplomacy-ce785ad9d88ff025): first publication 2026-09-23 09:39 HKT, or 10:39 JST. Full text also verified via the [India distribution](https://in.marketscreener.com/news/dollar-holds-near-2-month-high-as-markets-weigh-rate-hikes-iran-diplomacy-ce785ad9d88ff025), whose first timestamp is 07:09 IST, the same instant. Modification times were not substituted for first publication. Possible intervention is not described as a confirmed action.
- The import-cost/consumer-price mechanism is contextual explanation from the [Bank of Japan's 2026-03-02 speech, section 3](https://www.boj.or.jp/about/press/koen_2026/ko260302a.htm). It is not a third piece of current news. NHK's current RSS and metadata were available but full article text was not verified, so this edition uses two Reuters reports rather than fabricating NHK details.
