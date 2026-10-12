/* Same-origin guest Auth, with owner-separated local records and no UID import. */
(function(w){
 'use strict';
 var KEY=/^(?:kb2(?:_[A-Za-z0-9_-]+)?|kbday_[A-Za-z0-9_-]+|kk_custom_cats|pg_kakeibo_day)$/;
 var pending=null, client=null;
 function snapshot(){var d={};for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(KEY.test(k))d[k]=localStorage.getItem(k);}return d;}
 function apply(session){
  if(!session||!session.user||!session.access_token)throw new Error('session unavailable');
  var changed=!w.knLedgerSession||w.knLedgerSession.user.id!==session.user.id;
  var id=session.user.id,old=localStorage.getItem('kn_ledger_owner');
  if(old!==id){
   if(old){
    localStorage.setItem('kn_ledger_backup:'+old,JSON.stringify(snapshot()));
    Object.keys(snapshot()).forEach(function(k){localStorage.removeItem(k);});
    var restored=JSON.parse(localStorage.getItem('kn_ledger_backup:'+id)||'{}');
    Object.keys(restored).forEach(function(k){if(KEY.test(k)&&typeof restored[k]==='string')localStorage.setItem(k,restored[k]);});
   }
   localStorage.setItem('kn_ledger_owner',id);
  }
  w.knLedgerSession=session;
  document.documentElement.setAttribute('data-ledger-private-ready','true');
  var notice=document.getElementById('ledger-session-notice');if(notice)notice.remove();
  if(changed){if(w.renderAll)w.renderAll();if(w.renderCalendar)w.renderCalendar();}
  w.dispatchEvent(new Event('knLedgerAuth'));
 }
 function standalone(){
  return new Promise(function(resolve,reject){
   if(client)return resolve(client);
   function init(){client=w.supabase.createClient('https://bvfndgjiahjqdlnyygnx.supabase.co','sb_publishable_s_LIqCCrPuW4ulEfK9P5bw_s3vM_NO1');resolve(client);}
   if(w.supabase)return init();
   var s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';s.onload=init;s.onerror=reject;document.head.appendChild(s);
  });
 }
 function ensure(){
  if(pending)return pending;
  pending=Promise.resolve().then(async function(){
   var session;
   if(w.parent!==w&&w.parent.location.origin===location.origin&&typeof w.parent.knEnsureGuest==='function'){
    session=await w.parent.knEnsureGuest();
   }else{
    var sb=await standalone(),r=await sb.auth.getSession();if(r.error)throw r.error;
    session=r.data.session;
    if(!session){r=await sb.auth.signInAnonymously();if(r.error)throw r.error;session=r.data.session;}
   }
   apply(session);
  }).catch(function(){
   w.knLedgerSession=null;document.documentElement.removeAttribute('data-ledger-private-ready');
   var n=document.getElementById('ledger-session-notice');
   if(!n){n=document.createElement('div');n.id='ledger-session-notice';n.setAttribute('role','status');n.textContent='家計簿の非公開接続を確認しています。接続後に再表示します。';document.body.appendChild(n);}
  }).finally(function(){pending=null;});return pending;
 }
 // Discard the old account immediately; no expired owner may continue syncing.
 w.addEventListener('storage',function(e){if(!e.key||e.key.indexOf('sb-')===0||e.key==='kn_ledger_owner'){w.knLedgerSession=null;document.documentElement.removeAttribute('data-ledger-private-ready');ensure();}});
 if(w.parent!==w)try{w.parent.document.addEventListener('knAuthChange',function(){w.knLedgerSession=null;document.documentElement.removeAttribute('data-ledger-private-ready');ensure();});}catch(ignore){}
 ensure();setInterval(ensure,30000);
})(window);
