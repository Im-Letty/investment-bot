const {test}=require('node:test');
const assert=require('node:assert/strict');
const data=require('../static/shareholder-benefits-data.js');
const legacy=require('../benefits-data/legacy-nine.json');
const byCode=code=>data.find(p=>p.code===code);
test('reviewed programmes have unique identities and sourced planned dates',()=>{
 assert.equal(new Set(data.map(p=>p.code)).size,data.length);
 for(const p of data){
  assert.match(p.code,/^[0-9][A-Z0-9]{3}$/);assert.match(p.url,/^https:\/\//);
  assert.match(p.verified,/^\d{4}-\d{2}-\d{2}$/);
  assert.equal(new Date(p.verified+'T00:00:00Z').toISOString().slice(0,10),p.verified);
  assert.ok(p.verified<=new Date(Date.now()+9*3600000).toISOString().slice(0,10));
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
test('expansion preserves every previously reviewed programme and schedule exactly',()=>{
 for(const row of legacy)assert.deepEqual(byCode(row.code),row);
});
test('new official facts keep share and holding tiers without fabricated trade dates',()=>{
 const komeda=byCode('3543');assert.match(komeda.reward,/1,000円/);
 assert.equal(komeda.tiers.length,3);assert.match(komeda.tiers[2].holding_requirement,/7回/);
 assert.doesNotMatch(komeda.tiers[2].holding_requirement,/100株以上/);
 assert.match(komeda.tiers[2].conditions,/判定時点で300株/);
 const restaurants=byCode('3387');assert.match(restaurants.reward,/1,500円/);
 assert.equal(restaurants.tiers.length,15);assert.match(restaurants.conditions,/旧SFP.*引き継ぎません/);
 assert.match(byCode('9979').reward,/3,000円/);assert.equal(byCode('9979').tiers.length,3);
 const dydo=byCode('2590');assert.match(dydo.holding,/半年/);assert.match(dydo.delivery,/6月下旬/);
 assert.equal(dydo.url,'https://holdings.dydo.co.jp/');assert.match(dydo.conditions,/優待価格販売.*合算していません/);
 assert.match(byCode('2809').delivery,/2027年3月6日/);assert.equal(byCode('2809').tiers.length,4);
 for(const code of ['3543','3387','9979','2590','2809']){
  const row=byCode(code);assert.equal(row.programmeVerified,'2026-10-17');assert.equal(row.schedules.length,0);
  assert.equal(row.programmeStatus,'active');assert.deepEqual(Object.keys(row.programmeSource).sort(),['title','url','verified_on']);
  assert.ok(row.tiers.every(t=>t.holding_months_min!==0));
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
