import {inspectOriginalSprites} from '../pet-toolbox-integral-link-proof-20261027/placement.mjs';
import {triangleRectangleDistance} from '../pet-oak-wayfinding-sign-proof-20261027/placement.mjs';
export const anchor=Object.freeze({x:1200,y:1300});
export function probePlacement(T,Scene,Town,world,model,item,candidate=anchor){
 const original=item.group.position.clone(),saved=JSON.stringify(world),p=Scene.groundPoint(world,candidate),b=item.bounds,ray=new T.Raycaster(),supports=[],land=model.surfaces.filter(s=>s.name==='dry-land');
 item.group.position.set(0,0,0);item.group.updateMatrixWorld(true);model.scene.updateMatrixWorld(true);
 try{
  for(const id of item.footprint.contactPartIds){const box=new T.Box3().setFromObject(item.byId.get(id),true),c=box.getCenter(new T.Vector3());
   for(const [x,z]of [[c.x,c.z],[box.min.x,box.min.z],[box.min.x,box.max.z],[box.max.x,box.min.z],[box.max.x,box.max.z]]){
    ray.set(new T.Vector3(p.x+x,4,p.z+z),new T.Vector3(0,-1,0));const hit=ray.intersectObjects(land,false)[0];if(!hit)throw Error('lid_actual_floor_missing');supports.push({id,x,z,actualWorldSoleY:box.min.y,supportY:hit.point.y});}
  }
  const floor=Math.max(...supports.map(s=>s.supportY-s.actualWorldSoleY));for(const s of supports)s.actualWorldSoleMinusFloor=floor+s.actualWorldSoleY-s.supportY;
  if(supports.length!==20||supports.some(s=>Math.abs(s.actualWorldSoleMinusFloor)>1e-7))throw Error('lid_uneven_actual_floor');
  const w={x:p.x,y:floor,z:p.z},rect={minX:w.x+b.min[0],maxX:w.x+b.max[0],minZ:w.z+b.min[2],maxZ:w.z+b.max[2]},roads=[];
  let count=0,blocked=0;for(let x=b.min[0];x<=b.max[0]+1e-7;x+=.06)for(let z=b.min[2];z<=b.max[2]+1e-7;z+=.06){count++;if(!Town.isWalkable(world,candidate.x+100*x,candidate.y+100*z))blocked++;}
  if(blocked)throw Error('lid_footprint_not_walkable');
  model.scene.traverse(mesh=>{
   if(!mesh.isMesh||!['layout-curved-cream-path','layout-curved-path-edge','layout-porch-cream-connector','layout-plaza-floor','layout-plaza-border','layout-plaza-border-paver'].includes(mesh.name))return;
   const position=mesh.geometry.attributes.position,index=mesh.geometry.index;let minimumGap=Infinity,triangles=0;
   for(let i=0;i<(index?index.count:position.count);i+=3){const t=[0,1,2].map(k=>{const v=new T.Vector3().fromBufferAttribute(position,index?index.getX(i+k):i+k).applyMatrix4(mesh.matrixWorld);return[v.x,v.z];});
    const area=(t[1][0]-t[0][0])*(t[2][1]-t[0][1])-(t[1][1]-t[0][1])*(t[2][0]-t[0][0]);if(Math.abs(area)<1e-12)continue;triangles++;minimumGap=Math.min(minimumGap,triangleRectangleDistance(t,rect));}
   roads.push({name:mesh.name,triangles,minimumGap});
  });
  if(!roads.length)throw Error('lid_actual_road_mesh_missing');const minimumRoadGap=Math.min(...roads.map(r=>r.minimumGap));
  if(minimumRoadGap<.20)throw Error('lid_road_clearance');
  const originalSpriteEnvelopeClearance=inspectOriginalSprites(T,model,item,w);if(originalSpriteEnvelopeClearance.minimumGap<.20)throw Error('lid_original_card_overlap');
  if(JSON.stringify(world)!==saved)throw Error('lid_world_mutated');
  return{townPoint:candidate,worldPosition:w,authoredUniformInstanceScale:item.authoredScale,anatomicallyCalibratedScale:false,feet:supports,actualWorldSolesChecked:true,finiteFootprintGrid:{count,blocked},roads,minimumRoadGap,requiredRoadMargin:.20,projectedSweepFootprint:rect,originalSpriteEnvelopeClearance,
   scope:'one dryland preview site;20 actual sole/floor rays, finite swept-footprint walkability, all actual road triangles and141 conservative original-image card envelopes',worldUnchanged:true,ordinaryPlacement:false,normalPlacement:false};
 }finally{item.group.position.copy(original);item.group.updateMatrixWorld(true);}
}
