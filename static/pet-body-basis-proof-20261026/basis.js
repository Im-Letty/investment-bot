/* Source-image basis only; no garment, anatomy reconstruction or storage. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PetBodySourceBasis=api;})(globalThis,function(){
'use strict';
const expected={baby:'e7024c2baabfb2fc9fa75620df6015cf0de1c6c645e4ce099e02f9d657033e21',adult:'35b04839b39e50839a6a1734e8919c6d499ececf6b0aba9b766788e399deb404'};
const ok=(b,m)=>{if(!b)throw Error(m);},finite=n=>typeof n==='number'&&Number.isFinite(n),point=p=>Array.isArray(p)&&p.length===2&&p.every(finite);
function validate(d){
 ok(d.schemaVersion===1&&d.revision==='milne-body-source-landmark-basis-v1','revision');
 ok(d.depth===null&&d.bodyBinding===null&&d.angleDegrees===null&&d.worldUnitsPerPixel===null,'unknown_spatial_basis');
 ok(d.calibrationApproved===false&&d.wearingVerified===false&&d.characterBody360===false&&d.canonicalFitRecordsAdded===0,'scope_gate');
 ok(d.coordinateSpace==='original_image_pixel_centres'&&d.sideConvention==='screen-left/screen-right; anatomical side unassigned','coordinate_contract');
 ok(Object.keys(d.cases).sort().join(',')==='adult,baby','stage_contract');
 for(const stage of ['baby','adult']){
  const c=d.cases[stage];ok(c.source.sha256===expected[stage]&&c.source.family==='milne'&&c.source.stage===stage&&c.source.width===1254&&c.source.height===1254,'source_identity');
  ok(c.pose==='single_saved_source_pose'&&c.depth===null&&c.anatomicalSocketsKnown===false,'pose_scope');
  const ids=new Set();ok(c.landmarks.length===6,'landmarks');
  for(const l of c.landmarks){ok(!ids.has(l.id),'duplicate_id');ids.add(l.id);
   ok(point(l.px)&&l.px[0]>=0&&l.px[0]<1254&&l.px[1]>=0&&l.px[1]<1254,'landmark_bounds');
   ok(l.anatomicalSide===null&&l.depth===null&&l.observation==='visible_source_feature','visible_only');
   ok(point(l.uncertaintyRadiusPx)&&l.uncertaintyRadiusPx.every(n=>n>0&&n<80),'uncertainty_required');
   ok(['screen-left','screen-right','centre'].includes(l.screenSide)&&l.note.length>12,'landmark_description');
  }
  const l=c.landmarks.find(x=>x.id===c.basis.screenLeftLandmark),r=c.landmarks.find(x=>x.id===c.basis.screenRightLandmark);
  ok(l&&r&&l.screenSide==='screen-left'&&r.screenSide==='screen-right'&&l.px[0]<r.px[0]&&Math.hypot(r.px[0]-l.px[0],r.px[1]-l.px[1])>20,'screen_side_order');
  ok(c.basis.units==='source_pixels'&&c.basis.anatomicalAxis===false&&c.basis.scaleCalibration===false,'basis_scope');
  viewport(1254,1254,1254,1254,c.crop);
  ok(c.unresolved.length===4,'unresolved_required');
  for(const u of c.unresolved){ok(u.point===null&&u.depth===null&&u.binding===null&&u.status==='unresolved_hidden_or_unmeasured','hidden_anchor_forbidden');if(u.roi)viewport(1254,1254,1254,1254,u.roi);}
 }
 return d;
}
function frame(c){
 const l=c.landmarks.find(x=>x.id===c.basis.screenLeftLandmark).px,r=c.landmarks.find(x=>x.id===c.basis.screenRightLandmark).px;
 const span=Math.hypot(r[0]-l[0],r[1]-l[1]);ok(span>20,'degenerate_basis');
 const x=[(r[0]-l[0])/span,(r[1]-l[1])/span];return {origin:[(l[0]+r[0])/2,(l[1]+r[1])/2],xAxis:x,yAxis:[-x[1],x[0]],chordLengthPx:span,units:'source_pixels',anatomicalAxis:false,scaleCalibration:false};
}
function toLocal(f,p){ok(point(p),'point_invalid');const x=p[0]-f.origin[0],y=p[1]-f.origin[1];return[x*f.xAxis[0]+y*f.xAxis[1],x*f.yAxis[0]+y*f.yAxis[1]];}
function fromLocal(f,p){ok(point(p),'point_invalid');return[f.origin[0]+p[0]*f.xAxis[0]+p[1]*f.yAxis[0],f.origin[1]+p[0]*f.xAxis[1]+p[1]*f.yAxis[1]];}
function viewport(sw,sh,w,h,crop){
 ok([sw,sh,w,h].every(n=>finite(n)&&n>0),'viewport_dimensions');const r=crop||[0,0,sw,sh];
 ok(r.length===4&&r.every(finite)&&r[0]>=0&&r[1]>=0&&r[2]<=sw&&r[3]<=sh&&r[2]>r[0]&&r[3]>r[1],'viewport_crop');
 const s=Math.min(w/(r[2]-r[0]),h/(r[3]-r[1]));return {width:w,height:h,sourceWidth:sw,sourceHeight:sh,crop:r.slice(),scale:s,offset:[(w-(r[2]-r[0])*s)/2,(h-(r[3]-r[1])*s)/2],pixelCentres:'source +0.5; inverse -0.5'};
}
function sourceToCanvas(v,p){ok(point(p),'point_invalid');return[v.offset[0]+(p[0]+.5-v.crop[0])*v.scale,v.offset[1]+(p[1]+.5-v.crop[1])*v.scale];}
function canvasToSource(v,p){ok(point(p),'point_invalid');const x=(p[0]-v.offset[0])/v.scale+v.crop[0]-.5,y=(p[1]-v.offset[1])/v.scale+v.crop[1]-.5;return x>=v.crop[0]&&x<v.crop[2]&&y>=v.crop[1]&&y<v.crop[3]?[x,y]:null;}
function snapshot(d,stage,view,manifestSHA){
 validate(d);ok(expected[stage]&&/^[a-f0-9]{64}$/.test(manifestSHA),'snapshot_identity');ok(typeof view.labels==='boolean'&&['whole','torso'].includes(view.region),'snapshot_view');
 const c=d.cases[stage],f=frame(c);
 return JSON.parse(JSON.stringify({schemaVersion:1,scope:'source_image_body_landmark_basis_only',revision:d.revision,stage,source:c.source,pose:c.pose,manifestSHA,coordinateSpace:d.coordinateSpace,sideConvention:d.sideConvention,frame:f,
 landmarks:c.landmarks.map(l=>({...l,localPx:toLocal(f,l.px)})),unresolved:c.unresolved,
 viewport:viewport(1254,1254,1254,1254,view.region==='torso'?c.crop:null),labels:view.labels,region:view.region,matte:view.matte,
 depth:null,bodyBinding:null,angleDegrees:null,worldUnitsPerPixel:null,calibrationApproved:false,wearingVerified:false,characterBody360:false,canonicalFitRecordsAdded:0,sourcePNGsEdited:false,garmentRendered:false,newOriginal:false}));
}
return Object.freeze({expected,validate,frame,toLocal,fromLocal,viewport,sourceToCanvas,canvasToSource,snapshot});
});
