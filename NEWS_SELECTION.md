# Website news selection

The website uses a fixed pair of sources: `NHK経済` and `ロイター経済`, listed in `WEB_NEWS_SOURCES`. It does not substitute other publishers when one is unavailable. The shared raw cache also serves the existing LINE/report flow; its other categories are not eligible for the website.

## Today first

- Use the article's original publication time, converted to Japan time (UTC+09:00).
- Never substitute an edit timestamp, retrieval time, or a guessed date.
- Missing, invalid, future-dated publications and invalid article URLs are excluded.
- Show up to three current-day articles, newest first. Three is a limit, not a quota.
- Deduplicate by normalized title or article URL. Differently worded reports about the same event still need editorial comparison; this is not semantic AI deduplication.
- When no eligible articles have been confirmed, show that state without padding the current-day list with older stories.
- A source outage is separate from a successfully checked feed with no eligible articles.
- Recompute selection at request time. Browser caches require policy version 3 and the current Japan-time edition date, including after midnight and delayed responses.

## One short daily summary

The front of the card shows one short headline and approximately 200 Japanese characters for the whole selected day, not a separate 200-character block per article. The original headlines, publication times and links stay in the expanded details.

`news-digests.json` holds reviewed Japanese copy. Each record contains `edition_date`, `lang: "ja"`, `headline` (1–80 characters), `summary` (160–260 characters), and `article_refs`. Each reference must contain the exact original `source`, normalized `url`, `published_at`, and `title` from the current selection. Every selected article must be covered, with no additional references or duplicates. A reference match is checked before headline translation. The authored Japanese text keeps its language marker when a reader changes the interface language.

Before adding a review, read the source content, confirm the facts and original publication date, explain unfamiliar terms in plain language, and combine overlapping events. Do not infer causes or effects from a headline alone. Keep Japanese economic news central; do not invent a Japan-related effect to make an overseas story fit.

If no review matches, show that today's summary has not been published and keep the current article links available in details. Do not substitute yesterday's summary, silently summarize a different article set, or present headline strings as body summaries. This is a reviewed publication path; it does not yet generate future daily summaries automatically.

### Reviewed edition: 2026-09-22

- Body: 189 Japanese characters, based on the publicly readable lead of [NHK's article](https://news.web.nhk/newsweb/na/nd-20260922de51819), published 2026-09-22 09:25 JST about the September 21 US session.
- The index explanation was checked against the [Nasdaq Composite definition](https://indexes.nasdaq.com/Index/Overview/COMP).
- No index figure, percentage gain, forecast, or effect on Japanese shares was added. The body is original explanatory wording, not copied article text.

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
