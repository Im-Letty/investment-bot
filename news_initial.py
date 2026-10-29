"""Render the published daily edition before any external feed request completes."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from html import escape
from pathlib import Path
import json
import time

from flask import Response
from market_snapshot import validated_market
from news_update_status import economic_update_status, economic_status_lines
from news_cache import (JST, LEAD_OTHER_NEWS_STRUCTURE, PUBLISHED_NEWS_SOURCES, _publication_time, _safe_url, _validated_digest,
                        load_reviewed_digests, load_reviewed_supplements,
                        select_daily_news)


NEWS_PLACEHOLDER = ('<div id="morning-news-content"><div class="morning-news-loading" '
                    'data-i18n="morning_loading">読み込み中...</div></div>')


def initial_news(snapshot, *, now=None, reviewed_digests=(), reviewed_supplements=()):
    """Render an explicit curated edition or confirmed feed state immediately.

    Publication is deliberately separate from feed freshness. A published
    edition has no invented retrieval time and is never labelled as a fresh RSS
    result. Live identity conflicts invalidate a curated review; changes in the
    live selection also invalidate older unmarked, selection-bound reviews.
    """
    now = time.time() if now is None else now
    current = _publication_time(now)
    if current is None:
        raise ValueError("now must be a valid timestamp")
    selected = select_daily_news(snapshot, now=now, allowed_sources=PUBLISHED_NEWS_SOURCES,
                                 reviewed_digests=reviewed_digests,
                                 reviewed_supplements=reviewed_supplements)
    if selected.get("delivery") == "published":
        return {**selected, "lang": "ja", "translation_pending": False}
    stamp = _publication_time(selected.get("fetched_at"))
    if (stamp is not None and 0 <= now - stamp.timestamp() < 900
            and selected["selection_status"] in ("ready", "empty_today")):
        return {**selected, "lang": "ja", "translation_pending": False}

    edition = current.astimezone(JST).date().isoformat()
    candidates = []
    for value in reviewed_digests:
        digest = _validated_digest(value)
        if (digest is not None and digest.get("publication_mode") != "curated"
                and digest["edition_date"] == edition
                and all(ref["published_at"] <= now for ref in digest["article_refs"])
                and len({ref["url"] for ref in digest["article_refs"]}) == len(digest["article_refs"])):
            candidates.append(digest)
    if len(candidates) != 1:
        return None
    digest = candidates[0]
    return {"delivery": "published", "policy_version": 4, "edition_date": edition,
            "lang": "ja", "news": [{**deepcopy(ref), "published_date": edition}
                                     for ref in digest["article_refs"]],
            "supplements": [], "digest": deepcopy(digest), "fetched_at": None,
            "refreshing": True, "stale": False, "selection_status": "ready",
            "translation_pending": False}


def _stamp(value):
    date = datetime.fromtimestamp(value, JST)
    return f"{date:%Y/%m/%d %H:%M}"


def _publication(item):
    day_only = item.get("publication_precision") == "day" and item.get("published_at") is None
    date = None
    if day_only:
        value = item.get("published_date")
        try:
            date = datetime.strptime(value, "%Y-%m-%d") if isinstance(value, str) else None
            if date is not None and date.strftime("%Y-%m-%d") != value:
                date = None
        except ValueError:
            pass
    stamp = _publication_time(item.get("published_at"))
    if date is not None:
        iso, label = f"{date:%Y-%m-%d}", f"{date:%Y/%m/%d} 発表"
    elif stamp is not None:
        iso = stamp.isoformat(timespec="milliseconds").replace("+00:00", "Z")
        label = f"{stamp.astimezone(JST):%Y/%m/%d %H:%M} 発表"
    else:
        return '<span class="publication-unknown">発表日未確認</span>'
    title = label + ("" if date is not None else " JST")
    return (f'<time class="publication-date" datetime="{iso}" title="{title}">'
            f'{label}</time>')


def _article_link(item):
    source = str(item.get("source") or "").strip() or "元の記事"
    title = str(item.get("title") or "").strip()
    url = _safe_url(item.get("url"))
    if not url:
        return f'<span class="headline-source">{escape(source)}</span>'
    return (f'<a class="source-link" href="{escape(url, quote=True)}" target="_blank" rel="noopener noreferrer" '
            f'title="{escape(title, quote=True)}" '
            f'aria-label="{escape(title + " · " if title else "", quote=True)}{escape(source, quote=True)}の元の記事を読む">{escape(source)} ↗</a>')


def _article_meta(item):
    return ('<div class="news-publication-source" aria-label="発表日時と出典">'
            f'{_publication(item)}<span aria-hidden="true">·</span>{_article_link(item)}</div>')


def render_news_markup(data, *, now=None):
    """Render each article's original publication facts beside its own copy."""
    esc = lambda value: escape(str(value), quote=True)
    edition = datetime.fromisoformat(data["edition_date"])
    weekday = "月火水木金土日"[edition.weekday()] + "曜日"
    calendar = (f'<div class="calendar" aria-label="掲載対象日 {data["edition_date"]} {weekday}">'
                f'<strong>{edition:%d}</strong><small>{weekday}</small></div>')
    digest = data.get("digest")
    lead_and_others = (digest or {}).get("reading_structure") == LEAD_OTHER_NEWS_STRUCTURE
    ordered_news = ([next(item for item in data["news"] if item["url"] == ref["url"])
                     for ref in digest["article_refs"]] if lead_and_others else data["news"])
    headlines_only = data.get("delivery") == "headlines" and not digest
    if digest:
        summary_news = (ordered_news[:1] if lead_and_others else
                        [next(item for item in data["news"] if item["url"] == ref["url"])
                         for ref in digest["article_refs"]])
        brief = (f'<div class="daily-digest" lang="ja"><h4 class="brief-headline">{esc(digest["headline"])}</h4>'
                 f'<p class="brief-summary">{esc(digest["summary"])}</p>'
                 '<div class="news-summary-sources">'
                 + ''.join(_article_meta(item) for item in summary_news) + '</div></div>')
    elif headlines_only and data["news"]:
        brief = ('<h4 class="brief-headline">今日の見出し</h4>'
                 f'<p class="news-empty">{edition:%Y/%m/%d} · 本日の要約は未掲載です。</p>'
                 '<ul class="headline-list">'
                 + ''.join(f'<li><a class="story-title" href="{esc(_safe_url(item["url"]) or "")}" target="_blank" rel="noopener noreferrer">'
                           f'{esc(item["title"])}</a>{_article_meta(item)}</li>' for item in data["news"])
                 + '</ul>')
    else:
        message = ("本日のまとめはまだ掲載されていません。記事は「もっと詳しく」から読めます。" if data["news"]
                   else "本日発表された経済ニュースは、まだ確認できていません。")
        brief = f'<p class="news-empty">{message}</p>'
    stories = []
    article_summaries = {item["url"]: item for item in (digest or {}).get("article_summaries", [])}
    for item in ([] if headlines_only else ordered_news[1:] if lead_and_others else ordered_news):
        authored = article_summaries.get(item["url"])
        if authored:
            stories.append('<article class="story summarized-story" lang="ja">'
                           f'<h4><span class="story-title">{esc(authored["headline"])}</span></h4>'
                           f'<div class="story-content"><p class="article-summary">{esc(authored["summary"])}</p>'
                           f'{_article_meta(item)}</div></article>')
            continue
        stories.append('<article class="story source-story"><h4>'
                       f'<span class="story-title">{esc(item["title"])}</span></h4>'
                       f'{_article_meta(item)}</article>')
    if data["supplements"]:
        supplements = []
        for item in data["supplements"]:
            key = esc("supplement:" + item["url"])
            supplements.append(f'<details class="story" name="kn-news-sources" data-news-key="{key}">'
                               f'<summary data-news-focus="{key}"><h4><span class="story-category">補足</span>'
                               f'<span class="story-title">{esc(item["title"])}</span></h4>'
                               '<span class="plus" aria-hidden="true"></span>'
                               f'{_article_meta(item)}</summary>'
                               f'<div class="story-content"><p>{esc(item["editorial_reason"])}</p></div></details>')
        stories.append('<section class="news-supplements"><h4>日付付きの補足</h4>' + "".join(supplements) + '</section>')
    more_label = 'ほかのニュース' if lead_and_others else 'もっと詳しく'
    more = (('<details class="read-more" data-news-key="more"><summary data-news-focus="more">'
             f'<span class="closed-label">{more_label}</span><span class="open-label">閉じる</span>'
             '<span class="read-toggle" aria-hidden="true"></span></summary><div class="stories editorial-detail">'
             + "".join(stories) + '</div></details>') if stories else '')
    if data.get("delivery") == "published":
        current_period = (datetime.fromtimestamp(time.time() if now is None else now, JST)
                          - timedelta(hours=8)).date()
        status = ('新しい経済ニュースを確認できていません。前回分を表示しています。'
                  if edition.date() < current_period else '')
    else:
        status = _stamp(data["fetched_at"]) + " 取得" + (" · 最新情報を確認中" if data.get("stale") else "")
    tail = (f'<div class="news-tail">{more}</div>'
            if lead_and_others and more else more)
    update = data.get("update_status")
    observation = ''
    if isinstance(update, dict) and update.get("version") == 1:
        lines = economic_status_lines(update)
        observation = ('<details class="news-update-status" data-news-key="update-status"><summary data-news-focus="update-status">' + esc(lines[0][1]) + '</summary><dl>'
                       + ''.join(f'<div><dt>{esc(label)}</dt><dd>{esc(value)}</dd></div>' for label, value in lines[1:])
                       + '</dl></details>')
    footer = ('<footer class="news-footer">' + (f'<p>{esc(status)}</p>' if status else '')
              + observation + '</footer>') if status or observation else ''
    return ('<article id="knNewsDigest" class="news-card journal" aria-labelledby="knNewsDigestTitle">'
            '<header class="news-header">' + calendar + '<div class="heading-text"><h3 id="knNewsDigestTitle">経済ニュース</h3></div></header>'
            '<div class="news-content"><div class="brief">' + brief + '</div>' + tail + footer + '</div></article>')


