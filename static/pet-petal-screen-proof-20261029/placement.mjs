/* One isolated current-default-world screen site. Finite flat-pad witnesses only. */
import {inspectOriginalSprites} from '../pet-toolbox-integral-link-proof-20261027/placement.mjs';
import {triangleRectangleDistance} from '../pet-snow-glass-lamp-proof-20261027/placement.mjs';
import {segmentRectangleDistance,inspectMeadowInstances} from '../pet-petal-washstand-proof-20261028/placement.mjs';
export const anchor=Object.freeze({x:2400,y:400}),requiredMargin=.20;
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const gap=(a,b)=>Math.hypot(...['x','y','z'].map(k=>Math.max(0,a.min[k]-b.max[k],b.min[k]-a.max[k])));
function invalid(code){throw Error('petal_screen_'+code);}
export function placeAndProbe(T,Scene,Town,world,model,item,candidate=anchor){
 if(!candidate||![candidate.x,candidate.y].every(Number.isFinite))invalid('anchor_invalid');
 if(!item?.group||!Array.isArray(item.feet)||item.feet.length!==6)invalid('six_supports_required');
 const worldBefore=JSON.stringify(world),surfaceIDs=model.surfaces.map(x=>x.uuid).join(),occluderIDs=model.occluders.map(x=>x.uuid).join(),point=Scene.groundPoint(world,candidate),land=model.surfaces.find(x=>x.name==='dry-land');if(!land)invalid('actual_floor_missing');
 model.scene.updateMatrixWorld(true);item.group.position.set(0,0,0);item.group.updateMatrixWorld(true);const supports=[],ray=new T.Raycaster();
 for(const foot of item.feet){
  if(!foot.isMesh)invalid('support_mesh_missing');
  const half=foot.userData.contactPadHalfExtents||[.02,.02],radius=foot.userData.contactPadRadius;
  const extent=Number.isFinite(radius)&&radius>0?Math.min(.02,radius*.35):Math.min(.02,Math.abs(half[0])*.35,Math.abs(half[1])*.35);
  if(!(extent>0))invalid('contact_patch_invalid');
  const box=new T.Box3().setFromObject(foot,true),center=box.getCenter(new T.Vector3());
  for(const [dx,dz]of[[0,0],[extent,0],[-extent,0],[0,extent],[0,-extent]]){
   const x=center.x+dx,z=center.z+dz,soleRay=new T.Raycaster(new T.Vector3(x,box.min.y-.2,z),new T.Vector3(0,1,0),0,.4),sole=soleRay.intersectObject(foot,false)[0];if(!sole)invalid('actual_pad_sole_miss');
   const normal=sole.face.normal.clone().applyMatrix3(new T.Matrix3().getNormalMatrix(foot.matrixWorld)).normalize();if(normal.y>-.999)invalid('contact_sample_not_flat_pad');
   ray.set(new T.Vector3(point.x+x,5,point.z+z),new T.Vector3(0,-1,0));const floor=ray.intersectObject(land,false)[0];if(!floor)invalid('floor_miss');
   supports.push({foot:foot.name,sample:[dx,dz],x:point.x+x,z:point.z+z,soleLocalY:sole.point.y,actualFootSoleTriangle:sole.faceIndex,soleNormal:normal.toArray(),floorY:floor.point.y,requiredGroupY:floor.point.y-sole.point.y});
  }
 }
 const heights=supports.map(x=>x.requiredGroupY),floor=Math.max(...heights);if(floor-Math.min(...heights)>.002)invalid('uneven_floor');
 item.group.position.set(point.x,floor,point.z);item.group.updateMatrixWorld(true);for(const row of supports)row.soleMinusFloor=floor+row.soleLocalY-row.floorY;
 const bounds=new T.Box3().setFromObject(item.group,true),rect={minX:bounds.min.x,maxX:bounds.max.x,minZ:bounds.min.z,maxZ:bounds.max.z},navigation=[];
 for(let x=0;x<=8;x++)for(let z=0;z<=6;z++){const p=Scene.townPoint(world,{x:rect.minX+(rect.maxX-rect.minX)*x/8,z:rect.minZ+(rect.maxZ-rect.minZ)*z/6});navigation.push({point:p,walkable:Town.isWalkable(world,p.x,p.y)});}if(navigation.some(x=>!x.walkable))invalid('footprint_blocked');
 const roads=[];model.scene.traverse(m=>{if(!m.isMesh||!['layout-curved-cream-path','layout-curved-path-edge','layout-porch-cream-connector','layout-plaza-floor','layout-plaza-border','layout-plaza-border-paver'].includes(m.name))return;const pos=m.geometry.attributes.position,ix=m.geometry.index;let minimumGap=Infinity,triangles=0;for(let i=0;i<(ix?ix.count:pos.count);i+=3){const t=[0,1,2].map(k=>{const v=new T.Vector3().fromBufferAttribute(pos,ix?ix.getX(i+k):i+k).applyMatrix4(m.matrixWorld);return[v.x,v.z];});if(Math.abs(cross(...t))<1e-12)continue;triangles++;minimumGap=Math.min(minimumGap,triangleRectangleDistance(t,rect));}roads.push({name:m.name,triangles,minimumGap});});
 if(!roads.length)invalid('actual_road_missing');const minimumRoadGap=Math.min(...roads.map(x=>x.minimumGap));if(minimumRoadGap<requiredMargin)invalid('road_clearance');
 const cards=inspectOriginalSprites(T,model,item,{x:point.x,y:floor,z:point.z});if(cards.minimumGap<requiredMargin)invalid('original_card_clearance');
 const meadowInstances=inspectMeadowInstances(T,model,rect);if(meadowInstances.minimumGap<requiredMargin)invalid('meadow_clearance');
 const buildings=model.placeGroups.map(g=>{const box=new T.Box3();g.traverse(m=>{if(m.isMesh)box.union(new T.Box3().setFromObject(m,true));});return{place:g.userData.placeId,intersects:!box.isEmpty()&&bounds.intersectsBox(box),separation:box.isEmpty()?null:gap(bounds,box)};});if(buildings.some(x=>x.intersects||x.separation!==null&&x.separation<requiredMargin))invalid('building_clearance');
 const edges=new Map(),pos=land.geometry.attributes.position,ix=land.geometry.index,key=p=>p.toArray().map(x=>Math.round(x*1e7)).join(':');
 for(let i=0;i<(ix?ix.count:pos.count);i+=3){const vs=[0,1,2].map(k=>new T.Vector3().fromBufferAttribute(pos,ix?ix.getX(i+k):i+k).applyMatrix4(land.matrixWorld));for(let j=0;j<3;j++){const a=vs[j],b=vs[(j+1)%3],k=[key(a),key(b)].sort().join('|'),r=edges.get(k)||{count:0,a:[a.x,a.z],b:[b.x,b.z]};r.count++;edges.set(k,r);}}
 const boundaryRows=[...edges.values()].filter(x=>x.count===1).map(x=>({a:x.a,b:x.b,footprintGap:segmentRectangleDistance(x.a,x.b,rect)}));if(!boundaryRows.length)invalid('actual_shore_missing');const minimumShoreGap=Math.min(...boundaryRows.map(x=>x.footprintGap));if(minimumShoreGap<requiredMargin)invalid('shore_clearance');
 let water=null;model.scene.traverse(m=>{if(m.isMesh&&m.name==='water')water=m;});if(!water)invalid('water_backing_missing');const waterBox=new T.Box3().setFromObject(water,true),soleAboveWaterBacking=Math.min(...supports.map(x=>floor+x.soleLocalY))-waterBox.max.y;if(!(soleAboveWaterBacking>0))invalid('below_water');
 if(worldBefore!==JSON.stringify(world)||surfaceIDs!==model.surfaces.map(x=>x.uuid).join()||occluderIDs!==model.occluders.map(x=>x.uuid).join())invalid('world_mutated');
 return{townPoint:{...candidate},worldPosition:item.group.position.toArray(),projectedFootprint:rect,supports,flatPadSampleCount:supports.length,flatPads:6,entireCurvedFootSoleContactVerified:false,finiteWalkability:{samples:navigation.length,blocked:0},roads,minimumRoadGap,requiredMargin,originalSpriteEnvelopeClearance:cards,buildingProxyClearance:buildings,meadowInstances,shoreline:{segments:boundaryRows.length,minimumGap:minimumShoreGap,rows:boundaryRows,method:'every actual dry-land boundary segment against entire screen XZ AABB'},waterBacking:{topY:waterBox.max.y,soleAboveWaterBacking},worldUnchanged:true,walkableSurfacesUnchanged:true,occludersUnchanged:true,notRegisteredAsTownSurface:true,normalPlacement:false,ownershipUnlockSave:false,bodyBinding:null,limits:'one fixed authored screen pose at one synthetic current-default-world site;30 finite rays on six flat contact pads,63 finite walkability samples and conservative envelope clearances. Not a continuous placement/stability/physical/body or all-camera-visibility guarantee'};
}
