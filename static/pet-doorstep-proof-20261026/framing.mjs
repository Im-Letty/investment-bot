/* Frame real doorstep bounds; no furniture/body scaling. */
export function fitView(T,bounds,view,aspect){
 if(!Number.isFinite(aspect)||aspect<=0||![...bounds.min,...bounds.max,view.yaw,view.pitch,view.roll,view.distance].every(Number.isFinite))throw Error('invalid_doorstep_framing');
 const target=new T.Vector3(...bounds.min).add(new T.Vector3(...bounds.max)).multiplyScalar(.5),a=view.yaw*Math.PI/180,p=view.pitch*Math.PI/180;
 const cam=new T.PerspectiveCamera(46,aspect,.04,100);cam.position.copy(target).add(new T.Vector3(Math.sin(a)*Math.cos(p),Math.sin(p),Math.cos(a)*Math.cos(p)));cam.lookAt(target);cam.rotateZ(view.roll*Math.PI/180);cam.updateMatrixWorld(true);
 const right=new T.Vector3().setFromMatrixColumn(cam.matrixWorld,0),up=new T.Vector3().setFromMatrixColumn(cam.matrixWorld,1),back=new T.Vector3().setFromMatrixColumn(cam.matrixWorld,2),tv=Math.tan(46*Math.PI/360),th=tv*aspect,margin=1.16;let floor=.2;const qs=[];
 for(const x of[bounds.min[0],bounds.max[0]])for(const y of[bounds.min[1],bounds.max[1]])for(const z of[bounds.min[2],bounds.max[2]]){const v=new T.Vector3(x,y,z).sub(target),q=[v.dot(right),v.dot(up),v.dot(back)];qs.push(q);floor=Math.max(floor,q[2]+margin*Math.abs(q[0])/th,q[2]+margin*Math.abs(q[1])/tv,q[2]+.08);}
 const distance=Math.max(floor,view.distance),xs=qs.map(q=>q[0]/((distance-q[2])*th)),ys=qs.map(q=>q[1]/((distance-q[2])*tv));
 return{targetLocal:target.toArray(),requestedDistance:view.distance,minimumDistance:floor,actualDistance:distance,ndcBounds:{minX:Math.min(...xs),maxX:Math.max(...xs),minY:Math.min(...ys),maxY:Math.max(...ys)},scope:'real authored doorstep bounds only; not body seating/fit calibration'};
}
