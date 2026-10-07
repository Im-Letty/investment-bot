"""Owner-only native Mac credentials for the website news worker.

Importing this module performs no I/O. Status checks request Keychain attributes
only, suppress authentication UI, and never read password bytes. Explicit live
loads may show the normal macOS access dialog, which only the owner may approve.
No subprocess, environment, clipboard, plaintext credential file or network is
used. The two namespaces below are fixed and cannot be selected by UI callers.
"""
from contextlib import contextmanager
import base64
import ctypes
import json
import re
import sys
from threading import RLock
import unicodedata
from urllib.parse import urlsplit


REVIEW_SERVICE = "keizai-news-private-tests"
REVIEW_ACCOUNT = "ai-provider-keys"
STORAGE_SERVICE = "keizai-news-production-storage"
STORAGE_ACCOUNT = "supabase-connection"
REVIEW_KEYS = ("GEMINI_API_KEY", "OPENAI_API_KEY")
STORAGE_KEYS = ("SUPABASE_URL", "SUPABASE_KEY")
MAX_BLOB_BYTES = 16384
ERROR_CODES = frozenset(("missing", "unavailable", "access_denied", "cancelled",
                        "locked", "invalid_record", "invalid_connection", "write_failed"))


class MacNewsCredentialsError(RuntimeError):
    def __init__(self, code="unavailable"):
        self.code = code if type(code) is str and code in ERROR_CODES else "unavailable"
        super().__init__(self.code)


def _error(status, fallback="unavailable"):
    return MacNewsCredentialsError({-25300: "missing", -25291: "unavailable",
             -25293: "access_denied", -25308: "locked", -128: "cancelled"}.get(status, fallback))


def _unique_object(pairs):
    result = {}
    for name, value in pairs:
        if name in result:
            raise MacNewsCredentialsError("invalid_record")
        result[name] = value
    return result


def _secret(value):
    return (type(value) is str and 1 <= len(value) <= 6000
            and value.upper() not in {*REVIEW_KEYS, *STORAGE_KEYS, "ANTHROPIC_API_KEY"}
            and not any(char.isspace() or unicodedata.category(char) in ("Cc", "Cf") for char in value)
            and not any(char in value for char in "●•*…'\"`‘’“”")
            and "..." not in value and not re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", value))


def _service_key(key):
    # Match the server storage adapter's accepted key types, never anon keys.
    if not _secret(key):
        return False
    if key.startswith("sb_secret_"):
        return len(key) > len("sb_secret_")
    try:
        parts = key.split(".")
        if len(parts) != 3 or not all(parts):
            return False
        payload = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)))
        return type(payload) is dict and payload.get("role") == "service_role"
    except (ValueError, IndexError, UnicodeError, TypeError):
        return False


def validated_storage(value, error="invalid_connection"):
    if type(value) is not dict or set(value) != set(STORAGE_KEYS):
        raise MacNewsCredentialsError(error)
    address, key = value["SUPABASE_URL"], value["SUPABASE_KEY"]
    if type(address) is not str or not 1 <= len(address) <= 200:
        raise MacNewsCredentialsError(error)
    try:
        url = urlsplit(address)
        host = url.hostname
        if (url.scheme != "https" or not host
                or not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.supabase\.co", host)
                or url.netloc != host or url.username or url.password or url.port
                or url.path not in ("", "/") or url.query or url.fragment
                or any(char.isspace() for char in address) or not _service_key(key)):
            raise MacNewsCredentialsError(error)
    except (ValueError, TypeError):
        raise MacNewsCredentialsError(error) from None
    return {"SUPABASE_URL": "https://" + host, "SUPABASE_KEY": key}


