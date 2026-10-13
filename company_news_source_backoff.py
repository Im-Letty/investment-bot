"""Host-wide refusal and Retry-After waits; no network or automatic retry.

Only the explicitly supplied approved host set can be queried or recorded.
The collector must check before DNS/each request and record a 429/503/403
response before raising its ordinary fixed transport error. Already in-flight
requests cannot be cancelled here; subsequent requests share the same wait.
Optional private local state preserves waits over restart. File locking and
maximum-until merging keep threads/processes from shortening another wait.
"""
from contextlib import contextmanager
from email.utils import parsedate_to_datetime
import fcntl
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import stat
import tempfile
import threading
import time


RATE_WAIT_SECONDS = 900
REFUSAL_WAIT_SECONDS = 86400
MAX_NOW_EXCLUSIVE = 253402300800
MAX_STATE_BYTES = 64_000
MAX_HOSTS = 256
_CODES = frozenset({'source_rate_wait', 'source_refused'})
_HOST = re.compile(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+'
                   r'[a-z][a-z0-9-]{0,62}')


def _stamp(value):
    return (type(value) in (int, float) and 0 < value < MAX_NOW_EXCLUSIVE
            and math.isfinite(value))


def _host(value):
    if not isinstance(value, str) or len(value) > 253 or not _HOST.fullmatch(value):
        return False
    try:
        ipaddress.ip_address(value)
    except ValueError:
        return True
    return False


def _retry_until(value, now):
    """A positive delta or future RFC HTTP-date, without truncating its wait."""
    if (not isinstance(value, str) or not 1 <= len(value) <= 128
            or any(ord(char) < 32 or ord(char) == 127 for char in value)):
        return None
    value = value.strip()
    if re.fullmatch(r'[0-9]{1,12}', value):
        delta = int(value)
        until = now + delta
        return until if delta > 0 and _stamp(until) else None
    try:
        parsed = parsedate_to_datetime(value)
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            return None
        until = parsed.timestamp()
        return until if _stamp(until) and until > now else None
    except (ValueError, TypeError, OverflowError, OSError):
        return None


def _merge(target, incoming):
    for host, row in incoming.items():
        previous = target.get(host)
        if (previous is None or row['until'] > previous['until']
                or row['until'] == previous['until'] and row['code'] == 'source_refused'):
            target[host] = dict(row)


class SourceHostBackoff:
    def __init__(self, allowed_hosts, *, state_path=None, clock=time.time):
        if (not isinstance(allowed_hosts, (set, frozenset, tuple, list))
                or not 1 <= len(allowed_hosts) <= MAX_HOSTS
                or any(not _host(host) for host in allowed_hosts)
                or len(set(allowed_hosts)) != len(allowed_hosts) or not callable(clock)):
            raise ValueError('unapproved_source')
        if state_path is not None and (not isinstance(state_path, (str, Path))
                or not str(state_path) or not Path(state_path).is_absolute()):
            raise ValueError('source_backoff_unavailable')
        self.allowed_hosts = frozenset(allowed_hosts)
        self.state_path = Path(state_path) if state_path is not None else None
        self.clock = clock
        self._rows = {}
        self._lock = threading.RLock()

    def _inputs(self, host, now):
        if not isinstance(host, str) or host not in self.allowed_hosts:
            raise ValueError('unapproved_source')
        try:
            now = self.clock() if now is None else now
        except Exception:
            raise ValueError('source_backoff_unavailable') from None
        if not _stamp(now):
            raise ValueError('source_backoff_unavailable')
        return now

    def _read(self):
        if self.state_path is None:
            return {}
        try:
            descriptor = os.open(self.state_path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        except FileNotFoundError:
            return {}
        with os.fdopen(descriptor, 'rb') as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_STATE_BYTES:
                raise ValueError('source_backoff_unavailable')
            payload = stream.read(MAX_STATE_BYTES + 1)
        if len(payload) > MAX_STATE_BYTES:
            raise ValueError('source_backoff_unavailable')
        value = json.loads(payload)
        if (not isinstance(value, dict) or set(value) != {'schema_version', 'hosts'}
                or type(value['schema_version']) is not int or value['schema_version'] != 1
                or not isinstance(value['hosts'], dict) or len(value['hosts']) > MAX_HOSTS):
            raise ValueError('source_backoff_unavailable')
        for host, row in value['hosts'].items():
            if (not _host(host) or not isinstance(row, dict) or set(row) != {'until', 'code'}
                    or not _stamp(row['until']) or row['code'] not in _CODES):
                raise ValueError('source_backoff_unavailable')
        # Removed hosts remain as history without joining the approved set.
        return value['hosts']

    def _write(self):
        if self.state_path is None:
            return
        if len(self._rows) > MAX_HOSTS:
            raise ValueError('source_backoff_unavailable')
        payload = json.dumps({'schema_version': 1, 'hosts': self._rows},
                             sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
        if len(payload) > MAX_STATE_BYTES:
            raise ValueError('source_backoff_unavailable')
        descriptor, name = tempfile.mkstemp(prefix='.company-source-backoff-',
                                           dir=self.state_path.parent)
        try:
            with os.fdopen(descriptor, 'wb') as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, self.state_path)
        finally:
            if os.path.exists(name):
                os.unlink(name)

    @contextmanager
    def _state(self):
        with self._lock:
            descriptor = None
            try:
                if self.state_path is not None:
                    self.state_path.parent.mkdir(parents=True, exist_ok=True)
                    descriptor = os.open(str(self.state_path) + '.lock',
                                         os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
                    if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                        raise ValueError('source_backoff_unavailable')
                    fcntl.flock(descriptor, fcntl.LOCK_EX)
                _merge(self._rows, self._read())
                yield
            except (OSError, ValueError, TypeError, UnicodeError):
                raise ValueError('source_backoff_unavailable') from None
            finally:
                if descriptor is not None:
                    fcntl.flock(descriptor, fcntl.LOCK_UN)
                    os.close(descriptor)

    def _result(self, host, now):
        row = self._rows.get(host)
        blocked = row is not None and row['until'] > now
        return {'blocked': blocked, 'error_code': row['code'] if blocked else None,
                'wait_until': row['until'] if blocked else None}

    def check(self, host, *, now=None):
        """Return only fixed status/numeric wait, preserving expired history."""
        now = self._inputs(host, now)
        with self._state():
            return self._result(host, now)

    def record_response(self, host, status, retry_after=None, *, now=None):
        """Record a refusal/rate wait; a successful response cannot clear it."""
        now = self._inputs(host, now)
        if type(status) is not int or not 100 <= status <= 599:
            raise ValueError('source_backoff_unavailable')
        with self._state():
            if status in (429, 503, 403):
                until = _retry_until(retry_after, now)
                if status == 403:
                    until = max(now + REFUSAL_WAIT_SECONDS, until or 0)
                    code = 'source_refused'
                else:
                    until = until if until is not None else now + RATE_WAIT_SECONDS
                    code = 'source_rate_wait'
                if not _stamp(until):
                    raise ValueError('source_backoff_unavailable')
                _merge(self._rows, {host: {'until': until, 'code': code}})
                self._write()
            return self._result(host, now)
