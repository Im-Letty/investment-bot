'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const source=read('static/kakeibo-layout.js'),html=read('kakeibo.html'),css=read('static/kakeibo-layout.css');

function fixture({embedded=false,parentResult=true,foreign=false,throws=false}={}){
  const attrs=new Map(),events={},calls=[],frames=[],scrolls=[];
  const draft={name:{value:'架空の未保存資産'},amount:{value:'１２３.４５'},income:{value:'４５６'}};
  const more={open:false,contains:()=>false,addEventListener(){}},toggle={setAttribute(){}};
  const body={scrollTop:0,setAttribute:(name,value)=>attrs.set(name,String(value))};
  const document={body,documentElement:{scrollTop:0},getElementById:id=>id==='kkMore'?more:id==='kkMoreToggle'?toggle:id==='ast-name'?draft.name:id==='ast-amount'?draft.amount:id==='inc-amount'?draft.income:null,querySelectorAll:()=>[],addEventListener:(name,fn)=>events[name]=fn};
  const context={document,location:{origin:'https://local.test',href:'https://local.test/kakeibo'},scrollY:0,requestAnimationFrame:fn=>frames.push(fn),
    scrollTo(x,y){scrolls.push([x,y]);context.scrollY=y;},localStorage:{getItem(){throw Error('view switching must not read or migrate storage');},setItem(){throw Error('view switching must not save');}}};
  context.window=context;context.parent=context;context.top=context;
  if(embedded)context.parent={location:{origin:foreign?'https://foreign.test':'https://local.test'},knOpenAssets(){calls.push('parent assets');if(throws)throw Error('parent unavailable');return parentResult;}};
  vm.runInNewContext(source,context);
  context.switchTab=tab=>{calls.push(tab);context.kkLayoutTabChanged(tab);};
  return {context,attrs,events,calls,scrolls,more,frames,draft,
    flush(){while(frames.length)frames.shift()();},
    clickAssets(){events.click({target:{closest:selector=>selector==='[data-kk-open-assets]'?{}:null}});}};
}
test('one document switches between assets and the previous ledger tab without changing inputs or touching storage',()=>{
  const h=fixture(),draft=JSON.stringify(h.draft);assert.equal(h.attrs.get('data-kk-mypage-view'),'ledger');
  h.context.kkLayoutTabChanged('calendar');h.context.scrollY=432;
  assert.equal(h.context.kkSetMyPageView('assets'),true);h.flush();
  assert.deepEqual(h.calls,['assets']);assert.equal(h.attrs.get('data-kk-active-tab'),'assets');assert.equal(h.scrolls.at(-1)[1],0);
  h.context.scrollY=189;
  assert.equal(h.context.kkSetMyPageView('ledger'),true);h.flush();
  assert.deepEqual(h.calls,['assets','calendar']);assert.equal(h.scrolls.at(-1)[1],432);
  h.context.kkSetMyPageView('assets');h.flush();assert.equal(h.scrolls.at(-1)[1],189);
  assert.equal(JSON.stringify(h.draft),draft);
});
test('reapplying the current mode is inert and invalid modes cannot hide or navigate the document',()=>{
  const h=fixture();h.context.kkSetMyPageView('assets');h.flush();h.context.scrollY=987;
  const calls=h.calls.slice(),scrolls=h.scrolls.slice();h.draft.amount.value='未保存の変更';
  assert.equal(h.context.kkSetMyPageView('assets'),true);assert.equal(h.frames.length,0);
  assert.equal(h.context.scrollY,987);assert.deepEqual(h.calls,calls);assert.deepEqual(h.scrolls,scrolls);
  for(const value of ['',null,{},'home'])assert.equal(h.context.kkSetMyPageView(value),false);
  assert.equal(h.attrs.get('data-kk-mypage-view'),'assets');assert.equal(h.draft.amount.value,'未保存の変更');
});
test('a legacy assets tab is never remembered as the household ledger return tab',()=>{
  const h=fixture();h.context.kkLayoutTabChanged('assets');
  h.context.kkSetMyPageView('assets');h.context.kkSetMyPageView('ledger');h.flush();
  assert.deepEqual(h.calls,['assets','home']);assert.equal(h.attrs.get('data-kk-active-tab'),'home');
});
test('rapid view changes discard stale deferred scroll restoration',()=>{
  const h=fixture();h.context.scrollY=450;h.context.kkSetMyPageView('assets');h.context.kkSetMyPageView('ledger');h.flush();
  assert.deepEqual(h.scrolls,[[0,450]]);
});
test('the household assets link delegates to the same-origin parent and standalone falls back to MyPage',()=>{
  const embedded=fixture({embedded:true});embedded.more.open=true;embedded.clickAssets();
  assert.deepEqual(embedded.calls,['parent assets']);assert.equal(embedded.more.open,false);
  assert.equal(embedded.context.location.href,'https://local.test/kakeibo');
  for(const options of [{},{embedded:true,foreign:true},{embedded:true,parentResult:false},{embedded:true,throws:true}]){
    const h=fixture(options);h.clickAssets();assert.equal(h.context.location.href,'/?mypage=assets');
    if(options.foreign)assert.deepEqual(h.calls,[]);
  }
});
test('the assets surface keeps the existing form, chart and list and excludes household chrome',()=>{
  const assetPane=html.slice(html.indexOf('<div class="tab-content po-overview" id="tab-assets"'),html.indexOf('<div class="tab-content" id="tab-records">'));
  for(const id of ['totalAssetVal','totalAssetChange','ast-name','ast-cat','ast-amount','assetPieChart','asset-legend','asset-list-el'])
    assert.match(assetPane,new RegExp('id="'+id+'"'));
  assert.equal((html.match(/id="totalAssetVal"/g)||[]).length,1);
  assert.match(html,/data-kk-open-assets data-i18n="kk_layout_mypage_assets"/);assert.doesNotMatch(html,/data-kk-layout-go="assets"/);
  assert.match(css,/\[data-kk-mypage-view="assets"\] > :not\(#tab-assets\):not\(#ledger-session-notice\)/);
  assert.match(html,/html:not\(\[data-ledger-private-ready="true"\]\) body/);
});
test('the actual moved asset renderer escapes saved names and categories without rewriting their stored values',()=>{
  const start=html.indexOf("  var astEl=document.getElementById('asset-list-el');"),end=html.indexOf("  var recEl=",start);
  assert.ok(start>0&&end>start);
  const assets=[{id:42,name:'<img src=x onerror=evil()>',cat:'<svg onload=evil()>',amount:123.45},{id:'1);evil();//',name:'架空',cat:'現金',amount:-23.45}];
  const original=JSON.stringify(assets),node={innerHTML:''};
  const helper=html.slice(html.indexOf('function kkHtmlText('),html.indexOf('\n',html.indexOf('function kkHtmlText(')));
  vm.runInNewContext(helper+'\n'+html.slice(start,end),{document:{getElementById:id=>id==='poStatus'?null:node},assets,CAT_COLORS:{現金:'#fff'},fmt:String,kkT:String});
  assert.doesNotMatch(node.innerHTML,/<img|<svg|deleteAsset\(1\);evil/);
  assert.match(node.innerHTML,/&lt;img src=x onerror=evil\(\)&gt;/);
  assert.match(node.innerHTML,/&lt;svg onload=evil\(\)&gt;/);
  assert.match(node.innerHTML,/deleteAsset\(42\)/);assert.match(node.innerHTML,/deleteAsset\(NaN\)/);
  assert.equal(JSON.stringify(assets),original);
});
test('the moved total uses saved signed valuations and counts registered zero-valued assets separately from household income',()=>{
  const start=html.indexOf('  var totalAst=assets.reduce('),end=html.indexOf('  var months=[]',start);
  assert.ok(start>0&&end>start);
  for(const assets of [[{amount:0}],[{amount:123.45},{amount:-23.45}],[]]){
    const nodes={totalAssetVal:{},totalAssetChange:{}},before=JSON.stringify(assets);
    vm.runInNewContext(html.slice(start,end),{assets,document:{getElementById:id=>nodes[id]},fmt:String,kkT:key=>({kk_asset_count:'登録資産 {count}件',kk_pls_register_asset:'資産を登録してください'})[key]});
    assert.equal(nodes.totalAssetVal.textContent,String(assets.reduce((sum,row)=>sum+row.amount,0)));
    assert.equal(nodes.totalAssetChange.textContent,assets.length?'登録資産 '+assets.length+'件':'資産を登録してください');
    assert.equal(JSON.stringify(assets),before);
  }
});


test('zero or offsetting asset totals do not display a fictitious or NaN allocation percentage',()=>{
  const start=html.indexOf("  var astCatMap=Object.create(null);"),end=html.indexOf("  var astEl=",start);
  assert.ok(start>0&&end>start);
  const helper=html.slice(html.indexOf('function kkHtmlText('),html.indexOf('\n',html.indexOf('function kkHtmlText(')));
  for(const amounts of [[0,0],[100,-100]]){
    const nodes={assetPieChart:{},'asset-legend':{innerHTML:''}};
    const assets=amounts.map((amount,i)=>({id:i+1,name:'架空',cat:['現金','国内株'][i],amount}));
    vm.runInNewContext(helper+'\n'+html.slice(start,end),{document:{getElementById:id=>nodes[id]},assets,CAT_COLORS:{},kkCat:String,_renderChart(){},kkT:String});
    assert.doesNotMatch(nodes['asset-legend'].innerHTML,/NaN|Infinity|>0%</);
    assert.match(nodes['asset-legend'].innerHTML,/—/);
  }
});
