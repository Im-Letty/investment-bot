"""Encrypted account-auth handoff for one dedicated, private Codex runner.

No authentication, inference, filesystem access or network happens on import.
This module never reads the user's default Codex profile. The caller must use a
separately authenticated session, a private repository, and one serialized job
stream. The digest check detects stale checkpoints; it is not a storage CAS or
distributed lock. A failed checkpoint must fail the job and require attention.

Only ciphertext goes into the private website-news bucket. The encryption key
belongs in the private runner's secret store, separately from that bucket. The
existing service-role credential is project-wide; restricting this adapter to
one object is an application guard, not a least-privilege storage permission.
"""
import argparse
import base64
from contextlib import contextmanager
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


AUTH_OBJECT = "ops/codex-auth/v1.json"
AUTH_SCHEMA = "codex-news-account-auth-v1"
AUTH_FILE = "auth.json"
CHECKPOINT_FILE = ".news-auth-checkpoint.json"
KEY_ENV = "CODEX_AUTH_ENCRYPTION_KEY"
MAX_AUTH_BYTES = 64 * 1024
MAX_ENVELOPE_BYTES = 100 * 1024
_AAD = ("website-news/" + AUTH_OBJECT + "|" + AUTH_SCHEMA).encode("ascii")
_ENV_NAMES = ("SUPABASE_URL", "SUPABASE_KEY", KEY_ENV)
_ERRORS = frozenset(("auth_configuration_invalid", "auth_record_missing",
    "auth_record_invalid", "auth_decryption_failed", "auth_home_invalid",
    "auth_invalid", "auth_missing", "auth_exists", "auth_checkpoint_missing",
    "auth_checkpoint_stale", "auth_storage_unavailable", "auth_storage_not_private",
    "auth_checkpoint_failed", "auth_seed_exists", "auth_cleanup_failed"))


class CloudNewsAuthError(RuntimeError):
    """Fixed codes only; provider errors and credentials never enter this type."""
    def __init__(self, code):
        super().__init__(code if isinstance(code, str) and code in _ERRORS
                         else "auth_configuration_invalid")


def _unique_object(pairs):
    result = {}
    for name, value in pairs:
        if name in result:
            raise ValueError("duplicate")
        result[name] = value
    return result


def _reject_constant(_value):
    raise ValueError("constant")


def _loads(raw, limit, code):
    try:
        if not isinstance(raw, bytes) or not 0 < len(raw) <= limit:
            raise ValueError("size")
        return json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_object,
                          parse_constant=_reject_constant)
    except Exception:
        raise CloudNewsAuthError(code) from None


def _token(value):
    return (isinstance(value, str) and 0 < len(value) <= MAX_AUTH_BYTES
            and all(33 <= ord(char) <= 126 for char in value))


def _auth_bytes(raw):
    value = _loads(raw, MAX_AUTH_BYTES, "auth_invalid")
    if (not isinstance(value, dict) or value.get("auth_mode") != "chatgpt"
            or set(value) - {"auth_mode", "OPENAI_API_KEY", "tokens", "last_refresh"}
            or value.get("OPENAI_API_KEY") is not None):
        raise CloudNewsAuthError("auth_invalid")
    tokens = value.get("tokens")
    if (not isinstance(tokens, dict)
            or set(tokens) - {"access_token", "id_token", "refresh_token", "account_id"}
            or not all(_token(tokens.get(name)) for name in
                       ("access_token", "id_token", "refresh_token"))
            or (tokens.get("account_id") is not None and not _token(tokens["account_id"]))):
        raise CloudNewsAuthError("auth_invalid")
    refreshed = value.get("last_refresh")
    try:
        if not isinstance(refreshed, str) or len(refreshed) > 64:
            raise ValueError("time")
        stamp = datetime.fromisoformat(refreshed.replace("Z", "+00:00"))
        if stamp.tzinfo is None:
            raise ValueError("zone")
    except (ValueError, TypeError):
        raise CloudNewsAuthError("auth_invalid") from None
    return raw


def encryption_key(value):
    """Accept exactly one canonical base64-encoded AES-256 key."""
    try:
        if not isinstance(value, str) or len(value) != 44:
            raise ValueError("size")
        key = base64.b64decode(value, validate=True)
        if len(key) != 32 or base64.b64encode(key).decode("ascii") != value:
            raise ValueError("encoding")
        return key
    except Exception:
        raise CloudNewsAuthError("auth_configuration_invalid") from None


