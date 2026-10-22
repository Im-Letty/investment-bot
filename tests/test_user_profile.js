'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {create,validate}=require('../static/user-profile.js');
const JPEG='data:image/jpeg;base64,'+Buffer.from([255,216,255,224,0,4,17,23,255,217]).toString('base64'),PHOTO_REF='a'.repeat(64),OTHER_REF='b'.repeat(64);
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const profile=(username='みどり',bio='経済を勉強中',avatar='leaf')=>({username,bio,avatar});
function fixture({user=null,legacy='',extra=null,getUser,getSession,putProfile,persist,decode,encode,getAvatar}={}){
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
    async fire(k){const e={target:this,preventDefault(){}};for(const fn of this.listeners[k]||[])await fn(e);}
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
  assert.equal(h.w.knUser.user_metadata.name,'Provider Legal Name');assert.equal(h.api.username(),'次の名前');assert.equal(h.storage.size,0);
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
test('a failed form save leaves its inputs for correction and exposes a fixed safe error',async()=>{
  const h=fixture({user:account(),putProfile:async()=>({ok:false,reason:'https://private.invalid/?token=secret'})});
  h.api.mount(h.container);await h.api.ready();const name=h.document.getElementById('knProfileUsername');name.value='入力を残す';await name.fire('input');
  const form=h.nodes.find(n=>n.tagName==='FORM');await form.fire('input');await form.fire('submit');
  assert.equal(name.value,'入力を残す');const status=h.nodes.find(n=>n.getAttribute('role')==='status');assert.match(status.textContent,/保存できませんでした/);assert.doesNotMatch(status.textContent,/token|https:/);
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
  assert.equal(h.storage.size,0);
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
  await h.api.saveUsername('保存した名前');assert.match(status.textContent,/保存しました/);assert.equal(h.api.username(),'保存した名前');
  await h.api.refresh();assert.equal(status.textContent,'');assert.equal(h.api.username(),'保存した名前');
 }
});

