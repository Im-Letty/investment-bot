'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {create,validate}=require('../static/user-profile.js');
const JPEG='data:image/jpeg;base64,'+Buffer.from([255,216,255,224,0,4,17,23,255,217]).toString('base64'),PHOTO_REF='a'.repeat(64),OTHER_REF='b'.repeat(64);
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const profile=(username='みどり',bio='経済を勉強中',avatar='leaf')=>({username,bio,avatar});
function fixture({user=null,legacy='',extra=null,getUser,getSession,putProfile,persist,decode,encode,getAvatar,initialName=null}={}){
  const events=[],storage=new Map(legacy?[['cm_nick',legacy]]:[]),listeners=new Map(),timers=[],nodes=[];
  let userReads=0,updates=[],requests=[],focus=null,objectSerial=0;const objectURLs=[],revoked=[],draws=[],closed=[];
  class Node{
    constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.attrs={};this.listeners={};this._text='';this.value='';this.hidden=false;this.className='';nodes.push(this);this.classList={toggle:(value,on)=>{const classes=new Set(this.className.split(/\s+/).filter(Boolean));if(on)classes.add(value);else classes.delete(value);this.className=[...classes].join(' ');}};}
    set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}
    appendChild(n){n.parentNode?.removeChild(n);n.parentNode=this;this.children.push(n);return n;}
    insertBefore(n,b){n.parentNode?.removeChild(n);n.parentNode=this;this.children.splice(b?this.children.indexOf(b):0,0,n);return n;}
    removeChild(n){this.children.splice(this.children.indexOf(n),1);n.parentNode=null;}
    get firstChild(){return this.children[0]||null;}get isConnected(){return this===body||!!this.parentNode?.isConnected;}
    setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k]||null;}
    addEventListener(k,fn){(this.listeners[k]||(this.listeners[k]=[])).push(fn);}
    getContext(){assert.equal(this.tagName,'CANVAS');return {fillStyle:'',fillRect(...args){draws.push({fill:args});},drawImage(...args){draws.push({draw:args});}};}
    toDataURL(type,quality){assert.equal(type,'image/jpeg');assert.equal(this.width,192);assert.equal(this.height,192);return encode?encode(quality):JPEG;}
    async fire(k,init={}){const e={target:this,defaultPrevented:false,propagationStopped:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.propagationStopped=true;},...init};for(const fn of this.listeners[k]||[])await fn(e);return e;}
    click(){this.clicks=(this.clicks||0)+1;}
    focus(){focus=this;}scrollIntoView(){}
  }
  const body=new Node('body'),container=new Node('div');body.appendChild(container);
  const document={body,createElement:t=>new Node(t),addEventListener(k,fn){if(!listeners.has(k))listeners.set(k,[]);listeners.get(k).push(fn);},dispatchEvent(e){events.push(e);for(const fn of listeners.get(e.type)||[])fn(e);},getElementById:id=>nodes.find(n=>n.id===id)||null,querySelector:()=>container};
  const w={knUser:user,document,CustomEvent:class{constructor(type,init){this.type=type;this.detail=init.detail;}},Event:class{constructor(type){this.type=type;}},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},setTimeout:(fn,delay=0)=>{const timer={fn,delay,active:true};timers.push(timer);return timer;},clearTimeout(timer){timer.active=false;},addEventListener(){},openDrawer(){},sb:{auth:{
    async getUser(){userReads++;if(getUser)return getUser(w);return {data:{user:w.knUser},error:null};},
    async getSession(){if(getSession)return getSession(w);return {data:{session:{user:w.knUser,access_token:'fixture-token-'+w.knUser.id}},error:null};},
    async updateUser(){assert.fail('SDK updateUser must never choose the write account');}
  }},AbortController,URL:{createObjectURL(blob){const url='blob:fixture-'+(++objectSerial);objectURLs.push({url,blob});return url;},revokeObjectURL(url){revoked.push(url);}},async createImageBitmap(file,options){assert.equal(options.imageOrientation,'from-image');return decode?decode(file):{width:960,height:640,close(){closed.push(file);}};},async fetch(url,options){
    if(url==='/api/user-profile/avatar'){
      requests.push({url,options});if(getAvatar)return getAvatar(w,options);
      const ref=w.knUser.user_metadata.kn_profile_v1.avatar_image;return avatarResponse(ref);
    }
    assert.equal(url,'/api/user-profile');const value=JSON.parse(options.body);updates.push(value);requests.push({url,options});
    let result;
    if(putProfile)result=await putProfile(value,w,options);
    else{
      const actor=options.headers.Authorization.slice('Bearer fixture-token-'.length);
      const stored={...value};if(stored.avatar_image?.startsWith('data:'))stored.avatar_image=PHOTO_REF;
      if(w.knUser.id===actor)w.knUser={...w.knUser,user_metadata:{...w.knUser.user_metadata,kn_profile_v1:stored}};
      result={ok:true,profile:stored,user_id:actor};
    }
    if(result&&typeof result.text==='function')return result;
    return {ok:result&&result.ok===true,text:async()=>JSON.stringify(result)};
  }};
  if(extra)storage.set('kn_profile_guest_v1',JSON.stringify(extra));
  if(persist)w.__knPersistLocalSetting=persist;
  if(initialName)storage.set('kn_profile_initial_name_v1',initialName);
  w.crypto=require('node:crypto').webcrypto;w.TextEncoder=TextEncoder;
  const api=create(w);
  return {w,api,storage,events,container,document,nodes,objectURLs,revoked,draws,closed,reads:()=>userReads,updates:()=>updates,requests:()=>requests,timers:()=>timers,focus:()=>focus,async flush(){for(let i=0;i<timers.length;i++){const timer=timers[i];if(timer.active&&timer.delay===0){timer.active=false;await timer.fn();}}await Promise.resolve();},auth(next){w.knUser=next;document.dispatchEvent(new w.Event('knAuthChange'));}};
}
function avatarResponse(ref,{size=128,type='image/jpeg',ok=true}={}){return {ok,headers:{get:k=>({'x-avatar-image':ref,'content-type':type,'content-length':String(size)})[k.toLowerCase()]??null},blob:async()=>({size,type})};}
function photoProfile(name='みどり',image=PHOTO_REF){return {...profile(name),avatar_image:image};}
function imageSource(h,selector='kn-profile-photo-preview'){return h.nodes.find(n=>n.className===selector)?.children[0]?.src||'';}
async function selectPhoto(h,file={size:4096,type:'image/jpeg',name:'local.jpg'}){const input=h.document.getElementById('knProfilePhoto');input.files=[file];input.value='fakepath';await input.fire('change');return input;}
const settle=()=>new Promise(setImmediate);
function account(id='a',saved=profile(),email='private@example.invalid'){return {id,is_anonymous:false,email,user_metadata:{name:'Provider Legal Name',kn_profile_v1:saved}};}
test('profile validation counts Unicode characters and returns only the public schema',()=>{
  assert.deepEqual(validate({...profile('  🌿'.repeat(1)+'  '),email:'private',role:'admin'}),profile('🌿'));
  assert.equal(validate(profile('🌿'.repeat(20))).username,'🌿'.repeat(20));
  for(const value of [profile('a'.repeat(21)),profile('a\nb'),profile('a\u202eb'),profile('a','x'.repeat(161)),profile('a','x\u0000'),profile('a','','../../icon'),null])assert.throws(()=>validate(value));
  assert.equal(validate(profile('','','leaf')).username,'');
  assert.equal(validate(profile('name','a\r\nb')).bio,'a\nb');
});
test('guest profile retains the existing name and persists public extras locally',async()=>{
  const h=fixture({legacy:'既存の名前'});await h.api.ready();assert.equal(h.api.username(),'既存の名前');assert.equal(h.reads(),0);
  await h.api.save(profile('新しい名前','好きなもの','moon'));
  assert.equal(h.storage.get('cm_nick'),'新しい名前');assert.deepEqual(JSON.parse(h.storage.get('kn_profile_guest_v1')),{version:1,bio:'好きなもの',avatar:'moon'});
  assert.equal(h.api.snapshot().member,false);assert.equal(h.updates().length,0);
  const publicEvent=h.events.findLast(e=>e.type==='knProfileChange');assert.deepEqual(publicEvent.detail,profile('新しい名前','好きなもの','moon'));assert.equal('email'in publicEvent.detail,false);
});
test('guest does not claim success before the encrypted persistence helper completes',async()=>{
  const gate=deferred(),h=fixture({legacy:'前の名前',persist:async(k,v)=>{assert.equal(k,'cm_nick');await gate.promise;h.storage.set(k,v);}});
  await h.api.ready();const save=h.api.saveUsername('次の名前');await new Promise(setImmediate);
  assert.equal(h.api.username(),'前の名前');let done=false;save.then(()=>{done=true;});assert.equal(done,false);
  gate.resolve();await save;assert.equal(h.api.username(),'次の名前');
});
test('failed guest persistence retains the committed name and previous extras',async()=>{
  const extra={version:1,bio:'元の自己紹介',avatar:'sun'},h=fixture({legacy:'前の名前',extra,persist:async()=>{throw new Error('untrusted raw secret');}});
  await h.api.ready();await assert.rejects(h.api.save(profile('次の名前','変更','moon')),/^Error: storage_unavailable$/);
  assert.equal(h.api.username(),'前の名前');assert.deepEqual(JSON.parse(h.storage.get('kn_profile_guest_v1')),extra);
});
test('registered users load only their verified profile and never infer provider or local names',async()=>{
  const h=fixture({user:account('a',undefined),legacy:'他の人の名前'});
  h.w.knUser.user_metadata={name:'Legal Name',full_name:'Legal Name'};
  assert.equal(h.api.username(),'');await h.api.ready();assert.equal(h.api.username(),'');assert.equal(h.api.snapshot().email,'private@example.invalid');assert.equal(h.storage.get('cm_nick'),'他の人の名前');
});
test('member saves send only the profile schema through the same-origin endpoint and preserve extras',async()=>{
  const h=fixture({user:account('a',profile('前','自己紹介','star'))});await h.api.ready();await h.api.saveUsername('  次の名前  ');
  assert.deepEqual(h.updates(),[profile('次の名前','自己紹介','star')]);
  assert.equal(h.w.knUser.user_metadata.name,'Provider Legal Name');assert.equal(h.api.username(),'次の名前');assert.equal([...h.storage.keys()].filter(k=>k!=='kn_profile_initial_name_v1').length,0);
  assert.ok(h.events.every(e=>!e.detail||!('email'in e.detail)));
});
test('auth verification failure fails closed and does not update or adopt local fallback',async()=>{
  const h=fixture({user:account(),legacy:'端末の名前',getUser:async()=>({error:{message:'raw url token'},data:{user:null}})});
  await assert.rejects(h.api.ready(),/^Error: auth_unavailable$/);assert.equal(h.api.username(),'');await assert.rejects(h.api.saveUsername('書込'),/^Error: auth_unavailable$/);assert.equal(h.updates().length,0);
});
test('changing account clears the old name immediately and discards the old pending read',async()=>{
  const a=deferred(),h=fixture({user:account('a'),getUser:async w=>w.knUser.id==='a'?a.promise:{data:{user:w.knUser}}});
  const old=h.api.refresh();h.auth(account('b',profile('二人目')));assert.equal(h.api.username(),'');await h.flush();await h.api.ready();assert.equal(h.api.username(),'二人目');
  a.resolve({data:{user:account('a',profile('一人目'))}});await old;assert.equal(h.api.username(),'二人目');
});
test('account change during save verification prevents any metadata write',async()=>{
  let hold=null;const h=fixture({user:account('a'),getUser:async w=>hold?hold.promise:{data:{user:w.knUser}}});
  await h.api.ready();hold=deferred();const writing=h.api.saveUsername('変更');await new Promise(setImmediate);
  h.auth(account('b',profile('別ユーザー')));hold.resolve({data:{user:account('a')}});await assert.rejects(writing,/account_changed/);
  assert.equal(h.updates().length,0);assert.equal(h.api.username(),'');
});
test('account change during an in-flight update never adopts its old response',async()=>{
  const pending=deferred(),h=fixture({user:account('a'),putProfile:()=>pending.promise});
  await h.api.ready();const writing=h.api.saveUsername('変更');await new Promise(setImmediate);h.auth(account('b',profile('二人目')));
  pending.resolve({ok:true,user_id:'a',profile:profile('変更')});await assert.rejects(writing,/account_changed/);assert.equal(h.api.username(),'');
  await h.flush();await h.api.ready();assert.equal(h.api.username(),'二人目');
});
test('duplicate simultaneous saves are rejected and update failure is retryable',async()=>{
  const pending=deferred();let fail=true;
  const h=fixture({user:account(),putProfile:async(value,w)=>{if(fail)return pending.promise;w.knUser={...w.knUser,user_metadata:{...w.knUser.user_metadata,kn_profile_v1:value}};return {ok:true,user_id:w.knUser.id,profile:value};}});
  await h.api.ready();const first=h.api.saveUsername('変更');await new Promise(setImmediate);await assert.rejects(h.api.saveUsername('重複'),/busy/);
  pending.resolve({ok:false,reason:'raw'});await assert.rejects(first,/storage_unavailable/);assert.equal(h.api.username(),'みどり');
  fail=false;await h.api.saveUsername('再試行');assert.equal(h.api.username(),'再試行');assert.equal(h.updates().length,2);
});
test('mounted editor is idempotent, uses real labels and renders potentially unsafe names as text',async()=>{
  const h=fixture({user:account('a',profile('<img onerror=x>'))});const view=h.api.mount(h.container);assert.equal(h.api.mount(h.container),view);assert.equal(h.container.children.length,1);
  await h.api.ready();const name=h.document.getElementById('knProfileUsername');assert.equal(name.value,'<img onerror=x>');assert.equal(name.autocomplete,'nickname');
  assert.equal(h.nodes.filter(n=>n.tagName==='IMG').length,0);
  const email=h.nodes.find(n=>n.type==='email');assert.equal(email.readOnly,true);assert.equal(email.value,'private@example.invalid');
  assert.equal(h.nodes.find(n=>n.tagName==='FORM').getAttribute('aria-label'),'プロフィールを編集');
  assert.equal(h.nodes.find(n=>n.getAttribute('role')==='status').getAttribute('aria-live'),'polite');
});
test('a failed automatic save leaves its inputs for correction and exposes a fixed safe error',async()=>{
 const h=fixture({user:account(),putProfile:async()=>({ok:false,reason:'https://private.invalid/?token=secret'})});h.api.mount(h.container);await h.api.ready();
 const name=await headerName(h);name.value='入力を残す';await name.fire('input');await name.fire('blur');
 assert.equal(name.value,'入力を残す');const status=h.nodes.find(n=>n.getAttribute('role')==='status');assert.match(status.textContent,/保存できませんでした/);assert.doesNotMatch(status.textContent,/token|https:/);assert.equal(h.nodes.find(n=>n.className==='kn-profile-retry').hidden,false);
});

