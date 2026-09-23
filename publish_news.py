"""Validate and atomically store an already reviewed website news edition.

This command does not collect news, generate text, call AI, or send messages.
Example: python publish_news.py /tmp/reviewed-issue.json --check-only
"""
import argparse
from contextlib import contextmanager
import fcntl
import json
import math
import os
from pathlib import Path
import stat
import sys
import tempfile
import time

from news_cache import _validated_digest


DEFAULT_PATH = Path(__file__).with_name("news-digests.json")
MAX_ISSUES = 30


class PublicationError(ValueError):
    """An issue or existing publication file failed validation."""


def _reviewed_issue(issue, now):
    validated = _validated_digest(issue)
    if validated is None or validated.get("publication_mode") != "curated":
        raise PublicationError("Input must be one valid reviewed curated edition.")
    if validated["reviewed_at"] > now:
        raise PublicationError("reviewed_at cannot be in the future.")
    return validated


def _read_existing(path):
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return [], []
    except (ValueError, UnicodeError) as error:
        raise PublicationError("Existing publication file is malformed; it was not changed.") from error
    if not isinstance(raw, list):
        raise PublicationError("Existing publication file must be a list; it was not changed.")
    normalized = [_validated_digest(item) for item in raw]
    if any(item is None for item in normalized):
        raise PublicationError("Existing publication file contains an invalid edition; it was not changed.")
    dates = [item["edition_date"] for item in normalized]
    if len(set(dates)) != len(dates):
        raise PublicationError("Existing publication file has duplicate edition dates; it was not changed.")
    return raw, normalized


@contextmanager
def _publication_lock(path):
    # Atomic replacement prevents partial files; the sidecar lock also prevents
    # two scheduled publishers from overwriting each other's distinct editions.
    with path.with_name(path.name + ".lock").open("a", encoding="utf-8") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def _replace_atomically(path, issues):
    temporary = None
    try:
        mode = stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o644
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         prefix="." + path.name + ".", suffix=".tmp", delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(issues, handle, ensure_ascii=False, indent=2, allow_nan=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        temporary.chmod(mode)
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def publish(issue, path=DEFAULT_PATH, now=None, *, check_only=False):
    """Return publication metadata, writing only validated changes to one date."""
    now = time.time() if now is None else now
    if isinstance(now, bool) or not isinstance(now, (int, float)) or not math.isfinite(now):
        raise PublicationError("now must be a finite Unix timestamp.")
    issue = _reviewed_issue(issue, now)
    path = Path(path)

    def prepare_and_publish():
        existing, normalized = _read_existing(path)
        previous = next((item for item in normalized if item["edition_date"] == issue["edition_date"]), None)
        changed = previous != issue
        if changed:
            proposed = [item for item in existing if item["edition_date"] != issue["edition_date"]] + [issue]
            proposed = sorted(proposed, key=lambda item:item["edition_date"])[-MAX_ISSUES:]
            # Refuse silent success if an old import would immediately be pruned.
            if not any(item["edition_date"] == issue["edition_date"] for item in proposed):
                raise PublicationError("Edition is older than the retained publication history.")
            if not check_only:
                _replace_atomically(path, proposed)
        else:
            proposed = existing
        return {"ok": True, "edition_date": issue["edition_date"],
                "reviewed_at": issue["reviewed_at"],
                "publish_at": issue.get("publish_at", issue["reviewed_at"]),
                "article_count": len(issue["article_refs"]), "issue_count": len(proposed),
                "changed": changed, "written": changed and not check_only,
                "check_only": check_only, "path": str(path)}

    if check_only:
        return prepare_and_publish()
    with _publication_lock(path):
        return prepare_and_publish()


def main(argv=None):
    parser = argparse.ArgumentParser(description="Validate and store an already reviewed news edition.")
    parser.add_argument("input", type=Path, help="JSON file containing one reviewed curated edition")
    parser.add_argument("--output", type=Path, default=DEFAULT_PATH, help="Publication JSON list to update")
    parser.add_argument("--check-only", action="store_true", help="Validate without writing files")
    args = parser.parse_args(argv)
    try:
        issue = json.loads(args.input.read_text(encoding="utf-8"))
        result = publish(issue, args.output, check_only=args.check_only)
    except (OSError, ValueError, TypeError) as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
