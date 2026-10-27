import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../static/vendor/three-0.160.1.module.js';
import Scene from '../static/pet-town-scene.js';
import Town from '../static/pet-town-walk.js';
const html=fs.readFileSync(new URL('../static/pet-town-fountain-demo.html',import.meta.url),'utf8');
const start=html.indexOf('const fitPoints=[];'),end=html.indexOf('\nfunction size()',start);
assert.ok(start>=0&&end>start);
const actualFitCode=html.slice(start,end);
for(const [width,height] of [[266,400],[266,480],[320,480],[336,400],[383,480],[740,420],[960,600]]){
 test('fountain inspection camera keeps the real solid and water in frame at '+width+'x'+height,()=>{
  const m=Scene.buildWorld(THREE,Town.createWorld(),{});try{
   const f=m.scene.getObjectByName('market-photo-fountain');f.removeFromParent();f.position.set(0,0,0);f.updateMatrixWorld(true);
   const bounds=new THREE.Box3().setFromObject(f),target=bounds.getCenter(new THREE.Vector3());
   const camera=new THREE.PerspectiveCamera(40,width/height,.01,25);
   const fit=new Function('THREE','f','target','camera','yaw','pitch',actualFitCode+'\nreturn {distance:fittedDistance(),count:fitPoints.length};');
   const positions=[];f.traverse(o=>{if(!o.isMesh)return;const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++)positions.push(new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld));});
   // Finite all-around inspection poses include the exact narrow portrait case
   // that previously clipped, and the highest/lowest buttons.
   for(const pitch of [-.95,.32,1.40])for(let k=0;k<12;k++){
    const yaw=k*Math.PI/6,proof=fit(THREE,f,target,camera,yaw,pitch),d=proof.distance;
    assert.ok(Number.isFinite(d)&&d>0&&proof.count>=8);
    camera.position.set(target.x+Math.sin(yaw)*Math.cos(pitch)*d,target.y+Math.sin(pitch)*d,target.z+Math.cos(yaw)*Math.cos(pitch)*d);
    camera.lookAt(target);camera.updateMatrixWorld();
    for(const v of positions){const p=v.clone().project(camera);assert.ok(Math.abs(p.x)<1&&Math.abs(p.y)<1&&p.z>-1&&p.z<1,'actual geometry must fit, not a copied camera formula');}
   }
  }finally{m.dispose();}
 });
}