test('guest loading always releases the in-flight read and refresh sees newer legacy values',async()=>{
  const h=fixture({legacy:'前'});await h.api.refresh();h.storage.set('cm_nick','新');await h.api.refresh();assert.equal(h.api.username(),'新');
});
test('member metadata is not used as an account identifier or permission grant',async()=>{
  const h=fixture({user:{id:'guest-id',is_anonymous:true,user_metadata:{kn_profile_v1:profile('会員のふり'),role:'admin'}}});
  await h.api.ready();assert.equal(h.api.snapshot().member,false);assert.equal(h.reads(),0);await h.api.saveUsername('ゲスト');assert.equal(h.updates().length,0);
});

test('same-owner USER_UPDATED during save neither rereads nor invalidates the saved result',async()=>{
  const h=fixture({user:account('a'),putProfile:async(value,w)=>{
    w.knUser={...w.knUser,user_metadata:{...w.knUser.user_metadata,kn_profile_v1:value}};
    w.document.dispatchEvent(new w.Event('knAuthChange'));
    return {ok:true,user_id:w.knUser.id,profile:value};
  }});
  await h.api.ready();const reads=h.reads();await h.api.saveUsername('更新した名前');await h.flush();
  assert.equal(h.api.username(),'更新した名前');assert.equal(h.reads(),reads+1);assert.equal(h.api.snapshot().error,'');
});
test('a ready call for an old identity rejects even when the new account finishes first',async()=>{
  const pending=deferred(),h=fixture({user:account('a'),getUser:async w=>w.knUser.id==='a'?pending.promise:{data:{user:w.knUser}}});
  const ready=h.api.ready();h.auth(account('b',profile('二人目')));await h.flush();await h.api.ready();
  pending.resolve({data:{user:account('a')}});await assert.rejects(ready,/account_changed/);assert.equal(h.api.username(),'二人目');
});
test('a name editor waiting for old account readiness cannot save that draft to a new account',async()=>{
  const pending=deferred(),h=fixture({user:account('a'),getUser:async w=>w.knUser.id==='a'?pending.promise:{data:{user:w.knUser}}});
  const writing=h.api.saveUsername('最初のアカウント向け');h.auth(account('b',profile('二人目')));await h.flush();await h.api.ready();
  pending.resolve({data:{user:account('a')}});await assert.rejects(writing,/account_changed/);assert.equal(h.api.username(),'二人目');assert.equal(h.updates().length,0);
});

test('a direct form save waiting for identity A cannot write its draft into B',async()=>{
  const pending=deferred(),h=fixture({user:account('a'),getUser:async w=>w.knUser.id==='a'?pending.promise:{data:{user:w.knUser}}});
  const writing=h.api.save(profile('Aで書いた名前','Aの自己紹介'));h.auth(account('b',profile('二人目')));await h.flush();await h.api.ready();
  pending.resolve({data:{user:account('a')}});await assert.rejects(writing,/account_changed/);assert.equal(h.api.username(),'二人目');assert.equal(h.updates().length,0);
});
test('a persistence helper reporting completion without the saved value does not produce success',async()=>{
  const h=fixture({legacy:'前の名前',persist:async()=>{}});await h.api.ready();
  await assert.rejects(h.api.saveUsername('次の名前'),/storage_unavailable/);assert.equal(h.api.username(),'前の名前');
});

test('the member request fixes origin, method, public payload and authorization without SDK writes',async()=>{
  const h=fixture({user:account('a')});await h.api.ready();await h.api.saveUsername('新しい名前');
  const request=h.requests()[0];assert.equal(request.url,'/api/user-profile');assert.equal(request.options.method,'PUT');
  assert.equal(request.options.credentials,'same-origin');assert.equal(request.options.redirect,'error');assert.equal(request.options.cache,'no-store');
  assert.deepEqual(request.options.headers,{'Authorization':'Bearer fixture-token-a','Content-Type':'application/json'});
  assert.deepEqual(JSON.parse(request.options.body),profile('新しい名前'));
  assert.ok(request.options.signal instanceof AbortSignal);assert.equal(request.options.signal.aborted,false);
  assert.doesNotMatch(JSON.stringify(h.api.snapshot()),/fixture-token/);assert.doesNotMatch(JSON.stringify(h.events),/fixture-token/);
  assert.equal([...h.storage.keys()].filter(k=>k!=='kn_profile_initial_name_v1').length,0);
});
test('switching A to B inside fetch still sends only the captured A bearer and never changes B',async()=>{
  const h=fixture({user:account('a'),putProfile:async(value,w,options)=>{
    assert.equal(options.headers.Authorization,'Bearer fixture-token-a');
    w.knUser=account('b',profile('Bの名前'));w.document.dispatchEvent(new w.Event('knAuthChange'));
    return {ok:true,user_id:'a',profile:value};
  }});
  await h.api.ready();await assert.rejects(h.api.saveUsername('Aで入力'),/account_changed/);
  assert.equal(h.requests().length,1);assert.equal(h.requests()[0].options.headers.Authorization,'Bearer fixture-token-a');
  assert.equal(h.w.knUser.id,'b');assert.equal(h.w.knUser.user_metadata.kn_profile_v1.username,'Bの名前');
  await h.flush();await h.api.ready();assert.equal(h.api.username(),'Bの名前');
});
test('an account switch while getSession waits prevents sending the request',async()=>{
  const pending=deferred(),h=fixture({user:account('a'),getSession:()=>pending.promise});
  await h.api.ready();const writing=h.api.saveUsername('Aの下書き');await new Promise(setImmediate);
  h.auth(account('b'));pending.resolve({data:{session:{user:account('a'),access_token:'fixture-token-a'}}});
  await assert.rejects(writing,/account_changed/);assert.equal(h.requests().length,0);
});
test('a mismatched or invalid captured session cannot reach the profile API',async()=>{
  const invalid=[null,{user:account('b'),access_token:'token'},{user:{id:'a',is_anonymous:true},access_token:'token'},
    {user:account('a'),access_token:''},{user:account('a'),access_token:'bad\ntoken'},{user:account('a'),access_token:'x'.repeat(8193)}];
  for(const session of invalid){
    const h=fixture({user:account('a'),getSession:async()=>({data:{session}})});
    await h.api.ready();await assert.rejects(h.api.saveUsername('変更'),/auth_unavailable/);assert.equal(h.requests().length,0);
  }
});
test('a response for a different user or different profile is rejected without adopting it',async()=>{
  for(const putProfile of [
    async value=>({ok:true,user_id:'b',profile:value}),
    async()=>({ok:true,user_id:'a',profile:profile('サーバー応答の別名')}),
    async()=>({ok:false,reason:'raw https://untrusted.invalid/?token=secret'}),
    async()=>({ok:true,text:async()=>'{broken'}),
    async()=>({ok:true,text:async()=>JSON.stringify({ok:true,user_id:'a',profile:profile(),extra:'x'.repeat(9000)})})
  ]){
    const h=fixture({user:account('a'),putProfile});await h.api.ready();
    await assert.rejects(h.api.saveUsername('変更'),/^Error: storage_unavailable$/);assert.equal(h.api.username(),'みどり');
  }
});
test('a stalled profile request times out, aborts, preserves the committed name and permits retry',async()=>{
  const pending=deferred();let stall=true;
  const h=fixture({user:account('a'),putProfile:async(value,w)=>stall?pending.promise:{ok:true,user_id:w.knUser.id,profile:value}});
  await h.api.ready();const writing=h.api.saveUsername('保存待ち');await new Promise(setImmediate);
  const timeout=h.timers().find(timer=>timer.delay===12000&&timer.active);assert.ok(timeout);timeout.fn();
  await assert.rejects(writing,/storage_unavailable/);assert.equal(h.requests()[0].options.signal.aborted,true);assert.equal(h.api.username(),'みどり');
  stall=false;await h.api.saveUsername('再試行');assert.equal(h.api.username(),'再試行');assert.equal(h.requests().length,2);
  pending.resolve({ok:true,user_id:'a',profile:profile('保存待ち')});await new Promise(setImmediate);
  assert.equal(h.api.username(),'再試行','late response cannot replace the completed newer save');
});

