'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const html=fs.readFileSync('kakeibo.html','utf8');
const start=html.indexOf('/* ==== Kakeibo <-> Supabase sync'),source=html.slice(start,html.indexOf('</script>',start));
const KEY='kb2_mypage_v1';
const JOURNAL='kn_mypage_pending:';
const planner=require('../static/mypage-planner.js');
const raw=label=>JSON.stringify({...planner.empty(),label});
async function settle(){for(let n=0;n<12;n++)await Promise.resolve();}
function fixture(seed={},framed=true,failReadKey=null){
  class FixtureStorage{
    constructor(){this.values=new Map(Object.entries({kn_ledger_owner:'alice',...seed}));this.writes=[];}
    get length(){return this.values.size;}
    key(i){return [...this.values.keys()][i]??null;}
    getItem(k){if(k===failReadKey)throw new Error('synthetic private read failure');return this.values.get(k)??null;}
    setItem(k,v){if(this.failKey===k)throw new Error('synthetic storage failure');this.writes.push(String(k));this.values.set(String(k),String(v));}
    removeItem(k){this.values.delete(k);}
  }
  const ls=new FixtureStorage(),requests=[],timers=new Map(),events=[],messages=[],listeners=new Map();let seq=0;
  const context={Storage:FixtureStorage,localStorage:ls,knLedgerSession:{user:{id:'alice'},access_token:'fixture-no-authority'},
    document:{readyState:'interactive',addEventListener(){}},location:{origin:'https://fixture.test'},Event:class{constructor(type){this.type=type;}},
    setTimeout(fn,ms){timers.set(++seq,{fn,ms});return seq;},clearTimeout:id=>timers.delete(id),
    addEventListener(name,fn){listeners.set(name,fn);},dispatchEvent(event){events.push(event.type);},
    fetch(url,init){const request={url,init,resolved:false};requests.push(request);return new Promise(resolve=>request.resolve=resolve);},
    renderAll(){},renderCalendar(){},renderDayModal(){},kkRenderCustomCats(){}};
  context.window=context;context.parent=framed?{location:context.location,knUser:{id:'alice'},postMessage(data,targetOrigin){messages.push({data:JSON.parse(JSON.stringify(data)),targetOrigin});}}:context;
  vm.runInNewContext(source,context);
  const bridge=context.kkMyPageStore;
  function respond(path,body,ok=true){const r=requests.find(item=>!item.resolved&&item.url.endsWith(path));assert.ok(r,'pending '+path);r.resolved=true;r.resolve({ok,json:async()=>body});return r;}
  return {context,ls,requests,timers,events,messages,listeners,bridge,
    failRead(key){failReadKey=key;},
    async restore(data,ok=true){respond('/load',{data},ok);await settle();},
    respondLoad:(data,ok=true)=>respond('/load',{data},ok),respondSave:(ok=true,json={ok})=>respond('/save',json,ok),
    fireSave(){const entry=[...timers].find(([,timer])=>timer.ms===1500);assert.ok(entry);timers.delete(entry[0]);return entry[1].fn();},
    change(owner){context.kkLedgerChangeOwner();context.knLedgerSession={user:{id:owner},access_token:'fixture-'+owner};ls.values.set('kn_ledger_owner',owner);if(framed)context.parent.knUser={id:owner};}};
}

test('the bridge waits for a real successful restore, returns exact strings, and keeps the legacy pull bool contract',async()=>{
  const h=fixture(),read=h.bridge.load('alice');let resolved=false;read.then(()=>resolved=true);
  await settle();assert.equal(resolved,false);assert.equal(h.requests.length,1);assert.equal(await h.bridge.save('alice',raw('too early')),false);
  const saved=raw('cloud'),assets='[{"name":"架空の現金","amount":12.5}]',refresh=h.context.kkRefreshRecords();
  await h.restore({[KEY]:saved,kb2_assets:assets});assert.equal(await refresh,true);
  assert.deepEqual(JSON.parse(JSON.stringify(await read)),{raw:saved,assetsRaw:assets});
  assert.equal(h.requests.length,1,'cached bridge reads do not fetch again');assert.ok(h.events.includes('knMyPageStoreChange'));
});

