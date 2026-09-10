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
  const kind=signup?'registration':'authentication';
  const button=document.getElementById('passkeyStart');
  const message=document.getElementById('passkeyMessage');
  const csrf=document.querySelector('meta[name="csrf-token"]').content;
  let options=null,preparedAt=0,busy=false;
  const initialLabel=button.textContent;
  function say(text,error){message.textContent=text;message.className='kna-msg'+(error?' kna-err':'');}
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
    const response=await fetch('/auth/passkey/'+kind+'/'+endpoint,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(data)});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||'接続を確認して、もう一度お試しください。');
    return result;
  }
  async function prepare(){
    button.disabled=true;options=null;
    try{options=browserOptions(await post('options',{}));preparedAt=Date.now();button.disabled=false;say('');}
    catch(error){say(error.message,true);button.textContent='もう一度準備する';button.disabled=false;}
  }
  button.addEventListener('click',async()=>{
    if(busy)return;
    if(!options||Date.now()-preparedAt>240000){button.textContent=initialLabel;say('準備しています…');await prepare();return;}
    busy=true;button.disabled=true;
    try{
      // Start WebAuthn synchronously from the click to preserve Safari user activation.
      const pending=signup?navigator.credentials.create({publicKey:options}):navigator.credentials.get({publicKey:options});
      say('端末の案内に沿って操作してください。');
      const credential=await pending;
      if(!credential)throw new Error('認証を完了できませんでした。もう一度お試しください。');
      say('確認しています…');
      const result=await post('verify',{credential:serialize(credential)});
      const destination=new URL(result.redirect_url);
      if(destination.origin!=='https://bvfndgjiahjqdlnyygnx.supabase.co'||destination.pathname!=='/auth/v1/callback')throw new Error('接続先を確認できませんでした。');
      location.assign(destination.href);
    }catch(error){
      const text=error.name==='NotAllowedError'?'認証が完了しませんでした。もう一度お試しいただけます。':error.name==='InvalidStateError'?'このパスキーは登録済みです。ログインをお試しください。':error.name==='NotSupportedError'?'この環境ではパスキーを利用できません。SafariやChromeでお試しください。':error.message;
      options=null;button.textContent='もう一度試す';button.disabled=false;say(text,true);busy=false;
    }
  });
  if(!window.PublicKeyCredential||!navigator.credentials){say('この環境ではパスキーを利用できません。SafariやChromeでお試しください。',true);return;}
  prepare();
})();