test('completed profile reads clear the loading notice without erasing a later save receipt',async()=>{
 for(const user of [null,account()]){
  const h=fixture({user});h.api.mount(h.container);const status=h.nodes.find(n=>n.getAttribute('role')==='status');
  assert.match(status.textContent,/確認しています/);await h.api.ready();assert.equal(status.textContent,'');
  await h.api.saveUsername('保存した名前');assert.equal(status.textContent,'');assert.equal(h.api.username(),'保存した名前');
  await h.api.refresh();assert.equal(status.textContent,'');assert.equal(h.api.username(),'保存した名前');
 }
});

test('optional photos accept only bounded JPEG data or a private content reference',()=>{
  assert.equal(validate(photoProfile('名前',JPEG)).avatar_image,JPEG);assert.equal(validate(photoProfile()).avatar_image,PHOTO_REF);
  assert.equal(validate(photoProfile('名前','')).avatar_image,'');
  for(const value of [null,17,'https://example.invalid/photo.jpg','data:image/svg+xml;base64,PHN2Zz4=',PHOTO_REF.toUpperCase(),'b'.repeat(63),'data:image/jpeg;base64,'+Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(49152)]).toString('base64')])assert.throws(()=>validate(photoProfile('名前',value)),/invalid_avatar_image/);
});
test('album selection crops locally and automatically persists only the validated square photo',async()=>{
 const h=fixture({legacy:'名前'});h.api.mount(h.container);await h.api.ready();const input=await selectPhoto(h);
 assert.equal(input.type,'file');assert.equal(input.value,'');assert.match(input.accept,/heic/);assert.equal(input.capture,undefined);assert.equal(input.getAttribute('capture'),null);
 assert.equal(imageSource(h),JPEG);assert.equal(imageSource(h,'kn-profile-avatar'),JPEG);assert.equal(h.updates().length,0);
 assert.deepEqual(h.draws.find(v=>v.draw).draw.slice(1),[160,0,640,640,0,0,192,192]);assert.equal(h.closed.length,1);
 const saved=JSON.parse(h.storage.get('kn_profile_guest_v1'));assert.equal(saved.avatar_image,JPEG);assert.doesNotMatch(JSON.stringify(saved),/local\.jpg|fakepath/);
 const reload=fixture({legacy:h.storage.get('cm_nick'),extra:saved});reload.api.mount(reload.container);await reload.api.ready();assert.equal(imageSource(reload),JPEG);
 assert.ok(h.events.every(e=>!e.detail||!('avatar_image'in e.detail)));
});

test('photo, preset and initial-icon changes automatically persist without a footer reset action',async()=>{
 const h=fixture({legacy:'名前',extra:{version:1,bio:'',avatar:'star',avatar_image:JPEG}});h.api.mount(h.container);await h.api.ready();await selectPhoto(h);
 assert.equal(h.nodes.some(n=>n.className==='kn-profile-cancel'||n.className==='kn-profile-save'),false);
 const preset=h.document.getElementById('knProfileAvatar');preset.value='moon';await preset.fire('change');assert.equal(h.api.snapshot().avatar_image,'');assert.equal(h.api.snapshot().avatar,'moon');assert.equal(imageSource(h,'kn-profile-avatar'),'');
 await selectPhoto(h);await h.nodes.find(n=>n.className==='kn-profile-photo-reset').fire('click');assert.equal(h.api.snapshot().avatar_image,'');assert.equal(h.api.snapshot().avatar,'leaf');
});

test('empty picker cancellation and repeated selection preserve drafts and permit the same file again',async()=>{
  let decodes=0;const h=fixture({decode:async()=>{decodes++;return {width:100,height:100,close(){}};}});h.api.mount(h.container);await h.api.ready();
  const input=await selectPhoto(h);input.files=[];await input.fire('change');assert.equal(imageSource(h),JPEG);await selectPhoto(h);assert.equal(decodes,2);assert.equal(input.value,'');
});
test('invalid, oversized, undecodable and excessive-pixel files leave the previous photo intact',async()=>{
  const cases=[{file:{size:10*1024*1024+1,type:'image/jpeg'},message:/10MB/},{file:{size:32,type:'text/html'},message:/JPEG・PNG/},{decode:async()=>{throw Error('raw private decoder error');},message:/JPEGかPNG/},{decode:async()=>({width:10000,height:10000,close(){}}),message:/縦横/},{encode:()=> 'data:image/png;base64,AAAA',message:/別の写真/}];
  for(const entry of cases){const h=fixture({extra:{version:1,bio:'',avatar:'leaf',avatar_image:JPEG},decode:entry.decode,encode:entry.encode});h.api.mount(h.container);await h.api.ready();await selectPhoto(h,entry.file);assert.equal(imageSource(h),JPEG);assert.equal(h.api.snapshot().avatar_image,JPEG);const status=h.nodes.find(n=>n.getAttribute('role')==='status');assert.match(status.textContent,entry.message);assert.doesNotMatch(status.textContent,/raw private/);assert.equal(h.document.getElementById('knProfileBio').disabled,false);}
});
test('slow photo preparation blocks writes and cannot complete after reset or account switch',async()=>{
 for(const action of ['reset','switch']){
  const waiting=deferred(),closed=[];const h=fixture({decode:()=>waiting.promise});h.api.mount(h.container);await h.api.ready();const selecting=selectPhoto(h);await settle();
  assert.equal(h.document.getElementById('knProfile').getAttribute('aria-busy'),'true');await assert.rejects(h.api.saveUsername('途中'),/photo_busy/);
  if(action==='reset')await h.nodes.find(n=>n.className==='kn-profile-photo-reset').fire('click');else{h.auth(account('b',profile('二人目')));await h.flush();await h.api.ready();}
  waiting.resolve({width:100,height:100,close(){closed.push(true);}});await selecting;assert.equal(imageSource(h),'');assert.equal(closed.length,1);assert.equal(h.updates().length,0);assert.equal(h.storage.has('kn_profile_guest_v1'),false);
 }
});

