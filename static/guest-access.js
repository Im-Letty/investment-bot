/* Registration-free access retains a distinct verified owner per browser. */
(function(w){
  'use strict';
  w.KN_REGISTRATION_REQUIRED=false;
  // An explicit logout returns to the three entry choices, even for a browser
  // that has already visited. Do not silently create a guest behind that entry.
  try{w.knEntryChoiceRequired=new URLSearchParams(location.search).get('entry')==='logout';}catch(_){w.knEntryChoiceRequired=false;}
  var pending=null,generation=0;
  w.knPrepareLogout=function(){
    w.knEntryChoiceRequired=true;generation++;
    // A guest creation already sent to the SDK must settle before signOut.
    // Otherwise its later completion could authenticate after the logout.
    if(!pending)return Promise.resolve();
    return new Promise(function(resolve,reject){
      // A stalled SDK request must leave logout retryable, without signing out
      // before that request settles or pretending that it was cancelled.
      var timer=setTimeout(function(){reject(new Error('logout_pending_timeout'));},12000);
      function finish(){clearTimeout(timer);resolve();}
      pending.then(finish,finish);
    });
  };
  function client(){return new Promise(function(resolve,reject){
    var started=Date.now();
    function check(){if(w.sb&&w.sb.auth){resolve(w.sb);return;}
      if(Date.now()-started>15000){reject(new Error('guest_connection_unavailable'));return;}
      setTimeout(check,100);
    }check();
  });}
  w.knEnsureGuest=function(){
    if(w.knEntryChoiceRequired)return Promise.reject(new Error('entry_choice_required'));
    if(pending)return pending;
    var revision=generation;
    function assertCurrent(){if(revision!==generation||w.knEntryChoiceRequired)throw new Error('guest_request_cancelled');}
    pending=client().then(async function(sb){
      assertCurrent();
      var current=await sb.auth.getSession();
      if(current.error)throw new Error('guest_session_unavailable');
      var session=current.data&&current.data.session;
      assertCurrent();
      if(!session){var result=await sb.auth.signInAnonymously();
        if(result.error||!result.data||!result.data.session)throw new Error('guest_session_unavailable');
        session=result.data.session;
      }
      assertCurrent();
      var changed=!w.knUser||w.knUser.id!==session.user.id;
      w.knUser=session.user;
      document.documentElement.setAttribute("data-kn-session-ready","true");
      if(changed)document.dispatchEvent(new Event('knAuthChange'));
      return session;
    }).finally(function(){pending=null;});
    return pending;
  };
})(window);
