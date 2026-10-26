/* Probe against actual saved TownScene meshes. Door assembly is not animated or replaced. */
const EPS=1e-6;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const fail=code=>{throw Error(code);};
const boxData=(T,m)=>{const b=new T.Box3().setFromObject(m);return{min:b.min.toArray(),max:b.max.toArray(),size:b.getSize(new T.Vector3()).toArray()};};
const sizeMatch=(m,a)=>m.isMesh&&m.geometry.type==='BoxGeometry'&&m.scale.toArray().every((n,i)=>Math.abs(n-a[i])<EPS);
export function insideMesh(T,mesh,worldPoint){const p=mesh.geometry.attributes.position,ix=mesh.geometry.index,point=mesh.worldToLocal(worldPoint.clone());let sum=0;for(let i=0;i<(ix?ix.count:p.count);i+=3){const v=[0,1,2].map(k=>new T.Vector3().fromBufferAttribute(p,ix?ix.getX(i+k):i+k).sub(point));const[a,b,c]=v,la=a.length(),lb=b.length(),lc=c.length();sum+=2*Math.atan2(a.dot(b.clone().cross(c)),la*lb*lc+a.dot(b)*lc+b.dot(c)*la+c.dot(a)*lb);}return Math.abs(sum/(4*Math.PI))>.99;}
function separation(T,a,b){return Math.hypot(...['x','y','z'].map(k=>Math.max(0,b.min[k]-a.max[k],a.min[k]-b.max[k])));}
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