class _NativeKeychain:
    """A fixed namespace native adapter, with lazily bound framework methods."""
    def __init__(self, kind):
        if sys.platform != "darwin" or kind not in ("reviews", "storage"):
            raise MacNewsCredentialsError("unavailable")
        self._service, self._account = ((REVIEW_SERVICE, REVIEW_ACCOUNT) if kind == "reviews"
                                        else (STORAGE_SERVICE, STORAGE_ACCOUNT))
        self._writable = kind == "storage"
        try:
            self.cf = ctypes.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
            self.security = ctypes.CDLL("/System/Library/Frameworks/Security.framework/Security")
            pointer, index, type_id = ctypes.c_void_p, ctypes.c_long, ctypes.c_ulong
            self._bind(self.cf, "CFStringCreateWithCString", [pointer, ctypes.c_char_p, ctypes.c_uint32], pointer)
            self._bind(self.cf, "CFDictionaryCreateMutable", [pointer, index, pointer, pointer], pointer)
            self._bind(self.cf, "CFDictionarySetValue", [pointer, pointer, pointer], None)
            self._bind(self.cf, "CFDataCreate", [pointer, ctypes.POINTER(ctypes.c_ubyte), index], pointer)
            self._bind(self.cf, "CFDataGetLength", [pointer], index)
            self._bind(self.cf, "CFDataGetBytePtr", [pointer], pointer)
            self._bind(self.cf, "CFGetTypeID", [pointer], type_id)
            self._bind(self.cf, "CFDataGetTypeID", [], type_id)
            self._bind(self.cf, "CFDictionaryGetTypeID", [], type_id)
            self._bind(self.cf, "CFRelease", [pointer], None)
            self._bind(self.security, "SecItemCopyMatching", [pointer, ctypes.POINTER(pointer)], ctypes.c_int32)
            self._bind(self.security, "SecItemAdd", [pointer, ctypes.POINTER(pointer)], ctypes.c_int32)
            self._bind(self.security, "SecItemUpdate", [pointer, pointer], ctypes.c_int32)
            self._dictionary_keys = ctypes.addressof(ctypes.c_byte.in_dll(self.cf, "kCFTypeDictionaryKeyCallBacks"))
            self._dictionary_values = ctypes.addressof(ctypes.c_byte.in_dll(self.cf, "kCFTypeDictionaryValueCallBacks"))
        except Exception:
            raise MacNewsCredentialsError("unavailable") from None

    @staticmethod
    def _bind(library, name, arguments, result):
        function = getattr(library, name)
        function.argtypes, function.restype = arguments, result

    def __repr__(self):
        return "<NativeMacNewsKeychain>"

    def _constant(self, name, *, foundation=False):
        value = ctypes.c_void_p.in_dll(self.cf if foundation else self.security, name).value
        if value is None:
            raise MacNewsCredentialsError("unavailable")
        return value

    @contextmanager
    def _arena(self):
        retained = []
        try:
            yield retained
        finally:
            for value in reversed(retained):
                self.cf.CFRelease(value)

    @staticmethod
    def _retain(value, arena):
        if not value:
            raise MacNewsCredentialsError("unavailable")
        arena.append(value)
        return value

    def _dictionary(self, arena):
        return self._retain(self.cf.CFDictionaryCreateMutable(None, 0, self._dictionary_keys,
                                                            self._dictionary_values), arena)

    def _string(self, value, arena):
        return self._retain(self.cf.CFStringCreateWithCString(None, value.encode("utf-8"), 0x08000100), arena)

    def _set(self, dictionary, key, value):
        self.cf.CFDictionarySetValue(dictionary, self._constant(key), value)

    def _query(self, arena):
        value = self._dictionary(arena)
        self._set(value, "kSecClass", self._constant("kSecClassGenericPassword"))
        self._set(value, "kSecAttrService", self._string(self._service, arena))
        self._set(value, "kSecAttrAccount", self._string(self._account, arena))
        return value

    def _copy(self, metadata_only):
        result = ctypes.c_void_p()
        with self._arena() as arena:
            query = self._query(arena)
            self._set(query, "kSecMatchLimit", self._constant("kSecMatchLimitOne"))
            self._set(query, "kSecReturnAttributes" if metadata_only else "kSecReturnData",
                      self._constant("kCFBooleanTrue", foundation=True))
            if metadata_only:
                self._set(query, "kSecUseAuthenticationUI", self._constant("kSecUseAuthenticationUIFail"))
            try:
                status = self.security.SecItemCopyMatching(query, ctypes.byref(result))
                if metadata_only and status == -25300:
                    return False
                if status != 0:
                    raise _error(status)
                expected = self.cf.CFDictionaryGetTypeID() if metadata_only else self.cf.CFDataGetTypeID()
                if not result.value or self.cf.CFGetTypeID(result) != expected:
                    raise MacNewsCredentialsError("invalid_record")
                if metadata_only:
                    return True
                size = self.cf.CFDataGetLength(result)
                data = self.cf.CFDataGetBytePtr(result)
                if not 0 < size <= MAX_BLOB_BYTES or not data:
                    raise MacNewsCredentialsError("invalid_record")
                return ctypes.string_at(data, size)
            finally:
                if result.value:
                    self.cf.CFRelease(result)

    def has(self):
        return self._copy(True)

    def read(self):
        return self._copy(False)

    def write(self, blob):
        if not self._writable or type(blob) is not bytes or not 0 < len(blob) <= MAX_BLOB_BYTES:
            raise MacNewsCredentialsError("write_failed")
        buffer = (ctypes.c_ubyte * len(blob)).from_buffer_copy(blob)
        with self._arena() as arena:
            try:
                data = self._retain(self.cf.CFDataCreate(None, buffer, len(blob)), arena)
            finally:
                ctypes.memset(buffer, 0, len(blob))
            query = self._query(arena)
            self._set(query, "kSecValueData", data)
            status = self.security.SecItemAdd(query, None)
            if status == -25299:
                updates = self._dictionary(arena)
                self._set(updates, "kSecValueData", data)
                status = self.security.SecItemUpdate(self._query(arena), updates)
            if status != 0:
                raise _error(status, "write_failed")


