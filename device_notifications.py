"""Private opt-in Web Push reminders. No market reads or legacy delivery calls.

Claims are durable and never automatically retried after an uncertain send.
A provider acceptance is not evidence that a phone displayed a notification.
"""
from datetime import datetime, timezone
import hashlib
import json
import re
import time
import uuid
from zoneinfo import ZoneInfo

from flask import Blueprint, jsonify, request
import requests
from user_profile_api import SelfProfileRepository, ProfileError, _owner
from web_push_transport import validate_subscription, PushError

MAX_BYTES = 16384
TASK_ID = re.compile(r"[A-Za-z0-9_-]{1,80}\Z")
REASONS = {"invalid_request":400, "auth_required":401, "auth_unavailable":503,
           "storage_unavailable":503, "not_configured":503, "conflict":409,
           "limit_reached":409, "price_source_unverified":409}
RPC = "device_notifications_operation"


class NotificationError(Exception):
    def __init__(self, reason):
        self.reason = reason if reason in REASONS else "storage_unavailable"
        super().__init__(self.reason)


def _unique(pairs):
    value = {}
    for k, v in pairs:
        if k in value:
            raise ValueError("duplicate")
        value[k] = v
    return value


def _invalid(_value):
    raise ValueError("constant")


def parse_bytes(raw):
    try:
        if not isinstance(raw, bytes) or not 0 < len(raw) <= MAX_BYTES:
            raise ValueError()
        return json.loads(raw, object_pairs_hook=_unique, parse_constant=_invalid)
    except Exception:
        raise NotificationError("invalid_request") from None


def task_id(value):
    if not isinstance(value, str) or not TASK_ID.fullmatch(value):
        raise NotificationError("invalid_request")
    return value


def reminder_input(value, *, now=None):
    if not isinstance(value, dict) or set(value) != {"due_at", "timezone", "expected_revision"}:
        raise NotificationError("invalid_request")
    revision = value["expected_revision"]
    if type(revision) is not int or not 0 <= revision <= 9007199254740991:
        raise NotificationError("invalid_request")
    try:
        if not isinstance(value["due_at"], str) or len(value["due_at"]) > 40:
            raise ValueError()
        date = datetime.fromisoformat(value["due_at"].replace("Z", "+00:00"))
        if date.tzinfo is None:
            raise ValueError()
        stamp = date.timestamp()
        clock = time.time() if now is None else now
        if not clock + 30 <= stamp <= clock + 366 * 86400:
            raise ValueError()
        zone = value["timezone"]
        if not isinstance(zone, str) or not 1 <= len(zone) <= 80:
            raise ValueError()
        ZoneInfo(zone)
    except Exception:
        raise NotificationError("invalid_request") from None
    return dict(due_at=date.astimezone(timezone.utc).isoformat(), timezone=zone,
                expected_revision=revision)


def price_rule_input(value):
    # A saved draft is never permission to fetch a quote or send an alert.
    if not isinstance(value, dict) or set(value) != {"symbol","currency","direction","threshold","enabled"}:
        raise NotificationError("invalid_request")
    if value["enabled"] is not False:
        raise NotificationError("price_source_unverified")
    if (not isinstance(value["symbol"], str)
            or not re.fullmatch(r"[0-9A-Z]{4}\.T", value["symbol"])
            or value["currency"] != "JPY"
            or value["direction"] not in ("above","below","percent_up")
            or type(value["threshold"]) not in (int,float)
            or not 0 < value["threshold"] <= 1_000_000_000):
        raise NotificationError("invalid_request")
    return dict(value)


