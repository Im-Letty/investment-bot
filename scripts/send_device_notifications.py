"""Explicit one-batch reminder sender; no timers, market calls or retries.

Run from an existing trusted scheduler only after configuration/deployment.
This script never creates a scheduler, keys, account, or service subscription.
"""
import os
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from device_notifications import NotificationRepository, run_delivery_batch, NotificationError
from web_push_transport import WebPushSender


def main():
    sender=WebPushSender(os.environ.get("WEB_PUSH_VAPID_PRIVATE_KEY",""),
                         os.environ.get("WEB_PUSH_VAPID_SUBJECT",""))
    repo=NotificationRepository(os.environ.get("SUPABASE_URL",""),os.environ.get("SUPABASE_KEY",""))
    try:
        counts=run_delivery_batch(repo,sender,enabled=os.environ.get("WEB_PUSH_ENABLED")=="1")
        # Counters only, never endpoints, credentials, messages, provider responses.
        print("enabled={enabled} claimed={claimed} accepted={sent} expired={expired} unconfirmed={unavailable}".format(**counts))
        return 0
    except NotificationError:
        print("notification_batch_unconfirmed")
        return 1


if __name__=="__main__":
    raise SystemExit(main())