test('successful remote absence is distinct from load failure and does not invent or erase a local store',async()=>{
  const empty=fixture();const absent=empty.bridge.load('alice');await empty.restore(null);
  assert.deepEqual(JSON.parse(JSON.stringify(await absent)),{raw:null,assetsRaw:null});
  const old=raw('retained'),bad=fixture({[KEY]:old,kb2_assets:'{bad'}),failure=bad.bridge.load('alice');
  const rejected=assert.rejects(failure,/mypage_restore_unavailable/);await bad.restore({},false);await rejected;
  assert.equal(bad.ls.getItem(KEY),old);assert.equal(bad.ls.getItem('kb2_assets'),'{bad');assert.equal(bad.requests.length,1);
  assert.equal(await bad.bridge.save('alice',raw('not accepted')),false);assert.equal(bad.ls.getItem(KEY),old);
});

test('read errors are fixed codes and mismatched parent or local owner is rejected before mutation',async()=>{
  const h=fixture({[KEY]:raw('private')});await h.restore({[KEY]:raw('private')});
  await assert.rejects(h.bridge.load('bob'),/mypage_owner_unavailable/);
  h.context.parent.knUser={id:'bob'};
  await assert.rejects(h.bridge.load('alice'),/mypage_owner_unavailable/);assert.equal(await h.bridge.save('alice',raw('wrong')),false);
  h.context.parent.knUser={id:'alice'};h.ls.values.set('kn_ledger_owner','bob');
  await assert.rejects(h.bridge.load('alice'),/mypage_owner_unavailable/);assert.equal(await h.bridge.save('alice',raw('wrong')),false);
  assert.equal(h.ls.getItem(KEY),raw('private'));assert.equal(h.requests.length,1);
});

test('same raw malformed assets and planner text are returned without converting failures to empty data',async()=>{
  const h=fixture();await h.restore({[KEY]:'{unreadable',kb2_assets:'{unreadable'});
  const result=await h.bridge.load('alice');assert.equal(result.raw,'{unreadable');assert.equal(result.assetsRaw,'{unreadable');
});

test('a local read failure reports a fixed code without exposing the thrown storage detail',async()=>{
  const h=fixture();await h.restore({});const original=h.ls.getItem.bind(h.ls);
  h.ls.getItem=function(key){if(key===KEY)throw new Error('synthetic sensitive storage detail');return original(key);};
  await assert.rejects(h.bridge.load('alice'),error=>error.message==='mypage_storage_unavailable');
});

test('a planner write uses the shared full snapshot and acknowledges only a successful save of that version',async()=>{
  const assets='[{"amount":12.5}]',month='[{"amount":99}]',h=fixture({kb2_assets:assets,kb2_2026_10:month});
  await h.restore({kb2_assets:assets,kb2_2026_10:month});
  const content=raw('draft'),pending=h.bridge.save('alice',content);await settle();
  const req=h.requests.at(-1);assert.equal(req.url,'/api/kakeibo/save');
  assert.deepEqual(JSON.parse(req.init.body),{data:{kb2_assets:assets,kb2_2026_10:month,[KEY]:content}});
  assert.equal(h.ls.getItem(KEY),content);assert.equal(req.init.headers.Authorization,'Bearer fixture-no-authority');
  h.respondSave();assert.equal(await pending,true);
});

test('an older in-flight save never becomes an acknowledgement for a newer planner value',async()=>{
  const h=fixture({kb2_assets:'[]'});await h.restore({kb2_assets:'[]'});
  h.ls.setItem('kb2_assets','[{"amount":1}]');const older=h.fireSave();
  const content=raw('newer'),pending=h.bridge.save('alice',content);await settle();
  assert.equal(h.requests.filter(r=>r.url.endsWith('/save')).length,1);
  assert.equal(Object.hasOwn(JSON.parse(h.requests.at(-1).init.body).data,KEY),false);
  h.respondSave();await older;await settle();
  assert.equal(h.requests.filter(r=>r.url.endsWith('/save')).length,2);
  assert.equal(JSON.parse(h.requests.at(-1).init.body).data[KEY],content);
  h.respondSave(false);assert.equal(await pending,false);assert.equal(h.ls.getItem(KEY),content);
  const retry=h.bridge.save('alice',content);await settle();h.respondSave();assert.equal(await retry,true);
});

