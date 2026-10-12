"""Caller-owned storage deadlines for the explicit private morning job.

Importing this module performs no I/O. The public website storage is unchanged.
Every inherited operation goes through the existing bounded storage transport,
including bucket checks, history lists, attempt claims and reviewed uploads.
"""
import math
import time

from daily_news_runtime import BUCKET, StorageUnavailable, SupabaseNewsStorage


PHASES = frozenset(("manifest_wait", "source_preparation", "generation",
                    "publication", "outcome"))


def _deadline(value):
    if type(value) not in (int, float) or not math.isfinite(value) or value <= 0:
        raise StorageUnavailable("storage_budget")
    return value


def _phase(value):
    if not isinstance(value, str) or value not in PHASES:
        raise StorageUnavailable("storage_budget")
    return value


class PrivateNewsStorage(SupabaseNewsStorage):
    """An overall expiry plus a replaceable, capped processing-phase expiry.

    ``deadline`` and phase deadlines are absolute monotonic times supplied by
    trusted orchestration code. A clock may be injected only by Python tests;
    there is no environment or command-line override. Changing phases can
    provide fresh time within the original overall bound, never beyond it.
    """

    def __init__(self, url, key, *, deadline=None, phase="manifest_wait",
                 clock=time.monotonic, session=None, timeout=(5, 15)):
        if not callable(clock):
            raise StorageUnavailable("storage_budget")
        self._private_clock = clock
        self._total_deadline = None
        self._phase_deadline = None
        self._phase = _phase(phase)
        if deadline is not None:
            self.set_deadline(deadline)
        super().__init__(url, key, session=session, timeout=timeout)

    @property
    def phase(self):
        return self._phase

    @property
    def total_deadline(self):
        return self._total_deadline

    @property
    def phase_deadline(self):
        return self._phase_deadline

    def set_deadline(self, deadline, *, phase=None):
        """Configure or shorten the overall bound; it can never be extended."""
        expiry = _deadline(deadline)
        next_phase = self._phase if phase is None else _phase(phase)
        self._total_deadline = (expiry if self._total_deadline is None
                                else min(self._total_deadline, expiry))
        self._phase_deadline = (self._total_deadline if self._phase_deadline is None
                                else min(self._phase_deadline, self._total_deadline))
        self._phase = next_phase
        return self._total_deadline

    def set_phase_deadline(self, deadline, *, phase):
        """Replace the previous phase expiry within the immutable overall cap."""
        expiry, next_phase = _deadline(deadline), _phase(phase)
        if self._total_deadline is None:
            raise StorageUnavailable("storage_budget")
        self._phase_deadline = min(self._total_deadline, expiry)
        self._phase = next_phase
        return self._phase_deadline

    def check_private(self):
        """Check an existing private bucket, without installing or changing it."""
        response = self._request("GET", "/bucket/" + BUCKET)
        if not 200 <= response.status_code < 300:
            raise StorageUnavailable("storage_bucket")
        bucket = self._payload(response)
        if not isinstance(bucket, dict) or bucket.get("public") is not False:
            raise StorageUnavailable("storage_private_required")

    def ensure_private(self):
        # The explicit writer/source job requires prior owner setup. It must
        # not inherit the general adapter's create-on-missing behavior.
        return self.check_private()

    def _operation_clock(self, clock):
        if clock is not None and clock is not self._private_clock:
            raise StorageUnavailable("storage_budget")
        return self._private_clock

    def read(self, path, *, deadline=None, clock=None):
        # The base method also checks the caller's deadline after JSON parsing.
        # Keep that check in the same clock domain as its bounded transport.
        return super().read(path, deadline=deadline, clock=self._operation_clock(clock))

    def _list(self, prefix, *, deadline=None, clock=None, offset=0):
        return super()._list(prefix, deadline=deadline, clock=self._operation_clock(clock),
                             offset=offset)

    def _request(self, method, path, *, deadline=None, clock=None, **kwargs):
        if self._total_deadline is None or self._phase_deadline is None:
            raise StorageUnavailable("storage_budget")
        # Absolute deadlines must share one clock domain. The normal caller
        # supplies no clock; test callers use the same explicit injected clock.
        self._operation_clock(clock)
        expiry = min(self._total_deadline, self._phase_deadline)
        if deadline is not None:
            expiry = min(expiry, _deadline(deadline))
        self._remaining(expiry, self._private_clock)
        return super()._request(method, path, deadline=expiry,
                                clock=self._private_clock, **kwargs)
