"""Website-only source preparation; importing this module performs no I/O."""
from news_cache import OFFICIAL_NEWS_SOURCES
from morning_news_window import MorningNewsPreparer
from official_news_sources import collect_official_articles


def collect_website_sources(now, *, since, until, diagnostics):
    # The BOJ adapter is deliberately not called until its use scope is settled.
    return collect_official_articles(now, since=since, until=until,
                                     diagnostics=diagnostics,
                                     enabled_sources=OFFICIAL_NEWS_SOURCES)


def create_source_preparer(storage):
    return MorningNewsPreparer(storage, collect_website_sources)


class PublishedWebsiteNews:
    """Use reviewed editions without starting the separate LINE RSS cache."""

    def snapshot(self, wait=False):
        return {"news": [], "fetched_at": None, "source_fetched_at": {},
                "source_status": {}, "source_stale": {}, "source_refreshing": {},
                "refreshing": False, "stale": False}


website_news = PublishedWebsiteNews()
