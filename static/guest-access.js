/* Registration-free access retains a distinct verified owner per browser. */
(function(w){
  'use strict';
  w.KN_REGISTRATION_REQUIRED=false;
  var pending=null;
  function client(){return new Promise(function(resolve,reject){
    var started=Date.now();
    function check(){if(w.sb&&w.sb.auth){resolve(w.sb);return;}
      if(Date.now()-started>15000){reject(new Error('guest_connection_unavailable'));return;}
      setTimeout(check,100);
    }check();
  });}
  w.knEnsureGuest=function(){
    if(pending)return pending;
    pending=client().then(async function(sb){
      var current=await sb.auth.getSession();
      if(current.error)throw new Error('guest_session_unavailable');
      var session=current.data&&current.data.session;
      if(!session){var result=await sb.auth.signInAnonymously();
        if(result.error||!result.data||!result.data.session)throw new Error('guest_session_unavailable');
        session=result.data.session;
      }
      var changed=!w.knUser||w.knUser.id!==session.user.id;
      w.knUser=session.user;
      document.documentElement.setAttribute("data-kn-session-ready","true");
      if(changed)document.dispatchEvent(new Event('knAuthChange'));
      return session;
    }).finally(function(){pending=null;});
    return pending;
  };
})(window);
