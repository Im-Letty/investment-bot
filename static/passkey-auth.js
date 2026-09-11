'use strict';
window.knApplyEntryColor=function(hex){
  const defaults={'--mm-bg':'#356c5c','--mm-halo':'#83c9af','--mm-cool':'#e2fff4','--mm-accent':'#e1edb9','--mm-ink':'#184b3c','--mm-muted':'#365d50','--letter':'#416439','--entry-button':'#205c49','--entry-surface':'linear-gradient(155deg,#edf9f1,#a2d6bf 53%,#dff3e7)'};
  let palette=defaults;
  if(/^#[0-9a-f]{6}$/i.test(hex||'')&&hex.toLowerCase()!=='#3da060'){
    const rgb=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255),hi=Math.max(...rgb),lo=Math.min(...rgb),d=hi-lo,l=(hi+lo)/2;
    let h=0;if(d){h=hi===rgb[0]?(rgb[1]-rgb[2])/d%6:hi===rgb[1]?(rgb[2]-rgb[0])/d+2:(rgb[0]-rgb[1])/d+4;h=(h*60+360)%360;}
    const sat=d?d/(1-Math.abs(2*l-1))*100:0;
    const tone=Math.min(70,sat),hsl=(s,l)=>`hsl(${h.toFixed(2)},${s.toFixed(2)}%,${l}%)`;
    // Keep pale backgrounds luminous and the sphere shaded, even for very light input.
    palette={'--mm-bg':hsl(tone*.6,32),'--mm-halo':hsl(tone,68),'--mm-cool':hsl(tone,94),'--mm-accent':hsl(tone*.7,82),'--mm-ink':hsl(tone*.7,20),'--mm-muted':hsl(tone*.4,30),'--letter':hsl(tone*.55,28),'--entry-button':hsl(tone*.7,25),'--entry-surface':`linear-gradient(155deg,${hsl(tone,96)},${hsl(tone,75)} 53%,${hsl(tone,91)})`};
  }
  for(const [key,value] of Object.entries(palette))document.documentElement.style.setProperty(key,value);
  document.querySelectorAll('#news-pastel-palettes,#news-pastel-palettes section,#news-mint-welcome').forEach(el=>{for(const [key,value] of Object.entries(palette))el.style.setProperty(key,value);});
};
try{window.knApplyEntryColor(localStorage.getItem('userBrandColor'));}catch(e){window.knApplyEntryColor(null);}

