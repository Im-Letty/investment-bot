/* One authored below-hem inspection angle, not complete interior visibility. */
export function setInteriorCamera(T,camera,view,aspect){
 if(!Number.isFinite(aspect)||aspect<=0||![view.yaw,view.pitch,view.roll].every(Number.isFinite))throw Error('smock_invalid_interior_camera');
 const distanceBelowHem=Math.max(.68,.85/(Math.tan(66*Math.PI/360)*aspect)*1.12),a=view.yaw*Math.PI/180,p=view.pitch*Math.PI/180,direction=new T.Vector3(Math.sin(a)*Math.cos(p),Math.sin(p),Math.cos(a)*Math.cos(p));
 camera.aspect=aspect;camera.fov=66;camera.updateProjectionMatrix();camera.up.set(0,1,0);camera.position.set(.10,-distanceBelowHem,.17);camera.lookAt(camera.position.clone().add(direction));camera.rotateZ(view.roll*Math.PI/180);camera.updateMatrixWorld(true);
 return{cameraPositionLocal:camera.position.toArray(),cameraDirectionLocal:direction.toArray(),distanceBelowAuthoredHem:distanceBelowHem,openingReference:'hem',scope:'one authored below-hem angle showing inner walls and opening edges; not complete interior visibility or body calibration'};
}
