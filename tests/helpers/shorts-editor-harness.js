'use strict';
const assert=require('node:assert/strict');
const {create}=require('../../static/shorts-editor.js');

// This fixture never opens a real device or sends traffic. It keeps media
// events asynchronous so late permissions and recorder events exercise cleanup.
function harness(options={}){
  const urls=new Map(),revoked=[],deviceCalls=[],recorders=[],streams=[],timers=new Map(),frames=new Map();
  let document,window,nextId=0;
  class Target {
    constructor(){this.events=new Map();}
    addEventListener(type,fn,config){if(!this.events.has(type))this.events.set(type,new Map());this.events.get(type).set(fn,config||{});}
    removeEventListener(type,fn){this.events.get(type)?.delete(fn);}
    emit(type,extra={}){const event={type,target:this,currentTarget:this,preventDefault(){this.defaultPrevented=true;},stopPropagation(){},...extra};for(const [fn,config]of [...(this.events.get(type)||[])]){if(config.once)this.events.get(type).delete(fn);fn(event);}if(typeof this['on'+type]==='function')this['on'+type](event);return event;}
  }
  class Track extends Target {
    constructor(kind='video'){super();this.kind=kind;this.readyState='live';this.stops=0;this.enabled=true;}
    stop(){this.stops++;this.readyState='ended';}
    getSettings(){return{width:360,height:640,facingMode:'user'};}
  }
  class Stream extends Target {
    constructor(tracks=[new Track('video'),new Track('audio')]){super();this.tracks=[...tracks];streams.push(this);}
    getTracks(){return this.tracks;}
    getVideoTracks(){return this.tracks.filter(t=>t.kind==='video');}
    getAudioTracks(){return this.tracks.filter(t=>t.kind==='audio');}
    addTrack(track){this.tracks.push(track);}
    removeTrack(track){this.tracks=this.tracks.filter(t=>t!==track);}
  }
  class Node extends Target {
    constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.attrs={};this.style={setProperty(name,value){this[name]=value;}};this.dataset={};this.classes=new Set();this.hidden=false;this.disabled=false;this.value='';this.checked=false;this.files=[];this._text='';
      this.classList={add:(...names)=>names.forEach(n=>this.classes.add(n)),remove:(...names)=>names.forEach(n=>this.classes.delete(n)),contains:n=>this.classes.has(n),toggle:(n,on)=>{on=on===undefined?!this.classes.has(n):on;if(on)this.classes.add(n);else this.classes.delete(n);return on;}};
      if(this.tagName==='VIDEO'){this.duration=options.duration||12;this.videoWidth=360;this.videoHeight=640;this.readyState=0;this.paused=true;this.currentTime=0;this.plays=0;this.pauses=0;this.srcObject=null;this.captureStream=()=>new Stream();}
      if(this.tagName==='CANVAS'){this.getContext=()=>options.canvasContext===false?null:({clearRect(){},fillRect(){},drawImage(){},strokeText(){},fillText(){},save(){},restore(){},translate(){},scale(){},measureText:text=>({width:String(text).length*12})});if(options.canvasCapture!==false)this.captureStream=()=>new Stream([new Track('video')]);}
    }
    get ownerDocument(){return document;}get parentElement(){return this.parentNode;}get firstChild(){return this.children[0]||null;}get isConnected(){return this===document.body||!!this.parentNode?.isConnected;}
    set className(value){this.classes=new Set(String(value).split(/\s+/).filter(Boolean));}get className(){return [...this.classes].join(' ');}
    set id(value){this.attrs.id=String(value);}get id(){return this.attrs.id||'';}
    set src(value){this.attrs.src=String(value);if(options.autoExportMetadata&&this.classes.has('ks-edit-scratch'))queueMicrotask(()=>{this.readyState=4;this.emit('loadedmetadata');this.emit('loadeddata');this.emit('canplay');});}get src(){return this.attrs.src||'';}
    set textContent(value){this._text=String(value);this.children.forEach(n=>n.parentNode=null);this.children=[];}get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}
    setAttribute(name,value){this.attrs[name]=String(value);if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(value);}
    getAttribute(name){return this.attrs[name]??null;}hasAttribute(name){return name in this.attrs;}removeAttribute(name){delete this.attrs[name];}
    appendChild(child){child.parentNode?.removeChild(child);child.parentNode=this;this.children.push(child);return child;}
    insertBefore(child,before){child.parentNode?.removeChild(child);child.parentNode=this;const index=this.children.indexOf(before);this.children.splice(index<0?this.children.length:index,0,child);return child;}
    append(...children){for(const child of children)this.appendChild(child);}
    removeChild(child){const index=this.children.indexOf(child);assert.ok(index>=0);this.children.splice(index,1);child.parentNode=null;return child;}
    remove(){this.parentNode?.removeChild(this);}
    contains(child){return child===this||this.children.some(n=>n.contains(child));}
    matches(selector){return selector.split(',').some(part=>{part=part.trim();const tag=part.match(/^[a-z]+/i)?.[0];if(tag&&this.tagName!==tag.toUpperCase())return false;for(const [,cls]of part.matchAll(/\.([\w-]+)/g))if(!this.classes.has(cls))return false;for(const [,id]of part.matchAll(/#([\w-]+)/g))if(this.id!==id)return false;for(const [,name,value]of part.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g))if(value===undefined?!this.hasAttribute(name):this.getAttribute(name)!==value)return false;return true;});}
    querySelectorAll(selector){const result=[];function walk(node){for(const child of node.children){if(child.matches(selector))result.push(child);walk(child);}}walk(this);return result;}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    closest(selector){for(let node=this;node;node=node.parentNode)if(node.matches(selector))return node;return null;}
    focus(){document.activeElement=this;}
    click(){if(!this.disabled)this.emit('click');}
    play(){this.plays++;this.paused=false;this.emit('play');return Promise.resolve();}
    pause(){this.pauses++;this.paused=true;this.emit('pause');}
    load(){this.loads=(this.loads||0)+1;if(options.autoExportMetadata&&this.tagName==='VIDEO'&&!this.classes.has('ks-edit-preview')&&!this.classes.has('ks-edit-camera-preview'))queueMicrotask(()=>{this.readyState=4;this.emit('loadedmetadata');this.emit('loadeddata');this.emit('canplay');});}
    getBoundingClientRect(){return{width:360,height:640,left:0,top:0,right:360,bottom:640};}
    getClientRects(){return this.hidden?[]:[this.getBoundingClientRect()];}
  }
  class Recorder extends Target {
    static isTypeSupported(type){return options.supportedTypes===undefined?type.startsWith('video/mp4'):options.supportedTypes.includes(type);}
    constructor(stream,config={}){super();this.stream=stream;this.mimeType=config.mimeType||'video/mp4';this.state='inactive';this.stops=0;recorders.push(this);}
    start(){this.state='recording';this.emit('start');}
    stop(){if(this.state==='inactive')throw new Error('already_inactive');this.stops++;this.state='inactive';queueMicrotask(()=>{this.emit('dataavailable',{data:new Blob(['fixture recording'],{type:this.mimeType})});this.emit('stop');});}
    requestData(){this.emit('dataavailable',{data:new Blob(['fixture chunk'],{type:this.mimeType})});}
  }
  document=new Target();document.hidden=false;document.visibilityState='visible';document.createElement=tag=>new Node(tag);document.body=new Node('body');document.activeElement=document.body;document.querySelector=sel=>document.body.querySelector(sel);document.querySelectorAll=sel=>document.body.querySelectorAll(sel);document.getElementById=id=>document.body.querySelector('#'+id);
  window=new Target();Object.assign(window,{document,isSecureContext:true,location:{protocol:'https:',origin:'https://fixture.invalid',hostname:'fixture.invalid'},navigator:{mediaDevices:{getUserMedia(constraints){deviceCalls.push(constraints);return options.getUserMedia?options.getUserMedia(constraints):Promise.resolve(new Stream());}}},Blob,File,MediaStream:Stream,MediaRecorder:options.recorder===false?undefined:Recorder,URL:{createObjectURL(file){const url='blob:fixture/'+(++nextId);urls.set(url,file);return url;},revokeObjectURL(url){revoked.push(url);urls.delete(url);}},performance:{now:()=>0},setTimeout(fn,delay){const id=++nextId;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),setInterval(fn,delay){const id=++nextId;timers.set(id,{fn,delay,repeat:true});return id;},clearInterval:id=>timers.delete(id),requestAnimationFrame(fn){const id=++nextId;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),fetch(){assert.fail('Editor must not send traffic');}});
  const editor=create(window),confirmed=[],cancelled=[],statuses=[];
  function open(){return editor.open({onConfirm:(file,details)=>confirmed.push({file,details}),onCancel:()=>cancelled.push(true),onStatus:status=>statuses.push(status)});}
  function node(selector){const found=document.querySelector(selector);assert.ok(found,'Missing editor control '+selector);return found;}
  function file(name='clip.mp4',type='video/mp4'){return new File(['local fixture video'],name,{type});}
  function select(value=file()){const input=node('.ks-edit-file');input.files=[value];input.emit('change');return value;}
  function metadata(duration=12){const video=document.querySelector('.ks-edit-candidate')||node('.ks-edit-preview');video.duration=duration;video.readyState=4;video.emit('loadedmetadata');return video;}
  function hidden(){document.hidden=true;document.visibilityState='hidden';document.emit('visibilitychange');}
  return{window,document,editor,open,node,file,select,metadata,hidden,urls,revoked,deviceCalls,recorders,streams,timers,frames,confirmed,cancelled,statuses,Track,Stream};
}
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}

module.exports={harness,settle,deferred};
