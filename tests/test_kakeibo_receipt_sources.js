'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {Blob,File}=require('node:buffer');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'kakeibo.html'),'utf8');
const source=fs.readFileSync(path.join(root,'static/kakeibo-receipt-sources.js'),'utf8');

function attributes(id){
  const match=html.match(new RegExp('<([a-z][\\w-]*)\\b([^>]*\\bid="'+id+'"[^>]*)>','i'));
  assert.ok(match,'production HTML supplies '+id);
  const attrs=new Map();
  for(const attr of match[2].matchAll(/([\w-]+)(?:="([^"]*)"|='([^']*)')?/g))attrs.set(attr[1],attr[2]??attr[3]??'');
  return {tag:match[1],attrs};
}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

function fixture({readyState='complete',supported=true,modal=true,embedded=false,crossOrigin=false,playReject=false,canvasContext=true,blobThrows=false,fileThrows=false}={}){
  const docEvents=new Map(),winEvents=new Map(),mutations=[],intersections=[],pendingMutations=new Set();
  const mediaRequests=[],uploads=[],canvases=[],blobRequests=[];
  let document,context;
  class Event{
    constructor(type,options={}){this.type=type;this.defaultPrevented=false;Object.assign(this,options);}
    preventDefault(){this.defaultPrevented=true;}
  }
  function notify(target){
    for(const observer of mutations)if(observer.targets.some(entry=>entry.target===target))pendingMutations.add(observer);
  }
  class Element{
    constructor(tag,attrs=new Map()){
      this.tagName=tag.toUpperCase();this.attrs=new Map(attrs);this.children=[];this.parentNode=null;this.listeners=new Map();
      this._value='';this.files=[];this.hidden=this.attrs.has('hidden');this.open=false;this.disabled=this.attrs.has('disabled');
      this.clicks=0;this.focuses=0;this.textContent='';this.srcObject=null;this.readyState=0;this.videoWidth=0;this.videoHeight=0;
      this.playCalls=0;
      this.classList={contains:name=>(this.getAttribute('class')||'').split(/\s+/).includes(name),
        add:name=>{const names=new Set((this.getAttribute('class')||'').split(/\s+/).filter(Boolean));names.add(name);this.setAttribute('class',[...names].join(' '));},
        remove:name=>this.setAttribute('class',(this.getAttribute('class')||'').split(/\s+/).filter(item=>item&&item!==name).join(' '))};
    }
    get id(){return this.getAttribute('id')||'';}
    get value(){return this._value;}
    set value(value){this._value=String(value);if(this.getAttribute('type')==='file'&&value==='')this.files=[];}
    get parentElement(){return this.parentNode;}
    get isConnected(){return !!document&&document.documentElement.contains(this);}
    setAttribute(name,value){this.attrs.set(name,String(value));notify(this);}
    getAttribute(name){return this.attrs.get(name)??null;}
    hasAttribute(name){return this.attrs.has(name);}
    removeAttribute(name){this.attrs.delete(name);notify(this);}
    appendChild(node){node.parentNode=this;this.children.push(node);return node;}
    contains(node){return node===this||this.children.some(child=>child.contains(node));}
    matches(selector){if(selector[0]==='#')return this.id===selector.slice(1);if(selector[0]==='.')return this.classList.contains(selector.slice(1));return this.tagName===selector.toUpperCase();}
    closest(selector){for(let node=this;node;node=node.parentNode)if(node.matches(selector))return node;return null;}
    querySelector(selector){for(const child of this.children){if(child.matches(selector))return child;const nested=child.querySelector(selector);if(nested)return nested;}return null;}
    getBoundingClientRect(){return {width:500,height:500,top:0,left:0,bottom:500,right:500};}
    getClientRects(){return this.hidden?[]:[this.getBoundingClientRect()];}
    addEventListener(name,callback,options={}){this.listeners.set(name,[...(this.listeners.get(name)||[]),{callback,once:!!options.once}]);}
    removeEventListener(name,callback){this.listeners.set(name,(this.listeners.get(name)||[]).filter(entry=>entry.callback!==callback));}
    dispatchEvent(event){if(!event.target)event.target=this;for(const entry of [...(this.listeners.get(event.type)||[])]){entry.callback(event);if(entry.once)this.removeEventListener(event.type,entry.callback);}return !event.defaultPrevented;}
    click(){this.clicks++;if(!this.disabled)this.dispatchEvent(new Event('click'));}
    focus(){this.focuses++;if(document)document.activeElement=this;}
    showModal(){this.open=true;}
    close(){if(!this.open)return;this.open=false;this.dispatchEvent(new Event('close'));}
    play(){this.playCalls++;return playReject?Promise.reject(new Error('synthetic play denied')):Promise.resolve();}
  }
  const elements=new Map();
  function node(id){const {tag,attrs}=attributes(id),element=new Element(tag,attrs);elements.set(id,element);return element;}
  const documentElement=new Element('html'),body=documentElement.appendChild(new Element('body'));
  const sources=body.appendChild(node('kk-receipt-sources')),summary=sources.appendChild(new Element('summary'));
  for(const id of ['kk-receipt-album','kk-receipt-camera'])sources.appendChild(node(id));
  const album=body.appendChild(node('ocr-album-file')),nativeCamera=body.appendChild(node('ocr-file'));
  const dialog=body.appendChild(node('kk-receipt-camera-dialog'));
  for(const id of ['kk-receipt-camera-close','kk-receipt-video','kk-receipt-camera-status','kk-receipt-capture','kk-receipt-native-camera','kk-receipt-camera-album'])dialog.appendChild(node(id));
  if(!modal)dialog.showModal=undefined;
  const video=elements.get('kk-receipt-video'),capture=elements.get('kk-receipt-capture');
  function listen(events,name,callback,options={}){events.set(name,[...(events.get(name)||[]),{callback,once:!!options.once}]);}
  function emit(events,name,options={}){const event=new Event(name,options);for(const entry of [...(events.get(name)||[])]){entry.callback(event);if(entry.once)events.set(name,events.get(name).filter(item=>item!==entry));}return event;}
  document={readyState,hidden:false,visibilityState:'visible',documentElement,body,activeElement:body,
    getElementById:id=>elements.get(id)||null,querySelector:selector=>documentElement.querySelector(selector),
    addEventListener:(...args)=>listen(docEvents,...args),removeEventListener:(name,callback)=>docEvents.set(name,(docEvents.get(name)||[]).filter(entry=>entry.callback!==callback)),
    createElement(tag){
      const canvas=new Element(tag);
      if(tag==='canvas'){
        canvas.width=300;canvas.height=150;canvas.draws=[];
        canvas.getContext=()=>canvasContext?{drawImage:(...args)=>canvas.draws.push(args)}:null;
        canvas.toBlob=(callback,type,quality)=>{if(blobThrows)throw new Error('synthetic encoding failure');blobRequests.push({callback,type,quality,width:canvas.width,height:canvas.height,canvas});};
        canvases.push(canvas);
      }
      return canvas;
    }};
  const parentPage=new Element('div',new Map([['id','myPageOv'],['class','open']]));
  const parentPane=parentPage.appendChild(new Element('div',new Map([['class','mo-pane kb-pane on']])));
  const frame=parentPane.appendChild(new Element('iframe',new Map([['class','kb-frame']])));
  const parentDoc={getElementById:id=>id==='myPageOv'?parentPage:null,querySelector:selector=>parentPage.matches(selector)?parentPage:parentPage.querySelector(selector)};
  const parent={document:parentDoc,location:{origin:'https://synthetic.example'}};
  if(crossOrigin)Object.defineProperty(parent,'document',{get(){throw new Error('synthetic cross-origin denial');}});
  context={document,console,File:fileThrows?function(){throw new Error('synthetic File unsupported');}:File,Blob,Event,Promise,Date,Math,
    location:{origin:'https://synthetic.example'},isSecureContext:true,
    navigator:supported?{mediaDevices:{getUserMedia(constraints){const pending=deferred();mediaRequests.push({constraints:JSON.parse(JSON.stringify(constraints)),...pending});return pending.promise;}}}:{},
    kkT:key=>'localized '+key,kkOcrUpload:file=>uploads.push(file),
    fetch(){throw new Error('Real network is forbidden in receipt tests');},
    localStorage:{getItem(){throw new Error('Private storage is forbidden in source-choice tests');},setItem(){throw new Error('Private storage is forbidden in source-choice tests');}},
    addEventListener:(...args)=>listen(winEvents,...args),removeEventListener:(name,callback)=>winEvents.set(name,(winEvents.get(name)||[]).filter(entry=>entry.callback!==callback)),
    MutationObserver:class{constructor(callback){this.callback=callback;this.targets=[];mutations.push(this);}observe(target,options){this.targets.push({target,options});}disconnect(){this.targets=[];}},
    IntersectionObserver:class{constructor(callback){this.callback=callback;this.targets=[];intersections.push(this);}observe(target){this.targets.push(target);}disconnect(){this.targets=[];}}};
  context.window=context;context.parent=embedded||crossOrigin?parent:context;context.frameElement=embedded||crossOrigin?frame:null;
  if(crossOrigin)Object.defineProperty(context,'frameElement',{get(){throw new Error('synthetic inaccessible frame ancestor');}});
  vm.createContext(context);vm.runInContext(source,context);
  function fire(id,type,options={}){return elements.get(id).dispatchEvent(new Event(type,options));}
  function selected(input,file){input.files=file?[file]:[];input._value=file?'C:\\fakepath\\'+file.name:'';input.dispatchEvent(new Event('change'));}
  function stream(name='synthetic-camera'){
    const track={name,stops:0,listeners:new Map(),stop(){this.stops++;},addEventListener(kind,callback){this.listeners.set(kind,callback);},end(){this.listeners.get('ended')?.();}};
    return {tracks:[track],getTracks(){return this.tracks;}};
  }
  async function open(media=stream()){
    elements.get('kk-receipt-camera').click();await settle();assert.ok(mediaRequests.length,'explicit camera action requests permission');mediaRequests.at(-1).resolve(media);await settle();return media;
  }
  function ready(width=1920,height=1080,state=2){video.videoWidth=width;video.videoHeight=height;video.readyState=state;fire('kk-receipt-video','loadeddata');}
  function flushMutations(){for(const observer of [...pendingMutations]){pendingMutations.delete(observer);observer.callback([]);}}
  return {context,document,elements,sources,summary,album,nativeCamera,dialog,video,capture,mediaRequests,uploads,canvases,blobRequests,parentPage,parentPane,frame,mutations,intersections,
    click:id=>elements.get(id).click(),fire,selected,stream,open,ready,
    doc:(name,options)=>emit(docEvents,name,options),win:(name,options)=>emit(winEvents,name,options),
    flushMutations,
    intersect(target,visible){for(const observer of intersections)if(observer.targets.includes(target))observer.callback([{target,isIntersecting:visible,intersectionRatio:visible?1:0}]);},
    finishBlob(index=0,blob=new Blob(['synthetic captured pixels'],{type:'image/jpeg'})){blobRequests[index].callback(blob);return blob;}
  };
}

test('album and native capture are separate native inputs, with no duplicate inline upload handler',()=>{
  const album=attributes('ocr-album-file'),camera=attributes('ocr-file'),video=attributes('kk-receipt-video');
  for(const input of [album,camera]){assert.equal(input.tag,'input');assert.equal(input.attrs.get('type'),'file');assert.equal(input.attrs.get('accept'),'image/*');assert.equal(input.attrs.has('multiple'),false);assert.equal(input.attrs.has('onchange'),false);}
  assert.equal(album.attrs.has('capture'),false);assert.equal(camera.attrs.get('capture'),'environment');
  assert.ok(video.attrs.has('playsinline'));assert.ok(video.attrs.has('muted'));
});

test('initialization and opening the source disclosure never request media, upload, or save',async()=>{
  for(const readyState of ['loading','complete']){
    const h=fixture({readyState});if(readyState==='loading')h.doc('DOMContentLoaded');
    h.sources.open=true;await settle();assert.equal(h.mediaRequests.length,0);assert.equal(h.uploads.length,0);assert.equal(h.video.srcObject,null);assert.equal(h.dialog.open,false);
  }
});

test('explicit album/native choices reset their own inputs and permit same-file reselection; cancel does not upload',()=>{
  const h=fixture(),photo=new File(['synthetic pixels'],'receipt.jpg',{type:'image/jpeg'});
  for(const [button,input] of [['kk-receipt-album',h.album],['kk-receipt-native-camera',h.nativeCamera],['kk-receipt-camera-album',h.album]]){
    const clicks=input.clicks;h.sources.open=true;h.click(button);assert.equal(input.clicks,clicks+1);assert.equal(input.value,'');assert.equal(h.sources.open,false);assert.equal(h.mediaRequests.length,0);
    const before=h.uploads.length;h.selected(input,null);assert.equal(h.uploads.length,before);
    h.selected(input,photo);assert.equal(h.uploads.length,before+1);assert.equal(h.uploads.at(-1),photo);assert.equal(input.value,'');
    h.selected(input,photo);assert.equal(h.uploads.length,before+2);assert.equal(input.value,'');
  }
});

test('live preview requests environment-facing video with audio disabled, and uploads nothing before capture',async()=>{
  const h=fixture(),media=await h.open();assert.equal(h.mediaRequests.length,1);
  const constraints=h.mediaRequests[0].constraints;assert.equal(constraints.audio,false);assert.equal(constraints.video.facingMode.ideal,'environment');
  assert.equal(h.video.srcObject,media);assert.equal(h.video.playCalls,1);assert.equal(h.uploads.length,0);assert.equal(media.tracks[0].stops,0);
  h.click('kk-receipt-camera-close');assert.equal(media.tracks[0].stops,1);assert.equal(h.video.srcObject,null);
});

test('capture waits for a valid live frame and produces one bounded JPEG File without upscaling',async()=>{
  for(const [width,height,expected] of [[4096,3072,[2048,1536]],[720,1280,[720,1280]]]){
    const h=fixture(),media=await h.open();h.click('kk-receipt-capture');assert.equal(h.canvases.length,0);
    h.ready(width,height,1);assert.equal(h.capture.disabled,true);h.ready(0,height);assert.equal(h.capture.disabled,true);
    h.ready(width,height);assert.equal(h.capture.disabled,false);h.click('kk-receipt-capture');h.fire('kk-receipt-capture','click');
    assert.equal(h.canvases.length,1);assert.equal(h.blobRequests.length,1);assert.deepEqual([h.blobRequests[0].width,h.blobRequests[0].height],expected);
    assert.equal(h.blobRequests[0].type,'image/jpeg');assert.equal(h.blobRequests[0].quality,0.92);assert.equal(media.tracks[0].stops,1);assert.equal(h.video.srcObject,null);assert.equal(h.uploads.length,0);
    const blob=h.finishBlob();assert.equal(h.uploads.length,1);const photo=h.uploads[0];assert.ok(photo instanceof File);assert.equal(photo.name,'receipt-photo.jpg');assert.equal(photo.type,'image/jpeg');assert.equal(photo.size,blob.size);assert.equal(h.dialog.open,false);
    assert.equal(h.summary.focuses>0,true);assert.deepEqual([h.canvases[0].width,h.canvases[0].height],[1,1]);
  }
});

test('cancel before permission resolution stops the late stream and never attaches it or uploads',async()=>{
  const h=fixture();h.click('kk-receipt-camera');await settle();assert.equal(h.mediaRequests.length,1);
  const cancel=h.fire('kk-receipt-camera-dialog','cancel');assert.equal(cancel,false);
  const media=h.stream();h.mediaRequests[0].resolve(media);await settle();assert.equal(media.tracks[0].stops,1);assert.equal(h.video.srcObject,null);assert.equal(h.dialog.open,false);assert.equal(h.uploads.length,0);
});

test('a stale permission result cannot replace a newer camera request',async()=>{
  const h=fixture();h.click('kk-receipt-camera');await settle();h.click('kk-receipt-camera-close');h.click('kk-receipt-camera');await settle();assert.equal(h.mediaRequests.length,2);
  const old=h.stream('old'),current=h.stream('current');h.mediaRequests[0].resolve(old);await settle();h.mediaRequests[1].resolve(current);await settle();
  assert.equal(old.tracks[0].stops,1);assert.equal(current.tracks[0].stops,0);assert.equal(h.video.srcObject,current);assert.equal(h.uploads.length,0);h.click('kk-receipt-camera-close');
});

test('cancel or hiding after capture invalidates a delayed toBlob and cannot upload late',async()=>{
  for(const end of ['cancel','pagehide','visibilitychange']){
    const h=fixture(),media=await h.open();h.ready();h.click('kk-receipt-capture');assert.equal(h.blobRequests.length,1);
    if(end==='cancel')h.click('kk-receipt-camera-close');else if(end==='pagehide')h.win('pagehide');else{h.document.hidden=true;h.doc('visibilitychange');}
    h.finishBlob();assert.equal(h.uploads.length,0,end);assert.equal(media.tracks[0].stops,1,end);assert.equal(h.video.srcObject,null);
  }
});

test('denied or unsupported media leaves safe explicit file fallbacks and never uploads automatically',async()=>{
  const denied=fixture();denied.click('kk-receipt-camera');await settle();denied.mediaRequests[0].reject(new Error('synthetic permission denied'));await settle();
  assert.equal(denied.elements.get('kk-receipt-camera-status').getAttribute('data-i18n'),'kk_receipt_camera_unavailable');assert.equal(denied.capture.disabled,true);assert.equal(denied.uploads.length,0);assert.equal(denied.nativeCamera.clicks,0);
  denied.click('kk-receipt-native-camera');assert.equal(denied.nativeCamera.clicks,1);assert.equal(denied.uploads.length,0);
  const unsupported=fixture({supported:false});unsupported.click('kk-receipt-camera');await settle();assert.equal(unsupported.mediaRequests.length,0);assert.equal(unsupported.uploads.length,0);assert.equal(unsupported.elements.get('kk-receipt-camera-status').getAttribute('data-i18n'),'kk_receipt_camera_unavailable');
  const oldDialog=fixture({modal:false});oldDialog.click('kk-receipt-camera');await settle();assert.equal(oldDialog.nativeCamera.clicks,1);assert.equal(oldDialog.mediaRequests.length,0);assert.equal(oldDialog.uploads.length,0);
});

test('playback/canvas/encoding failure stops tracks without upload and leaves an error state',async()=>{
  const playback=fixture({playReject:true}),playMedia=await playback.open();assert.equal(playMedia.tracks[0].stops,1);assert.equal(playback.uploads.length,0);
  for(const options of [{canvasContext:false},{blobThrows:true},{}]){
    const h=fixture(options),media=await h.open();h.ready();h.click('kk-receipt-capture');if(options.canvasContext!==false&&!options.blobThrows)h.finishBlob(0,null);
    assert.equal(media.tracks[0].stops,1);assert.equal(h.uploads.length,0);assert.equal(h.elements.get('kk-receipt-camera-status').getAttribute('data-i18n'),'kk_receipt_capture_failed');
  }
});

test('unsupported File construction keeps the stopped camera safe and offers explicit recovery without uploading',async()=>{
  const h=fixture({fileThrows:true}),media=await h.open();h.ready();h.click('kk-receipt-capture');h.finishBlob();
  assert.equal(media.tracks[0].stops,1);assert.equal(h.video.srcObject,null);assert.equal(h.capture.disabled,true);assert.equal(h.uploads.length,0);
  assert.equal(h.elements.get('kk-receipt-camera-status').getAttribute('data-i18n'),'kk_receipt_capture_failed');
  h.click('kk-receipt-camera-album');assert.equal(h.album.clicks,1);assert.equal(h.dialog.open,false);assert.equal(h.uploads.length,0);
});

test('close, Escape, pagehide, document hidden, external track ending, and choosing a file stop active tracks',async()=>{
  for(const end of ['close','cancel','pagehide','hidden','ended','album']){
    const h=fixture(),media=await h.open();h.ready();
    if(end==='close')h.click('kk-receipt-camera-close');else if(end==='cancel')h.fire('kk-receipt-camera-dialog','cancel');else if(end==='pagehide')h.win('pagehide');else if(end==='hidden'){h.document.hidden=true;h.doc('visibilitychange');}else if(end==='ended')media.tracks[0].end();else h.click('kk-receipt-camera-album');
    assert.equal(media.tracks[0].stops,1,end);assert.equal(h.video.srcObject,null,end);assert.equal(h.capture.disabled,true,end);assert.equal(h.uploads.length,0,end);
  }
});

test('same-origin parent overlay/pane hiding and document intersection hiding dispose retained-frame cameras',async()=>{
  for(const hidden of ['overlay','pane','intersection']){
    const h=fixture({embedded:true}),media=await h.open();h.ready();
    if(hidden==='overlay'){h.parentPage.classList.remove('open');h.flushMutations();}
    else if(hidden==='pane'){h.parentPane.classList.remove('on');h.flushMutations();}
    else h.intersect(h.document.documentElement,false);
    assert.equal(media.tracks[0].stops,1,hidden);assert.equal(h.video.srcObject,null,hidden);assert.equal(h.dialog.open,false,hidden);assert.equal(h.uploads.length,0,hidden);
  }
});

test('hidden parent while permission is pending disposes the eventual stream and cross-origin inspection is nonblocking',async()=>{
  const h=fixture({embedded:true});h.click('kk-receipt-camera');await settle();h.parentPage.classList.remove('open');h.flushMutations();
  const media=h.stream();h.mediaRequests[0].resolve(media);await settle();assert.equal(media.tracks[0].stops,1);assert.equal(h.video.srcObject,null);assert.equal(h.uploads.length,0);
  const foreign=fixture({crossOrigin:true}),other=await foreign.open();assert.equal(foreign.video.srcObject,other);foreign.click('kk-receipt-camera-close');assert.equal(other.tracks[0].stops,1);
});