test('a later photo selection wins when earlier native decoding resolves last',async()=>{
  const first=deferred();let count=0;const closed=[];const h=fixture({decode:()=>++count===1?first.promise:Promise.resolve({width:100,height:100,close(){closed.push('second');}})});h.api.mount(h.container);await h.api.ready();const pending=selectPhoto(h);await settle();await selectPhoto(h,{size:1024,type:'image/heic',name:'photo.heic'});assert.equal(imageSource(h),JPEG);first.resolve({width:100,height:100,close(){closed.push('first');}});await pending;assert.equal(imageSource(h),JPEG);assert.deepEqual(closed,['second','first']);
});
test('a stalled decoder times out, keeps the saved photo and closes a late bitmap',async()=>{
  const pending=deferred(),closed=[];const h=fixture({decode:()=>pending.promise,extra:{version:1,bio:'',avatar:'leaf',avatar_image:JPEG}});h.api.mount(h.container);await h.api.ready();const selecting=selectPhoto(h);await settle();h.timers().find(t=>t.delay===15000&&t.active).fn();await selecting;assert.equal(imageSource(h),JPEG);assert.equal(h.document.getElementById('knProfileBio').disabled,false);pending.resolve({width:100,height:100,close(){closed.push(true);}});await settle();assert.equal(closed.length,1);
});
test('guest quota failure rolls back name and photo extras and retains the editable photo',async()=>{
  const old={version:1,bio:'元',avatar:'sun',avatar_image:JPEG};const h=fixture({legacy:'元の名前',extra:old});h.api.mount(h.container);await h.api.ready();h.w.localStorage.setItem=(key,value)=>{if(key==='kn_profile_guest_v1'&&JSON.parse(value).bio!=='元')throw Error('QuotaExceededError');h.storage.set(key,String(value));};
  await assert.rejects(h.api.save({...profile('新','変更','moon'),avatar_image:JPEG}),/storage_unavailable/);assert.deepEqual(JSON.parse(h.storage.get('kn_profile_guest_v1')),old);assert.equal(h.storage.get('cm_nick'),'元の名前');assert.equal(h.api.snapshot().avatar_image,JPEG);
  const partial=fixture({legacy:'元',extra:old,persist:async(k,v)=>{partial.storage.set(k,v);throw Error('helper write then reject');}});await partial.api.ready();await assert.rejects(partial.api.saveUsername('変更'),/storage_unavailable/);assert.equal(partial.storage.get('cm_nick'),'元');assert.deepEqual(JSON.parse(partial.storage.get('kn_profile_guest_v1')),old);
});
test('a member photo Save accepts only the canonical reference and loads its private bytes',async()=>{
  const h=fixture({user:account()});h.api.mount(h.container);await h.api.ready();await selectPhoto(h);await settle();
  assert.equal(h.api.snapshot().avatar_image,PHOTO_REF);assert.equal(h.updates()[0].avatar_image,JPEG);assert.equal(h.w.knUser.user_metadata.kn_profile_v1.avatar_image,PHOTO_REF);assert.match(imageSource(h),/^blob:/);assert.equal([...h.storage.keys()].filter(k=>k!=='kn_profile_initial_name_v1').length,0);
  const read=h.requests().find(r=>r.options.method==='GET');assert.equal(read.url,'/api/user-profile/avatar');assert.deepEqual(read.options.headers,{'Authorization':'Bearer fixture-token-a'});assert.equal(read.options.cache,'no-store');assert.equal(read.options.redirect,'error');assert.equal(read.options.credentials,'same-origin');
  assert.ok(h.events.every(e=>!e.detail||!('avatar_image'in e.detail)));assert.doesNotMatch(JSON.stringify(h.events),/data:image|blob:/);
});
test('name saves and legacy three-field edits preserve existing member and guest photos',async()=>{
  for(const member of [false,true]){const h=fixture(member?{user:account('a',photoProfile())}:{legacy:'みどり',extra:{version:1,bio:'経済を勉強中',avatar:'leaf',avatar_image:JPEG}});await h.api.ready();await h.api.saveUsername('新名');assert.equal(h.api.snapshot().avatar_image,member?PHOTO_REF:JPEG);await h.api.save(profile('もう一度'));assert.equal(h.api.snapshot().avatar_image,member?PHOTO_REF:JPEG);if(member)assert.equal(h.updates()[0].avatar_image,PHOTO_REF);}
});
test('a photo response with raw image data, an omitted photo or a changed text profile is rejected',async()=>{
  for(const mutate of [v=>v,v=>{const {avatar_image,...rest}=v;return rest;},v=>({...v,username:'別の名前',avatar_image:PHOTO_REF})]){
    const h=fixture({user:account(),putProfile:async value=>({ok:true,user_id:'a',profile:mutate(value)})});h.api.mount(h.container);await h.api.ready();await selectPhoto(h);await h.nodes.find(n=>n.tagName==='FORM').fire('submit');assert.equal(h.api.snapshot().avatar_image,undefined);assert.equal(imageSource(h),JPEG);assert.equal(imageSource(h,'kn-profile-avatar'),'');assert.match(h.nodes.find(n=>n.getAttribute('role')==='status').textContent,/保存できません/);
  }
});
test('member image fetches reject mismatched refs, MIME and oversized responses and retry on reopen',async()=>{
  for(const bad of [avatarResponse(OTHER_REF),avatarResponse(PHOTO_REF,{type:'text/html'}),avatarResponse(PHOTO_REF,{size:49153}),{...avatarResponse(PHOTO_REF),blob:async()=>({size:49153})}]){
    let fail=true;const h=fixture({user:account('a',photoProfile()),getAvatar:async()=>fail?bad:avatarResponse(PHOTO_REF)});const details=h.api.mount(h.container);await h.api.ready();await settle();assert.equal(imageSource(h),'');assert.equal(h.objectURLs.length,0);assert.equal(h.api.snapshot().avatar_image,PHOTO_REF);fail=false;details.open=true;await details.fire('toggle');await settle();assert.match(imageSource(h),/^blob:/);assert.equal(h.requests().filter(r=>r.options.method==='GET').length,2);
  }
});
test('an old-account image blob finishing after a switch is discarded and existing blob URLs are revoked',async()=>{
  const bytes=deferred();const h=fixture({user:account('a',photoProfile('A')),getAvatar:async()=>({...avatarResponse(PHOTO_REF),blob:()=>bytes.promise})});h.api.mount(h.container);await h.api.ready();await settle();h.auth(account('b',profile('B')));assert.equal(imageSource(h),'');await h.flush();await h.api.ready();bytes.resolve({size:128,type:'image/jpeg'});await settle();assert.equal(imageSource(h),'');assert.equal(h.objectURLs.length,0);assert.equal(h.requests()[0].options.headers.Authorization,'Bearer fixture-token-a');
  const loaded=fixture({user:account('a',photoProfile())});loaded.api.mount(loaded.container);await loaded.api.ready();await settle();const previous=imageSource(loaded);assert.match(previous,/blob:/);loaded.auth(null);assert.equal(imageSource(loaded),'');assert.ok(loaded.revoked.includes(previous));
});
test('a stale image GET cannot display a different ref after the same owner changes their photo',async()=>{
  const response=deferred();let first=true;const h=fixture({user:account('a',photoProfile()),getAvatar:async()=>first?(first=false,response.promise):avatarResponse(OTHER_REF)});h.api.mount(h.container);await h.api.ready();await settle();h.w.knUser=account('a',photoProfile('新しい写真',OTHER_REF));await h.api.refresh();await settle();const current=imageSource(h);response.resolve(avatarResponse(PHOTO_REF));await settle();assert.equal(imageSource(h),current);assert.equal(h.api.snapshot().avatar_image,OTHER_REF);assert.equal(h.objectURLs.length,1);
});
test('an old image error cannot erase a newer prepared private photo',async()=>{
 const wait=deferred(),h=fixture({user:account('a',photoProfile()),putProfile:()=>wait.promise});h.api.mount(h.container);await h.api.ready();await settle();
 const target=h.nodes.find(n=>n.className==='kn-profile-photo-preview'),old=target.children[0],selecting=selectPhoto(h);await settle();old.onerror();assert.equal(imageSource(h),JPEG);
 const active=target.children[0];active.onerror();assert.equal(imageSource(h),'');assert.match(target.textContent,/🌿/);
 wait.resolve({ok:true,user_id:'a',profile:photoProfile()});await selecting;
});

test('the native Image fallback revokes source URLs after decoding and on cancellation',async()=>{
  const images=[];class NativeImage{constructor(){images.push(this);this.naturalWidth=400;this.naturalHeight=600;}set src(value){this.source=value;}get src(){return this.source;}}
  const h=fixture();h.w.createImageBitmap=undefined;h.w.Image=NativeImage;h.api.mount(h.container);await h.api.ready();const first=selectPhoto(h);await settle();assert.equal(images.length,1);const source=images[0].src;images[0].onload();await first;assert.equal(imageSource(h),JPEG);assert.ok(h.revoked.includes(source));assert.deepEqual(h.draws.find(v=>v.draw).draw.slice(1),[0,100,400,400,0,0,192,192]);
  const second=selectPhoto(h);await settle();const nextSource=images[1].src;await h.nodes.find(n=>n.className==='kn-profile-photo-reset').fire('click');await second;assert.equal(images[1].src,'');assert.ok(h.revoked.includes(nextSource));assert.equal(imageSource(h),'');
});
test('a bitmap rejection after timeout cannot start an unexpected native fallback',async()=>{
  const pending=deferred();let fallback=0;const h=fixture({decode:()=>pending.promise});h.w.Image=class{constructor(){fallback++;}};h.api.mount(h.container);await h.api.ready();const selecting=selectPhoto(h);await settle();h.timers().find(t=>t.delay===15000&&t.active).fn();await selecting;pending.reject(Error('late unsupported image'));await settle();assert.equal(fallback,0);assert.equal(h.objectURLs.length,0);
});

test('the editor keeps one native avatar trigger and an anchored two-action chooser without preset selectors',async()=>{
  const h=fixture();h.api.mount(h.container);await h.api.ready();
  const section=h.document.getElementById('knProfile'),button=h.document.getElementById('knProfileIconButton'),choices=h.document.getElementById('knProfileIconChoices'),avatar=h.document.getElementById('knProfileAvatar');
  assert.equal(button.tagName,'BUTTON');assert.equal(button.type,'button');assert.equal(button.getAttribute('aria-controls'),choices.id);assert.match(button.getAttribute('aria-label'),/アイコンを変更/);assert.equal(button.getAttribute('aria-expanded'),'false');assert.equal(choices.hidden,true);assert.equal(choices.getAttribute('role'),'group');
  assert.equal(avatar.type,'hidden');assert.equal(avatar.value,'leaf');assert.equal(h.nodes.filter(n=>n.tagName==='SELECT').length,0);assert.equal(choices.parentNode.parentNode,section);
  const file=h.document.getElementById('knProfilePhoto');assert.equal(file.hidden,true);assert.equal(file.tabIndex,-1);assert.equal(h.nodes.filter(n=>n.className==='kn-profile-photo-row'||n.className==='kn-profile-photo-field'||n.id==='knProfilePhotoHelp').length,0);assert.equal(button.children[0].className,'kn-profile-photo-preview');
  for(let node=button.parentNode;node;node=node.parentNode)assert.notEqual(node.tagName,'SUMMARY','button never nests in the details summary');
  const actions=choices.children[0].children.filter(n=>n.tagName==='BUTTON');assert.deepEqual(actions.map(n=>n.textContent),['アルバムから選ぶ','初期アイコンに戻す']);assert.equal(h.nodes.filter(n=>n.getAttribute('data-avatar')).length,0);
});
test('reset automatically persists the initial icon while preserving the chooser focus contract',async()=>{
 const h=fixture({legacy:'名前',extra:{version:1,bio:'',avatar:'moon'}});h.api.mount(h.container);await h.api.ready();h.api.open();
 const button=h.document.getElementById('knProfileIconButton'),choices=h.document.getElementById('knProfileIconChoices'),summary=h.nodes.find(n=>n.className==='kn-profile-avatar');
 await button.fire('click');assert.equal(choices.hidden,false);assert.equal(h.focus(),h.document.getElementById('knProfileAlbumButton'));
 await h.nodes.find(n=>n.className==='kn-profile-photo-reset').fire('click');assert.equal(choices.hidden,true);assert.equal(h.focus(),button);assert.equal(h.api.snapshot().avatar,'leaf');assert.equal(summary.textContent,'🌿');assert.equal(JSON.parse(h.storage.get('kn_profile_guest_v1')).avatar,'leaf');
});

