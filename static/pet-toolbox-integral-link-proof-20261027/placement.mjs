/* One synthetic preview location; original raster cards are not physical volume meshes. */
import {probePlacement as drylandProbe} from '../pet-toolbox-joint-proof-20261026/placement.mjs';
export const anchor=Object.freeze({x:1200,y:1300}),requiredMargin=.20;
export function inspectOriginalSprites(T,model,item,worldPosition){
 model.scene.updateMatrixWorld(true);
 const translation=new T.Vector3(worldPosition.x,worldPosition.y,worldPosition.z);
 const envelope=new T.Box3(new T.Vector3(...item.bounds.min).add(translation),new T.Vector3(...item.bounds.max).add(translation)),rows=[],kinds={};
 model.scene.traverse(sprite=>{
  if(!sprite.isSprite||!sprite.userData.originalArt)return;
  // Original sprites are hidden before preload. Include these future-visible
  // cards, but ignore any whole parent group that is intentionally hidden.
  for(let p=sprite.parent;p;p=p.parent)if(!p.visible)return;
  const center=sprite.getWorldPosition(new T.Vector3()),scale=sprite.getWorldScale(new T.Vector3());let radius=0;
  for(const u of[0,1])for(const v of[0,1])radius=Math.max(radius,Math.hypot((u-sprite.center.x)*scale.x,(v-sprite.center.y)*scale.y));
  const kind=sprite.userData.originalArtKind;kinds[kind]=(kinds[kind]||0)+1;
  rows.push({kind,sourceSHA256:sprite.userData.sourceSHA256,contact:center.toArray(),fullQuadRadius:radius,envelopeDistance:envelope.distanceToPoint(center),gap:envelope.distanceToPoint(center)-radius});
 });
 if(!rows.length)throw Error('missing_original_fixture_cards');
 rows.sort((a,b)=>a.gap-b.gap);
 return{checkedCards:rows.length,kinds,minimumGap:rows[0].gap,requiredMargin,nearest:rows.slice(0,10),
  method:'sphere enclosing all four full raw Sprite quad corners from actual world scale/center; sphere-to-conservative-3D-pose-envelope distance; includes faint/transparent corners without cropping',
  cameraOrientationIndependentGeometryEnvelope:true,physicalFixtureVolumes:false,allCameraProjectionOcclusionGuaranteed:false};
}
export function probePlacement(T,Scene,Town,world,model,item,candidate=anchor){
 const result=drylandProbe(T,Scene,Town,world,model,item,candidate);
 const clearance=inspectOriginalSprites(T,model,item,result.worldPosition);
 if(clearance.minimumGap<requiredMargin)throw Error('original_fixture_visual_envelope_overlap');
 return{...result,originalSpriteEnvelopeClearance:clearance,originalSpriteVisualEnvelopeClearanceVerified:true,
  otherDecorationCollisionVerified:false,normalPlacement:false,
  scope:'one synthetic dryland preview location, actual four sole rays/finite walkability samples and current original-Sprite full-quad envelope clearance only; no ordinary owner placement, physical fixture volume or all-camera visibility proof'};
}
