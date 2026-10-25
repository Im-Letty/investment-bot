'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('../static/user-profile.js');
const JPEG='data:image/jpeg;base64,'+Buffer.from([255,216,255,224,0,4,17,23,255,217]).toString('base64');
const REF='a'.repeat(64);
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const settle=()=>new Promise(setImmediate);
const profile=(username='合成の名前',bio='元の紹介',avatar='leaf')=>({username,bio,avatar});
const account=(id='a',saved=profile())=>({id,is_anonymous:false,email:id+'@example.invalid',user_metadata:{kn_profile_v1:saved}});
function fixture({user=account(),legacy='',extra,put,persist,decode,digest}={}){
 let clock=0,sequence=0,focus=null;const timers=new Map(),storage=new Map(legacy?[['cm_nick',legacy]]:[]),nodes=[],writes=[],events=[],listeners=new Map(),urls=[],revoked=[];
 if(extra)storage.set('kn_profile_guest_v1',JSON.stringify(extra));
 class Node{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.attrs={};this.listeners={};this._text='';this.value='';this.hidden=false;this.disabled=false;this.className='';nodes.push(this);this.classList={contains:n=>this.className.split(/\s+/).includes(n),toggle:(n,on)=>{let s=new Set(this.className.split(/\s+/).filter(Boolean));on?s.add(n):s.delete(n);this.className=[...s].join(' ')},add:n=>this.classList.toggle(n,true),remove:n=>this.classList.toggle(n,false)}}
  get parentElement(){return this.parentNode}get firstChild(){return this.children[0]||null}get isConnected(){return this===body||!!this.parentNode?.isConnected}
  set textContent(v){this._text=String(v);this.children=[]}get textContent(){return this._text+this.children.map(n=>n.textContent).join('')}
  appendChild(n){n.parentNode?.removeChild(n);n.parentNode=this;this.children.push(n);return n}insertBefore(n,b){n.parentNode?.removeChild(n);n.parentNode=this;this.children.splice(b?this.children.indexOf(b):0,0,n);return n}removeChild(n){this.children.splice(this.children.indexOf(n),1);n.parentNode=null}
  setAttribute(k,v){this.attrs[k]=String(v)}getAttribute(k){return this.attrs[k]??null}removeAttribute(k){delete this.attrs[k]}hasAttribute(k){return k in this.attrs}contains(n){for(;n;n=n.parentNode)if(n===this)return true;return false}
  addEventListener(k,fn){(this.listeners[k]||=[]).push(fn)}focus(){focus=this}scrollIntoView(){}
  async fire(type,init={}){const event={target:this,defaultPrevented:false,propagationStopped:false,preventDefault(){this.defaultPrevented=true},stopPropagation(){this.propagationStopped=true},...init};for(let at=this;at;at=at.parentNode){for(const fn of at.listeners[type]||[])await fn(event);if(event.propagationStopped||!['input','change','compositionstart','compositionend','focusout','keydown'].includes(type))break}return event}
  click(){this.clicks=(this.clicks||0)+1;if(!this.disabled)return this.fire('click')}
  getContext(){return{fillRect(){},drawImage(){}}}toDataURL(){return JPEG}
 }
 const body=new Node('body'),container=new Node('div');body.appendChild(container);
 const document={body,createElement:t=>new Node(t),getElementById:id=>nodes.find(n=>n.id===id)||null,querySelector:()=>container,addEventListener(k,fn){(listeners.get(k)||listeners.set(k,[]).get(k)).push(fn)},dispatchEvent(e){events.push(e);for(const fn of listeners.get(e.type)||[])fn(e)}};
 const w={knUser:user,document,TextEncoder,crypto:require('node:crypto').webcrypto,AbortController,
  Event:class{constructor(type){this.type=type}},CustomEvent:class{constructor(type,o){this.type=type;this.detail=o.detail}},
  setTimeout(fn,delay=0){const id=++sequence;timers.set(id,{fn,at:clock+delay,delay});return id},clearTimeout:id=>timers.delete(id),addEventListener(){},openDrawer(){},
  localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
  URL:{createObjectURL(){let s='blob:synthetic-'+(urls.length+1);urls.push(s);return s},revokeObjectURL:s=>revoked.push(s)},
  createImageBitmap:async file=>decode?decode(file):({width:64,height:64,close(){}}),
  sb:{auth:{
   async getUser(){return {data:{user:w.knUser}}},
   async getSession(){return {data:{session:{user:w.knUser,access_token:'fixture-'+w.knUser.id}}}},
   updateUser(){assert.fail('No SDK writes')}
  }}
 };
 w.fetch=async(path,options)=>{if(path==='/api/user-profile/avatar')return{ok:true,headers:{get:k=>({'x-avatar-image':REF,'content-type':'image/jpeg','content-length':'128'})[k.toLowerCase()]||null},blob:async()=>({size:128,type:'image/jpeg'})};assert.equal(path,'/api/user-profile');assert.equal(options.method,'PUT');let next=JSON.parse(options.body),id=options.headers.Authorization.slice('Bearer fixture-'.length);writes.push({id,next,options});let result=put?await put(next,id,w,options):null;if(!put){const stored={...next};if(stored.avatar_image?.startsWith('data:'))stored.avatar_image=REF;if(w.knUser?.id===id)w.knUser={...w.knUser,user_metadata:{...w.knUser.user_metadata,kn_profile_v1:stored}};result={ok:true,user_id:id,profile:stored}}if(result?.text)return result;return{ok:result?.ok===true,text:async()=>JSON.stringify(result)}};
 if(digest)w.crypto={subtle:{digest},getRandomValues:require('node:crypto').webcrypto.getRandomValues.bind(require('node:crypto').webcrypto)};
 if(persist)w.__knPersistLocalSetting=(k,v)=>persist(k,v,storage);
 const api=create(w),section=api.mount(container);
 const byId=id=>document.getElementById(id),byClass=c=>nodes.find(n=>n.className.split(/\s+/).includes(c));
 return{api,w,section,storage,writes,events,byId,byClass,nodes,focus:()=>focus,timers,async ready(){await api.ready();section.open=true;await section.fire('toggle');await settle()},async editName(value){await byId('knProfileNameButton').fire('click');const n=byId('knProfileUsername');n.value=value;await n.fire('input');return n},async bio(value){const n=byId('knProfileBio');n.value=value;await n.fire('input');return n},async tick(ms){const target=clock+ms;for(;;){const due=[...timers].filter(([,t])=>t.at<=target).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!due)break;clock=due[1].at;timers.delete(due[0]);due[1].fn();await settle()}clock=target;await settle()},auth(next){w.knUser=next;document.dispatchEvent(new w.Event('knAuthChange'))},async photo(file={size:2048,type:'image/png',name:'synthetic.png'}){const n=byId('knProfilePhoto');n.files=[file];n.value='fakepath';await n.fire('change');await settle()}};
}