class MacNewsCredentials:
    """Native fixed-record facade; backend injection is only for offline tests."""
    __slots__ = ("_reviews", "_storage", "_lock")

    def __init__(self, *, review_backend=None, storage_backend=None):
        self._reviews, self._storage = review_backend, storage_backend
        self._lock = RLock()

    def __repr__(self):
        return "<MacNewsCredentials>"

    def __getstate__(self):
        raise TypeError("credential_serialization_disabled")

    def _backend(self, kind):
        name = "_reviews" if kind == "reviews" else "_storage"
        value = getattr(self, name)
        if value is None:
            value = _NativeKeychain(kind)
            setattr(self, name, value)
        return value

    def _has(self, kind):
        with self._lock:
            try:
                value = self._backend(kind).has()
                if type(value) is not bool:
                    raise MacNewsCredentialsError("invalid_record")
                return value
            except MacNewsCredentialsError:
                raise
            except Exception:
                raise MacNewsCredentialsError("unavailable") from None

    def has_review_keys(self):
        return self._has("reviews")

    def has_storage(self):
        return self._has("storage")

    def status(self):
        result = {"review_keys_saved": None, "storage_saved": None, "errors": {}}
        for field, kind in (("review_keys_saved", "reviews"), ("storage_saved", "storage")):
            try:
                result[field] = self._has(kind)
            except MacNewsCredentialsError as error:
                result["errors"][field] = error.code
        return result

    def _record(self, kind):
        blob = self._backend(kind).read()
        if type(blob) is not bytes or not 0 < len(blob) <= MAX_BLOB_BYTES:
            raise MacNewsCredentialsError("invalid_record")
        try:
            value = json.loads(blob.decode("utf-8"), object_pairs_hook=_unique_object)
        except Exception:
            raise MacNewsCredentialsError("invalid_record") from None
        if type(value) is not dict:
            raise MacNewsCredentialsError("invalid_record")
        return value

    def load_review_keys(self):
        """Explicit live load; no Claude value is returned or retained."""
        value = None
        with self._lock:
            try:
                value = self._record("reviews")
                if set(value) != {"ANTHROPIC_API_KEY", *REVIEW_KEYS}:
                    raise MacNewsCredentialsError("invalid_record")
                value.pop("ANTHROPIC_API_KEY", None)
                if (not all(_secret(value[name]) and len(value[name]) <= 3000 for name in REVIEW_KEYS)
                        or value[REVIEW_KEYS[0]] == value[REVIEW_KEYS[1]]
                        or value[REVIEW_KEYS[0]].startswith(("sk-ant-", "sk-proj-"))
                        or value[REVIEW_KEYS[1]].startswith(("sk-ant-", "AIza"))):
                    raise MacNewsCredentialsError("invalid_record")
                return {name: value[name] for name in REVIEW_KEYS}
            except MacNewsCredentialsError:
                raise
            except Exception:
                raise MacNewsCredentialsError("unavailable") from None
            finally:
                if value is not None:
                    value.clear()

    def load_storage(self):
        """Explicit live load, never part of the ordinary dry status check."""
        value = None
        with self._lock:
            try:
                value = self._record("storage")
                return validated_storage(value, "invalid_record")
            except MacNewsCredentialsError:
                raise
            except Exception:
                raise MacNewsCredentialsError("unavailable") from None
            finally:
                if value is not None:
                    value.clear()

    def save_storage(self, pair):
        """Explicit owner submission only; save never connects or starts work."""
        copied = validated_storage(pair)
        try:
            blob = json.dumps(copied, ensure_ascii=True, separators=(",", ":"), sort_keys=True).encode("utf-8")
        finally:
            copied.clear()
        with self._lock:
            try:
                self._backend("storage").write(blob)
            except MacNewsCredentialsError:
                raise
            except Exception:
                raise MacNewsCredentialsError("write_failed") from None
