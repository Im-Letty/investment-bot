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
- Recompute selection at request time. Browser caches require policy version 2 and the current Japan-time edition date, including after midnight and delayed responses.

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

This change does not generate an AI summary, create a publication schedule, sign up for paid news access, or send LINE messages. The existing Reuters feed may be unavailable; reconnecting licensed content or selecting a different fixed publisher requires a separate sourcing decision.
