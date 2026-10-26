/* Isolated source-image Canvas2D proof. No game state or storage access. */
(async function(){
'use strict';
const B=window.PetBodySourceBasis,$=id=>document.getElementById(id),canvas=$('bodyCanvas'),ctx=canvas.getContext('2d');
const state={stage:'baby',matte:'#edf5e9',labels:true,region:'torso',ready:false};
let data,manifestSHA,images={},snapshot,sequence=0;
const digest=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(v=>v.toString(16).padStart(2,'0')).join('');
async function bytes(url,sha){const r=await fetch(url);if(!r.ok)throw Error('source_HTTP');const b=await r.arrayBuffer();if(sha&&await digest(b)!==sha)throw Error('source_SHA');return b;}
function text(s,x,y,color,size){ctx.font='600 '+size+'px system-ui';ctx.lineWidth=5;ctx.strokeStyle='rgba(255,255,255,.95)';ctx.strokeText(s,x,y);ctx.fillStyle=color;ctx.fillText(s,x,y);}
function line(a,b,color,width){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();}
function render(){
 if(!state.ready)return;
 const z=B.snapshot(data,state.stage,state,manifestSHA),v=z.viewport,c=data.cases[state.stage],f=z.frame;
 ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle=state.matte;ctx.fillRect(0,0,1254,1254);
 ctx.save();ctx.beginPath();ctx.rect(v.offset[0],v.offset[1],(v.crop[2]-v.crop[0])*v.scale,(v.crop[3]-v.crop[1])*v.scale);ctx.clip();
 ctx.translate(v.offset[0],v.offset[1]);ctx.scale(v.scale,v.scale);ctx.translate(-v.crop[0],-v.crop[1]);ctx.drawImage(images[state.stage],0,0);
 if(state.labels){
  ctx.lineWidth=3/v.scale;
  for(const u of c.unresolved){if(!u.roi)continue;ctx.setLineDash([6/v.scale,5/v.scale]);ctx.strokeStyle='#996525';ctx.strokeRect(u.roi[0],u.roi[1],u.roi[2]-u.roi[0],u.roi[3]-u.roi[1]);ctx.setLineDash([]);}
  const p=f.origin.map(x=>x+.5),end=(axis,n)=>[p[0]+axis[0]*n,p[1]+axis[1]*n];
  line(end(f.xAxis,-f.chordLengthPx/2),end(f.xAxis,f.chordLengthPx/2),'#295b7d',3/v.scale);
  line(p,end(f.yAxis,92),'#236a57',3/v.scale);
  text('u →',...end(f.xAxis,105),'#295b7d',27/v.scale);text('v ↓',...end(f.yAxis,92),'#236a57',27/v.scale);
  for(const l of c.landmarks){
   const a=l.px.map(x=>x+.5),color=l.screenSide==='screen-left'?'#355d91':l.screenSide==='screen-right'?'#9a4d71':'#236a57';
   ctx.lineWidth=3/v.scale;ctx.strokeStyle=color;ctx.beginPath();ctx.ellipse(a[0],a[1],...l.uncertaintyRadiusPx,0,0,Math.PI*2);ctx.stroke();
   line([a[0]-4,a[1]],[a[0]+4,a[1]],color,3/v.scale);line([a[0],a[1]-4],[a[0],a[1]+4],color,3/v.scale);
   text(l.tag,a[0]+l.labelOffsetPx[0],a[1]+l.labelOffsetPx[1],color,27/v.scale);
  }
 }
 ctx.restore();ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='rgba(255,255,255,.95)';ctx.fillRect(0,0,1254,94);
 text((state.stage==='baby'?'赤ちゃん':'育った姿')+' · 画面上の目印（奥行き不明）',24,38,'#344e45',27);
 text('u/v は前足間の画像座標。肩・首の身体接合点ではありません。',24,72,'#566458',20);
 snapshot={...z,renderSequence:++sequence,pngWidth:1254,pngHeight:1254,sourceBytesVerified:true};
 $('proof').textContent=JSON.stringify(snapshot,null,2);document.body.dataset.stage=state.stage;document.body.dataset.region=state.region;document.body.dataset.manifest=manifestSHA;document.body.dataset.renderSequence=String(sequence);
 $('metrics').replaceChildren(...snapshot.landmarks.map(l=>{const tr=document.createElement('tr');for(const t of [l.tag+' '+l.label,JSON.stringify(l.px),l.localPx.map(n=>n.toFixed(2)).join(', '),'±'+l.uncertaintyRadiusPx.join('/')+' px',l.note]){const td=document.createElement('td');td.textContent=t;tr.append(td);}return tr;}));
 $('hidden').replaceChildren(...c.unresolved.map(u=>{const li=document.createElement('li');li.textContent=u.label+'：'+u.note;return li;}));
 $('identity').textContent=state.stage+' / 1254×1254 / SHA-256 '+c.source.sha256;
 $('captureResult').textContent='';delete $('captureResult').dataset.receipt;$('capture').disabled=false;
}
async function capture(){
 if(!state.ready||!snapshot)return;$('capture').disabled=true;
 const metadata=JSON.parse(JSON.stringify(snapshot)),png=canvas.toDataURL('image/png'),label='body_'+metadata.stage+'_'+metadata.region+(metadata.labels?'_guides':'_plain');
 try{
  if(['127.0.0.1','localhost'].includes(location.hostname)){
   const r=await fetch('/__qa/capture-body-basis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label,manifest_sha256:manifestSHA,metadata,png_data_url:png})});
   if(!r.ok)throw Error('capture_HTTP');const saved=await r.json();
   if(saved.saved!==true||!/^[a-f0-9]{64}$/.test(saved.PNG_sha256)||saved.width!==1254||saved.height!==1254)throw Error('capture_receipt');
   $('captureResult').textContent='実描画を保存しました。';$('captureResult').dataset.receipt=JSON.stringify(saved);
  }else{const a=document.createElement('a');a.href=png;a.download=label+'.png';a.textContent='PNGをダウンロード';$('captureResult').replaceChildren(a);}
 }catch(e){$('captureResult').textContent='保存を確認できませんでした。';$('captureResult').dataset.errorCode='capture_failed';}
 finally{$('capture').disabled=false;}
}
try{
 const mb=await bytes(new URL('./input-manifest.json',location.href)),manifest=JSON.parse(new TextDecoder().decode(mb));manifestSHA=await digest(mb);
 data=JSON.parse(new TextDecoder().decode(await bytes(new URL('./basis-data-v1.json',location.href),manifest.own_sources.find(x=>x.path==='basis-data-v1.json').sha256)));B.validate(data);
 for(const stage of ['baby','adult']){
  const c=data.cases[stage],b=await bytes(new URL(c.source.src,location.href),c.source.sha256),im=new Image(),url=URL.createObjectURL(new Blob([b],{type:'image/png'}));
  try{im.src=url;await im.decode();}finally{URL.revokeObjectURL(url);}
  if(im.naturalWidth!==1254||im.naturalHeight!==1254)throw Error('source_dimensions');images[stage]=im;
 }
 for(const key of ['stage','matte','region'])document.querySelectorAll('[data-'+key+']').forEach(b=>b.addEventListener('click',()=>{state[key]=b.dataset[key];document.querySelectorAll('[data-'+key+']').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));render();}));
 $('labels').addEventListener('change',()=>{state.labels=$('labels').checked;render();});$('capture').addEventListener('click',capture);
 canvas.addEventListener('click',e=>{if(!snapshot)return;const r=canvas.getBoundingClientRect(),p=B.canvasToSource(snapshot.viewport,[(e.clientX-r.left)*1254/r.width,(e.clientY-r.top)*1254/r.height]);$('probe').textContent=p?'読取座標 x='+p[0].toFixed(2)+', y='+p[1].toFixed(2)+' px（目印は変更しません）':'画像の外側です。';});
 state.ready=true;document.body.dataset.status='ready';$('status').textContent='元画像2枚のSHA・寸法を照合済み。身体側の画像座標見本です。';render();
}catch(e){state.ready=false;document.body.dataset.status='error';$('status').textContent='元データの照合を完了できませんでした。';$('capture').disabled=true;}
}());
