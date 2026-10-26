/* One authored chair placement in the unchanged saved meadow. No player/save actions. */
const FOOT_IDS=['foot-left-front','foot-right-front','foot-left-back','foot-right-back'];
const EPS=1e-6;
function finite(n){return typeof n==='number'&&Number.isFinite(n);}
function fail(code){throw new Error(code);}
function pointDistance(x,z,a,b){const dx=b.x-a.x,dz=b.z-a.z,l=dx*dx+dz*dz,t=l?Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/l)):0;return Math.hypot(x-a.x-t*dx,z-a.z-t*dz);}
function crosses(a,b,c,d){const orient=(p,q,r)=>(q.x-p.x)*(r.z-p.z)-(q.z-p.z)*(r.x-p.x),on=(p,q,r)=>Math.abs(orient(p,q,r))<=EPS&&r.x>=Math.min(p.x,q.x)-EPS&&r.x<=Math.max(p.x,q.x)+EPS&&r.z>=Math.min(p.z,q.z)-EPS&&r.z<=Math.max(p.z,q.z)+EPS;const x=orient(a,b,c),y=orient(a,b,d),u=orient(c,d,a),v=orient(c,d,b);return(x*y<0&&u*v<0)||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b);}
function edgeRectangleDistance(a,b,r){const corners=[{x:r.minX,z:r.minZ},{x:r.maxX,z:r.minZ},{x:r.maxX,z:r.maxZ},{x:r.minX,z:r.maxZ}],inside=p=>p.x>=r.minX&&p.x<=r.maxX&&p.z>=r.minZ&&p.z<=r.maxZ;if(inside(a)||inside(b))return 0;let distance=Infinity;for(let i=0;i<4;i++){const c=corners[i],d=corners[(i+1)%4];if(crosses(a,b,c,d))return 0;distance=Math.min(distance,pointDistance(c.x,c.z,a,b),pointDistance(a.x,a.z,c,d),pointDistance(b.x,b.z,c,d));}return distance;}
function drylandBoundary(T,mesh){
 const pos=mesh.geometry.attributes.position,index=mesh.geometry.index,edges=new Map(),vertices=new Map(),key=v=>v.toArray().map(x=>Math.round(x*1e6)).join(':');
 const vertex=i=>new T.Vector3().fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld);
 const n=index?index.count:pos.count;
 for(let i=0;i<n;i+=3){const v=[0,1,2].map(k=>vertex(index?index.getX(i+k):i+k)),keys=v.map(key);for(let k=0;k<3;k++){vertices.set(keys[k],v[k]);const pair=[keys[k],keys[(k+1)%3]].sort(),id=pair.join('|'),row=edges.get(id)||{count:0,keys:pair};row.count++;edges.set(id,row);}}
 return[...edges.values()].filter(x=>x.count===1).map(x=>x.keys.map(k=>vertices.get(k)));
}
function boxSeparation(a,b){return Math.hypot(Math.max(0,b.min.x-a.max.x,a.min.x-b.max.x),Math.max(0,b.min.y-a.max.y,a.min.y-b.max.y),Math.max(0,b.min.z-a.max.z,a.min.z-b.max.z));}
export function probePlacement(T,Scene,Town,world,model,item,anchor={x:780,y:700}){
 if(!world||!Array.isArray(world.places)||!anchor||!finite(anchor.x)||!finite(anchor.y))fail('chair_placement_invalid_world_or_anchor');
 const before=JSON.stringify(world),b=item&&item.bounds,ids=item&&item.footprint&&item.footprint.contactPartIds;
 if(!b||!['min','max'].every(k=>Array.isArray(b[k])&&b[k].length===3&&b[k].every(finite))||b.min.some((v,i)=>v>b.max[i]))fail('chair_placement_invalid_bounds');
 if(!Array.isArray(ids)||ids.length!==4||new Set(ids).size!==4||FOOT_IDS.some(x=>!ids.includes(x)))fail('chair_placement_requires_four_authored_feet');
 if(!item.group||item.group.position.length()>EPS||item.group.rotation.toArray().slice(0,3).some(x=>Math.abs(x)>EPS)||item.group.scale.toArray().some(x=>Math.abs(x-1)>EPS))fail('chair_placement_requires_untransformed_chair');
 const p=Scene.groundPoint(world,anchor);if(!finite(p.x)||!finite(p.z))fail('chair_placement_invalid_world_projection');
 const margin=.22,step=.08,nx=Math.ceil((b.max[0]-b.min[0]+2*margin)/step),nz=Math.ceil((b.max[2]-b.min[2]+2*margin)/step);
 let count=0,blocked=0;
 for(let i=0;i<=nx;i++)for(let j=0;j<=nz;j++){const x=b.min[0]-margin+(b.max[0]-b.min[0]+2*margin)*i/nx,z=b.min[2]-margin+(b.max[2]-b.min[2]+2*margin)*j/nz;count++;if(!Town.isWalkable(world,anchor.x+100*x,anchor.y+100*z))blocked++;}
 const radius=Math.hypot(Math.max(Math.abs(b.min[0]),Math.abs(b.max[0])),Math.max(Math.abs(b.min[2]),Math.abs(b.max[2])))+margin,ringSamples=64;let ringBlocked=0;
 for(let i=0;i<ringSamples;i++){const a=i*Math.PI*2/ringSamples;if(!Town.isWalkable(world,anchor.x+100*radius*Math.cos(a),anchor.y+100*radius*Math.sin(a)))ringBlocked++;}
 if(blocked||ringBlocked)fail('chair_placement_navigation_footprint_blocked');
 const dry=model.surfaces.filter(x=>x.name==='dry-land');if(dry.length!==1)fail('chair_placement_dryland_mesh_missing_or_ambiguous');
 item.group.updateMatrixWorld(true);model.scene.updateMatrixWorld(true);
 const ray=new T.Raycaster(),feet=[];
 for(const id of ids){
  const mesh=item.byId.get(id);if(!mesh||!mesh.isMesh)fail('chair_placement_foot_mesh_missing');
  const box=new T.Box3().setFromObject(mesh),x=(box.min.x+box.max.x)/2,z=(box.min.z+box.max.z)/2;
  ray.set(new T.Vector3(x,box.min.y-.5,z),new T.Vector3(0,1,0));ray.near=0;ray.far=box.max.y-box.min.y+1;
  const sole=ray.intersectObject(mesh,false)[0];if(!sole||sole.faceIndex==null||Math.abs(sole.point.y-box.min.y)>.002)fail('chair_placement_actual_sole_not_found');
  ray.set(new T.Vector3(p.x+sole.point.x,3,p.z+sole.point.z),new T.Vector3(0,-1,0));ray.far=10;
  const hit=ray.intersectObjects(dry,false)[0];if(!hit)fail('chair_placement_floor_support_missing');
  feet.push({id,authoredSupportNotHiddenOriginalLegProof:true,localSolePoint:sole.point.toArray(),localSoleY:sole.point.y,soleFaceIndex:sole.faceIndex,soleNormal:sole.face.normal.clone().applyNormalMatrix(new T.Matrix3().getNormalMatrix(mesh.matrixWorld)).normalize().toArray(),supportPoint:hit.point.toArray(),supportY:hit.point.y,surface:hit.object.name,supportFaceIndex:hit.faceIndex});
 }
 const heights=feet.map(x=>x.supportY),floor=Math.max(...heights);
 if(Math.max(...heights)-Math.min(...heights)>.002)fail('chair_placement_uneven_floor');
 for(const f of feet){f.soleMinusFloor=floor+f.localSoleY-f.supportY;if(Math.abs(f.soleMinusFloor)>.002)fail('chair_placement_foot_not_at_floor');}
 const assetBox=new T.Box3(new T.Vector3(...b.min),new T.Vector3(...b.max)).translate(new T.Vector3(p.x,floor,p.z)),rectangle={minX:assetBox.min.x,maxX:assetBox.max.x,minZ:assetBox.min.z,maxZ:assetBox.max.z};
 const floorBox=new T.Box3().setFromObject(dry[0]),boundary=drylandBoundary(T,dry[0]),shore=boundary.filter(([a,b])=>!(Math.abs(a.x-floorBox.min.x)<EPS&&Math.abs(b.x-floorBox.min.x)<EPS)&&!(Math.abs(a.z-floorBox.min.z)<EPS&&Math.abs(b.z-floorBox.min.z)<EPS)&&!(Math.abs(a.z-floorBox.max.z)<EPS&&Math.abs(b.z-floorBox.max.z)<EPS));
 if(!shore.length)fail('chair_placement_shoreline_boundary_missing');
 const waterEdgeClearance=Math.min(...shore.map(([a,b])=>edgeRectangleDistance(a,b,rectangle)));if(waterEdgeClearance<=margin)fail('chair_placement_water_edge_too_close');
 let objectCount=0,nearest=Infinity;const collisions=[];
 for(const mesh of model.occluders||[]){if(!mesh.isMesh)continue;const box=new T.Box3().setFromObject(mesh);if(box.isEmpty())continue;objectCount++;const separation=boxSeparation(assetBox,box);nearest=Math.min(nearest,separation);if(separation<=.025)collisions.push(mesh.name||mesh.uuid);}
 if(collisions.length)fail('chair_placement_scene_mesh_envelope_intersection');
 const places=world.places.map(place=>({id:place.id,centerDistanceWorld:Math.hypot(anchor.x-place.footprint.x,anchor.y-place.footprint.y)/100}));
 if(JSON.stringify(world)!==before)fail('chair_placement_world_was_mutated');
 return{townPoint:{...anchor},worldPosition:{x:p.x,y:floor,z:p.z},feet,expandedNavigationGrid:{stepMaxWorld:step,marginWorld:margin,count,blocked},walkClearanceRing:{radiusWorld:radius,samples:ringSamples,blocked:ringBlocked,continuousNavigationGuarantee:false},waterBoundary:{source:'actual-dry-land-triangulated-Mesh-boundary',shorelineSegments:shore.length,rectangleToShorelineClearanceWorld:waterEdgeClearance},sceneMeshEnvelopes:{tested:objectCount,collisions:[],minimumAABBSeparationWorld:Number.isFinite(nearest)?nearest:null,scope:'Conservative actual-occluder Mesh AABBs at this one placement, including retained originals used by instance batches; not triangle-contact/physics or all decorations.'},placeCenterDistances:places,worldUnchanged:true,normalPlacement:false,ownerLayoutOrSave:false,physicalLoadOrFurnitureFit:false,scope:'One authored chair on one synthetic saved meadow placement. Actual four sole/floor rays, exact dryland boundary separation and conservative scene envelopes; finite navigation samples only. Body binding and sitting are unverified.'};
}