class NotificationRepository:
    """Existing service credential stays server-side; ownership uses caller Auth."""
    def __init__(self, url, key, *, transport=None):
        self.url = str(url or "").rstrip("/")
        self.key = str(key or "")
        self.configured = bool(url and key)
        self.transport = transport or requests
        self.auth = SelfProfileRepository(url, key, transport=self.transport)

    def verify_user(self, token):
        try:
            return _owner(self.auth._call("get", token))
        except ProfileError as error:
            raise NotificationError("auth_required" if error.reason == "login_required"
                                    else "auth_unavailable") from None

    def call(self, action, actor=None, data=None):
        if not self.url or not self.key:
            raise NotificationError("storage_unavailable")
        response = None
        try:
            deadline=time.monotonic()+10
            response = self.transport.post(self.url + "/rest/v1/rpc/" + RPC,
                headers={"apikey":self.key, "Authorization":"Bearer " + self.key,
                         "Content-Type":"application/json"},
                json={"p_action":action, "p_actor":actor, "p_data":data or {}},
                timeout=(2,8), allow_redirects=False, stream=True)
            if response.status_code != 200:
                raise NotificationError("storage_unavailable")
            raw = bytearray()
            for chunk in response.iter_content(chunk_size=4096):
                raw.extend(chunk)
                if len(raw) > 128000 or time.monotonic()>deadline:
                    raise NotificationError("storage_unavailable")
            value = json.loads(bytes(raw), object_pairs_hook=_unique, parse_constant=_invalid)
            if not isinstance(value, dict) or type(value.get("ok")) is not bool:
                raise NotificationError("storage_unavailable")
            if value["ok"] is not True:
                raise NotificationError(value.get("reason"))
            return value
        except NotificationError:
            raise
        except Exception:
            raise NotificationError("storage_unavailable") from None
        finally:
            if response is not None:
                try:
                    response.close()
                except Exception:
                    pass


def create_notifications_blueprint(url, key, *, repository=None, sender=None, enabled=False, clock=time.time):
    repo = repository or NotificationRepository(url,key)
    ready = enabled is True and bool(sender and sender.configured) and getattr(repo,"configured",True)
    bp = Blueprint("device_notifications", __name__)

    def actor():
        header = request.headers.get("Authorization","")
        if not header.startswith("Bearer ") or not 1 <= len(header[7:]) <= 8192 or any(not 33 <= ord(c) <= 126 for c in header[7:]):
            raise NotificationError("auth_required")
        return repo.verify_user(header[7:])

    def payload():
        if request.mimetype != "application/json" or (request.content_length or 0) > MAX_BYTES:
            raise NotificationError("invalid_request")
        return parse_bytes(request.stream.read(MAX_BYTES + 1))

    def subscription():
        value = payload()
        try:
            clean = validate_subscription(value)
        except PushError:
            raise NotificationError("invalid_request") from None
        return dict(subscription=clean, endpoint_hash=hashlib.sha256(clean["endpoint"].encode()).hexdigest())

    @bp.after_request
    def private(response):
        response.headers["Cache-Control"] = "no-store"
        return response

    @bp.errorhandler(NotificationError)
    def error(value):
        return jsonify(ok=False,reason=value.reason),REASONS[value.reason]

    @bp.get("/notifications-worker.js")
    def worker():
        from pathlib import Path
        from flask import send_from_directory
        response=send_from_directory(Path(__file__).resolve().parent / "static",
                                     "notifications-worker.js", mimetype="application/javascript",
                                     max_age=0)
        response.headers["Service-Worker-Allowed"]="/notifications/"
        return response

    @bp.get("/api/notifications/config")
    def config():
        return jsonify(ok=True, enabled=ready, public_key=sender.public_key if ready else "",
                       price_monitor_enabled=False, price_reason="price_source_unverified",
                       requires_home_screen_on_iPhone=True)

    @bp.get("/api/notifications/status")
    def status():
        who=actor()
        result=repo.call("status",who)
        # Never return endpoints, auth secrets, transport errors or arbitrary RPC fields.
        rows=result.get("reminders")
        if not isinstance(rows,list) or len(rows)>100:
            raise NotificationError("storage_unavailable")
        clean=[]
        for row in rows:
            try:
                if not isinstance(row,dict) or row.get("state") not in ("scheduled","dispatched","canceled","expired"):
                    raise ValueError()
                task_id(row["task_id"])
                if type(row["revision"]) is not int or not 1<=row["revision"]<=9007199254740991:
                    raise ValueError()
                due=datetime.fromisoformat(row["due_at"].replace("Z","+00:00"))
                if due.tzinfo is None or not isinstance(row["timezone"],str):
                    raise ValueError()
                clean.append({k:row[k] for k in ("task_id","due_at","timezone","revision","state")})
            except Exception:
                raise NotificationError("storage_unavailable") from None
        count=result.get("subscription_count")
        if type(count) is not int or not 0<=count<=5:
            raise NotificationError("storage_unavailable")
        return jsonify(ok=True,reminders=clean,subscription_count=count,enabled=ready)

    @bp.post("/api/notifications/subscriptions")
    def subscribe():
        who=actor()
        if not ready:
            raise NotificationError("not_configured")
        data=subscription()
        repo.call("subscribe",who,data)
        return jsonify(ok=True)

    @bp.delete("/api/notifications/subscriptions")
    def unsubscribe():
        who=actor()
        value=payload()
        if not isinstance(value,dict) or set(value)!={"endpoint"} or not isinstance(value["endpoint"],str) or len(value["endpoint"])>2048:
            raise NotificationError("invalid_request")
        repo.call("unsubscribe",who,{"endpoint_hash":hashlib.sha256(value["endpoint"].encode()).hexdigest()})
        return jsonify(ok=True)

    @bp.put("/api/notifications/reminders/<identity>")
    def schedule(identity):
        who=actor()
        task_id(identity)
        if not ready:
            raise NotificationError("not_configured")
        data=reminder_input(payload(),now=clock());data["task_id"]=identity
        result=repo.call("schedule",who,data)
        revision=result.get("revision")
        if type(revision) is not int or revision!=data["expected_revision"]+1:
            raise NotificationError("storage_unavailable")
        return jsonify(ok=True,revision=revision)

    @bp.delete("/api/notifications/reminders/<identity>")
    def cancel(identity):
        who=actor()
        task_id(identity)
        repo.call("cancel",who,{"task_id":identity})
        return jsonify(ok=True)

    @bp.put("/api/notifications/price-rule")
    def price_draft():
        who=actor()
        data=price_rule_input(payload())
        repo.call("price_draft",who,data)
        return jsonify(ok=True,enabled=False,reason="price_source_unverified")
    return bp