test('Escape closes just the icon choices, keeps the draft and returns focus to the icon',async()=>{
  const h=fixture();h.api.mount(h.container);await h.api.ready();h.api.open();const button=h.document.getElementById('knProfileIconButton'),choices=h.document.getElementById('knProfileIconChoices'),form=h.nodes.find(n=>n.tagName==='FORM');
  await button.fire('click');const escape=await form.fire('keydown',{key:'Escape'});assert.equal(choices.hidden,true);assert.equal(button.getAttribute('aria-expanded'),'false');assert.equal(h.focus(),button);assert.equal(escape.defaultPrevented,true);assert.equal(escape.propagationStopped,true);assert.equal(h.api.snapshot().avatar,'leaf');assert.equal([...h.storage.keys()].filter(k=>k!=='kn_profile_initial_name_v1').length,0);
  const closed=await form.fire('keydown',{key:'Escape'});assert.equal(closed.defaultPrevented,false);assert.equal(closed.propagationStopped,false,'drawer may handle Escape when the chooser is already closed');
});
test('a member initial-icon reset explicitly clears its old private photo through autosave',async()=>{
 const h=fixture({user:account('a',photoProfile('会員'))});h.api.mount(h.container);await h.api.ready();await settle();assert.match(imageSource(h),/^blob:/);
 await h.nodes.find(n=>n.className==='kn-profile-photo-reset').fire('click');assert.equal(h.api.snapshot().avatar_image,'');assert.equal(h.updates()[0].avatar_image,'');assert.equal(imageSource(h),'');
});

test('loading disables avatar actions, while pending autosave leaves the next edit available',async()=>{
 const read=deferred(),write=deferred(),h=fixture({user:account(),getUser:()=>read.promise,putProfile:()=>write.promise});h.api.mount(h.container);
 const icon=h.document.getElementById('knProfileIconButton'),album=h.document.getElementById('knProfileAlbumButton');assert.equal(icon.disabled,true);assert.equal(album.disabled,true);
 read.resolve({data:{user:account()}});await h.api.ready();assert.equal(icon.disabled,false);const writing=h.api.saveUsername('次');await settle();assert.equal(icon.disabled,false);assert.equal(album.disabled,false);assert.equal(h.document.getElementById('knProfileBio').disabled,false);
 write.resolve({ok:true,user_id:'a',profile:profile('次')});await writing;
});

test('account switching closes the chooser and removes the old initial-icon draft immediately',async()=>{
  const h=fixture({user:account('a',profile('A','','star'))});h.api.mount(h.container);await h.api.ready();h.api.open();const button=h.document.getElementById('knProfileIconButton'),choices=h.document.getElementById('knProfileIconChoices');await button.fire('click');await h.nodes.find(n=>n.className==='kn-profile-photo-reset').fire('click');await button.fire('click');h.auth(account('b',profile('B','','moon')));assert.equal(choices.hidden,true);assert.equal(button.getAttribute('aria-expanded'),'false');assert.equal(button.textContent,'🌿');await h.flush();await h.api.ready();assert.equal(button.textContent,'🌙');assert.equal(h.document.getElementById('knProfileAvatar').value,'moon');assert.equal(h.updates().length,1);
});
test('failed member auto-saves keep the icon draft available for explicit retry',async()=>{
 let fail=true;const h=fixture({user:account('a',profile('前','','moon')),putProfile:async value=>fail?{ok:false}:{ok:true,user_id:'a',profile:value}});h.api.mount(h.container);await h.api.ready();h.api.open();
 const button=h.document.getElementById('knProfileIconButton');await button.fire('click');await h.nodes.find(n=>n.className==='kn-profile-photo-reset').fire('click');
 assert.equal(button.textContent,'🌿');assert.equal(h.api.snapshot().avatar,'moon');const retry=h.nodes.find(n=>n.className==='kn-profile-retry');assert.equal(retry.hidden,false);
 fail=false;await retry.fire('click');assert.equal(h.api.snapshot().avatar,'leaf');assert.equal(retry.hidden,true);assert.equal(h.nodes.find(n=>n.getAttribute('role')==='status').textContent,'');
});

test('the album action remains in the icon chooser and opens its hidden input synchronously',async()=>{
  const h=fixture();h.api.mount(h.container);await h.api.ready();h.api.open();const icon=h.document.getElementById('knProfileIconButton'),choices=h.document.getElementById('knProfileIconChoices'),album=h.document.getElementById('knProfileAlbumButton'),input=h.document.getElementById('knProfilePhoto'),reset=h.nodes.find(n=>n.className==='kn-profile-photo-reset');
  assert.equal(album.parentNode.parentNode,choices);assert.equal(reset.parentNode.parentNode,choices);assert.equal(input.parentNode.parentNode,choices);assert.equal(album.type,'button');await icon.fire('click');const opening=album.fire('click');assert.equal(input.clicks,1,'the native file picker opens in the same click call, before any await');await opening;assert.equal(choices.hidden,true);assert.equal(h.focus(),icon);assert.equal([...h.storage.keys()].filter(k=>k!=='kn_profile_initial_name_v1').length,0);
  await selectPhoto(h);assert.equal(imageSource(h),JPEG);await icon.fire('click');assert.equal(h.focus(),album);const cancelled=album.fire('click');assert.equal(input.clicks,2);await cancelled;input.files=[];await input.fire('change');assert.equal(imageSource(h),JPEG);assert.equal(h.api.snapshot().avatar_image,JPEG);assert.equal(JSON.parse(h.storage.get('kn_profile_guest_v1')).avatar_image,JPEG);
});
test('legacy presets remain compatible and explicit reset automatically clears a saved photo',async()=>{
 for(const avatar of ['star','flower','moon','sun']){
  const h=fixture({legacy:'名前',extra:{version:1,bio:'',avatar,avatar_image:JPEG}});h.api.mount(h.container);await h.api.ready();assert.equal(imageSource(h),JPEG);assert.equal(h.api.snapshot().avatar,avatar);
  await h.nodes.find(n=>n.className==='kn-profile-photo-reset').fire('click');assert.equal(h.api.snapshot().avatar_image,'');assert.equal(h.api.snapshot().avatar,'leaf');assert.equal(imageSource(h),'');
 }
});

test('a real file selection closes the chooser and updates its saved photo label automatically',async()=>{
 const h=fixture({legacy:'名前',extra:{version:1,bio:'',avatar:'moon'}});h.api.mount(h.container);await h.api.ready();h.api.open();
 const button=h.document.getElementById('knProfileIconButton'),choices=h.document.getElementById('knProfileIconChoices');await button.fire('click');await selectPhoto(h);
 assert.equal(choices.hidden,true);assert.equal(imageSource(h),JPEG);assert.match(button.getAttribute('aria-label'),/写真/);assert.equal(h.api.snapshot().avatar_image,JPEG);assert.equal(h.nodes.some(n=>n.className==='kn-profile-cancel'),false);
});

test('guest and member profiles start closed with their saved name as the single heading and icon preview',async()=>{
  for(const member of [false,true]){
    const h=fixture(member?{user:account('a',profile('保存済み','紹介','moon'))}:{legacy:'保存済み',extra:{version:1,bio:'紹介',avatar:'moon'}}),section=h.api.mount(h.container),form=h.nodes.find(n=>n.tagName==='FORM');
    assert.equal(section.open,false);assert.equal(form.hidden,true);await h.api.ready();assert.equal(section.open,false);assert.equal(form.hidden,true);assert.equal(h.nodes.some(n=>n.className==='kn-profile-label'),false);assert.equal(h.nodes.find(n=>n.className==='kn-profile-name').textContent,'保存済み');assert.equal(h.nodes.find(n=>n.className==='kn-profile-avatar').textContent,'🌙');
    const summary=h.nodes.find(n=>n.tagName==='SUMMARY');assert.equal(summary.getAttribute('role'),null);assert.equal(Object.keys(summary.listeners).length,0,'native summary keeps platform click and keyboard behavior');assert.equal(form.parentNode,section);assert.equal(h.document.getElementById('knProfileUsername').parentNode.parentNode,section);assert.equal(h.document.getElementById('knProfileBio').parentNode.parentNode,form);
  }
  const blank=fixture();blank.api.mount(blank.container);await blank.api.ready();assert.equal(blank.nodes.some(n=>n.className==='kn-profile-label'),false);assert.match(blank.nodes.find(n=>n.className==='kn-profile-name').textContent,/^ユーザー[0-9]{10}$/);
});
test('native details toggles show the whole editor and closing also closes the icon choices',async()=>{
  const h=fixture();const section=h.api.mount(h.container);await h.api.ready();const form=h.nodes.find(n=>n.tagName==='FORM'),choices=h.document.getElementById('knProfileIconChoices');section.open=true;await section.fire('toggle');assert.equal(form.hidden,false);await h.document.getElementById('knProfileIconButton').fire('click');assert.equal(choices.hidden,false);section.open=false;await section.fire('toggle');assert.equal(form.hidden,true);assert.equal(choices.hidden,true);assert.equal(h.document.getElementById('knProfileIconButton').getAttribute('aria-expanded'),'false');section.open=true;await section.fire('toggle');assert.equal(form.hidden,false);assert.equal(choices.hidden,true);
});
test('closing and reopening retains edited values and flushes their automatic save without reverting them',async()=>{
 const h=fixture({legacy:'保存済み',extra:{version:1,bio:'保存した紹介',avatar:'star'}}),section=h.api.mount(h.container);await h.api.ready();
 const name=await headerName(h),bio=h.document.getElementById('knProfileBio');name.value='編集中';await name.fire('input');bio.value='下書きの紹介';await bio.fire('input');
 section.open=false;await section.fire('toggle');await settle();section.open=true;await section.fire('toggle');assert.equal(name.value,'編集中');assert.equal(bio.value,'下書きの紹介');assert.equal(h.api.username(),'編集中');assert.equal(h.api.snapshot().bio,'下書きの紹介');assert.equal(h.nodes.some(n=>n.className==='kn-profile-cancel'),false);
});

