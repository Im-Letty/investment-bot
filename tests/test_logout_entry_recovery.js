'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const guestSource=fs.readFileSync(path.join(__dirname,'../static/guest-access.js'),'utf8');
const marker='(function(){window.knLogoutFlow=function(){',logoutStart=html.indexOf(marker);
assert.ok(logoutStart>=0);
const logoutSource=html.slice(logoutStart,html.indexOf('})();',logoutStart)+5);
function node(id){
 const classes=new Set(),attrs=new Map();
 return {id,children:[],style:{},inert:false,disabled:false,textContent:'',classList:{contains:x=>classes.has(x),add:(...xs)=>xs.forEach(x=>classes.add(x)),remove:(...xs)=>xs.forEach(x=>classes.delete(x))},appendChild(child){this.children.push(child);child.parent=this;return child;},remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);},setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k),getAttribute:k=>attrs.get(k),querySelector(){return null;}};
}
function harness({entry=true,seen=true,blockedStorage=false,introComplete=true,signOut=async()=>({error:null}),session=null}={}){
 const nodes=new Map(),listeners=new Map(),replacements=[],historyWrites=[],storage=new Map([['kn_seen_welcome',seen?'1':'0'],['kn_finance_test','synthetic-finance'],['kn_memory_test','synthetic-memory']]);
 let builds=0,guestCalls=0,mounts=0,syncs=0;
 const body=node('body');nodes.set('body',body);
 const location={href:'https://example.test/?'+(entry?'entry=logout&':'')+'v=6',get search(){return new URL(this.href).search;},replace(url){replacements.push(url);this.href=url;},reload(){throw Error('logout must not reload a protected route');}};
 const document={readyState:'complete',documentElement:node('html'),body,createElement:()=>node(''),getElementById(id){if(nodes.has(id))return nodes.get(id);return body.children.find(n=>n.id===id)||null;},querySelector:()=>null,
  addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);},removeEventListener(type,fn){listeners.set(type,(listeners.get(type)||[]).filter(x=>x!==fn));},dispatchEvent(e){for(const fn of listeners.get(e.type)||[])fn(e);}};
 const context={document,location,URL,URLSearchParams,Event:class{constructor(type){this.type=type;}},history:{state:null,replaceState(state,title,url){historyWrites.push(url);location.href=url;}},
  localStorage:{getItem(key){if(blockedStorage)throw Error('blocked');return storage.get(key)||null;},setItem(key,value){if(blockedStorage)throw Error('blocked');storage.set(key,String(value));},removeItem(key){storage.delete(key);},clear(){throw Error('must retain user records');}},
  sessionStorage:{removeItem(){}},Date,setTimeout,clearTimeout,matchMedia:()=>({matches:true}),
  knIntroComplete:introComplete,knUser:session&&session.user,knNavScreenSync(){syncs++;},
  sb:{auth:{getSession:async()=>({data:{session}}),signInAnonymously:async()=>{guestCalls++;return {data:{session:{user:{id:'synthetic-guest',is_anonymous:true}}}};},signOut}},
  resetPasskeyNotice(){},mount(){mounts++;if(!nodes.has('knAuthOv')){const ov=node('knAuthOv');nodes.set(ov.id,ov);body.appendChild(ov);}}};
 context.window=context;
 vm.runInNewContext(guestSource,context);
 const controlsStart=html.indexOf('  window.openAuth=function(mode)'),controlsEnd=html.indexOf('  var requestedAuth=',controlsStart);
 vm.runInNewContext(html.slice(controlsStart,controlsEnd),context);
 // Execute the real entry controller. Only its canvas/art construction is
 // replaced with synthetic nodes; the tested routing/auth/exit logic is intact.
 const begin=html.indexOf("  var SEEN='kn_seen_welcome';"),buildStart=html.indexOf('  function build(){',begin),tail=html.indexOf('  window.knPrepareWelcome=',buildStart),end=html.indexOf('</script>',tail);
 context.buildSyntheticWelcome=()=>{builds++;if(!nodes.has('knWelcomeOv')){const welcome=node('knWelcomeOv');nodes.set(welcome.id,welcome);body.appendChild(welcome);}};
 vm.runInNewContext('(function(){'+html.slice(begin,buildStart)+'function build(){buildSyntheticWelcome();}\n'+html.slice(tail,end),context);
 vm.runInNewContext(logoutSource,context);
 return {w:context,nodes,body,location,storage,replacements,historyWrites,document,builds:()=>builds,guestCalls:()=>guestCalls,mounts:()=>mounts,syncs:()=>syncs,
  fire(type){document.dispatchEvent({type});},dialog(){return document.getElementById('knLogoutDlg');},buttons(){return this.dialog().children[0].children[1].children;}};
}

