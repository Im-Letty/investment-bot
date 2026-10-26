'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../kakeibo.html'),'utf8');
test('adopted planner stays active without a calendar design chooser or saved-style reader',()=>{
 const section=html.slice(html.indexOf('<div class="tab-content" id="tab-calendar"'),html.indexOf('<div class="modal-overlay" id="dayModal"'));
 assert.match(section,/data-calendar-design="planner"/);
 assert.match(html,/<link[^>]+kakeibo-calendar-designs\.css/);
 assert.doesNotMatch(section,/kk-calendar-designs|data-kk-calendar-design/);
 assert.doesNotMatch(html,/<script[^>]+kakeibo-calendar-designs\.js/);
});