test('staging immediately retains each new draft during an in-flight save without claiming a cloud acknowledgement',async()=>{
  const h=fixture();assert.equal(h.bridge.stage('alice',raw('before restore')),false);await h.restore({});
  const first=raw('first'),latest=raw('last character');const saving=h.bridge.save('alice',first);await settle();
  assert.equal(h.bridge.stage('alice',latest),true);assert.equal(h.ls.getItem(KEY),latest);
  assert.equal(h.requests.filter(r=>r.url.endsWith('/save')).length,1,'stage uses the existing debounced save rather than another immediate request');
  assert.equal((await h.bridge.load('alice')).raw,latest);h.respondSave();assert.equal(await saving,false);
  const flush=h.bridge.save('alice',latest);await settle();assert.equal(JSON.parse(h.requests.at(-1).init.body).data[KEY],latest);
  h.respondSave();assert.equal(await flush,true);
  h.context.parent.knUser={id:'bob'};assert.equal(h.bridge.stage('alice',raw('wrong owner')),false);assert.equal(h.ls.getItem(KEY),latest);
});

test('changed owner invalidates read readiness and both stale load and save responses',async()=>{
  const h=fixture(),read=h.bridge.load('alice');const rejected=assert.rejects(read,/mypage_owner_changed/);
  h.change('bob');h.ls.values.delete(KEY);await h.restore({[KEY]:raw('alice')});await rejected;
  assert.equal(h.ls.getItem(KEY),null);const next=h.bridge.load('bob');h.respondLoad({[KEY]:raw('bob')});await settle();assert.equal((await next).raw,raw('bob'));
  const pending=h.bridge.save('bob',raw('unsent bob'));await settle();h.change('alice');h.ls.values.set(KEY,raw('restored alice'));
  h.respondSave();assert.equal(await pending,false);assert.equal(h.ls.getItem(KEY),raw('restored alice'));
  assert.equal(await h.bridge.save('alice',raw('too early')),false);
});

test('an owner round trip cannot revive a response from an earlier session generation',async()=>{
  const h=fixture();await h.restore({});const saving=h.bridge.save('alice',raw('first session'));await settle();
  h.change('bob');h.change('alice');h.ls.values.set(KEY,raw('new session'));h.respondSave();assert.equal(await saving,false);
  assert.equal(await h.bridge.save('alice',raw('must restore')),false);
});

test('bad writes retain prior bytes, failure retains new local bytes, and asset edits emit a content-free change event',async()=>{
  const old=raw('old'),h=fixture({[KEY]:old});await h.restore({[KEY]:old});
  for(const content of ['{bad','[]','null','{"version":2}',JSON.stringify({version:1,padding:'x'.repeat(1000001)})])assert.equal(await h.bridge.save('alice',content),false);
  assert.equal(h.ls.getItem(KEY),old);const count=h.events.length;h.ls.setItem('kb2_assets','[{"amount":3.25}]');assert.equal(h.events.length,count+1);
  const newer=raw('local only'),pending=h.bridge.save('alice',newer);await settle();h.respondSave(true,{ok:false});assert.equal(await pending,false);assert.equal(h.ls.getItem(KEY),newer);
  const refresh=h.context.kkRefreshRecords();h.respondLoad({[KEY]:old});await refresh;assert.equal(h.ls.getItem(KEY),newer);
});

test('standalone ledger uses the same verified owner without requiring a parent MyPage',async()=>{
  const h=fixture({},false);await h.restore({});assert.equal((await h.bridge.load('alice')).raw,null);
});

test('a draft staged before debounce survives a fresh document and an older remote snapshot',async()=>{
  const old=raw('cloud old'),latest=raw('final unsent character'),first=fixture({[KEY]:old});await first.restore({[KEY]:old});
  assert.equal(first.bridge.stage('alice',latest),true);assert.equal(first.requests.filter(r=>r.url.endsWith('/save')).length,0);
  assert.equal(first.ls.getItem(JOURNAL+'alice'),latest);
  const reload=fixture(Object.fromEntries(first.ls.values)),read=reload.bridge.load('alice');
  assert.equal(reload.ls.getItem(KEY),latest);const tooEarly=reload.fireSave();await tooEarly;
  assert.equal(reload.requests.filter(r=>r.url.endsWith('/save')).length,0,'pending replay cannot upload a full snapshot before restore succeeds');
  await reload.restore({[KEY]:old,kb2_assets:'[{"amount":88.5}]'});assert.equal((await read).raw,latest);
  const saving=reload.fireSave();const request=reload.requests.at(-1),data=JSON.parse(request.init.body).data;
  assert.equal(data[KEY],latest);assert.equal(data.kb2_assets,'[{"amount":88.5}]');assert.equal(Object.hasOwn(data,JOURNAL+'alice'),false);
  reload.respondSave();await saving;assert.equal(reload.ls.getItem(JOURNAL+'alice'),null);
});