test('API open synchronizes visibility immediately and a same-owner pending read keeps it open',async()=>{
  const pending=deferred(),h=fixture({user:account(),getUser:()=>pending.promise});assert.equal(h.api.open(),true);const section=h.document.getElementById('knProfile'),form=h.nodes.find(n=>n.tagName==='FORM');assert.equal(section.open,true);assert.equal(form.hidden,false);pending.resolve({data:{user:account()}});await h.api.ready();assert.equal(section.open,true);assert.equal(form.hidden,false);const focus=h.timers().find(t=>t.delay===350&&t.active);assert.ok(focus);focus.fn();assert.equal(h.focus(),h.document.getElementById('knProfileNameButton'));await h.api.refresh();assert.equal(form.hidden,false);assert.equal(section.open,true);
});
test('closing before delayed API focus never focuses hidden fields, and reads or saves never reopen them',async()=>{
  const h=fixture();h.api.mount(h.container);await h.api.ready();h.api.open();const section=h.document.getElementById('knProfile'),form=h.nodes.find(n=>n.tagName==='FORM');section.open=false;await section.fire('toggle');h.timers().find(t=>t.delay===350&&t.active).fn();assert.equal(h.focus(),null);await h.api.refresh();assert.equal(section.open,false);assert.equal(form.hidden,true);await h.api.saveUsername('保存');assert.equal(section.open,false);assert.equal(form.hidden,true);assert.equal(h.nodes.find(n=>n.className==='kn-profile-name').textContent,'保存');
});
test('changing identity closes and clears drafts and invalidates delayed focus before loading the next account',async()=>{
  const h=fixture({user:account('a',profile('Aの名前','Aの紹介','star'))});h.api.mount(h.container);await h.api.ready();h.api.open();const section=h.document.getElementById('knProfile'),form=h.nodes.find(n=>n.tagName==='FORM'),name=h.document.getElementById('knProfileUsername'),bio=h.document.getElementById('knProfileBio');name.value='Aの下書き';bio.value='非公開の下書き';await form.fire('input');h.auth(account('b',profile('Bの名前','Bの紹介','moon')));assert.equal(section.open,false);assert.equal(form.hidden,true);assert.equal(name.value,'');assert.equal(bio.value,'');assert.equal(h.nodes.find(n=>n.className==='kn-profile-name').textContent,'ユーザー');h.timers().find(t=>t.delay===350&&t.active).fn();assert.equal(h.focus(),null);await h.flush();await h.api.ready();assert.equal(section.open,false);assert.equal(form.hidden,true);assert.equal(name.value,'Bの名前');assert.equal(bio.value,'Bの紹介');assert.equal(h.nodes.find(n=>n.className==='kn-profile-name').textContent,'Bの名前');assert.equal(h.api.open(),true);assert.equal(section.open,true);assert.equal(form.hidden,false);
});
test('an intentional API open for a newly changed owner remains open while that profile refreshes',async()=>{
  let pending=null;const h=fixture({user:account('a',profile('A')),getUser:async w=>pending?pending.promise:{data:{user:w.knUser}}});h.api.mount(h.container);await h.api.ready();pending=deferred();h.w.knUser=account('b',profile('B'));assert.equal(h.api.open(),true);const section=h.document.getElementById('knProfile'),form=h.nodes.find(n=>n.tagName==='FORM');assert.equal(section.open,true);assert.equal(form.hidden,false);assert.equal(h.document.getElementById('knProfileUsername').value,'');pending.resolve({data:{user:account('b',profile('B'))}});await h.api.ready();assert.equal(section.open,true);assert.equal(form.hidden,false);assert.equal(h.document.getElementById('knProfileUsername').value,'B');
});
test('collapsing preserves an automatically saved photo and reopening keeps its exact preview',async()=>{
 const h=fixture({legacy:'保存済み'}),section=h.api.mount(h.container);await h.api.ready();section.open=true;await section.fire('toggle');await selectPhoto(h);
 const form=h.nodes.find(n=>n.tagName==='FORM');section.open=false;await section.fire('toggle');assert.equal(form.hidden,true);assert.equal(imageSource(h),JPEG);assert.equal(imageSource(h,'kn-profile-avatar'),JPEG);assert.equal(h.api.snapshot().avatar_image,JPEG);
 section.open=true;await section.fire('toggle');assert.equal(form.hidden,false);assert.equal(imageSource(h),JPEG);assert.equal(JSON.parse(h.storage.get('kn_profile_guest_v1')).avatar_image,JPEG);
});

test('collapsing during native photo preparation keeps it hidden and saves only after successful decoding',async()=>{
 const pending=deferred(),closed=[],h=fixture({decode:()=>pending.promise}),section=h.api.mount(h.container);await h.api.ready();section.open=true;await section.fire('toggle');
 const selecting=selectPhoto(h);await settle();section.open=false;await section.fire('toggle');const form=h.nodes.find(n=>n.tagName==='FORM');assert.equal(form.hidden,true);assert.equal(h.api.snapshot().avatar_image,undefined);
 pending.resolve({width:400,height:600,close(){closed.push(true);}});await selecting;assert.equal(section.open,false);assert.equal(form.hidden,true);assert.equal(imageSource(h),JPEG);assert.equal(closed.length,1);assert.equal(h.api.snapshot().avatar_image,JPEG);
 section.open=true;await section.fire('toggle');assert.equal(form.hidden,false);assert.equal(imageSource(h,'kn-profile-avatar'),JPEG);
});

test('a collapsed member profile still fetches its private photo for the saved summary preview',async()=>{
  const h=fixture({user:account('a',photoProfile('保存済み'))});const section=h.api.mount(h.container);await h.api.ready();await settle();assert.equal(section.open,false);assert.equal(h.nodes.find(n=>n.tagName==='FORM').hidden,true);assert.match(imageSource(h,'kn-profile-avatar'),/^blob:/);assert.equal(h.nodes.some(n=>n.className==='kn-profile-label'),false);assert.equal(h.nodes.find(n=>n.className==='kn-profile-name').textContent,'保存済み');const request=h.requests().find(r=>r.options.method==='GET');assert.equal(request.url,'/api/user-profile/avatar');assert.equal(request.options.headers.Authorization,'Bearer fixture-token-a');assert.ok(h.events.every(e=>!e.detail||!('avatar_image'in e.detail)));
});

test('external profile opening restores the sheet main view before exposing the editor',async()=>{
  const h=fixture(),calls=[];h.w.KNMenuSheet={showMain(){calls.push('main');}};h.w.openDrawer=()=>calls.push('open');
  h.api.mount(h.container);await h.api.ready();assert.equal(h.api.open(),true);
  assert.deepEqual(calls,['open','main']);assert.equal(h.document.getElementById('knProfile').open,true);assert.equal(h.nodes.find(n=>n.tagName==='FORM').hidden,false);assert.equal(h.updates().length,0);
});
test('profile fallback opens a closed menu but never toggles an already-open sheet closed',async()=>{
  const h=fixture();delete h.w.openDrawer;let opened=false,clicks=0;const drawer=h.document.createElement('aside');drawer.id='sideDrawer';drawer.classList={contains:()=>opened};
  const trigger=h.document.createElement('button');trigger.id='knHomeAMenu';trigger.click=()=>{clicks++;opened=!opened;};
  h.w.KNMenuSheet={showMain(){}};h.api.mount(h.container);await h.api.ready();h.api.open();assert.equal(clicks,1);assert.equal(opened,true);h.api.open();assert.equal(clicks,1);assert.equal(opened,true);assert.equal(h.updates().length,0);
});

for(const phase of ['getUser','getSession']){
  test('a stalled '+phase+' during automatic photo save releases busy, retains the draft and permits explicit retry',async()=>{
    let hold=false;const pending=deferred();
    const h=fixture({user:account(),[phase]:async w=>hold?pending.promise:(phase==='getUser'?{data:{user:w.knUser}}:{data:{session:{user:w.knUser,access_token:'fixture-token-a'}}})});
    const section=h.api.mount(h.container);await h.api.ready();section.open=true;await section.fire('toggle');
    hold=true;const selecting=selectPhoto(h);await settle();const status=h.nodes.find(n=>n.getAttribute('role')==='status');
    assert.equal(section.getAttribute('aria-busy'),'true');assert.equal(h.document.getElementById('knProfileBio').disabled,false);
    const deadline=h.timers().find(t=>t.active&&t.delay===12000);assert.ok(deadline);deadline.fn();await selecting;
    assert.equal(section.getAttribute('aria-busy'),'false');assert.match(status.textContent,/アカウントを確認できませんでした/);assert.equal(imageSource(h),JPEG);assert.equal(h.api.snapshot().avatar_image,undefined);assert.equal(h.updates().length,0);
    hold=false;await h.nodes.find(n=>n.className==='kn-profile-retry').fire('click');assert.equal(h.updates().length,1);assert.equal(h.api.snapshot().avatar_image,PHOTO_REF);
    pending.resolve(phase==='getUser'?{data:{user:account()}}:{data:{session:{user:account(),access_token:'fixture-token-a'}}});await settle();assert.equal(h.updates().length,1);assert.equal(status.textContent,'');assert.ok(h.timers().filter(t=>t.delay===12000).every(t=>!t.active));
  });
}
test('an initial SDK read deadline also clears loading and permits a fresh verified read',async()=>{
  let stuck=true;const pending=deferred(),h=fixture({user:account(),getUser:async w=>stuck?pending.promise:{data:{user:w.knUser}}});
  h.api.mount(h.container);const loading=h.api.ready();await settle();const timeout=h.timers().find(t=>t.active&&t.delay===12000);assert.ok(timeout);timeout.fn();
  await assert.rejects(loading,/auth_unavailable/);assert.equal(h.api.snapshot().loading,false);
  stuck=false;await h.api.ready();assert.equal(h.api.snapshot().loaded,true);assert.equal(h.api.snapshot().error,'');
  pending.resolve({data:{user:account('a',profile('古い応答'))}});await settle();assert.equal(h.api.username(),'みどり');
});
test('an account switch after a save SDK timeout cannot adopt the late old-account result',async()=>{
  let hold=false;const pending=deferred(),h=fixture({user:account(),getSession:async w=>hold?pending.promise:{data:{session:{user:w.knUser,access_token:'fixture-token-'+w.knUser.id}}}});
  h.api.mount(h.container);await h.api.ready();hold=true;const writing=h.api.save(photoProfile('下書き',JPEG));await settle();
  h.timers().find(t=>t.active&&t.delay===12000).fn();await assert.rejects(writing,/auth_unavailable/);
  h.auth(account('b',profile('二人目')));hold=false;await h.flush();await h.api.ready();
  pending.resolve({data:{session:{user:account('a'),access_token:'fixture-token-a'}}});await settle();
  assert.equal(h.api.username(),'二人目');assert.equal(h.updates().length,0);assert.equal(h.api.snapshot().avatar_image,undefined);
});
test('icon-only guest saves do not wait on or rewrite the unchanged encrypted name',async()=>{
  for(const legacy of ['', '既存の名前']){
    let persisted=0;const h=fixture({legacy,persist:()=>{persisted++;return new Promise(()=>{});}});
    h.api.mount(h.container);await h.api.ready();await selectPhoto(h);await h.nodes.find(n=>n.tagName==='FORM').fire('submit');
    assert.equal(persisted,0);assert.equal(h.api.snapshot().avatar_image,JPEG);assert.equal(h.api.username(),legacy);
    assert.equal(h.storage.get('cm_nick')??'',legacy);assert.equal(h.nodes.some(n=>n.type==='submit'),false);
    assert.equal(h.updates().length,0);assert.equal(h.nodes.find(n=>n.getAttribute('role')==='status').textContent,'');
  }
});


