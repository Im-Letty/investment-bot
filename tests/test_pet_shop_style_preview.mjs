import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import * as THREE from '../static/vendor/three-0.160.1.module.js';import Scene from '../static/pet-town-scene.js';import Town from '../static/pet-town-walk.js';
const html=fs.readFileSync(new URL('../static/pet-town-shop-style-demo.html',import.meta.url),'utf8');
const boundsCode=html.slice(html.indexOf('function subjectBounds('),html.indexOf('function choose('));
const distanceCode=html.slice(html.indexOf('function fitDistance(){'),html.indexOf('function size(){'));
const subjectBounds=new Function('THREE',boundsCode+';return subjectBounds;')(THREE);
const distanceFor=new Function('camera','bounds','target','desiredDistance','yaw','pitch',distanceCode+';return fitDistance();');
for(const [width,height]of [[266,400],[320,600],[390,600],[740,420],[850,600]]){
test('shop comparison frames actual visible pixels and solid vertices at '+width+'x'+height,()=>{
const model=Scene.buildWorld(THREE,Town.createWorld(),{});try{
let grove,tulip;model.scene.traverse(o=>{if(!grove&&o.userData.originalArtKind==='treeGrove')grove=o;if(!tulip&&o.userData.originalArtKind==='shopTulip')tulip=o;});
const home=model.placeGroups.find(g=>g.userData.placeId==='home');
for(const selected of [home,grove,tulip])for(const [yaw,pitch]of [[0,.4],[-.65,.4],[.65,.4],[Math.PI,.4],[0,1.35],[.7,.12]]){
const bounds=subjectBounds(selected,yaw,pitch),target=bounds.getCenter(new THREE.Vector3()),camera=new THREE.PerspectiveCamera(Scene.viewportFov(width,height),width/height,.03,90),d=distanceFor(camera,bounds,target,selected===tulip?1.4:4.2,yaw,pitch);
assert.ok(Number.isFinite(d)&&d>0);camera.position.set(target.x+Math.sin(yaw)*Math.cos(pitch)*d,target.y+Math.sin(pitch)*d,target.z+Math.cos(yaw)*Math.cos(pitch)*d);camera.lookAt(target);camera.updateMatrixWorld();
function inside(p){assert.ok(Math.abs(p.x)<1&&Math.abs(p.y)<1&&p.z>-1&&p.z<1,'rendered object must remain inside view');}
selected.traverse(o=>{
if(o.isSprite&&o.userData.originalArt){const a=o.userData.alphaBounds,sw=o.userData.sourceWidth,sh=o.userData.sourceHeight,scale=o.getWorldScale(new THREE.Vector3()),origin=o.getWorldPosition(new THREE.Vector3()).applyMatrix4(camera.matrixWorldInverse),r=o.material.rotation||0;
 // Independent renderer-space projection: Sprite.center affects the shader,
 // whereas Box3.setFromObject sees only the unshifted unit quad.
 for(const u of [a[0]/sw,a[2]/sw])for(const v of [1-a[3]/sh,1-a[1]/sh]){const x=(u-o.center.x)*scale.x,y=(v-o.center.y)*scale.y;inside(new THREE.Vector3(origin.x+x*Math.cos(r)-y*Math.sin(r),origin.y+x*Math.sin(r)+y*Math.cos(r),origin.z).applyMatrix4(camera.projectionMatrix));}
}else if(o.isMesh){const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++)inside(new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld).project(camera));}
});
}
}finally{model.dispose();}
});
}
