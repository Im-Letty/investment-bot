/* A neck-opening inspection angle, not complete interior visibility. */
export function setInteriorCamera(T,camera,view,aspect){
 if(!Number.isFinite(aspect)||aspect<=0||![view.yaw,view.pitch,view.roll].every(Number.isFinite))throw Error('sleep_invalid_interior_camera');
 const distanceAboveShoulder=Math.max(.35,.23/(Math.tan(66*Math.PI/360)*aspect)),a=view.yaw*Math.PI/180,p=view.pitch*Math.PI/180,direction=new T.Vector3(Math.sin(a)*Math.cos(p),-Math.abs(Math.sin(p)),Math.cos(a)*Math.cos(p)).normalize();
 camera.aspect=aspect;camera.fov=66;camera.updateProjectionMatrix();camera.up.set(0,0,-1);camera.position.set(.025,1.83+distanceAboveShoulder,.07);camera.lookAt(camera.position.clone().add(direction));camera.rotateZ(view.roll*Math.PI/180);camera.updateMatrixWorld(true);
 return{cameraPositionLocal:camera.position.toArray(),cameraDirectionLocal:direction.toArray(),distanceAboveAuthoredShoulder:distanceAboveShoulder,openingReference:'neck',scope:'one authored neck inspection showing inner cloth, opening rim and closed foot; not complete interior visibility or body calibration'};
}
