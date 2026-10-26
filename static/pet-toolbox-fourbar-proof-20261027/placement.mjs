/* Current PR96 original-card scene, not an old synthetic-only village. */
import {probePlacement as supportProbe} from '../pet-toolbox-joint-proof-20261026/placement.mjs';
import {inspectOriginalSprites} from '../pet-toolbox-integral-link-proof-20261027/placement.mjs';
export {inspectOriginalSprites};
export const anchor=Object.freeze({x:1200,y:1300});
export function probePlacement(T,Scene,Town,world,model,item,candidate=anchor){
 const result=supportProbe(T,Scene,Town,world,model,item,candidate),old=item.group.position.clone();
 let feet;
 try{item.group.position.set(result.worldPosition.x,result.worldPosition.y,result.worldPosition.z);item.group.updateMatrixWorld(true);
  feet=result.feet.map(row=>{const actualWorldSoleY=new T.Box3().setFromObject(item.byId.get(row.id),true).min.y;return{...row,actualWorldSoleY,actualWorldSoleMinusFloor:actualWorldSoleY-row.supportY};});
  if(feet.some(row=>Math.abs(row.actualWorldSoleMinusFloor)>1e-7))throw Error('actual_sole_floor_gap');
 }finally{item.group.position.copy(old);item.group.updateMatrixWorld(true);}
 const clearance=inspectOriginalSprites(T,model,item,result.worldPosition);if(clearance.minimumGap<clearance.requiredMargin)throw Error('original_fixture_visual_envelope_overlap');
 return{...result,feet,actualWorldSolesChecked:true,originalSpriteEnvelopeClearance:clearance,originalSpriteVisualEnvelopeClearanceVerified:true,otherDecorationCollisionVerified:false,normalPlacement:false,
  scope:'one dryland preview location; actual transformed four sole vertices/floor ray hits, finite walkability samples, current original Sprite full-quad conservative envelope; no ordinary placement or all-camera occlusion proof'};
}