def _encoded(value):
    return base64.b64encode(value).decode("ascii")


def _decoded(value, limit):
    try:
        if not isinstance(value, str) or not 0 < len(value) <= limit:
            raise ValueError("size")
        decoded = base64.b64decode(value, validate=True)
        if _encoded(decoded) != value:
            raise ValueError("encoding")
        return decoded
    except Exception:
        raise CloudNewsAuthError("auth_record_invalid") from None


def _envelope_bytes(value):
    try:
        if (not isinstance(value, dict)
                or set(value) != {"schema", "nonce", "ciphertext"}
                or value["schema"] != AUTH_SCHEMA):
            raise ValueError("schema")
        raw = json.dumps(value, sort_keys=True, separators=(",", ":"),
                         ensure_ascii=True, allow_nan=False).encode("ascii")
        if len(raw) > MAX_ENVELOPE_BYTES:
            raise ValueError("size")
        nonce = _decoded(value["nonce"], 24)
        ciphertext = _decoded(value["ciphertext"], MAX_ENVELOPE_BYTES)
        if len(nonce) != 12 or not 16 < len(ciphertext) <= MAX_AUTH_BYTES + 16:
            raise ValueError("size")
        return raw, nonce, ciphertext
    except CloudNewsAuthError:
        raise
    except Exception:
        raise CloudNewsAuthError("auth_record_invalid") from None


def _digest(value):
    return hashlib.sha256(_envelope_bytes(value)[0]).hexdigest()


def _home_path(value):
    try:
        path = Path(value)
        # Never accept the user's ordinary profile, relative paths or aliases.
        if (not path.is_absolute() or ".." in path.parts or path == Path("/")):
            raise ValueError("path")
        # Resolve metadata only so a parent-directory alias cannot bypass the
        # default-profile exclusion. No file contents are inspected here.
        if path.resolve(strict=False) == (Path.home() / ".codex").resolve(strict=False):
            raise ValueError("profile")
        return path
    except Exception:
        raise CloudNewsAuthError("auth_home_invalid") from None


@contextmanager
def _home(value, *, create=False):
    path, fd = _home_path(value), None
    try:
        if create:
            try:
                os.mkdir(path, 0o700)
            except FileExistsError:
                pass
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        info = os.fstat(fd)
        if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid()
                or stat.S_IMODE(info.st_mode) != 0o700):
            raise CloudNewsAuthError("auth_home_invalid")
        yield fd
    except CloudNewsAuthError:
        raise
    except OSError:
        raise CloudNewsAuthError("auth_home_invalid") from None
    finally:
        if fd is not None:
            os.close(fd)


def _read_file(home_fd, name, *, limit=MAX_AUTH_BYTES, missing="auth_missing"):
    fd = None
    try:
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=home_fd)
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o600
                or not 0 < info.st_size <= limit):
            raise CloudNewsAuthError("auth_invalid")
        with os.fdopen(fd, "rb") as stream:
            fd = None
            raw = stream.read(limit + 1)
        if not 0 < len(raw) <= limit:
            raise CloudNewsAuthError("auth_invalid")
        return raw
    except FileNotFoundError:
        raise CloudNewsAuthError(missing) from None
    except CloudNewsAuthError:
        raise
    except OSError:
        raise CloudNewsAuthError("auth_invalid") from None
    finally:
        if fd is not None:
            os.close(fd)


def _create_file(home_fd, name, raw):
    fd, created = None, False
    try:
        fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     0o600, dir_fd=home_fd)
        created = True
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as stream:
            fd = None
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
    except FileExistsError:
        raise CloudNewsAuthError("auth_exists") from None
    except OSError:
        if created:
            try:
                os.unlink(name, dir_fd=home_fd)
            except OSError:
                pass
        raise CloudNewsAuthError("auth_home_invalid") from None
    finally:
        if fd is not None:
            os.close(fd)


