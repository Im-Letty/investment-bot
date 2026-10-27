"""Keep public entry assets responsive while preserving handler serialization.

A six-request admission limit covers every request except GET/HEAD page and
static reads. With one eight-thread worker this leaves two threads for entry
assets, even while admitted handlers wait on the existing serial lock.
"""
from threading import BoundedSemaphore, Lock


MAX_NONCRITICAL_REQUESTS = 6
_CRITICAL_HEADER = ("X-KN-Request-Scheduling", "bounded-v1")
_NO_EXC_INFO = object()
_BUSY_BODY = b'{"error":"server_busy","retry_after":1}'
_BUSY_HEADERS = (
    ("Content-Type", "application/json"),
    ("Content-Length", str(len(_BUSY_BODY))),
    ("Cache-Control", "no-store"),
    ("Retry-After", "1"),
)

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
        self._admission = BoundedSemaphore(MAX_NONCRITICAL_REQUESTS)

    @staticmethod
    def critical_read(environ):
        return (environ.get("REQUEST_METHOD", "") in {"GET", "HEAD"} and
                (environ.get("PATH_INFO", "") == "/" or
                 environ.get("PATH_INFO", "").startswith("/static/")))

    @staticmethod
    def parallel_read(environ):
        method = environ.get("REQUEST_METHOD", "")
        path = environ.get("PATH_INFO", "")
        return ((method in {"GET", "HEAD"} and
                 (path == "/" or path.startswith("/static/"))) or
                (method == "GET" and
                 (path == "/api/quote" or path in _CACHED_PUBLIC_READS)))

    def __call__(self, environ, start_response):
        if self.critical_read(environ):
            def mark_response(status, headers, exc_info=_NO_EXC_INFO):
                marked = [(key, value) for key, value in headers
                          if key.lower() != _CRITICAL_HEADER[0].lower()]
                marked.append(_CRITICAL_HEADER)
                if exc_info is _NO_EXC_INFO:
                    return start_response(status, marked)
                return start_response(status, marked, exc_info)
            return self.application(environ, mark_response)
        if not self._admission.acquire(blocking=False):
            # Do not enter Flask, run a handler, or retry any operation.
            start_response("503 Service Unavailable", list(_BUSY_HEADERS))
            return [] if environ.get("REQUEST_METHOD") == "HEAD" else [_BUSY_BODY]
        try:
            if self.parallel_read(environ):
                response = self.application(environ, start_response)
            else:
                self._serial.acquire()
                try:
                    response = self.application(environ, start_response)
                except BaseException:
                    self._serial.release()
                    raise
                response = _HeldResponse(response, self._serial)
        except BaseException:
            self._admission.release()
            raise
        return _HeldResponse(response, self._admission)


class _HeldResponse:
    """Hold a lock or admission permit through streaming and response close."""
    def __init__(self, response, resource):
        self.response = response
        self.resource = resource
        self.closed = False
        self._close_lock = Lock()

    def __iter__(self):
        try:
            yield from self.response
        finally:
            self.close()

    def close(self):
        with self._close_lock:
            if self.closed:
                return
            self.closed = True
        try:
            close = getattr(self.response, "close", None)
            if close is not None:
                close()
        finally:
            self.resource.release()
