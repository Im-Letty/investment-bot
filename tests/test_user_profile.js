'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {create,validate}=require('../static/user-profile.js');
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const profile=(username='みどり',bio='経済を勉強中',avatar='leaf')=>({username,bio,avatar});
function fixture({user=null,legacy='',extra=null,getUser,getSession,putProfile,persist}={}){
  const events=[],storage=new Map(legacy?[['cm_nick',legacy]]:[]),listeners=new Map(),timers=[],nodes=[];
  let userReads=0,updates=[],requests=[],focus=null;
  class Node{
    constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.attrs={};this.listeners={};this._text='';this.value='';this.hidden=false;this.className='';nodes.push(this);this.classList={toggle:(value,on)=>{const classes=new Set(this.className.split(/\s+/).filter(Boolean));if(on)classes.add(value);else classes.delete(value);this.className=[...classes].join(' ');}};}
    set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}
    appendChild(n){n.parentNode?.removeChild(n);n.parentNode=this;this.children.push(n);return n;}
    insertBefore(n,b){n.parentNode?.removeChild(n);n.parentNode=this;this.children.splice(b?this.children.indexOf(b):0,0,n);return n;}
    removeChild(n){this.children.splice(this.children.indexOf(n),1);n.parentNode=null;}
    get firstChild(){return this.children[0]||null;}get isConnected(){return this===body||!!this.parentNode?.isConnected;}
    setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k]||null;}
    addEventListener(k,fn){(this.listeners[k]||(this.listeners[k]=[])).push(fn);}
    async fire(k,init={}){const e={target:this,defaultPrevented:false,propagationStopped:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.propagationStopped=true;},...init};for(const fn of this.listeners[k]||[])await fn(e);return e;}
    focus(){focus=this;}scrollIntoView(){}
  }
  const body=new Node('body'),container=new Node('div');body.appendChild(container);
  const document={body,createElement:t=>new Node(t),addEventListener(k,fn){if(!listeners.has(k))listeners.set(k,[]);listeners.get(k).push(fn);},dispatchEvent(e){events.push(e);for(const fn of listeners.get(e.type)||[])fn(e);},getElementById:id=>nodes.find(n=>n.id===id)||null,querySelector:()=>container};
  const w={knUser:user,document,CustomEvent:class{constructor(type,init){this.type=type;this.detail=init.detail;}},Event:class{constructor(type){this.type=type;}},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},setTimeout:(fn,delay=0)=>{const timer={fn,delay,active:true};timers.push(timer);return timer;},clearTimeout(timer){timer.active=false;},addEventListener(){},openDrawer(){},sb:{auth:{
    async getUser(){userReads++;if(getUser)return getUser(w);return {data:{user:w.knUser},error:null};},
    async getSession(){if(getSession)return getSession(w);return {data:{session:{user:w.knUser,access_token:'fixture-token-'+w.knUser.id}},error:null};},
    async updateUser(){assert.fail('SDK updateUser must never choose the write account');}
  }},AbortController,async fetch(url,options){
    assert.equal(url,'/api/user-profile');const value=JSON.parse(options.body);updates.push(value);requests.push({url,options});
    let result;
    if(putProfile)result=await putProfile(value,w,options);
    else{
      const actor=options.headers.Authorization.slice('Bearer fixture-token-'.length);
      if(w.knUser.id===actor)w.knUser={...w.knUser,user_metadata:{...w.knUser.user_metadata,kn_profile_v1:value}};
      result={ok:true,profile:value,user_id:actor};
    }
    if(result&&typeof result.text==='function')return result;
    return {ok:result&&result.ok===true,text:async()=>JSON.stringify(result)};
  }};
  if(extra)storage.set('kn_profile_guest_v1',JSON.stringify(extra));
  if(persist)w.__knPersistLocalSetting=persist;
  const api=create(w);
  return {w,api,storage,events,container,document,nodes,reads:()=>userReads,updates:()=>updates,requests:()=>requests,timers:()=>timers,focus:()=>focus,async flush(){for(let i=0;i<timers.length;i++){const timer=timers[i];if(timer.active&&timer.delay===0){timer.active=false;await timer.fn();}}await Promise.resolve();},auth(next){w.knUser=next;document.dispatchEvent(new w.Event('knAuthChange'));}};
}
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

