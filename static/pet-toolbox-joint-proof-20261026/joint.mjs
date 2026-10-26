/* Integral clevis + bored tongue: single joint coupon, not a full toolbox mechanism. */
export const spec=Object.freeze({unit:'wardrobe:other:storybook-sewing-toolbox:standalone-pin-joint:v1',revision:1,sourceSHA:'6afc65a45e78a938b018987a85037a9bbbd4b63905aca1438927ea13d76db070',representation:'closed-mesh-single-joint-coupon',externalTestJig:false,fullToolboxStandaloneMechanism:false,physicalLoadFriction:false,normalPlacement:false,grip:false,allGrowthFit:false,fullBody360:false,unlock:false,save:false});
const DEG=Math.PI/180,PIVOT=.61,MAX=110,SLOPE=.025/.8;
export function validateAngle(n){if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>MAX)throw Error('invalid_manual_angle');return n;}
export function build(T,{document=null,style=null}={}){
 const group=new T.Group();group.name='standalone-clevis-pin-joint-coupon-v1';
 const geometries=[],materials=[],textures=[],parts=[],byId=new Map(),owned=new Set();let dead=false,angle=0;
 function geo(g){if(g.type==='ExtrudeGeometry'){const p=g.attributes.position,ix=g.index?.array||Array.from({length:p.count},(_,i)=>i),keep=[];for(let i=0;i<ix.length;i+=3){const a=new T.Vector3().fromBufferAttribute(p,ix[i]),b=new T.Vector3().fromBufferAttribute(p,ix[i+1]),c=new T.Vector3().fromBufferAttribute(p,ix[i+2]);if(b.sub(a).cross(c.sub(a)).lengthSq()>1e-18)keep.push(ix[i],ix[i+1],ix[i+2]);}g.setIndex(keep);}g.computeBoundingBox();geometries.push(g);return g;}
 let texture=null;if(document&&style?.surfaceTexture){texture=style.surfaceTexture(T,document,'wood');if(texture){textures.push(texture);}}
 function material(name,color,map=null){const m=new T.MeshStandardMaterial({name,color,roughness:.79,metalness:name==='muted-brass'?.38:0,map});materials.push(m);return m;}
 const wood=material('honey-wood',0xb98c58,texture),cream=material('cream-board',0xe5dbc3),sage=material('sage-edge',0x9ba886),lilac=material('lilac-detail',0xbca3c7),brass=material('muted-brass',0xb59a55);
 const box=geo(new T.BoxGeometry(1,1,1)),shaft=geo(new T.CylinderGeometry(.035,.035,.48,48)),cap=geo(new T.CylinderGeometry(.064,.064,.015,48));
 shaft.rotateX(Math.PI/2);cap.rotateX(Math.PI/2);shaft.computeBoundingBox();cap.computeBoundingBox();
 function add(id,g,m,x,y,z,role='fixed',scale=null,rotation=0){const mesh=new T.Mesh(g,m);mesh.name=id;mesh.position.set(x,y,z);if(scale)mesh.scale.set(...scale);mesh.rotation.z=rotation;mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);parts.push({id,mesh,role});byId.set(id,mesh);return mesh;}
 function bx(id,m,x,y,z,w,h,d,role='fixed',rotation=0){return add(id,box,m,x,y,z,role,[w,h,d],rotation);}
 for(const x of[-.70,.80])for(const z of[-.30,.30])bx('foot-'+x+'-'+z,wood,x,.04,z,.13,.08,.13,'support');
 bx('integral-base-board',wood,.05,.13,0,1.8,.10,.80);
 bx('cream-front-inlay',cream,.05,.13,.406,1.55,.055,.012);
 for(const x of[-.45,.05,.55]){bx('lilac-inlay-'+x,lilac,x,.13,.415,.045,.035,.008);}
 function clean(points){const out=[];for(const p of points){const v=new T.Vector2(Math.round(p[0]*1e10)/1e10,Math.round(p[1]*1e10)/1e10);if(!out.length||v.distanceTo(out[out.length-1])>1e-9)out.push(v);}if(out.length>1&&out[0].distanceTo(out[out.length-1])<1e-9)out.pop();return out;}
 function circle(r,steps=48){return Array.from({length:steps},(_,i)=>[r*Math.cos(-2*Math.PI*i/steps),r*Math.sin(-2*Math.PI*i/steps)]);}
 function closedBoredExtrusion(outerPoints,holePoints,depth){const outer=clean(outerPoints),hole=clean(holePoints);if(T.ShapeUtils.isClockWise(outer))outer.reverse();if(!T.ShapeUtils.isClockWise(hole))hole.reverse();const contour=[...outer,...hole],n=contour.length,tri=T.ShapeUtils.triangulateShape(outer,[hole]),pos=[],ix=[];for(const z of[-depth/2,depth/2])for(const p of contour)pos.push(p.x,p.y,z);
 for(const f of tri){let[a,b,c]=f;const p=contour[a],q=contour[b],r=contour[c];if((q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x)<0)[b,c]=[c,b];ix.push(a,c,b,a+n,b+n,c+n);}
 let offset=0;for(const loop of[outer,hole]){for(let i=0;i<loop.length;i++){const a=offset+i,b=offset+(i+1)%loop.length;ix.push(a,b,b+n,a,b+n,a+n);}offset+=loop.length;}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setIndex(ix);g.computeVertexNormals();g.userData={outline:outer.map(v=>v.toArray())};return geo(g);}
 function boredShape(kind,depth){let outer;if(kind==='cheek'){outer=[[-.18,.18-PIVOT],[.18,.18-PIVOT],[.18,0]];for(let i=1;i<=24;i++)outer.push([.18*Math.cos(Math.PI*i/24),.18*Math.sin(Math.PI*i/24)]);}else{outer=[[0,-.115],[.8,-.09]];for(let i=1;i<=24;i++)outer.push([.8+.09*Math.cos(-Math.PI/2+Math.PI*i/24),.09*Math.sin(-Math.PI/2+Math.PI*i/24)]);outer.push([0,.115]);for(let i=1;i<=24;i++)outer.push([.115*Math.cos(Math.PI/2+Math.PI*i/24),.115*Math.sin(Math.PI/2+Math.PI*i/24)]);}
 const r=kind==='cheek'?.044:.041,g=closedBoredExtrusion(outer,circle(r),depth);g.userData.bore={center:[0,0],nominalRadius:r,axis:'z'};return g;}
 const cheek=boredShape('cheek',.09),tongueGeo=boredShape('tongue',.12);
 for(const z of[-.125,.125])add('bored-board-cheek-'+z,cheek,wood,0,PIVOT,z,'bearing-board');
 const tongue=add('bored-rotating-tongue',tongueGeo,wood,0,PIVOT,0,'rotating-tongue');
 add('through-axle',shaft,brass,0,PIVOT,0,'axle');for(const s of[-1,1])add('axle-closed-endcap-'+s,cap,brass,0,PIVOT,s*.2475,'endcap');
 const washer=closedBoredExtrusion(circle(.073).reverse(),circle(.0365),.035);
 for(const s of[-1,1])add('retaining-collar-'+s,washer,brass,0,PIVOT,s*.202,'collar');
 const outer=tongueGeo.userData.outline,stopRecords=[];
 for(const endpoint of[0,MAX]){const a=endpoint*DEG,c=Math.cos(a),s=Math.sin(a),upper=endpoint!==0;
 const localT=new T.Vector2(1,upper?-SLOPE:SLOPE).normalize(),localN=new T.Vector2(-SLOPE,upper?-1:1).normalize();
 const t=new T.Vector2(c*localT.x-s*localT.y,s*localT.x+c*localT.y),n=new T.Vector2(c*localN.x-s*localN.y,s*localN.x+c*localN.y);
 const limit=Math.min(...outer.map(p=>localN.x*p[0]+localN.y*p[1])),centre=t.clone().multiplyScalar(.55).addScaledVector(n,limit-.025);
 const block=bx('integral-travel-stop-'+endpoint,sage,centre.x,PIVOT+centre.y,0,.18,.05,.68,'stop',Math.atan2(t.y,t.x));
 // The board's own two outside cheeks support each stop, outside the rotating tongue's Z interval.
 for(const z of[-.30,.30]){const height=PIVOT+centre.y-.18;bx('stop-support-'+endpoint+'-'+z,wood,centre.x,.18+height/2,z,.075,height,.075,'stop-support');}
 stopRecords.push({endpoint,mesh:block,tangent:t.toArray(),inwardNormal:n.toArray(),planeLimit:limit,centre:[centre.x,PIVOT+centre.y],role:'integral-positive-travel-stop'});
 }
 const restVertices=()=>{const p=tongueGeo.attributes.position,out=[];for(let i=0;i<p.count;i++)out.push(new T.Vector3(p.getX(i),p.getY(i),p.getZ(i)));return out;};
 const sourceVertices=restVertices();
 function state(){return{angleDegrees:angle,rangeDegrees:[0,MAX],manualOnly:true,pivot:[0,PIVOT,0],externalTestJig:false,singleJointOnly:true,physicalLoadFriction:false,collarsHaveAuthoredEndplay:true,clampingOrLoadCertification:false,normalGame:false,save:false};}
 function setAngle(n){if(dead)throw Error('disposed');angle=validateAngle(n);tongue.rotation.z=n*DEG;group.updateMatrixWorld(true);return state();}
 function poseBounds(){group.updateMatrixWorld(true);return new T.Box3().setFromObject(group,true);}
 setAngle(0);
 // Evaluate each actual rigid vertex's trigonometric extrema over authored 0..110 degrees.
 // No unrestricted full-circle lower bound or forced ground clamp is used.
 const fixed=new T.Box3();for(const p of parts)if(p.role!=='rotating-tongue')fixed.union(new T.Box3().setFromObject(p.mesh,true));
 function interval(A,B){const a=[0,MAX*DEG],critical=Math.atan2(B,A);for(let k=-2;k<=2;k++){const theta=critical+k*Math.PI;if(theta>0&&theta<MAX*DEG)a.push(theta);}const values=a.map(x=>A*Math.cos(x)+B*Math.sin(x));return[Math.min(...values),Math.max(...values)];}
 for(const p of sourceVertices){const x=interval(p.x,-p.y),y=interval(p.y,p.x);fixed.expandByPoint(new T.Vector3(x[0],PIVOT+y[0],p.z));fixed.expandByPoint(new T.Vector3(x[1],PIVOT+y[1],p.z));}
 const bounds={min:fixed.min.toArray(),max:fixed.max.toArray(),size:fixed.getSize(new T.Vector3()).toArray(),method:'fixed actual vertices plus analytic rigid vertex trig extrema over authored0..110deg only'};
 const budget={parts:parts.length,triangles:parts.reduce((a,r)=>a+(r.mesh.geometry.index?r.mesh.geometry.index.count:r.mesh.geometry.attributes.position.count)/3,0),geometries:geometries.length,materials:materials.length,textures:textures.length,textureSide:texture?128:0,geometryAllocationsPerPose:0};
 return{group,parts,byId,geometries,materials,textures,budget,spec,stopRecords,sourceVertices,bounds,footprint:{minX:-.85,maxX:.95,minZ:-.4,maxZ:.4,contactPartIds:parts.filter(r=>r.role==='support').map(r=>r.id)},setAngle,getState:state,get poseBounds(){const b=poseBounds();return{min:b.min.toArray(),max:b.max.toArray(),size:b.getSize(new T.Vector3()).toArray()};},dispose(){if(dead)return;dead=true;for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();group.removeFromParent();}};
}
