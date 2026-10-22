"""No real wait, signal, key, DB request or provider call in these loop tests."""
import unittest
from notification_worker import run_worker
from device_notifications import NotificationError, run_delivery_batch

class Stop:
 def __init__(self):self.stopped=False;self.waits=[]
 def is_set(self):return self.stopped
 def wait(self,seconds):self.waits.append(seconds);self.stopped=True
class Sender:configured=True
class WorkerTests(unittest.TestCase):
 def test_disabled_or_unconfigured_does_not_deliver_or_wait(self):
  for enabled,sender in [(False,Sender()),(True,type("Missing",(),{"configured":False})())]:
   stop=Stop()
   result=run_worker(None,sender,enabled=enabled,stop=stop,
     deliver=lambda *_a,**_k:(_ for _ in ()).throw(AssertionError("must not deliver")))
   self.assertFalse(result["started"]);self.assertEqual([],stop.waits)
 def test_minute_loop_has_bounded_counts_no_overlap_and_interruptible_wait(self):
  stop=Stop();calls=[];reports=[]
  def deliver(*a,**kw):
   calls.append(kw);return {"claimed":2,"sent":1,"expired":0,"unavailable":1}
  result=run_worker(None,Sender(),enabled=True,stop=stop,deliver=deliver,report=reports.append)
  self.assertEqual(1,result["batches"]);self.assertEqual([60],stop.waits);self.assertEqual(1,len(calls))
  self.assertTrue(callable(calls[0]["should_stop"]));self.assertEqual("batch_checked",reports[0]["status"])
 def test_transport_failure_reports_fixed_status_and_keeps_same_interval(self):
  stop=Stop();reports=[]
  def deliver(*_a,**_kw):raise NotificationError("storage_unavailable")
  run_worker(None,Sender(),enabled=True,stop=stop,deliver=deliver,report=reports.append)
  self.assertEqual([{"status":"batch_unconfirmed"}],reports);self.assertEqual([60],stop.waits)
 def test_stop_during_batch_does_not_wait_or_start_another(self):
  stop=Stop()
  def deliver(*_a,**_kw):
   stop.stopped=True;return {"claimed":1,"sent":0,"expired":0,"unavailable":0,"interrupted_unconfirmed":1}
  result=run_worker(None,Sender(),enabled=True,stop=stop,deliver=deliver)
  self.assertEqual(1,result["batches"]);self.assertEqual([],stop.waits)
 def test_invalid_fast_or_unbounded_interval_rejected(self):
  for value in (0,1,59,901,True,60.0,"60"):
   with self.assertRaises(ValueError):run_worker(None,Sender(),enabled=True,stop=Stop(),interval=value)
 def test_stopped_batch_never_claims_private_jobs(self):
  class Repo:
   def call(self,*_):raise AssertionError("must not claim after stop")
  value=run_delivery_batch(Repo(),Sender(),enabled=True,should_stop=lambda:True)
  self.assertEqual(0,value["claimed"])
if __name__=="__main__":unittest.main()