test('optional photos accept only bounded JPEG data or a private content reference',()=>{
  assert.equal(validate(photoProfile('名前',JPEG)).avatar_image,JPEG);assert.equal(validate(photoProfile()).avatar_image,PHOTO_REF);
  assert.equal(validate(photoProfile('名前','')).avatar_image,'');
  for(const value of [null,17,'https://example.invalid/photo.jpg','data:image/svg+xml;base64,PHN2Zz4=',PHOTO_REF.toUpperCase(),'b'.repeat(63),'data:image/jpeg;base64,'+Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(49152)]).toString('base64')])assert.throws(()=>validate(photoProfile('名前',value)),/invalid_avatar_image/);
});
test('album selection crops locally to a square preview and writes nothing until Save',async()=>{
  const h=fixture({legacy:'名前'});h.api.mount(h.container);await h.api.ready();
  const input=await selectPhoto(h);assert.equal(input.type,'file');assert.equal(input.value,'');assert.match(input.accept,/heic/);assert.equal(input.capture,undefined);assert.equal(input.getAttribute('capture'),null);
  assert.equal(imageSource(h),JPEG);assert.equal(imageSource(h,'kn-profile-avatar'),'');assert.equal(h.storage.has('kn_profile_guest_v1'),false);assert.equal(h.updates().length,0);
  const crop=h.draws.find(v=>v.draw).draw;assert.deepEqual(crop.slice(1),[160,0,640,640,0,0,192,192]);assert.equal(h.closed.length,1);
  await h.nodes.find(n=>n.tagName==='FORM').fire('submit');assert.equal(imageSource(h,'kn-profile-avatar'),JPEG);
  const saved=JSON.parse(h.storage.get('kn_profile_guest_v1'));assert.equal(saved.avatar_image,JPEG);assert.doesNotMatch(JSON.stringify(saved),/local\.jpg|fakepath/);
  const reload=fixture({legacy:h.storage.get('cm_nick'),extra:saved});reload.api.mount(reload.container);await reload.api.ready();assert.equal(imageSource(reload),JPEG);
  assert.ok(h.events.every(e=>!e.detail||!('avatar_image'in e.detail)),'private image never enters shared profile events');
});
test('cancel restores the committed photo, and a preset or standard reset clears only on Save',async()=>{
  const old='data:image/jpeg;base64,'+Buffer.from([255,216,255,224,2,3,255,217]).toString('base64');
  const h=fixture({legacy:'名前',extra:{version:1,bio:'',avatar:'star',avatar_image:old}});h.api.mount(h.container);await h.api.ready();
  await selectPhoto(h);assert.equal(imageSource(h),JPEG);await h.nodes.find(n=>n.className==='kn-profile-cancel').fire('click');assert.equal(imageSource(h),old);
  await selectPhoto(h);const preset=h.document.getElementById('knProfileAvatar');preset.value='moon';await preset.fire('change');assert.equal(imageSource(h),'');assert.equal(imageSource(h,'kn-profile-avatar'),old);
  await h.nodes.find(n=>n.tagName==='FORM').fire('submit');assert.equal(h.api.snapshot().avatar_image,'');assert.equal(h.api.snapshot().avatar,'moon');assert.equal(imageSource(h,'kn-profile-avatar'),'');
  await selectPhoto(h);await h.nodes.find(n=>n.className==='kn-profile-photo-reset').fire('click');await h.nodes.find(n=>n.tagName==='FORM').fire('submit');assert.equal(h.api.snapshot().avatar_image,'');
});
test('empty picker cancellation and repeated selection preserve drafts and permit the same file again',async()=>{
  let decodes=0;const h=fixture({decode:async()=>{decodes++;return {width:100,height:100,close(){}};}});h.api.mount(h.container);await h.api.ready();
  const input=await selectPhoto(h);input.files=[];await input.fire('change');assert.equal(imageSource(h),JPEG);await selectPhoto(h);assert.equal(decodes,2);assert.equal(input.value,'');
});
test('invalid, oversized, undecodable and excessive-pixel files leave the previous photo intact',async()=>{
  const cases=[{file:{size:10*1024*1024+1,type:'image/jpeg'},message:/10MB/},{file:{size:32,type:'text/html'},message:/JPEG・PNG/},{decode:async()=>{throw Error('raw private decoder error');},message:/JPEGかPNG/},{decode:async()=>({width:10000,height:10000,close(){}}),message:/縦横/},{encode:()=> 'data:image/png;base64,AAAA',message:/別の写真/}];
  for(const entry of cases){const h=fixture({extra:{version:1,bio:'',avatar:'leaf',avatar_image:JPEG},decode:entry.decode,encode:entry.encode});h.api.mount(h.container);await h.api.ready();await selectPhoto(h,entry.file);assert.equal(imageSource(h),JPEG);assert.equal(h.api.snapshot().avatar_image,JPEG);const status=h.nodes.find(n=>n.getAttribute('role')==='status');assert.match(status.textContent,entry.message);assert.doesNotMatch(status.textContent,/raw private/);assert.equal(h.nodes.find(n=>n.type==='submit').disabled,false);}
});
test('slow photo preparation disables Save and cannot complete after cancel or account switch',async()=>{
  for(const action of ['cancel','switch']){
    const waiting=deferred(),closed=[];const h=fixture({decode:()=>waiting.promise});h.api.mount(h.container);await h.api.ready();const selecting=selectPhoto(h);await settle();assert.equal(h.nodes.find(n=>n.type==='submit').disabled,true);await assert.rejects(h.api.saveUsername('途中'),/photo_busy/);
    if(action==='cancel')await h.nodes.find(n=>n.className==='kn-profile-cancel').fire('click');else{h.auth(account('b',profile('二人目')));await h.flush();await h.api.ready();}
    waiting.resolve({width:100,height:100,close(){closed.push(true);}});await selecting;assert.equal(imageSource(h),'');assert.equal(closed.length,1);assert.equal(h.updates().length,0);assert.equal(h.storage.has('kn_profile_guest_v1'),false);
  }
});
test('a later photo selection wins when earlier native decoding resolves last',async()=>{
  const first=deferred();let count=0;const closed=[];const h=fixture({decode:()=>++count===1?first.promise:Promise.resolve({width:100,height:100,close(){closed.push('second');}})});h.api.mount(h.container);await h.api.ready();const pending=selectPhoto(h);await settle();await selectPhoto(h,{size:1024,type:'image/heic',name:'photo.heic'});assert.equal(imageSource(h),JPEG);first.resolve({width:100,height:100,close(){closed.push('first');}});await pending;assert.equal(imageSource(h),JPEG);assert.deepEqual(closed,['second','first']);
});
test('a stalled decoder times out, keeps the saved photo and closes a late bitmap',async()=>{
  const pending=deferred(),closed=[];const h=fixture({decode:()=>pending.promise,extra:{version:1,bio:'',avatar:'leaf',avatar_image:JPEG}});h.api.mount(h.container);await h.api.ready();const selecting=selectPhoto(h);await settle();h.timers().find(t=>t.delay===15000&&t.active).fn();await selecting;assert.equal(imageSource(h),JPEG);assert.equal(h.nodes.find(n=>n.type==='submit').disabled,false);pending.resolve({width:100,height:100,close(){closed.push(true);}});await settle();assert.equal(closed.length,1);
});
test('guest quota failure rolls back name and photo extras and retains the editable photo',async()=>{
  const old={version:1,bio:'元',avatar:'sun',avatar_image:JPEG};const h=fixture({legacy:'元の名前',extra:old});h.api.mount(h.container);await h.api.ready();h.w.localStorage.setItem=(key,value)=>{if(key==='kn_profile_guest_v1'&&JSON.parse(value).bio!=='元')throw Error('QuotaExceededError');h.storage.set(key,String(value));};
  await assert.rejects(h.api.save({...profile('新','変更','moon'),avatar_image:JPEG}),/storage_unavailable/);assert.deepEqual(JSON.parse(h.storage.get('kn_profile_guest_v1')),old);assert.equal(h.storage.get('cm_nick'),'元の名前');assert.equal(h.api.snapshot().avatar_image,JPEG);
  const partial=fixture({legacy:'元',extra:old,persist:async(k,v)=>{partial.storage.set(k,v);throw Error('helper write then reject');}});await partial.api.ready();await assert.rejects(partial.api.saveUsername('変更'),/storage_unavailable/);assert.equal(partial.storage.get('cm_nick'),'元');assert.deepEqual(JSON.parse(partial.storage.get('kn_profile_guest_v1')),old);
});
test('a member photo Save accepts only the canonical reference and loads its private bytes',async()=>{
  const h=fixture({user:account()});h.api.mount(h.container);await h.api.ready();await selectPhoto(h);assert.equal(h.requests().length,0);await h.nodes.find(n=>n.tagName==='FORM').fire('submit');await settle();
  assert.equal(h.api.snapshot().avatar_image,PHOTO_REF);assert.equal(h.updates()[0].avatar_image,JPEG);assert.equal(h.w.knUser.user_metadata.kn_profile_v1.avatar_image,PHOTO_REF);assert.match(imageSource(h),/^blob:/);assert.equal(h.storage.size,0);
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
test('an image element error falls back safely without erasing a newer preview',async()=>{
  const h=fixture({user:account('a',photoProfile())});h.api.mount(h.container);await h.api.ready();await settle();const target=h.nodes.find(n=>n.className==='kn-profile-photo-preview'),old=target.children[0];await selectPhoto(h);old.onerror();assert.equal(imageSource(h),JPEG);const active=target.children[0];active.onerror();assert.equal(imageSource(h),'');assert.match(target.textContent,/🌿/);
});
test('the native Image fallback revokes source URLs after decoding and on cancellation',async()=>{
  const images=[];class NativeImage{constructor(){images.push(this);this.naturalWidth=400;this.naturalHeight=600;}set src(value){this.source=value;}get src(){return this.source;}}
  const h=fixture();h.w.createImageBitmap=undefined;h.w.Image=NativeImage;h.api.mount(h.container);await h.api.ready();const first=selectPhoto(h);await settle();assert.equal(images.length,1);const source=images[0].src;images[0].onload();await first;assert.equal(imageSource(h),JPEG);assert.ok(h.revoked.includes(source));assert.deepEqual(h.draws.find(v=>v.draw).draw.slice(1),[0,100,400,400,0,0,192,192]);
  const second=selectPhoto(h);await settle();const nextSource=images[1].src;await h.nodes.find(n=>n.className==='kn-profile-cancel').fire('click');await second;assert.equal(images[1].src,'');assert.ok(h.revoked.includes(nextSource));assert.equal(imageSource(h),'');
});
test('a bitmap rejection after timeout cannot start an unexpected native fallback',async()=>{
  const pending=deferred();let fallback=0;const h=fixture({decode:()=>pending.promise});h.w.Image=class{constructor(){fallback++;}};h.api.mount(h.container);await h.api.ready();const selecting=selectPhoto(h);await settle();h.timers().find(t=>t.delay===15000&&t.active).fn();await selecting;pending.reject(Error('late unsupported image'));await settle();assert.equal(fallback,0);assert.equal(h.objectURLs.length,0);
});
