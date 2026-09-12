
(function(){

(function(){
if(window.__PETGAME_BOOTED)return; window.__PETGAME_BOOTED=true;
var SVGNS='http://www.w3.org/2000/svg';
function el(t,a){var e=document.createElementNS(SVGNS,t);for(var k in a)e.setAttribute(k,a[k]);return e;}
function dv(t,x,c){var e=document.createElement(t);if(x!=null)e.textContent=x;if(c)e.style.cssText=c;return e;}
function today(){var d=new Date();return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();}
var DEF={name:'',exp:0,equipped:null,coins:0,pot:0,potDays:0,potBasis:0,foods:{},decos:{},lastDay:'',doneQ:{},doneDay:''};
function load(){try{var r=localStorage.getItem('pet_game');if(!r)return Object.assign({},DEF);return Object.assign({},DEF,JSON.parse(r));}catch(e){return Object.assign({},DEF);}}
function persist(){try{localStorage.setItem('pet_game',JSON.stringify({name:S.name,exp:S.exp,equipped:S.equipped,coins:S.coins,pot:S.pot,potDays:S.potDays,potBasis:S.potBasis,foods:S.foods,decos:S.decos,lastDay:S.lastDay,doneQ:S.doneQ,doneDay:S.doneDay}));}catch(e){}}
var S=load();
var FOODS=[{e:'🍎',buy:8,sell:4,exp:3},{e:'🍰',buy:18,sell:9,exp:6},{e:'🍓',buy:6,sell:3,exp:2},{e:'🍙',buy:12,sell:6,exp:4}];
var DECOS=[{e:'🎀',buy:25,sell:12},{e:'🎩',buy:30,sell:15},{e:'👑',buy:60,sell:30},{e:'🌸',buy:20,sell:10},{e:'⭐',buy:35,sell:17},{e:'🌈',buy:45,sell:22}];
function fF(e){return FOODS.filter(function(x){return x.e===e;})[0];}
function fD(e){return DECOS.filter(function(x){return x.e===e;})[0];}
function lvFor(e){return Math.floor(Math.pow(e/8,0.62))+1;}
function expForLv(l){return Math.ceil(Math.pow(l-1,1/0.62)*8);}
var PAL=[{b:'#f6e6b8',c:'#e8c96a',l:'#fff6dd'},{b:'#aee2ff',c:'#6fc4f5',l:'#eaf7ff'},{b:'#bdebc0',c:'#74c97e',l:'#effaef'},{b:'#ffe3a3',c:'#f5b94e',l:'#fff7e6'},{b:'#e6c8ff',c:'#b97cf0',l:'#f7eaff'},{b:'#ffd0e0',c:'#f57ca6',l:'#fff0f5'}];
function lookFor(lv){var p=PAL[(lv-1)%PAL.length];return {body:p.b,body2:p.c,belly:p.l,ears:lv>=2,tier:Math.floor((lv-1)/PAL.length),crown:lv>=6};}
function titleFor(lv){if(lv<2)return 'たまご';if(lv<4)return '幼体';if(lv<7)return '子ども';if(lv<11)return '成長期';if(lv<16)return '成熟期';return 'おとな ★'+(lv-15);}
function moodFor(d){if(d<=1)return {face:'normal',msg:'げんき！ あそぼ〜',color:'#2b6'};if(d<=2)return {face:'sad',msg:'ちょっと さみしかった…',color:'#c89b3a'};if(d<=4)return {face:'sad',msg:'しょんぼり…おなかすいた',color:'#c87a3a'};return {face:'cry',msg:'ぐったり…会いにきて〜',color:'#b85a5a'};}
function neglectDays(){if(!S.lastDay)return 0;try{var x=new Date(S.lastDay),y=new Date(today());return Math.max(0,Math.round((y-x)/86400000));}catch(e){return 0;}}
if(!document.getElementById('pgStyle')){var st=document.createElement('style');st.id='pgStyle';st.textContent='@keyframes pbob{0%,100%{transform:translateY(0) scale(1,1)}50%{transform:translateY(-9px) scale(.97,1.03)}}@keyframes pwave{0%,100%{transform:rotate(0deg)}50%{transform:rotate(-22deg)}}@keyframes psparkle{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.35);opacity:.65}}';document.head.appendChild(st);}
function drawCreature(svg,lk,mood){while(svg.firstChild)svg.removeChild(svg.firstChild);var defs=document.createElementNS(SVGNS,'defs');var rg=el('radialGradient',{id:'pgB',cx:'38%',cy:'30%',r:'75%'});rg.appendChild(el('stop',{offset:'0%','stop-color':'#fff'}));rg.appendChild(el('stop',{offset:'45%','stop-color':lk.body}));rg.appendChild(el('stop',{offset:'100%','stop-color':lk.body2}));defs.appendChild(rg);svg.appendChild(defs);var g=el('g',{'transform-origin':'100px 130px'});svg.appendChild(g);g.style.opacity=(mood.face!=='normal')?'0.85':'1';if(lk.ears){g.appendChild(el('ellipse',{cx:78,cy:62,rx:9,ry:13,fill:lk.body2,transform:'rotate(-18 78 62)'}));g.appendChild(el('ellipse',{cx:122,cy:62,rx:9,ry:13,fill:lk.body2,transform:'rotate(18 122 62)'}));}if(lk.crown){g.appendChild(el('path',{d:'M82 50 L88 38 L100 48 L112 38 L118 50 Z',fill:'#ffd34d',stroke:'#e8a800','stroke-width':'1.5'}));}if(lk.tier>=1){[[40,80],[160,80],[50,150],[150,150]].forEach(function(p){var s=el('text',{x:p[0],y:p[1],'font-size':'16','text-anchor':'middle'});s.textContent='✨';g.appendChild(s);});}g.appendChild(el('ellipse',{cx:100,cy:120,rx:62,ry:60,fill:'url(#pgB)'}));g.appendChild(el('ellipse',{cx:100,cy:135,rx:30,ry:34,fill:lk.belly}));g.appendChild(el('ellipse',{cx:78,cy:92,rx:18,ry:12,fill:'#fff',opacity:'.55',transform:'rotate(-25 78 92)'}));var armL=el('ellipse',{cx:46,cy:128,rx:13,ry:17,fill:lk.body2,'transform-origin':'52px 118px'});g.appendChild(armL);g.appendChild(el('ellipse',{cx:154,cy:128,rx:13,ry:17,fill:lk.body2}));var co=mood.face==='normal'?'.7':'.4';g.appendChild(el('ellipse',{cx:68,cy:118,rx:11,ry:8,fill:'#ffb3c8',opacity:co}));g.appendChild(el('ellipse',{cx:132,cy:118,rx:11,ry:8,fill:'#ffb3c8',opacity:co}));function eye(ex){var eg=el('g',{'transform-origin':ex+'px 104px'});if(mood.face==='normal'){eg.appendChild(el('ellipse',{cx:ex,cy:104,rx:13,ry:16,fill:'#2b2b3a'}));var s=el('circle',{cx:ex-4,cy:98,r:4.5,fill:'#fff'});eg.appendChild(s);eg.appendChild(el('circle',{cx:ex+4,cy:108,r:2.2,fill:'#fff',opacity:'.85'}));return {g:eg,s:s,blink:true};}else if(mood.face==='sad'){eg.appendChild(el('path',{d:'M '+(ex-11)+' 106 Q '+ex+' 116 '+(ex+11)+' 106',stroke:'#2b2b3a','stroke-width':'4',fill:'none','stroke-linecap':'round'}));eg.appendChild(el('ellipse',{cx:ex,cy:100,rx:8,ry:9,fill:'#2b2b3a'}));return {g:eg,s:null,blink:false};}else{eg.appendChild(el('path',{d:'M '+(ex-10)+' 102 Q '+ex+' 110 '+(ex+10)+' 102',stroke:'#2b2b3a','stroke-width':'4',fill:'none','stroke-linecap':'round'}));eg.appendChild(el('ellipse',{cx:ex-2,cy:116,rx:3,ry:6,fill:'#7fc6f0',opacity:'.85'}));return {g:eg,s:null,blink:false};}}var L=eye(80),R=eye(120);g.appendChild(L.g);g.appendChild(R.g);var md=mood.face==='normal'?'M92 120 Q100 128 108 120':(mood.face==='sad'?'M93 126 Q100 120 107 126':'M93 127 Q100 121 107 127');g.appendChild(el('path',{d:md,stroke:'#3a3a4a','stroke-width':'3',fill:'none','stroke-linecap':'round'}));if(S.equipped){var t=el('text',{x:100,y:54,'text-anchor':'middle','font-size':'34'});t.textContent=S.equipped;g.appendChild(t);}var bs=mood.face==='normal'?'2.4s':(mood.face==='sad'?'3.6s':'4.5s');g.style.animation='pbob '+bs+' ease-in-out infinite';if(mood.face==='normal'){armL.style.animation='pwave 1.6s ease-in-out infinite';}if(L.s){L.s.style.cssText='transform-origin:76px 98px';L.s.style.animation='psparkle 1.9s ease-in-out infinite';}if(R.s){R.s.style.cssText='transform-origin:116px 98px';R.s.style.animation='psparkle 1.9s ease-in-out infinite .35s';}if(window._pgBlink)clearInterval(window._pgBlink);if(L.blink){window._pgBlink=setInterval(function(){[L.g,R.g].forEach(function(e){e.style.transition='transform .08s ease-in';e.style.transform='scaleY(0.08)';setTimeout(function(){e.style.transition='transform .12s ease-out';e.style.transform='scaleY(1)';},95);});},3400);}}
window.__PG={S:S,FOODS:FOODS,DECOS:DECOS,fF:fF,fD:fD,lvFor:lvFor,expForLv:expForLv,lookFor:lookFor,titleFor:titleFor,moodFor:moodFor,neglectDays:neglectDays,persist:persist,el:el,dv:dv,SVGNS:SVGNS,drawCreature:drawCreature};
})();


(function(){
var G=window.__PG; if(!G) return;
var S=G.S, el=G.el, dv=G.dv;
var app,body,coinChip,tabBtns={},current='home';
function showToast(t,col){var tn=document.getElementById('pgToast');if(!tn)return;tn.textContent=t;tn.style.background=col||'#2b6';tn.style.opacity='1';setTimeout(function(){tn.style.opacity='0';},1400);}
function markVisitToday(){var t=G.S.lastDay, td=new Date(); var key=td.getFullYear()+'-'+(td.getMonth()+1)+'-'+td.getDate(); if(S.doneDay!==key){S.doneQ={};S.doneDay=key;} S.lastDay=key; G.persist();}
function buildApp(){
 app=dv('div',null,'position:fixed;inset:0;z-index:2147483000;background:linear-gradient(160deg,#eaf6ff,#f3fbff 55%,#fef6ff);font-family:sans-serif;display:flex;flex-direction:column;');app.id='pgApp';
 var top=dv('div',null,'flex:0 0 auto;display:flex;justify-content:space-between;align-items:center;padding:12px 14px;');
 top.appendChild(dv('div','🌱 そだてる ゲーム','font-size:17px;font-weight:bold;color:#357;'));
 coinChip=dv('div',null,'background:#fff;border-radius:14px;padding:5px 12px;font-size:14px;font-weight:bold;color:#d39a2a;box-shadow:0 2px 6px rgba(0,0,0,.08);');
 var cb=dv('button','×','border:none;background:#cfe9fb;color:#357;width:32px;height:32px;border-radius:50%;font-size:19px;margin-left:8px;');cb.onclick=closeApp;
 var tr=dv('div',null,'display:flex;align-items:center;');tr.appendChild(coinChip);tr.appendChild(cb);top.appendChild(tr);app.appendChild(top);
 body=dv('div',null,'flex:1 1 auto;overflow:auto;padding:6px 12px 90px;display:flex;flex-direction:column;align-items:center;');app.appendChild(body);
 var toast=dv('div',null,'position:fixed;left:50%;top:8%;transform:translateX(-50%);background:#2b6;color:#fff;padding:8px 18px;border-radius:20px;font-size:14px;opacity:0;transition:opacity .3s;pointer-events:none;z-index:2147483600;');toast.id='pgToast';app.appendChild(toast);
 var tb=dv('div',null,'position:fixed;left:0;right:0;bottom:0;z-index:2147483600;display:flex;background:#fff;border-top:1px solid #e2eaf0;box-shadow:0 -4px 16px rgba(0,0,0,.15);padding:2px 4px;');
 [['home','🌱 そだてる'],['shop','🛒 ショップ'],['items','🎒 アイテム'],['money','🪙 おかね']].forEach(function(t){var b=dv('button',t[1],'flex:1;border:none;background:none;padding:13px 2px;font-size:12px;font-weight:bold;color:#9ab;border-radius:12px;margin:3px;');b.onclick=function(){current=t[0];render();};tabBtns[t[0]]=b;tb.appendChild(b);});
 app.appendChild(tb);
 document.body.appendChild(app);
}
function closeApp(){if(window._pgBlink)clearInterval(window._pgBlink);if(app){app.remove();app=null;}}
function renderHome(){
 var lv=G.lvFor(S.exp),lk=G.lookFor(lv),nd=G.neglectDays(),mood=G.moodFor(nd);
 body.appendChild(dv('div',(S.name||'なまえなし')+' 🐾','font-size:20px;color:#357;font-weight:bold;'));
 body.appendChild(dv('div','Lv.'+lv+' ・ EXP '+S.exp+' ・ '+G.titleFor(lv),'font-size:13px;color:#5a8;font-weight:bold;margin-top:2px;'));
 body.appendChild(dv('div','🎯 目標：？？？（ゆくゆくは 竜🐉 や ユニコーン🦄 に…）','font-size:11px;color:#88a;margin-top:3px;'));
 var ml=dv('div',mood.msg,'font-size:14px;font-weight:bold;margin-top:4px;');ml.style.color=mood.color;body.appendChild(ml);
 var svg=document.createElementNS(G.SVGNS,'svg');svg.setAttribute('viewBox','0 0 200 200');svg.setAttribute('width','190');svg.setAttribute('height','190');body.appendChild(svg);G.drawCreature(svg,lk,mood);
 var bw=dv('div',null,'width:100%;max-width:330px;');var bg=dv('div',null,'height:14px;border-radius:10px;background:#dfeaf2;overflow:hidden;');var bf=dv('div',null,'height:100%;border-radius:10px;background:linear-gradient(90deg,#f5d36a,#74c97e);');var cur=G.expForLv(lv),nxt=G.expForLv(lv+1);bf.style.width=Math.min(100,Math.round((S.exp-cur)/(nxt-cur)*100))+'%';bg.appendChild(bf);bw.appendChild(bg);bw.appendChild(dv('div','つぎのLvまで あと '+(nxt-S.exp)+' EXP（コツコツ育てよう）','text-align:center;font-size:12px;color:#678;margin-top:3px;'));body.appendChild(bw);
 var nw=dv('div',null,'margin-top:12px;display:flex;gap:6px;align-items:center;');var ni=dv('input');ni.type='text';ni.placeholder='なまえを入力';ni.maxLength=12;ni.value=S.name||'';ni.style.cssText='border:1px solid #bcd;border-radius:12px;padding:7px 12px;font-size:14px;width:150px;';var nb=dv('button','つける','border:none;background:#7cc6f0;color:#fff;border-radius:12px;padding:7px 16px;font-size:13px;font-weight:bold;');nb.onclick=function(){S.name=(ni.value||'').slice(0,12);G.persist();render();};nw.appendChild(ni);nw.appendChild(nb);body.appendChild(nw);
 var qw=dv('div',null,'width:100%;max-width:430px;margin-top:16px;');qw.appendChild(dv('div','きょうの やること（こなすとコイン＆アイテム）','font-size:14px;font-weight:bold;color:#357;margin-bottom:8px;'));body.appendChild(qw);
 var Q=[['login','📅','今日ログインする'],['study','📖','記事を読んで勉強する'],['sim','📊','シミュレーターを使う'],['diary','📝','日記を書く']];
 Q.forEach(function(q){var row=dv('div',null,'display:flex;align-items:center;justify-content:space-between;background:#fff;border-radius:16px;padding:11px 14px;margin-bottom:9px;box-shadow:0 2px 8px rgba(0,0,0,.06);');var lf=dv('div',null,'display:flex;align-items:center;gap:10px;');lf.appendChild(dv('span',q[1],'font-size:21px;'));lf.appendChild(dv('span',q[2],'font-size:14px;color:#334;'));row.appendChild(lf);var done=S.doneQ[q[0]];var b=dv('button',done?'✓':'やった！','border:none;border-radius:14px;padding:8px 16px;background:'+(done?'#bcd':'#7cc6f0')+';color:#fff;font-size:13px;font-weight:bold;');if(done)b.disabled=true;b.onclick=function(){if(S.doneQ[q[0]])return;S.doneQ[q[0]]=true;S.lastDay=today();S.coins+=20;if(Math.random()<0.6){var f=G.FOODS[Math.floor(Math.random()*G.FOODS.length)];S.foods[f.e]=(S.foods[f.e]||0)+1;showToast('+20🪙 と '+f.e+' GET！');}else{var d=G.DECOS[Math.floor(Math.random()*G.DECOS.length)];S.decos[d.e]=(S.decos[d.e]||0)+1;showToast('+20🪙 と かざり '+d.e+' GET！');}G.persist();render();};function today(){var dd=new Date();return dd.getFullYear()+'-'+(dd.getMonth()+1)+'-'+dd.getDate();}row.appendChild(b);qw.appendChild(row);});
}
function renderShop(){
 body.appendChild(dv('div','🛒 ショップ','font-size:18px;font-weight:bold;color:#a06a1a;'));
 body.appendChild(dv('div','※ つかいすぎると おかねを うんように まわせないよ','font-size:11px;color:#c88;margin:4px 0 8px;'));
 S._st=S._st||'food';var sub=dv('div',null,'display:flex;gap:8px;margin-bottom:10px;');function sb(id,l){var on=S._st===id;var b=dv('button',l,'border:none;border-radius:20px;padding:7px 18px;font-size:13px;font-weight:bold;background:'+(on?'#74c97e':'#e6efe8')+';color:'+(on?'#fff':'#789')+';');b.onclick=function(){S._st=id;render();};return b;}sub.appendChild(sb('food','🍽 えさ'));sub.appendChild(sb('deco','🎀 かざり'));body.appendChild(sub);
 var list=(S._st==='food'?G.FOODS:G.DECOS);var w=dv('div',null,'width:100%;max-width:430px;');
 list.forEach(function(it){var row=dv('div',null,'display:flex;align-items:center;justify-content:space-between;background:#fff;border-radius:14px;padding:10px 14px;margin-bottom:8px;box-shadow:0 2px 6px rgba(0,0,0,.06);');var lf=dv('div',null,'display:flex;align-items:center;gap:10px;');lf.appendChild(dv('span',it.e,'font-size:24px;'));if(S._st==='food')lf.appendChild(dv('span','+'+it.exp+'EXP','font-size:11px;color:#9ab;'));row.appendChild(lf);var b=dv('button',it.buy+'🪙 かう','border:none;background:#74c97e;color:#fff;border-radius:12px;padding:7px 14px;font-size:13px;font-weight:bold;');b.onclick=function(){if(S.coins<it.buy){showToast('コインが たりない','#c66');return;}S.coins-=it.buy;var bag=(S._st==='food'?S.foods:S.decos);bag[it.e]=(bag[it.e]||0)+1;showToast(it.e+' を かった！');G.persist();render();};row.appendChild(b);w.appendChild(row);});body.appendChild(w);
}
function renderItems(){
 body.appendChild(dv('div','🎒 アイテム（もちもの）','font-size:18px;font-weight:bold;color:#357;'));
 S._it=S._it||'food';var sub=dv('div',null,'display:flex;gap:8px;margin:8px 0 10px;');function sb(id,l){var on=S._it===id;var b=dv('button',l,'border:none;border-radius:20px;padding:7px 18px;font-size:13px;font-weight:bold;background:'+(on?'#7cc6f0':'#e3eef5')+';color:'+(on?'#fff':'#789')+';');b.onclick=function(){S._it=id;render();};return b;}sub.appendChild(sb('food','🍽 えさ'));sub.appendChild(sb('deco','🎀 かざり'));body.appendChild(sub);
 var w=dv('div',null,'width:100%;max-width:430px;');
 if(S._it==='food'){var ks=Object.keys(S.foods).filter(function(k){return S.foods[k]>0;});if(!ks.length)w.appendChild(dv('div','まだ えさが ないよ。ショップで かおう！','font-size:13px;color:#9ab;'));ks.forEach(function(e){var f=G.fF(e);if(!f)return;var row=dv('div',null,'display:flex;align-items:center;justify-content:space-between;background:#fff;border-radius:14px;padding:10px 12px;margin-bottom:8px;box-shadow:0 2px 6px rgba(0,0,0,.06);');var lf=dv('div',null,'display:flex;align-items:center;gap:8px;');lf.appendChild(dv('span',e,'font-size:24px;'));lf.appendChild(dv('span','×'+S.foods[e],'font-size:13px;color:#789;'));row.appendChild(lf);var bs=dv('div',null,'display:flex;gap:6px;');var ab=dv('button','🍽 あげる','border:none;background:#7cc6f0;color:#fff;border-radius:10px;padding:6px 10px;font-size:12px;font-weight:bold;');ab.onclick=function(){S.foods[e]--;S.lastDay=(new Date()).getFullYear()+'-'+((new Date()).getMonth()+1)+'-'+(new Date()).getDate();var bl=G.lvFor(S.exp);S.exp+=f.exp;var al=G.lvFor(S.exp);showToast(al>bl?('🎉 Lv.'+al+' に進化！'):(e+' をあげた！+'+f.exp+'EXP'),'#2b7a4a');G.persist();render();};bs.appendChild(ab);var sl=dv('button','💰 うる'+f.sell,'border:none;background:#f0a85a;color:#fff;border-radius:10px;padding:6px 10px;font-size:12px;font-weight:bold;');sl.onclick=function(){S.foods[e]--;S.coins+=f.sell;showToast(e+' を うった +'+f.sell+'🪙','#d39a2a');G.persist();render();};bs.appendChild(sl);row.appendChild(bs);w.appendChild(row);});}
 else{var dk=Object.keys(S.decos).filter(function(k){return S.decos[k]>0;});if(!dk.length)w.appendChild(dv('div','まだ かざりが ないよ。ショップで かおう！','font-size:13px;color:#9ab;'));dk.forEach(function(e){var d=G.fD(e);if(!d)return;var on=S.equipped===e;var row=dv('div',null,'display:flex;align-items:center;justify-content:space-between;background:#fff;border-radius:14px;padding:10px 12px;margin-bottom:8px;box-shadow:0 2px 6px rgba(0,0,0,.06);');var lf=dv('div',null,'display:flex;align-items:center;gap:8px;');lf.appendChild(dv('span',e,'font-size:24px;'));lf.appendChild(dv('span','×'+S.decos[e],'font-size:13px;color:#789;'));if(on)lf.appendChild(dv('span','（つけてる）','font-size:11px;color:#2b9;'));row.appendChild(lf);var bs=dv('div',null,'display:flex;gap:6px;');var eb=dv('button',on?'はずす':'👗 きせる','border:none;background:#b07cf0;color:#fff;border-radius:10px;padding:6px 10px;font-size:12px;font-weight:bold;');eb.onclick=function(){S.equipped=(on?null:e);showToast(S.equipped?(e+' をつけた！'):'はずした');G.persist();render();};bs.appendChild(eb);var sl=dv('button','💰 うる'+d.sell,'border:none;background:#f0a85a;color:#fff;border-radius:10px;padding:6px 10px;font-size:12px;font-weight:bold;');sl.onclick=function(){S.decos[e]--;if(S.equipped===e&&S.decos[e]<=0)S.equipped=null;S.coins+=d.sell;showToast(e+' を うった +'+d.sell+'🪙','#d39a2a');G.persist();render();};bs.appendChild(sl);row.appendChild(bs);w.appendChild(row);});}
 body.appendChild(w);
}
function renderMoney(){
 body.appendChild(dv('div','🪙 おかね','font-size:18px;font-weight:bold;color:#a06a1a;'));
 var w=dv('div',null,'width:100%;max-width:400px;margin-top:10px;background:#fff;border-radius:18px;padding:16px;box-shadow:0 3px 12px rgba(0,0,0,.08);text-align:center;');w.appendChild(dv('div','おさいふ','font-size:13px;color:#9a8;'));w.appendChild(dv('div',S.coins+' 🪙','font-size:30px;font-weight:bold;color:#d39a2a;'));body.appendChild(w);
 var pc=dv('div',null,'width:100%;max-width:400px;margin-top:16px;background:linear-gradient(135deg,#eafaf0,#e6f3ff);border-radius:18px;padding:16px;box-shadow:0 3px 12px rgba(0,0,0,.08);');pc.appendChild(dv('div','🌱 うんようポット（あずけて じゅくせい）','font-size:15px;font-weight:bold;color:#2b7a4a;'));pc.appendChild(dv('div',S.pot+' 🪙','font-size:26px;font-weight:bold;color:#2b7a4a;text-align:center;margin:8px 0 2px;'));var diff=S.pot-S.potBasis;var sub=dv('div',S.pot>0?('もとで '+S.potBasis+'🪙 ・ '+S.potDays+'日め ・ そんえき '+(diff>=0?'+':'')+diff+'🪙'):'なにも あずけていないよ','font-size:12px;text-align:center;margin-bottom:8px;');sub.style.color=diff<0?'#c66':'#789';pc.appendChild(sub);
 var dep=dv('div',null,'display:flex;gap:8px;justify-content:center;flex-wrap:wrap;');function db(l,a){var b=dv('button',l,'border:none;background:#74c97e;color:#fff;border-radius:12px;padding:8px 14px;font-size:13px;font-weight:bold;');b.onclick=function(){if(S.coins<a){showToast('コインが たりない','#c66');return;}S.coins-=a;S.pot+=a;S.potBasis+=a;G.persist();render();};return b;}dep.appendChild(db('+10 あずける',10));dep.appendChild(db('+50 あずける',50));pc.appendChild(dep);
 var act=dv('div',null,'display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:10px;');var pass=dv('button','⏩ 7日 すごす','border:none;background:#f5b94e;color:#fff;border-radius:12px;padding:8px 14px;font-size:13px;font-weight:bold;');pass.onclick=function(){if(S.pot<=0){showToast('ポットが からっぽ','#c66');return;}for(var d=0;d<7;d++){var r=(Math.random()*0.07)-0.025;S.pot=Math.max(0,S.pot*(1+r));}S.pot=Math.round(S.pot);S.potDays+=7;var df=S.pot-S.potBasis;showToast(df>=0?('7日たった！ +'+df+'🪙'):('7日たった… '+df+'🪙'),df>=0?'#2b7a4a':'#c66');G.persist();render();};act.appendChild(pass);var wd=dv('button','💰 ぜんぶ ひきだす','border:none;background:#7cc6f0;color:#fff;border-radius:12px;padding:8px 14px;font-size:13px;font-weight:bold;');wd.onclick=function(){if(S.pot<=0){showToast('ポットが からっぽ','#c66');return;}var df=S.pot-S.potBasis;S.coins+=S.pot;showToast(df>=0?('ひきだし +'+df+'🪙ふえた！'):('ひきだし '+df+'🪙へった…'),df>=0?'#2b7a4a':'#c66');S.pot=0;S.potDays=0;S.potBasis=0;G.persist();render();};act.appendChild(wd);pc.appendChild(act);pc.appendChild(dv('div','※ じゅくせいで ふえることが多いけど、へることもある（リスク）','font-size:11px;color:#9ab;margin-top:8px;text-align:center;'));body.appendChild(pc);
 var note=dv('div',null,'width:100%;max-width:400px;margin-top:12px;background:#fff4f4;border-radius:14px;padding:12px;font-size:12px;color:#a55;line-height:1.5;');note.textContent='💡 ぜんぶ つかうと いまは たのしいけど、あとで アイテムが かえなくなる。すこし あずけて じゅくせいさせると、しょうらい ふえるかも。';body.appendChild(note);
}
function render(){if(!body)return;body.innerHTML='';coinChip.textContent=S.coins+' 🪙';Object.keys(tabBtns).forEach(function(k){tabBtns[k].style.color=(k===current)?'#2b9adb':'#9ab';});if(current==='home')renderHome();else if(current==='shop')renderShop();else if(current==='items')renderItems();else renderMoney();}
function openApp(){if(app){closeApp();}markVisitToday();current='home';buildApp();render();}
window.__PG.open=openApp;
function hookCard(){var pc=document.getElementById('pet-card');if(pc&&!pc.__pgHook){pc.__pgHook=true;pc.style.cursor='pointer';pc.title='タップで そだてる ゲームをひらく';pc.addEventListener('click',function(){openApp();});var hint=document.getElementById('pet-mood');}}
hookCard();setTimeout(hookCard,1500);setInterval(hookCard,4000);
})();

})();

