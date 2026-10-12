'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../static/community-moderation.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];

function harness(){
  class Element{
    constructor(tag){this.tagName=tag;this.children=[];this.listeners={};this.attributes={};this.dataset={};this.textContent='';this.value='';this.hidden=false;this.disabled=false;}
    append(...nodes){this.children.push(...nodes);}
    replaceChildren(...nodes){this.children=nodes;}
    setAttribute(key,value){this.attributes[key]=value;}
    getAttribute(key){return this.attributes[key];}
    addEventListener(name,listener){this.listeners[name]=listener;}
    dispatch(name){if(this.disabled)return;return this.listeners[name]&&this.listeners[name]({preventDefault(){}});}
    click(){return this.dispatch('click');}
  }
  const ids={};
  for(const id of ['reports','status','password','filters','openReports','resolvedReports','moreReports','login','leave','reportScope'])ids[id]=new Element(id==='password'?'input':'div');
  ids.filters.hidden=true;
  ids.moreReports.hidden=true;
  const calls=[],pending=[],events={};
  const document={getElementById:id=>ids[id],createElement:tag=>new Element(tag)};
  const window={addEventListener:(event,handler)=>{events[event]=handler;}};
  const fetch=(url,options)=>{calls.push({url,options});return new Promise((resolve,reject)=>pending.push({url,options,resolve,reject}));};
  vm.runInNewContext(script,{document,window,fetch,Array});
  async function settle(){for(let i=0;i<8;i++)await Promise.resolve();}
  async function response(value,status=200,index=0){assert.ok(pending[index],'request is pending');pending.splice(index,1)[0].resolve({ok:status<400,status,json:async()=>value});await settle();}
  function descendants(node){return node.children.flatMap(child=>[child,...descendants(child)]);}
  function buttons(){return descendants(ids.reports).filter(node=>node.tagName==='button');}
  function button(copy){const found=buttons().find(node=>node.textContent===copy);assert.ok(found,'button '+copy+' exists');return found;}
  function text(node=ids.reports){return node.textContent+node.children.map(child=>text(child)).join('');}
  function login(){ids.password.value='fixture-admin';ids.login.dispatch('submit');}
  return {ids,calls,pending,events,response,settle,buttons,button,text,login};
}
function report(overrides={}){return {id:1,post_id:9,reason:'spam',created_at:'2026-10-12T00:00:00Z',resolved_at:null,post:{id:9,name:'公開ニックネーム',body:'ローカルの確認用本文',hidden:false,deleted:false,...overrides}};}
function result(status,reports,has_more=false,next_cursor=null){return {ok:true,status,reports,has_more,next_cursor};}

test('manager remains idle until explicit login and never puts secret in URL or storage',async()=>{
  const h=harness();h.ids.resolvedReports.click();assert.equal(h.calls.length,0);assert.equal(h.ids.filters.hidden,true);
  h.login();assert.equal(h.ids.password.value,'');assert.equal(h.ids.filters.hidden,false);
  assert.equal(h.calls[0].url,'/api/community/moderation/reports?status=open');
  assert.equal(h.calls[0].options.headers['X-Admin-Pass'],'fixture-admin');
  assert.equal(h.calls[0].options.body,undefined);assert.equal(h.calls[0].options.cache,'no-store');
  await h.response(result('open',[]));assert.match(h.ids.status.textContent,/未対応の通報はありません/);
  assert.match(html,/<nav[^>]+id="filters"[^>]+hidden>/);
  assert.doesNotMatch(script,/localStorage|sessionStorage|document\.cookie/);
});

test('hidden handled report stays reachable and restores through the existing protected action',async()=>{
  const h=harness();h.login();await h.response(result('open',[report()]));
  h.button('非表示にする').click();assert.equal(h.calls.at(-1).url,'/api/community/posts/9/moderate');
  assert.equal(h.calls.at(-1).options.body,'{"hidden":true}');
  await h.response({ok:true});await h.response(result('open',[]));
  h.ids.resolvedReports.click();assert.equal(h.calls.at(-1).url,'/api/community/moderation/reports?status=resolved');
  await h.response(result('resolved',[report({hidden:true})]));
  assert.match(h.text(),/現在は非表示/);assert.equal(h.ids.resolvedReports.getAttribute('aria-pressed'),'true');
  h.button('公開に戻す').click();assert.equal(h.calls.at(-1).options.body,'{"hidden":false}');
  assert.equal(h.calls.at(-1).options.headers['X-Admin-Pass'],'fixture-admin');
  await h.response({ok:true});await h.response(result('resolved',[report()]));
  assert.match(h.text(),/現在は公開/);assert.equal(h.buttons().some(node=>node.textContent==='公開に戻す'),false);
  assert.equal(h.calls.some(call=>call.url.includes('fixture-admin')||call.options.body&&call.options.body.includes('fixture-admin')),false);
});

test('owner-deleted post never offers publish restore, even in handled history',async()=>{
  const h=harness();h.login();await h.response(result('open',[report({hidden:true,deleted:true})]));
  assert.match(h.text(),/公開には戻せません/);assert.deepEqual(h.buttons().map(node=>node.textContent),['対応済みにする']);
  h.ids.resolvedReports.click();await h.response(result('resolved',[report({hidden:true,deleted:true})]));
  assert.equal(h.buttons().length,0);
});

