import {inspectOriginalSprites} from '../pet-toolbox-integral-link-proof-20261027/placement.mjs';
import {triangleRectangleDistance} from '../pet-snow-glass-lamp-proof-20261027/placement.mjs';
export const anchor=Object.freeze({x:2350,y:400}),requiredMargin=.20;
const pointSegment=(p,a,b)=>{const x=b[0]-a[0],z=b[1]-a[1],l=x*x+z*z,t=l?Math.max(0,Math.min(1,((p[0]-a[0])*x+(p[1]-a[1])*z)/l)):0;return Math.hypot(p[0]-a[0]-t*x,p[1]-a[1]-t*z);};
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function intersects(a,b,c,d){const p=cross(a,b,c),q=cross(a,b,d),r=cross(c,d,a),s=cross(c,d,b);return p*q<=1e-16&&r*s<=1e-16&&Math.max(Math.min(a[0],b[0]),Math.min(c[0],d[0]))<=Math.min(Math.max(a[0],b[0]),Math.max(c[0],d[0]))+1e-9&&Math.max(Math.min(a[1],b[1]),Math.min(c[1],d[1]))<=Math.min(Math.max(a[1],b[1]),Math.max(c[1],d[1]))+1e-9;}
export function segmentRectangleDistance(a,b,r){
 const corners=[[r.minX,r.minZ],[r.maxX,r.minZ],[r.maxX,r.maxZ],[r.minX,r.maxZ]],inside=p=>p[0]>=r.minX&&p[0]<=r.maxX&&p[1]>=r.minZ&&p[1]<=r.maxZ;
 if(inside(a)||inside(b)||corners.some((c,i)=>intersects(a,b,c,corners[(i+1)%4])))return 0;
 const endpoint=p=>Math.hypot(Math.max(r.minX-p[0],0,p[0]-r.maxX),Math.max(r.minZ-p[1],0,p[1]-r.maxZ));
 return Math.min(endpoint(a),endpoint(b),...corners.map(c=>pointSegment(c,a,b)));
}
export function placeAndProbe(T,Scene,Town,world,model,item,candidate=anchor){
 if(!candidate||![candidate.x,candidate.y].every(Number.isFinite))throw Error('panel_anchor_invalid');
 const worldBefore=JSON.stringify(world),surfaceIDs=model.surfaces.map(x=>x.uuid).join(),occluderIDs=model.occluders.map(x=>x.uuid).join(),point=Scene.groundPoint(world,candidate),land=model.surfaces.find(x=>x.name==='dry-land');if(!land)throw Error('panel_actual_floor_missing');
 model.scene.updateMatrixWorld(true);item.group.position.set(0,0,0);item.group.updateMatrixWorld(true);const ray=new T.Raycaster(),supports=[];
 for(const foot of item.feet){const b=new T.Box3().setFromObject(foot,true);for(const[x,z]of[[foot.position.x,foot.position.z],[b.min.x,b.min.z],[b.min.x,b.max.z],[b.max.x,b.min.z],[b.max.x,b.max.z]]){ray.set(new T.Vector3(point.x+x,4,point.z+z),new T.Vector3(0,-1,0));const hit=ray.intersectObject(land,false)[0];if(!hit)throw Error('panel_floor_miss');supports.push({foot:foot.name,x:point.x+x,z:point.z+z,soleLocalY:b.min.y,floorY:hit.point.y});}}
 const floor=Math.max(...supports.map(x=>x.floorY));if(Math.max(...supports.map(x=>x.floorY))-Math.min(...supports.map(x=>x.floorY))>.002)throw Error('panel_uneven_floor');
 item.group.position.set(point.x,floor,point.z);item.group.updateMatrixWorld(true);for(const p of supports)p.soleMinusFloor=floor+p.soleLocalY-p.floorY;
 const b=new T.Box3().setFromObject(item.group,true),rect={minX:b.min.x,maxX:b.max.x,minZ:b.min.z,maxZ:b.max.z},navigation=[];
 for(let x=0;x<=8;x++)for(let z=0;z<=6;z++){const p=Scene.townPoint(world,{x:rect.minX+(rect.maxX-rect.minX)*x/8,z:rect.minZ+(rect.maxZ-rect.minZ)*z/6});navigation.push({point:p,walkable:Town.isWalkable(world,p.x,p.y)});}if(navigation.some(p=>!p.walkable))throw Error('panel_footprint_blocked');

 const roads=[];model.scene.traverse(m=>{if(!m.isMesh||!['layout-curved-cream-path','layout-curved-path-edge','layout-porch-cream-connector','layout-plaza-floor','layout-plaza-border','layout-plaza-border-paver'].includes(m.name))return;const pos=m.geometry.attributes.position,ix=m.geometry.index;let gap=Infinity,count=0;for(let i=0;i<(ix?ix.count:pos.count);i+=3){const t=[0,1,2].map(k=>{const v=new T.Vector3().fromBufferAttribute(pos,ix?ix.getX(i+k):i+k).applyMatrix4(m.matrixWorld);return[v.x,v.z];});if(Math.abs(cross(...t))<1e-12)continue;count++;gap=Math.min(gap,triangleRectangleDistance(t,rect));}roads.push({name:m.name,triangles:count,minimumGap:gap});});
 if(!roads.length)throw Error('panel_actual_road_missing');const minimumRoadGap=Math.min(...roads.map(r=>r.minimumGap));if(minimumRoadGap<requiredMargin)throw Error('panel_road_clearance');
 const cards=inspectOriginalSprites(T,model,item,{x:point.x,y:floor,z:point.z});if(cards.minimumGap<requiredMargin)throw Error('panel_original_card_overlap');
 const buildings=model.placeGroups.map(g=>{const box=new T.Box3();g.traverse(m=>{if(m.isMesh)box.union(new T.Box3().setFromObject(m,true));});return{place:g.userData.placeId,intersects:!box.isEmpty()&&b.intersectsBox(box),separation:box.isEmpty()?null:Math.hypot(...['x','y','z'].map(k=>Math.max(0,box.min[k]-b.max[k],b.min[k]-box.max[k])))};});if(buildings.some(p=>p.intersects))throw Error('panel_building_overlap');
 const boundary=new Map(),pos=land.geometry.attributes.position,ix=land.geometry.index,key=p=>p.toArray().map(x=>Math.round(x*1e7)).join(':');
 for(let i=0;i<(ix?ix.count:pos.count);i+=3){const vs=[0,1,2].map(k=>new T.Vector3().fromBufferAttribute(pos,ix?ix.getX(i+k):i+k).applyMatrix4(land.matrixWorld));for(let j=0;j<3;j++){const a=vs[j],z=vs[(j+1)%3],k=[key(a),key(z)].sort().join('|'),r=boundary.get(k)||{count:0,a:[a.x,a.z],b:[z.x,z.z]};r.count++;boundary.set(k,r);}}
 const boundaryRows=[...boundary.values()].filter(p=>p.count===1).map(p=>({a:p.a,b:p.b,footprintGap:segmentRectangleDistance(p.a,p.b,rect)})),minimumShoreGap=Math.min(...boundaryRows.map(p=>p.footprintGap));if(minimumShoreGap<requiredMargin)throw Error('panel_shore_clearance');
 let water=null;model.scene.traverse(m=>{if(m.isMesh&&m.name==='water')water=m;});if(!water)throw Error('panel_water_backing_missing');const waterBox=new T.Box3().setFromObject(water,true),soleAboveWaterBacking=floor-waterBox.max.y;if(soleAboveWaterBacking<=0)throw Error('panel_below_water');
 const sitePlan=model.scene.userData.meadowFlowers?.sitePlan;if(!Array.isArray(sitePlan)||!sitePlan.length)throw Error('panel_actual_meadow_missing');
 const clusterRadius=.52,siteRows=sitePlan.map(p=>({id:p.id,x:p.x,z:p.z,envelopeRadius:clusterRadius,gap:Math.hypot(Math.max(rect.minX-p.x,0,p.x-rect.maxX),Math.max(rect.minZ-p.z,0,p.z-rect.maxZ))-clusterRadius})),minimumMeadowGap=Math.min(...siteRows.map(p=>p.gap));if(minimumMeadowGap<requiredMargin)throw Error('panel_meadow_cluster_overlap');
 if(worldBefore!==JSON.stringify(world)||surfaceIDs!==model.surfaces.map(x=>x.uuid).join()||occluderIDs!==model.occluders.map(x=>x.uuid).join())throw Error('panel_world_mutated');
 return{meadowEnvelopeClearance:{sites:siteRows.length,clusterRadius,minimumGap:minimumMeadowGap,requiredMargin,rows:siteRows,scope:'all actual current meadow site centers against complete rectangle with conservative .52 radius; .48 cluster limit plus .018 sway rounded up, not physical plant/actor contact or all scene meshes'},townPoint:candidate,worldPosition:item.group.position.toArray(),projectedFootprint:rect,supports,finiteWalkability:{samples:navigation.length,blocked:0},roads,minimumRoadGap,requiredMargin,originalSpriteEnvelopeClearance:cards,buildingProxyClearance:buildings,
 shoreline:{segments:boundaryRows.length,minimumGap:minimumShoreGap,rows:boundaryRows,method:'every actual dry-land boundary segment against full projected rectangle, including crossing and endpoint/corner distances'},
 waterBacking:{topY:waterBox.max.y,soleAboveWaterBacking,scope:'actual wet backing under dry land, no water physics'},
 worldUnchanged:true,walkableSurfacesUnchanged:true,occludersUnchanged:true,notRegisteredAsTownSurface:true,normalPlacement:false,ownershipUnlockSave:false,bodyBinding:null,
 limits:'one unchanged default-world off-road authored placement,10sole rays,finite walkability,actual road triangles and conservative full-card envelopes; no owner-world placement, anatomical fit or all-camera visibility guarantee'};
}