;

/* ===== Release #6: いちば (in-game market) module — additive, independent boot ===== */
(function(){
  if(window.__PG_MKT_BOOTED) return;
  function boot(){
    var PG = window.__PG;
    if(!PG || !PG.S){ return setTimeout(boot, 600); }
    if(window.__PG_MKT_BOOTED) return;
    window.__PG_MKT_BOOTED = true;
    var S = PG.S;
    var STOCKS = [
      {id:'apl', emoji:'🍎', name:'りんご商事', base:40, vol:0.18, trend:0.02},
      {id:'rkt', emoji:'🚀', name:'ロケット技研', base:80, vol:0.32, trend:0.04},
      {id:'grn', emoji:'🌱', name:'みどり農園', base:25, vol:0.10, trend:0.01},
      {id:'gam', emoji:'🎮', name:'あそびゲームズ', base:55, vol:0.24, trend:0.0}
    ];
    function avgBase(){ var s=0; STOCKS.forEach(function(x){s+=x.base;}); return s/STOCKS.length; }
    function initMkt(){
      if(!S._mkt){ S._mkt={day:1, price:{}, prev:{}, hold:{}, cost:{}, hist:[]}; }
      var m=S._mkt;
      STOCKS.forEach(function(x){
        if(m.price[x.id]==null) m.price[x.id]=x.base;
        if(m.hold[x.id]==null) m.hold[x.id]=0;
        if(m.cost[x.id]==null) m.cost[x.id]=0;
      });
      if(!m.hist||!m.hist.length){ m.hist=[avgPrice()]; }
      return m;
    }
    function avgPrice(){ var m=S._mkt; if(!m)return avgBase(); var s=0; STOCKS.forEach(function(x){s+=(m.price[x.id]||x.base);}); return s/STOCKS.length; }
    function indexVal(){ return Math.round((avgPrice()/avgBase())*1000); }
    function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
    function advance(){
      var m=initMkt();
      STOCKS.forEach(function(x){
        m.prev[x.id]=m.price[x.id];
        var r=(Math.random()*2-1);
        var np=m.price[x.id]*(1+x.trend+r*x.vol);
        m.price[x.id]=Math.round(clamp(np,3,999));
      });
      m.day+=7;
      m.hist.push(avgPrice());
      if(m.hist.length>16) m.hist=m.hist.slice(-16);
      PG.persist && PG.persist();
      render();
    }
    function buy(id){
      var m=initMkt(); var p=Math.round(m.price[id]);
      if((S.coins||0)>=p){ S.coins-=p; m.hold[id]++; m.cost[id]+=p; PG.persist&&PG.persist(); render(); }
    }
    function sell(id){
      var m=initMkt(); var p=Math.round(m.price[id]);
      if(m.hold[id]>0){ var avgC=m.cost[id]/m.hold[id]; S.coins=(S.coins||0)+p; m.hold[id]--; m.cost[id]-=avgC; if(m.hold[id]===0)m.cost[id]=0; PG.persist&&PG.persist(); render(); }
    }
    function spark(hist){
      var w=120,h=28,n=hist.length; if(n<2)return '';
      var mn=Math.min.apply(null,hist), mx=Math.max.apply(null,hist), rg=(mx-mn)||1;
      var pts=hist.map(function(v,i){ var x=(i/(n-1))*w; var y=h-((v-mn)/rg)*h; return x.toFixed(1)+','+y.toFixed(1); }).join(' ');
      return '<svg width="'+w+'" height="'+h+'" style="vertical-align:middle"><polyline fill="none" stroke="#4a90d9" stroke-width="2" points="'+pts+'"/></svg>';
    }
    function modalRoot(){
      var best=null,bs=1e9;
      document.querySelectorAll('div').forEach(function(d){
        var t=d.innerText||'';
        if(t.indexOf('そだてる')>=0&&t.indexOf('ショップ')>=0&&t.indexOf('おかね')>=0&&t.indexOf('ずかん')>=0){
          if(t.length<bs){bs=t.length;best=d;}
        }
      });
      return best;
    }
    function bottomBar(){
      var root=modalRoot(); if(!root)return null;
      var bars=root.querySelectorAll('div'); var found=null;
      bars.forEach(function(d){
        var btns=d.querySelectorAll('button'); if(btns.length>=4){
          var t=d.innerText||''; if(t.indexOf('そだてる')>=0&&t.indexOf('ショップ')>=0){ found=d; }
        }
      });
      return found;
    }
    function ensureTab(){
      var bar=bottomBar(); if(!bar)return;
      if(bar.querySelector('#mktTabBtn'))return;
      var btns=bar.querySelectorAll('button'); if(!btns.length)return;
      var last=btns[btns.length-1];
      var b=last.cloneNode(true);
      b.id='mktTabBtn';
      b.innerHTML='📈<br>いちば';
      b.onclick=function(){ S._mktTab=true; showPanel(); };
      bar.appendChild(b);
      Array.prototype.forEach.call(btns,function(ob){ if(ob.id==='mktTabBtn')return; ob.addEventListener('click',function(){ S._mktTab=false; hidePanel(); }); });
    }
    function contentArea(){
      var root=modalRoot(); if(!root)return null;
      return root;
    }
    var PANEL_ID='mktPanel';
    function hidePanel(){ var p=document.getElementById(PANEL_ID); if(p)p.style.display='none'; }
    function showPanel(){ render(); var p=document.getElementById(PANEL_ID); if(p)p.style.display='block'; }
    function render(){
      if(!S._mktTab)return;
      initMkt();
      var root=modalRoot(); if(!root)return;
      var p=document.getElementById(PANEL_ID);
      if(!p){
        p=document.createElement('div'); p.id=PANEL_ID;
        p.style.cssText='position:absolute;left:0;top:0;right:0;bottom:0;overflow:auto;background:#f3f8ff;z-index:5;padding:16px 16px 96px;box-sizing:border-box;font-family:inherit';
        var host=root; var cs=getComputedStyle(host); if(cs.position==='static')host.style.position='relative';
        host.appendChild(p);
      }
      var m=S._mkt;
      var iv=indexVal(); var pv=m.hist.length>1?Math.round((m.hist[m.hist.length-2]/avgBase())*1000):iv;
      var up=iv>=pv; var arrow=up?'▲':'▼';
      var html='';
      html+='<div style="font-size:20px;font-weight:bold;color:#2c5f8a;margin-bottom:4px">📈 いちば</div>';
      html+='<div style="font-size:13px;color:#666;margin-bottom:2px">'+m.day+'日め ・ やすく かって たかく うろう</div>';
      html+='<div style="display:inline-block;background:#fff;border-radius:12px;padding:4px 12px;font-size:13px;color:#444;margin-bottom:10px">さいふ: '+(S.coins||0)+' 🌑</div>';
      html+='<div style="background:#fff;border-radius:14px;padding:12px;margin-bottom:12px;box-shadow:0 2px 6px rgba(0,0,0,0.06)">';
      html+='<div style="font-size:13px;color:#888">いちば へいきん（しすう）</div>';
      html+='<div style="font-size:26px;font-weight:bold;color:'+(up?'#e0533d':'#3aa657')+'">'+iv+' <span style="font-size:16px">'+arrow+'</span></div>';
      html+='<div>'+spark(m.hist.map(function(v){return (v/avgBase())*1000;}))+'</div></div>';
      STOCKS.forEach(function(x){
        var pr=Math.round(m.price[x.id]); var pp=Math.round(m.prev[x.id]||pr);
        var chg=pp?Math.round(((pr-pp)/pp)*100):0; var cu=chg>=0;
        var hold=m.hold[x.id]||0; var cost=m.cost[x.id]||0;
        var pl=hold>0?Math.round(pr*hold-cost):0;
        html+='<div style="background:#fff;border-radius:14px;padding:12px;margin-bottom:10px;box-shadow:0 2px 6px rgba(0,0,0,0.06)">';
        html+='<div style="display:flex;justify-content:space-between;align-items:center">';
        html+='<div style="font-size:15px;font-weight:bold">'+x.emoji+' '+x.name+'</div>';
        html+='<div style="text-align:right"><span style="font-size:18px;font-weight:bold">'+pr+'🌑</span> <span style="font-size:12px;color:'+(cu?'#e0533d':'#3aa657')+'">'+(cu?'↑':'↓')+Math.abs(chg)+'%</span></div></div>';
        html+='<div style="font-size:12px;color:#777;margin:4px 0">もってる: '+hold+'かぶ ・ そんえき: '+(pl>=0?'+':'')+pl+'🌑</div>';
        html+='<div style="display:flex;gap:8px"><button data-buy="'+x.id+'" style="flex:1;border:none;border-radius:10px;padding:8px;background:#5b9bd5;color:#fff;font-size:14px;font-weight:bold">かう</button>';
        html+='<button data-sell="'+x.id+'" style="flex:1;border:none;border-radius:10px;padding:8px;background:#f0a04b;color:#fff;font-size:14px;font-weight:bold">うる</button></div></div>';
      });
      html+='<button id="mktAdv" style="width:100%;border:none;border-radius:12px;padding:12px;background:#7c5fc4;color:#fff;font-size:15px;font-weight:bold;margin:6px 0 12px">⏩ 1しゅうかん すすめる</button>';
      html+='<div style="font-size:12px;color:#888;line-height:1.6;background:#fff;border-radius:12px;padding:12px">やすい ときに かって、たかい ときに うると おかねが ふえる。ひとつに あつめず わけると あんしん。あがりつづける とは かぎらない（リスク）。</div>';
      p.innerHTML=html;
      p.querySelectorAll('[data-buy]').forEach(function(b){ b.onclick=function(){ buy(b.getAttribute('data-buy')); }; });
      p.querySelectorAll('[data-sell]').forEach(function(b){ b.onclick=function(){ sell(b.getAttribute('data-sell')); }; });
      var adv=p.querySelector('#mktAdv'); if(adv)adv.onclick=advance;
    }
    initMkt();
    window.__MKT_IV=setInterval(function(){
      if(!window.__PG_MKT_BOOTED)return;
      ensureTab();
      if(S._mktTab){ var p=document.getElementById(PANEL_ID); if(!p||p.style.display==='none'){ showPanel(); } }
    },500);
  }
  boot();
})();