(function(){
  const signup=document.body.dataset.mode==='signup';
  const checkExisting=!signup&&document.body.dataset.intent==='signup';
  const kind=signup?'registration':'authentication';
  const button=document.getElementById('passkeyStart');
  const newButton=document.getElementById('passkeyNew');
  const message=document.getElementById('passkeyMessage');
  const title=document.getElementById('knaTitle');
  const intro=document.getElementById('passkeyIntro');
  const csrf=document.querySelector('meta[name="csrf-token"]').content;
  let options=null,preparedAt=0,busy=false,preparing=null,needsRestart=false;
  let restartMode=(signup||checkExisting)?'signup':'login',registrationUncertain=false;
  let accountConfirmed=false,confirmedRedirect=null,confirmedUntil=0;
  // Leave time for the 60-second ceremony and verification within the server's
  // five-minute challenge lifetime.
  const maxOptionsAge=180000;
  const initialLabel=button.textContent;
  function say(text,error){message.textContent=text;message.className='kna-msg'+(error?' kna-err':'');}
  function lockButtons(){button.disabled=true;if(newButton)newButton.disabled=true;}
  function unlockButtons(){button.disabled=busy;if(newButton)newButton.disabled=busy||needsRestart||accountConfirmed;}
  function readyLabel(){return accountConfirmed?'元のアカウントでログイン':registrationUncertain?'保存したパスキーでログイン':needsRestart?(restartMode==='signup'?'登録画面を開き直す':'ログイン画面を開き直す'):(options?initialLabel:'もう一度試す');}
  function showFailure(error){
    if(error.restartRequired){
      needsRestart=true;say(error.message,true);return;
    }
    if(error.status===403){
      needsRestart=true;
      say('この画面から認証を続けられません。'+(restartMode==='signup'?'登録':'ログイン')+'画面を開き直してください。',true);
      return;
    }
    if(checkExisting&&error.name==='NotAllowedError'){
      say('パスキーを確認できませんでした。登録済みの方はもう一度お試しください。別の端末や、登録時のログイン方法も使えます。初めての方は下の「初めて利用する方」から進めます。',true);
      return;
    }
    const text=error.name==='NotAllowedError'?'認証が完了しませんでした。もう一度お試しいただけます。':error.name==='InvalidStateError'?'このパスキーは登録済みです。ログインをお試しください。':error.name==='NotSupportedError'?'この環境ではパスキーを利用できません。SafariやChromeでお試しください。':error.message;
    say(text,true);
  }
  function decode(value){
    const str=atob(value.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(value.length/4)*4,'='));
    return Uint8Array.from(str,c=>c.charCodeAt(0));
  }
  function encode(value){
    if(!value)return null;
    const bytes=new Uint8Array(value);let str='';
    for(let i=0;i<bytes.length;i++)str+=String.fromCharCode(bytes[i]);
    return btoa(str).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  function browserOptions(data){
    const result={...data,challenge:decode(data.challenge)};
    if(result.user)result.user={...result.user,id:decode(result.user.id)};
    for(const key of ['excludeCredentials','allowCredentials'])if(result[key])result[key]=result[key].map(c=>({...c,id:decode(c.id)}));
    return result;
  }
  function serialize(credential){
    const response=credential.response;
    const result={id:credential.id,rawId:encode(credential.rawId),type:credential.type,
      clientExtensionResults:credential.getClientExtensionResults(),
      response:{clientDataJSON:encode(response.clientDataJSON)}};
    if(credential.authenticatorAttachment)result.authenticatorAttachment=credential.authenticatorAttachment;
    if(signup){
      result.response.attestationObject=encode(response.attestationObject);
      if(response.getTransports)result.response.transports=response.getTransports();
    }else{
      result.response.authenticatorData=encode(response.authenticatorData);
      result.response.signature=encode(response.signature);
      result.response.userHandle=encode(response.userHandle);
    }
    return result;
  }
  async function post(endpoint,data){
    // Bound preparation waits. Verification may commit a credential, so its
    // response is deliberately not interrupted or automatically resubmitted.
    const controller=endpoint==='options'?new AbortController():null;
    let timedOut=false;
    function timeoutError(){
      const error=new Error('接続に時間がかかっています。'+(restartMode==='signup'?'登録':'ログイン')+'画面を開き直して、もう一度お試しください。');
      // An aborted request can still finish on the server. Use a new flow so
      // a late challenge update cannot invalidate the next attempt.
      error.restartRequired=true;
      return error;
    }
    const timer=controller?setTimeout(()=>{timedOut=true;controller.abort();},20000):null;
    try{
      const response=await fetch('/auth/passkey/'+kind+'/'+endpoint,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(data),...(controller?{signal:controller.signal}:{})});
      const result=await response.json().catch(()=>({}));
      if(timedOut)throw timeoutError();
      if(!response.ok){
        const error=new Error(result.error||'接続を確認して、もう一度お試しください。');
        error.status=response.status;
        throw error;
      }
      return result;
    }catch(error){
      if(timedOut)throw timeoutError();
      if(error instanceof TypeError)throw new Error('接続を確認して、もう一度お試しください。');
      throw error;
    }finally{if(timer!==null)clearTimeout(timer);}
  }
  function prepare(keepMessage=false){
    if(preparing)return preparing;
    lockButtons();button.textContent='準備しています…';options=null;
    preparing=(async()=>{
      try{
        options=browserOptions(await post('options',{}));preparedAt=Date.now();
        if(!keepMessage)say('');
        return true;
      }catch(error){showFailure(error);return false;}
      finally{
        preparing=null;
        button.textContent=readyLabel();
        unlockButtons();
      }
    })();
    return preparing;
  }
  button.addEventListener('click',async()=>{
    if(busy)return;
    let leaving=false,verificationStarted=false;
    busy=true;lockButtons();
    try{
      if(accountConfirmed){
        // The code lasts 60 seconds. Start the shorter local window before
        // verification, and never send an old code after a long reading pause.
        const destination=Date.now()<confirmedUntil?confirmedRedirect:'/?auth=login&v=20260912-confirmed';
        button.textContent='ログイン画面へ進んでいます…';
        location.assign(destination);
        leaving=true;
        return;
      }
      if(needsRestart){
        // Restart through the application's login/signup entry. Reloading this
        // authorize URL would reuse an OAuth state that may already be expired.
        say((restartMode==='signup'?'登録':'ログイン')+'画面を開いています…');
        location.assign('/?auth='+restartMode+'&v=20260912-confirmed');
        leaving=true;
        return;
      }
      if(!options||Date.now()-preparedAt>maxOptionsAge){
        say('準備しています…');
        // Continue this click after fetching instead of consuming a click only
        // to prepare. WebKit supports user activation through a fetch response.
        if(!await prepare())return;
      }
      // Usually options are already prepared, so native authentication starts
      // synchronously from the click, including the first retry after cancel.
      const pending=signup?navigator.credentials.create({publicKey:options}):navigator.credentials.get({publicKey:options});
      options=null;
      say('端末の案内に沿って操作してください。');
      const credential=await pending;
      if(!credential)throw new Error('認証を完了できませんでした。もう一度お試しください。');
      say('確認しています…');
      const payload={credential:serialize(credential)};
      verificationStarted=true;
      const verifyStartedAt=Date.now();
      const result=await post('verify',payload);
      const destination=new URL(result.redirect_url);
      if(destination.origin!=='https://bvfndgjiahjqdlnyygnx.supabase.co'||destination.pathname!=='/auth/v1/callback')throw new Error('接続先を確認できませんでした。');
      if(checkExisting){
        // Show the notice in the central explanation only after server proof.
        // Leave it visible until the member chooses to continue with this account.
        accountConfirmed=true;confirmedRedirect=destination.href;confirmedUntil=verifyStartedAt+45000;
        title.textContent='おかえりなさい';
        intro.textContent='登録済みのアカウントが見つかりました。\n元のアカウントでログインしてください。';
        intro.style.whiteSpace='pre-line';
        for(const id of ['passkeyNewSection','passkeyHelp','passkeyFooter']){
          const element=document.getElementById(id);if(element)element.hidden=true;
        }
        say('');
        return;
      }
      location.assign(destination.href);
      leaving=true;
    }catch(error){
      options=null;
      if(signup&&verificationStarted&&(!error.status||error.status>=500)){
        // The server may have completed registration before its response was
        // lost. Never create another account or replay that verification.
        needsRestart=true;registrationUncertain=true;restartMode='login';
        say('登録結果を確認できませんでした。保存したパスキーでログインをお試しください。',true);
      }else showFailure(error);
      // Prepare the retry now; never replace a challenge while the native
      // ceremony or verification is still in progress.
      if(!needsRestart&&!accountConfirmed)await prepare(true);
    }finally{
      if(!leaving){busy=false;button.textContent=readyLabel();unlockButtons();}
    }
  });
  if(newButton)newButton.addEventListener('click',()=>{
    // Only this explicit action may leave the existing-account check for new
    // registration. A native failure never implies that this is a new person.
    if(busy||preparing||needsRestart||accountConfirmed)return;
    busy=true;lockButtons();
    try{
      const destination=new URL(newButton.dataset.url,location.origin);
      if(destination.origin!==location.origin||destination.pathname!=='/auth/passkey/authorize'||destination.searchParams.get('screen_hint')!=='signup_new')throw new Error('登録画面を開けませんでした。もう一度お試しください。');
      location.assign(destination.href);
    }catch(error){busy=false;showFailure(error);unlockButtons();}
  });
  if(!window.PublicKeyCredential||!navigator.credentials){say('この環境ではパスキーを利用できません。SafariやChromeでお試しください。',true);return;}
  prepare();
})();
