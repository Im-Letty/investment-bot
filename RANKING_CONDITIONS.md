# Ranking conditions

Default: ascending/descending price-change percentage versus preceding trading-day close;
positive/negative changes only, no 3% cutoff in the website's rankings. Optional amount or
volume order. All/Prime/Standard/Growth selection and browser-local preferences.
Twenty results per direction, first five visible. Ties use stock code.

Coverage: JPX domestic-equity catalogue (dated 2026-08-31), excluding listed funds and
non-domestic listings. Background fetch rotates through 200 symbols per bounded invocation,
20 per provider batch, retaining dated prior successful prices. This expands collection
beyond the old fixed 50; it is NOT a simultaneous full-exchange realtime feed. Display the
actual acquired/eligible count, source trading dates and saved-data/update state. Missing
market membership cannot qualify for a named market. Pro mode can additionally include
its existing 50 US symbols; named JP market filters exclude them.

Provider: existing Yahoo/yfinance daily price bars, unadjusted close and preceding close;
volume from the matching price bar. Source delays apply. Actual traded monetary value is
not available; do not multiply volume by last price and present it as actual turnover.
The settings explain that turnover is not yet supported. No new subscription introduced.

Checks: scanner snapshot/route, bounded universe rotation, volume validation, frontend
ranking order/coverage/pagination/preference persistence, existing company/watch behavior.