test('autosave has no manual footer or successful receipt and opening an untouched initial name writes nothing',async()=>{
 const h=fixture({user:null});await h.ready();h.api.open();await h.tick(2000);await h.byId('knProfileNameButton').fire('click');await h.tick(2000);
 await h.byId('knProfileUsername').fire('keydown',{key:'Escape'});await h.tick(1000);assert.equal(h.storage.get('cm_nick'),undefined);assert.equal(h.writes.length,0);assert.equal(h.byClass('kn-profile-save'),undefined);assert.equal(h.byClass('kn-profile-cancel'),undefined);assert.ok(!h.byClass('kn-profile-status').textContent.includes('保存しました'));
});

test('rapid name and bio input coalesce to the final complete profile after the 600ms quiet period',async()=>{
 const h=fixture();await h.ready();await h.editName('最終名');await h.tick(400);await h.bio('紹介その1');await h.tick(400);assert.equal(h.writes.length,0);await h.bio('紹介の最終版');await h.tick(599);assert.equal(h.writes.length,0);await h.tick(1);
 assert.equal(h.writes.length,1);assert.deepEqual(h.writes[0].next,profile('最終名','紹介の最終版'));assert.equal(h.api.snapshot().bio,'紹介の最終版');assert.equal(h.byId('knProfileUsername').value,'最終名');assert.ok(!h.byClass('kn-profile-status').textContent.includes('保存しました'));
});