test('switching report status cannot be overwritten by an older pending request',async()=>{
  const h=harness();h.login();h.ids.resolvedReports.click();assert.equal(h.pending.length,2);
  await h.response(result('resolved',[report({hidden:true})]),200,1);
  assert.match(h.text(),/現在は非表示/);
  await h.response(result('open',[report({name:'古い応答'})]),200,0);
  assert.doesNotMatch(h.text(),/古い応答/);assert.equal(h.ids.resolvedReports.getAttribute('aria-pressed'),'true');
});

test('auth and database failure do not render a false empty history',async()=>{
  const h=harness();h.login();await h.response({ok:false,reason:'forbidden'},403);
  assert.match(h.ids.status.textContent,/管理パスワードを確認/);assert.equal(h.ids.reports.children.length,0);
  h.ids.resolvedReports.click();await h.response({ok:false,reason:'storage_unavailable'},503);
  assert.match(h.ids.status.textContent,/読み込みに失敗/);assert.doesNotMatch(h.ids.status.textContent,/通報はありません/);
});

test('leave clears private UI, and in-flight actions do not reload using a cleared secret',async()=>{
  const h=harness();h.login();await h.response(result('open',[report()]));h.button('非表示にする').click();
  h.ids.leave.click();assert.equal(h.ids.filters.hidden,true);assert.equal(h.ids.reports.children.length,0);
  const calls=h.calls.length;await h.response({ok:true});assert.equal(h.calls.length,calls);
  assert.match(h.ids.status.textContent,/終了しました/);
});

test('pagehide makes a previously pending report response inert',async()=>{
  const h=harness();h.login();h.events.pagehide();await h.response(result('open',[report()]));
  assert.equal(h.ids.reports.children.length,0);
});

test('pagehide also clears already visible private report content before browser history caching',async()=>{
  const h=harness();h.login();await h.response(result('open',[report({hidden:true})]));
  assert.equal(h.ids.reports.children.length,1);h.events.pagehide();
  assert.equal(h.ids.reports.children.length,0);assert.equal(h.ids.filters.hidden,true);assert.equal(h.ids.moreReports.hidden,true);
  h.ids.resolvedReports.click();assert.equal(h.calls.length,1);
});

test('report content stays text, while duplicate action clicks are disabled',async()=>{
  const h=harness();h.login();await h.response(result('open',[report({body:'<img src=x onerror=unsafe()>'})]));
  assert.match(h.text(),/<img src=x onerror=unsafe\(\)>/);
  assert.equal(h.ids.reports.children[0].children.some(node=>node.tagName==='img'),false);
  const b=h.button('非表示にする');b.click();const calls=h.calls.length;b.click();assert.equal(h.calls.length,calls);
  await h.response({ok:false},500);assert.equal(b.disabled,false);
});

test('history pagination appends older reports and keeps restore reachable beyond fifty rows',async()=>{
  const h=harness();h.login();await h.response(result('open',[]));h.ids.resolvedReports.click();
  const first=Array.from({length:50},(_,i)=>({...report({hidden:true}),id:100-i,post_id:100-i,post:{...report({hidden:true}).post,id:100-i}}));
  await h.response(result('resolved',first,true,51));assert.equal(h.ids.reports.children.length,50);assert.equal(h.ids.moreReports.hidden,false);
  h.ids.moreReports.click();assert.equal(h.calls.at(-1).url,'/api/community/moderation/reports?status=resolved&cursor=51');
  const second={...report({hidden:true}),id:50,post_id:50,post:{...report({hidden:true}).post,id:50}};
  await h.response(result('resolved',[second]));assert.equal(h.ids.reports.children.length,51);assert.equal(h.ids.moreReports.hidden,true);
  const last=h.ids.reports.children.at(-1),restore=last.children.at(-1).children[0];assert.equal(restore.textContent,'公開に戻す');
  restore.click();assert.equal(h.calls.at(-1).url,'/api/community/posts/50/moderate');assert.equal(h.calls.at(-1).options.body,'{"hidden":false}');
});

test('failed history page keeps already read reports available without false empty status',async()=>{
  const h=harness();h.login();await h.response(result('open',[report()],true,1));
  h.ids.moreReports.click();await h.response({ok:false,reason:'storage_unavailable'},503);
  assert.equal(h.ids.reports.children.length,1);assert.match(h.ids.status.textContent,/読み込みに失敗/);
  assert.equal(h.ids.moreReports.disabled,false);assert.equal(h.ids.moreReports.hidden,false);
});

test('stock report selection uses its isolated routes and ignores the prior community response',async()=>{
 const h=harness();h.ids.password.value='fixture-admin';h.ids.login.dispatch('submit');await h.settle();
 h.ids.reportScope.value='stock-talk';h.ids.reportScope.dispatch('change');await h.settle();
 assert.match(h.calls.at(-1).url,/\/api\/stock-talk\/moderation\/reports/);
});
