'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {harness,settle,deferred}=require('./helpers/shorts-editor-harness.js');
const {create:createPlayback}=require('../static/shorts-player.js');

// Exercise the actual posting controller with the actual editor. Media events,
// devices, session, FormData and fetch receipts stay in this offline DOM fixture.
// The fake recorder proves which File is submitted; it does not prove decoding.
function postingHarness(options={}){
  const h=harness({...options,autoExportMetadata:true});
  const proto=Object.getPrototypeOf(h.document.body), requests=[];
  if(!Object.getOwnPropertyDescriptor(proto,'elements'))Object.defineProperty(proto,'elements',{get(){
    const controls=this.querySelectorAll('button,input,textarea,select'),result=[...controls];
    for(const item of controls)if(item.name)result[item.name]=item;
    return result;
  }});
  proto.reset=function(){for(const el of this.elements){el.value=el.tagName==='SELECT'?(el.children[0]?.value||''):'';el.checked=false;}};
  h.document.readyState='complete';
  const sheet=h.document.createElement('section');sheet.id='knShorts';sheet.className='open';h.document.body.appendChild(sheet);
  const top=h.document.createElement('div');top.className='ks-top';sheet.appendChild(top);
  const feed=h.document.createElement('div');feed.id='ksFeed';sheet.appendChild(feed);
  const shortsButton=h.document.createElement('button');shortsButton.id='knShortsBtn';
  const navClicks={},navButtons=[],navListeners=new Map();let bottomNav=null;
  if(options.withBottomNav){
    bottomNav=h.document.createElement('nav');bottomNav.id='knBottomNav';h.document.body.appendChild(bottomNav);
    for(const [act,label]of [['morning','朝レター'],['home','シミュレーター'],['shorts','ショート'],['pet','育成ゲーム'],['mypage','マイページ']]){
      const choice=act==='shorts'?shortsButton:h.document.createElement('button');
      choice.type='button';choice.className='bn-item';choice.setAttribute('data-act',act);choice.textContent=label;
      const originalListener=()=>{navClicks[act]=(navClicks[act]||0)+1;};
      choice.addEventListener('click',originalListener);navListeners.set(choice,originalListener);
      bottomNav.appendChild(choice);navButtons.push(choice);
    }
  }else h.document.body.appendChild(shortsButton);
  let session=options.session||null,serial=0,playerClosed=0;
  h.window.sb={auth:{getSession:async()=>({data:{session}}),signInAnonymously(){assert.fail('No anonymous account creation');}}};
  h.window.crypto={randomUUID:()=>`00000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`};
  h.window.FormData=FormData;
  h.window.KNShortsEditor=h.editor;
  const playback=options.actualPlayback?createPlayback(feed,sheet,h.window):null;
  h.window.KNShortsPlayback={get:()=>playback||({close(){playerClosed++;},activate(){}})};
  h.window.KNShortsFeed={captureContext:()=>({generation:1,keyword:''}),appendPublished(){},removePublished(){}};
  h.window.fetch=async(url,init)=>{requests.push({url,init});if(options.fetch)return options.fetch(url,init);return {ok:true,json:async()=>({ok:true,posts:[],post:{id:1,provider:'upload'}})};};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../static/shorts-posting.js'),'utf8'),{window:h.window,Number,Array,Object,Promise,Error},{filename:'shorts-posting.js'});
  if(options.autoOpen!==false)h.window.KNShortsPosting.open();
  return Object.assign(h,{requests,sheet,top,feed,shortsButton,bottomNav,navButtons,navClicks,navListeners,playback,setSession(value){session=value;},posts:()=>requests.filter(r=>r.init?.method==='POST'),postingNode(sel){const n=h.document.querySelector(sel);assert.ok(n,'Missing posting control '+sel);return n;},playerClosed:()=>playerClosed});
}
const realSession=()=>({user:{id:'00000000-0000-4000-8000-000000000001',is_anonymous:false},access_token:'offline-fixture-token'});
async function choose(h){h.postingNode('.ks-post-edit').click();const original=h.select();h.metadata();h.node('.ks-edit-next').click();await settle();return original;}

 test('guest can edit locally while metadata and posting remain disabled, with no URL author choice',async()=>{
  const h=postingHarness();await settle();
  const fallback=h.postingNode('#ksPublishBtn');assert.strictEqual(fallback.parentElement,h.top);
  assert.equal(fallback.classList.contains('ks-publish-nav'),false);assert.equal(h.document.querySelectorAll('#ksPublishBtn').length,1);
  assert.equal(h.postingNode('.ks-post-edit').disabled,false);
  for(const name of ['title','caption','topic'])assert.equal(h.postingNode('form').elements[name].disabled,true);
  assert.equal(h.postingNode('.ks-post-submit').disabled,true);
  const original=await choose(h);assert.equal(h.urls.size,1);assert.equal(h.urls.get(h.postingNode('.ks-post-preview').src),original);
  const form=h.postingNode('form');assert.equal(form.elements.url,undefined);assert.equal(form.elements.method,undefined);
  assert.equal(h.document.querySelector('input[type=url]'),null);assert.equal(h.deviceCalls.length,0);
  form.emit('submit');await settle();assert.equal(h.posts().length,0);assert.match(h.postingNode('.ks-post-status').textContent,/ログイン/);
  h.postingNode('.ks-post-close').click();assert.equal(h.urls.size,0);assert.equal(h.postingNode('#knShortsPublish').hidden,true);
});