test('name and bio IME sessions prevent premature writes and save only their committed text',async()=>{
 for(const field of ['knProfileUsername','knProfileBio']){const h=fixture();await h.ready();if(field==='knProfileUsername')await h.byId('knProfileNameButton').fire('click');const n=h.byId(field);await n.fire('compositionstart');n.value='変換途中';await n.fire('input',{isComposing:true});await h.tick(1000);assert.equal(h.writes.length,0,field);await n.fire('blur');await n.fire('keydown',{key:'Enter',isComposing:true});await h.tick(1000);assert.equal(h.writes.length,0,field);n.value='確定した日本語';await n.fire('compositionend');await h.tick(600);assert.equal(h.writes.length,1,field);assert.equal(h.writes[0].next[field==='knProfileUsername'?'username':'bio'],'確定した日本語')}
});

test('an in-flight older save cannot erase newer typing and queues exactly one latest follow-up',async()=>{
 const held=defer();let first=true;const h=fixture({put:async(next,id)=>{if(first){first=false;await held.promise}return{ok:true,user_id:id,profile:next}}});await h.ready();await h.bio('送信中の紹介');await h.tick(600);assert.equal(h.writes.length,1);const bio=h.byId('knProfileBio');assert.equal(bio.disabled,false);await h.bio('新しい下書き1');await h.tick(250);await h.bio('新しい下書き2');await h.tick(1000);assert.equal(h.writes.length,1);bio.focus();held.resolve();await settle();await h.tick(600);assert.equal(bio.value,'新しい下書き2');assert.equal(h.writes.length,2);assert.equal(h.writes[1].next.bio,'新しい下書き2');assert.equal(h.api.snapshot().bio,'新しい下書き2');assert.equal(h.focus(),bio);
});

test('denied autosave retains the visible draft, never loops, and succeeds only after explicit retry',async()=>{
 let fail=true;const h=fixture({put:async(next,id)=>fail?{ok:false,reason:'secret https://private.invalid'}:{ok:true,user_id:id,profile:next}});await h.ready();await h.bio('失敗しても残る');await h.tick(600);assert.equal(h.writes.length,1);assert.equal(h.api.snapshot().bio,'元の紹介');assert.equal(h.byId('knProfileBio').value,'失敗しても残る');assert.match(h.byClass('kn-profile-status').textContent,/保存できません/);assert.doesNotMatch(h.byClass('kn-profile-status').textContent,/secret|https:/);await h.tick(60000);assert.equal(h.writes.length,1);const retry=h.byClass('kn-profile-retry');assert.ok(retry&&!retry.hidden&&!retry.disabled);fail=false;await retry.fire('click');await settle();assert.equal(h.writes.length,2);assert.equal(h.api.snapshot().bio,'失敗しても残る');assert.ok(retry.hidden);assert.ok(!h.byClass('kn-profile-status').textContent.includes('保存しました'));
});

test('switching owner cancels a waiting debounce and never submits account A draft as B',async()=>{
 const h=fixture();await h.ready();await h.bio('A専用下書き');await h.tick(300);h.auth(account('b',profile('B','Bの紹介')));await h.tick(2000);await h.api.ready();assert.equal(h.writes.length,0);assert.equal(h.api.username(),'B');assert.equal(h.byId('knProfileBio').value,'Bの紹介');assert.equal(h.section.open,false);
});

test('a late old-account response cannot enqueue old work or replace the new owner fields or focus',async()=>{
 const held=defer();const h=fixture({put:async(next,id)=>{if(id==='a')await held.promise;return{ok:true,user_id:id,profile:next}}});await h.ready();await h.bio('A送信中');await h.tick(600);await h.bio('Aの次');h.auth(account('b',profile('B','Bの紹介')));await h.tick(0);const outside=h.w.document.createElement('button');h.w.document.body.appendChild(outside);outside.focus();held.resolve();await settle();await h.tick(2000);assert.equal(h.writes.length,1);assert.equal(h.api.username(),'B');assert.equal(h.byId('knProfileBio').value,'Bの紹介');assert.equal(h.focus(),outside);
});

