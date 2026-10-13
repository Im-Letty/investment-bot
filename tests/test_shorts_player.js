'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {create,get}=require('../static/shorts-player.js');

// No iframe is loaded by this fixture. Synthetic video IDs and local
// postMessage records exercise the production player without external traffic.
function harness(){
  const documentEvents=new Map(),jobs=new Map(),messages=[],networkCalls=[];
  let document,window,nextJob=0;
  class Node {
    constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.dataset={};this.attrs={};this.events=new Map();this._classes=new Set();this.style={};this._text='';this.hidden=false;
      this.classList={add:(...names)=>names.forEach(n=>this._classes.add(n)),remove:(...names)=>names.forEach(n=>this._classes.delete(n)),contains:n=>this._classes.has(n),toggle:(n,on)=>{on=on===undefined?!this._classes.has(n):on;if(on)this._classes.add(n);else this._classes.delete(n);return on;}};
      if(this.tagName==='IFRAME')this.contentWindow={postMessage:(payload,target)=>messages.push({frame:this,payload:typeof payload==='string'?JSON.parse(payload):payload,target})};
    }
    get ownerDocument(){return document;}get parentElement(){return this.parentNode;}get firstChild(){return this.children[0]||null;}get nextElementSibling(){if(!this.parentNode)return null;return this.parentNode.children[this.parentNode.children.indexOf(this)+1]||null;}
    get isConnected(){return this===document.body||!!this.parentNode?.isConnected;}
    set className(value){this._classes=new Set(String(value).split(/\s+/).filter(Boolean));}get className(){return [...this._classes].join(' ');}
    set id(value){this.attrs.id=String(value);}get id(){return this.attrs.id||'';}
    set src(value){this.attrs.src=String(value);}get src(){return this.attrs.src||'';}
    set textContent(value){this._text=String(value);this.children.forEach(n=>n.parentNode=null);this.children=[];}get textContent(){return this._text;}
    setAttribute(name,value){this.attrs[name]=String(value);if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(value);}
    getAttribute(name){return this.attrs[name]??null;}hasAttribute(name){return name in this.attrs;}removeAttribute(name){delete this.attrs[name];}
    appendChild(child){child.parentNode?.removeChild(child);this.children.push(child);child.parentNode=this;return child;}
    insertBefore(child,before){child.parentNode?.removeChild(child);const i=this.children.indexOf(before);this.children.splice(i<0?this.children.length:i,0,child);child.parentNode=this;return child;}
    removeChild(child){const i=this.children.indexOf(child);assert.ok(i>=0);this.children.splice(i,1);child.parentNode=null;return child;}
    remove(){this.parentNode?.removeChild(this);}
    contains(child){return child===this||this.children.some(node=>node.contains(child));}
    matches(selector){return selector.split(',').some(part=>{part=part.trim();const tag=part.match(/^[a-z]+/i)?.[0];if(tag&&this.tagName!==tag.toUpperCase())return false;for(const [,cls]of part.matchAll(/\.([\w-]+)/g))if(!this.classList.contains(cls))return false;for(const [,id]of part.matchAll(/#([\w-]+)/g))if(this.id!==id)return false;return true;});}
    querySelectorAll(selector){const result=[];function walk(node){for(const child of node.children){if(child.matches(selector))result.push(child);walk(child);}}walk(this);return result;}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    closest(selector){for(let n=this;n;n=n.parentNode)if(n.matches(selector))return n;return null;}
    addEventListener(type,fn){if(!this.events.has(type))this.events.set(type,new Set());this.events.get(type).add(fn);}
    removeEventListener(type,fn){this.events.get(type)?.delete(fn);}
    emit(type,extra={}){for(const fn of [...(this.events.get(type)||[])])fn({type,target:this,...extra});if(typeof this['on'+type]==='function')this['on'+type]({type,target:this,...extra});}
    getBoundingClientRect(){return{top:0,left:0,width:390,height:700,bottom:700,right:390};}
  }
  document={hidden:false,createElement:tag=>new Node(tag),addEventListener(type,fn){if(!documentEvents.has(type))documentEvents.set(type,new Set());documentEvents.get(type).add(fn);},removeEventListener(type,fn){documentEvents.get(type)?.delete(fn);},querySelector(selector){return this.body.querySelector(selector);}};
  document.body=new Node('body');
  const sheet=new Node('section');sheet.id='knShorts';sheet.className='open';document.body.appendChild(sheet);
  const feed=new Node('div');feed.id='ksFeed';feed.className='ks-feed';sheet.appendChild(feed);
  const slides=[];
  function slide(id){const node=new Node('div');node.className='ks-slide';node.setAttribute('data-vid',id);const caption=new Node('div');caption.className='ks-cap';caption.textContent='Local fixture video';node.appendChild(caption);feed.appendChild(node);slides.push(node);return node;}
  function forbidden(){networkCalls.push(true);throw new Error('Shorts player must not request a data API');}
  window={document,location:{origin:'http://localhost'},fetch:forbidden,setTimeout(fn){const id=++nextJob;jobs.set(id,fn);return id;},clearTimeout(id){jobs.delete(id);},requestAnimationFrame(fn){const id=++nextJob;jobs.set(id,fn);return id;},cancelAnimationFrame(id){jobs.delete(id);}};
  return{window,document,sheet,feed,slides,slide,messages,networkCalls,jobs,
    flush(){for(let i=0;jobs.size&&i<10;i++){const pending=[...jobs.values()];jobs.clear();pending.forEach(fn=>fn());}assert.equal(jobs.size,0,'The fixture should not hide an unbounded timer');},
    visibility(hidden){document.hidden=hidden;for(const fn of [...(documentEvents.get('visibilitychange')||[])])fn();},
    frames:()=>feed.querySelectorAll('iframe')};
}

function commandNames(h,frame){return h.messages.filter(item=>item.frame===frame).map(item=>item.payload.func);}
function iframeOptions(frame){return new URL(frame.src).searchParams;}

test('the browser controller getter reuses one player for the same feed',()=>{
  const h=harness(),first=h.slide('AAAAAAAAAAA'),one=get(h.feed,h.sheet,h.window),two=get(h.feed,h.sheet,h.window);
  assert.equal(one,two);one.activate(first);const frame=first.querySelector('iframe');two.activate(first);
  assert.equal(first.querySelector('iframe'),frame);assert.equal(h.frames().length,1);assert.equal(h.networkCalls.length,0);
});

test('activating the same slide reuses its iframe and retains the existing muted autoplay options',()=>{
  const h=harness(),first=h.slide('AAAAAAAAAAA');h.slide('BBBBBBBBBBB');const player=create(h.feed,h.sheet,h.window);
  player.activate(first);const frame=first.querySelector('iframe');assert.ok(frame);
  assert.equal(new URL(frame.src).origin,'https://www.youtube-nocookie.com');assert.equal(iframeOptions(frame).get('autoplay'),'1');assert.equal(iframeOptions(frame).get('mute'),'1');
  assert.equal(frame.title,'Local fixture video');assert.equal(iframeOptions(frame).get('enablejsapi'),'1');
  player.activate(first);assert.equal(first.querySelector('iframe'),frame);assert.ok(h.frames().length<=2);
  frame.emit('load');assert.equal(commandNames(h,frame).at(-1),'playVideo');
  assert.ok(h.messages.every(item=>item.target==='https://www.youtube-nocookie.com'));assert.equal(h.networkCalls.length,0);
});

test('the next prepared slide has autoplay disabled and activation reuses the ready iframe',()=>{
  const h=harness(),first=h.slide('AAAAAAAAAAA'),next=h.slide('BBBBBBBBBBB'),player=create(h.feed,h.sheet,h.window);
  player.activate(first);player.prepare(next);const frame=next.querySelector('iframe');assert.ok(frame);
  assert.equal(iframeOptions(frame).get('autoplay'),'0');assert.equal(frame.getAttribute('loading')||frame.loading,'eager');
  frame.emit('load');assert.equal(commandNames(h,frame).at(-1),'pauseVideo');
  player.activate(next);assert.equal(next.querySelector('iframe'),frame);
  assert.equal(commandNames(h,frame).at(-1),'playVideo');assert.ok(h.frames().length<=2);assert.equal(h.networkCalls.length,0);
});

test('advancing through a feed pauses the previous active slide and keeps at most the active and next frames',()=>{
  const h=harness(),slides=['AAAAAAAAAAA','BBBBBBBBBBB','CCCCCCCCCCC','DDDDDDDDDDD'].map(id=>h.slide(id)),player=create(h.feed,h.sheet,h.window);
  player.activate(slides[0]);player.prepare(slides[1]);const original=slides[0].querySelector('iframe');original.emit('load');
  for(let i=1;i<slides.length;i++){
    player.activate(slides[i]);if(slides[i+1])player.prepare(slides[i+1]);
    assert.ok(h.frames().length<=2);assert.ok(h.frames().every(frame=>frame.parentNode===slides[i]||frame.parentNode===slides[i+1]));
  }
  assert.ok(commandNames(h,original).includes('pauseVideo'));assert.equal(original.isConnected,false);assert.equal(h.networkCalls.length,0);
  const beforeOldLoad=h.messages.length;original.emit('load');assert.equal(h.messages.length,beforeOldLoad);
});

test('hidden sheets, documents and detached slides or feeds cannot mount or start an iframe',()=>{
  for(const state of ['sheet-closed','document-hidden','slide-detached','feed-detached']){
    const h=harness(),first=h.slide('AAAAAAAAAAA'),next=h.slide('BBBBBBBBBBB'),player=create(h.feed,h.sheet,h.window);
    if(state==='sheet-closed')h.sheet.classList.remove('open');
    if(state==='document-hidden')h.document.hidden=true;
    if(state==='slide-detached'){first.remove();next.remove();}
    if(state==='feed-detached')h.feed.remove();
    player.activate(first);player.prepare(next);h.flush();assert.equal(h.frames().length,0,state);assert.equal(h.messages.length,0,state);assert.equal(h.networkCalls.length,0,state);
  }
});

test('invalid video identifiers are rejected before an iframe or playback command exists',()=>{
  for(const id of ['', 'short', 'ABCDEFGHIJKL', 'AAAA AAA AAA', 'AAAAAAAAAA!']){
    const h=harness(),slide=h.slide(id),player=create(h.feed,h.sheet,h.window);player.activate(slide);player.prepare(slide);
    assert.equal(h.frames().length,0);assert.equal(h.messages.length,0);assert.equal(h.networkCalls.length,0);
  }
});

test('pausing an active video remains paused when its iframe load event arrives later',()=>{
  const h=harness(),first=h.slide('AAAAAAAAAAA'),player=create(h.feed,h.sheet,h.window);player.activate(first);const frame=first.querySelector('iframe');
  const playedBeforePause=commandNames(h,frame).filter(name=>name==='playVideo').length;
  player.pause(first);frame.emit('load');assert.equal(commandNames(h,frame).at(-1),'pauseVideo');assert.equal(commandNames(h,frame).filter(name=>name==='playVideo').length,playedBeforePause);
  player.activate(first);assert.equal(first.querySelector('iframe'),frame);assert.equal(commandNames(h,frame).at(-1),'playVideo');assert.equal(h.networkCalls.length,0);
});

test('a load event arriving while the document is hidden does not add a play command',()=>{
  const h=harness(),first=h.slide('AAAAAAAAAAA'),player=create(h.feed,h.sheet,h.window);player.activate(first);const frame=first.querySelector('iframe');
  const earlierPlays=commandNames(h,frame).filter(name=>name==='playVideo').length;h.document.hidden=true;frame.emit('load');
  assert.equal(commandNames(h,frame).filter(name=>name==='playVideo').length,earlierPlays);assert.equal(commandNames(h,frame).at(-1),'pauseVideo');assert.equal(h.networkCalls.length,0);
});

test('close removes every feed iframe and stale iframe load events cannot restart playback',()=>{
  const h=harness(),first=h.slide('AAAAAAAAAAA'),next=h.slide('BBBBBBBBBBB'),player=create(h.feed,h.sheet,h.window);
  player.activate(first);player.prepare(next);const frames=[...h.frames()];assert.ok(frames.length>0);
  const stray=h.document.createElement('iframe');next.appendChild(stray);
  player.close();assert.equal(h.frames().length,0);assert.equal(stray.isConnected,false);
  assert.equal(player.prepare(next),false,'Close cancels the active prerequisite even before the sheet class is removed');
  h.sheet.classList.remove('open');h.flush();assert.equal(h.frames().length,0);
  const afterClose=h.messages.length;for(const frame of frames)frame.emit('load');assert.equal(h.messages.length,afterClose);
  player.prepare(next);player.activate(first);assert.equal(h.frames().length,0);assert.equal(h.networkCalls.length,0);
});
