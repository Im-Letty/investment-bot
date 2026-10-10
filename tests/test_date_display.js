'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const context={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../static/date-display.js'),'utf8'),context);
const display=context.window.KNDateDisplay;

test('timestamps use Japan time, padded dates and a 24-hour clock across midnight',()=>{
  assert.equal(display.timestamp(Date.parse('2026-10-09T15:05:00Z')/1000),'2026/10/10 00:05');
  assert.equal(display.label(Date.parse('2025-12-31T15:00:00Z')/1000,'取得',true),'2026/01/01 00:00 取得');
});
test('date-only metadata does not invent a publication time',()=>{
  assert.equal(display.label('2026-10-09','発表'),'2026/10/09 発表');
  assert.equal(display.timestamp('2026-10-09'),'');
  assert.equal(display.date('2024-02-29'),'2024/02/29');
});
test('invalid and missing metadata dates remain unavailable',()=>{
  for(const value of [null,undefined,NaN,Infinity,'','2026-02-29','2026-13-01','2026-1-01']){
    assert.equal(display.date(value),'');
    assert.equal(display.label(value,'確認'),'');
  }
});
