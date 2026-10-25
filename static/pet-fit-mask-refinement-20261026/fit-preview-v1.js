/* Source-bound two-dimensional fitting prerequisite. No game state or original art mutation. */
(function(root,factory){'use strict';var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PetFitPrerequisite=api;}(typeof window!=='undefined'?window:globalThis,function(){
'use strict';
function finite(n){return typeof n==='number'&&Number.isFinite(n);}
function point(p){return Array.isArray(p)&&p.length===2&&p.every(finite);}
function solve(assetPair,bodyPair){
 if(!Array.isArray(assetPair)||assetPair.length!==2||!assetPair.every(point)||!Array.isArray(bodyPair)||bodyPair.length!==2||!bodyPair.every(point))throw Error('invalid_landmarks');
 var ax=assetPair[1][0]-assetPair[0][0],ay=assetPair[1][1]-assetPair[0][1],bx=bodyPair[1][0]-bodyPair[0][0],by=bodyPair[1][1]-bodyPair[0][1],al=Math.hypot(ax,ay),bl=Math.hypot(bx,by);
 if(al<=1e-8||bl<=1e-8)throw Error('degenerate_landmarks');
 var scale=bl/al,angle=Math.atan2(by,bx)-Math.atan2(ay,ax),a=scale*Math.cos(angle),b=scale*Math.sin(angle),c=-b,d=a;
 return Object.freeze({scale:scale,scaleXY:[scale,scale],rotationDegrees:angle*180/Math.PI,matrix:[a,b,c,d,bodyPair[0][0]-a*assetPair[0][0]-c*assetPair[0][1],bodyPair[0][1]-b*assetPair[0][0]-d*assetPair[0][1]],basis:'two_source_bound_semantic_landmarks_not_whole_PNG_bounds',approvedCalibration:false});
}
function transformPoint(p,t){if(!point(p)||!t||!Array.isArray(t.matrix)||t.matrix.length!==6||!t.matrix.every(finite))throw Error('invalid_transform');var m=t.matrix;return[m[0]*p[0]+m[2]*p[1]+m[4],m[1]*p[0]+m[3]*p[1]+m[5]];}
function validate(data){
 function bound(b,d){return Array.isArray(b)&&b.length===4&&b.every(finite)&&b[0]>=0&&b[1]>=0&&b[2]>b[0]&&b[3]>b[1]&&b[2]<=d[0]&&b[3]<=d[1];}
 if(!data||data.schemaVersion!==1||data.representation!=='2d_front_reference' ||data.completedFit!==false)throw Error('invalid_scope');
 if(!data.asset||!/^[0-9a-f]{64}$/.test(data.asset.sha256)||data.asset.dimensions[0]!==1254||data.asset.dimensions[1]!==1254)throw Error('invalid_asset');
 if(!bound(data.asset.visibleBoundsAlpha32,data.asset.dimensions))throw Error('invalid_asset_bounds');
 function pixels(p,dim){return point(p)&&p[0]>=0&&p[1]>=0&&p[0]<=dim[0]&&p[1]<=dim[1];}
 function polygon(p,dim){return Array.isArray(p)&&p.length>=3&&p.every(x=>pixels(x,dim));}
 if(!Array.isArray(data.asset.shoulderPair)||data.asset.shoulderPair.length!==2||!data.asset.shoulderPair.every(p=>pixels(p,data.asset.dimensions)))throw Error('invalid_asset_landmarks');
 if(!Array.isArray(data.asset.apertures)||!data.asset.apertures.every(p=>polygon(p.points,data.asset.dimensions)))throw Error('invalid_apertures');
 for(var id of ['baby','adult']){
  var body=data.bodies&&data.bodies[id];if(!body||body.family!=='milne'||body.stage!==id||!/^[0-9a-f]{64}$/.test(body.sha256)||body.dimensions[0]!==1254||body.dimensions[1]!==1254)throw Error('invalid_body');
  if(!bound(body.visibleBoundsAlpha32,body.dimensions))throw Error('invalid_body_bounds');
  if(!Array.isArray(body.shoulderPair)||body.shoulderPair.length!==2||!body.shoulderPair.every(p=>pixels(p,body.dimensions))||!polygon(body.torsoRegion,body.dimensions)||!Array.isArray(body.foreground)||!body.foreground.every(p=>polygon(p.points,body.dimensions)))throw Error('invalid_body_landmarks');
  solve(data.asset.shoulderPair,body.shoulderPair);
 }
 return data;
}
function polygonPath(ctx,points){ctx.moveTo(points[0][0],points[0][1]);for(var i=1;i<points.length;i++)ctx.lineTo(points[i][0],points[i][1]);ctx.closePath();}
function draw(data,stage,images,ctx,options){
 validate(data);options=options||{};if(['baby','adult'].indexOf(stage)<0||!data.bodies[stage]||!images.body||!images.vest)throw Error('missing_image_or_stage');
 var body=data.bodies[stage],t=solve(data.asset.shoulderPair,body.shoulderPair),size=body.dimensions;
 ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,size[0],size[1]);ctx.fillStyle=options.matte||'#eaf2da';ctx.fillRect(0,0,size[0],size[1]);
 ctx.drawImage(images.body,0,0,size[0],size[1]);
 if(options.bodyOnly!==true){
  ctx.save();ctx.transform.apply(ctx,t.matrix);
  if(options.occlusion!==false){ctx.beginPath();ctx.rect(0,0,1254,1254);data.asset.apertures.forEach(p=>polygonPath(ctx,p.points));ctx.clip('evenodd');}
  ctx.drawImage(images.vest,0,0,1254,1254);ctx.restore();
  if(options.occlusion!==false)body.foreground.forEach(p=>{ctx.save();ctx.beginPath();polygonPath(ctx,p.points);ctx.clip();ctx.drawImage(images.body,0,0,1254,1254);ctx.restore();});
 }
 if(options.guides){
  ctx.lineWidth=3;ctx.strokeStyle='#3471a6';ctx.setLineDash([12,8]);ctx.beginPath();polygonPath(ctx,body.torsoRegion);ctx.stroke();
  ctx.strokeStyle='#a05171';body.foreground.forEach(p=>{ctx.beginPath();polygonPath(ctx,p.points);ctx.stroke();});ctx.setLineDash([]);
  body.shoulderPair.forEach((p,i)=>{ctx.fillStyle='#db731a';ctx.beginPath();ctx.arc(p[0],p[1],9,0,Math.PI*2);ctx.fill();ctx.font='24px system-ui';ctx.fillText('候補'+(i?'R':'L'),p[0]+12,p[1]-12);});
  ctx.strokeStyle='#246964';ctx.lineWidth=2;var v=data.asset.visibleBoundsAlpha32,box=[[v[0],v[1]],[v[2],v[1]],[v[2],v[3]],[v[0],v[3]]].map(p=>transformPoint(p,t));ctx.beginPath();polygonPath(ctx,box);ctx.stroke();
 }
 ctx.restore();return{stage:stage,transform:t,completedFit:false,geometry3d:false,motion:false,full360:false,unlockSave:false};
}
return Object.freeze({solve:solve,transformPoint:transformPoint,validate:validate,draw:draw});
}));