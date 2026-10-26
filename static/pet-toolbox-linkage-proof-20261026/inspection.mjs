/* Finite conservative geometry checks for named moving assemblies.
 * Existing rigid compound construction joins are not new motion collisions. */
export function localMatrix(T,item,row){return new T.Matrix4().copy(item.group.matrixWorld).invert().multiply(row.mesh.matrixWorld);}
export function obb(T,item,row){const g=row.mesh.geometry;if(!g.boundingBox)g.computeBoundingBox();const matrix=localMatrix(T,item,row),centre=g.boundingBox.getCenter(new T.Vector3()).applyMatrix4(matrix),half=g.boundingBox.getSize(new T.Vector3()).multiplyScalar(.5),axes=[];for(let i=0;i<3;i++){const a=new T.Vector3().setFromMatrixColumn(matrix,i),scale=a.length();half.setComponent(i,half.getComponent(i)*scale);axes.push(a.multiplyScalar(1/scale));}return{centre,half,axes,matrix,local:g.boundingBox};}
export function separatingGap(T,a,b){const delta=b.centre.clone().sub(a.centre),axes=[...a.axes,...b.axes];for(const x of a.axes)for(const y of b.axes){const z=new T.Vector3().crossVectors(x,y);if(z.lengthSq()>1e-12)axes.push(z.normalize());}let max=-Infinity;for(const v of axes){const ra=a.axes.reduce((n,u,i)=>n+a.half.getComponent(i)*Math.abs(v.dot(u)),0),rb=b.axes.reduce((n,u,i)=>n+b.half.getComponent(i)*Math.abs(v.dot(u)),0);max=Math.max(max,Math.abs(delta.dot(v))-ra-rb);}return max;}
function triangles(g,visit){const p=g.attributes.position,ix=g.index;for(let i=0;i<(ix?ix.count:p.count);i+=3){const ids=ix?[ix.getX(i),ix.getX(i+1),ix.getX(i+2)]:[i,i+1,i+2];if(visit(ids.map(k=>[p.getX(k),p.getY(k),p.getZ(k)])))return true;}return false;}
function surfaceHitsBox(T,A,B){const transform=new T.Matrix4().copy(B.matrix).invert().multiply(A.matrix),triangle=new T.Triangle(),box=B.local;return triangles(A.geometry,vs=>{triangle.a.fromArray(vs[0]).applyMatrix4(transform);triangle.b.fromArray(vs[1]).applyMatrix4(transform);triangle.c.fromArray(vs[2]).applyMatrix4(transform);return box.intersectsTriangle(triangle);});}
function pointInside(T,g,p){if(!g.boundingBox.containsPoint(p))return false;const direction=new T.Vector3(.911,.347,.227).normalize(),ray=new T.Ray(p,direction),a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),hit=new T.Vector3(),ds=[];triangles(g,vs=>{a.fromArray(vs[0]);b.fromArray(vs[1]);c.fromArray(vs[2]);if(ray.intersectTriangle(a,b,c,false,hit)){const d=hit.distanceTo(p);if(d>1e-7&&!ds.some(x=>Math.abs(x-d)<1e-6))ds.push(d);}return false;});return ds.length%2===1;}
export function bearingClearance(T,a,b){
 const bearing=a.id?.startsWith('handle-bearing-')?a:b.id?.startsWith('handle-bearing-')?b:null,shaft=a.id?.startsWith('handle-axle-')?a:b.id?.startsWith('handle-axle-')?b:null;
 if(!bearing||!shaft||sameSide(bearing.id)!==sameSide(shaft.id))return null;
 const g=bearing.geometry.parameters,axis=bearing.axes[0],shaftAxis=shaft.axes[1],d=shaft.centre.clone().sub(bearing.centre),off=d.clone().addScaledVector(axis,-d.dot(axis)).length();
 const lowerBore=(g.radius-g.tube)*Math.cos(Math.PI/g.tubularSegments),radius=Math.max(shaft.half.x,shaft.half.z);
 return{offAxis:off,axisDot:Math.abs(axis.dot(shaftAxis)),minimumFacetedBoreRadius:lowerBore,shaftRadius:radius,radialClearance:lowerBore-radius};
}
export function potentialIntersection(T,a,b){const bore=bearingClearance(T,a,b);if(bore&&bore.offAxis<1e-8&&bore.axisDot>1-1e-8&&bore.radialClearance>.001)return false;if(separatingGap(T,a,b)>.000001)return false;const A={geometry:a.geometry,matrix:a.matrix},B={geometry:b.geometry,matrix:b.matrix};if(surfaceHitsBox(T,A,b)&&surfaceHitsBox(T,B,a))return true;const v=new T.Vector3().fromBufferAttribute(a.geometry.attributes.position,0).applyMatrix4(a.matrix).applyMatrix4(new T.Matrix4().copy(b.matrix).invert());if(pointInside(T,b.geometry,v))return true;v.fromBufferAttribute(b.geometry.attributes.position,0).applyMatrix4(b.matrix).applyMatrix4(new T.Matrix4().copy(a.matrix).invert());return pointInside(T,a.geometry,v);}
function sameSide(id){const m=id.match(/-(-1|1)(?:-|$)/);return m?Number(m[1]):null;}
export function exception(a,b){
 // Immutable compound assemblies are deliberately joined closed solids.
 if(a.role===b.role&&['left-tray','right-tray','handle','base-content','base-fixed','fixture-static','carrier'].includes(a.role))return'rigid-assembly-construction-join';
 if([a.role,b.role].every(r=>['base-fixed','base-content','fixture-static','fixture-joint'].includes(r)))return'fixed-source-and-fixture-construction';
 const pair=[a,b],contact=pair.find(r=>r.role==='carrier-guide-contact'),other=contact===a?b:a;
 if(contact&&sameSide(contact.id)===sameSide(other.id)&&['carrier','fixture-static'].includes(other.role)&&/carrier-outer|fixture-guide-/.test(other.id))return'named-carriage-block-to-guide-or-rigid-carrier';
 if(contact&&other.role==='carrier'&&sameSide(contact.id)===sameSide(other.id))return'named-rigid-carriage-join';
 const hinge=pair.find(r=>r.role==='handle-joint'),hm=hinge===a?b:a;
 if(hinge&&hm.role==='carrier'&&hm.id==='carrier-inner-'+sameSide(hinge.id))return'named-handle-axle-to-inner-carriage-bearing';
 if(hinge&&hm.role==='handle-joint'&&sameSide(hinge.id)===sameSide(hm.id))return'named-shaft-and-washer-same-hinge';
 const pivot=pair.find(r=>r.role==='pivot-contact'),p=pivot===a?b:a;
 if(pivot){const m=pivot.id.match(/^(?:axle|cap)-(-1|1)-(-1|1)-(0|1)-(base|tray)$/);if(m){const [_,side,z,j,end]=m;
  if(p.id==='arm-'+side+'-'+z+'-'+j)return'named-link-pivot-bore';
  if(p.role==='pivot-contact'&&p.id.replace(/^(?:axle|cap)-/,'')===pivot.id.replace(/^(?:axle|cap)-/,''))return'named-pivot-shaft-and-washer';
  const stem=end==='base'?'base-box':Number(side)<0?'left-tray':'right-tray',face=Number(z)>0?'front':'back';
  if(p.id===stem+'-'+face||Number(z)>0&&p.id===stem+'-face-inlay')return'named-pivot-drilled-structural-contact-zone';
  if(end==='tray'&&Number(z)>0&&p.id.startsWith(Number(side)<0?'left-embroidered-':'right-embroidered-'))return'named-pivot-front-inlay-contact-zone';
 }}
 return null;
}
function relevant(a,b){if(a.role==='base-fixed'&&b.role==='base-content'||b.role==='base-fixed'&&a.role==='base-content')return false;const moving=r=>['left-tray','right-tray','handle','arm','pivot-contact','carrier','carrier-guide-contact','handle-joint'].includes(r.role);return moving(a)||moving(b);}
export function auditCurrent(T,item){item.group.updateMatrixWorld(true);const rows=item.parts.map(r=>({...r,...obb(T,item,r),geometry:r.mesh.geometry})),violations=[],exceptions=[],tested=[];for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){const a=rows[i],b=rows[j];if(!relevant(a,b))continue;const e=exception(a,b);if(e)continue;const gap=separatingGap(T,a,b);tested.push([a.id,b.id,gap]);if(gap<=.000001&&potentialIntersection(T,a,b)){violations.push({a:a.id,b:b.id,conservativeGap:gap});if(violations.length>=30)break;}}
 const pivots=item.pivotPairs(),maxClosure=Math.max(...pivots.map(x=>x.closure)),maxLengthError=Math.max(...pivots.map(x=>Math.abs(x.length-item.getState().fixedArmLength)));
 return{state:item.getState(),namedPairCount:tested.length,nonjointPotentialIntersections:violations,maxPivotClosure:maxClosure,maxArmLengthError:maxLengthError,handleBearingClearances:rows.filter(r=>r.id.startsWith('handle-bearing-')).map(r=>bearingClearance(T,r,rows.find(x=>x.id==='handle-axle-'+sameSide(r.id)))),inspection:'actual mesh triangles against oriented component boxes plus containment; conservative potential overlaps are not accepted as collision-free',intentionalContactPolicy:'explicit named same rigid assembly / drilled pivot / carriage guide / hinge shaft pairs only'};
}
export function auditSweep(T,item,steps=40){if(!Number.isInteger(steps)||steps<4||steps>200)throw Error('invalid_sweep');const rows=[];for(let i=0;i<=steps;i++){item.setProgress(i/steps);rows.push(auditCurrent(T,item));}item.setProgress(0);return{samples:rows.length,progressStep:1/steps,allFiniteSamplesClear:rows.every(r=>r.nonjointPotentialIntersections.length===0),maximumPivotClosure:Math.max(...rows.map(r=>r.maxPivotClosure)),maximumArmLengthError:Math.max(...rows.map(r=>r.maxArmLengthError)),violations:rows.filter(r=>r.nonjointPotentialIntersections.length).map(r=>({progress:r.state.progress,phase:r.state.phase,violations:r.nonjointPotentialIntersections})),minimumNamedPairCount:Math.min(...rows.map(r=>r.namedPairCount)),rows};}