test('an older acknowledgement cannot clear a newer pending journal',async()=>{
  const h=fixture();await h.restore({});const first=raw('first'),latest=raw('second');
  const saving=h.bridge.save('alice',first);await settle();assert.equal(h.ls.getItem(JOURNAL+'alice'),first);
  assert.equal(h.bridge.stage('alice',latest),true);h.respondSave();assert.equal(await saving,false);
  assert.equal(h.ls.getItem(JOURNAL+'alice'),latest);assert.equal(h.ls.getItem(KEY),latest);
  const next=h.bridge.save('alice',latest);await settle();h.respondSave();assert.equal(await next,true);assert.equal(h.ls.getItem(JOURNAL+'alice'),null);
});

test('pending replay reads only its verified owner and failed remote restoration keeps that journal',async()=>{
  const alice=raw('private alice'),bob=raw('private bob'),h=fixture({kn_ledger_owner:'bob',[KEY]:bob,[JOURNAL+'alice']:alice});
  h.context.knLedgerSession={user:{id:'bob'},access_token:'fixture-bob'};h.context.parent.knUser={id:'bob'};
  // The initial alice session had no matching storage owner and could not read its journal.
  assert.equal(h.ls.getItem(KEY),bob);await h.restore({[KEY]:bob});
  const loaded=h.bridge.load('bob');h.respondLoad({[KEY]:bob});await settle();assert.equal((await loaded).raw,bob);
  assert.equal(h.ls.getItem(JOURNAL+'alice'),alice);assert.equal(h.ls.getItem(JOURNAL+'bob'),null);
  const failed=fixture({[KEY]:raw('stale'),[JOURNAL+'alice']:alice}),pending=failed.bridge.load('alice');
  const rejection=assert.rejects(pending,/mypage_restore_unavailable/);await failed.restore({},false);await rejection;
  assert.equal(failed.ls.getItem(KEY),alice);assert.equal(failed.ls.getItem(JOURNAL+'alice'),alice);
  const blocked=failed.fireSave();await blocked;assert.equal(failed.requests.filter(r=>r.url.endsWith('/save')).length,0);
});

test('staging an unchanged acknowledged value leaves storage, dirty versions and debounce untouched',async()=>{
  const old=raw('already saved'),h=fixture({[KEY]:old});await h.restore({[KEY]:old});const before=h.events.length,writes=h.ls.writes.length;
  assert.equal(h.bridge.stage('alice',old),true);assert.equal(h.bridge.stage('alice',old),true);
  assert.equal(h.events.length,before);assert.equal(h.timers.size,0);assert.equal(h.ls.getItem(JOURNAL+'alice'),null);
  assert.equal(h.ls.writes.length,writes,'same raw does not rewrite the journal or active key');
  assert.equal(await h.bridge.save('alice',old),true);assert.equal(h.requests.length,1);
  const newRaw=raw('pending'),pending=h.bridge.save('alice',newRaw);await settle();const count=h.events.length;
  assert.equal(h.bridge.stage('alice',newRaw),true);assert.equal(h.events.length,count);h.respondSave();assert.equal(await pending,true);
  assert.equal(h.ls.getItem(JOURNAL+'alice'),null,'same raw does not increment dirty version during its save');
});

test('malformed or unreadable pending journals retain old bytes and cannot initialise an empty planner',async()=>{
  const old=raw('known local'),h=fixture({[KEY]:old,[JOURNAL+'alice']:'{bad'});
  await assert.rejects(h.bridge.load('alice'),/mypage_restore_unavailable/);assert.equal(h.requests.length,0);
  assert.equal(h.ls.getItem(KEY),old);assert.equal(h.ls.getItem(JOURNAL+'alice'),'{bad');assert.equal(await h.bridge.save('alice',raw('empty')),false);
});

