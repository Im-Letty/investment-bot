const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'../static/shareholder-benefits.js'),'utf8');
const dates=require('../static/date-display.js');
function load(rows){const context={module:{exports:{}},require(name){return name==='./date-display.js'?dates:rows;}};vm.runInNewContext(script,context);return context.module.exports;}
function fixture(changes={}){return {code:'130A',name:'Synthetic',programmeStatus:'active',programmeEffectiveFrom:'2026-09-01',programmeEffectiveUntil:'2026-09-30',schedules:[{date:'2026-09-28',record:'2026-09-30'}],...changes};}
test('generated effective windows prevent expired or premature calendar counts',()=>{
 const api=load([fixture(),fixture({code:'131A',programmeEffectiveFrom:'2026-10-01',programmeEffectiveUntil:null,schedules:[{date:'2026-10-28',record:'2026-10-30'}]}),fixture({code:'132A',programmeStatus:'abolished'}),fixture({code:'133A',programmeEffectiveFrom:'invalid'})]);
 assert.equal(api.rowsForMonth('2026-09','2026-09-25').length,1);
 assert.equal(api.rowsForMonth('2026-09','2026-10-01').length,0);assert.equal(api.rowsForMonth('2026-10','2026-10-01').length,1);
 assert.equal(api.rowsForMonth('2026-09','2026-08-01').length,0);
});
test('legacy rows retain previous behavior and explicit date input is deterministic',()=>{
 const legacy=fixture();delete legacy.programmeStatus;delete legacy.programmeEffectiveFrom;delete legacy.programmeEffectiveUntil;
 const api=load([legacy]);assert.equal(api.rowsForMonth('2026-09','2030-10-01').length,1);
});
