"""Separate public reads from the existing serial request handlers.

The original single worker serialized quotas, AI cache misses, authentication
and writes. Keep that behavior even when Gunicorn has request threads. Only
public snapshots, the page, static assets and the locked quote reader overlap.
"""
from threading import Lock


# These existing handlers read snapshots and use their own bounded background
# queues. They never run AI, alter authentication, or await an upstream fetch.
_CACHED_PUBLIC_READS = frozenset({
    "/api/morning-news", "/api/morning-data", "/api/company-news",
    "/api/scanner", "/api/company-profile", "/api/dividend/calendar-v2",
    "/api/lookup_all",
})


class PublicReadScheduling:
    def __init__(self, application):
        self.application = application
        self._serial = Lock()

    @staticmethod
    def parallel_read(environ):
        method = environ.get("REQUEST_METHOD", "")
        path = environ.get("PATH_INFO", "")
        return ((method in {"GET", "HEAD"} and
                 (path == "/" or path.startswith("/static/"))) or
                (method == "GET" and
                 (path == "/api/quote" or path in _CACHED_PUBLIC_READS)))

    def __call__(self, environ, start_response):
        if self.parallel_read(environ):
            return self.application(environ, start_response)
        self._serial.acquire()
        try:
            response = self.application(environ, start_response)
        except BaseException:
            self._serial.release()
            raise
        return _SerialResponse(response, self._serial)


class _SerialResponse:
    """Hold serialization through streaming, disconnects and response errors."""
    def __init__(self, response, lock):
        self.response = response
        self.lock = lock
        self.closed = False

    def __iter__(self):
        try:
            yield from self.response
        finally:
            self.close()

    def close(self):
        if self.closed:
            return
        self.closed = True
        try:
            close = getattr(self.response, "close", None)
            if close is not None:
                close()
        finally:
            self.lock.release()