test('one direct nav post entry opens the existing guest editor flow without becoming a routed tab',async()=>{
  const h=postingHarness({withBottomNav:true,autoOpen:false});await settle();
  const posting=h.window.KNShortsPosting,publish=h.postingNode('#ksPublishBtn');
  assert.strictEqual(publish.parentElement,h.bottomNav);assert.equal(publish.tagName,'BUTTON');assert.equal(publish.type,'button');
  assert.equal(publish.classList.contains('ks-publish-nav'),true);assert.equal(publish.classList.contains('bn-item'),false);
  assert.equal(publish.hasAttribute('data-act'),false);assert.equal(publish.dataset.act,undefined);
  assert.equal(publish.getAttribute('aria-label'),'動画を投稿');
  const mark=publish.querySelector('span.ks-publish-mark');assert.ok(mark);assert.strictEqual(mark.parentElement,publish);
  assert.equal(mark.textContent,'+');assert.equal(mark.getAttribute('aria-hidden'),'true');
  assert.equal(h.top.querySelector('#ksPublishBtn'),null);assert.equal(h.document.querySelector('#knShortsPublish'),null,'mounting does not open a dialog');
  assert.equal(h.requests.length,0);assert.equal(h.deviceCalls.length,0);

  for(let i=0;i<3;i++)posting.mount();
  assert.equal(h.document.querySelectorAll('#ksPublishBtn').length,1);assert.strictEqual(h.postingNode('#ksPublishBtn'),publish);
  assert.equal(publish.events.get('click').size,1,'repeated mount does not duplicate the posting handler');
  assert.deepEqual(h.bottomNav.children.filter(node=>node!==publish),h.navButtons,'all original nav nodes retain their order and identity');
  for(const choice of h.navButtons){assert.strictEqual(choice.parentElement,h.bottomNav);assert.ok(choice.events.get('click').has(h.navListeners.get(choice)));}

  publish.click();await settle();
  const modal=h.postingNode('#knShortsPublish'),close=h.postingNode('.ks-post-close'),form=h.postingNode('form');
  assert.equal(modal.hidden,false);assert.strictEqual(h.document.activeElement,close);assert.equal(h.playerClosed(),1,'one click opens the existing controller once');
  assert.equal(h.document.querySelectorAll('#knShortsPublish').length,1);assert.equal(h.postingNode('.ks-post-edit').disabled,false);
  for(const name of ['title','caption','topic'])assert.equal(form.elements[name].disabled,true);
  assert.equal(h.postingNode('.ks-post-submit').disabled,true);assert.match(h.postingNode('.ks-post-status').textContent,/ログイン/);
  const original=await choose(h);assert.equal(h.urls.get(h.postingNode('.ks-post-preview').src),original,'the nav entry uses the actual existing editor confirmation');
  for(const name of ['title','caption','topic'])assert.equal(form.elements[name].disabled,true);
  form.emit('submit');await settle();assert.equal(h.posts().length,0);assert.equal(h.deviceCalls.length,0);
  close.click();await settle();
  assert.equal(modal.hidden,true);assert.strictEqual(h.document.activeElement,publish,'close returns focus to the same nav plus');
  assert.equal(h.urls.size,0);assert.equal(h.timers.size,0);assert.equal(h.frames.size,0);

  for(const choice of h.navButtons)choice.click();await settle();
  assert.deepEqual(h.navClicks,{morning:1,home:1,shorts:1,pet:1,mypage:1},'unrelated nav and the old Shorts tab keep their original click handlers');
  assert.equal(modal.hidden,true);assert.equal(h.posts().length,0);assert.equal(h.deviceCalls.length,0);
  assert.deepEqual(h.bottomNav.children.filter(node=>node!==publish),h.navButtons);
});

