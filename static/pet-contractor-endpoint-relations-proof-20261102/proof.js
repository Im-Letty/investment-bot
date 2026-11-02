/* Fixed, explicit fixtures only. No game dispatch, storage, network or timers. */
(function(){
  'use strict';
  var engine=typeof PetContractorEndpointRelations==='object'&&PetContractorEndpointRelations;
  var inspect=engine&&engine.inspect;
  var ids=['home','cafe','shop','playground','tree','flowers'];
  var colors={home:'#d5b6b5',cafe:'#b4c8a2',shop:'#e5cb8c',playground:'#acc5db',tree:'#b5afcf',flowers:'#d8b9d7'};
  var labels={overlap:'重なる',touch:'触れる',separate:'離れる'};
  var observations=[],buttons=[];
  function el(id){return document.getElementById(id);}
  function clone(value){return JSON.parse(JSON.stringify(value));}
  function base(){
    var positions=[[10,10],[40,10],[70,10],[10,60],[40,60],[70,60]];
    var layout={version:1,theme:'cafe',items:ids.map(function(id,i){return {id:id,x:positions[i][0],y:positions[i][1]};})};
    return {snapshot:{revision:7,currentLayout:layout},proposal:{version:1,expectedRevision:7,requestedLayout:clone(layout)},footprint:{version:1,coordinateSpace:'provided_saved_layout_xy',items:ids.map(function(id){return {id:id,minX:-4,minY:-4,maxX:4,maxY:4};})}};
  }
  function move(f,x,y){f.proposal.requestedLayout.items[0].x=x;f.proposal.requestedLayout.items[0].y=y;}
  var cases=[
    {id:'unchanged',label:'1　配置を変えない',description:'6つの矩形は前後とも離れています。変化する組はありません。',setup:function(){},expected:{relation:'separate',width:0,height:8,area:0,changes:0}},
    {id:'overlap',label:'2　面積のある重なり',description:'home を (36,10) へ動かす希望です。cafe との重なりは幅4・高さ8・面積32です。',setup:function(f){move(f,36,10);},expected:{relation:'overlap',width:4,height:8,area:32,changes:3}},
    {id:'edge',label:'3　辺で触れる',description:'home を (32,10) へ動かす希望です。辺が触れ、面積は0です。',setup:function(f){move(f,32,10);},expected:{relation:'touch',width:0,height:8,area:0,changes:2}},
    {id:'corner',label:'4　角で触れる',description:'home を (32,2) へ動かす希望です。cafe の角に触れ、重なりの幅・高さ・面積は0です。',setup:function(f){move(f,32,2);},expected:{relation:'touch',width:0,height:0,area:0,changes:3}},
    {id:'asymmetric',label:'5　非対称な矩形',description:'home の左側2・右側8、上側1・下側3という明示寸法を使います。変更後の重なりは幅8・高さ4・面積32です。',setup:function(f){Object.assign(f.footprint.items[0],{minX:-2,maxX:8,minY:-1,maxY:3});move(f,38,10);},expected:{relation:'overlap',width:8,height:4,area:32,changes:3}},
    {id:'measures',label:'6　重なりの大きさだけ変える',description:'home は最初から cafe と重なっています。(36,10) から (38,10) へ移ると、面積が32から48へ変わります。',setup:function(f){f.snapshot.currentLayout.items[0].x=36;move(f,38,10);},expected:{relation:'overlap',width:6,height:8,area:48,changes:2}},
    {id:'stale',label:'7　配置の版が違う',description:'希望する配置の版を古くした例です。矩形の関係は返しません。',setup:function(f){f.proposal.expectedRevision=6;},error:'stale_revision'},
    {id:'missing',label:'8　矩形が1つ足りない',description:'6つの場所のうち1つの寸法が欠けています。寸法を補わずに拒否します。',setup:function(f){f.footprint.items.pop();},error:'invalid_footprint'},
    {id:'space',label:'9　座標の単位が違う',description:'保存用配置座標以外の指定です。単位を推測して変換せずに拒否します。',setup:function(f){f.footprint.coordinateSpace='world_pixels';},error:'invalid_footprint'},
    {id:'unsafe',label:'10　正確に扱えない面積',description:'各値は整数でも、計算する面積が安全な整数の範囲を超えます。近似値を返さずに拒否します。',setup:function(f){f.footprint.items.forEach(function(row){row.minX=-100000000;row.maxX=100000000;row.minY=-100000000;row.maxY=100000000;});},error:'unsafe_arithmetic'}
  ];
  function cafeHome(result){return result.after.pairs.find(function(pair){return pair.ids[0]==='cafe'&&pair.ids[1]==='home';});}
  function matches(c,result){
    if(c.error)return result.ok===false&&result.error===c.error;
    if(!result.ok||result.coordinateSpace!=='provided_saved_layout_xy'||result.before.rectangles.length!==6||result.after.rectangles.length!==6||result.before.pairs.length!==15||result.after.pairs.length!==15)return false;
    var p=cafeHome(result),x=c.expected;
    return p&&p.relation===x.relation&&p.overlapWidth===x.width&&p.overlapHeight===x.height&&p.overlapArea===x.area&&result.changes.length===x.changes;
  }
  function svgNode(tag,attrs,text){var node=document.createElementNS('http://www.w3.org/2000/svg',tag);Object.keys(attrs).forEach(function(k){node.setAttribute(k,String(attrs[k]));});if(text!==undefined)node.textContent=text;return node;}
  function draw(id,rectangles){
    var svg=el(id);svg.replaceChildren();
    if(!rectangles){svg.setAttribute('viewBox','-15 -15 110 100');svg.appendChild(svgNode('text',{x:5,y:15},'関係データなし'));return;}
    var left=Math.min.apply(null,rectangles.map(function(r){return r.minX;})),right=Math.max.apply(null,rectangles.map(function(r){return r.maxX;}));
    var top=Math.min.apply(null,rectangles.map(function(r){return r.minY;})),bottom=Math.max.apply(null,rectangles.map(function(r){return r.maxY;}));
    svg.setAttribute('viewBox',[left-10,top-10,right-left+20,bottom-top+20].join(' '));
    rectangles.forEach(function(r){svg.appendChild(svgNode('rect',{x:r.minX,y:r.minY,width:r.maxX-r.minX,height:r.maxY-r.minY,fill:colors[r.id],'fill-opacity':.7,stroke:'#455c50','stroke-width':.45}));svg.appendChild(svgNode('text',{x:(r.minX+r.maxX)/2,y:r.minY-2,'text-anchor':'middle'},String(ids.indexOf(r.id)+1)));});
  }
  function cell(pair){var td=document.createElement('td');td.appendChild(document.createTextNode(labels[pair.relation]));var detail=document.createElement('small');detail.textContent=pair.overlapWidth+' × '+pair.overlapHeight+' ／ '+pair.overlapArea;td.appendChild(detail);return td;}
  function render(result){
    draw('before',result.ok?result.before.rectangles:null);draw('after',result.ok?result.after.rectangles:null);var body=el('pairs');body.replaceChildren();
    if(!result.ok){var row=document.createElement('tr'),td=document.createElement('td');td.colSpan=3;td.textContent='関係データなし（'+result.error+'）';row.appendChild(td);body.appendChild(row);el('summary').textContent='入力を拒否しました。変更前後の関係を出力していません。';return;}
    result.before.pairs.forEach(function(pair,i){var row=document.createElement('tr'),name=document.createElement('th');name.scope='row';name.textContent=pair.ids.join(' / ');row.appendChild(name);row.appendChild(cell(pair));row.appendChild(cell(result.after.pairs[i]));body.appendChild(row);});
    el('summary').textContent='各端点15組を確認しました。関係または重なりの数値が変わる組：'+result.changes.length+'。配置・工事の承認は行っていません。';
  }
  function run(c,button){
    var f=base();c.setup(f);var result;
    try{result=inspect.call(engine,JSON.stringify(f.snapshot),JSON.stringify(f.proposal),JSON.stringify(f.footprint));}
    catch(error){result={ok:false,error:'unexpected_inspection_failure'};}
    var matched=matches(c,result);observations.push({caseId:c.id,expected:c.error?{error:c.error}:clone(c.expected),matchesExpected:matched,input:f,result:result});
    buttons.forEach(function(b){b.setAttribute('aria-pressed',String(b===button));});el('case-description').className='';el('case-description').textContent=c.description;render(result);
    el('status').textContent=(matched?'期待した結果を確認':'期待した結果と不一致')+'：'+c.label+' ／ 手動観測 '+observations.length+'回';
    el('report').textContent=JSON.stringify({scope:'provided_saved_layout_xy_endpoints_only',manualObservations:observations.length,formalTestCredit:0,ownerGameConnected:false,storageCalls:0,sendOrConstructionCalls:0,observations:observations},null,2);
    el('result-title').focus();
  }
  if(typeof inspect!=='function'){el('status').textContent='入力検査を読み込めませんでした。例は実行していません。';return;}
  cases.forEach(function(c){var b=document.createElement('button');b.type='button';b.textContent=c.label;b.setAttribute('aria-pressed','false');b.addEventListener('click',function(){run(c,b);});buttons.push(b);el('fixtures').appendChild(b);});
  el('status').textContent='準備できました。例を選ぶまで検査は実行しません。';
}());
