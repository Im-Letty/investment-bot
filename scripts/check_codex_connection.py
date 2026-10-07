"""Check the Mac production storage connection without starting a news worker.

The default is metadata-only: no credential bytes, sockets or CLI authentication.
--check-live --use-keychain explicitly loads only the storage credential pair and
performs at most three GET requests: the private bucket, today's frozen manifest,
and today's edition. No storage creation, source collection or AI call is used.
Output contains fixed states and validated dates/counts/presence only.
"""
import argparse
from datetime import datetime
import json
from pathlib import Path
import sys
import time

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import requests

from daily_news_producer import _official_articles, GenerationError
from daily_news_runtime import (BUCKET, SupabaseNewsStorage, StorageUnavailable,
                                _StorageResponse, _valid_issue)
from mac_news_credentials import MacNewsCredentials, MacNewsCredentialsError, validated_storage
from morning_news_window import MorningNewsPreparer, morning_window
from news_cache import JST


MAX_REQUESTS = 3
TIME_BUDGET_SECONDS = 20
MAX_RESPONSE_BYTES = 1_000_000
CREDENTIAL_ERRORS = frozenset(("missing", "unavailable", "access_denied", "cancelled",
                              "locked", "invalid_record", "invalid_connection"))


class _CheckFailure(StorageUnavailable):
    """Fixed codes only; never keep upstream messages or credential values."""


class _ReadOnlyStorage(SupabaseNewsStorage):
    """Reuse read/JSON/missing contracts with a shared, bounded GET transport.

The cooperative deadline is 20 seconds. A last already-started connect/read may
take at most its short timeout (3 and 4 seconds respectively); no further request
or streamed read begins after the deadline. Redirects and all writes are refused.
"""
    def __init__(self, pair, day, *, session=None, monotonic=time.monotonic):
        self._clock = monotonic
        self._deadline = monotonic() + TIME_BUDGET_SECONDS
        self.request_count = 0
        self._allowed = frozenset(("/bucket/" + BUCKET,
            "/object/authenticated/" + BUCKET + f"/days/{day}/preparation/manifest.json",
            "/object/authenticated/" + BUCKET + f"/days/{day}/edition.json"))
        super().__init__(pair["SUPABASE_URL"], pair["SUPABASE_KEY"], session=session)

    def _remaining(self):
        remaining = self._deadline - self._clock()
        if remaining <= 0:
            raise _CheckFailure("connection_timeout")
        return remaining

    def _request(self, method, path, **kwargs):
        if method != "GET" or path not in self._allowed or kwargs:
            raise _CheckFailure("connection_invalid")
        if self.request_count >= MAX_REQUESTS:
            raise _CheckFailure("connection_invalid")
        remaining = self._remaining()
        self.request_count += 1
        response = None
        try:
            response = self._session.request("GET", self._url + path,
                headers=self._headers, timeout=(min(3, remaining), min(4, remaining)),
                allow_redirects=False, stream=True)
            if response.status_code in (401, 403):
                raise _CheckFailure("authentication_failed")
            if not (200 <= response.status_code < 300 or response.status_code in (400, 404)):
                raise _CheckFailure("connection_invalid")
            length = response.headers.get("Content-Length")
            if length is not None and (not length.isdecimal() or int(length) > MAX_RESPONSE_BYTES):
                raise _CheckFailure("connection_invalid")
            content = bytearray()
            while True:
                self._remaining()
                chunk = response.raw.read1(64 * 1024, decode_content=True)
                self._remaining()
                content.extend(chunk)
                if len(content) > MAX_RESPONSE_BYTES:
                    raise _CheckFailure("connection_invalid")
                if not chunk:
                    break
            return _StorageResponse(response.status_code, bytes(content))
        except _CheckFailure:
            raise
        except requests.Timeout:
            raise _CheckFailure("connection_timeout") from None
        except Exception:
            raise _CheckFailure("network_unavailable") from None
        finally:
            if response is not None:
                response.close()

    def close(self):
        self._headers.clear()
        self._url = ""
        self._session.close()