test('an actual edited File reaches multipart posting instead of the unedited original or JSON URL',async()=>{
  const h=postingHarness({session:realSession()});await settle();h.postingNode('.ks-post-edit').click();const original=h.select();h.metadata();
  h.node('.ks-edit-trim-end').value='5';h.node('.ks-edit-text').value='edited';h.node('.ks-edit-text').emit('input');h.node('.ks-edit-muted').checked=true;h.node('.ks-edit-muted').emit('change');h.node('.ks-edit-next').click();await settle();
  assert.equal(h.recorders.length,1);h.node('video.ks-edit-scratch').currentTime=5;const frames=[...h.frames.values()];h.frames.clear();frames.forEach(fn=>fn());await settle();
  const edited=h.urls.get(h.postingNode('.ks-post-preview').src);assert.ok(edited instanceof File);assert.notEqual(edited,original);assert.ok(edited.size>0);
  const form=h.postingNode('form');form.elements.title.value='Edited fixture';form.elements.topic.value='#投資';form.emit('submit');await settle();
  assert.equal(h.posts().length,1);const request=h.posts()[0];assert.equal(request.url,'/api/shorts/posts');assert.ok(request.init.body instanceof FormData);assert.equal(request.init.body.get('file'),edited);
  assert.equal(request.init.body.get('title'),'Edited fixture');assert.equal(request.init.body.get('url'),null);assert.equal(request.init.body.get('method'),null);assert.equal(request.init.headers.Authorization,'Bearer offline-fixture-token');
  assert.equal(request.init.headers['Content-Type'],undefined);assert.equal(h.urls.size,0);assert.equal(h.timers.size,0);assert.equal(h.frames.size,0);assert.ok(h.recorders[0].stream.getTracks().every(t=>t.readyState==='ended'));
});

test('anonymous session can edit but cannot emit a post, and session change discards its preview',async()=>{
  const h=postingHarness({session:{user:{id:realSession().user.id,is_anonymous:true},access_token:'anonymous-fixture'}});await settle();await choose(h);
  h.postingNode('form').emit('submit');await settle();assert.equal(h.posts().length,0);assert.equal(h.postingNode('.ks-post-submit').disabled,true);
  h.setSession(realSession());h.document.emit('knAuthChange');await settle();assert.equal(h.urls.size,0);assert.equal(h.postingNode('.ks-post-submit').disabled,true);
});

for(const event of ['pagehide','popstate'])test(event+' during editing closes both controllers and late confirmation cannot resurrect posting',async()=>{
  const h=postingHarness({session:realSession()});await settle();await choose(h);h.postingNode('.ks-post-edit').click();h.metadata();
  h.node('.ks-edit-muted').checked=true;h.node('.ks-edit-next').click();await settle();assert.equal(h.recorders.length,1);
  h.window.emit(event);await settle();assert.equal(h.document.querySelector('#knShortsEditor'),null);assert.equal(h.postingNode('#knShortsPublish').hidden,true);
  assert.equal(h.urls.size,0);assert.equal(h.timers.size,0);assert.equal(h.frames.size,0);assert.equal(h.posts().length,0);assert.ok(h.recorders[0].stream.getTracks().every(t=>t.readyState==='ended'));
});

test('hiding the document while camera permission is pending releases late tracks and both dialogs',async()=>{
  const permission=deferred(),h=postingHarness({session:realSession(),getUserMedia:()=>permission.promise});await settle();h.postingNode('.ks-post-edit').click();h.node('.ks-edit-camera').click();h.hidden();
  const stream=new h.Stream();permission.resolve(stream);await settle();assert.ok(stream.getTracks().every(t=>t.readyState==='ended'));
  assert.equal(h.document.querySelector('#knShortsEditor'),null);assert.equal(h.postingNode('#knShortsPublish').hidden,true);assert.equal(h.urls.size,0);assert.equal(h.posts().length,0);
});