test('an unset guest gets one stable initial label across paint, refresh and a new instance, without becoming a posting name',async()=>{
  const h=fixture();h.api.mount(h.container);await h.api.ready();const name=h.nodes.find(n=>n.className==='kn-profile-name').textContent;
  assert.match(name,/^ユーザー[0-9]{10}$/);assert.equal(h.api.username(),'');assert.equal(h.api.snapshot().username,'');assert.equal(h.storage.get('cm_nick'),undefined);assert.equal(h.updates().length,0);
  h.api.open();await h.api.refresh();assert.equal(h.nodes.find(n=>n.className==='kn-profile-name').textContent,name);
  const again=fixture({initialName:h.storage.get('kn_profile_initial_name_v1')});again.api.mount(again.container);await again.api.ready();assert.equal(again.nodes.find(n=>n.className==='kn-profile-name').textContent,name);
  await h.api.saveUsername('新しい名前');assert.equal(h.nodes.find(n=>n.className==='kn-profile-name').textContent,'新しい名前');
});
async function waitForInitialLabel(h){for(let i=0;i<100;i++){const value=h.nodes.find(n=>n.className==='kn-profile-name').textContent;if(/^ユーザー[0-9]{10}$/.test(value))return value;await new Promise(resolve=>setTimeout(resolve,1));}assert.fail('initial label did not finish');}
test('member initial labels are stable per account and do not leak provider names or Auth IDs into UI, storage or events',async()=>{
  const h=fixture({user:account('first-private-id',profile(''))});h.api.mount(h.container);await h.api.ready();const first=await waitForInitialLabel(h),label=()=>h.nodes.find(n=>n.className==='kn-profile-name').textContent;
  assert.match(first,/^ユーザー[0-9]{10}$/);h.auth(account('second-private-id',profile('')));assert.equal(label(),'ユーザー');await h.flush();await h.api.ready();const second=await waitForInitialLabel(h);assert.match(second,/^ユーザー[0-9]{10}$/);assert.notEqual(second,first);
  h.auth(account('first-private-id',profile('')));await h.flush();await h.api.ready();assert.equal(label(),first);
  const again=fixture({user:account('first-private-id',profile(''))});again.api.mount(again.container);await again.api.ready();assert.equal(await waitForInitialLabel(again),first);
  assert.equal(h.storage.size,0);assert.equal(h.updates().length,0);assert.equal(h.api.username(),'');assert.ok(h.events.every(e=>!e.detail||e.detail.username===''));assert.doesNotMatch(first,/private|Provider|@/);
});
test('an account digest finishing late cannot overwrite a different account or a newly saved username',async()=>{
  const digest=deferred(),h=fixture({user:account('a',profile(''))});h.w.crypto={subtle:{digest:()=>digest.promise}};h.api.mount(h.container);await h.api.ready();
  h.auth(account('b',profile('Bの名前')));await h.flush();await h.api.ready();digest.resolve(new Uint8Array([1,2,3,4,5,6]).buffer);await settle();assert.equal(h.nodes.find(n=>n.className==='kn-profile-name').textContent,'Bの名前');
  h.auth(account('a',profile('')));await h.flush();await h.api.ready();await h.api.saveUsername('Aの新しい名前');assert.equal(h.nodes.find(n=>n.className==='kn-profile-name').textContent,'Aの新しい名前');assert.equal(h.updates().length,1);
});
test('blocked initial-label storage stays stable in the page and does not turn a profile read into an error',async()=>{
  const h=fixture();h.w.localStorage.setItem=()=>{throw new Error('blocked');};h.api.mount(h.container);await h.api.ready();const node=h.nodes.find(n=>n.className==='kn-profile-name'),name=node.textContent;await h.api.refresh();assert.match(name,/^ユーザー[0-9]{10}$/);assert.equal(node.textContent,name);assert.equal(h.api.snapshot().error,'');assert.equal(h.api.username(),'');
});

for(const unavailable of [true,false])test('unavailable or rejected crypto keeps a usable member initial label without writes ('+unavailable+')',async()=>{
  const h=fixture({user:account('a',profile(''))});h.w.crypto=unavailable?undefined:{subtle:{digest:()=>Promise.reject(Error('unavailable'))}};h.api.mount(h.container);await h.api.ready();const first=await waitForInitialLabel(h);await h.api.refresh();assert.equal(h.nodes.find(n=>n.className==='kn-profile-name').textContent,first);assert.equal(h.api.snapshot().error,'');assert.equal(h.api.username(),'');assert.equal(h.storage.size,0);assert.equal(h.updates().length,0);
});
test('a first digest resolving after a successful name Save cannot replace the saved heading',async()=>{
  const digest=deferred(),h=fixture({user:account('a',profile(''))});h.w.crypto={subtle:{digest:()=>digest.promise}};h.api.mount(h.container);await h.api.ready();await h.api.saveUsername('保存した名前');digest.resolve(new Uint8Array([1,2,3,4,5,6]).buffer);await settle();assert.equal(h.nodes.find(n=>n.className==='kn-profile-name').textContent,'保存した名前');assert.equal(h.api.username(),'保存した名前');assert.equal(h.updates().length,1);
});


test('the only avatar edit button belongs beside the summary and is available only while the profile is expanded',async()=>{
  const h=fixture(),section=h.api.mount(h.container);await h.api.ready();const button=h.document.getElementById('knProfileIconButton'),summary=h.nodes.find(n=>n.tagName==='SUMMARY'),form=h.nodes.find(n=>n.tagName==='FORM'),choices=h.document.getElementById('knProfileIconChoices');
  assert.equal(button.parentNode,section);assert.notEqual(button.parentNode,summary);assert.equal(button.hidden,true);assert.equal(h.nodes.filter(n=>n.className==='kn-profile-icon-button').length,1);assert.equal(h.nodes.some(n=>n.className==='kn-profile-icon-label'||n.className==='kn-profile-icon-hint'),false);
  section.open=true;await section.fire('toggle');assert.equal(button.hidden,false);assert.equal(form.hidden,false);assert.equal(choices.hidden,true);assert.equal(choices.parentNode.hidden,true);assert.equal(button.getAttribute('aria-expanded'),'false');await button.fire('click');assert.equal(section.open,true);assert.equal(choices.hidden,false);assert.equal(choices.parentNode.hidden,false);
  await h.nodes.find(n=>n.className==='kn-profile-photo-reset').fire('click');assert.equal(section.open,true);assert.equal(button.hidden,false);assert.equal(choices.hidden,true);assert.equal(choices.parentNode.hidden,true);assert.equal(h.api.snapshot().avatar,'leaf');assert.equal(imageSource(h),'');assert.equal(button.textContent,'🌿');
  section.open=false;await section.fire('toggle');assert.equal(button.hidden,true);assert.equal(choices.hidden,true);section.open=true;await section.fire('toggle');assert.equal(button.hidden,false);assert.equal(button.textContent,'🌿');assert.equal(choices.parentNode.hidden,true);assert.equal(h.updates().length,0);
});
test('a delayed profile opener cannot take focus from an already opened photo chooser or reveal it on later profile opens',async()=>{
  const h=fixture({legacy:'保存名',extra:{version:1,bio:'保存した紹介',avatar:'moon'}});h.api.mount(h.container);await h.api.ready();h.api.open();
  const section=h.document.getElementById('knProfile'),button=h.document.getElementById('knProfileIconButton'),choices=h.document.getElementById('knProfileIconChoices'),album=h.document.getElementById('knProfileAlbumButton'),bio=h.document.getElementById('knProfileBio'),before=JSON.stringify([...h.storage]);
  assert.equal(choices.hidden,true);await button.fire('click');bio.value='入力途中の紹介';assert.equal(h.focus(),album);
  h.timers().filter(t=>t.active&&t.delay===350).forEach(t=>t.fn());
  assert.equal(h.focus(),album);assert.equal(choices.hidden,false);assert.equal(section.open,true);assert.equal(bio.value,'入力途中の紹介');assert.equal(JSON.stringify([...h.storage]),before);assert.equal(h.updates().length,0);
  section.open=false;await section.fire('toggle');h.api.open();assert.equal(choices.hidden,true);assert.equal(choices.parentNode.hidden,true);assert.equal(button.getAttribute('aria-expanded'),'false');assert.equal(bio.value,'入力途中の紹介');assert.equal(h.updates().length,0);
});

test('Escape from the header avatar button closes the chooser without closing the profile or losing its draft',async()=>{
  const h=fixture();h.api.mount(h.container);await h.api.ready();h.api.open();const section=h.document.getElementById('knProfile'),button=h.document.getElementById('knProfileIconButton'),choices=h.document.getElementById('knProfileIconChoices');await button.fire('click');const event=await button.fire('keydown',{key:'Escape'});assert.equal(event.defaultPrevented,true);assert.equal(event.propagationStopped,true);assert.equal(choices.hidden,true);assert.equal(choices.parentNode.hidden,true);assert.equal(section.open,true);assert.equal(h.focus(),button);
  const closed=await button.fire('keydown',{key:'Escape'});assert.equal(closed.defaultPrevented,false);assert.equal(closed.propagationStopped,false);
});

async function headerName(h){h.api.open();await h.document.getElementById('knProfileNameButton').fire('click');return h.document.getElementById('knProfileUsername');}
const nameEditor=h=>h.document.getElementById('knProfileNameEditor');
const nameDone=h=>h.nodes.find(n=>n.className==='kn-profile-name-done');