test('Escape closes the name editor without discarding the owner-requested autosave draft',async()=>{
 const h=fixture();await h.ready();const n=await h.editName('取り消す名前');await h.bio('残す紹介');await n.fire('keydown',{key:'Escape'});await h.tick(600);assert.equal(h.writes.length,1);assert.deepEqual(h.writes[0].next,profile('取り消す名前','残す紹介'));assert.equal(h.api.username(),'取り消す名前');assert.equal(h.byId('knProfileNameEditor').hidden,true);
});

test('fold and reopen retains the same nodes and produces no duplicate save for a pending draft',async()=>{
 const h=fixture();await h.ready();const bio=await h.bio('折りたたみ中の変更');h.section.open=false;await h.section.fire('toggle');await h.tick(1000);h.section.open=true;await h.section.fire('toggle');await h.tick(1000);assert.equal(h.byId('knProfileBio'),bio);assert.equal(bio.value,'折りたたみ中の変更');assert.equal(h.writes.length,1);assert.equal(h.api.snapshot().bio,'折りたたみ中の変更');
});

test('invalid Unicode length produces no write and a corrected draft can autosave without reload',async()=>{
 const h=fixture();await h.ready();await h.editName('🌿'.repeat(21));await h.tick(600);assert.equal(h.writes.length,0);assert.match(h.byClass('kn-profile-status').textContent,/20文字/);const n=h.byId('knProfileUsername');n.value='🌿'.repeat(20);await n.fire('input');await h.tick(600);assert.equal(h.writes.length,1);assert.equal(h.api.username(),'🌿'.repeat(20));
});

test('photo preparation must finish before one whole-draft save and native picker cancellation writes nothing',async()=>{
 const decoding=defer();const h=fixture({decode:()=>decoding.promise});await h.ready();const input=h.byId('knProfilePhoto');input.files=[];await input.fire('change');await h.tick(1000);assert.equal(h.writes.length,0);const selecting=h.photo();await settle();await h.bio('写真と一緒の紹介');await h.tick(1000);assert.equal(h.writes.length,0);decoding.resolve({width:64,height:64,close(){}});await selecting;await h.tick(600);assert.equal(h.writes.length,1);assert.equal(h.writes[0].next.avatar_image,JPEG);assert.equal(h.writes[0].next.bio,'写真と一緒の紹介');assert.equal(h.api.snapshot().avatar_image,REF);assert.ok(h.events.every(e=>!e.detail||!('avatar_image' in e.detail)));
});

test('initial avatar reset autosaves explicit photo removal and the existing legacy preset remains valid',async()=>{
 const h=fixture({user:account('a',{...profile('元の名前','紹介','star'),avatar_image:REF})});await h.ready();await h.byId('knProfileIconButton').fire('click');await h.byClass('kn-profile-photo-reset').fire('click');await h.tick(600);assert.equal(h.writes.length,1);assert.deepEqual(h.writes[0].next,{...profile('元の名前','紹介','leaf'),avatar_image:''});assert.equal(h.api.snapshot().avatar_image,'');
});

test('guest encrypted persistence remains pending until acknowledged and a failure rolls back committed keys',async()=>{
 const held=defer();let fail=true;const h=fixture({user:null,legacy:'ゲスト元',extra:{version:1,bio:'紹介元',avatar:'moon'},persist:async(k,v,storage)=>{await held.promise;if(fail)throw Error('synthetic');storage.set(k,v)}});await h.ready();await h.editName('ゲスト次');await h.bio('紹介次');await h.tick(600);assert.equal(h.api.username(),'ゲスト元');assert.equal(h.byId('knProfileUsername').value,'ゲスト次');held.resolve();await settle();assert.equal(h.api.username(),'ゲスト元');assert.equal(h.storage.get('cm_nick'),'ゲスト元');assert.deepEqual(JSON.parse(h.storage.get('kn_profile_guest_v1')),{version:1,bio:'紹介元',avatar:'moon'});fail=false;await h.byClass('kn-profile-retry').fire('click');await settle();assert.equal(h.api.username(),'ゲスト次');assert.equal(h.storage.get('cm_nick'),'ゲスト次');
});

