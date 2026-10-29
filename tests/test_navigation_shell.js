'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const shell=html.match(/<script id="kn-navigation-shell">([\s\S]*?)<\/script>/)[1];
function fixture(state='loading'){
 const listeners={},timers=[],clicks=[],buttons=['morning','home','shorts','pet','mypage'].map(action=>({getAttribute:key=>key==='data-act'?action:null,click(){clicks.push(action);}}));
 const nav={querySelectorAll:()=>buttons};const doc={readyState:state,getElementById:id=>id==='knBottomNav'?nav:null,addEventListener(type,fn){(listeners[type]??=[]).push(fn);}};
 vm.runInNewContext(shell,{document:doc,setTimeout:fn=>{timers.push(fn);}});
 function click(action){let stopped=false,prevented=false;const button=buttons.find(b=>b.getAttribute('data-act')===action),event={target:{closest:()=>button},preventDefault(){prevented=true;},stopImmediatePropagation(){stopped=true;}};listeners.click.forEach(fn=>fn(event));if(!stopped)button.click();return {stopped,prevented};}
 return {doc,listeners,timers,clicks,click,ready(){(listeners.DOMContentLoaded||[]).forEach(fn=>fn());},flush(){while(timers.length)timers.shift()();}};
}
test('all five visible destinations are static body HTML before deferred routing and the video entry is labelled for accessibility',()=>{
 const body=html.indexOf('<body'),nav=html.match(/<nav id="knBottomNav"[\s\S]*?<\/nav>/)[0],offset=html.indexOf(nav);
 assert.ok(offset>body&&offset<html.indexOf('id="sideDrawer"'));
 const buttons=[...nav.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].filter(m=>!m[1].includes('display:none'));
 assert.deepEqual(buttons.map(m=>m[1].match(/data-act="([^"]+)"/)[1]),['morning','home','shorts','pet','mypage']);
 assert.match(nav,/id="knShortsBtn"[^>]*aria-label="動画"/);assert.doesNotMatch(buttons[2][2],/ショート|bn-label/);
 assert.equal((html.match(/<nav id="knBottomNav"/g)||[]).length,1);
 assert.match(html,/#knBottomNav\{display:flex!important\}/);assert.match(html,/body:has\(#spl:not\(\.done\),#knWelcomeOv\.open:not\(\.kn-entry-leaving\)\) #knBottomNav\{visibility:hidden;pointer-events:none\}/);
});
test('a tap before controllers initialize does not partly navigate and only the last intent is replayed after all DOM ready listeners',()=>{
 const h=fixture();assert.deepEqual(h.click('pet'),{stopped:true,prevented:true});h.click('mypage');assert.deepEqual(h.clicks,[]);
 h.ready();assert.deepEqual(h.clicks,[],'routing waits until the DOM-ready event dispatch finishes');h.flush();assert.deepEqual(h.clicks,['mypage']);
 h.click('shorts');assert.deepEqual(h.clicks,['mypage','shorts']);h.flush();assert.equal(h.clicks.length,2);
});
test('a ready document releases safely without a queued tap and does not synthesize navigation',()=>{
 const h=fixture('complete');h.flush();assert.deepEqual(h.clicks,[]);assert.deepEqual(h.click('morning'),{stopped:false,prevented:false});assert.deepEqual(h.clicks,['morning']);
});
test('the MyPage menu uses the same fixed morning/video coordinate instead of adding its tab spacing',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../static/mypage-theme.css'),'utf8'),home=fs.readFileSync(path.join(__dirname,'../static/home-a.css'),'utf8');
 assert.doesNotMatch(css,/#knFloatHam\s*\{[^}]*top:\s*calc\([^}]*mypage-top-space/);
 assert.match(home,/#knFloatHam\s*\{\s*top:var\(--kn-a-header-top\)!important;\s*left:var\(--kn-a-menu-left\)!important/);
});
