'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const api=require('../static/shared-assistant-context.js');
const encoded=(enabled,summary)=>api.encode(enabled,summary);
function memoryFixture(initial=null){let owner='A',raw=initial,read=null,write=null;const writes=[],states=[];
 const adapter={owner:()=>owner,read:async who=>read?read(who):raw,write:async(who,base,next)=>{if(write)return write(who,base,next);assert.equal(who,owner);assert.equal(raw,base);raw=next;writes.push(next);return {ok:true,synced:false};},token:who=>{assert.equal(who,owner);return 'synthetic-'+who;}};
 const session=api.createSession({...adapter,onChange:s=>states.push(s)});
 return {adapter,session,writes,states,getRaw:()=>raw,setRaw:value=>raw=value,setOwner:value=>owner=value,setRead:value=>read=value,setWrite:value=>write=value};
}
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
test('summary memory starts off and encodes only bounded explicit summary settings',()=>{
 assert.deepEqual(api.decode(null),{version:1,enabled:false,summary:''});assert.equal(api.KEY,'kb2_assistant_memory_v1');assert.deepEqual(JSON.parse(encoded(true,'  長期で学びたい  ')),{version:1,enabled:true,summary:'長期で学びたい'});
 for(const value of ['{}','[]','{"version":2,"enabled":true,"summary":"old"}','{"version":1,"enabled":true,"summary":"x","assets":[]}','{"version":1,"enabled":"yes","summary":"x"}'])assert.throws(()=>api.decode(value));
 for(const value of [null,1,'x'.repeat(1201),'秘密\u0000'])assert.throws(()=>encoded(true,value));assert.doesNotThrow(()=>encoded(true,'\n二行\t文'));
});
test('explicit save and delete use the current raw snapshot, with no transcript or ledger merge',async()=>{
 const h=memoryFixture();await h.session.refresh();assert.equal(h.session.state().enabled,false);assert.equal(h.writes.length,0);assert.deepEqual(await h.session.update(true,'投資用語を少しずつ学びたい'),{ok:true,synced:false});assert.equal(h.writes.length,1);assert.equal(h.session.state().summary,'投資用語を少しずつ学びたい');await h.session.forget();assert.deepEqual(api.decode(h.getRaw()),api.empty());assert.equal(h.writes.length,2);
});
test('invalid saved or unavailable memory stays unavailable and is never reset to an empty success',async()=>{
 for(const raw of ['bad','{"version":3}']){const h=memoryFixture(raw);assert.equal(await h.session.refresh(),false);assert.equal(h.session.state().ready,false);await assert.rejects(h.session.update(true,'new'));assert.equal(h.getRaw(),raw);assert.equal(h.writes.length,0);}
 const h=memoryFixture(encoded(true,'保持'));h.setRead(async()=>{throw Error('synthetic private transport');});assert.equal(await h.session.refresh(),false);assert.doesNotMatch(h.session.state().error,/synthetic|private/);assert.equal(h.writes.length,0);
});
test('failed saves retain the old summary, and duplicate saves are not queued',async()=>{
 const h=memoryFixture(encoded(true,'元'));await h.session.refresh();h.setWrite(async()=>{throw Error('synthetic secret');});await assert.rejects(h.session.update(true,'新'));assert.equal(h.session.state().summary,'元');assert.equal(h.session.state().busy,false);assert.doesNotMatch(h.session.state().error,/synthetic|secret/);
 let resolve;h.setWrite(()=>new Promise(r=>resolve=r));const pending=h.session.update(false,'候補');await assert.rejects(h.session.update(true,'duplicate'));h.setRaw(encoded(false,'候補'));resolve({ok:true,synced:false});await pending;assert.equal(h.session.state().enabled,false);
});
test('same-owner conflicting raw bytes reject memory changes instead of overwriting another edit',async()=>{
 const h=memoryFixture(encoded(true,'以前'));await h.session.refresh();h.setWrite(async(who,base)=>{assert.notEqual(h.getRaw(),base);throw Error('memory_changed');});h.setRaw(encoded(true,'別操作の更新'));await assert.rejects(h.session.update(true,'古い画面から'));assert.equal(api.decode(h.getRaw()).summary,'別操作の更新');assert.match(h.session.state().error,/別の操作/);
});
test('owner changes and round trips discard pending loads and acknowledgements',async()=>{
 for(const roundTrip of [false,true]){const h=memoryFixture(encoded(true,'Aだけ'));await h.session.refresh();let resolve;h.setWrite(()=>new Promise(r=>resolve=r));const pending=h.session.update(true,'未確認');h.setOwner('B');h.session.reset();if(roundTrip){h.setOwner('A');h.session.reset();}resolve({ok:true,synced:true});await assert.rejects(pending,/owner/);assert.equal(h.session.state().summary,'');assert.equal(h.session.state().proposal,null);}
 const h=memoryFixture();let resolve;h.setRead(()=>new Promise(r=>resolve=r));const pending=h.session.refresh();h.setOwner('B');h.session.reset();resolve(encoded(true,'Aの旧読み込み'));assert.equal(await pending,false);assert.equal(h.session.state().summary,'');
});
test('response proposals never auto-save and stale proposals cannot replace a later memory revision',async()=>{
 const h=memoryFixture(encoded(true,'前提'));await h.session.refresh();const snapshot=h.session.state();assert.equal(h.session.propose('今回本人が述べた希望',snapshot),true);assert.equal(h.session.state().proposal,'今回本人が述べた希望');assert.equal(h.writes.length,0);h.session.dismiss();assert.equal(h.session.state().proposal,null);
 await h.session.update(true,'更新');assert.equal(h.session.propose('古い返答候補',snapshot),false);assert.equal(h.session.state().summary,'更新');assert.equal(h.session.propose('x'.repeat(1201),h.session.state()),false);
 await h.session.update(false,'更新');assert.equal(h.session.propose('OFF時候補',h.session.state()),false);
});
function frameFixture(){let owner='A',raw=null,loadHook=null;const gets=[],sets=[];const c={location:{origin:'https://site.test',pathname:'/kakeibo'},knLedgerSession:{access_token:'synthetic-A',user:{id:'A'}},localStorage:{getItem(key){gets.push(key);return key==='kn_ledger_owner'?owner:key===api.KEY?raw:null;},setItem(key,value){sets.push([key,value]);raw=value;}},kkMyPageStore:{load:async who=>{if(loadHook)return loadHook(who);return Object.defineProperties({}, {raw:{get(){throw Error('notes must not be read');}},assetsRaw:{get(){throw Error('assets must not be read');}}});}}};c.kkAssistantMemoryStore={load:async()=>c.localStorage.getItem(api.KEY),write:async(who,base,next)=>{if(c.localStorage.getItem(api.KEY)!==base)throw Error('memory_changed');c.localStorage.setItem(api.KEY,next);return {ok:true,synced:false};}};let frame={contentWindow:c};const w={knUser:{id:'A'},location:{origin:'https://site.test'}},adapter=api.createFrameAdapter(w,()=>frame);
 return {w,c,adapter,gets,sets,getRaw:()=>raw,setRaw:v=>raw=v,setOwner:v=>{owner=v;w.knUser={id:v};c.knLedgerSession={access_token:'synthetic-'+v,user:{id:v}};},setLoad:v=>loadHook=v,setFrame:v=>frame=v};
}
test('frame adapter waits for existing private restore and accesses only its own key plus owner marker',async()=>{
 const h=frameFixture();assert.equal(await h.adapter.read('A'),null);const value=encoded(true,'確認済み要点');assert.deepEqual(await h.adapter.write('A',null,value),{ok:true,synced:false});assert.equal(h.getRaw(),value);assert.deepEqual(h.sets,[[api.KEY,value]]);assert.ok(h.gets.every(k=>[api.KEY,'kn_ledger_owner'].includes(k)));assert.equal(h.adapter.token('A'),'synthetic-A');
});
test('frame adapter refuses wrong origin missing auth different owner and changed snapshots',async()=>{
 for(const change of [h=>h.c.location.origin='https://elsewhere.test',h=>h.c.location.pathname='/other',h=>h.c.knLedgerSession.access_token='',h=>h.c.knLedgerSession.user.id='B',h=>h.w.knUser.id='B']){const h=frameFixture();change(h);await assert.rejects(h.adapter.read('A'));assert.equal(h.sets.length,0);}
 const h=frameFixture();h.setRaw(encoded(true,'new'));await assert.rejects(h.adapter.write('A',null,encoded(true,'old')),/changed/);assert.equal(h.sets.length,0);
});
test('owner switch or frame replacement while restore awaits prevents any memory write',async()=>{
 for(const replace of [false,true]){const h=frameFixture();let resolve;h.setLoad(()=>new Promise(r=>resolve=r));const pending=h.adapter.write('A',null,encoded(true,'Aの候補'));if(replace)h.setFrame({contentWindow:{...h.c}});else h.setOwner('B');resolve({});await assert.rejects(pending);assert.equal(h.sets.length,0);}
});
function controllerFixture(raw=null){const h=memoryFixture(raw),calls=[],events={},docEvents={};let response={reply:'通常の返事'},fetchHook=null;
 const d={addEventListener:(name,fn)=>docEvents[name]=fn,removeEventListener:name=>delete docEvents[name],querySelector:()=>null};
 const w={document:d,location:{origin:'https://site.test'},addEventListener:(name,fn)=>events[name]=fn,removeEventListener:name=>delete events[name],fetch:async(url,options)=>{calls.push({url,options});if(fetchHook)return fetchHook(url,options);return {ok:true,status:200,text:async()=>JSON.stringify(response)};}};
 const controller=api.createController(w,{adapter:h.adapter,frame:()=>null});return {...h,w,d,calls,controller,setResponse:v=>response=v,setFetch:v=>fetchHook=v,ownerChanged(){docEvents.knAuthChange();}};
}
test('memory off sends the original anonymous chat without context or an auth header',async()=>{
 const h=controllerFixture();await settle();const r=await h.controller.fetchChat({messages:[{role:'user',content:'質問'}],shared_context:{summary:'caller injected'}});assert.deepEqual(JSON.parse(h.calls[0].options.body),{messages:[{role:'user',content:'質問'}]});assert.equal(h.calls[0].options.headers.Authorization,undefined);assert.equal(JSON.parse(await r.text()).reply,'通常の返事');assert.equal(h.writes.length,0);
});
test('normal and teacher tools send the same confirmed opt-in summary and only their existing payload',async()=>{
 const h=controllerFixture(encoded(true,'本人が確認した希望'));await settle();for(const mode of [undefined,'teacher']){await h.controller.fetchChat({messages:[{role:'user',content:'質問'}],...(mode?{mode}: {})});const call=h.calls.at(-1);assert.equal(call.url,'/api/chat');assert.equal(call.options.headers.Authorization,'Bearer synthetic-A');assert.deepEqual(JSON.parse(call.options.body).shared_context,{version:1,consent:true,summary:'本人が確認した希望'});assert.equal(JSON.parse(call.options.body).mode,mode);assert.doesNotMatch(call.options.body,/assetsRaw|kb2_assets|notes|ledger/);}assert.equal(h.writes.length,0);assert.doesNotMatch(JSON.stringify(h.controller.state()),/synthetic-A/);
});
test('a bounded proposal from the same chat response appears for confirmation without another request or save',async()=>{
 const h=controllerFixture(encoded(true,''));await settle();h.setResponse({reply:'回答',shared_context_used:true,memory_proposal:'仕組みを一つずつ学びたい'});const response=await h.controller.fetchChat({messages:[{role:'user',content:'一つずつ教えて'}]});assert.equal(JSON.parse(await response.text()).reply,'回答');assert.equal(h.controller.state().proposal,'仕組みを一つずつ学びたい');assert.equal(h.calls.length,1);assert.equal(h.writes.length,0);
 await h.controller.session.update(true,'本人が修正して保存した要点');assert.equal(h.writes.length,1);assert.equal(h.controller.state().proposal,null);
});
test('malformed oversized or unverified response candidates are ignored',async()=>{
 for(const response of [{reply:'回答',memory_proposal:'未検証'},{reply:'回答',shared_context_used:true,memory_proposal:'x'.repeat(1201)},{reply:'回答',shared_context_used:true,memory_proposal:{text:'bad'}},{reply:'回答',shared_context_used:true,memory_proposal:'\u0000'}]){const h=controllerFixture(encoded(true,'前提'));await settle();h.setResponse(response);await h.controller.fetchChat({messages:[]});assert.equal(h.controller.state().proposal,null);assert.equal(h.writes.length,0);}
});
test('an account change during chat and even an account round trip reject old answers and proposals',async()=>{
 for(const roundTrip of [false,true]){const h=controllerFixture(encoded(true,'Aの前提'));await settle();let resolve;h.setFetch(()=>new Promise(r=>resolve=r));const pending=h.controller.fetchChat({messages:[]});h.setOwner('B');h.ownerChanged();if(roundTrip){h.setOwner('A');h.ownerChanged();}resolve({ok:true,status:200,text:async()=>JSON.stringify({reply:'Aだけの回答',shared_context_used:true,memory_proposal:'Aだけの候補'})});await assert.rejects(pending,/owner/);assert.equal(h.controller.state().proposal,null);}
});
test('a changed memory revision permits an answer but rejects its now-outdated memory proposal',async()=>{
 const h=controllerFixture(encoded(true,'以前'));await settle();let resolve;h.setFetch(()=>new Promise(r=>resolve=r));const pending=h.controller.fetchChat({messages:[]});await h.controller.session.update(true,'本人が別操作で更新');resolve({ok:true,status:200,text:async()=>JSON.stringify({reply:'回答',shared_context_used:true,memory_proposal:'古い要点'})});await pending;assert.equal(h.controller.state().summary,'本人が別操作で更新');assert.equal(h.controller.state().proposal,null);
});
test('a delayed response text read and a text read after logout are fenced by owner',async()=>{
 const h=controllerFixture(encoded(true,'前提'));await settle();let resolve;h.setFetch(async()=>({ok:true,status:200,text:()=>new Promise(r=>resolve=r)}));const pending=h.controller.fetchChat({messages:[]});await settle();h.setOwner('B');h.ownerChanged();resolve('{"reply":"old"}');await assert.rejects(pending,/owner/);
 const other=controllerFixture();await settle();const response=await other.controller.fetchChat({messages:[]});other.setOwner('');other.ownerChanged();await assert.rejects(response.text(),/owner/);
});
function uiFixture(initial=null){const h=controllerFixture(initial),all=[];
 function element(tag){const attrs={},events={};const n={tagName:tag.toUpperCase(),className:'',textContent:'',children:[],value:'',checked:false,disabled:false,hidden:false,events,setAttribute(k,v){attrs[k]=String(v);},getAttribute:k=>attrs[k]??null,appendChild(c){n.children.push(c);c.parentNode=n;return c;},addEventListener:(name,fn)=>events[name]=fn,remove(){if(n.parentNode)n.parentNode.children=n.parentNode.children.filter(c=>c!==n);},click(){return events.click&&events.click({target:n});}};all.push(n);return n;}
 h.d.createElement=element;const host=element('section'),box=h.controller.mount(host);return {...h,all,host,box,find:text=>all.find(n=>n.textContent===text),textarea:()=>all.filter(n=>n.tagName==='TEXTAREA'),checkbox:()=>all.find(n=>n.type==='checkbox')};
}
test('actual memory controls require explicit opt-in save and proposal confirmation and never auto-persist model text',async()=>{
 const h=uiFixture();await settle();assert.equal(h.checkbox().checked,false);h.checkbox().checked=true;h.checkbox().events.change();await h.find('設定を保存').click();assert.equal(h.writes.length,1);assert.equal(api.decode(h.getRaw()).enabled,true);
 h.controller.session.propose('候補の内容',h.controller.state());assert.equal(h.writes.length,1);const candidate=h.textarea()[1];assert.equal(candidate.value,'候補の内容');candidate.value='本人が確認して修正した要点';candidate.events.input();await h.find('この要点を保存').click();assert.equal(h.writes.length,2);assert.equal(api.decode(h.getRaw()).summary,'本人が確認して修正した要点');assert.equal(h.controller.state().proposal,null);
 await h.find('記憶を削除').click();assert.deepEqual(api.decode(h.getRaw()),api.empty());assert.equal(h.textarea()[0].value,'');assert.equal(h.checkbox().checked,false);
});
test('actual editable summary draft survives failed save and refresh but both drafts are cleared on owner change',async()=>{
 const h=uiFixture(encoded(true,'元の要点'));await settle();const summary=h.textarea()[0];summary.value='未保存の編集';summary.events.input();await h.controller.refresh();assert.equal(summary.value,'未保存の編集');h.setWrite(async()=>{throw Error('synthetic quota');});await h.find('設定を保存').click();assert.equal(summary.value,'未保存の編集');assert.equal(api.decode(h.getRaw()).summary,'元の要点');assert.equal(h.writes.length,0);
 h.controller.session.propose('Aの候補',h.controller.state());h.setOwner('B');h.ownerChanged();assert.equal(summary.value,'');assert.equal(h.textarea()[1].value,'');assert.equal(h.checkbox().checked,false);
});
test('actual dismiss control drops a candidate and closing settings itself does not save it',async()=>{
 const h=uiFixture(encoded(true,'元'));await settle();h.controller.session.propose('提案',h.controller.state());h.box.open=true;h.box.open=false;assert.equal(h.writes.length,0);assert.equal(h.controller.state().summary,'元');await h.find('今回は保存しない').click();assert.equal(h.controller.state().proposal,null);assert.equal(h.writes.length,0);
});
test('fixed owner-change error code lets callers stop their old-conversation retry loops',async()=>{
 const h=controllerFixture(encoded(true,'A'));await settle();let resolve;h.setFetch(()=>new Promise(r=>resolve=r));const pending=h.controller.fetchChat({messages:[]});h.setOwner('B');h.ownerChanged();resolve({ok:true,status:200,text:async()=>'{"reply":"old"}'});await assert.rejects(pending,e=>e.code==='assistant_owner_changed');
});
test('entry mounts once in normal chat and lazily created teacher without starting auth or frame preparation',async()=>{
 const entry=require('../static/assistant-memory-entry.js'),nodes=new Map(),mounted=[],calls={auth:0,prepare:0,create:0};let callback,options;
 function host(id){const n={id,children:[],appendChild(c){n.children.push(c);c.parentNode=n;},insertBefore(c,b){n.children=n.children.filter(x=>x!==c);n.children.splice(n.children.indexOf(b),0,c);c.parentNode=n;}};nodes.set(id,n);return n;}
 const chat=host('knChatPanel'),body=host('knChatBody');chat.appendChild(body);const controller={mount(n){mounted.push(n.id);const box={};n.appendChild(box);return box;}};
 const w={document:{body:{},getElementById:id=>nodes.get(id)},KNSharedAssistantContext:{createController(_w,o){calls.create++;options=o;return controller;}},MutationObserver:class{constructor(fn){callback=fn;}observe(){}},async knEnsureGuest(){calls.auth++;},knPrepareAssistantMemory(){calls.prepare++;}};
 assert.equal(entry.start(w),controller);assert.equal(calls.auth,0);assert.equal(calls.prepare,0);assert.deepEqual(mounted,['knChatPanel']);assert.equal(chat.children[1],body);entry.start(w);callback();assert.equal(calls.create,1);assert.deepEqual(mounted,['knChatPanel']);
 const teacher=host('teachOv'),teacherBody=host('teachBody');teacher.appendChild(teacherBody);callback();assert.deepEqual(mounted,['knChatPanel','teachOv']);assert.equal(teacher.children[1],teacherBody);await options.ensureReady();assert.equal(calls.auth,1);assert.equal(calls.prepare,1);
});
const now=Date.parse('2026-10-30T12:00:00Z');
test('fresh site facts include only safe aggregates with fixed category kinds and never names or transaction text',()=>{
 const secret='私的名称と自由メモ',record={assetsRaw:JSON.stringify([{name:secret,cat:'国内株',amount:.1,account:secret},{name:secret,cat:secret,amount:.2}]),raw:JSON.stringify({version:1,goals:[],assetTarget:1000,notes:[{body:secret}]})},rows=[{type:'inc',amount:10,name:secret},{type:'exp',amount:2,memo:secret},{type:'inv',amount:3,note:secret}];
 const facts=api.siteFacts(record,rows,now);assert.deepEqual(facts,{version:1,consent:true,as_of:'2026-10-30',currency:'JPY',assets:{total:.3,count:2,categories:[{kind:'domestic_stock',amount:.1},{kind:'other',amount:.2}]},goal_target:1000,household:{month:'2026-10',income:10,expense:2,investment:3,record_count:3}});assert.doesNotMatch(JSON.stringify(facts),/私的|name|memo|note|account/);
});
test('unknown site facts remain null and unreadable data is never fabricated as zero',()=>{
 const unreadable=[];unreadable._kkUnreadable=true;assert.deepEqual(api.siteFacts({assetsRaw:null,raw:null},unreadable,now),{version:1,consent:true,as_of:'2026-10-30',currency:'JPY',assets:null,goal_target:null,household:null});
 for(const record of [{assetsRaw:'bad',raw:null},{assetsRaw:'[{"amount":"3"}]',raw:null},{assetsRaw:'[{"amount":9007199254740992}]',raw:null},{assetsRaw:'[]',raw:'bad'},{assetsRaw:'[]',raw:'{"version":1,"goals":[],"assetTarget":0}'}])assert.throws(()=>api.siteFacts(record,[],now));assert.throws(()=>api.siteFacts({assetsRaw:null,raw:null},[{type:'inc',amount:Infinity}],now));
 assert.equal(api.siteFacts({assetsRaw:'[]',raw:'{"version":1,"goals":[],"assetTarget":null}'},[],now).goal_target,null);
});
test('site facts use JST current month, signed amounts, and explicit target clearing over historical goals',()=>{
 const record={assetsRaw:'[{"amount":-1,"cat":"現金"}]',raw:'{"version":1,"goals":[{"id":"old","target":100}],"selectedGoalId":"old","assetTarget":null}'},facts=api.siteFacts(record,[{type:'exp',amount:-5}],Date.parse('2026-10-31T16:00:00Z'));assert.equal(facts.as_of,'2026-11-01');assert.equal(facts.household.month,'2026-11');assert.equal(facts.assets.total,-1);assert.equal(facts.household.expense,-5);assert.equal(facts.goal_target,null);
});
test('aggregate sharing is off by default, sent fresh once with current auth, and never stored in memory',async()=>{
 const h=controllerFixture();await settle();let factCalls=0;h.adapter.facts=async who=>{assert.equal(who,'A');factCalls++;return api.siteFacts({assetsRaw:'[{"amount":5,"cat":"現金"}]',raw:null},[],now);};assert.equal(h.controller.state().factsOnce,false);h.controller.session.setFactsOnce(true);await h.controller.fetchChat({messages:[]});const body=JSON.parse(h.calls[0].options.body);assert.equal(body.site_context.assets.total,5);assert.equal(h.calls[0].options.headers.Authorization,'Bearer synthetic-A');assert.equal(body.shared_context,undefined);assert.equal(h.controller.state().factsOnce,false);assert.equal(h.writes.length,0);
 await h.controller.fetchChat({messages:[]});assert.equal(JSON.parse(h.calls[1].options.body).site_context,undefined);assert.equal(factCalls,1);
});
test('same-owner token refresh preserves a summary draft and aggregate choice; actual logout clears both',async()=>{
 const h=uiFixture(encoded(true,'保存済み'));await settle();const input=h.textarea()[0];input.value='編集中';input.events.input();h.controller.session.setFactsOnce(true);h.ownerChanged();await settle();assert.equal(input.value,'編集中');assert.equal(h.controller.state().summary,'保存済み');assert.equal(h.controller.state().factsOnce,true);h.setOwner('');h.ownerChanged();assert.equal(input.value,'');assert.equal(h.controller.state().factsOnce,false);
});
test('revoked or unavailable aggregate permission prevents a paid chat request and is not silently downgraded',async()=>{
 const h=controllerFixture();await settle();h.controller.session.setFactsOnce(true);h.adapter.facts=async()=>{throw Error('bad private dataset');};await assert.rejects(h.controller.fetchChat({messages:[]}),e=>e.code==='assistant_context_unavailable');assert.equal(h.calls.length,0);assert.equal(h.controller.state().factsOnce,true);
 let resolve;h.adapter.facts=()=>new Promise(r=>resolve=r);const pending=h.controller.fetchChat({messages:[]});h.controller.session.setFactsOnce(false);resolve(api.siteFacts({assetsRaw:null,raw:null},[],now));await assert.rejects(pending,e=>e.code==='assistant_context_unavailable');assert.equal(h.calls.length,0);
});
test('deleted memory or owner round trip during fresh aggregate collection cannot send old private context',async()=>{
 const h=controllerFixture(encoded(true,'削除する要点'));await settle();h.controller.session.setFactsOnce(true);let resolve;h.adapter.facts=()=>new Promise(r=>resolve=r);const pending=h.controller.fetchChat({messages:[]});await h.controller.session.forget();resolve(api.siteFacts({assetsRaw:null,raw:null},[],now));await assert.rejects(pending,e=>e.code==='assistant_context_unavailable');assert.equal(h.calls.length,0);
 const other=frameFixture();let loaded;other.setLoad(()=>new Promise(r=>loaded=r));const writing=other.adapter.write('A',null,encoded(true,'旧候補'));other.adapter.invalidate();loaded({});await assert.rejects(writing,/owner/);assert.equal(other.sets.length,0);
});