;

/* ===== Release #6.1: いちば fix — robust bar/host detection (additive, independent boot) ===== */
(function(){
  if(window.__PG_MKT2_BOOTED) return;
  function boot(){
    var PG=window.__PG;
    if(!PG||!PG.S){ return setTimeout(boot,600); }
    if(window.__PG_MKT2_BOOTED) return;
    window.__PG_MKT2_BOOTED=true;
    if(window.__MKT_IV){ try{clearInterval(window.__MKT_IV);}catch(e){} }
    var S=PG.S;
    var STOCKS=[
      {id:'apl',emoji:'🍎',name:'りんご商事',base:40,vol:0.18,trend:0.02},
      {id:'rkt',emoji:'🚀',name:'ロケット技研',base:80,vol:0.32,trend:0.04},
      {id:'grn',emoji:'🌱',name:'みどり農園',base:25,vol:0.10,trend:0.01},
      {id:'gam',emoji:'🎮',name:'あそびゲームズ',base:55,vol:0.24,trend:0.0}
    ];
    function avgBase(){var s=0;STOCKS.forEach(function(x){s+=x.base;});return s/STOCKS.length;}
    function initMkt(){
      if(!S._mkt){S._mkt={day:1,price:{},prev:{},hold:{},cost:{},hist:[]};}
      var m=S._mkt;
      STOCKS.forEach(function(x){
        if(m.price[x.id]==null)m.price[x.id]=x.base;
        if(m.hold[x.id]==null)m.hold[x.id]=0;
        if(m.cost[x.id]==null)m.cost[x.id]=0;
      });
      if(!m.hist||!m.hist.length)m.hist=[avgPrice()];
      return m;
    }
    function avgPrice(){var m=S._mkt;if(!m)return avgBase();var s=0;STOCKS.forEach(function(x){s+=(m.price[x.id]||x.base);});return s/STOCKS.length;}
    function indexVal(){return Math.round((avgPrice()/avgBase())*1000);}
    function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
    function advance(){
      var m=initMkt();
      STOCKS.forEach(function(x){
        m.prev[x.id]=m.price[x.id];
        var r=(Math.random()*2-1);
        m.price[x.id]=Math.round(clamp(m.price[x.id]*(1+x.trend+r*x.vol),3,999));
      });
      m.day+=7;m.hist.push(avgPrice());if(m.hist.length>16)m.hist=m.hist.slice(-16);
      PG.persist&&PG.persist();render();
    }
    function buy(id){var m=initMkt();var p=Math.round(m.price[id]);if((S.coins||0)>=p){S.coins-=p;m.hold[id]++;m.cost[id]+=p;PG.persist&&PG.persist();render();}}
    function sell(id){var m=initMkt();var p=Math.round(m.price[id]);if(m.hold[id]>0){var a=m.cost[id]/m.hold[id];S.coins=(S.coins||0)+p;m.hold[id]--;m.cost[id]-=a;if(m.hold[id]===0)m.cost[id]=0;PG.persist&&PG.persist();render();}}
    function spark(hist){
      var w=120,h=28,n=hist.length;if(n<2)return '';
      var mn=Math.min.apply(null,hist),mx=Math.max.apply(null,hist),rg=(mx-mn)||1;
      var pts=hist.map(function(v,i){return ((i/(n-1))*w).toFixed(1)+','+(h-((v-mn)/rg)*h).toFixed(1);}).join(' ');
      return '<svg width="'+w+'" height="'+h+'" style="vertical-align:middle"><polyline fill="none" stroke="#4a90d9" stroke-width="2" points="'+pts+'"/></svg>';
    }
    function findBar(){
      var cand=null;
      document.querySelectorAll('div').forEach(function(d){
        var kids=Array.prototype.filter.call(d.children,function(c){return c.tagName==='BUTTON';});
        if(kids.length>=4){
          var txt=kids.map(function(k){return k.innerText;}).join('');
          if(txt.indexOf('そだてる')>=0&&txt.indexOf('ショップ')>=0&&txt.indexOf('ずかん')>=0)cand=d;
        }
      });
      return cand;
    }
    var PANEL_ID='mktPanel';
    function hidePanel(){var p=document.getElementById(PANEL_ID);if(p)p.style.display='none';}
    function showPanel(){render();var p=document.getElementById(PANEL_ID);if(p)p.style.display='block';}
    function ensureTab(){
      var bar=findBar();if(!bar)return;
      if(bar.querySelector('#mktTabBtn'))return;
      var btns=Array.prototype.filter.call(bar.children,function(c){return c.tagName==='BUTTON';});
      if(!btns.length)return;
      var last=btns[btns.length-1];
      var b=last.cloneNode(true);
      b.id='mktTabBtn';b.innerHTML='📈<br>いちば';
      b.onclick=function(){S._mktTab=true;showPanel();};
      bar.appendChild(b);
      btns.forEach(function(ob){ob.addEventListener('click',function(){S._mktTab=false;hidePanel();});});
    }
    function render(){
      if(!S._mktTab)return;
      initMkt();
      var bar=findBar();if(!bar)return;
      var host=bar.parentElement;if(!host)return;
      var p=document.getElementById(PANEL_ID);
      if(!p){
        p=document.createElement('div');p.id=PANEL_ID;
        p.style.cssText='position:absolute;left:0;top:0;right:0;bottom:0;overflow:auto;background:#f3f8ff;z-index:5;padding:16px 16px 110px;box-sizing:border-box;font-family:inherit';
        if(getComputedStyle(host).position==='static')host.style.position='relative';
        host.appendChild(p);
      }
      var m=S._mkt;
      var iv=indexVal();var pv=m.hist.length>1?Math.round((m.hist[m.hist.length-2]/avgBase())*1000):iv;
      var up=iv>=pv;
      var html='';
      html+='<div style="max-width:560px;margin:0 auto">';
      html+='<div style="font-size:20px;font-weight:bold;color:#2c5f8a;margin-bottom:4px">📈 いちば</div>';
      html+='<div style="font-size:13px;color:#666;margin-bottom:2px">'+m.day+'日め ・ やすく かって たかく うろう</div>';
      html+='<div style="display:inline-block;background:#fff;border-radius:12px;padding:4px 12px;font-size:13px;color:#444;margin-bottom:10px">さいふ: '+(S.coins||0)+' 🌑</div>';
      html+='<div style="background:#fff;border-radius:14px;padding:12px;margin-bottom:12px;box-shadow:0 2px 6px rgba(0,0,0,0.06)">';
      html+='<div style="font-size:13px;color:#888">いちば へいきん（しすう）</div>';
      html+='<div style="font-size:26px;font-weight:bold;color:'+(up?'#e0533d':'#3aa657')+'">'+iv+' <span style="font-size:16px">'+(up?'▲':'▼')+'</span></div>';
      html+='<div>'+spark(m.hist.map(function(v){return (v/avgBase())*1000;}))+'</div></div>';
      STOCKS.forEach(function(x){
        var pr=Math.round(m.price[x.id]);var pp=Math.round(m.prev[x.id]||pr);
        var chg=pp?Math.round(((pr-pp)/pp)*100):0;var cu=chg>=0;
        var hold=m.hold[x.id]||0;var cost=m.cost[x.id]||0;var pl=hold>0?Math.round(pr*hold-cost):0;
        html+='<div style="background:#fff;border-radius:14px;padding:12px;margin-bottom:10px;box-shadow:0 2px 6px rgba(0,0,0,0.06)">';
        html+='<div style="display:flex;justify-content:space-between;align-items:center">';
        html+='<div style="font-size:15px;font-weight:bold">'+x.emoji+' '+x.name+'</div>';
        html+='<div style="text-align:right"><span style="font-size:18px;font-weight:bold">'+pr+'🌑</span> <span style="font-size:12px;color:'+(cu?'#e0533d':'#3aa657')+'">'+(cu?'↑':'↓')+Math.abs(chg)+'%</span></div></div>';
        html+='<div style="font-size:12px;color:#777;margin:4px 0">もってる: '+hold+'かぶ ・ そんえき: '+(pl>=0?'+':'')+pl+'🌑</div>';
        html+='<div style="display:flex;gap:8px"><button data-buy="'+x.id+'" style="flex:1;border:none;border-radius:10px;padding:8px;background:#5b9bd5;color:#fff;font-size:14px;font-weight:bold">かう</button>';
        html+='<button data-sell="'+x.id+'" style="flex:1;border:none;border-radius:10px;padding:8px;background:#f0a04b;color:#fff;font-size:14px;font-weight:bold">うる</button></div></div>';
      });
      html+='<button id="mktAdv" style="width:100%;border:none;border-radius:12px;padding:12px;background:#7c5fc4;color:#fff;font-size:15px;font-weight:bold;margin:6px 0 12px">⏩ 1しゅうかん すすめる</button>';
      html+='<div style="font-size:12px;color:#888;line-height:1.6;background:#fff;border-radius:12px;padding:12px">やすい ときに かって、たかい ときに うると おかねが ふえる。ひとつに あつめず わけると あんしん。あがりつづける とは かぎらない（リスク）。</div>';
      html+='</div>';
      p.innerHTML=html;
      p.querySelectorAll('[data-buy]').forEach(function(b){b.onclick=function(){buy(b.getAttribute('data-buy'));};});
      p.querySelectorAll('[data-sell]').forEach(function(b){b.onclick=function(){sell(b.getAttribute('data-sell'));};});
      var adv=p.querySelector('#mktAdv');if(adv)adv.onclick=advance;
    }
    initMkt();
    window.__MKT_IV=setInterval(function(){
      if(!window.__PG_MKT2_BOOTED)return;
      ensureTab();
      if(S._mktTab){var p=document.getElementById(PANEL_ID);if(!p||p.style.display==='none')showPanel();}
    },500);
  }
  boot();
})();

