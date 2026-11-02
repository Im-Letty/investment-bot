'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const Step=require('../static/pet-still-step.js');
test('whole-artwork stepping is pure, deterministic and explicitly Milne-only',()=>{
 const math=Object.create(Math);math.random=()=>assert.fail('no random phase');
 const context={Math:math,Date:class{constructor(){assert.fail('no clock');}static now(){assert.fail('no clock');}},setTimeout(){assert.fail('no timer');},fetch(){assert.fail('no network');}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../static/pet-still-step.js'),'utf8'),context);
 const metadata=Object.freeze({characterId:'milne',presentation:'static-front',stillStep:true});
 assert.equal(Step.enabled(metadata),true);assert.equal(Object.isFrozen(Step),true);
 for(const other of [null,{}, {...metadata,characterId:'lilac'},{...metadata,presentation:'rig'},{...metadata,stillStep:'true'},{...metadata,stillStep:false}])assert.equal(Step.enabled(other),false);
 assert.deepEqual(JSON.parse(JSON.stringify(context.PetStillStep.pose(.08,1.2,true,false))),Step.pose(.08,1.2,true,false));
});
test('accepted distance alone determines bounded upward bob and roll without scaling or source edits',()=>{
 let changed=0;for(let i=0;i<200;i++){
  const p=Step.pose(i/137,1.2,true,false);assert.equal(p.active,true);assert.ok(p.bob>=0&&p.bob<=.024+1e-12);assert.ok(Math.abs(p.roll)<=.035);assert.equal(Object.isFrozen(p),true);
  assert.deepEqual(p,Step.pose(i/137,1.2,true,false));assert.deepEqual(Object.keys(p),['active','bob','roll']);if(p.bob>0)changed++;
 }assert.ok(changed>180);assert.ok(Step.pose(.08,100,true,false).bob<=Step.limits.maxBob);
});
test('stopping, reduced motion and malformed distance or frame height return neutral',()=>{
 const neutral={active:false,bob:0,roll:0};
 for(const args of [[.08,1.2,false,false],[.08,1.2,true,true],[-1,1.2,true,false],[NaN,1.2,true,false],[Infinity,1.2,true,false],[.08,NaN,true,false],[.08,0,true,false]])assert.deepEqual(Step.pose(...args),neutral);
 assert.deepEqual(Step.pose(.08,1.2,true),Step.pose(.08,1.2,true,false));
});