test('one shared controller prevents concurrent normal and teacher model calls and releases the gate after failure',async()=>{
 const h=controllerFixture(encoded(true,'confirmed'));await settle();let resolve;h.setFetch(()=>new Promise(r=>resolve=r));const first=h.controller.fetchChat({messages:[]});await assert.rejects(h.controller.fetchChat({messages:[],mode:'teacher'}),e=>e.code==='assistant_busy');assert.equal(h.calls.length,1);resolve({ok:true,status:200,text:async()=>'{"reply":"answer"}'});await first;h.setFetch(null);await h.controller.fetchChat({messages:[],mode:'teacher'});assert.equal(h.calls.length,2);
});

test('a later restore failure never silently sends a known opted-in request without its context',async()=>{
 const h=controllerFixture(encoded(true,'known summary'));await settle();h.setRead(async()=>{throw Error('restore unavailable');});await h.controller.refresh();assert.equal(h.controller.state().ready,false);await assert.rejects(h.controller.fetchChat({messages:[]}),e=>e.code==='assistant_context_unavailable');assert.equal(h.calls.length,0);
});

test('a new owner can send while the old owner is pending, and the old finally cannot release the new request gate',async()=>{
 const h=controllerFixture(encoded(true,'A confirmed'));await settle();const pending=[];h.setFetch(()=>new Promise(resolve=>pending.push(resolve)));const a=h.controller.fetchChat({messages:[{role:'user',content:'A question'}]});assert.equal(h.calls.length,1);
 h.setOwner('B');h.setRaw(encoded(true,'B confirmed'));h.ownerChanged();await settle();const b=h.controller.fetchChat({messages:[{role:'user',content:'B question'}]});assert.equal(h.calls.length,2);assert.equal(JSON.parse(h.calls[1].options.body).shared_context.summary,'B confirmed');assert.equal(h.calls[1].options.headers.Authorization,'Bearer synthetic-B');
 pending[0]({ok:true,status:200,text:async()=>JSON.stringify({reply:'A private answer',shared_context_used:true,memory_proposal:'A private proposal'})});await assert.rejects(a,e=>e.code==='assistant_owner_changed');assert.equal(h.controller.state().proposal,null);await assert.rejects(h.controller.fetchChat({messages:[],mode:'teacher'}),e=>e.code==='assistant_busy');assert.equal(h.calls.length,2);
 pending[1]({ok:true,status:200,text:async()=>JSON.stringify({reply:'B answer',shared_context_used:true,memory_proposal:'B proposal'})});const answer=await b;assert.equal(JSON.parse(await answer.text()).reply,'B answer');assert.equal(h.controller.state().proposal,'B proposal');h.setFetch(null);await h.controller.fetchChat({messages:[]});assert.equal(h.calls.length,3);
});

test('unprepared frame and a new owner awaiting setup show connection guidance while real read failures stay errors',async()=>{
 const h=uiFixture();h.setRead(async()=>{throw Error('memory_not_ready');});await h.controller.refresh();assert.equal(h.controller.state().ready,false);assert.equal(h.controller.state().error,'');assert.match(h.all.find(n=>n.className==='kn-am-status').textContent,/マイページで非公開接続を準備/);
 h.setOwner('B');h.ownerChanged();await settle();assert.equal(h.controller.state().owner,'B');assert.equal(h.controller.state().summary,'');assert.equal(h.controller.state().factsOnce,false);assert.equal(h.controller.state().error,'');assert.match(h.all.find(n=>n.className==='kn-am-status').textContent,/マイページで非公開接続を準備/);
 h.setRead(async()=>{throw Error('memory_restore_unavailable');});await h.controller.refresh();assert.match(h.controller.state().error,/記憶を読み込めませんでした/);h.setRead(null);h.setRaw('broken saved memory');await h.controller.refresh();assert.match(h.controller.state().error,/記憶を読み込めませんでした/);
});
