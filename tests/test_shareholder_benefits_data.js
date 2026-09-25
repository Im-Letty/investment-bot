const {test}=require('node:test');
const assert=require('node:assert/strict');
const data=require('../static/shareholder-benefits-data.js');
const byCode=code=>data.find(p=>p.code===code);
test('reviewed programmes have unique identities and sourced planned dates',()=>{
 assert.equal(new Set(data.map(p=>p.code)).size,data.length);
 for(const p of data){
  assert.match(p.code,/^\d{4}$/);assert.match(p.url,/^https:\/\//);assert.equal(p.verified,'2026-09-25');
  assert.ok(p.reward&&p.shares&&p.conditions&&p.period);
  const seen=new Set();for(const s of p.schedules){
   assert.ok(!seen.has(s.date));seen.add(s.date);
   assert.equal(new Date(s.date+'T00:00:00Z').toISOString().slice(0,10),s.date);
   assert.ok(s.date<s.record);assert.equal(s.status,'planned');assert.equal(s.basis,'現行制度に基づく予定');
   assert.match(s.source,/^https:\/\//);assert.match(s.holdUntil,new RegExp(s.date.replaceAll('-','/')));
   assert.ok(s.delivery&&s.grant);
  }
 }
});
test('2026 share splits use current lowest-share tiers and discontinued programmes are excluded',()=>{
 assert.equal(byCode('3563').reward,'食事優待1,100円分');
 assert.equal(byCode('8267').reward,'対象の買い物が1%還元');
 assert.equal(byCode('8252'),undefined);
 assert.equal(byCode('9433').schedules.length,0);
 assert.ok(byCode('9202').schedules.every(s=>s.record==='2026-09-30'));
});
test('company record dates stay distinct from non-trading month-end settlement dates',()=>{
 const december=byCode('3197').schedules[0];assert.equal(december.record,'2026-12-31');assert.equal(december.date,'2026-12-28');
 const february=byCode('8267').schedules[0];assert.equal(february.record,'2027-02-28');assert.equal(february.date,'2027-02-24');
 assert.ok(data.filter(p=>p.schedules.some(s=>s.date==='2026-09-28')).length>1);
});