def render_initial_html(html, data, *, now=None):
    if data is None:
        return html
    # Escape script terminators and JS line separators even though this is
    # inert JSON; HTML parsing still recognizes a literal closing script tag.
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    payload = payload.replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    replacement = ('<div id="morning-news-content" aria-busy="false">' + render_news_markup(data, now=now) + '</div>'
                   '<script type="application/json" id="knInitialNews">' + payload + '</script>')
    return html.replace(NEWS_PLACEHOLDER, replacement, 1)


def render_initial_market(html, data, *, now=None):
    now = time.time() if now is None else now
    market = validated_market(data, now)
    if not market:
        return html
    payload = {**data, "market": market}
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    serialized = serialized.replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    return html.replace('</head>', '<script type="application/json" id="knInitialMarket">' + serialized + '</script></head>', 1)


def news_index_response(html_path, cache, request, *, now=None, market_payload=None,
                        html_transform=None, publication_state=None):
    # Start all feed refreshes before file reads/rendering, but never wait for
    # external traffic before returning the HTML and published edition.
    snapshot = cache.snapshot(wait=False)
    now = time.time() if now is None else now
    edition = datetime.fromtimestamp(now, JST).date().isoformat()
    data = initial_news(snapshot, now=now, reviewed_digests=load_reviewed_digests(),
                        reviewed_supplements=load_reviewed_supplements())
    if data is not None:
        data["update_status"] = economic_update_status(data, publication_state, now=now)
    source = Path(html_path).read_text(encoding="utf-8")
    if html_transform is not None:
        source = html_transform(source)
    html = render_initial_html(source, data, now=now)
    body = render_initial_market(html, market_payload, now=now).encode("utf-8")
    # Render's existing edge compression handles the wire representation.
    response = Response(body, mimetype="text/html")
    response.cache_control.no_cache = True
    response.cache_control.max_age = 0
    # Even an unchanged empty fallback must be revalidated across JST midnight.
    response.set_etag(sha256(edition.encode() + body).hexdigest())
    response.make_conditional(request)
    return response
