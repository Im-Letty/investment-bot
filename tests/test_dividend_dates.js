const test=require('node:test');const assert=require('node:assert/strict');const dates=require('../static/dividend-dates.js');
const now=Date.parse('2026-09-24T15:00:00Z');
test('past cached dates cannot be displayed as the next event',()=>{
 assert.equal(dates.classify('2026-03-30',now).state,'past');
 assert.equal(dates.describe('2026-03-30',now),'次回未確認（過去の記録：2026/03/30）');
});
test('Japan midnight rolls yesterday into past while today remains scheduled',()=>{
 assert.equal(dates.classify('2026-09-24',now-1).state,'current');
 assert.equal(dates.classify('2026-09-24',now).state,'past');
 assert.equal(dates.describe('2026-09-25',now),'2026/09/25（本日の予定）');
 assert.equal(dates.describe('2026-09-28',now),'2026/09/28（予定）');
});
test('missing and invalid dates remain unconfirmed, never invented',()=>{
 for(const value of [null,undefined,'','2026-02-30','2026-13-01','<script>'])assert.equal(dates.describe(value,now),'次回未確認');
});
test('month-only payment schedules retain their actual precision',()=>{
 assert.equal(dates.describe('2026-09',now,true),'2026/09（今月の予定）');
 assert.equal(dates.describe('2026-03',now,true),'次回未確認（過去の記録：2026/03）');
 assert.equal(dates.describe('2026-12',now,true),'2026/12（予定）');
});
