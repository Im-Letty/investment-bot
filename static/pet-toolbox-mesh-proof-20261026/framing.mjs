/* Camera-distance floor from real authored box corners, no geometry scaling. */
export function fitView(T,bounds,view,aspect){
 if(!Number.isFinite(aspect)||aspect<=0||!bounds||![...bounds.min,...bounds.max,view.yaw,view.pitch,view.roll,view.distance].every(Number.isFinite))throw Error('invalid_framing');
 const verticalFov=46,margin=1.12,target=new T.Vector3(0,.54,0),a=view.yaw*Math.PI/180,p=view.pitch*Math.PI/180,direction=new T.Vector3(Math.sin(a)*Math.cos(p),Math.sin(p),Math.cos(a)*Math.cos(p));
 const camera=new T.PerspectiveCamera(verticalFov,aspect,.04,90);camera.position.copy(target).add(direction);camera.lookAt(target);camera.rotateZ(view.roll*Math.PI/180);camera.updateMatrixWorld(true);
 const right=new T.Vector3().setFromMatrixColumn(camera.matrixWorld,0),up=new T.Vector3().setFromMatrixColumn(camera.matrixWorld,1),back=new T.Vector3().setFromMatrixColumn(camera.matrixWorld,2),tanV=Math.tan(verticalFov*Math.PI/360),tanH=tanV*aspect;
 let minimumDistance=.12;const projected=[];
 for(const x of [bounds.min[0],bounds.max[0]])for(const y of [bounds.min[1],bounds.max[1]])for(const z of [bounds.min[2],bounds.max[2]]){const q=new T.Vector3(x,y,z).sub(target),sx=q.dot(right),sy=q.dot(up),sz=q.dot(back);minimumDistance=Math.max(minimumDistance,sz+margin*Math.abs(sx)/tanH,sz+margin*Math.abs(sy)/tanV,sz+.08);projected.push([sx,sy,sz]);}
 const actualDistance=Math.max(view.distance,minimumDistance),nx=projected.map(q=>q[0]/((actualDistance-q[2])*tanH)),ny=projected.map(q=>q[1]/((actualDistance-q[2])*tanV));
 return{requestedDistance:view.distance,minimumDistance,actualDistance,aspect,verticalFov,margin,ndcBounds:{minX:Math.min(...nx),maxX:Math.max(...nx),minY:Math.min(...ny),maxY:Math.max(...ny)},scope:'authored toolbox bounds only; frame-fit is not body or owner-world placement fit'};
}