test('logout entry is visible despite welcome history, restored anonymous identity or blocked storage',()=>{
 for(const options of [{},{session:{user:{id:'synthetic-guest',is_anonymous:true}}},{blockedStorage:true}]){
  const h=harness(options);assert.equal(h.w.KN_REGISTRATION_REQUIRED,false);assert.ok(h.nodes.get('knWelcomeOv').classList.contains('open'));
  h.w.knAuthEvent='INITIAL_SESSION';h.fire('knAuthChange');assert.ok(h.nodes.get('knWelcomeOv').classList.contains('open'));
  assert.equal(h.guestCalls(),0);assert.equal(h.storage.get('kn_finance_test'),'synthetic-finance');
 }
});
test('entry is prepared before intro completion and startup opens it exactly when ready',()=>{
 const h=harness({introComplete:false});assert.equal(h.nodes.has('knWelcomeOv'),false);
 h.w.knPrepareWelcome();assert.equal(h.nodes.get('knWelcomeOv').classList.contains('open'),false);
 h.w.knIntroComplete=true;h.fire('knIntroComplete');assert.ok(h.nodes.get('knWelcomeOv').classList.contains('open'));
});
for(const mode of ['signup','login'])test('explicit '+mode+' opens auth without a guest and cleans the entry URL',()=>{
 const h=harness();h.w[mode==='signup'?'knWelcomeSignup':'knWelcomeLogin']();
 assert.equal(h.w.knaMode,mode);assert.equal(h.mounts(),1);assert.equal(h.guestCalls(),0);assert.ok(h.nodes.get('knAuthOv').classList.contains('open'));
 assert.equal(new URL(h.location.href).searchParams.has('entry'),false);assert.equal(h.w.knEntryChoiceRequired,true);
 h.w.knUser={id:'stale-guest',is_anonymous:true};h.w.knAuthEvent='SIGNED_IN';h.fire('knAuthChange');assert.ok(h.nodes.get('knWelcomeOv').classList.contains('open'));
 h.w.knUser={id:'stale-member'};h.w.knAuthEvent='INITIAL_SESSION';h.fire('knAuthChange');assert.ok(h.nodes.get('knWelcomeOv').classList.contains('open'));
 h.w.knUser={id:'signed-in-member'};h.w.knAuthEvent='SIGNED_IN';h.fire('knAuthChange');assert.equal(h.nodes.get('knWelcomeOv').classList.contains('open'),false);assert.equal(h.w.knEntryChoiceRequired,false);
});
test('guest choice leaves entry, retains saved records and resumes verified guest access',async()=>{
 const h=harness();await h.w.knWelcomeSkip();await new Promise(setImmediate);
 assert.equal(h.w.knEntryChoiceRequired,false);assert.equal(h.nodes.get('knWelcomeOv').classList.contains('open'),false);assert.equal(h.guestCalls(),1);
 assert.equal(new URL(h.location.href).searchParams.has('entry'),false);assert.equal(h.storage.get('kn_finance_test'),'synthetic-finance');assert.equal(h.storage.get('kn_memory_test'),'synthetic-memory');
 const next=harness({entry:false,session:{user:{id:'synthetic-guest',is_anonymous:true}}});assert.equal(next.nodes.has('knWelcomeOv'),false,'reload after choosing guest follows ordinary public startup');
});
test('ordinary direct visits and OAuth returns keep their existing automatic home path',async()=>{
 for(const session of [null,{user:{id:'oauth-member',is_anonymous:false}}]){
  const h=harness({entry:false,session});assert.equal(h.w.knEntryChoiceRequired,false);assert.equal(h.nodes.has('knWelcomeOv'),false);
  await h.w.knEnsureGuest();assert.equal(h.guestCalls(),session?0:1);if(session)assert.equal(h.w.knUser.id,'oauth-member');
 }
});
test('direct navigation to entry with a live member never signs out or changes saved records',async()=>{
 let signouts=0;const user={id:'synthetic-live-member',is_anonymous:false},h=harness({session:{user},signOut:async()=>{signouts++;return {error:null};}});
 assert.ok(h.nodes.get('knWelcomeOv').classList.contains('open'));assert.equal(h.w.knUser,user);
 await assert.rejects(h.w.knEnsureGuest(),/entry_choice_required/);assert.equal(signouts,0);assert.equal(h.guestCalls(),0);assert.equal(h.w.knUser,user);
 h.w.knWelcomeLogin();assert.equal(signouts,0);assert.equal(h.w.knUser,user);assert.equal(h.storage.get('kn_finance_test'),'synthetic-finance');assert.equal(h.storage.get('kn_memory_test'),'synthetic-memory');
});
test('verified member signout and confirmed public exit both reach clean entry without pretending a public signout',async()=>{
 for(const session of [null,{user:{id:'synthetic-member',is_anonymous:false}}]){
  let calls=0;const h=harness({entry:false,session,signOut:async()=>{calls++;return {error:null};}});
  h.location.href='https://example.test/private?auth=login&screen=mypage&redirect=https://other.invalid/#private';
  h.w.knLogoutFlow();h.w.knLogoutFlow();assert.equal(h.body.children.filter(n=>n.id==='knLogoutDlg').length,1);
  await h.buttons()[1].onclick();assert.equal(calls,session?1:0);assert.deepEqual(h.replacements,['https://example.test/?entry=logout']);assert.equal(h.w.knUser,null);
  assert.equal(h.storage.get('kn_finance_test'),'synthetic-finance');assert.equal(h.storage.get('kn_memory_test'),'synthetic-memory');
 }
});
for(const kind of ['returned error','rejection','SDK unavailable'])test('signout '+kind+' retains usable account UI and retry instead of claiming success',async()=>{
 const user={id:'synthetic-member',is_anonymous:false},h=harness({entry:false,session:{user},signOut:async()=>{if(kind==='rejection')throw Error('network');return {error:{message:'synthetic'}};}});
 if(kind==='SDK unavailable')h.w.sb=null;
 h.w.knLogoutFlow();const [cancel,ok]=h.buttons();await ok.onclick();assert.equal(h.w.knUser,user);assert.equal(h.w.knEntryChoiceRequired,false);assert.equal(ok.disabled,false);assert.equal(cancel.disabled,false);assert.deepEqual(h.replacements,[]);
 assert.match(h.dialog().children[0].children[0].textContent,/ログアウトできませんでした/);cancel.onclick();assert.equal(h.dialog(),null);
});
test('member logout waits for pending authentication and duplicate confirmation cannot sign out twice',async()=>{
 let release,calls=0;const h=harness({entry:false,session:{user:{id:'synthetic-member',is_anonymous:false}},signOut:async()=>{calls++;return {error:null};}});
 h.w.knPrepareLogout=()=>new Promise(resolve=>{release=resolve;});h.w.knLogoutFlow();const pending=h.buttons()[1].onclick();await h.buttons()[1].onclick();assert.equal(calls,0);
 release();await pending;assert.equal(calls,1);assert.equal(h.replacements.length,1);
});
test('a pending-auth timeout leaves confirmation retryable without sending signOut or claiming logout',async()=>{
 let calls=0;const user={id:'synthetic-member',is_anonymous:false},h=harness({entry:false,session:{user},signOut:async()=>{calls++;return {error:null};}});
 h.w.knPrepareLogout=async()=>{throw Error('logout_pending_timeout');};h.w.knLogoutFlow();const [cancel,ok]=h.buttons();await ok.onclick();
 assert.equal(calls,0);assert.equal(h.w.knUser,user);assert.equal(ok.disabled,false);assert.equal(cancel.disabled,false);assert.equal(h.w.knEntryChoiceRequired,false);assert.deepEqual(h.replacements,[]);assert.match(h.dialog().children[0].children[0].textContent,/ログアウトできませんでした/);
});
test('entry artwork offers a shared signup and login button and a separate guest action',()=>{
 const welcome=html.slice(html.indexOf('    ov.innerHTML=',html.indexOf("  var SEEN='kn_seen_welcome';")),html.indexOf('    ov.querySelectorAll',html.indexOf("  var SEEN='kn_seen_welcome';")));
 assert.deepEqual([...welcome.matchAll(/data-action=\\"([^"]+)\\"/g)].map(match=>match[1]),['login','guest']);
 assert.match(welcome,/新規会員登録・ログインはこちら/);
 assert.match(html,/初めての方は新規登録/);
 assert.ok(html.indexOf('/static/guest-access.js?v=20261110-entry1')<html.indexOf('function startApprovedIntro(){'));
 assert.match(html,/redirectTo:'https:\/\/investment-bot-ta24\.onrender\.com'/);
});

function authStartup(h,sessionResult){
 let notify;h.w.sb.auth.onAuthStateChange=fn=>{notify=fn;};h.w.sb.auth.getSession=()=>sessionResult;
 const start=html.indexOf('var authEventObserved=false;'),end=html.indexOf('}var s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/@supabase',start);
 assert.ok(start>=0&&end>start);vm.runInNewContext(html.slice(start,end),h.w);return (event,session)=>notify(event,session);
}
test('late initial-session restore cannot overwrite a newer signed-out event or dismiss logout entry',async()=>{
 let resolve;const pending=new Promise(r=>{resolve=r;}),h=harness(),notify=authStartup(h,pending);
 notify('SIGNED_OUT',null);resolve({data:{session:{user:{id:'stale-member'}}}});await new Promise(setImmediate);
 assert.equal(h.w.knUser,null);assert.equal(h.w.knAuthEvent,'SIGNED_OUT');assert.equal(h.guestCalls(),0);assert.ok(h.nodes.get('knWelcomeOv').classList.contains('open'));
 assert.equal(h.storage.get('kn_finance_test'),'synthetic-finance');assert.equal(h.storage.get('kn_memory_test'),'synthetic-memory');
});
test('the actual auth subscriber keeps initial restore at entry and permits only deliberate member sign-in to leave',async()=>{
 const h=harness(),notify=authStartup(h,Promise.resolve({data:{session:null}}));await new Promise(setImmediate);
 notify('INITIAL_SESSION',{user:{id:'restored-member'}});assert.ok(h.nodes.get('knWelcomeOv').classList.contains('open'));
 h.w.knWelcomeLogin();notify('SIGNED_IN',{user:{id:'anonymous',is_anonymous:true}});assert.ok(h.nodes.get('knWelcomeOv').classList.contains('open'));
 notify('SIGNED_IN',{user:{id:'oauth-member'}});assert.equal(h.nodes.get('knWelcomeOv').classList.contains('open'),false);assert.equal(new URL(h.location.href).searchParams.has('entry'),false);
});


test('anonymous exit keeps the SDK owner and records, and returning through guest entry resumes the same owner',async()=>{
  const user={id:'retained-synthetic-guest',is_anonymous:true};let signouts=0;const h=harness({entry:false,session:{user},signOut:async()=>{signouts++;return {error:null};}});
  h.w.knLogoutFlow();assert.match(h.dialog().children[0].children[0].textContent,/ゲストの記録はこの端末に残ります/);await h.buttons()[1].onclick();
  assert.equal(signouts,0);assert.equal(h.w.knUser,user);assert.deepEqual(h.replacements,['https://example.test/?entry=logout']);assert.equal(h.w.knEntryChoiceRequired,true);
  assert.equal(h.storage.get('kn_finance_test'),'synthetic-finance');assert.equal(h.storage.get('kn_memory_test'),'synthetic-memory');
  const next=harness({entry:true,session:{user}});next.w.knAuthEvent='INITIAL_SESSION';next.fire('knAuthChange');assert.ok(next.nodes.get('knWelcomeOv').classList.contains('open'));
  await next.w.knWelcomeSkip();assert.equal(next.guestCalls(),0);assert.equal(next.w.knUser.id,user.id);assert.equal(next.nodes.get('knWelcomeOv').classList.contains('open'),false);
});
test('a registered SDK session must sign out even while menu metadata has not restored',async()=>{
  let signouts=0;const h=harness({entry:false,session:{user:{id:'sdk-verified-member',is_anonymous:false}},signOut:async()=>{signouts++;return {error:null};}});h.w.knUser=null;
  h.w.knLogoutFlow();await h.buttons()[1].onclick();assert.equal(signouts,1);assert.equal(h.w.knUser,null);assert.deepEqual(h.replacements,['https://example.test/?entry=logout']);
});
test('missing malformed or failed SDK session snapshots cannot route or fabricate signout',async()=>{
  for(const snapshot of [undefined,{}, {data:{}},{error:{message:'synthetic'},data:{session:null}},{data:{session:undefined}},{data:{session:{}}},{data:{session:{user:{id:'kind-missing'}}}},{data:{session:{user:{id:'',is_anonymous:true}}}},{data:{session:{user:{id:'guest',is_anonymous:'true'}}}}]){
    let signouts=0;const user={id:'old-menu-metadata'},h=harness({entry:false,session:{user},signOut:async()=>{signouts++;return {error:null};}});h.w.sb.auth.getSession=async()=>snapshot;
    h.w.knLogoutFlow();await h.buttons()[1].onclick();assert.equal(signouts,0);assert.equal(h.w.knUser,user);assert.deepEqual(h.replacements,[]);assert.equal(h.buttons()[1].disabled,false);assert.equal(h.w.knEntryChoiceRequired,false);assert.match(h.dialog().children[0].children[0].textContent,/ログアウトできませんでした/);
  }
});
test('a rejected SDK session observation remains retryable without claiming exit',async()=>{
  const h=harness({entry:false});h.w.sb.auth.getSession=async()=>{throw Error('synthetic network');};h.w.knLogoutFlow();await h.buttons()[1].onclick();assert.deepEqual(h.replacements,[]);assert.equal(h.buttons()[1].disabled,false);assert.equal(h.w.knEntryChoiceRequired,false);
});
test('a newer owner during session verification cannot be signed out by the stale confirmation',async()=>{
  const first={id:'first-member',is_anonymous:false},next={id:'next-member',is_anonymous:false};let release,signouts=0;const h=harness({entry:false,session:{user:first},signOut:async()=>{signouts++;return {error:null};}});h.w.sb.auth.getSession=()=>new Promise(resolve=>{release=resolve;});
  h.w.knLogoutFlow();const pending=h.buttons()[1].onclick();await new Promise(setImmediate);h.w.knUser=next;h.w.knAuthEvent='SIGNED_IN';h.fire('knAuthChange');release({data:{session:{user:first}}});await pending;
  assert.equal(signouts,0);assert.equal(h.w.knUser,next);assert.deepEqual(h.replacements,[]);assert.equal(h.buttons()[1].disabled,false);
});
test('a newer sign-in during member signout cannot be overwritten or reported as a successful exit',async()=>{
  for(const sameOwner of [false,true]){
    const first={id:'first-member',is_anonymous:false},next={id:sameOwner?'first-member':'next-member',is_anonymous:false};let release;const h=harness({entry:false,session:{user:first},signOut:()=>new Promise(resolve=>{release=resolve;})});
    h.w.knLogoutFlow();const pending=h.buttons()[1].onclick();await new Promise(setImmediate);h.w.knUser=next;h.w.knAuthEvent='SIGNED_IN';h.fire('knAuthChange');release({error:null});await pending;
    assert.equal(h.w.knUser,next);assert.deepEqual(h.replacements,[]);assert.equal(h.buttons()[1].disabled,false);
  }
});


test('an unconfirmed signOut response cannot claim member logout success',async()=>{
  for(const result of [undefined,{}, {error:undefined}]){
    const user={id:'verified-member',is_anonymous:false},h=harness({entry:false,session:{user},signOut:async()=>result});h.w.knLogoutFlow();await h.buttons()[1].onclick();
    assert.equal(h.w.knUser,user);assert.deepEqual(h.replacements,[]);assert.equal(h.buttons()[1].disabled,false);assert.match(h.dialog().children[0].children[0].textContent,/ログアウトできませんでした/);
  }
});

for(const anonymous of [false,true])test('a cached missing anonymous flag resolves the same-owner server '+(anonymous?'guest':'member')+' before exit',async()=>{
  const cached={id:'cached-optional-flag'},fresh={id:cached.id,is_anonymous:anonymous};let reads=0,signouts=0;
  const h=harness({entry:false,session:{user:cached},signOut:async()=>{signouts++;return {error:null};}});h.w.sb.auth.getUser=async()=>{reads++;return {data:{user:fresh},error:null};};
  h.w.knLogoutFlow();await h.buttons()[1].onclick();assert.equal(reads,1);assert.equal(signouts,anonymous?0:1);assert.deepEqual(h.replacements,['https://example.test/?entry=logout']);assert.equal(h.w.knUser,anonymous?fresh:null);assert.equal(h.storage.get('kn_finance_test'),'synthetic-finance');assert.equal(h.storage.get('kn_memory_test'),'synthetic-memory');
});
test('failed mismatched or incomplete server refresh cannot classify a cached missing flag as member',async()=>{
  for(const result of [undefined,{}, {error:{message:'synthetic'},data:{user:{id:'cached-owner',is_anonymous:false}}},{data:{user:null}},{data:{user:{id:'other-owner',is_anonymous:false}}},{data:{user:{id:'cached-owner'}}},{data:{user:{id:'cached-owner',is_anonymous:'true'}}}]){
    const cached={id:'cached-owner'};let signouts=0;const h=harness({entry:false,session:{user:cached},signOut:async()=>{signouts++;return {error:null};}});h.w.sb.auth.getUser=async()=>result;
    h.w.knLogoutFlow();await h.buttons()[1].onclick();assert.equal(signouts,0);assert.equal(h.w.knUser,cached);assert.deepEqual(h.replacements,[]);assert.equal(h.buttons()[1].disabled,false);assert.equal(h.w.knEntryChoiceRequired,false);
  }
});
test('server refresh rejection is retryable and does not clear the cached owner',async()=>{
  const cached={id:'cached-owner'},h=harness({entry:false,session:{user:cached}});h.w.sb.auth.getUser=async()=>{throw Error('synthetic read unavailable');};h.w.knLogoutFlow();await h.buttons()[1].onclick();assert.equal(h.w.knUser,cached);assert.deepEqual(h.replacements,[]);assert.equal(h.buttons()[1].disabled,false);
});
test('a newer owner during the optional server refresh remains current and cannot be signed out',async()=>{
  const cached={id:'cached-owner'},next={id:'next-owner',is_anonymous:false};let release,signouts=0;const h=harness({entry:false,session:{user:cached},signOut:async()=>{signouts++;return {error:null};}});h.w.sb.auth.getUser=()=>new Promise(resolve=>{release=resolve;});
  h.w.knLogoutFlow();const pending=h.buttons()[1].onclick();await new Promise(setImmediate);h.w.knUser=next;h.w.knAuthEvent='SIGNED_IN';h.fire('knAuthChange');release({data:{user:{id:cached.id,is_anonymous:false}},error:null});await pending;
  assert.equal(signouts,0);assert.equal(h.w.knUser,next);assert.deepEqual(h.replacements,[]);assert.equal(h.buttons()[1].disabled,false);
});
test('known boolean session kinds and confirmed public state do not add a server refresh',async()=>{
  for(const session of [null,{user:{id:'known-member',is_anonymous:false}},{user:{id:'known-guest',is_anonymous:true}}]){
    let reads=0;const h=harness({entry:false,session});h.w.sb.auth.getUser=async()=>{reads++;throw Error('unexpected server refresh');};h.w.knLogoutFlow();await h.buttons()[1].onclick();assert.equal(reads,0);assert.deepEqual(h.replacements,['https://example.test/?entry=logout']);
  }
});
