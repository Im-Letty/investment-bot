/* Source-pose diagnostics only: geometry numbers never certify anatomical contact. */
(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory();else root.PetFitContactDiagnostics=factory();}(typeof window!=='undefined'?window:globalThis,function(){
'use strict';
const IDS=['neck','left_arm_root','right_arm_root','left_forepaw','right_forepaw'];
function finite(x){return typeof x==='number'&&Number.isFinite(x);}
function point(p){return Array.isArray(p)&&p.length===2&&p.every(finite);}
function imagePoint(p){return point(p)&&p.every(x=>x>=0&&x<=1254);}
function validate(d,b,m){
 if(!d||d.schemaVersion!==1||d.representation!=='saved_source_pose_only'||d.angle!==null||d.calibrationApproved!==false||d.completedFit!==false||d.sourcePNGsEdited!==false||d.transformsChanged!==false||d.masksChanged!==false)throw Error('unapproved_scope');
 if(d.assetSHA!==b.asset.sha256||d.baselineRevision!==b.landmarkRevision||d.maskRevision!==m.revision)throw Error('source_binding_mismatch');
 if(Object.keys(d.cases||{}).sort().join('|')!=='adult|baby'||Object.keys(d.bodySHAs||{}).sort().join('|')!=='adult|baby')throw Error('unsupported_source_pose');
 for(const stage of ['baby','adult']){
  if(d.bodySHAs[stage]!==b.bodies[stage].sha256||!d.cases[stage]||d.cases[stage].regions.length!==5)throw Error('body_binding_mismatch');
  const rs=d.cases[stage].regions;
  if(rs.map(r=>r.id).join('|')!==IDS.join('|'))throw Error('region_set_mismatch');
  for(const r of rs){
   const q=r.roi;if(!Array.isArray(q)||q.length!==4||!q.every(finite)||q[0]<0||q[1]<0||q[2]>1254||q[3]>1254||q[0]>=q[2]||q[1]>=q[3]||!imagePoint(r.bodyPoint)||!imagePoint(r.assetPoint)||r.bodyPoint[0]<q[0]||r.bodyPoint[0]>q[2]||r.bodyPoint[1]<q[1]||r.bodyPoint[1]>q[3])throw Error('invalid_source_region');
  }
 }
 return d;
}
function transform(matrix,p){if(!Array.isArray(matrix)||matrix.length!==6||!matrix.every(finite)||!point(p))throw Error('invalid_transform');return [matrix[0]*p[0]+matrix[2]*p[1]+matrix[4],matrix[1]*p[0]+matrix[3]*p[1]+matrix[5]];}
function inverse(matrix,p){const det=matrix[0]*matrix[3]-matrix[1]*matrix[2];if(!finite(det)||Math.abs(det)<1e-12)throw Error('singular_transform');const x=p[0]-matrix[4],y=p[1]-matrix[5];return [(matrix[3]*x-matrix[2]*y)/det,(-matrix[1]*x+matrix[0]*y)/det];}
function segmentDistance(p,a,b){const x=b[0]-a[0],y=b[1]-a[1],den=x*x+y*y;const t=den?Math.max(0,Math.min(1,((p[0]-a[0])*x+(p[1]-a[1])*y)/den)):0;return Math.hypot(p[0]-(a[0]+t*x),p[1]-(a[1]+t*y));}
function boundaryDistance(p,poly){if(!point(p)||!Array.isArray(poly)||poly.length<3||!poly.every(point))throw Error('invalid_polygon');let d=Infinity;for(let i=0;i<poly.length;i++)d=Math.min(d,segmentDistance(p,poly[i],poly[(i+1)%poly.length]));return d;}
function contains(p,poly){if(boundaryDistance(p,poly)<1e-9)return true;let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){if((poly[i][1]>p[1])!==(poly[j][1]>p[1])&&p[0]<(poly[j][0]-poly[i][0])*(p[1]-poly[i][1])/(poly[j][1]-poly[i][1])+poly[i][0])inside=!inside;}return inside;}
function comparePixels(a,b,width,height,roi){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||!a||!b||a.length!==width*height*4||b.length!==a.length||!Array.isArray(roi)||roi.length!==4||!roi.every(finite)||roi[0]<0||roi[1]<0||roi[2]>width||roi[3]>height||roi[0]>=roi[2]||roi[1]>=roi[3])throw Error('invalid_raster_region');
 let changed=0,count=0,max=0;
 for(let y=Math.floor(roi[1]);y<Math.ceil(roi[3]);y++)for(let x=Math.floor(roi[0]);x<Math.ceil(roi[2]);x++){const i=(y*width+x)*4;let delta=0;for(let c=0;c<4;c++)delta=Math.max(delta,Math.abs(a[i+c]-b[i+c]));if(delta)changed++;max=Math.max(max,delta);count++;}
 return {samples:count,differentPixels:changed,differenceFraction:changed/count,maxChannelDifference:max};
}
function describe(region,polygon,matrix,pixelComparison){
 const projected=transform(matrix,region.assetPoint);
 return {id:region.id,bodySourcePoint:region.bodyPoint.slice(),assetSourcePoint:region.assetPoint.slice(),assetProjectedPoint:projected,probeSeparationPx:Math.hypot(projected[0]-region.bodyPoint[0],projected[1]-region.bodyPoint[1]),registrationByConstruction:region.registrationByConstruction===true,bodyPointInsideCandidateMask:contains(region.bodyPoint,polygon),candidateBoundaryDistancePx:boundaryDistance(region.bodyPoint,polygon),renderComparison:pixelComparison,imageSpaceOnly:true,physicalContactKnown:false,approvedCalibration:false,completedFit:false,angle:null};
}
return Object.freeze({validate,transform,inverse,boundaryDistance,contains,comparePixels,describe,regionIDs:IDS.slice()});
}));