def configuration(credentials=None):
    """Attributes only; values and native auth are never loaded by this path."""
    credentials = credentials or MacNewsCredentials()
    metadata = credentials.status()
    result = {"status": "dry_run", "checked": False, "read_only": True,
              "publication_allowed": False}
    for name in ("storage_saved", "review_keys_saved"):
        value = metadata.get(name)
        result[name] = value if type(value) is bool else None
    result["errors"] = {name: code for name, code in metadata.get("errors", {}).items()
        if name in ("storage_saved", "review_keys_saved") and type(code) is str and code in CREDENTIAL_ERRORS}
    return result


def check_connection(credentials=None, *, session=None, now=None, monotonic=time.monotonic):
    """Explicit readonly live check; review credentials are never loaded."""
    credentials = credentials or MacNewsCredentials()
    now = time.time() if now is None else now
    day = datetime.fromtimestamp(now, JST).date().isoformat()
    result = {"status": "configuration_invalid", "checked": True, "read_only": True,
              "publication_allowed": False, "connection_verified": False,
              "edition_date": day, "request_count": 0,
              "manifest_present": None, "edition_present": None}
    pair, storage = None, None
    try:
        pair = validated_storage(credentials.load_storage())
        storage = _ReadOnlyStorage(pair, day, session=session, monotonic=monotonic)
        response = storage._request("GET", "/bucket/" + BUCKET)
        if storage._missing(response):
            result["status"] = "bucket_missing"
            return result
        if not 200 <= response.status_code < 300:
            raise _CheckFailure("connection_invalid")
        bucket = storage._payload(response)
        if not isinstance(bucket, dict) or bucket.get("id") != BUCKET:
            raise _CheckFailure("connection_invalid")
        if bucket.get("public") is not False:
            result["status"] = "bucket_not_private"
            return result
        result["connection_verified"] = True
        manifest = storage.read(f"days/{day}/preparation/manifest.json")
        result["manifest_present"] = manifest is not None
        if manifest is not None:
            try:
                window = morning_window(now)
                MorningNewsPreparer._validate_manifest(manifest, window)
                if manifest["articles"]:
                    _official_articles(manifest["articles"], window, now)
            except (ValueError, TypeError, OverflowError, OSError, GenerationError):
                result["status"] = "manifest_invalid"
                return result
            result["source_count"] = len(manifest["articles"])
        edition = storage.read(f"days/{day}/edition.json")
        result["edition_present"] = edition is not None
        if edition is not None:
            try:
                edition = _valid_issue(edition, now, edition=day)
            except (ValueError, TypeError, OverflowError):
                result["status"] = "edition_invalid"
                return result
            result["article_count"] = len(edition["article_refs"])
            result["edition_released"] = edition.get("publish_at", edition["reviewed_at"]) <= now
        result["status"] = ("manifest_missing" if manifest is None else
                            "edition_missing" if edition is None else "connection_ready")
        return result
    except MacNewsCredentialsError as error:
        result["status"] = ("credentials_missing" if error.code == "missing" else
                            "configuration_invalid" if error.code in ("invalid_record", "invalid_connection")
                            else "credentials_unavailable")
    except _CheckFailure as error:
        code = str(error)
        result["status"] = code if code in ("authentication_failed", "connection_timeout",
                                "network_unavailable", "connection_invalid") else "connection_invalid"
    except StorageUnavailable:
        result["status"] = "connection_invalid"
    except Exception:
        result["status"] = "connection_invalid"
    finally:
        if pair is not None:
            pair.clear()
        if storage is not None:
            result["request_count"] = storage.request_count
            try:
                storage.close()
            except Exception:
                pass
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check-live", action="store_true", help="permit only bounded readonly storage GETs")
    parser.add_argument("--use-keychain", action="store_true", help="use the owner's saved storage connection")
    args = parser.parse_args(argv)
    if args.check_live and not args.use_keychain:
        parser.error("--check-live requires --use-keychain")
    result = check_connection() if args.check_live else configuration()
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["status"] in ("dry_run", "connection_ready") else 1


if __name__ == "__main__":
    raise SystemExit(main())