export function deriveDoorBasis(T,Scene,Town,world,model){
 if(!world||!Array.isArray(world.places))fail('invalid_doorstep_world');
 model.scene.updateMatrixWorld(true);const homes=model.placeGroups.filter(g=>g.userData.placeId==='home');if(homes.length!==1)fail('home_mesh_missing_or_ambiguous');const home=homes[0],doors=home.children.filter(m=>m.userData.door&&m.isMesh);
 const matches=doors.filter(m=>sizeMatch(m,[.53,.1,.26]));if(matches.length!==1)fail('actual_wood_threshold_missing_or_ambiguous');const threshold=matches[0],tbox=new T.Box3().setFromObject(threshold),size=tbox.getSize(new T.Vector3());
 if(!size.toArray().every(x=>finite(x)&&x>0))fail('invalid_actual_threshold_bounds');
 const panels=doors.filter(m=>m!==threshold);if(panels.length<2)fail('actual_door_panel_missing');
 const dimensions={width:size.x*1.70,height:size.y*.80,depth:size.z*2.20},joinOverlap=Math.min(.012,size.z*.05),backZ=tbox.max.z-joinOverlap,x=(tbox.min.x+tbox.max.x)/2;
 const dry=model.surfaces.filter(m=>m.name==='dry-land');if(dry.length!==1)fail('actual_floor_missing_or_ambiguous');
 const ray=new T.Raycaster(new T.Vector3(x,3,backZ+dimensions.depth*.5),new T.Vector3(0,-1,0),0,10),floor=ray.intersectObjects(dry,false)[0];if(!floor)fail('doorstep_floor_ray_miss');
 return{home,threshold,panels,dry:dry[0],dimensions,joinOverlap,worldPosition:{x,y:floor.point.y,z:backZ},thresholdData:{geometryType:threshold.geometry.type,localScale:threshold.scale.toArray(),localPosition:threshold.position.toArray(),worldMatrix:threshold.matrixWorld.toArray(),worldBounds:boxData(T,threshold)},homeTransform:{position:home.position.toArray(),scale:home.scale.toArray(),worldMatrix:home.matrixWorld.toArray()},sourceContract:'userData.door assembly; existing wooden threshold uniquely identified by source .53/.1/.26 scale, dimensions measured from actual transformed mesh, UNIT100 map conversion only'};
}
export function probePlacement(T,Scene,Town,world,model,item,basis){
 if(!basis||!item?.mesh||item.group.position.length()>EPS||item.group.scale.toArray().some(x=>Math.abs(x-1)>EPS))fail('doorstep_requires_fresh_untransformed_model');
 if(!item.bounds||!item.bounds.size.every(finite))fail('doorstep_invalid_mesh_bounds');
 if(!['width','height','depth'].every(k=>Math.abs(item.dimensions[k]-basis.dimensions[k])<EPS))fail('doorstep_not_derived_from_current_threshold');
 const before=JSON.stringify(world),originalDoorMatrices=basis.home.children.filter(x=>x.userData.door).map(x=>x.matrixWorld.toArray()),origin=new T.Vector3(basis.worldPosition.x,basis.worldPosition.y,basis.worldPosition.z);
 item.group.position.copy(origin);item.group.updateMatrixWorld(true);
 const mesh=item.mesh,assetBox=new T.Box3().setFromObject(mesh),threshold=basis.threshold,thresholdBox=new T.Box3().setFromObject(threshold),bodyWidth=item.bounds.size[0],bodyDepth=item.bounds.size[2];
 const ray=new T.Raycaster(),supports=[];
 // Actual lower cap rays at finite interior samples, not rectangle corners outside the curved front.
 for(const [xf,zf]of [[0,.15],[-.30,.18],[.30,.18],[-.36,.42],[.36,.42],[0,.55],[-.20,.67],[.20,.67],[0,.84]]){
  const x=origin.x+bodyWidth*xf,z=origin.z+bodyDepth*zf;ray.set(new T.Vector3(x,origin.y-.5,z),new T.Vector3(0,1,0));ray.far=1;const sole=ray.intersectObject(mesh,false)[0];if(!sole)fail('doorstep_actual_bottom_ray_miss');
  ray.set(new T.Vector3(x,3,z),new T.Vector3(0,-1,0));ray.far=10;const floor=ray.intersectObject(basis.dry,false)[0];if(!floor)fail('doorstep_actual_floor_ray_miss');
  const delta=sole.point.y-floor.point.y;if(Math.abs(delta)>.0001)fail('doorstep_bottom_not_on_actual_floor');
  supports.push({pointWorld:sole.point.toArray(),soleFaceIndex:sole.faceIndex,floorPointWorld:floor.point.toArray(),floorFaceIndex:floor.faceIndex,soleMinusFloor:delta});
 }
 const joints=[];
 for(const xf of[-.20,0,.20]){const p=new T.Vector3(origin.x+bodyWidth*xf,origin.y+item.bounds.size[1]*.60,thresholdBox.max.z-basis.joinOverlap*.5);if(!insideMesh(T,mesh,p)||!insideMesh(T,threshold,p))fail('doorstep_wood_joint_positive_overlap_missing');joints.push({worldPoint:p.toArray(),insideNewStone:true,insideExistingWood:true});}
 const doorClearance=basis.panels.map((m,index)=>({assemblyIndex:index,staticBounds:boxData(T,m),AABBSeparationWorld:separation(T,assetBox,new T.Box3().setFromObject(m))})),minimumDoorSeparation=Math.min(...doorClearance.map(x=>x.AABBSeparationWorld));
 if(minimumDoorSeparation<.02)fail('doorstep_closed_door_static_clearance_failed');
 let otherCount=0;const collisions=[];for(const m of model.occluders){if(m===threshold||!m.isMesh)continue;const b=new T.Box3().setFromObject(m);if(b.isEmpty())continue;otherCount++;if(separation(T,assetBox,b)<1e-6)collisions.push({name:m.name||'unnamed',box:{min:b.min.toArray(),max:b.max.toArray()}});}
 // The doorstep may intersect no scene object except its explicitly measured wooden-threshold joint.
 if(collisions.length)fail('doorstep_other_scene_mesh_intersection:'+JSON.stringify(collisions));
 const navigation=[];for(const [xf,zf]of[[-.5,1.20],[0,1.20],[.5,1.20],[-.75,1.10],[.75,1.10]]){const p=new T.Vector3(origin.x+bodyWidth*xf,origin.y,origin.z+bodyDepth*zf),town=Scene.townPoint(world,p);navigation.push({pointWorld:p.toArray(),pointTown:town,existingWalkable:Town.isWalkable(world,town.x,town.y)});}
 const blockedExisting=navigation.filter(x=>!x.existingWalkable).length;
 const footprintNavigation=supports.map(s=>{const pointTown=Scene.townPoint(world,new T.Vector3(...s.pointWorld));return{pointTown,existingWalkable:Town.isWalkable(world,pointTown.x,pointTown.y)};}),footprintBlocked=footprintNavigation.filter(x=>!x.existingWalkable).length;
 // This is an inspection of retained navigation, not adding the doorstep as a walking surface.
 const pathProjection=Scene.townPoint(world,origin),waterDry=Town.isWalkable(world,pathProjection.x,pathProjection.y),floorBox=new T.Box3().setFromObject(basis.dry);
 const boundary=drylandBoundary(T,basis.dry),shore=boundary.filter(([a,b])=>!(Math.abs(a.x-floorBox.min.x)<EPS&&Math.abs(b.x-floorBox.min.x)<EPS)&&!(Math.abs(a.z-floorBox.min.z)<EPS&&Math.abs(b.z-floorBox.min.z)<EPS)&&!(Math.abs(a.z-floorBox.max.z)<EPS&&Math.abs(b.z-floorBox.max.z)<EPS));
 if(!shore.length)fail('doorstep_actual_shoreline_missing');
 const rectangle={minX:assetBox.min.x,maxX:assetBox.max.x,minZ:assetBox.min.z,maxZ:assetBox.max.z},shoreClearance=Math.min(...shore.map(([a,b])=>edgeRectangleDistance(a,b,rectangle)));if(shoreClearance<.20)fail('doorstep_river_clearance_failed');
 const leftBankX=assetBox.min.x-floorBox.min.x;const groundFarEdges={leftWorld:leftBankX,frontWorld:floorBox.max.z-assetBox.max.z,backWorld:assetBox.min.z-floorBox.min.z};
 if(JSON.stringify(world)!==before||JSON.stringify(basis.home.children.filter(x=>x.userData.door).map(x=>x.matrixWorld.toArray()))!==JSON.stringify(originalDoorMatrices))fail('existing_world_or_door_mutated');
 item.group.position.set(0,0,0);item.group.updateMatrixWorld(true);
 return{worldPosition:basis.worldPosition,homeTransform:basis.homeTransform,sourceContract:basis.sourceContract,threshold:basis.thresholdData,dimensionsDerivedFromThreshold:basis.dimensions,actualStoneBounds:{min:assetBox.min.toArray(),max:assetBox.max.toArray(),size:assetBox.getSize(new T.Vector3()).toArray()},supports,woodJoint:{intendedPenetrationWorld:basis.joinOverlap,witnesses:joints,scope:'three finite interior witnesses in actual new stone and retained wooden threshold; not attachment strength, friction, manufacture or walking adoption'},closedDoorStaticClearance:{thresholdExcludedAsIntentionalJoint:true,otherDoorParts:doorClearance,minimumConservativeAABBSeparationWorld:minimumDoorSeparation,doorSwingVerified:false,doorTraversalVerified:false},otherSceneEnvelopes:{tested:otherCount,intersections:[],scope:'conservative actual mesh AABBs excluding the explicit threshold joint; not triangle collision simulation'},existingFootprintNavigation:{samples:footprintNavigation,blocked:footprintBlocked,retainedHouseFootprintPolicyUnchanged:true,stepIsNotWalkableAdopted:true},existingApproach:{samples:navigation,blocked:blockedExisting,stepIsNotAddedToWalkableSurfaces:true,fullDoorCorridorTraversable:false},waterBoundary:{source:'actual dry-land triangulated mesh boundary',segments:shore.length,rectangleToShorelineClearanceWorld:shoreClearance},retainedGroundBoundaryAABB:groundFarEdges,groundRaySupportsAreDryLand:true,worldUnchanged:true,bodyBinding:null,normalPlacement:false,stepTraversal:false,loadFriction:false,ownershipUnlockSave:false,scope:'One closed-door placement on saved synthetic meadow; actual underside support rays and finite positive wood joint; static spatial clearance only. Existing navigation can remain blocked near the house footprint.'};
}