test('a version marker cannot make a corrupt journal replace valid cloud data or trigger upload',async()=>{
  const valid=raw('valid saved'),badDocs=[{version:1,notes:'bad'},
    {...planner.empty(),notes:[{id:'bad',title:'missing body'}]},
    {...planner.empty(),goals:[{id:'g',title:'bad target',details:'',deadline:'',target:0,monthly:null}]},
    {...planner.empty(),todoDraft:{text:'draft'}},
    {...planner.empty(),goalDraft:{id:'g',title:'x',details:'',target:'1',deadline:'2026-02-30',monthly:''}},
    {...planner.empty(),todoEdits:{bad:{text:4,goalId:''}}}];
  for(const value of badDocs){
    const broken=JSON.stringify(value),h=fixture({[KEY]:valid,[JOURNAL+'alice']:broken});
    await assert.rejects(h.bridge.load('alice'),/mypage_restore_unavailable/);
    assert.equal(h.requests.length,0,'unvalidated replay never reaches save or load');assert.equal(h.ls.getItem(KEY),valid);
    assert.equal(h.ls.getItem(JOURNAL+'alice'),broken);assert.equal(await h.bridge.save('alice',valid),false);
    assert.equal(h.bridge.stage('alice',broken),false);assert.equal(h.timers.size,0);
    h.ls.setItem('kb2_assets','[{"amount":1.25}]');await h.fireSave();assert.equal(h.requests.length,0,'normal asset edits cannot bypass the pending journal hold');
  }
});

test('an unreadable journal blocks ordinary ledger autosave until a successful restore',async()=>{
  const valid=raw('retained'),h=fixture({[KEY]:valid},true,JOURNAL+'alice');
  await assert.rejects(h.bridge.load('alice'),/mypage_restore_unavailable/);assert.equal(h.requests.length,0);
  h.ls.setItem('kb2_assets','[{"amount":7.5}]');await h.fireSave();assert.equal(h.requests.length,0);
  assert.equal(h.ls.getItem(KEY),valid);assert.equal(await h.bridge.save('alice',raw('new')),false);
});

test('a cached owner recovers through a fresh restore after a transient journal read failure clears',async()=>{
  const valid=raw('retained'),h=fixture({[KEY]:valid,kb2_assets:'[]'});await h.restore({[KEY]:valid,kb2_assets:'[]'});
  h.failRead(JOURNAL+'alice');assert.equal(await h.context.kkRefreshRecords(),false);
  const rejection=assert.rejects(h.bridge.load('alice'),/mypage_restore_unavailable/);await rejection;
  h.ls.setItem('kb2_assets','[{"amount":7.5}]');await h.fireSave();assert.equal(h.requests.filter(r=>r.url.endsWith('/save')).length,0);
  h.failRead(null);const retry=h.bridge.load('alice');await settle();
  assert.equal(h.requests.filter(r=>r.url.endsWith('/load')).length,2,'retry revalidates the same owner through a new normal load');
  assert.equal(h.requests.filter(r=>r.url.endsWith('/save')).length,0);
  h.respondLoad({[KEY]:valid,kb2_assets:'[]'});const result=await retry;
  assert.equal(result.raw,valid);assert.equal(result.assetsRaw,'[{"amount":7.5}]');assert.equal(h.ls.getItem(KEY),valid);
});

test('journal is durable before the active key changes, and failed active writes remain recoverable',async()=>{
  const old=raw('old'),newer=raw('newest'),h=fixture({[KEY]:old});await h.restore({[KEY]:old});
  h.ls.failKey=JOURNAL+'alice';assert.equal(h.bridge.stage('alice',newer),false);
  assert.equal(h.ls.getItem(KEY),old);assert.equal(h.ls.getItem(JOURNAL+'alice'),null);
  h.ls.failKey=KEY;assert.equal(h.bridge.stage('alice',newer),false);
  assert.equal(h.ls.getItem(KEY),old);assert.equal(h.ls.getItem(JOURNAL+'alice'),newer);
  const reload=fixture(Object.fromEntries(h.ls.values)),reading=reload.bridge.load('alice');await reload.restore({[KEY]:old});
  assert.equal((await reading).raw,newer);assert.equal(reload.ls.getItem(JOURNAL+'alice'),newer);
});

test('a newer edit and revert keeps its pending version even if an older snapshot has the same raw bytes',async()=>{
  const h=fixture();await h.restore({});const a=raw('a'),b=raw('b'),saving=h.bridge.save('alice',a);await settle();
  h.bridge.stage('alice',b);h.bridge.stage('alice',a);h.respondSave();await saving;
  assert.equal(h.ls.getItem(KEY),a);assert.equal(h.ls.getItem(JOURNAL+'alice'),a,'raw equality does not replace a version acknowledgement');
  const later=h.bridge.save('alice',a);await settle();h.respondSave();assert.equal(await later,true);assert.equal(h.ls.getItem(JOURNAL+'alice'),null);
});

