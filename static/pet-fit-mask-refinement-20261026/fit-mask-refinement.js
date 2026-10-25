/* Versioned local mask hypothesis; source PNGs and v1 transforms stay unchanged. */
(function(root,factory){'use strict';var api=typeof module==='object'&&module.exports?factory(require('./fit-preview-v1.js')):factory(root.PetFitPrerequisite);if(typeof module==='object'&&module.exports)module.exports=api;else root.PetFitMaskRefinement=api;}(typeof window!=='undefined'?window:globalThis,function(V1){
'use strict';
function finite(n){return typeof n==='number'&&Number.isFinite(n);}
function validPath(path,roi){if(!Array.isArray(path)||path.length<3||path[0][0]!=='M'||path[path.length-1][0]!=='Z')return false;return path.every(function(c,i){var lengths={M:3,L:3,Q:5,C:7,Z:1};if(!Array.isArray(c)||c.length!==lengths[c[0]]||(i>0&&c[0]==='M')||(c[0]==='Z'&&i!==path.length-1))return false;for(var j=1;j<c.length;j+=2)if(!finite(c[j])||!finite(c[j+1])||c[j]<roi[0]||c[j]>roi[2]||c[j+1]<roi[1]||c[j+1]>roi[3])return false;return true;});}
function validate(b,d){
 V1.validate(b);if(!d||d.schemaVersion!==2||d.representation!=='2d_front_reference'||d.completedFit!==false||d.approvedCalibration!==false||d.transformChanges!==false||d.sourcePNGsEdited!==false||d.newDesigns!==0||d.baselineRevision!==b.landmarkRevision||d.assetSHA!==b.asset.sha256)throw Error('invalid_refinement_scope');
 function row(p,id){if(!p||p.id!==id||!Array.isArray(p.roi)||p.roi.length!==4||!p.roi.every(finite)||p.roi[0]<0||p.roi[1]<0||p.roi[2]>1254||p.roi[3]>1254||p.roi[0]>=p.roi[2]||p.roi[1]>=p.roi[3]||!validPath(p.path,p.roi))throw Error('invalid_local_path');}
 row(d.neck,'neck_product_backcloth');
 for(var s of ['baby','adult']){if(!d.bodySHAs||d.bodySHAs[s]!==b.bodies[s].sha256||!d.foreground||!Array.isArray(d.foreground[s])||d.foreground[s].length!==2)throw Error('invalid_body_binding');row(d.foreground[s][0],'left_forepaw');row(d.foreground[s][1],'right_forepaw');}
 return d;
}
function path(ctx,p){p.forEach(function(c){if(c[0]==='M')ctx.moveTo(c[1],c[2]);else if(c[0]==='L')ctx.lineTo(c[1],c[2]);else if(c[0]==='Q')ctx.quadraticCurveTo.apply(ctx,c.slice(1));else if(c[0]==='C')ctx.bezierCurveTo.apply(ctx,c.slice(1));else ctx.closePath();});}
function polygon(ctx,p){ctx.moveTo(p[0][0],p[0][1]);p.slice(1).forEach(q=>ctx.lineTo(q[0],q[1]));ctx.closePath();}
function flattened(p){var out=[],last,start;p.forEach(function(c){if(c[0]==='M'){last=[c[1],c[2]];start=last;out.push(last);}else if(c[0]==='L'){last=[c[1],c[2]];out.push(last);}else if(c[0]==='Z'){last=start;out.push(last);}else{var from=last;for(var n=1;n<=32;n++){var t=n/32,u=1-t;if(c[0]==='Q')last=[u*u*from[0]+2*u*t*c[1]+t*t*c[3],u*u*from[1]+2*u*t*c[2]+t*t*c[4]];else last=[u*u*u*from[0]+3*u*u*t*c[1]+3*u*t*t*c[3]+t*t*t*c[5],u*u*u*from[1]+3*u*u*t*c[2]+3*u*t*t*c[4]+t*t*t*c[6]];out.push(last);}}});return out;}
function contains(p,q){var a=flattened(p),inside=false;for(var i=0,j=a.length-1;i<a.length;j=i++)if((a[i][1]>q[1])!==(a[j][1]>q[1])&&q[0]<(a[j][0]-a[i][0])*(q[1]-a[i][1])/(a[j][1]-a[i][1])+a[i][0])inside=!inside;return inside;}
function draw(b,d,stage,images,ctx,opts){
 validate(b,d);opts=opts||{};if(opts.version==='v1'||opts.bodyOnly===true)return V1.draw(b,stage,images,ctx,opts);
 if(!['baby','adult'].includes(stage)||!images.body||!images.vest)throw Error('missing_image_or_stage');
 var body=b.bodies[stage],t=V1.solve(b.asset.shoulderPair,body.shoulderPair);
 ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,1254,1254);ctx.fillStyle=opts.matte||'#eaf2da';ctx.fillRect(0,0,1254,1254);ctx.drawImage(images.body,0,0,1254,1254);
 ctx.save();ctx.transform.apply(ctx,t.matrix);
 if(opts.occlusion!==false){ctx.beginPath();ctx.rect(0,0,1254,1254);b.asset.apertures.forEach(function(p){if(p.id===d.neck.id)path(ctx,d.neck.path);else polygon(ctx,p.points);});ctx.clip('evenodd');}
 ctx.drawImage(images.vest,0,0,1254,1254);ctx.restore();
 if(opts.occlusion!==false)body.foreground.forEach(function(p){var replacement=d.foreground[stage].find(x=>x.id===p.id);ctx.save();ctx.beginPath();if(replacement)path(ctx,replacement.path);else polygon(ctx,p.points);ctx.clip();ctx.drawImage(images.body,0,0,1254,1254);ctx.restore();});
 if(opts.guides){ctx.lineWidth=2;ctx.strokeStyle='#a05171';d.foreground[stage].forEach(function(p){ctx.beginPath();path(ctx,p.path);ctx.stroke();});ctx.save();ctx.transform.apply(ctx,t.matrix);ctx.strokeStyle='#216c65';ctx.beginPath();path(ctx,d.neck.path);ctx.stroke();ctx.restore();}
 ctx.restore();return{stage:stage,transform:t,maskRevision:d.revision,completedFit:false,geometry3d:false,motion:false,full360:false,unlockSave:false};
}
return Object.freeze({validate:validate,draw:draw,trace:path,contains:contains,flattened:flattened,solve:V1.solve,transformPoint:V1.transformPoint});
}));