class SupabaseAuthStore:
    """Bounded existing transport, one fixed object, no bucket creation/listing."""
    __slots__ = ("_storage",)

    def __init__(self, storage):
        self._storage = storage

    def __repr__(self):
        return "<SupabaseAuthStore>"

    def __reduce__(self):
        raise TypeError("credential_serialization_disabled")

    def _private(self):
        from daily_news_runtime import BUCKET
        try:
            response = self._storage._request("GET", "/bucket/" + BUCKET)
            if not 200 <= response.status_code < 300:
                raise CloudNewsAuthError("auth_storage_unavailable")
            value = response.json()
            if (not isinstance(value, dict) or value.get("id") != BUCKET
                    or value.get("public") is not False):
                raise CloudNewsAuthError("auth_storage_not_private")
        except CloudNewsAuthError:
            raise
        except Exception:
            raise CloudNewsAuthError("auth_storage_unavailable") from None

    @staticmethod
    def _fixed(path):
        if path != AUTH_OBJECT:
            raise CloudNewsAuthError("auth_configuration_invalid")

    def read(self, path):
        self._fixed(path)
        self._private()
        try:
            return self._storage.read(AUTH_OBJECT)
        except Exception:
            raise CloudNewsAuthError("auth_storage_unavailable") from None

    def write(self, path, value):
        from daily_news_runtime import BUCKET
        self._fixed(path)
        raw = _envelope_bytes(value)[0]
        self._private()
        try:
            response = self._storage._request("POST", "/object/" + BUCKET + "/" + AUTH_OBJECT,
                data=raw, headers={"Content-Type": "application/json", "x-upsert": "true",
                                   "Cache-Control": "max-age=0"})
            if not 200 <= response.status_code < 300:
                raise CloudNewsAuthError("auth_storage_unavailable")
        except CloudNewsAuthError:
            raise
        except Exception:
            raise CloudNewsAuthError("auth_storage_unavailable") from None


class CloudNewsAuthVault:
    """Restore/checkpoint only a separately authenticated, serialized session."""
    __slots__ = ("_store", "_cipher")

    def __init__(self, store, key):
        if not isinstance(key, bytes) or len(key) != 32:
            raise CloudNewsAuthError("auth_configuration_invalid")
        self._store, self._cipher = store, AESGCM(key)

    def __repr__(self):
        return "<CloudNewsAuthVault>"

    def __reduce__(self):
        raise TypeError("credential_serialization_disabled")

    def close(self):
        # Drop references; this is not a claim of Python-memory zeroization.
        self._store, self._cipher = None, None

    def _seal(self, raw):
        raw = _auth_bytes(raw)
        if self._cipher is None:
            raise CloudNewsAuthError("auth_configuration_invalid")
        nonce = os.urandom(12)
        return {"schema": AUTH_SCHEMA, "nonce": _encoded(nonce),
                "ciphertext": _encoded(self._cipher.encrypt(nonce, raw, _AAD))}

    def _open(self, value):
        _, nonce, ciphertext = _envelope_bytes(value)
        try:
            if self._cipher is None:
                raise CloudNewsAuthError("auth_configuration_invalid")
            raw = self._cipher.decrypt(nonce, ciphertext, _AAD)
        except CloudNewsAuthError:
            raise
        except Exception:
            raise CloudNewsAuthError("auth_decryption_failed") from None
        return _auth_bytes(raw)

    def _read(self):
        try:
            if self._store is None:
                raise CloudNewsAuthError("auth_configuration_invalid")
            return self._store.read(AUTH_OBJECT)
        except CloudNewsAuthError:
            raise
        except Exception:
            raise CloudNewsAuthError("auth_storage_unavailable") from None

    def _write(self, envelope):
        try:
            if self._store is None:
                raise CloudNewsAuthError("auth_configuration_invalid")
            self._store.write(AUTH_OBJECT, envelope)
        except CloudNewsAuthError:
            raise
        except Exception:
            raise CloudNewsAuthError("auth_storage_unavailable") from None

    def restore(self, auth_home):
        envelope = self._read()
        if envelope is None:
            raise CloudNewsAuthError("auth_record_missing")
        raw = self._open(envelope)
        checkpoint = json.dumps({"schema": AUTH_SCHEMA, "snapshot": _digest(envelope)},
                                separators=(",", ":")).encode("ascii")
        with _home(auth_home, create=True) as fd:
            _create_file(fd, AUTH_FILE, raw)
            try:
                _create_file(fd, CHECKPOINT_FILE, checkpoint)
            except CloudNewsAuthError:
                os.unlink(AUTH_FILE, dir_fd=fd)
                raise
        return {"status": "auth_restored"}

    def checkpoint(self, auth_home):
        with _home(auth_home) as fd:
            raw = _auth_bytes(_read_file(fd, AUTH_FILE))
            checkpoint = _loads(_read_file(fd, CHECKPOINT_FILE, limit=512,
                    missing="auth_checkpoint_missing"), 512, "auth_checkpoint_missing")
        if (not isinstance(checkpoint, dict)
                or set(checkpoint) != {"schema", "snapshot"}
                or checkpoint["schema"] != AUTH_SCHEMA
                or not isinstance(checkpoint["snapshot"], str)
                or len(checkpoint["snapshot"]) != 64
                or any(char not in "0123456789abcdef" for char in checkpoint["snapshot"])):
            raise CloudNewsAuthError("auth_checkpoint_missing")
        current = self._read()
        if current is None or _digest(current) != checkpoint["snapshot"]:
            raise CloudNewsAuthError("auth_checkpoint_stale")
        # Authenticate the old record as well; matching an unauthenticated hash
        # must never be enough to replace a record with the wrong AES key.
        self._open(current)
        envelope = self._seal(raw)
        try:
            self._write(envelope)
        except CloudNewsAuthError:
            raise CloudNewsAuthError("auth_checkpoint_failed") from None
        # A job checkpoints once, then discards its dedicated home. Leaving the
        # original snapshot makes an accidental second checkpoint fail closed.
        return {"status": "auth_checkpointed"}

    def seed(self, auth_home):
        """Explicit initial export; an existing remote session is never reset."""
        with _home(auth_home) as fd:
            raw = _auth_bytes(_read_file(fd, AUTH_FILE))
        if self._read() is not None:
            raise CloudNewsAuthError("auth_seed_exists")
        self._write(self._seal(raw))
        return {"status": "auth_seeded"}

    def cleanup(self, auth_home):
        """Remove only this module's files; caller owns the entire temp home."""
        try:
            with _home(auth_home) as fd:
                for name in (AUTH_FILE, CHECKPOINT_FILE):
                    try:
                        os.unlink(name, dir_fd=fd)
                    except FileNotFoundError:
                        pass
        except Exception:
            raise CloudNewsAuthError("auth_cleanup_failed") from None
        return {"status": "auth_cleaned"}

    @contextmanager
    def session(self, auth_home):
        """Checkpoint even when the caller's writing/review operation fails."""
        self.restore(auth_home)
        try:
            yield
        finally:
            try:
                self.checkpoint(auth_home)
            finally:
                self.cleanup(auth_home)