test('only the first verified restore per owner generation tells the same-origin parent that records are ready',async()=>{
  const saved=raw('private planner text'),assets='[{"name":"private asset name","amount":12.5}]',h=fixture();
  assert.deepEqual(h.messages,[]);await h.restore({[KEY]:saved,kb2_assets:assets});
  const notification={data:{type:'kn-mypage-records-ready'},targetOrigin:'https://fixture.test'};
  assert.deepEqual(h.messages,[notification]);
  assert.equal((await h.bridge.load('alice')).raw,saved);
  for(let n=0;n<2;n++){const refresh=h.context.kkRefreshRecords();await h.restore({[KEY]:saved,kb2_assets:assets});await refresh;}
  h.ls.setItem('kb2_assets','[{"amount":25}]');assert.equal(h.messages.length,1,'periodic reads and local edits keep the first-restore notification unique');
  assert.doesNotMatch(JSON.stringify(h.messages),/private planner|private asset|12\.5|alice|Bearer/);
  h.change('bob');const bob=h.bridge.load('bob');h.respondLoad({[KEY]:raw('private bob')});await bob;
  assert.deepEqual(h.messages,[notification,notification]);
  h.change('alice');const again=h.bridge.load('alice');h.respondLoad({[KEY]:saved});await again;
  assert.deepEqual(h.messages,[notification,notification,notification],'a new owner generation can announce its first successful restore');
});

test('failed restoration does not announce readiness and successful recovery announces it once',async()=>{
  const old=raw('retained after failure'),h=fixture({[KEY]:old}),read=h.bridge.load('alice');
  const rejected=assert.rejects(read,/mypage_restore_unavailable/);await h.restore({},false);await rejected;
  assert.deepEqual(h.messages,[]);assert.equal(h.ls.getItem(KEY),old);
  const retry=h.bridge.load('alice');h.respondLoad({[KEY]:old});assert.equal((await retry).raw,old);
  assert.equal(h.messages.length,1);assert.deepEqual(h.messages[0].data,{type:'kn-mypage-records-ready'});
  const next=h.context.kkRefreshRecords();await h.restore({[KEY]:old});await next;assert.equal(h.messages.length,1);
});

test('a malformed pending journal cannot send readiness before a valid successful restore',async()=>{
  const saved=raw('confirmed local'),pending=raw('recovered pending'),h=fixture({[KEY]:saved,[JOURNAL+'alice']:'{bad'});
  await assert.rejects(h.bridge.load('alice'),/mypage_restore_unavailable/);
  assert.equal(h.requests.length,0);assert.deepEqual(h.messages,[]);assert.equal(h.ls.getItem(KEY),saved);
  h.ls.values.set(JOURNAL+'alice',pending);const retry=h.bridge.load('alice');
  h.respondLoad({[KEY]:saved});assert.equal((await retry).raw,pending);assert.equal(h.messages.length,1);
});

test('stale owner responses and mismatched parent, storage or origin never announce readiness',async()=>{
  for(const change of [h=>{h.context.parent.knUser={id:'bob'};},h=>{h.ls.values.set('kn_ledger_owner','bob');},h=>{h.context.parent.location={origin:'https://foreign.test'};}]){
    const h=fixture();change(h);await h.restore({[KEY]:raw('unaccepted owner')});
    assert.deepEqual(h.messages,[]);await assert.rejects(h.bridge.load('alice'),/mypage_owner_unavailable/);
  }
  const changed=fixture();changed.change('bob');await changed.restore({[KEY]:raw('old alice')});assert.deepEqual(changed.messages,[]);
  const current=changed.bridge.load('bob');changed.respondLoad({[KEY]:raw('current bob')});await current;assert.equal(changed.messages.length,1);
});

test('standalone or unavailable parent messaging cannot break a successfully verified restore',async()=>{
  const standalone=fixture({},false);standalone.context.postMessage=()=>assert.fail('standalone must not message itself');
  await standalone.restore({});assert.equal((await standalone.bridge.load('alice')).raw,null);assert.deepEqual(standalone.messages,[]);
  const missing=fixture();delete missing.context.parent.postMessage;
  await missing.restore({});assert.equal((await missing.bridge.load('alice')).raw,null);assert.deepEqual(missing.messages,[]);
  const throwing=fixture();let attempts=0;throwing.context.parent.postMessage=()=>{attempts++;throw Error('synthetic unavailable parent messaging');};
  await throwing.restore({});assert.equal((await throwing.bridge.load('alice')).raw,null);assert.equal(attempts,1);
  const refresh=throwing.context.kkRefreshRecords();await throwing.restore({});await refresh;assert.equal(attempts,1);
});