test('a timed-out autosave keeps its draft and cannot adopt a late response or retry by itself',async()=>{
 const held=defer();const h=fixture({put:async(next,id)=>{await held.promise;return{ok:true,user_id:id,profile:next}}});await h.ready();await h.bio('期限後も残す');await h.tick(600);assert.equal(h.writes.length,1);await h.tick(12000);assert.equal(h.byId('knProfileBio').value,'期限後も残す');assert.equal(h.api.snapshot().bio,'元の紹介');assert.equal(h.writes[0].options.signal.aborted,true);assert.ok(!h.byClass('kn-profile-retry').hidden);held.resolve();await settle();await h.tick(60000);assert.equal(h.api.snapshot().bio,'元の紹介');assert.equal(h.writes.length,1);assert.equal(h.byId('knProfileBio').value,'期限後も残す');
});

test('an older successful name save cannot close a newer active name edit or steal its focus',async()=>{
 const held=defer();let first=true;const h=fixture({put:async(next,id)=>{if(first){first=false;await held.promise}return{ok:true,user_id:id,profile:next}}});await h.ready();const n=await h.editName('先の名前');await h.tick(600);n.value='編集中の次の名前';await n.fire('input');n.focus();held.resolve();await settle();assert.equal(n.value,'編集中の次の名前');assert.equal(h.byId('knProfileNameEditor').hidden,false);assert.equal(h.focus(),n);await h.tick(600);assert.equal(h.writes.length,2);assert.equal(h.api.username(),'編集中の次の名前');
});

test('a newer native photo decode wins and an older completion cannot restore or upload the replaced image',async()=>{
 const first=defer(),second=defer();let count=0,closed=0;const h=fixture({decode:()=>++count===1?first.promise:second.promise});await h.ready();const a=h.photo({size:1000,type:'image/png',name:'old.png'});await settle();const b=h.photo({size:1000,type:'image/png',name:'new.png'});await settle();second.resolve({width:64,height:64,close(){closed++}});await b;await h.tick(600);assert.equal(h.writes.length,1);first.resolve({width:32,height:32,close(){closed++}});await a;await h.tick(2000);assert.equal(h.writes.length,1);assert.equal(h.api.snapshot().avatar_image,REF);assert.equal(closed,2);
});

test('same-owner auth notification during autosave neither re-reads the stale profile nor duplicates a write',async()=>{
 const held=defer();const h=fixture({put:async(next,id)=>{await held.promise;return{ok:true,user_id:id,profile:next}}});await h.ready();await h.bio('保存中の紹介');await h.tick(600);h.auth(h.w.knUser);await h.tick(0);held.resolve();await settle();await h.tick(1000);assert.equal(h.writes.length,1);assert.equal(h.api.snapshot().bio,'保存中の紹介');assert.equal(h.byId('knProfileBio').value,'保存中の紹介');
});

test('switching accounts during an old pending save eventually loads B without a manual ready rescue',async()=>{
 const held=defer();const h=fixture({put:async(next,id)=>{if(id==='a')await held.promise;return{ok:true,user_id:id,profile:next}}});await h.ready();await h.bio('Aの送信');await h.tick(600);h.auth(account('b',profile('B','Bの紹介')));await h.tick(0);held.resolve();await settle();await h.tick(0);await settle();assert.equal(h.api.snapshot().loaded,true);assert.equal(h.api.snapshot().username,'B');h.section.open=true;await h.section.fire('toggle');await h.bio('Bだけの変更');await h.tick(600);assert.deepEqual(h.writes.map(v=>v.id),['a','b']);assert.equal(h.writes[1].next.bio,'Bだけの変更');assert.equal(h.api.snapshot().bio,'Bだけの変更');
});