def configuration(environ=None):
    env = os.environ if environ is None else environ
    # Presence only: no parsing, authentication, filesystem or transport.
    missing = [name for name in _ENV_NAMES if not env.get(name)]
    return {"status": "dry_run", "live": False, "configured": not missing,
            "missing": missing}


def main(argv=None, *, environ=None, store_factory=None):
    parser = argparse.ArgumentParser(description="Encrypted private runner account-auth handoff")
    parser.add_argument("operation", nargs="?", default="status",
                        choices=("status", "restore", "checkpoint", "seed", "cleanup"))
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--auth-home", help="Dedicated temporary Codex home; never the user's profile")
    args = parser.parse_args(argv)
    env, vault = os.environ if environ is None else environ, None
    result, code = configuration(env), 0
    if args.live:
        try:
            if args.operation == "status" or not args.auth_home:
                raise CloudNewsAuthError("auth_configuration_invalid")
            _home_path(args.auth_home)
            key = encryption_key(env.get(KEY_ENV))
            if store_factory is None:
                from daily_news_runtime import SupabaseNewsStorage
                from mac_news_credentials import validated_storage
                try:
                    pair = validated_storage({name: env.get(name) for name in
                                              ("SUPABASE_URL", "SUPABASE_KEY")})
                    store = SupabaseAuthStore(SupabaseNewsStorage(
                        pair["SUPABASE_URL"], pair["SUPABASE_KEY"]))
                except Exception:
                    raise CloudNewsAuthError("auth_configuration_invalid") from None
            else:
                store = store_factory(env)
            vault = CloudNewsAuthVault(store, key)
            result = {**getattr(vault, args.operation)(args.auth_home), "live": True}
        except CloudNewsAuthError as exc:
            result, code = {"status": str(exc), "live": True}, 1
        except Exception:
            result, code = {"status": "auth_configuration_invalid", "live": True}, 1
        finally:
            if vault is not None:
                vault.close()
    print(json.dumps(result, ensure_ascii=True, sort_keys=True))
    return code


if __name__ == "__main__":
    sys.exit(main())
