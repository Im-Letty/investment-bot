"""Explicit, read-only CI connection check; never generate or publish news.

The default only checks configuration names. --check-live permits the existing
three-GET private storage check and a native ChatGPT login-status preflight.
No key, auth file contents, upstream error body or source text is printed.
"""
import argparse
import json
import os
from pathlib import Path
import sys

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from daily_news_producer import GenerationError
from mac_news_credentials import validated_storage
from scripts.check_codex_connection import check_connection
from scripts.run_codex_news import configuration, preflight_subscription


class EnvironmentStorage:
    def __init__(self, environ):
        self._env = environ

    def load_storage(self):
        return validated_storage({name: self._env.get(name)
                                  for name in ("SUPABASE_URL", "SUPABASE_KEY")})


def check_cloud_connection(environ=None, *, storage_check=check_connection,
                           login_check=preflight_subscription):
    env = os.environ if environ is None else environ
    result = storage_check(EnvironmentStorage(env))
    result["subscription_login_verified"] = False
    result["ai_calls"] = 0
    if result.get("connection_verified") is not True:
        return result
    try:
        login_check(env)
        result["subscription_login_verified"] = True
    except GenerationError:
        result["status"] = "subscription_login_unavailable"
    except Exception:
        result["status"] = "subscription_login_unavailable"
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check-live", action="store_true")
    args = parser.parse_args(argv)
    if not args.check_live:
        result = configuration()
        result.update({"checked": False, "read_only": True, "ai_calls": 0})
        print(json.dumps(result, ensure_ascii=False))
        return 0
    result = check_cloud_connection()
    print(json.dumps(result, ensure_ascii=False))
    return 0 if (result.get("connection_verified") is True
                 and result.get("subscription_login_verified") is True
                 and result.get("status") in ("manifest_missing", "edition_missing", "connection_ready")) else 1


if __name__ == "__main__":
    raise SystemExit(main())
