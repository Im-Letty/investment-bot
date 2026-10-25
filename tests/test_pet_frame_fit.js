'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Fit = require('../static/pet-frame-fit.js');
const fs = require('node:fs');
const vm = require('node:vm');

test('the same helper registers in the browser global used by lazy module imports', () => {
  const context=vm.createContext({});vm.runInContext(fs.readFileSync(require.resolve('../static/pet-frame-fit.js'),'utf8'),context);
  const result=context.PetFrameFit.resolve({tagName:'IMG',complete:true,naturalWidth:512,naturalHeight:512});
  assert.equal(result.anchor,.08);assert.equal(result.worldHeight,Fit.worldHeight);assert.equal(Object.isFrozen(context.PetFrameFit),true);
});

test('only finite positive canvas or loaded natural-image dimensions define a frame', () => {
  for (const width of [0,-1,Infinity,NaN,undefined,'512',.5,Number.MAX_SAFE_INTEGER+1]) {
    assert.equal(Fit.sourceSize({tagName:'CANVAS',width,height:512}),null);
    assert.equal(Fit.sourceSize({tagName:'IMG',complete:true,naturalWidth:width,naturalHeight:512}),null);
  }
  assert.equal(Fit.sourceSize({tagName:'IMG',complete:false,naturalWidth:512,naturalHeight:512}),null);
  assert.equal(Fit.sourceSize({tagName:'DIV',width:512,height:512}),null);
  assert.deepEqual(Fit.sourceSize({tagName:'IMG',complete:true,width:1,height:1,naturalWidth:900,naturalHeight:600}),{width:900,height:600});
});

test('the shared fitted contact remains on the floor across aspect ratios and explicit framing changes', () => {
  const source={tagName:'CANVAS',width:512,height:512};let previous=null;
  for (const [width,height,anchor] of [[512,512,.08],[384,512,.2],[768,384,.4],[128,256,0],[512,512,1]]) {
    source.width=width;source.height=height;const frame=Fit.resolve(source,{anchor},previous);
    assert.equal(frame.changed,true);assert.equal(frame.worldHeight,1.65);assert.equal(frame.worldWidth,1.65*width/height);
    assert.equal((anchor-frame.anchor)*frame.worldHeight,0,'the source foot maps to the world ground');previous=frame;
  }
  assert.equal(Fit.resolve(source,{anchor:1},previous).changed,false);
});

test('ordinary animated frames reuse one foot scan and preserve motion instead of chasing alpha', () => {
  let scans=0;const source={tagName:'CANVAS',width:16,height:16,getContext:()=>({RGBA:1,UNSIGNED_BYTE:2,readPixels(x,y,w,h,a,b,p){scans++;p[(3*w+5)*4+3]=255;}})};
  let previous=Fit.resolve(source);assert.equal(previous.anchor,3/16);assert.equal(scans,1);
  for (let i=0;i<20;i++){const next=Fit.resolve(source,null,previous);assert.equal(next.anchor,3/16);assert.equal(next.changed,false);previous=next;}
  source.width=32;const resized=Fit.resolve(source,null,previous);assert.equal(resized.changed,true);assert.equal(resized.anchor,3/16);assert.equal(scans,1);
  const reframed=Fit.resolve(source,{anchor:.3},resized);assert.equal(reframed.anchor,.3);assert.equal(scans,1);
});

test('invalid explicit metadata cannot fall back to the prior contact or trigger a scan', () => {
  let scans=0;const source={tagName:'CANVAS',width:16,height:16,getContext(){scans++;throw Error('must not scan invalid contact');}};
  const before={source,width:16,height:16,anchor:.2};
  for (const anchor of [-.01,1.01,NaN,Infinity,'0.2',undefined]) assert.equal(Fit.resolve(source,{anchor},before),null);
  assert.equal(scans,0);assert.equal(before.anchor,.2);
});

test('the loaded-image fallback keeps its existing normalized foot without reading pixels', () => {
  const image={tagName:'IMG',complete:true,naturalWidth:300,naturalHeight:200,getContext(){throw Error('image must not be scanned');}};
  const frame=Fit.resolve(image);assert.equal(frame.anchor,.08);assert.equal(frame.worldWidth,2.475);
  assert.equal(Fit.resolve({...image,complete:false}),null);
});
