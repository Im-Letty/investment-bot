"""Explicit dedicated background-worker entry. Importing it sends nothing."""
import json
import os
from pathlib import Path
import signal
import sys
from threading import Event
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from device_notifications import NotificationRepository
from web_push_transport import WebPushSender
from notification_worker import run_worker


def main():
    stop=Event()
    for name in (signal.SIGTERM,signal.SIGINT):
        signal.signal(name,lambda *_:stop.set())
    sender=WebPushSender(os.environ.get("WEB_PUSH_VAPID_PRIVATE_KEY",""),
                         os.environ.get("WEB_PUSH_VAPID_SUBJECT",""))
    enabled=os.environ.get("WEB_PUSH_ENABLED","0")=="1"
    try:
        raw=os.environ.get("WEB_PUSH_POLL_SECONDS","60")
        if not raw.isascii() or not raw.isdigit():
            raise ValueError()
        interval=int(raw)
        repository=NotificationRepository(os.environ.get("SUPABASE_URL",""),
                                          os.environ.get("SUPABASE_KEY",""))
        result=run_worker(repository,sender,enabled=enabled,stop=stop,interval=interval,
                          report=lambda value:print(json.dumps(value),flush=True))
        print(json.dumps(result),flush=True)
        return 0 if result["started"] or not enabled else 78
    except ValueError:
        print("notification_worker_configuration_invalid",flush=True)
        return 78


if __name__=="__main__":
    raise SystemExit(main())
