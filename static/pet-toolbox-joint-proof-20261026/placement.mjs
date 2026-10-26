/* Four supports under this standalone joint coupon only. */
export function probePlacement(T,Scene,Town,world,model,item,anchor){
 const p=Scene.groundPoint(world,anchor),b=item.bounds,nx=Math.ceil((b.max[0]-b.min[0])/.08),nz=Math.ceil((b.max[2]-b.min[2])/.08);let count=0,blocked=0;
 for(let i=0;i<=nx;i++)for(let j=0;j<=nz;j++){count++;if(!Town.isWalkable(world,anchor.x+100*(b.min[0]+(b.max[0]-b.min[0])*i/nx),anchor.y+100*(b.min[2]+(b.max[2]-b.min[2])*j/nz)))blocked++;}
 const ray=new T.Raycaster(),feet=[],dry=model.surfaces.filter(x=>x.name==='dry-land');model.scene.updateMatrixWorld(true);
 for(const id of item.footprint.contactPartIds){const m=item.byId.get(id),sole=new T.Box3().setFromObject(m).min.y;ray.set(new T.Vector3(p.x+m.position.x,2,p.z+m.position.z),new T.Vector3(0,-1,0));const hit=ray.intersectObjects(dry,false)[0];if(!hit)throw Error('missing_floor_support');feet.push({id,localSoleY:sole,supportY:hit.point.y,surface:hit.object.name});}
 if(blocked||feet.length!==4)throw Error('joint_coupon_placement_not_clear');const floor=Math.max(...feet.map(x=>x.supportY));if(Math.max(...feet.map(x=>x.supportY))-Math.min(...feet.map(x=>x.supportY))>.002)throw Error('uneven_floor');for(const f of feet)f.soleMinusFloor=floor+f.localSoleY-f.supportY;
 return{townPoint:anchor,worldPosition:{x:p.x,y:floor,z:p.z},finiteFootprintGrid:{count,blocked},feet,normalPlacement:false,otherDecorationCollisionVerified:false,scope:'one synthetic dryland placement, four actual sole/floor rays and finite walkability grid only; not owner placement or all-world fit'};
}
