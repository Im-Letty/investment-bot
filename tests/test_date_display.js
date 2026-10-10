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
test('compact price times use unpadded Japan dates and a padded 24-hour clock',()=>{
  assert.equal(display.price(Date.parse('2026-10-09T06:30:00Z')/1000),'株価 10/9 15:30 JST');
  assert.equal(display.price(Date.parse('2026-10-09T15:05:00Z')/1000),'株価 10/10 00:05 JST');
  assert.equal(display.price(Date.parse('2025-12-31T15:00:00Z')/1000),'株価 1/1 00:00 JST');
});
test('compact date-only prices never invent a time or timezone',()=>{
  assert.equal(display.price('2026-10-09'),'株価 10/9');
  assert.equal(display.price('2024-02-29'),'株価 2/29');
});
test('compact price labels support the caller language',()=>{
  assert.equal(display.price(Date.parse('2026-10-09T06:30:00Z')/1000,'Price'),'Price 10/9 15:30 JST');
  assert.equal(display.price('2026-10-09','주가'),'주가 10/9');
});
test('compact prices reject missing, nonpositive, nonfinite and malformed dates',()=>{
  for(const value of [null,undefined,0,-1,NaN,Infinity,-Infinity,Number.MAX_VALUE,true,'',
    '1791527400','2026-10-09T06:30:00Z','2026-02-29','2026-13-01','2026-1-01','2026-10-32']){
    assert.equal(display.price(value),'');
  }
});