;

/* ===== Release #7: いちば リアル市場 — news, dividends, cycle, crash, fee, candle chart (additive) ===== */
(function(){
  if(window.__PG_MKT3_BOOTED) return;
  function boot(){
    var PG=window.__PG;
    if(!PG||!PG.S){ return setTimeout(boot,600); }
    if(window.__PG_MKT3_BOOTED) return;
    window.__PG_MKT3_BOOTED=true;
    if(window.__MKT_IV){ try{clearInterval(window.__MKT_IV);}catch(e){} }
    var oldBtn=document.getElementById('mktTabBtn'); if(oldBtn)oldBtn.remove();
    var S=PG.S;
    var FEE=0.0; // buy/sell fee rate (kept 0 for kids; cost shown via spread-free)
    var STOCKS=[
      {id:'apl',emoji:'🍎',name:'りんご商事',base:40,vol:0.14,trend:0.015,div:0.03,
        good:['🍎 しんしょうひん 大ヒット！','🍎 うりあげ さいこう記録！'],
        bad:['🍎 きょうそう はげしい…','🍎 ふぐあい が みつかった…']},
      {id:'rkt',emoji:'🚀',name:'ロケット技研',base:80,vol:0.28,trend:0.03,div:0.01,
        good:['🚀 うちあげ 大せいこう！','🚀 あたらしい けいやく ゲット！'],
        bad:['🚀 うちあげ えんき…','🚀 ぶひん が たりない…']},
      {id:'grn',emoji:'🌱',name:'みどり農園',base:25,vol:0.08,trend:0.01,div:0.05,
        good:['🌱 ほうさく！ やさい たくさん','🌱 ゆうき やさい にんき！'],
        bad:['🌱 ながあめ で しゅうかく へる…','🌱 がいちゅう はっせい…']},
      {id:'gam',emoji:'🎮',name:'あそびゲームズ',base:55,vol:0.22,trend:0.0,div:0.02,
        good:['🎮 あたらしい ゲーム 大人気！','🎮 せかいで ヒット中！'],
        bad:['🎮 はつばい えんき…','🎮 バグ が みつかった…']}
    ];
    var CYC={
      boom:{label:'好況',emoji:'☀️',bias:0.04,color:'#e0533d'},
      norm:{label:'ふつう',emoji:'⛅',bias:0.0,color:'#777'},
      bust:{label:'不況',emoji:'🌧️',bias:-0.04,color:'#3aa657'}
    };
    function avgBase(){var s=0;STOCKS.forEach(function(x){s+=x.base;});return s/STOCKS.length;}
    function avgPrice(){var m=S._mkt;if(!m)return avgBase();var s=0;STOCKS.forEach(function(x){s+=(m.price[x.id]||x.base);});return s/STOCKS.length;}
    function indexVal(){return Math.round((avgPrice()/avgBase())*1000);}
    function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
    function initMkt(){
      if(!S._mkt){S._mkt={day:1,price:{},prev:{},hold:{},cost:{},hist:[]};}
      var m=S._mkt;
      STOCKS.forEach(function(x){
        if(m.price[x.id]==null)m.price[x.id]=x.base;
        if(m.hold[x.id]==null)m.hold[x.id]=0;
        if(m.cost[x.id]==null)m.cost[x.id]=0;
      });
      if(!m.hist||!m.hist.length)m.hist=[avgPrice()];
      if(!m.cyc)m.cyc='norm';
      if(!m.news)m.news={};
      if(!m.candle)m.candle={};
      STOCKS.forEach(function(x){ if(!m.candle[x.id])m.candle[x.id]=[]; });
      if(m.lastDiv==null)m.lastDiv=0;
      if(!m.log)m.log=[];
      return m;
    }
    function stepCycle(m){
      var r=Math.random();
      if(m.cyc==='norm'){ if(r<0.18)m.cyc='boom'; else if(r<0.36)m.cyc='bust'; }
      else if(m.cyc==='boom'){ if(r<0.45)m.cyc='norm'; else if(r<0.5)m.cyc='bust'; }
      else if(m.cyc==='bust'){ if(r<0.45)m.cyc='norm'; else if(r<0.5)m.cyc='boom'; }
    }
    function advance(){
      var m=initMkt();
      stepCycle(m);
      var crash = Math.random()<0.06; // rare crash
      var bias = CYC[m.cyc].bias + (crash?-0.25:0);
      m.news={};
      STOCKS.forEach(function(x){
        m.prev[x.id]=m.price[x.id];
        var r=(Math.random()*2-1);
        var ev=0, msg=null;
        var er=Math.random();
        if(er<0.16){ ev=0.12+Math.random()*0.18; msg=x.good[Math.floor(Math.random()*x.good.length)]; }
        else if(er<0.30){ ev=-(0.12+Math.random()*0.18); msg=x.bad[Math.floor(Math.random()*x.bad.length)]; }
        if(msg)m.news[x.id]=msg;
        var chg = x.trend + bias + r*x.vol + ev;
        var open=m.price[x.id];
        var np=Math.round(clamp(open*(1+chg),3,9999));
        var hi=Math.round(clamp(Math.max(open,np)*(1+Math.random()*x.vol*0.5),3,9999));
        var lo=Math.round(clamp(Math.min(open,np)*(1-Math.random()*x.vol*0.5),3,9999));
        m.price[x.id]=np;
        m.candle[x.id].push({o:open,c:np,h:hi,l:lo});
        if(m.candle[x.id].length>14)m.candle[x.id]=m.candle[x.id].slice(-14);
      });
      m.day+=7;
      m.hist.push(avgPrice());
      if(m.hist.length>16)m.hist=m.hist.slice(-16);
      // dividends every 4 weeks (~28 days)
      var divMsg=null;
      if(m.day-m.lastDiv>=28){
        var total=0;
        STOCKS.forEach(function(x){ var h=m.hold[x.id]||0; if(h>0){ total+=Math.round(m.price[x.id]*x.div*h); } });
        if(total>0){ S.coins=(S.coins||0)+total; divMsg='💰 はいとう '+total+'🌑 もらった！'; }
        m.lastDiv=m.day;
      }
      m.flash = crash?'📉 だいぼうらく！ きをつけて':(divMsg||(m.news&&Object.keys(m.news).length?null:null));
      if(crash)m.flash='📉 だいぼうらく！ みんな さがった';
      else if(divMsg)m.flash=divMsg;
      else m.flash=null;
      PG.persist&&PG.persist();
      render();
    }
    function buy(id){var m=initMkt();var p=Math.round(m.price[id]);var cost=Math.round(p*(1+FEE));if((S.coins||0)>=cost){S.coins=Math.max(0,S.coins-cost);m.hold[id]++;m.cost[id]+=cost;PG.persist&&PG.persist();render();}}
    function sell(id){var m=initMkt();var p=Math.round(m.price[id]);if(m.hold[id]>0){var a=m.cost[id]/m.hold[id];var got=Math.round(p*(1-FEE));S.coins=(S.coins||0)+got;m.hold[id]--;m.cost[id]-=a;if(m.hold[id]===0)m.cost[id]=0;PG.persist&&PG.persist();render();}}
    function spark(hist){
      var w=120,h=28,n=hist.length;if(n<2)return '';
      var mn=Math.min.apply(null,hist),mx=Math.max.apply(null,hist),rg=(mx-mn)||1;
      var pts=hist.map(function(v,i){return ((i/(n-1))*w).toFixed(1)+','+(h-((v-mn)/rg)*h).toFixed(1);}).join(' ');
      return '<svg width="'+w+'" height="'+h+'" style="vertical-align:middle"><polyline fill="none" stroke="#4a90d9" stroke-width="2" points="'+pts+'"/></svg>';
    }
    function candleChart(arr){
      if(!arr||arr.length<1)return '<div style="font-size:11px;color:#aaa">まだ きろくが ないよ</div>';
      var w=Math.max(120,arr.length*14),h=60,n=arr.length;
      var all=[];arr.forEach(function(c){all.push(c.h,c.l);});
      var mn=Math.min.apply(null,all),mx=Math.max.apply(null,all),rg=(mx-mn)||1;
      function y(v){return (h-((v-mn)/rg)*h);}
      var sw=w/n;
      var svg='<svg width="'+w+'" height="'+h+'">';
      arr.forEach(function(c,i){
        var cx=i*sw+sw/2;
        var up=c.c>=c.o;var col=up?'#e0533d':'#3aa657';
        svg+='<line x1="'+cx.toFixed(1)+'" y1="'+y(c.h).toFixed(1)+'" x2="'+cx.toFixed(1)+'" y2="'+y(c.l).toFixed(1)+'" stroke="'+col+'" stroke-width="1"/>';
        var bt=y(Math.max(c.o,c.c)),bb=y(Math.min(c.o,c.c));var bh=Math.max(1,bb-bt);
        svg+='<rect x="'+(cx-sw*0.3).toFixed(1)+'" y="'+bt.toFixed(1)+'" width="'+(sw*0.6).toFixed(1)+'" height="'+bh.toFixed(1)+'" fill="'+col+'"/>';
      });
      svg+='</svg>';
      return svg;
    }
    function findBar(){
      var cand=null;
      document.querySelectorAll('div').forEach(function(d){
        var kids=Array.prototype.filter.call(d.children,function(c){return c.tagName==='BUTTON';});
        if(kids.length>=4){
          var txt=kids.map(function(k){return k.innerText;}).join('');
          if(txt.indexOf('そだてる')>=0&&txt.indexOf('ショップ')>=0&&txt.indexOf('ずかん')>=0)cand=d;
        }
      });
      return cand;
    }
    var PANEL_ID='mktPanel';
    function hidePanel(){var p=document.getElementById(PANEL_ID);if(p)p.style.display='none';}
    function showPanel(){render();var p=document.getElementById(PANEL_ID);if(p)p.style.display='block';}
    function ensureTab(){
      var bar=findBar();if(!bar)return;
      if(bar.querySelector('#mktTabBtn'))return;
      var btns=Array.prototype.filter.call(bar.children,function(c){return c.tagName==='BUTTON';});
      if(!btns.length)return;
      var b=btns[btns.length-1].cloneNode(true);
      b.id='mktTabBtn';b.innerHTML='📈<br>いちば';
      b.onclick=function(){S._mktTab=true;showPanel();};
      bar.appendChild(b);
      btns.forEach(function(ob){ob.addEventListener('click',function(){S._mktTab=false;hidePanel();});});
    }
    function render(){
      if(!S._mktTab)return;
      initMkt();
      var bar=findBar();if(!bar)return;
      var host=bar.parentElement;if(!host)return;
      var p=document.getElementById(PANEL_ID);
      if(!p){
        p=document.createElement('div');p.id=PANEL_ID;
        p.style.cssText='position:absolute;left:0;top:0;right:0;bottom:0;overflow:auto;background:#f3f8ff;z-index:5;padding:16px 16px 110px;box-sizing:border-box;font-family:inherit';
        if(getComputedStyle(host).position==='static')host.style.position='relative';
        host.appendChild(p);
      }
      var m=S._mkt;var c=CYC[m.cyc];
      var iv=indexVal();var pv=m.hist.length>1?Math.round((m.hist[m.hist.length-2]/avgBase())*1000):iv;
      var up=iv>=pv;
      var html='<div style="max-width:560px;margin:0 auto">';
      html+='<div style="font-size:20px;font-weight:bold;color:#2c5f8a;margin-bottom:4px">📈 いちば</div>';
      html+='<div style="font-size:13px;color:#666;margin-bottom:2px">'+m.day+'日め ・ けいき: <b style="color:'+c.color+'">'+c.emoji+' '+c.label+'</b></div>';
      html+='<div style="display:inline-block;background:#fff;border-radius:12px;padding:4px 12px;font-size:13px;color:#444;margin-bottom:8px">さいふ: '+(S.coins||0)+' 🌑</div>';
      if(m.flash)html+='<div style="background:#fff4d6;border-radius:10px;padding:8px 12px;font-size:13px;color:#a06a00;margin-bottom:10px">'+m.flash+'</div>';
      html+='<div style="background:#fff;border-radius:14px;padding:12px;margin-bottom:12px;box-shadow:0 2px 6px rgba(0,0,0,0.06)">';
      html+='<div style="font-size:13px;color:#888">いちば へいきん（しすう）</div>';
      html+='<div style="font-size:26px;font-weight:bold;color:'+(up?'#e0533d':'#3aa657')+'">'+iv+' <span style="font-size:16px">'+(up?'▲':'▼')+'</span></div>';
      html+='<div>'+spark(m.hist.map(function(v){return (v/avgBase())*1000;}))+'</div></div>';
      STOCKS.forEach(function(x){
        var pr=Math.round(m.price[x.id]);var pp=Math.round(m.prev[x.id]||pr);
        var chg=pp?Math.round(((pr-pp)/pp)*100):0;var cu=chg>=0;
        var hold=m.hold[x.id]||0;var cost=m.cost[x.id]||0;var pl=hold>0?Math.round(pr*hold-cost):0;
        var news=m.news&&m.news[x.id];
        html+='<div style="background:#fff;border-radius:14px;padding:12px;margin-bottom:10px;box-shadow:0 2px 6px rgba(0,0,0,0.06)">';
        html+='<div style="display:flex;justify-content:space-between;align-items:center">';
        html+='<div style="font-size:15px;font-weight:bold">'+x.emoji+' '+x.name+' <span style="font-size:10px;color:#aaa">はいとう'+Math.round(x.div*100)+'%</span></div>';
        html+='<div style="text-align:right"><span style="font-size:18px;font-weight:bold">'+pr+'🌑</span> <span style="font-size:12px;color:'+(cu?'#e0533d':'#3aa657')+'">'+(cu?'↑':'↓')+Math.abs(chg)+'%</span></div></div>';
        if(news)html+='<div style="font-size:12px;color:#c0392b;background:#fdecea;border-radius:8px;padding:4px 8px;margin:4px 0">'+news+'</div>';
        html+='<div style="margin:6px 0">'+candleChart(m.candle[x.id])+'</div>';
        html+='<div style="font-size:12px;color:#777;margin:4px 0">もってる: '+hold+'かぶ ・ そんえき: '+(pl>=0?'+':'')+pl+'🌑</div>';
        html+='<div style="display:flex;gap:8px"><button data-buy="'+x.id+'" style="flex:1;border:none;border-radius:10px;padding:8px;background:#5b9bd5;color:#fff;font-size:14px;font-weight:bold">かう</button>';
        html+='<button data-sell="'+x.id+'" style="flex:1;border:none;border-radius:10px;padding:8px;background:#f0a04b;color:#fff;font-size:14px;font-weight:bold">うる</button></div></div>';
      });
      html+='<button id="mktAdv" style="width:100%;border:none;border-radius:12px;padding:12px;background:#7c5fc4;color:#fff;font-size:15px;font-weight:bold;margin:6px 0 12px">⏩ 1しゅうかん すすめる</button>';
      html+='<div style="font-size:12px;color:#888;line-height:1.6;background:#fff;border-radius:12px;padding:12px">けいき（☀️好況/🌧️不況）や ニュースで かぶかは うごく。もっていると はいとうが もらえる。ひとつに あつめず わけると あんしん。たまに だいぼうらくも あるよ（リスク）。</div>';
      html+='</div>';
      p.innerHTML=html;
      p.querySelectorAll('[data-buy]').forEach(function(b){b.onclick=function(){buy(b.getAttribute('data-buy'));};});
      p.querySelectorAll('[data-sell]').forEach(function(b){b.onclick=function(){sell(b.getAttribute('data-sell'));};});
      var adv=p.querySelector('#mktAdv');if(adv)adv.onclick=advance;
    }
    initMkt();
    window.__MKT_IV=setInterval(function(){
      if(!window.__PG_MKT3_BOOTED)return;
      ensureTab();
      if(S._mktTab){var p=document.getElementById(PANEL_ID);if(!p||p.style.display==='none')showPanel();}
    },500);
  }
  boot();
})();