function reminderDocument(){
  return {...planner.empty(),todos:[{id:'todo-1',text:'保持するやること',done:false,goalId:''}],
    todoDraft:{text:'追加途中',goalId:''},todoEdits:{'todo-1':{text:'編集途中',goalId:''}}};
}
function reminderSlot(document,slot){return slot==='todos'?document.todos[0]:slot==='todoDraft'?document.todoDraft:document.todoEdits['todo-1'];}

test('legacy reminders without optional fields retain unknown additions through journal replay and full-snapshot save',async()=>{
  const doc=reminderDocument();doc.futureTop={keep:'top'};doc.todos[0].futureRow={keep:'row'};
  doc.todoDraft.futureDraft=['keep','draft'];doc.todoEdits['todo-1'].futureEdit={keep:'edit'};
  const pending=JSON.stringify(doc),old=raw('older confirmed document'),h=fixture({[KEY]:old,[JOURNAL+'alice']:pending});
  const read=h.bridge.load('alice');await h.restore({[KEY]:old});assert.equal((await read).raw,pending);
  assert.equal(h.ls.getItem(KEY),pending);assert.equal(h.ls.getItem(JOURNAL+'alice'),pending);
  const saving=h.bridge.save('alice',pending);await settle();
  assert.equal(JSON.parse(h.requests.at(-1).init.body).data[KEY],pending);h.respondSave();assert.equal(await saving,true);
  assert.equal((await h.bridge.load('alice')).raw,pending);
  assert.ok(['todos','todoDraft','todoEdits'].every(slot=>!Object.hasOwn(reminderSlot(doc,slot),'dueDate')&&!Object.hasOwn(reminderSlot(doc,slot),'flagged')));
});

test('valid reminder dates and boolean flags in rows and both draft locations survive replay without rewriting extras',async()=>{
  for(const dueDate of ['', '2024-02-29', '2000-02-29', '2026-04-30', '2026-12-31']){
    const doc=reminderDocument();
    ['todos','todoDraft','todoEdits'].forEach((slot,index)=>Object.assign(reminderSlot(doc,slot),{dueDate,flagged:index!==1,futureReminder:{retained:slot}}));
    const pending=JSON.stringify(doc),old=raw('cloud record'),h=fixture({[KEY]:old,[JOURNAL+'alice']:pending}),reading=h.bridge.load('alice');
    await h.restore({[KEY]:old});assert.equal((await reading).raw,pending);assert.equal(h.ls.getItem(KEY),pending);
    const save=h.bridge.save('alice',pending);await settle();assert.equal(JSON.parse(h.requests.at(-1).init.body).data[KEY],pending);
    h.respondSave();assert.equal(await save,true);assert.equal(h.ls.getItem(JOURNAL+'alice'),null);
  }
});

test('invalid reminder dates in any row or draft block replay and preserve the original bytes',async()=>{
  const dates=[null,0,false,[],{},'2026-02-29','2026-02-30','1900-02-29','2026-04-31','2026-13-01','2026-00-01','2026-01-00','2026-01-32','2026-1-01','2026-01-1','2026-01-01T00:00:00Z','2026-01-01\n',' 2026-01-01'];
  for(const slot of ['todos','todoDraft','todoEdits'])for(const dueDate of dates){
    const doc=reminderDocument();Object.assign(reminderSlot(doc,slot),{dueDate,flagged:true});
    const pending=JSON.stringify(doc),saved=raw('confirmed bytes'),h=fixture({[KEY]:saved,[JOURNAL+'alice']:pending});
    await assert.rejects(h.bridge.load('alice'),/mypage_restore_unavailable/);
    assert.equal(h.requests.length,0);assert.equal(h.messages.length,0);assert.equal(h.ls.getItem(KEY),saved);assert.equal(h.ls.getItem(JOURNAL+'alice'),pending);
    assert.equal(h.bridge.stage('alice',pending),false);assert.equal(await h.bridge.save('alice',saved),false);
  }
});

