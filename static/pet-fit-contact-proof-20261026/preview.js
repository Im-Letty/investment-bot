/* Isolated source-pose comparison; no game state or storage access. */
(async function(){
'use strict';
const V1=window.PetFitPrerequisite,V2=window.PetFitMaskRefinement,D=window.PetFitContactDiagnostics;
const oldBase=new URL('../pet-fit-mask-refinement-20261026/',location.href);
const state={stage:'baby',matte:'#edf5e9',overlay:true,region:null,ready:false};let baseline,mask,data,manifestSHA,images,results,lastSnapshot;
const $=id=>document.getElementById(id),canvases={fixed:$('fixed'),control:$('control')};
function fail(e){state.ready=false;document.body.dataset.status='error';$('status').textContent='照合を完了できませんでした。保存は行えません。';console.error(String(e.message||e));}
async function digest(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');}
async function getJSON(url,expected){const r=await fetch(url);if(!r.ok)throw Error('source_HTTP_'+r.status);const bytes=await r.arrayBuffer();if(expected&&await digest(bytes)!==expected)throw Error('source_SHA_mismatch');return {data:JSON.parse(new TextDecoder().decode(bytes)),bytes};}
async function image(url,sha){const r=await fetch(url);if(!r.ok)throw Error('image_HTTP_'+r.status);const bytes=await r.arrayBuffer();if(await digest(bytes)!==sha)throw Error('image_SHA_mismatch');const im=new Image();im.src=url;await im.decode();if(im.naturalWidth!==1254||im.naturalHeight!==1254)throw Error('image_dimensions');return im;}
function polygon(region,T){
 if(region.id==='neck')return V2.flattened(mask.neck.path).map(p=>D.transform(T.matrix,p));
 if(region.id.includes('arm_root')){const id=region.id==='left_arm_root'?'left_armhole_inner':'right_armhole_inner';return baseline.asset.apertures.find(p=>p.id===id).points.map(p=>D.transform(T.matrix,p));}
 return V2.flattened(mask.foreground[state.stage].find(p=>p.id===region.id).path);
}
function drawOverlay(ctx,regions,T){
 if(!state.overlay)return;
 for(const r of regions){const selected=!state.region||r.id===state.region;ctx.save();ctx.globalAlpha=selected?1:.4;ctx.strokeStyle=r.color;ctx.fillStyle=r.color;ctx.lineWidth=3;const poly=polygon(r,T);ctx.beginPath();ctx.moveTo(...poly[0]);poly.slice(1).forEach(p=>ctx.lineTo(...p));ctx.closePath();ctx.stroke();ctx.setLineDash([8,6]);ctx.strokeRect(r.roi[0],r.roi[1],r.roi[2]-r.roi[0],r.roi[3]-r.roi[1]);ctx.setLineDash([]);const p=r.bodyPoint;ctx.beginPath();ctx.arc(p[0],p[1],7,0,Math.PI*2);ctx.fill();const a=D.transform(T.matrix,r.assetPoint);ctx.beginPath();ctx.moveTo(a[0]-7,a[1]);ctx.lineTo(a[0]+7,a[1]);ctx.moveTo(a[0],a[1]-7);ctx.lineTo(a[0],a[1]+7);ctx.stroke();ctx.font='18px system-ui';ctx.fillText(r.label,p[0]+11,p[1]-10);ctx.restore();}
}
function updateZoom(){
 document.querySelectorAll('.frame').forEach(f=>{f.classList.toggle('zoom',!!state.region);if(!state.region){f.scrollTop=0;f.scrollLeft=0;}else{const r=data.cases[state.stage].regions.find(r=>r.id===state.region);f.scrollLeft=Math.max(0,r.roi[0]*2-30);f.scrollTop=Math.max(0,r.roi[1]*2-35);}});
}
function render(){
 if(!state.ready)return;const stage=state.stage,im={body:images[stage],vest:images.vest};
 V2.draw(baseline,mask,stage,im,canvases.fixed.getContext('2d'),{matte:state.matte,occlusion:true});
 V2.draw(baseline,mask,stage,im,canvases.control.getContext('2d'),{matte:state.matte,occlusion:false});
 const aa=canvases.fixed.getContext('2d').getImageData(0,0,1254,1254).data,bb=canvases.control.getContext('2d').getImageData(0,0,1254,1254).data,T=V1.solve(baseline.asset.shoulderPair,baseline.bodies[stage].shoulderPair),regions=data.cases[stage].regions;
 results=regions.map(r=>D.describe(r,polygon(r,T),T.matrix,D.comparePixels(aa,bb,1254,1254,r.roi)));
 for(const canvas of Object.values(canvases))drawOverlay(canvas.getContext('2d'),regions,T);
 $('metrics').replaceChildren(...regions.map((r,i)=>{const z=results[i],tr=document.createElement('tr');const cells=[r.label+'（候補）',JSON.stringify(z.bodySourcePoint)+' / '+JSON.stringify(z.assetSourcePoint),z.candidateBoundaryDistancePx.toFixed(2)+'px / '+(z.bodyPointInsideCandidateMask?'内':'外')+(z.registrationByConstruction?'；位置合わせ残差 '+z.probeSeparationPx.toFixed(4)+'px（計算上）':''),z.renderComparison.differentPixels+' / '+z.renderComparison.samples+'画素'];for(const text of cells){const td=document.createElement('td');td.textContent=text;tr.append(td);}return tr;}));
 lastSnapshot={version:1,scope:'source-pose-contact-diagnostic-only',stage,pose:data.cases[stage].pose,matte:state.matte,overlay:state.overlay,region:state.region,manifestSHA,assetSHA:data.assetSHA,bodySHA:data.bodySHAs[stage],baselineRevision:data.baselineRevision,maskRevision:data.maskRevision,transform:T,angle:null,approvedCalibration:false,completedFit:false,sourcePNGsEdited:false,transformsChanged:false,masksChanged:false,physicalContactVerified:false,results};
 $('details').textContent=JSON.stringify(lastSnapshot,null,2);document.body.dataset.stage=stage;document.body.dataset.manifest=manifestSHA;document.body.dataset.completedFit='false';updateZoom();
}
async function capture(which){
 if(!state.ready||!lastSnapshot)throw Error('not_ready');const metadata=JSON.parse(JSON.stringify({...lastSnapshot,comparison:which,derivedRenderedQA:true,newOriginal:false}));const canvas=canvases[which];const dataURL=canvas.toDataURL('image/png');const label='fit_'+state.stage+'_'+which+(state.region?'_'+state.region:'')+(state.overlay?'_guides':'_plain');
 const dest=$(which+'Export');dest.textContent='保存中…';
 if(['127.0.0.1','localhost'].includes(location.hostname)){
  const response=await fetch('/__capture/fit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label,manifest_sha256:manifestSHA,metadata,png_data_url:dataURL})});if(!response.ok)throw Error('capture_HTTP_'+response.status);const saved=await response.json();dest.textContent='実描画を保存しました。';dest.dataset.receipt=JSON.stringify(saved);
 }else{
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('PNG_export_failed');const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=label+'.png';a.textContent='PNGをダウンロード';dest.replaceChildren(a);a.addEventListener('click',()=>setTimeout(()=>URL.revokeObjectURL(url),1000),{once:true});
 }
}
try{
 const mr=await getJSON(new URL('./input-manifest.json',location.href));manifestSHA=await digest(mr.bytes);const manifest=mr.data;
 const dep=p=>manifest.dependencies.find(d=>d.path===p).sha256;
 const [b,m,d]=await Promise.all([getJSON(new URL('fit-data-v1.json',oldBase),dep('fit-data-v1.json')),getJSON(new URL('fit-data-v2.json',oldBase),dep('fit-data-v2.json')),getJSON(new URL('./contact-data-v1.json',location.href),manifest.own_sources.find(r=>r.path==='contact-data-v1.json').sha256)]);
 baseline=b.data;mask=m.data;data=d.data;V2.validate(baseline,mask);D.validate(data,baseline,mask);
 images={vest:await image(new URL(baseline.asset.src,oldBase).href,data.assetSHA)};for(const stage of ['baby','adult'])images[stage]=await image(new URL(baseline.bodies[stage].src,oldBase).href,data.bodySHAs[stage]);
 document.querySelectorAll('[data-stage]').forEach(b=>b.addEventListener('click',()=>{state.stage=b.dataset.stage;document.querySelectorAll('[data-stage]').forEach(q=>q.setAttribute('aria-pressed',String(q===b)));render();}));
 document.querySelectorAll('[data-matte]').forEach(b=>b.addEventListener('click',()=>{state.matte=b.dataset.matte;document.querySelectorAll('[data-matte]').forEach(q=>q.setAttribute('aria-pressed',String(q===b)));render();}));
 document.querySelectorAll('[data-region]').forEach(b=>b.addEventListener('click',()=>{state.region=b.dataset.region;render();}));
 $('whole').addEventListener('click',()=>{state.region=null;render();});$('overlay').addEventListener('change',()=>{state.overlay=$('overlay').checked;render();});
 document.querySelectorAll('[data-capture]').forEach(b=>b.addEventListener('click',()=>capture(b.dataset.capture).catch(fail)));
 state.ready=true;document.body.dataset.status='ready';$('status').textContent='元データの照合済み・実着用は未確認';render();
}catch(e){fail(e);}
}());