'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),factory=require('../static/shorts-details.js'),fs=require('node:fs'),path=require('node:path');
function fixture({late=false}={}){
 let doc,panel;const observers=[],actions=[],nodes=[];
 class Node{
  constructor(tag){this.tagName=tag;this.children=[];this.parentNode=null;this.attrs={};this.events={};this.hidden=false;this._text='';this.scrollTop=0;this.className='';nodes.push(this);this.classList={contains:c=>this.className.split(' ').includes(c)};}
  set id(x){this.attrs.id=x;}get id(){return this.attrs.id||'';}
  set textContent(x){this._text=String(x);this.children=[];}get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}
  setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k]??null;}
  appendChild(n){n.parentNode=this;this.children.push(n);return n;}insertBefore(n,b){if(!b)return this.appendChild(n);n.parentNode=this;this.children.splice(this.children.indexOf(b),0,n);return n;}
  contains(n){return this===n||this.children.some(c=>c.contains(n));}replaceChildren(){this.children.forEach(c=>c.parentNode=null);this.children=[];this._text='';}
  querySelectorAll(sel){const out=[],matches=n=>sel.startsWith('#')?n.id===sel.slice(1):sel.startsWith('.')?n.className.split(' ').includes(sel.slice(1)):n.tagName===sel;const walk=n=>n.children.forEach(c=>{if(matches(c))out.push(c);walk(c);});walk(this);return out;}querySelector(sel){return this.querySelectorAll(sel)[0]||null;}
  addEventListener(type,fn){(this.events[type]??=[]).push(fn);}click(){(this.events.click||[]).forEach(fn=>fn({target:this}));}focus(){doc.activeElement=this;}
 }
 doc={activeElement:null,body:new Node('body'),createElement:t=>new Node(t),getElementById:id=>doc.body.querySelector('#'+id),addEventListener(){}};
 const sheet=new Node('section');sheet.id='knShorts';sheet.className='open';const header=new Node('div');header.className='ks-top';sheet.appendChild(header);const close=new Node('button');close.id='ksClose';header.appendChild(close);const feed=new Node('div');feed.id='ksFeed';sheet.appendChild(feed);
 Object.defineProperty(feed,'clientHeight',{get:()=>{var p=doc.getElementById('ksDetailsPanel');return !p||p.hidden?600:(p.children.length?400:550);}});
 if(!late)doc.body.appendChild(sheet);
 const w={document:doc,MutationObserver:class{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}},KNShortsSharing:{share:b=>actions.push(['share',b])}};
 const api=factory(w);
 function slide(id,title){const n=new Node('div');n.className='ks-slide';n.setAttribute('data-vid',id);const meta=new Node('div');meta.className='ks-meta';const cap=new Node('div');cap.className='ks-cap';cap.textContent=title;meta.appendChild(cap);n.appendChild(meta);feed.appendChild(n);return n;}
 function original(n,cls,label){const b=new Node('button');b.className=cls;b.textContent=label;b.setAttribute('aria-label',label);b.addEventListener('click',()=>{actions.push([cls,n]);b.setAttribute('aria-pressed',b.getAttribute('aria-pressed')==='true'?'false':'true');});n.appendChild(b);return b;}
 return {w,doc,sheet,header,feed,api,actions,observers,slide,original,lateMount(){doc.body.appendChild(sheet);observers[0].fn();},panel:()=>doc.getElementById('ksDetailsPanel'),trigger:()=>doc.getElementById('ksInfoBtn')};
}
test('information is a separate sibling row and opening it keeps the selected video while its stage changes height',()=>{
 const h=fixture();const a=h.slide('abcdefghijk','first'),b=h.slide('lmnopqrstuv','second');h.api.mount();h.feed.scrollTop=600;
 h.trigger().click();assert.equal(h.panel().hidden,false);assert.equal(h.panel().parentNode,h.sheet);assert.equal(h.feed.contains(h.panel()),false);assert.equal(h.feed.scrollTop,400);assert.match(h.panel().textContent,/second/);assert.equal(h.api.current(),b);
 h.api.toggle(false,true);assert.equal(h.feed.scrollTop,600);assert.equal(h.panel().hidden,true);assert.equal(h.doc.activeElement,h.trigger());assert.equal(a.parentNode,h.feed);
});
test('title and author remain literal text and only fixed validated source identities form links',()=>{
 const h=fixture(),n=h.slide('abcdefghijk','<img onerror=bad>');const c=h.doc.createElement('span');c.className='ks-creator-name';c.textContent='Creator <script>';n.appendChild(c);h.api.mount();h.trigger().click();
 assert.match(h.panel().textContent,/<img onerror=bad>/);assert.equal(h.panel().querySelectorAll('img').length,0);assert.equal(h.panel().querySelector('a').href,'https://www.youtube.com/watch?v=abcdefghijk');assert.equal(h.panel().querySelector('a').rel,'noopener noreferrer');
 n.setAttribute('data-vid','id?private=secret');assert.equal(h.api.describe(n).url,null);
 n.setAttribute('data-media-type','upload');n.setAttribute('data-post-id','51');assert.equal(h.api.describe(n).url,'/shorts/51');n.setAttribute('data-post-id','9007199254740993');assert.equal(h.api.describe(n).url,null);
});
test('save and follow invoke current original handlers and refresh without losing keyboard focus',()=>{
 const h=fixture(),n=h.slide('abcdefghijk','one');h.original(n,'ks-save','動画を保存');h.original(n,'ks-follow-toggle','フォロー');h.api.mount();h.trigger().click();
 let save=h.panel().querySelectorAll('button').find(b=>b.getAttribute('data-details-action')==='.ks-save');save.focus();save.click();assert.equal(h.actions[0][0],'ks-save');assert.equal(h.doc.activeElement.getAttribute('data-details-action'),'.ks-save');assert.match(h.panel().textContent,/保存済み/);
 h.panel().querySelectorAll('button').find(b=>b.getAttribute('data-details-action')==='.ks-follow-toggle').click();assert.equal(h.actions[1][0],'ks-follow-toggle');assert.equal(h.actions.length,2);
});
test('sharing uses the visible information control for focus return and copies only the existing validated identity fields',()=>{
 const h=fixture(),n=h.slide('abcdefghijk','one'),share=h.original(n,'ks-share-button','共有');share.setAttribute('data-share-provider','youtube');share.setAttribute('data-video-id','abcdefghijk');share.setAttribute('data-share-title','one');h.api.mount();h.trigger().click();
 const b=h.panel().querySelectorAll('button').find(b=>b.getAttribute('data-details-action')==='.ks-share-button');b.click();assert.equal(h.actions[0][0],'share');assert.equal(h.actions[0][1],b);assert.equal(h.panel().contains(b),true,'sharing keeps its visible origin connected while the dialog is active');assert.equal(b.getAttribute('data-video-id'),'abcdefghijk');assert.equal(h.actions.length,1);
});
test('late shell creation is discovered once, close clears information and does not create new media or storage operations',()=>{
 const h=fixture({late:true});h.slide('abcdefghijk','one');assert.equal(h.api.mount(),false);h.lateMount();assert.equal(h.observers[0].disconnected,true);h.api.mount();assert.equal(h.header.querySelectorAll('#ksInfoBtn').length,1);h.trigger().click();h.sheet.className='';h.observers.at(-1).fn();assert.equal(h.panel().hidden,true);assert.equal(h.feed.querySelectorAll('iframe').length,0);assert.deepEqual(h.actions,[]);
});
test('app toolbar and information cannot paint over the provider picture, and full-stage media stays contained',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../static/shorts-viewport.css'),'utf8');assert.match(css,/\.ks-top\s*\{\s*position:relative/);assert.match(css,/\.ks-slide > :is\(iframe,video,\.ks-ph\)[\s\S]*?height:100%!important;\s*object-fit:contain;transform:none/);assert.match(css,/\.ks-slide > :is\(\.ks-meta,\.ks-save,\.ks-feed-share\) \{display:none!important\}/);assert.doesNotMatch(css,/clip-path|scale\(|translate\(|zoom:/);
});