test('one username input lives beside the native summary with no lower public-name label and opens only in its header editor',async()=>{
  const h=fixture({legacy:'保存名'}),section=h.api.mount(h.container);await h.api.ready();const summary=h.nodes.find(n=>n.tagName==='SUMMARY'),form=h.nodes.find(n=>n.tagName==='FORM'),button=h.document.getElementById('knProfileNameButton'),name=h.document.getElementById('knProfileUsername');
  assert.equal(h.nodes.filter(n=>n.id==='knProfileUsername').length,1);assert.equal(name.parentNode,nameEditor(h));assert.equal(nameEditor(h).parentNode,section);assert.equal(button.parentNode,section);assert.equal(nameDone(h).type,'button');assert.equal(nameDone(h).getAttribute('aria-label'),'編集を完了');assert.equal(name.getAttribute('aria-label'),'ユーザー名（20文字まで）');assert.equal(h.nodes.some(n=>n.textContent==='ユーザー名（公開・20文字まで）'),false);
  for(let at=name;at;at=at.parentNode)assert.notEqual(at,summary);assert.equal(form.parentNode,section);assert.equal(h.document.getElementById('knProfileBio').parentNode.parentNode,form);assert.equal(button.hidden,true);assert.equal(nameEditor(h).hidden,true);
  await headerName(h);assert.equal(section.open,true);assert.equal(nameEditor(h).hidden,false);assert.equal(button.hidden,true);assert.equal(button.getAttribute('aria-expanded'),'true');assert.equal(h.focus(),name);assert.equal(h.api.username(),'保存名');
  h.timers().filter(t=>t.active&&t.delay===350).forEach(t=>t.fn());assert.equal(h.focus(),name,'a delayed external opener cannot refocus the hidden name button during typing');
});

test('header Escape closes editing while retaining and automatically saving changed fields',async()=>{
 const h=fixture({legacy:'保存名',extra:{version:1,bio:'保存した紹介',avatar:'star'}});h.api.mount(h.container);await h.api.ready();const name=await headerName(h),bio=h.document.getElementById('knProfileBio');
 name.value='変更途中';await name.fire('input');bio.value='自己紹介の下書き';await bio.fire('input');const escape=await name.fire('keydown',{key:'Escape'});
 assert.equal(escape.defaultPrevented,true);assert.equal(escape.propagationStopped,true);assert.equal(name.value,'変更途中');assert.equal(bio.value,'自己紹介の下書き');assert.equal(nameEditor(h).hidden,true);assert.equal(h.focus(),h.document.getElementById('knProfileNameButton'));assert.equal(h.api.username(),'変更途中');assert.equal(h.api.snapshot().bio,'自己紹介の下書き');
});

test('header completion waits for persistence without disabling editable fields or exposing a success notice',async()=>{
 const pending=deferred(),h=fixture({legacy:'保存名',persist:async(k,v)=>{await pending.promise;h.storage.set(k,v);}});h.api.mount(h.container);await h.api.ready();
 const name=await headerName(h),bio=h.document.getElementById('knProfileBio');name.value='新しい名前';await name.fire('input');bio.value='新しい紹介';await bio.fire('input');nameDone(h).focus();const writing=nameDone(h).fire('click');await settle();
 assert.equal(h.api.username(),'保存名');assert.equal(nameEditor(h).hidden,false);assert.equal(name.disabled,false);assert.equal(bio.disabled,false);assert.equal(h.document.getElementById('knProfile').getAttribute('aria-busy'),'true');
 pending.resolve();await writing;assert.equal(h.api.username(),'新しい名前');assert.equal(h.api.snapshot().bio,'新しい紹介');assert.equal(nameEditor(h).hidden,true);assert.equal(h.focus(),h.document.getElementById('knProfileNameButton'));assert.equal(h.nodes.find(n=>n.getAttribute('role')==='status').textContent,'');
});

test('noncomposing header Enter preserves Unicode limits while composition, keyCode229 and repeat do not submit',async()=>{
  const h=fixture({legacy:'前の名前'});h.api.mount(h.container);await h.api.ready();const name=await headerName(h);name.value='🌿'.repeat(20);await name.fire('compositionstart');await name.fire('input');await name.fire('keydown',{key:'Enter',isComposing:true});await name.fire('keydown',{key:'Enter'});assert.equal(h.api.username(),'前の名前');
  await name.fire('compositionend');await name.fire('keydown',{key:'Enter',keyCode:229});await name.fire('keydown',{key:'Enter',repeat:true});assert.equal(h.api.username(),'前の名前');const enter=await name.fire('keydown',{key:'Enter'});assert.equal(enter.defaultPrevented,true);assert.equal(h.api.username(),'🌿'.repeat(20));assert.equal(nameEditor(h).hidden,true);
  await headerName(h);name.value='🌿'.repeat(21);await name.fire('input');await name.fire('keydown',{key:'Enter'});assert.equal(h.api.username(),'🌿'.repeat(20));assert.equal(name.value,'🌿'.repeat(21));assert.equal(nameEditor(h).hidden,false);assert.match(h.nodes.find(n=>n.getAttribute('role')==='status').textContent,/20文字/);assert.equal(h.focus(),name);
});

test('a failed header auto-save retains its full draft and retries only through the failure action',async()=>{
 let fail=true;const h=fixture({legacy:'前',extra:{version:1,bio:'元の紹介',avatar:'sun'},persist:async(k,v)=>{if(fail)throw Error('secret https://private.invalid');h.storage.set(k,v);}});h.api.mount(h.container);await h.api.ready();
 const name=await headerName(h),bio=h.document.getElementById('knProfileBio');name.value='次';await name.fire('input');bio.value='紹介の下書き';await bio.fire('input');await selectPhoto(h);
 assert.equal(h.api.username(),'前');assert.equal(name.value,'次');assert.equal(bio.value,'紹介の下書き');assert.equal(imageSource(h),JPEG);assert.equal(nameEditor(h).hidden,false);assert.doesNotMatch(h.nodes.find(n=>n.getAttribute('role')==='status').textContent,/secret|https:/);
 fail=false;await h.nodes.find(n=>n.className==='kn-profile-retry').fire('click');assert.equal(h.api.username(),'次');assert.equal(h.api.snapshot().bio,'紹介の下書き');assert.equal(h.api.snapshot().avatar_image,JPEG);assert.equal(nameEditor(h).hidden,false);assert.equal(h.nodes.some(n=>n.className==='kn-profile-cancel'),false);
});

test('folding keeps the name editor draft while flushing its automatic save and reopens the same editor',async()=>{
 const h=fixture({legacy:'前'}),section=h.api.mount(h.container);await h.api.ready();const name=await headerName(h);name.value='見える下書き';await name.fire('input');section.open=false;await section.fire('toggle');await settle();
 assert.equal(nameEditor(h).hidden,true);section.open=true;await section.fire('toggle');assert.equal(nameEditor(h).hidden,false);assert.equal(name.value,'見える下書き');assert.equal(h.document.getElementById('knProfileNameButton').hidden,true);assert.equal(h.api.username(),'見える下書き');
});

test('owner changes discard header draft state and old saves cannot adopt a heading or focus a new owner editor',async()=>{
  const pending=deferred(),h=fixture({user:account('a',profile('A')),putProfile:()=>pending.promise});h.api.mount(h.container);await h.api.ready();const name=await headerName(h);name.value='Aの下書き';await name.fire('input');const writing=nameDone(h).fire('click');await settle();h.auth(account('b',profile('B')));assert.equal(nameEditor(h).hidden,true);assert.equal(name.value,'');assert.equal(h.document.getElementById('knProfile').open,false);
  pending.resolve({ok:true,user_id:'a',profile:profile('Aの下書き')});await writing;await h.flush();await h.api.ready();assert.equal(h.api.username(),'B');assert.equal(name.value,'B');assert.equal(h.document.getElementById('knProfileNameButton').textContent,'B');assert.equal(nameEditor(h).hidden,true);assert.notEqual(h.focus(),h.document.getElementById('knProfileNameButton'),'a stale success must not move focus into the new closed profile');
  h.api.open();await h.document.getElementById('knProfileNameButton').fire('click');name.value='Bの未保存';await name.fire('input');h.w.knUser=account('c',profile('C'));await nameDone(h).fire('click');assert.equal(h.updates().length,1);assert.equal(name.value,'');assert.equal(nameEditor(h).hidden,true);await h.api.ready();assert.equal(h.api.username(),'C');
});

test('an unset name is only a stable editable initial draft, and Escape restores its original empty username',async()=>{
  const h=fixture();h.api.mount(h.container);await h.api.ready();const initial=h.nodes.find(n=>n.className==='kn-profile-name').textContent,name=await headerName(h);assert.equal(name.value,initial);assert.match(name.value,/^ユーザー[0-9]{10}$/);assert.equal(h.api.username(),'');assert.equal(h.storage.get('cm_nick'),undefined);await name.fire('keydown',{key:'Escape'});assert.equal(name.value,'');assert.equal(h.api.username(),'');assert.equal(h.storage.get('cm_nick'),undefined);
  await headerName(h);await nameDone(h).fire('click');assert.equal(h.api.username(),initial);assert.equal(h.storage.get('cm_nick'),initial);
});

test('a late initial-name digest fills only an untouched initial editor and never overwrites actual typing or saves a temporary label',async()=>{
  const pending=deferred(),h=fixture({user:account('a',profile(''))});h.w.crypto={subtle:{digest:()=>pending.promise}};h.api.mount(h.container);await h.api.ready();const name=await headerName(h);assert.equal(nameDone(h).disabled,true);await name.fire('keydown',{key:'Enter'});assert.equal(h.updates().length,0);name.value='自分で入力した名前';await name.fire('input');assert.equal(nameDone(h).disabled,false);pending.resolve(new Uint8Array([1,2,3,4,5,6]).buffer);await settle();assert.equal(name.value,'自分で入力した名前');assert.equal(h.api.username(),'');await name.fire('keydown',{key:'Escape'});assert.equal(name.value,'自分で入力した名前');assert.equal(h.api.username(),'自分で入力した名前');
});

test('outside pointer and focus changes close only the icon popover without taking outside focus or changing a draft',async()=>{
  const h=fixture({legacy:'名前',extra:{version:1,bio:'',avatar:'moon'}});h.api.mount(h.container);await h.api.ready();h.api.open();const icon=h.document.getElementById('knProfileIconButton'),choices=h.document.getElementById('knProfileIconChoices'),album=h.document.getElementById('knProfileAlbumButton'),outside=h.document.createElement('button');h.document.body.appendChild(outside);
  await icon.fire('click');h.document.dispatchEvent({type:'pointerdown',target:album});assert.equal(choices.hidden,false);h.document.dispatchEvent({type:'focusout',target:icon,relatedTarget:album});assert.equal(choices.hidden,false);outside.focus();h.document.dispatchEvent({type:'pointerdown',target:outside});assert.equal(choices.hidden,true);assert.equal(h.focus(),outside);assert.equal(h.api.snapshot().avatar,'moon');
  await icon.fire('click');outside.focus();h.document.dispatchEvent({type:'focusout',target:album,relatedTarget:outside});assert.equal(choices.hidden,true);assert.equal(h.focus(),outside);assert.equal(h.updates().length,0);
});
