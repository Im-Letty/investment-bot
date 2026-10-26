/* One authored structural arch apron. Construction dimensions come from the saved wooden threshold. */
export const spec=Object.freeze({id:'arched-stone-doorstep-v1',revision:1,unit:'world-units',category:'construction_components',style:'warm_cottage_classic',season:'all_season',bodyBinding:null,palette:{top:'#e4d5bb',side:'#cdbb9d'},scope:'one closed beveled arch-plan doorstep and one static home-door placement; no traversable adoption, door swing, load, unlock, owner layout or save'});
const finite=n=>typeof n==='number'&&Number.isFinite(n);
export function build(T,dimensions,{document:doc}={}){
 if(!dimensions||!['width','height','depth'].every(k=>finite(dimensions[k])&&dimensions[k]>0)||dimensions.width<.2||dimensions.width>2||dimensions.depth<.15||dimensions.depth>1.5||dimensions.height<.025||dimensions.height>.18)throw Error('invalid_doorstep_construction_dimensions');
 const {width,height,depth}=dimensions,b=Math.min(height*.15,.014),hx=width/2-b,stem=depth*.30-b,arc=depth-stem-2*b;
 if(hx<=b||stem<=b||arc<=b||height<=2*b)throw Error('invalid_doorstep_bevel_dimensions');
 const shape=new T.Shape();shape.moveTo(-hx,-b);shape.lineTo(-hx,-b-stem);for(let i=1;i<=64;i++){const a=Math.PI+Math.PI*i/64;shape.lineTo(i===64?hx:Math.cos(a)*hx,i===64?-b-stem:-b-stem+Math.sin(a)*arc);}shape.lineTo(hx,-b);shape.closePath();
 const geo=new T.ExtrudeGeometry(shape,{depth:height-2*b,bevelEnabled:true,bevelThickness:b,bevelSize:b,bevelSegments:3,steps:1,curveSegments:32});
 geo.rotateX(-Math.PI/2);geo.computeBoundingBox();geo.translate(0,-geo.boundingBox.min.y,-geo.boundingBox.min.z);
 geo.computeVertexNormals();const pos=geo.attributes.position,n=geo.attributes.normal,pool=new Map();
 for(let i=0;i<pos.count;i++){const k=[pos.getX(i),pos.getY(i),pos.getZ(i)].map(x=>Math.round(x*1e8)).join(':');const v=pool.get(k)||new T.Vector3();v.add(new T.Vector3().fromBufferAttribute(n,i));pool.set(k,v);}
 for(let i=0;i<pos.count;i++){const k=[pos.getX(i),pos.getY(i),pos.getZ(i)].map(x=>Math.round(x*1e8)).join(':');const v=pool.get(k).clone().normalize();n.setXYZ(i,v.x,v.y,v.z);}
 geo.computeBoundingBox();geo.computeBoundingSphere();
 let grain=null;if(doc){const c=doc.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d');x.fillStyle='#eee2ce';x.fillRect(0,0,128,128);let seed=24891;for(let i=0;i<320;i++){seed=(seed*1664525+1013904223)>>>0;const px=seed%128;seed=(seed*1664525+1013904223)>>>0;const py=seed%128;x.fillStyle=i%3?'#e6dac6':'#f4eada';x.fillRect(px,py,1,1);}grain=new T.CanvasTexture(c);grain.colorSpace=T.SRGBColorSpace;grain.wrapS=grain.wrapT=T.RepeatWrapping;grain.repeat.set(1,1);grain.needsUpdate=true;}
 const materials=[new T.MeshStandardMaterial({color:spec.palette.top,roughness:.78,metalness:0,map:grain}),new T.MeshStandardMaterial({color:spec.palette.side,roughness:.86,metalness:0,map:grain})];
 const mesh=new T.Mesh(geo,materials);mesh.name='arched-stone-closed-beveled-body';mesh.castShadow=mesh.receiveShadow=true;mesh.userData.modelId=spec.id;
 const group=new T.Group();group.name=spec.id;group.add(mesh);group.updateMatrixWorld(true);
 const box=new T.Box3().setFromObject(group),bounds={min:box.min.toArray(),max:box.max.toArray(),size:box.getSize(new T.Vector3()).toArray()},resources={geometries:new Set([geo]),materials:new Set(materials),textures:new Set(grain?[grain]:[])};
 const budget={components:1,geometries:1,materials:2,textures:resources.textures.size,triangles:geo.attributes.position.count/3,lights:0};
 let disposed=false;
 function inspect(){let invalidPositions=0,invalidNormals=0,minNormal=Infinity,maxNormal=0;for(let i=0;i<pos.count;i++){if(![pos.getX(i),pos.getY(i),pos.getZ(i)].every(finite))invalidPositions++;const len=new T.Vector3().fromBufferAttribute(n,i).length();if(!finite(len)||Math.abs(len-1)>1e-5)invalidNormals++;minNormal=Math.min(minNormal,len);maxNormal=Math.max(maxNormal,len);}return{dimensions:{...dimensions},bevel:b,bounds,budget,invalidPositions,invalidNormals,minNormal,maxNormal,bodyBinding:null,doorSwing:false,stepTraversal:false,loadFriction:false,normalGamePlacement:false,unlockOrSave:false};}
 return{group,mesh,bounds,budget,resources,dimensions:{...dimensions},inspect,get disposed(){return disposed;},dispose(){if(disposed)return;disposed=true;for(const r of[...resources.geometries,...resources.materials,...resources.textures])r.dispose();group.removeFromParent();group.clear();}};
}