def run_delivery_batch(repository, sender, *, enabled=False, should_stop=lambda:False):
    """Explicit operator entry point; never starts a timer/collector at import.

    Claims are irrevocably consumed before transmission. An uncertain provider
    response stays unconfirmed and is never automatically retried.
    """
    if enabled is not True or not sender.configured:
        return dict(enabled=False,claimed=0,sent=0,expired=0,unavailable=0)
    if should_stop():
        return dict(enabled=True,claimed=0,sent=0,expired=0,unavailable=0)
    result=repository.call("claim")
    jobs=result.get("jobs")
    if not isinstance(jobs,list) or len(jobs)>20:
        raise NotificationError("storage_unavailable")
    totals=dict(enabled=True,claimed=len(jobs),sent=0,expired=0,unavailable=0)
    for job in jobs:
        if should_stop():
            totals["interrupted_unconfirmed"]=len(jobs)-totals["sent"]-totals["expired"]-totals["unavailable"]
            break
        try:
            if not isinstance(job,dict):
                raise ValueError()
            identity=str(uuid.UUID(job["id"]));owner=str(uuid.UUID(job["owner_id"]))
            occurrence=str(uuid.UUID(job["occurrence_id"]))
            task_id(job["task_id"])
            sub=validate_subscription(job["subscription"])
        except Exception:
            raise NotificationError("storage_unavailable") from None
        # A completed/deleted item or disabled subscription cancels queued work.
        check=repository.call("check_claim",None,{"id":identity})
        if check.get("send") is not True:
            continue
        if should_stop():
            totals["interrupted_unconfirmed"]=len(jobs)-totals["sent"]-totals["expired"]-totals["unavailable"]
            break
        outcome=sender.send(sub,dict(kind="todo",owner_id=owner,task_id=job["task_id"],
                                   id=identity,occurrence_id=occurrence))
        outcome=outcome if outcome in ("sent","expired","unavailable") else "unavailable"
        totals[outcome]+=1
        repository.call("finish",None,{"id":identity,"outcome":outcome})
    return totals
