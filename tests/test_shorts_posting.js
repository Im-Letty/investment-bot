'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {feedRows,getLoggedInSession}=require('../static/shorts-posting.js');
const {create}=require('../static/shorts-player.js');
function published(overrides={}){return Object.assign({id:1,provider:'youtube',video_id:'AAAAAAAAAAA',title:'経済を学ぶ',topic:'#経済入門',published_at:'2026-10-14T11:00:00Z'},overrides);}
test('published feed accepts only typed same-origin media and preserves plain text captions',()=>{
  const rows=feedRows([published({title:'<img onerror=x>'}),published({id:2,provider:'upload',media_url:'/api/shorts/posts/2/media'})]);
  assert.equal(rows[0].id,'AAAAAAAAAAA');assert.equal(rows[0].cap,'<img onerror=x>');
  assert.equal(rows[1].id,'upload:2');assert.equal(rows[1].mediaSrc,'/api/shorts/posts/2/media');
  for(const value of [published({provider:'upload',media_url:'https://evil.invalid/movie.mp4'}),published({provider:'upload',media_url:'/api/shorts/posts/2/media'}),published({id:true}),published({id:-1}),published({published_at:null}),published({video_id:'bad"id'}),published({topic:'<script>'})])assert.deepEqual(feedRows([value]),[]);
});
test('author UI requires nonanonymous current session and creates no guest/account',async()=>{
  for(const user of [null,{id:'fixture'},{id:'fixture',is_anonymous:true},{id:'fixture',is_anonymous:0}]){
    const client={auth:{getSession:async()=>({data:{session:user?{user,access_token:'fixture'}:null}}),signInAnonymously(){assert.fail('posting cannot create guest');}}};
    await assert.rejects(getLoggedInSession(client),/login_required/);
  }
  const session={user:{id:'fixture',is_anonymous:false},access_token:'fixture'};
  assert.equal(await getLoggedInSession({auth:{getSession:async()=>({data:{session}})}}),session);
});
function harness(){
  const plays=[],pauses=[],commands=[],events=new Map();let doc;
  class Node{
    constructor(tag){this.tagName=tag.toUpperCase();this.attrs={};this.children=[];this.parentNode=null;this.style={};this.events={};this.classes=new Set();this.classList={contains:c=>this.classes.has(c),add:c=>this.classes.add(c),remove:c=>this.classes.delete(c)};if(tag==='iframe')this.contentWindow={postMessage:(s,target)=>commands.push({frame:this,func:JSON.parse(s).func,target})};}
    set className(s){this.classes=new Set(s.split(' '));}get className(){return [...this.classes].join(' ');}get firstChild(){return this.children[0]||null;}get isConnected(){return this===doc.body||!!this.parentNode?.isConnected;}
    setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k]??null;}removeAttribute(k){delete this.attrs[k];}set src(v){this.attrs.src=v;}get src(){return this.attrs.src||'';}
    set textContent(v){this.text=String(v);this.children=[];}get textContent(){return this.text||'';}
    appendChild(n){n.parentNode?.removeChild(n);n.parentNode=this;this.children.push(n);return n;}insertBefore(n,b){n.parentNode?.removeChild(n);n.parentNode=this;const ix=this.children.indexOf(b);this.children.splice(ix<0?this.children.length:ix,0,n);return n;}removeChild(n){this.children.splice(this.children.indexOf(n),1);n.parentNode=null;}remove(){this.parentNode?.removeChild(this);}
    contains(n){return n===this||this.children.some(c=>c.contains(n));}matches(sel){return sel.startsWith('.')?this.classes.has(sel.slice(1)):this.tagName===sel.toUpperCase();}querySelectorAll(sel){const result=[];function walk(n){for(const c of n.children){if(c.matches(sel))result.push(c);walk(c);}}walk(this);return result;}querySelector(sel){return this.querySelectorAll(sel)[0]||null;}
    addEventListener(k,fn){(this.events[k]||(this.events[k]=[])).push(fn);}emit(k){for(const f of this.events[k]||[])f({target:this});}play(){plays.push(this);return Promise.resolve();}pause(){pauses.push(this);}load(){this.loads=(this.loads||0)+1;}
  }
  doc={hidden:false,editor:null,getElementById:id=>id==='knShortsPublish'?doc.editor:null,createElement:tag=>new Node(tag),addEventListener:(k,f)=>events.set(k,f)};doc.body=new Node('body');
  const sheet=new Node('section');sheet.className='open';doc.body.appendChild(sheet);const feed=new Node('div');sheet.appendChild(feed);
  function slide(kind,id){const n=new Node('div');n.className='ks-slide';if(kind==='upload'){n.setAttribute('data-media-type','upload');n.setAttribute('data-media-src','/api/shorts/posts/'+id+'/media');}else n.setAttribute('data-vid',id);const ph=new Node('div');ph.className='ks-ph';n.appendChild(ph);const cap=new Node('div');cap.className='ks-cap';cap.textContent='Fixture';n.appendChild(cap);feed.appendChild(n);return n;}
  const win={document:doc,location:{origin:'https://fixture.invalid'},fetch(){assert.fail('player cannot fetch metadata');}};
  return{doc,sheet,feed,slide,plays,pauses,commands,player:create(feed,sheet,win),players:()=>[...feed.querySelectorAll('video'),...feed.querySelectorAll('iframe')],hide(){doc.hidden=true;events.get('visibilitychange')();}};
}
test('mixed YouTube and native feed keeps two players and never preplays the next file',()=>{
  const h=harness(),slides=[h.slide('youtube','AAAAAAAAAAA'),h.slide('upload',2),h.slide('youtube','BBBBBBBBBBB'),h.slide('upload',4)];
  h.player.activate(slides[0]);const next=slides[1].querySelector('video');assert.ok(next);assert.equal(next.muted,true);assert.equal(next.preload,'metadata');assert.equal(h.plays.length,0);
  next.emit('loadeddata');assert.equal(h.plays.length,0);assert.ok(h.pauses.includes(next));
  h.player.activate(slides[1]);assert.equal(slides[1].querySelector('video'),next);assert.ok(h.plays.includes(next));
  for(const slide of slides.slice(2)){h.player.activate(slide);assert.ok(h.players().length<=2);}
  assert.ok(h.pauses.includes(next));assert.equal(next.isConnected,false);assert.equal(next.src,'');
  assert.ok(h.commands.every(c=>c.target==='https://www.youtube-nocookie.com'));
});
test('native close/hidden cleanup cancels late loadeddata and retry cannot restart closed sheet',()=>{
  const h=harness(),slide=h.slide('upload',1);h.player.activate(slide);const video=slide.querySelector('video');video.emit('error');const retry=slide.querySelector('.ks-media-retry');assert.ok(retry);
  const count=h.plays.length;h.hide();assert.equal(h.players().length,0);video.emit('loadeddata');video.emit('error');retry.emit('click');assert.equal(h.plays.length,count);assert.equal(video.src,'');
});
test('unsafe native media path is rejected before video creation',()=>{
  for(const src of ['https://evil.invalid/video.mp4','/api/shorts/posts/1/media?token=x','/api/shorts/posts/../media','javascript:alert(1)']){
    const h=harness(),slide=h.slide('upload',1);slide.setAttribute('data-media-src',src);assert.equal(h.player.activate(slide),false);assert.equal(h.players().length,0);
  }
});
test('deleting another published slide keeps the current native frame and prepared next iframe',()=>{
  const h=harness(),current=h.slide('upload',1),next=h.slide('youtube','AAAAAAAAAAA'),removed=h.slide('upload',3);h.player.activate(current);
  const playing=current.querySelector('video'),ready=next.querySelector('iframe'),played=h.plays.length;
  removed.remove();h.player.remove(removed);assert.equal(current.querySelector('video'),playing);assert.equal(next.querySelector('iframe'),ready);assert.equal(h.plays.length,played);
  next.remove();h.player.remove(next);assert.equal(current.querySelector('video'),playing);assert.equal(h.plays.length,played);assert.equal(h.players().length,1);
  current.remove();h.player.remove(current);assert.equal(h.players().length,0);assert.ok(h.pauses.includes(playing));
});
test('the open posting dialog prevents background observers from mounting or restarting players',()=>{
  const h=harness(),current=h.slide('upload',1),next=h.slide('youtube','AAAAAAAAAAA');h.doc.editor={hidden:false};
  assert.equal(h.player.activate(current),false);assert.equal(h.player.prepare(next),false);assert.equal(h.players().length,0);assert.equal(h.plays.length,0);
  h.doc.editor.hidden=true;assert.equal(h.player.activate(current),true);assert.ok(current.querySelector('video'));
});

test('video author name passes as plain bounded display text and never imports full profile metadata',()=>{
 const rows=feedRows([published({author_name:'<b>名前</b>',email:'private@example.invalid',user_metadata:{name:'never'}})]);
 assert.equal(rows[0].authorName,'<b>名前</b>');assert.equal(rows[0].email,undefined);assert.equal(rows[0].user_metadata,undefined);
 for(const author_name of ['x'.repeat(21),'bad\u0000name','bad\u0085name',{},null])assert.equal(feedRows([published({author_name})])[0].authorName,'');
});
