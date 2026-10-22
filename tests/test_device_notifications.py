"""Offline API ownership, time validation and durable-claim delivery boundaries."""
from copy import deepcopy
from datetime import datetime, timezone
import json
import unittest
from flask import Flask
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
import base64
from device_notifications import (create_notifications_blueprint, NotificationError,
    NotificationRepository, reminder_input, price_rule_input, run_delivery_batch)

ALICE="11111111-1111-4111-8111-111111111111"
BOB="33333333-3333-4333-8333-333333333333"
CLOCK=1792650000.0
def b64(value):return base64.urlsafe_b64encode(value).rstrip(b"=").decode()
SUB={"endpoint":"https://fcm.googleapis.com/fcm/send/fixture-only","keys":{
 "p256dh":b64(ec.generate_private_key(ec.SECP256R1()).public_key().public_bytes(Encoding.X962,PublicFormat.UncompressedPoint)),
 "auth":b64(bytes(range(16)))}}

class Repo:
 def __init__(self):
  self.calls=[];self.actors=[];self.rows={};self.revisions={};self.subs=set();self.fail=False
 def verify_user(self,token):
  self.actors.append(token)
  if token not in ("alice","bob"):raise NotificationError("auth_required")
  return ALICE if token=="alice" else BOB
 def call(self,action,actor=None,data=None):
  self.calls.append((action,actor,deepcopy(data)))
  if self.fail:raise NotificationError("storage_unavailable")
  if action=="status":return {"ok":True,"subscription_count":int(actor in self.subs),"reminders":[deepcopy(v) for (owner,_),v in self.rows.items() if owner==actor],"private_provider_error":"must not escape"}
  if action=="subscribe":self.subs.add(actor)
  elif action=="unsubscribe":self.subs.discard(actor)
  elif action=="schedule":
   key=(actor,data["task_id"]);old=self.revisions.get(key,0)
   if old!=data["expected_revision"]:raise NotificationError("conflict")
   self.revisions[key]=old+1
   self.rows[key]={**data,"revision":old+1,"state":"scheduled","private_endpoint":"must not escape"}
   return {"ok":True,"revision":old+1}
  elif action=="cancel":
   key=(actor,data["task_id"]);self.rows.pop(key,None);self.revisions.pop(key,None)
  return {"ok":True}

class Sender:
 configured=True;public_key="fixture-public-key"

