"""Dedicated configured-only reminder scheduler; no shared site/news timer.

An application process importing this module never starts the loop. Deployment
must explicitly choose scripts/run_device_notification_worker.py as its command.
"""
from device_notifications import run_delivery_batch, NotificationError


def run_worker(repository, sender, *, enabled, stop, interval=60,
               deliver=run_delivery_batch, report=lambda _value:None):
    if type(interval) is not int or not 60 <= interval <= 900:
        raise ValueError("invalid_notification_interval")
    if enabled is not True or not sender.configured or not getattr(repository,"configured",True):
        return {"started":False,"batches":0,"configuration_ready":False}
    batches=0
    while not stop.is_set():
        try:
            value=deliver(repository,sender,enabled=True,should_stop=stop.is_set)
            # Never pass endpoints, keys, payloads or remote error strings to logs.
            clean={k:value.get(k,0) for k in
                   ("claimed","sent","expired","unavailable","interrupted_unconfirmed")}
            if any(type(v) is not int or not 0<=v<=20 for v in clean.values()):
                raise NotificationError("storage_unavailable")
            report(dict(status="batch_checked",**clean))
        except NotificationError:
            report({"status":"batch_unconfirmed"})
        batches+=1
        if stop.is_set():
            break
        # SIGTERM/SIGINT wake this wait immediately. No overlap or catch-up burst.
        stop.wait(interval)
    return {"started":True,"batches":batches,"configuration_ready":True}