test('rejecting a selected photo does not strand an independently changed text autosave',async()=>{
 const h=fixture();await h.ready();await h.bio('写真エラー後にも残す紹介');await h.tick(300);await h.photo({size:20*1024*1024,type:'image/png',name:'too-large.png'});await h.tick(1000);assert.equal(h.writes.length,1);assert.equal(h.writes[0].next.bio,'写真エラー後にも残す紹介');assert.equal(h.writes[0].next.avatar_image,undefined);assert.equal(h.api.snapshot().bio,'写真エラー後にも残す紹介');
});


test('blur and explicit name completion flush once while unchanged drafts do not write',async()=>{
 const h=fixture();await h.ready();await h.bio('元の紹介');await h.tick(600);assert.equal(h.writes.length,0);await h.bio('blurで確定');await h.byId('knProfileBio').fire('blur');await settle();assert.equal(h.writes.length,1);await h.tick(1000);assert.equal(h.writes.length,1);const n=await h.editName('Enterで確定');await n.fire('keydown',{key:'Enter',isComposing:true});await n.fire('keydown',{key:'Enter',keyCode:229});assert.equal(h.writes.length,1);await n.fire('keydown',{key:'Enter',repeat:false});await settle();await h.tick(1000);assert.equal(h.writes.length,2);assert.equal(h.api.username(),'Enterで確定');
});

test('a new guest cannot edit before its baseline loads, then saves bio while preserving the existing name and photo',async()=>{
 const held=defer();const h=fixture({legacy:'ゲスト元',extra:{version:1,bio:'ゲスト紹介元',avatar:'moon',avatar_image:JPEG},put:async(next,id)=>{await held.promise;return{ok:true,user_id:id,profile:next}}});await h.ready();await h.bio('A送信中');await h.tick(600);h.auth(null);await h.tick(0);assert.equal(h.byId('knProfileBio').disabled,true);assert.equal(h.byId('knProfileUsername').disabled,true);assert.equal(h.byId('knProfileIconButton').disabled,true);await h.bio('読込前の強制イベント');await h.tick(600);assert.equal(h.writes.length,1);held.resolve();await settle();await h.tick(1000);assert.equal(h.api.snapshot().loaded,true);assert.equal(h.byId('knProfileBio').disabled,false);assert.equal(h.byId('knProfileBio').value,'ゲスト紹介元');assert.equal(h.api.snapshot().avatar_image,JPEG);await h.bio('読込後のゲスト紹介');await h.tick(600);assert.equal(h.api.snapshot().bio,'読込後のゲスト紹介');const stored=JSON.parse(h.storage.get('kn_profile_guest_v1'));assert.equal(stored.bio,'読込後のゲスト紹介');assert.equal(stored.avatar_image,JPEG);assert.equal(stored.avatar,'moon');assert.equal(h.storage.get('cm_nick'),'ゲスト元');assert.equal(h.api.username(),'ゲスト元');
});

test('an untouched generated initial name stays unpersisted when only bio is autosaved from the open name editor',async()=>{
 const h=fixture({user:account('a',profile('','元の紹介')),digest:async()=>new Uint8Array([1,2,3,4,5,6]).buffer});await h.ready();await h.byId('knProfileNameButton').fire('click');const before=h.byId('knProfileUsername').value;assert.match(before,/^ユーザー(?:[0-9]{10})?$/);await h.bio('自己紹介だけ変更');await h.tick(600);assert.equal(h.writes.length,1);assert.equal(h.writes[0].next.username,'');assert.equal(h.writes[0].next.bio,'自己紹介だけ変更');assert.equal(h.api.username(),'');assert.equal(h.byId('knProfileNameEditor').hidden,false);await h.byId('knProfileUsername').fire('keydown',{key:'Escape'});await h.tick(1000);assert.equal(h.writes.length,1);assert.equal(h.api.username(),'');
});