test('auth change cancels in-flight edited export and stale completion cannot restore its selected File',async()=>{
  const h=postingHarness({session:realSession()});await settle();h.postingNode('.ks-post-edit').click();h.select();h.metadata();h.node('.ks-edit-muted').checked=true;h.node('.ks-edit-next').click();await settle();
  assert.equal(h.recorders.length,1);h.setSession(null);h.document.emit('knAuthChange');await settle();
  assert.equal(h.document.querySelector('#knShortsEditor'),null);assert.equal(h.postingNode('#knShortsPublish').hidden,false);assert.equal(h.urls.size,0);assert.equal(h.timers.size,0);assert.equal(h.frames.size,0);
  assert.equal(h.postingNode('.ks-post-preview').hidden,true);assert.equal(h.postingNode('.ks-post-submit').disabled,true);assert.equal(h.posts().length,0);assert.ok(h.recorders[0].stream.getTracks().every(t=>t.readyState==='ended'));
});


test('the actual player cannot restart background YouTube or native playback while the editor is open',async()=>{
  const h=postingHarness({actualPlayback:true});await settle();
  const current=h.document.createElement('div');current.className='ks-slide';current.setAttribute('data-vid','AAAAAAAAAAA');h.feed.appendChild(current);
  const next=h.document.createElement('div');next.className='ks-slide';next.setAttribute('data-media-type','upload');next.setAttribute('data-media-src','/api/shorts/posts/2/media');h.feed.appendChild(next);
  assert.equal(h.playback.activate(current),false);h.postingNode('.ks-post-edit').click();
  assert.equal(h.playback.activate(current),false);assert.equal(h.playback.prepare(next),false);assert.equal(h.feed.querySelectorAll('iframe,video').length,0);
  h.window.emit('popstate');await settle();assert.equal(h.document.querySelector('#knShortsEditor'),null);assert.equal(h.playback.activate(current),true);assert.equal(h.feed.querySelectorAll('iframe,video').length,2);
  h.playback.close();assert.equal(h.feed.querySelectorAll('iframe,video').length,0);
});

test('closing only the editor cancels export, retains the prior selected File and never submits a stale edit',async()=>{
  const h=postingHarness({session:realSession()});await settle();const prior=await choose(h),priorURL=h.postingNode('.ks-post-preview').src;
  h.postingNode('.ks-post-edit').click();h.metadata();h.node('.ks-edit-muted').checked=true;h.node('.ks-edit-next').click();await settle();assert.equal(h.recorders.length,1);
  h.node('.ks-edit-close').click();await settle();assert.equal(h.document.querySelector('#knShortsEditor'),null);assert.equal(h.postingNode('#knShortsPublish').hidden,false);
  assert.equal(h.postingNode('.ks-post-preview').src,priorURL);assert.equal(h.urls.get(priorURL),prior);assert.equal(h.urls.size,1);assert.equal(h.timers.size,0);assert.equal(h.frames.size,0);assert.equal(h.posts().length,0);
  assert.ok(h.recorders[0].stream.getTracks().every(t=>t.readyState==='ended'));h.postingNode('form').emit('submit');await settle();assert.equal(h.posts().length,1);assert.equal(h.posts()[0].init.body.get('file'),prior);
});

test('closing posting during a pending response keeps resources closed when that response arrives',async()=>{
  const pending=deferred(),h=postingHarness({session:realSession(),fetch:async(_url,init)=>init?.method==='POST'?pending.promise:({ok:true,json:async()=>({ok:true,posts:[]})})});await settle();await choose(h);
  h.postingNode('form').emit('submit');await settle();assert.equal(h.posts().length,1);h.postingNode('.ks-post-close').click();assert.equal(h.urls.size,0);
  pending.resolve({ok:true,json:async()=>({ok:true,post:{id:1,provider:'upload'}})});await settle();assert.equal(h.postingNode('#knShortsPublish').hidden,true);assert.equal(h.urls.size,0);assert.equal(h.postingNode('.ks-post-preview').hidden,true);
});
