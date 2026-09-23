'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const market=require('../static/market-data.js');
const source=fs.readFileSync(path.join(__dirname,'../static/home-a.js'),'utf8');
function harness(){
 function element(grid=false){
  let html='';const node={children:[],writes:0,scrollLeft:0,title:'',className:''};
  Object.defineProperty(node,'innerHTML',{get(){return html;},set(value){html=value;node.writes++;if(grid)node.children=[...value.matchAll(/class="kn-a-quote"/g)].map(()=>({title:'',children:Array.from({length:4},()=>element())}));}});
  return node;
 }
 const nodes={knHomeMarketGrid:element(true),knHomeMarketTimeText:element(),knMarketRetry:{hidden:true}};
 const context={window:{KNMarketData:market},document:{documentElement:{lang:'ja'},getElementById:id=>nodes[id]||null},localStorage:{getItem:()=>null}};
 // Exercise the real renderer with a minimal DOM, without starting network/picker code.
 vm.runInNewContext(source.slice(0,source.indexOf('  function renderSelected()'))+'window.renderForTest=function(rows){model={rows:function(){return rows;}};renderMarkets();};})();',context);
 return {nodes,render:context.window.renderForTest};
}
const at=Date.parse('2026-09-23T16:38:00Z');
const row=(id='日経225',extra={})=>({item:{id,symbol:id==='日経225'?'^N225':'JPY=X',label:id,category:id==='日経225'?'index':'fx',currency:'JPY'},quote:{price:100,change_value:1,pct:1,currency:'JPY'},at,stale:false,failed:false,...extra});
test('retrieval times remain visible across freshness changes without rebuilding quote cards',()=>{
 const h=harness();h.render([row()]);const grid=h.nodes.knHomeMarketGrid,card=grid.children[0],cells=card.children;
 grid.scrollLeft=83;const timestamp=h.nodes.knHomeMarketTimeText.innerHTML,writes=cells.map(c=>c.writes);
 assert.match(timestamp,/取得 9\/24 01:38 JST/);assert.equal(grid.writes,1);
 h.render([row('日経225',{stale:true})]);assert.equal(h.nodes.knHomeMarketTimeText.innerHTML,timestamp);assert.equal(grid.children[0],card);assert.equal(grid.scrollLeft,83);assert.deepEqual(cells.map(c=>c.writes),writes);
 h.render([row('日経225',{at:at+60000})]);assert.match(h.nodes.knHomeMarketTimeText.innerHTML,/01:39 JST/);assert.equal(grid.writes,1);assert.deepEqual(cells.map(c=>c.writes),writes);
 for(const cell of cells)assert.doesNotMatch(cell.innerHTML,/取得|JST/);
});
test('shared timestamps are concise and mixed timestamps stay associated with their markets',()=>{
 const h=harness();h.render([row(),row('ドル円')]);assert.equal((h.nodes.knHomeMarketTimeText.innerHTML.match(/<time /g)||[]).length,1);
 h.render([row(),row('ドル円',{at:at+60000})]);const html=h.nodes.knHomeMarketTimeText.innerHTML;
 assert.match(html,/日経225<\/span><time[^>]*>取得 9\/24 01:38 JST/);assert.match(html,/ドル円<\/span><time[^>]*>取得 9\/24 01:39 JST/);
});
test('background failure preserves the known price and its time; unknown times are never invented',()=>{
 const h=harness();h.render([row()]);const card=h.nodes.knHomeMarketGrid.children[0];
 h.render([row('日経225',{failed:true,stale:true})]);assert.equal(h.nodes.knHomeMarketGrid.children[0],card);assert.match(card.children[1].innerHTML,/100/);assert.equal(h.nodes.knMarketRetry.hidden,false);assert.match(h.nodes.knHomeMarketTimeText.innerHTML,/01:38 JST/);
 h.render([row('日経225',{quote:null,at:undefined,failed:true})]);assert.match(h.nodes.knHomeMarketTimeText.innerHTML,/取得時刻 —/);assert.doesNotMatch(h.nodes.knHomeMarketTimeText.innerHTML,/<time/);
});