test('the editor uses one tappable native icon button and no dropdown or separate photo field',async()=>{
  const h=fixture();h.api.mount(h.container);await h.api.ready();
  const button=h.document.getElementById('knProfileIconButton'),choices=h.document.getElementById('knProfileIconChoices'),avatar=h.document.getElementById('knProfileAvatar');
  assert.equal(button.tagName,'BUTTON');assert.equal(button.type,'button');assert.equal(button.getAttribute('aria-controls'),choices.id);assert.match(button.getAttribute('aria-label'),/アイコンを変更/);assert.equal(button.getAttribute('aria-expanded'),'false');assert.equal(choices.hidden,true);assert.equal(choices.getAttribute('role'),'group');
  assert.equal(avatar.type,'hidden');assert.equal(avatar.value,'leaf');assert.equal(h.nodes.filter(n=>n.tagName==='SELECT'||n.type==='file').length,0);
  for(let node=button.parentNode;node;node=node.parentNode)assert.notEqual(node.tagName,'SUMMARY','button never nests in the details summary');
  const options=choices.children;assert.equal(options.length,5);assert.equal(new Set(options.map(n=>n.getAttribute('data-avatar'))).size,5);for(const option of options){assert.equal(option.tagName,'BUTTON');assert.equal(option.type,'button');assert.match(option.getAttribute('aria-label'),/のアイコン$/);}
});
test('tapping an icon opens the choices and selection changes only the draft until Save',async()=>{
  const h=fixture({legacy:'名前',extra:{version:1,bio:'',avatar:'moon'}});h.api.mount(h.container);await h.api.ready();const button=h.document.getElementById('knProfileIconButton'),choices=h.document.getElementById('knProfileIconChoices'),summary=h.nodes.find(n=>n.className==='kn-profile-avatar');
  await button.fire('click');assert.equal(choices.hidden,false);assert.equal(button.getAttribute('aria-expanded'),'true');assert.equal(h.focus().getAttribute('data-avatar'),'moon');
  const option=choices.children.find(n=>n.getAttribute('data-avatar')==='flower');await option.fire('click');assert.equal(choices.hidden,true);assert.equal(button.textContent,'🌼');assert.equal(h.document.getElementById('knProfileAvatar').value,'flower');assert.equal(option.getAttribute('aria-pressed'),'true');assert.equal(h.focus(),button);assert.equal(summary.textContent,'🌙');assert.equal(h.api.snapshot().avatar,'moon');assert.equal(h.updates().length,0);assert.equal(JSON.parse(h.storage.get('kn_profile_guest_v1')).avatar,'moon');
  await h.nodes.find(n=>n.tagName==='FORM').fire('submit');assert.equal(h.api.snapshot().avatar,'flower');assert.equal(summary.textContent,'🌼');assert.equal(JSON.parse(h.storage.get('kn_profile_guest_v1')).avatar,'flower');assert.equal(choices.hidden,true);
});
test('Escape closes just the icon choices, keeps the draft and returns focus to the icon',async()=>{
  const h=fixture();h.api.mount(h.container);await h.api.ready();const button=h.document.getElementById('knProfileIconButton'),choices=h.document.getElementById('knProfileIconChoices'),form=h.nodes.find(n=>n.tagName==='FORM');
  await button.fire('click');const escape=await form.fire('keydown',{key:'Escape'});assert.equal(choices.hidden,true);assert.equal(button.getAttribute('aria-expanded'),'false');assert.equal(h.focus(),button);assert.equal(escape.defaultPrevented,true);assert.equal(escape.propagationStopped,true);assert.equal(h.api.snapshot().avatar,'leaf');assert.equal(h.storage.size,0);
  const closed=await form.fire('keydown',{key:'Escape'});assert.equal(closed.defaultPrevented,false);assert.equal(closed.propagationStopped,false,'drawer may handle Escape when the chooser is already closed');
});
test('cancel restores the committed icon and a member Save sends only its existing profile schema',async()=>{
  const h=fixture({user:account('a',profile('名前','自己紹介','sun'))});h.api.mount(h.container);await h.api.ready();const button=h.document.getElementById('knProfileIconButton'),choices=h.document.getElementById('knProfileIconChoices');
  await button.fire('click');await choices.children[1].fire('click');await button.fire('click');await h.nodes.find(n=>n.className==='kn-profile-cancel').fire('click');assert.equal(choices.hidden,true);assert.equal(button.textContent,'☀️');assert.equal(h.document.getElementById('knProfileAvatar').value,'sun');assert.equal(h.updates().length,0);
  await button.fire('click');await choices.children.find(n=>n.getAttribute('data-avatar')==='star').fire('click');await h.nodes.find(n=>n.tagName==='FORM').fire('submit');assert.deepEqual(h.updates(),[profile('名前','自己紹介','star')]);assert.equal(button.textContent,'⭐');assert.equal(choices.hidden,true);
});
test('loading and saving disable both the icon trigger and all choices',async()=>{
  const loading=deferred(),h=fixture({user:account(),getUser:()=>loading.promise});h.api.mount(h.container);const button=h.document.getElementById('knProfileIconButton'),choices=h.document.getElementById('knProfileIconChoices');assert.equal(button.disabled,true);assert.ok(choices.children.every(n=>n.disabled));await button.fire('click');assert.equal(choices.hidden,true);loading.resolve({data:{user:account()}});await h.api.ready();assert.equal(button.disabled,false);
  const saving=deferred(),s=fixture({user:account(),putProfile:()=>saving.promise});s.api.mount(s.container);await s.api.ready();const trigger=s.document.getElementById('knProfileIconButton'),options=s.document.getElementById('knProfileIconChoices');await trigger.fire('click');const pending=s.api.saveUsername('変更');await new Promise(setImmediate);assert.equal(trigger.disabled,true);assert.ok(options.children.every(n=>n.disabled));await options.children[2].fire('click');assert.equal(s.document.getElementById('knProfileAvatar').value,'leaf');saving.resolve({ok:true,user_id:'a',profile:profile('変更')});await pending;assert.equal(options.hidden,true);assert.equal(trigger.disabled,false);
});
test('account switching closes the chooser and removes the old icon draft immediately',async()=>{
  const h=fixture({user:account('a',profile('A','','star'))});h.api.mount(h.container);await h.api.ready();const button=h.document.getElementById('knProfileIconButton'),choices=h.document.getElementById('knProfileIconChoices');await button.fire('click');await choices.children.find(n=>n.getAttribute('data-avatar')==='sun').fire('click');await button.fire('click');h.auth(account('b',profile('B','','moon')));assert.equal(choices.hidden,true);assert.equal(button.getAttribute('aria-expanded'),'false');assert.equal(button.textContent,'🌿');await h.flush();await h.api.ready();assert.equal(button.textContent,'🌙');assert.equal(h.document.getElementById('knProfileAvatar').value,'moon');assert.equal(h.updates().length,0);
});
test('failed saves keep the selected icon draft available for retry and cancel',async()=>{
  const h=fixture({user:account(),putProfile:async()=>({ok:false})});h.api.mount(h.container);await h.api.ready();const button=h.document.getElementById('knProfileIconButton'),choices=h.document.getElementById('knProfileIconChoices');await button.fire('click');await choices.children.find(n=>n.getAttribute('data-avatar')==='moon').fire('click');await h.nodes.find(n=>n.tagName==='FORM').fire('submit');assert.equal(button.textContent,'🌙');assert.equal(h.api.snapshot().avatar,'leaf');await button.fire('click');assert.equal(h.focus().getAttribute('data-avatar'),'moon');assert.equal(h.focus().getAttribute('aria-pressed'),'true');await h.nodes.find(n=>n.className==='kn-profile-cancel').fire('click');assert.equal(button.textContent,'🌿');assert.equal(choices.hidden,true);
});
test('guest and member profiles start closed with a fixed label and only saved name and icon preview',async()=>{
  for(const member of [false,true]){
    const h=fixture(member?{user:account('a',profile('保存済み','紹介','moon'))}:{legacy:'保存済み',extra:{version:1,bio:'紹介',avatar:'moon'}}),section=h.api.mount(h.container),form=h.nodes.find(n=>n.tagName==='FORM');
    assert.equal(section.open,false);assert.equal(form.hidden,true);await h.api.ready();assert.equal(section.open,false);assert.equal(form.hidden,true);assert.equal(h.nodes.find(n=>n.className==='kn-profile-label').textContent,'プロフィール');assert.equal(h.nodes.find(n=>n.className==='kn-profile-name').textContent,'保存済み');assert.equal(h.nodes.find(n=>n.className==='kn-profile-avatar').textContent,'🌙');
    const summary=h.nodes.find(n=>n.tagName==='SUMMARY');assert.equal(summary.getAttribute('role'),null);assert.equal(Object.keys(summary.listeners).length,0,'native summary keeps platform click and keyboard behavior');assert.equal(form.parentNode,section);assert.equal(h.document.getElementById('knProfileUsername').parentNode.parentNode,form);assert.equal(h.document.getElementById('knProfileBio').parentNode.parentNode,form);
  }
  const blank=fixture();blank.api.mount(blank.container);await blank.api.ready();assert.equal(blank.nodes.find(n=>n.className==='kn-profile-label').textContent,'プロフィール');assert.equal(blank.nodes.find(n=>n.className==='kn-profile-name').hidden,true);
});
test('native details toggles show the whole editor and closing also closes the icon choices',async()=>{
  const h=fixture();const section=h.api.mount(h.container);await h.api.ready();const form=h.nodes.find(n=>n.tagName==='FORM'),choices=h.document.getElementById('knProfileIconChoices');section.open=true;await section.fire('toggle');assert.equal(form.hidden,false);await h.document.getElementById('knProfileIconButton').fire('click');assert.equal(choices.hidden,false);section.open=false;await section.fire('toggle');assert.equal(form.hidden,true);assert.equal(choices.hidden,true);assert.equal(h.document.getElementById('knProfileIconButton').getAttribute('aria-expanded'),'false');section.open=true;await section.fire('toggle');assert.equal(form.hidden,false);assert.equal(choices.hidden,true);
});
test('closing and reopening preserves unsaved name, bio and icon, while Cancel restores saved fields',async()=>{
  const h=fixture({legacy:'保存済み',extra:{version:1,bio:'保存した紹介',avatar:'star'}}),section=h.api.mount(h.container);await h.api.ready();const form=h.nodes.find(n=>n.tagName==='FORM'),name=h.document.getElementById('knProfileUsername'),bio=h.document.getElementById('knProfileBio'),avatar=h.document.getElementById('knProfileAvatar');section.open=true;await section.fire('toggle');name.value='編集中';bio.value='下書きの紹介';await form.fire('input');await h.document.getElementById('knProfileIconButton').fire('click');await h.document.getElementById('knProfileIconChoices').children.find(n=>n.getAttribute('data-avatar')==='sun').fire('click');section.open=false;await section.fire('toggle');section.open=true;await section.fire('toggle');assert.equal(name.value,'編集中');assert.equal(bio.value,'下書きの紹介');assert.equal(avatar.value,'sun');assert.equal(h.nodes.find(n=>n.className==='kn-profile-name').textContent,'保存済み');assert.equal(h.api.username(),'保存済み');assert.equal(JSON.parse(h.storage.get('kn_profile_guest_v1')).avatar,'star');await h.nodes.find(n=>n.className==='kn-profile-cancel').fire('click');assert.equal(name.value,'保存済み');assert.equal(bio.value,'保存した紹介');assert.equal(avatar.value,'star');assert.equal(form.hidden,false);
});
test('API open synchronizes visibility immediately and a same-owner pending read keeps it open',async()=>{
  const pending=deferred(),h=fixture({user:account(),getUser:()=>pending.promise});assert.equal(h.api.open(),true);const section=h.document.getElementById('knProfile'),form=h.nodes.find(n=>n.tagName==='FORM');assert.equal(section.open,true);assert.equal(form.hidden,false);pending.resolve({data:{user:account()}});await h.api.ready();assert.equal(section.open,true);assert.equal(form.hidden,false);const focus=h.timers().find(t=>t.delay===350&&t.active);assert.ok(focus);focus.fn();assert.equal(h.focus(),h.document.getElementById('knProfileUsername'));await h.api.refresh();assert.equal(form.hidden,false);assert.equal(section.open,true);
});
test('closing before delayed API focus never focuses hidden fields, and reads or saves never reopen them',async()=>{
  const h=fixture();h.api.mount(h.container);await h.api.ready();h.api.open();const section=h.document.getElementById('knProfile'),form=h.nodes.find(n=>n.tagName==='FORM');section.open=false;await section.fire('toggle');h.timers().find(t=>t.delay===350&&t.active).fn();assert.equal(h.focus(),null);await h.api.refresh();assert.equal(section.open,false);assert.equal(form.hidden,true);await h.api.saveUsername('保存');assert.equal(section.open,false);assert.equal(form.hidden,true);assert.equal(h.nodes.find(n=>n.className==='kn-profile-name').textContent,'保存');
});
test('changing identity closes and clears drafts and invalidates delayed focus before loading the next account',async()=>{
  const h=fixture({user:account('a',profile('Aの名前','Aの紹介','star'))});h.api.mount(h.container);await h.api.ready();h.api.open();const section=h.document.getElementById('knProfile'),form=h.nodes.find(n=>n.tagName==='FORM'),name=h.document.getElementById('knProfileUsername'),bio=h.document.getElementById('knProfileBio');name.value='Aの下書き';bio.value='非公開の下書き';await form.fire('input');h.auth(account('b',profile('Bの名前','Bの紹介','moon')));assert.equal(section.open,false);assert.equal(form.hidden,true);assert.equal(name.value,'');assert.equal(bio.value,'');assert.equal(h.nodes.find(n=>n.className==='kn-profile-name').hidden,true);h.timers().find(t=>t.delay===350&&t.active).fn();assert.equal(h.focus(),null);await h.flush();await h.api.ready();assert.equal(section.open,false);assert.equal(form.hidden,true);assert.equal(name.value,'Bの名前');assert.equal(bio.value,'Bの紹介');assert.equal(h.nodes.find(n=>n.className==='kn-profile-name').textContent,'Bの名前');assert.equal(h.api.open(),true);assert.equal(section.open,true);assert.equal(form.hidden,false);
});
test('an intentional API open for a newly changed owner remains open while that profile refreshes',async()=>{
  let pending=null;const h=fixture({user:account('a',profile('A')),getUser:async w=>pending?pending.promise:{data:{user:w.knUser}}});h.api.mount(h.container);await h.api.ready();pending=deferred();h.w.knUser=account('b',profile('B'));assert.equal(h.api.open(),true);const section=h.document.getElementById('knProfile'),form=h.nodes.find(n=>n.tagName==='FORM');assert.equal(section.open,true);assert.equal(form.hidden,false);assert.equal(h.document.getElementById('knProfileUsername').value,'');pending.resolve({data:{user:account('b',profile('B'))}});await h.api.ready();assert.equal(section.open,true);assert.equal(form.hidden,false);assert.equal(h.document.getElementById('knProfileUsername').value,'B');
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