class APITests(unittest.TestCase):
 def setUp(self):
  self.repo=Repo();self.app=Flask(__name__)
  self.app.register_blueprint(create_notifications_blueprint("","",repository=self.repo,sender=Sender(),enabled=True,clock=lambda:CLOCK))
  self.client=self.app.test_client()
 def api(self,method,path,body=None,token="alice"):
  return self.client.open("/api/notifications/"+path,method=method,json=body,headers={} if token is None else {"Authorization":"Bearer "+token})
 def reminder(self):
  return {"due_at":datetime.fromtimestamp(CLOCK+3600,timezone.utc).isoformat(),"timezone":"Asia/Tokyo","expected_revision":0}
 def test_config_is_public_nonsecret_and_price_monitor_stays_off(self):
  response=self.api("GET","config",token=None)
  self.assertEqual(200,response.status_code);self.assertFalse(response.json["price_monitor_enabled"])
  self.assertEqual("no-store",response.headers["Cache-Control"]);self.assertEqual([],self.repo.actors)
 def test_missing_malformed_or_guest_identity_never_reaches_storage(self):
  for header in ("","Basic alice","Bearer ","Bearer a b","Bearer "+"x"*8193):
   response=self.client.post("/api/notifications/subscriptions",json=SUB,headers={"Authorization":header})
   self.assertEqual(401,response.status_code)
  self.assertEqual(401,self.api("POST","subscriptions",SUB,token="guest").status_code)
  self.assertEqual([],self.repo.calls)
 def test_authenticated_owner_is_derived_not_client_supplied(self):
  self.assertEqual(400,self.api("POST","subscriptions",{**SUB,"owner_id":BOB}).status_code)
  self.assertEqual([],self.repo.calls)
  self.assertEqual(200,self.api("POST","subscriptions",SUB).status_code)
  self.assertEqual(ALICE,self.repo.calls[-1][1])
  self.assertEqual(200,self.api("POST","subscriptions",SUB,token="bob").status_code)
  self.assertEqual(BOB,self.repo.calls[-1][1])
 def test_subscription_ssrf_bad_keys_and_duplicates_rejected(self):
  for value in ({**SUB,"endpoint":"http://fcm.googleapis.com/x"},{**SUB,"endpoint":"https://127.0.0.1/x"},{**SUB,"endpoint":"https://fcm.googleapis.com.attacker.invalid/x"},{**SUB,"keys":{"auth":"bad","p256dh":"bad"}}):
   self.assertEqual(400,self.api("POST","subscriptions",value).status_code)
  response=self.client.post("/api/notifications/subscriptions",data='{"endpoint":"a","endpoint":"b","keys":{}}',content_type="application/json",headers={"Authorization":"Bearer alice"})
  self.assertEqual(400,response.status_code);self.assertEqual([],self.repo.calls)
 def test_schedule_timezone_utc_and_stale_tab_conflict(self):
  response=self.api("PUT","reminders/task-1",self.reminder());self.assertEqual(200,response.status_code)
  self.assertEqual(1,response.json["revision"])
  self.assertEqual(409,self.api("PUT","reminders/task-1",self.reminder()).status_code)
  next_value=self.reminder();next_value["expected_revision"]=1
  self.assertEqual(2,self.api("PUT","reminders/task-1",next_value).json["revision"])
 def test_cancel_is_owner_scoped_and_repeated_cancel_idempotent(self):
  for token in ("alice","bob"):self.assertEqual(200,self.api("PUT","reminders/task-1",self.reminder(),token).status_code)
  for _ in range(2):self.assertEqual(200,self.api("DELETE","reminders/task-1").status_code)
  self.assertNotIn((ALICE,"task-1"),self.repo.rows);self.assertIn((BOB,"task-1"),self.repo.rows)
 def test_unknown_timezone_naive_past_future_noninteger_and_extra_target_rejected(self):
  values=[{"timezone":"not/a/timezone"},{"due_at":"2026-10-22T10:00"},{"due_at":datetime.fromtimestamp(CLOCK,timezone.utc).isoformat()},{"due_at":datetime.fromtimestamp(CLOCK+367*86400,timezone.utc).isoformat()},{"expected_revision":True},{"expected_revision":-1},{"owner_id":BOB}]
  for delta in values:
   self.assertEqual(400,self.api("PUT","reminders/task-1",{**self.reminder(),**delta}).status_code,delta)
  self.assertEqual([],self.repo.calls)
 def test_rpc_failure_is_not_empty_success_and_does_not_leak_provider_error(self):
  self.repo.fail=True;response=self.api("GET","status")
  self.assertEqual(503,response.status_code);self.assertEqual({"ok":False,"reason":"storage_unavailable"},response.json)
 def test_status_whitelists_no_subscription_keys_endpoints_or_extra_rpc_fields(self):
  self.api("PUT","reminders/task-1",self.reminder())
  response=self.api("GET","status");self.assertEqual(200,response.status_code)
  self.assertNotIn("must not escape",response.get_data(as_text=True))
  self.assertEqual({"task_id","due_at","timezone","revision","state"},set(response.json["reminders"][0]))
 def test_price_rule_can_only_save_disabled_draft_and_never_gets_a_quote(self):
  value=dict(symbol="7203.T",currency="JPY",direction="above",threshold=2500,enabled=False)
  self.assertEqual(200,self.api("PUT","price-rule",value).status_code)
  self.assertEqual(("price_draft",ALICE,value),self.repo.calls[-1])
  self.assertEqual(409,self.api("PUT","price-rule",{**value,"enabled":True}).status_code)
  for delta in ({"symbol":"7203.JP"},{"currency":"USD"},{"threshold":float("nan")},{"threshold":True}):
   self.assertEqual(400,self.api("PUT","price-rule",{**value,**delta}).status_code)
  self.assertTrue(all(call[0]=="price_draft" for call in self.repo.calls))
 def test_disabled_config_does_not_register_or_schedule_and_cancellation_still_available(self):
  app=Flask(__name__);app.register_blueprint(create_notifications_blueprint("","",repository=self.repo,sender=Sender(),enabled=False,clock=lambda:CLOCK))
  client=app.test_client();headers={"Authorization":"Bearer alice"}
  self.assertEqual(503,client.post("/api/notifications/subscriptions",json=SUB,headers=headers).status_code)
  self.assertEqual(503,client.put("/api/notifications/reminders/task",json=self.reminder(),headers=headers).status_code)
  self.assertEqual(200,client.delete("/api/notifications/reminders/task",headers=headers).status_code)
  self.assertEqual([("cancel",ALICE,{"task_id":"task"})],self.repo.calls)
 def test_worker_is_uncached_separate_scope_and_has_no_fetch_interception(self):
  response=self.client.get("/notifications-worker.js")
  self.assertEqual(200,response.status_code);self.assertEqual("/notifications/",response.headers["Service-Worker-Allowed"])
  self.assertEqual("no-store",response.headers["Cache-Control"]);self.assertNotIn("addEventListener('fetch'",response.get_data(as_text=True));response.close()

class DeliveryTests(unittest.TestCase):
 def jobs(self):
  return [{"id":"55555555-5555-4555-8555-555555555555","owner_id":ALICE,"task_id":"task-1","occurrence_id":"66666666-6666-4666-8666-666666666666","subscription":deepcopy(SUB)}]
 def test_disabled_sender_performs_no_rpc_or_push(self):
  repo=Repo();sender=Sender();self.assertFalse(run_delivery_batch(repo,sender)["enabled"]);self.assertEqual([],repo.calls)
 def test_atomic_claim_and_no_automatic_retry_after_uncertain_send(self):
  outer=self
  class Claims:
   def __init__(self):self.first=True;self.calls=[]
   def call(self,action,actor=None,data=None):
    self.calls.append((action,actor,data))
    if action=="claim":
     jobs=outer.jobs() if self.first else [];self.first=False;return {"ok":True,"jobs":jobs}
    if action=="check_claim":return {"ok":True,"send":True}
    return {"ok":True}
  class Push(Sender):
   def __init__(self):self.payloads=[]
   def send(self,sub,payload):self.payloads.append(payload);return "unavailable"
  repo=Claims();sender=Push()
  first=run_delivery_batch(repo,sender,enabled=True);second=run_delivery_batch(repo,sender,enabled=True)
  self.assertEqual(1,first["unavailable"]);self.assertEqual(0,second["claimed"]);self.assertEqual(1,len(sender.payloads))
  self.assertEqual({"kind","owner_id","task_id","id","occurrence_id"},set(sender.payloads[0]))
  self.assertNotIn("text",sender.payloads[0])
 def test_canceled_claim_does_not_send(self):
  outer=self
  class Claims:
   def call(self,action,actor=None,data=None):return {"ok":True,"jobs":outer.jobs()} if action=="claim" else {"ok":True,"send":False}
  class Push(Sender):
   def send(self,*_):raise AssertionError("must not send canceled reminder")
  counts=run_delivery_batch(Claims(),Push(),enabled=True);self.assertEqual(0,counts["sent"]+counts["unavailable"])

if __name__=="__main__":unittest.main()