;

/* ===== Release #8: いちば 拡張 — 6銘柄 + ポット連動 + とりひき実績 (additive, supersedes #7) ===== */
(function(){
  if(window.__PG_LINK_BOOTED) return;
  function boot(){
    var PG=window.__PG;
    if(!PG||!PG.S){ return setTimeout(boot,600); }
    if(window.__PG_LINK_BOOTED) return;
    window.__PG_LINK_BOOTED=true;
    if(window.__MKT_IV){ try{clearInterval(window.__MKT_IV);}catch(e){} }
    var oldBtn=document.getElementById('mktTabBtn'); if(oldBtn)oldBtn.remove();
    var S=PG.S;
    var POT_LINK=0.10; // 10% of realized profit auto-added to pot
    var STOCKS=[
      {id:'apl',emoji:'🍎',name:'りんご商事',base:40,vol:0.14,trend:0.015,div:0.03,
        good:['🍎 しんしょうひん 大ヒット！','🍎 うりあげ さいこう記録！'],bad:['🍎 きょうそう はげしい…','🍎 ふぐあい が みつかった…']},
      {id:'rkt',emoji:'🚀',name:'ロケット技研',base:80,vol:0.28,trend:0.03,div:0.01,
        good:['🚀 うちあげ 大せいこう！','🚀 あたらしい けいやく ゲット！'],bad:['🚀 うちあげ えんき…','🚀 ぶひん が たりない…']},
      {id:'grn',emoji:'🌱',name:'みどり農園',base:25,vol:0.08,trend:0.01,div:0.05,
        good:['🌱 ほうさく！ やさい たくさん','🌱 ゆうき やさい にんき！'],bad:['🌱 ながあめ で しゅうかく へる…','🌱 がいちゅう はっせい…']},
      {id:'gam',emoji:'🎮',name:'あそびゲームズ',base:55,vol:0.22,trend:0.0,div:0.02,
        good:['🎮 あたらしい ゲーム 大人気！','🎮 せかいで ヒット中！'],bad:['🎮 はつばい えんき…','🎮 バグ が みつかった…']},
      {id:'bnk',emoji:'🏦',name:'かいてい銀行',base:60,vol:0.10,trend:0.012,div:0.06,
        good:['🏦 きんり アップで もうけ ふえる！','🏦 しんよう ばつぐん！'],bad:['🏦 かしだおれ ふえた…','🏦 けいき ふあん…']},
      {id:'fud',emoji:'🍔',name:'もぐもぐフード',base:35,vol:0.16,trend:0.018,div:0.03,
        good:['🍔 あたらしい メニュー 大人気！','🍔 おみせ ぞくぞく オープン！'],bad:['🍔 ざいりょう ねあがり…','🍔 きゃく へってる…']}
    ];
    var CYC={
      boom:{label:'好況',emoji:'☀️',bias:0.04,color:'#e0533d'},
      norm:{label:'ふつう',emoji:'⛅',bias:0.0,color:'#777'},
      bust:{label:'不況',emoji:'🌧️',bias:-0.04,color:'#3aa657'}
    };
    var ACHS=[
      {id:'first_trade',emoji:'🤝',name:'はじめての とりひき'},
      {id:'first_profit',emoji:'📈',name:'はじめての もうけ'},
      {id:'dividend',emoji:'💰',name:'はいとう ゲット'},
      {id:'all_six',emoji:'🏆',name:'6しゅるい せいは'},
      {id:'pot_link',emoji:'🌱',name:'いちば→ポット れんどう'}
    ];
    function avgBase(){var s=0;STOCKS.forEach(function(x){s+=x.base;});return s/STOCKS.length;}
    function avgPrice(){var m=S._mkt;if(!m)return avgBase();var s=0;STOCKS.forEach(function(x){s+=(m.price[x.id]||x.base);});return s/STOCKS.length;}
    function indexVal(){return Math.round((avgPrice()/avgBase())*1000);}
    function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
    function initMkt(){
      if(!S._mkt){S._mkt={day:1,price:{},prev:{},hold:{},cost:{},hist:[]};}
      var m=S._mkt;
      STOCKS.forEach(function(x){
        if(m.price[x.id]==null)m.price[x.id]=x.base;
        if(m.hold[x.id]==null)m.hold[x.id]=0;
        if(m.cost[x.id]==null)m.cost[x.id]=0;
      });
      if(!m.hist||!m.hist.length)m.hist=[avgPrice()];
      if(!m.cyc)m.cyc='norm';
      if(!m.news)m.news={};
      if(!m.candle)m.candle={};
      STOCKS.forEach(function(x){ if(!m.candle[x.id])m.candle[x.id]=[]; });
      if(m.lastDiv==null)m.lastDiv=0;
      if(!m.ach)m.ach={};
      return m;
    }
    function award(id){
      var m=initMkt();
      if(m.ach[id])return;
      m.ach[id]=true;
      var a=null;for(var i=0;i<ACHS.length;i++){if(ACHS[i].id===id)a=ACHS[i];}
      if(a)m.flash=a.emoji+' じっせき「'+a.name+'」ゲット！';
      PG.persist&&PG.persist();
    }
    function stepCycle(m){
      var r=Math.random();
      if(m.cyc==='norm'){ if(r<0.18)m.cyc='boom'; else if(r<0.36)m.cyc='bust'; }
      else if(m.cyc==='boom'){ if(r<0.45)m.cyc='norm'; else if(r<0.5)m.cyc='bust'; }
      else if(m.cyc==='bust'){ if(r<0.45)m.cyc='norm'; else if(r<0.5)m.cyc='boom'; }
    }
    function advance(){
      var m=initMkt();
      stepCycle(m);
      var crash=Math.random()<0.06;
      var bias=CYC[m.cyc].bias+(crash?-0.25:0);
      m.news={};
      STOCKS.forEach(function(x){
        m.prev[x.id]=m.price[x.id];
        var r=(Math.random()*2-1);
        var ev=0,msg=null,er=Math.random();
        if(er<0.16){ev=0.12+Math.random()*0.18;msg=x.good[Math.floor(Math.random()*x.good.length)];}
        else if(er<0.30){ev=-(0.12+Math.random()*0.18);msg=x.bad[Math.floor(Math.random()*x.bad.length)];}
        if(msg)m.news[x.id]=msg;
        var chg=x.trend+bias+r*x.vol+ev;
        var open=m.price[x.id];
        var np=Math.round(clamp(open*(1+chg),3,9999));
        var hi=Math.round(clamp(Math.max(open,np)*(1+Math.random()*x.vol*0.5),3,9999));
        var lo=Math.round(clamp(Math.min(open,np)*(1-Math.random()*x.vol*0.5),3,9999));
        m.price[x.id]=np;
        m.candle[x.id].push({o:open,c:np,h:hi,l:lo});
        if(m.candle[x.id].length>14)m.candle[x.id]=m.candle[x.id].slice(-14);
      });
      m.day+=7;
      m.hist.push(avgPrice());
      if(m.hist.length>16)m.hist=m.hist.slice(-16);
      var divMsg=null;
      if(m.day-m.lastDiv>=28){
        var total=0;
        STOCKS.forEach(function(x){var h=m.hold[x.id]||0;if(h>0)total+=Math.round(m.price[x.id]*x.div*h);});
        if(total>0){S.coins=(S.coins||0)+total;divMsg='💰 はいとう '+total+'🌑 もらった！';award('dividend');}
        m.lastDiv=m.day;
      }
      if(crash)m.flash='📉 だいぼうらく！ みんな さがった';
      else if(divMsg)m.flash=divMsg;
      else m.flash=null;
      PG.persist&&PG.persist();
      render();
    }
    function buy(id){
      var m=initMkt();var p=Math.round(m.price[id]);
      if((S.coins||0)>=p){
        S.coins=Math.max(0,S.coins-p);m.hold[id]++;m.cost[id]+=p;
        award('first_trade');
        var kinds=0;STOCKS.forEach(function(x){if((m.hold[x.id]||0)>0)kinds++;});
        if(kinds>=6)award('all_six');
        PG.persist&&PG.persist();render();
      }
    }
    function sell(id){
      var m=initMkt();var p=Math.round(m.price[id]);
      if(m.hold[id]>0){
        var avgC=m.cost[id]/m.hold[id];
        var profit=p-avgC;
        S.coins=(S.coins||0)+p;m.hold[id]--;m.cost[id]-=avgC;if(m.hold[id]===0)m.cost[id]=0;
        if(profit>0){
          award('first_profit');
          var bonus=Math.round(profit*POT_LINK);
          if(bonus>0 && typeof S.pot==='number'){ S.pot=(S.pot||0)+bonus; m.flash='🌱 いちばの もうけから ポットに +'+bonus+'🌑！'; award('pot_link'); }
        }
        PG.persist&&PG.persist();render();
      }
    }
    function spark(hist){
      var w=120,h=28,n=hist.length;if(n<2)return '';
      var mn=Math.min.apply(null,hist),mx=Math.max.apply(null,hist),rg=(mx-mn)||1;
      var pts=hist.map(function(v,i){return ((i/(n-1))*w).toFixed(1)+','+(h-((v-mn)/rg)*h).toFixed(1);}).join(' ');
      return '<svg width="'+w+'" height="'+h+'" style="vertical-align:middle"><polyline fill="none" stroke="#4a90d9" stroke-width="2" points="'+pts+'"/></svg>';
    }
    function candleChart(arr){
      if(!arr||arr.length<1)return '<div style="font-size:11px;color:#aaa">まだ きろくが ないよ</div>';
      var w=Math.max(120,arr.length*14),h=60,n=arr.length;
      var all=[];arr.forEach(function(c){all.push(c.h,c.l);});
      var mn=Math.min.apply(null,all),mx=Math.max.apply(null,all),rg=(mx-mn)||1;
      function y(v){return (h-((v-mn)/rg)*h);}
      var sw=w/n,svg='<svg width="'+w+'" height="'+h+'">';
      arr.forEach(function(c,i){
        var cx=i*sw+sw/2,up=c.c>=c.o,col=up?'#e0533d':'#3aa657';
        svg+='<line x1="'+cx.toFixed(1)+'" y1="'+y(c.h).toFixed(1)+'" x2="'+cx.toFixed(1)+'" y2="'+y(c.l).toFixed(1)+'" stroke="'+col+'" stroke-width="1"/>';
        var bt=y(Math.max(c.o,c.c)),bb=y(Math.min(c.o,c.c)),bh=Math.max(1,bb-bt);
        svg+='<rect x="'+(cx-sw*0.3).toFixed(1)+'" y="'+bt.toFixed(1)+'" width="'+(sw*0.6).toFixed(1)+'" height="'+bh.toFixed(1)+'" fill="'+col+'"/>';
      });
      svg+='</svg>';return svg;
    }
    function findBar(){
      var cand=null;
      document.querySelectorAll('div').forEach(function(d){
        var kids=Array.prototype.filter.call(d.children,function(c){return c.tagName==='BUTTON';});
        if(kids.length>=4){
          var txt=kids.map(function(k){return k.innerText;}).join('');
          if(txt.indexOf('そだてる')>=0&&txt.indexOf('ショップ')>=0&&txt.indexOf('ずかん')>=0)cand=d;
        }
      });
      return cand;
    }
    var PANEL_ID='mktPanel';
    function hidePanel(){var p=document.getElementById(PANEL_ID);if(p)p.style.display='none';}
    function showPanel(){render();var p=document.getElementById(PANEL_ID);if(p)p.style.display='block';}
    function ensureTab(){
      var bar=findBar();if(!bar)return;
      if(bar.querySelector('#mktTabBtn'))return;
      var btns=Array.prototype.filter.call(bar.children,function(c){return c.tagName==='BUTTON';});
      if(!btns.length)return;
      var b=btns[btns.length-1].cloneNode(true);
      b.id='mktTabBtn';b.innerHTML='📈<br>いちば';
      b.onclick=function(){S._mktTab=true;showPanel();};
      bar.appendChild(b);
      btns.forEach(function(ob){ob.addEventListener('click',function(){S._mktTab=false;hidePanel();});});
    }
    function render(){
      if(!S._mktTab)return;
      initMkt();
      var bar=findBar();if(!bar)return;
      var host=bar.parentElement;if(!host)return;
      var p=document.getElementById(PANEL_ID);
      if(!p){
        p=document.createElement('div');p.id=PANEL_ID;
        p.style.cssText='position:absolute;left:0;top:0;right:0;bottom:0;overflow:auto;background:#f3f8ff;z-index:5;padding:16px 16px 110px;box-sizing:border-box;font-family:inherit';
        if(getComputedStyle(host).position==='static')host.style.position='relative';
        host.appendChild(p);
      }
      var m=S._mkt,c=CYC[m.cyc];
      var iv=indexVal();var pv=m.hist.length>1?Math.round((m.hist[m.hist.length-2]/avgBase())*1000):iv;
      var up=iv>=pv;
      var html='<div style="max-width:560px;margin:0 auto">';
      html+='<div style="font-size:20px;font-weight:bold;color:#2c5f8a;margin-bottom:4px">📈 いちば</div>';
      html+='<div style="font-size:13px;color:#666;margin-bottom:2px">'+m.day+'日め ・ けいき: <b style="color:'+c.color+'">'+c.emoji+' '+c.label+'</b></div>';
      html+='<div style="display:inline-block;background:#fff;border-radius:12px;padding:4px 12px;font-size:13px;color:#444;margin-bottom:8px">さいふ: '+(S.coins||0)+' 🌑 ・ ポット: '+(S.pot||0)+' 🌑</div>';
      if(m.flash)html+='<div style="background:#fff4d6;border-radius:10px;padding:8px 12px;font-size:13px;color:#a06a00;margin-bottom:10px">'+m.flash+'</div>';
      html+='<div style="background:#fff;border-radius:14px;padding:12px;margin-bottom:12px;box-shadow:0 2px 6px rgba(0,0,0,0.06)">';
      html+='<div style="font-size:13px;color:#888">いちば へいきん（しすう）</div>';
      html+='<div style="font-size:26px;font-weight:bold;color:'+(up?'#e0533d':'#3aa657')+'">'+iv+' <span style="font-size:16px">'+(up?'▲':'▼')+'</span></div>';
      html+='<div>'+spark(m.hist.map(function(v){return (v/avgBase())*1000;}))+'</div></div>';
      STOCKS.forEach(function(x){
        var pr=Math.round(m.price[x.id]);var pp=Math.round(m.prev[x.id]||pr);
        var chg=pp?Math.round(((pr-pp)/pp)*100):0;var cu=chg>=0;
        var hold=m.hold[x.id]||0;var cost=m.cost[x.id]||0;var pl=hold>0?Math.round(pr*hold-cost):0;
        var news=m.news&&m.news[x.id];
        html+='<div style="background:#fff;border-radius:14px;padding:12px;margin-bottom:10px;box-shadow:0 2px 6px rgba(0,0,0,0.06)">';
        html+='<div style="display:flex;justify-content:space-between;align-items:center">';
        html+='<div style="font-size:15px;font-weight:bold">'+x.emoji+' '+x.name+' <span style="font-size:10px;color:#aaa">はいとう'+Math.round(x.div*100)+'%</span></div>';
        html+='<div style="text-align:right"><span style="font-size:18px;font-weight:bold">'+pr+'🌑</span> <span style="font-size:12px;color:'+(cu?'#e0533d':'#3aa657')+'">'+(cu?'↑':'↓')+Math.abs(chg)+'%</span></div></div>';
        if(news)html+='<div style="font-size:12px;color:#c0392b;background:#fdecea;border-radius:8px;padding:4px 8px;margin:4px 0">'+news+'</div>';
        html+='<div style="margin:6px 0">'+candleChart(m.candle[x.id])+'</div>';
        html+='<div style="font-size:12px;color:#777;margin:4px 0">もってる: '+hold+'かぶ ・ そんえき: '+(pl>=0?'+':'')+pl+'🌑</div>';
        html+='<div style="display:flex;gap:8px"><button data-buy="'+x.id+'" style="flex:1;border:none;border-radius:10px;padding:8px;background:#5b9bd5;color:#fff;font-size:14px;font-weight:bold">かう</button>';
        html+='<button data-sell="'+x.id+'" style="flex:1;border:none;border-radius:10px;padding:8px;background:#f0a04b;color:#fff;font-size:14px;font-weight:bold">うる</button></div></div>';
      });
      html+='<button id="mktAdv" style="width:100%;border:none;border-radius:12px;padding:12px;background:#7c5fc4;color:#fff;font-size:15px;font-weight:bold;margin:6px 0 12px">⏩ 1しゅうかん すすめる</button>';
      html+='<div style="font-size:12px;color:#888;line-height:1.6;background:#fff;border-radius:12px;padding:12px">けいきや ニュースで かぶかは うごく。もうけて うると 10%が ポットにも つみたて。もっていると はいとうも もらえる。ひとつに あつめず わけると あんしん。たまに だいぼうらくも あるよ（リスク）。</div>';
      html+='</div>';
      p.innerHTML=html;
      p.querySelectorAll('[data-buy]').forEach(function(b){b.onclick=function(){buy(b.getAttribute('data-buy'));};});
      p.querySelectorAll('[data-sell]').forEach(function(b){b.onclick=function(){sell(b.getAttribute('data-sell'));};});
      var adv=p.querySelector('#mktAdv');if(adv)adv.onclick=advance;
    }
    function zukanContainer(){
      var best=null,bs=1e9;
      document.querySelectorAll('div').forEach(function(d){
        var t=d.innerText||'';
        if(t.indexOf('ずかん')>=0&&t.indexOf('ごはん')>=0&&t.indexOf('かざり')>=0&&t.indexOf('きせつ')>=0){
          if(t.length<bs){bs=t.length;best=d;}
        }
      });
      return best;
    }
    function renderAchievements(){
      var zc=zukanContainer();if(!zc)return;
      var m=initMkt();
      var ex=document.getElementById('mktAchSection');
      if(ex && !zc.contains(ex)){ ex.remove(); ex=null; }
      var done=ACHS.filter(function(a){return m.ach[a.id];}).length;
      var html='<div style="font-size:13px;font-weight:bold;color:#c87a00;margin:14px 0 6px;text-align:center">とりひき ('+done+'/'+ACHS.length+')</div>';
      html+='<div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center">';
      ACHS.forEach(function(a){
        var got=!!m.ach[a.id];
        html+='<div title="'+a.name+'" style="width:56px;height:56px;border-radius:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:'+(got?'#fff6e0':'#eee')+';opacity:'+(got?'1':'0.5')+';font-size:22px">'+(got?a.emoji:'❔')+'<span style="font-size:8px;color:#888;line-height:1;margin-top:2px;text-align:center">'+(got?a.name.replace(/ /g,''):'')+'</span></div>';
      });
      html+='</div>';
      if(!ex){
        ex=document.createElement('div');ex.id='mktAchSection';ex.style.cssText='max-width:560px;margin:8px auto 0';
        zc.appendChild(ex);
      }
      ex.innerHTML=html;
    }
    function zukanVisible(){
      var zc=zukanContainer();
      if(!zc)return false;
      return zc.offsetParent!==null && (zc.innerText||'').indexOf('ごはん')>=0 && !S._mktTab;
    }
    initMkt();
    window.__MKT_IV=setInterval(function(){
      if(!window.__PG_LINK_BOOTED)return;
      ensureTab();
      if(S._mktTab){var p=document.getElementById(PANEL_ID);if(!p||p.style.display==='none')showPanel();}
      else { if(zukanVisible())renderAchievements(); }
    },500);
  }
  boot();
})();