test('invalid flags never weaken the existing required reminder fields or permit pending replay',async()=>{
  for(const slot of ['todos','todoDraft','todoEdits'])for(const flagged of [null,0,1,'false','true',[],{}]){
    const doc=reminderDocument();Object.assign(reminderSlot(doc,slot),{dueDate:'2028-02-29',flagged});
    const pending=JSON.stringify(doc),saved=raw('retained bytes'),h=fixture({[KEY]:saved,[JOURNAL+'alice']:pending});
    await assert.rejects(h.bridge.load('alice'),/mypage_restore_unavailable/);
    assert.equal(h.requests.length,0);assert.equal(h.messages.length,0);assert.equal(h.ls.getItem(KEY),saved);assert.equal(h.ls.getItem(JOURNAL+'alice'),pending);
  }
  const h=fixture();await h.restore({});
  for(const slot of ['todos','todoDraft','todoEdits'])for(const bad of [{text:null},{goalId:null},...(slot==='todos'?[{id:''},{done:1}]:[])]){
    const doc=reminderDocument();Object.assign(reminderSlot(doc,slot),{dueDate:'2028-02-29',flagged:false},bad);
    assert.equal(h.bridge.stage('alice',JSON.stringify(doc)),false);
  }
  assert.equal(h.requests.length,1);assert.equal(h.ls.getItem(KEY),null);
});

test('an optional portfolio target survives pending replay and full-snapshot save while all historical and additive data remain exact',async()=>{
  const historical={...reminderDocument(),goals:[{id:'g',title:'旧目標',details:'保持する詳細',target:2500,monthly:100,deadline:'2027-12-31'}],
    goalDraft:{id:'g',title:'旧編集途中',details:'  詳細\n',target:'3000',monthly:'125',deadline:'2027-12-31',futureDraft:{keep:true}},
    notes:[{id:'n',title:'メモ',body:'保持する本文\n',groupId:'',pinned:true,futureNote:{keep:true}}],futureTop:{keep:true}};
  const old=JSON.stringify(historical);
  for(const assetTarget of [undefined,null,0.01,Number.MAX_SAFE_INTEGER]){
    const doc=assetTarget===undefined?historical:{...historical,assetTarget},pending=JSON.stringify(doc);
    const h=fixture({[KEY]:old,[JOURNAL+'alice']:pending}),reading=h.bridge.load('alice');
    await h.restore({[KEY]:old});assert.equal((await reading).raw,pending);assert.equal(h.ls.getItem(KEY),pending);
    assert.equal(h.bridge.stage('alice',pending),true);
    const saving=h.bridge.save('alice',pending);await settle();
    if(h.requests.at(-1).url.endsWith('/save'))h.respondSave();
    assert.equal(await saving,true);assert.equal((await h.bridge.load('alice')).raw,pending);
    assert.equal(Object.hasOwn(JSON.parse(pending),'assetTarget'),assetTarget!==undefined);
    const saved=JSON.parse(h.ls.getItem(KEY));delete saved.assetTarget;assert.deepEqual(saved,historical);
  }
});

test('invalid optional portfolio targets cannot be staged or replayed over valid records',async()=>{
  const valid=raw('confirmed older bytes'),badValues=[0,-1,'100',false,true,[],{},Number.MAX_SAFE_INTEGER+1];
  const broken=badValues.map(assetTarget=>JSON.stringify({...planner.empty(),assetTarget}));
  broken.push(JSON.stringify({...planner.empty(),assetTarget:null}).replace('"assetTarget":null','"assetTarget":1e309'));
  for(const pending of broken){
    const h=fixture({[KEY]:valid,[JOURNAL+'alice']:pending});
    await assert.rejects(h.bridge.load('alice'),/mypage_restore_unavailable/);
    assert.equal(h.requests.length,0);assert.equal(h.messages.length,0);assert.equal(h.ls.getItem(KEY),valid);assert.equal(h.ls.getItem(JOURNAL+'alice'),pending);
    assert.equal(h.bridge.stage('alice',pending),false);assert.equal(await h.bridge.save('alice',valid),false);
  }
  const h=fixture({[KEY]:valid});await h.restore({[KEY]:valid});
  for(const pending of broken){assert.equal(h.bridge.stage('alice',pending),false);assert.equal(await h.bridge.save('alice',pending),false);}
  assert.equal(h.ls.getItem(KEY),valid);assert.equal(h.ls.getItem(JOURNAL+'alice'),null);assert.equal(h.requests.length,1);
});
