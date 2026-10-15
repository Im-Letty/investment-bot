'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
function fixture({embedded=false,helper,result=true,otherOrigin=false,throwOnOrigin=false}={}){
  const events={},calls=[];let prevented=0;
  const attrs={href:'/',target:'_top'};
  const back={getAttribute:name=>attrs[name]??null,setAttribute:(name,value)=>attrs[name]=String(value),matches:selector=>selector==='.back-btn',closest:selector=>selector==='.back-btn'?back:null};
  const doc={body:{setAttribute(){}},getElementById:()=>null,querySelector:selector=>selector==='.back-btn'?back:null,querySelectorAll:()=>[],addEventListener:(name,fn)=>events[name]=fn};
  const context={document:doc,location:{origin:'https://local.test'},console};context.window=context;context.parent=context;context.top=context;
  if(embedded){
    const parent={location:{origin:otherOrigin?'https://foreign.test':'https://local.test'}};
    if(throwOnOrigin)Object.defineProperty(parent,'location',{get(){throw Error('cross origin');}});
    if(helper!==false)parent.knReturnFromLedger=source=>{calls.push(source);if(helper==='throws')throw Error('parent unavailable');return result;};
    context.parent=parent;context.top=parent;
  }
  vm.runInNewContext(read('static/kakeibo-layout.js'),context);
  const childWindow=vm.runInNewContext('window',context);
  return {context,childWindow,back,calls,click({nested=false}={}){const target=nested?{closest:selector=>selector==='.back-btn'?back:null}:back;events.click({target,preventDefault(){prevented++;}});return prevented;}};
}
test('back link has a native top-level home fallback and updated layout cache version',()=>{
  const html=read('kakeibo.html'),back=html.match(/<a\b[^>]*class="[^"]*\bback-btn\b[^\"]*"[^>]*>/)?.[0];
  assert.ok(back);assert.match(back,/\bhref="\/"/);assert.match(back,/\btarget="_top"/);
  assert.match(html,/kakeibo-layout\.js\?v=20261015-homegraphs1/);
});
test('standalone and unsupported-parent back clicks keep the native top-level home fallback',()=>{
  for(const options of [{},{embedded:true,helper:false}]){
    const h=fixture(options);assert.equal(h.click(),0);assert.deepEqual(h.calls,[]);
  }
});
test('a managed same-origin back click delegates this child window and prevents navigation only after accepted return',()=>{
  const h=fixture({embedded:true});assert.equal(h.click({nested:true}),1);assert.equal(h.calls.length,1);assert.equal(h.calls[0],h.childWindow);
});
test('a rejected or failing managed return retains the native fallback',()=>{
  for(const options of [{embedded:true,result:false},{embedded:true,result:null},{embedded:true,result:1},{embedded:true,result:'true'},{embedded:true,helper:'throws'}]){
    const h=fixture(options);assert.equal(h.click(),0);assert.equal(h.calls.length,1);
  }
});
test('foreign or inaccessible parent is never called and leaves the native fallback intact',()=>{
  for(const options of [{embedded:true,otherOrigin:true},{embedded:true,throwOnOrigin:true}]){
    const h=fixture(options);assert.equal(h.click(),0);assert.equal(h.calls.length,0);
  }
});
