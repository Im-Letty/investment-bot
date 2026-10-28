/* Authored watering-can geometry from one front original. Hidden surfaces are new prototype design. */
export const spec=Object.freeze({id:'bud-watering-can-hollow-v1',unit:'wardrobe:fit-prerequisite:bud-watering-can:hollow-vessel-spout-grip-geometry:v1',version:1,
 body:{segments:64,thickness:.055,portRows:[3,6],portColumns:[29,35]},rose:{holes:9,holeRadius:.023,thickness:.035},bodyBinding:null,authoredDimensionsNotBodyFit:true,liquidSimulation:false,gripFit:false,normalGameIntegration:false,ownershipUnlockSave:false});
const profiles=[[.08,.31],[.18,.45],[.32,.55],[.47,.60],[.62,.61],[.77,.58],[.91,.54],[1.04,.48],[1.15,.43],[1.22,.44]];
const dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],length=a=>Math.hypot(...a),unit=a=>a.map(v=>v/length(a));
function maker(T){const p=[],tri=[];return{p,tri,v(q){p.push(q);return p.length-1;},t(a,b,c,m){tri.push({a,b,c,m});},
 ring(points){return points.map(q=>this.v(q));},
 stitch(a,b,m){let i=0,j=0;while(i<a.length||j<b.length){const ni=(i+1)/a.length,nj=(j+1)/b.length,A=a[i%a.length],B=b[j%b.length];if(Math.abs(ni-nj)<1e-10){this.t(A,B,b[(j+1)%b.length],m);this.t(A,b[(j+1)%b.length],a[(i+1)%a.length],m);i++;j++;}else if(ni<nj){this.t(A,B,a[(i+1)%a.length],m);i++;}else{this.t(A,B,b[(j+1)%b.length],m);j++;}}},
 disk(r,center,m){const c=this.v(center);for(let i=0;i<r.length;i++)this.t(c,r[i],r[(i+1)%r.length],m);},
 geometry(){// Consistent shared-edge orientation, then global outward orientation. No repair of missing faces.
  const edges=new Map();this.tri.forEach((f,k)=>{for(const[a,b]of[[f.a,f.b],[f.b,f.c],[f.c,f.a]]){const key=Math.min(a,b)+':'+Math.max(a,b),arr=edges.get(key)||[];arr.push({k,sign:a<b?1:-1});edges.set(key,arr);}});
  const adj=this.tri.map(()=>[]);for(const rows of edges.values())if(rows.length===2){const[a,b]=rows;adj[a.k].push([b.k,a.sign===b.sign]);adj[b.k].push([a.k,a.sign===b.sign]);}
  const flips=new Map();for(let start=0;start<this.tri.length;start++)if(!flips.has(start)){flips.set(start,false);const queue=[start];for(let at=0;at<queue.length;at++){const k=queue[at];for(const[j,diff]of adj[k])if(!flips.has(j)){flips.set(j,flips.get(k)!==diff);queue.push(j);}}}
  for(const[k,flip]of flips)if(flip)[this.tri[k].b,this.tri[k].c]=[this.tri[k].c,this.tri[k].b];
  let volume=0;for(const f of this.tri)volume+=dot(p[f.a],cross(p[f.b],p[f.c]))/6;
  if(volume<0)for(const f of this.tri)[f.b,f.c]=[f.c,f.b];
  this.tri.sort((a,b)=>a.m-b.m);
  const used=[...new Set(this.tri.flatMap(f=>[f.a,f.b,f.c]))],map=new Map(used.map((v,i)=>[v,i])),g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(used.flatMap(i=>p[i]),3));g.setIndex(this.tri.flatMap(f=>[map.get(f.a),map.get(f.b),map.get(f.c)]));
  let start=0;while(start<this.tri.length){let end=start+1;while(end<this.tri.length&&this.tri[end].m===this.tri[start].m)end++;g.addGroup(start*3,(end-start)*3,this.tri[start].m);start=end;}g.computeVertexNormals();return g;}};}
function frame(tangent){const t=unit(tangent),reference=Math.abs(t[2])>.95?[1,0,0]:[0,0,1],u=unit(reference.map((x,k)=>x-dot(reference,t)*t[k])),v=unit(cross(t,u));return{t,u,v};}
function circularPoints(center,tangent,radius,n=90,phase=-Math.PI/4){const{u,v}=frame(tangent);return Array.from({length:n},(_,i)=>{const a=phase-2*Math.PI*i/n,r=typeof radius==='function'?radius(a):radius;return center.map((x,k)=>x+r*(u[k]*Math.cos(a)+v[k]*Math.sin(a)));});}
function makeCanShell(T){
 const a=maker(T),outer=[],inner=[],N=64,lo=3,hi=6,jlo=29,jhi=35;
 for(let k=0;k<profiles.length;k++){const[y,r]=profiles[k];outer.push(a.ring(Array.from({length:N},(_,j)=>[r*Math.cos(2*Math.PI*j/N),y,.88*r*Math.sin(2*Math.PI*j/N)])));const ri=r-spec.body.thickness,yi=k===0?y+.06:y;inner.push(a.ring(Array.from({length:N},(_,j)=>[ri*Math.cos(2*Math.PI*j/N),yi,.88*ri*Math.sin(2*Math.PI*j/N)])));}
 let removedCells=0;for(let k=0;k<profiles.length-1;k++)for(let j=0;j<N;j++){if(k>=lo&&k<hi&&j>=jlo&&j<jhi){removedCells++;continue;}const j1=(j+1)%N;for(const[rings,m]of[[outer,0],[inner,1]]){a.t(rings[k][j],rings[k+1][j],rings[k+1][j1],m);a.t(rings[k][j],rings[k+1][j1],rings[k][j1],m);}}
 a.stitch(outer.at(-1),inner.at(-1),0);a.disk(outer[0],[0,.08,0],0);a.disk(inner[0],[0,.14,0],1);
 function boundary(rings){const ids=[];for(let j=jlo;j<=jhi;j++)ids.push(rings[lo][j]);for(let k=lo+1;k<=hi;k++)ids.push(rings[k][jhi]);for(let j=jhi-1;j>=jlo;j--)ids.push(rings[hi][j]);for(let k=hi-1;k>lo;k--)ids.push(rings[k][jlo]);return ids;}
 const portOuter=boundary(outer),portInner=boundary(inner),portOuterPoints=portOuter.map(i=>a.p[i]),portInnerPoints=portInner.map(i=>a.p[i]);
 // First new ring is beyond the actual body wall. Both port boundaries remain uncapped and share exact vertices.
 const centers=[[-.78,.70,0],[-.98,.86,0],[-1.10,1.06,0],[-1.20,1.25,0],[-1.25,1.36,.13]];
 const radii=[.16,.125,.115,.15,.285],inside=[.115,.085,.075,.11,.235];let ro=portOuter,ri=portInner;
 const tangents=centers.map((c,i)=>i===centers.length-1?sub(c,centers[i-1]):sub(centers[i+1],i?centers[i-1]:[-.53,.70,0]));
 for(let k=0;k<centers.length;k++){const radius=k===centers.length-1?(angle=>radii[k]+.022*Math.cos(5*angle)):radii[k],o=a.ring(circularPoints(centers[k],tangents[k],radius)),inn=a.ring(circularPoints(centers[k],tangents[k],inside[k]));a.stitch(ro,o,2);a.stitch(ri,inn,2);ro=o;ri=inn;}
 const end=centers.at(-1),basis=frame(tangents.at(-1)),forward=spec.rose.thickness,faceOuter=a.ring(ro.map(i=>a.p[i].map((v,k)=>v+forward*basis.t[k]))),holeCenters=[[0,0],...Array.from({length:8},(_,i)=>[.145*Math.cos(2*Math.PI*i/8),.145*Math.sin(2*Math.PI*i/8)])];
 const holes=holeCenters.map(([u,v])=>{const back=a.ring(Array.from({length:18},(_,i)=>{const angle=2*Math.PI*i/18;return end.map((x,k)=>x+(u+.023*Math.cos(angle))*basis.u[k]+(v+.023*Math.sin(angle))*basis.v[k]);})),front=a.ring(back.map(i=>a.p[i].map((x,k)=>x+forward*basis.t[k])));a.stitch(back,front,0);return{back,front,center:end.map((x,k)=>x+u*basis.u[k]+v*basis.v[k])};});
 function membrane(contour,holeRings,m){const loops=[contour,...holeRings],ids=loops.flat(),local=loops.map(loop=>loop.map(i=>{const d=sub(a.p[i],end);return new T.Vector2(dot(d,basis.u),dot(d,basis.v));}));for(const t of T.ShapeUtils.triangulateShape(local[0],local.slice(1)))a.t(ids[t[0]],ids[t[1]],ids[t[2]],m);}
 membrane(faceOuter,holes.map(h=>h.front),0);membrane(ri,holes.map(h=>h.back),2);a.stitch(ro,faceOuter,2);
 const geometry=a.geometry();return{geometry,metadata:{removedBodyCellsEachWall:removedCells,bodyPortBoundaryVertices:portOuter.length,portOuterPoints,portInnerPoints,spoutCenters:centers,spoutInnerRadii:inside,roseHoleCenters:holes.map(h=>h.center),roseAxis:basis.t,roseThickness:forward,roseHoleRadius:.023,bodyPortOpen:true,roseTrueThroughHoles:9},portInnerPoints};
}
function solidTube(T,points,radius){const path=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),a=maker(T),rings=[];for(let i=0;i<=48;i++)rings.push(a.ring(circularPoints(path.getPointAt(i/48).toArray(),path.getTangentAt(i/48).toArray(),radius,20,0)));for(let i=0;i<48;i++)a.stitch(rings[i],rings[i+1],0);a.disk(rings[0],path.getPointAt(0).toArray(),0);a.disk(rings.at(-1),path.getPointAt(1).toArray(),0);return a.geometry();}
export function build(T){
 const group=new T.Group();group.name=spec.id;const materials=[new T.MeshStandardMaterial({color:'#f5e7cf',roughness:.34,metalness:.04}),new T.MeshStandardMaterial({color:'#e8b9b4',roughness:.46}),new T.MeshStandardMaterial({color:'#afd7bd',roughness:.32,metalness:.05})],gold=new T.MeshStandardMaterial({color:'#d6aa5b',roughness:.36,metalness:.38}),resources={geometries:new Set(),materials:new Set([...materials,gold])},parts=[];
 const add=(id,g,m,position)=>{resources.geometries.add(g);const mesh=new T.Mesh(g,m);mesh.name=id;if(position)mesh.position.set(...position);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);parts.push({id,mesh});return mesh;};
 const shell=makeCanShell(T),body=add('continuous-hollow-body-spout-perforated-rose',shell.geometry,materials),handle=add('solid-loop-handle',solidTube(T,[[.46,.44,0],[.89,.44,0],[1.10,.76,0],[1.09,1.23,0],[.89,1.45,0],[.46,1.08,0]],.087),materials[2]);
 const base=add('mint-ground-ring',new T.CylinderGeometry(.37,.39,.08,64),materials[2],[0,.04,0]);base.userData.footprintRadius=.39;
 const rim=add('rolled-open-top-rim',new T.TorusGeometry(.444,.036,12,64),materials[0],[0,1.22,0]);rim.rotation.x=Math.PI/2;rim.scale.y=.88;
 const seam=add('gold-rim-seam',new T.TorusGeometry(.443,.011,8,64),gold,[0,1.18,0]);seam.rotation.x=Math.PI/2;seam.scale.y=.88;
 const lower=add('gold-bottom-seam',new T.TorusGeometry(.335,.012,8,64),gold,[0,.087,0]);lower.rotation.x=Math.PI/2;lower.scale.y=.88;
 // Small front emblem; no hidden original detail is inferred.
 const emblem=new T.Group();emblem.position.set(.10,.63,.523);emblem.rotation.x=.15;group.add(emblem);
 function petal(id,x,y,sx,sy,material){const g=new T.SphereGeometry(1,16,12),m=add(id,g,material);group.remove(m);emblem.add(m);m.position.set(x,y,0);m.scale.set(sx,sy,.025);return m;}
 petal('blush-bud',.02,.16,.065,.12,materials[1]);petal('mint-leaf-left',-.11,-.04,.11,.05,materials[2]).rotation.z=-.55;petal('mint-leaf-right',.10,-.10,.11,.05,materials[2]).rotation.z=.55;
 const stem=add('fine-gold-bud-stem',solidTube(T,[[.10,.34,.545],[.13,.49,.549],[.12,.67,.55]],.009),gold);
 group.updateMatrixWorld(true);const b=new T.Box3().setFromObject(group,true),bounds={min:b.min.toArray(),max:b.max.toArray(),size:b.getSize(new T.Vector3()).toArray()},budget={meshes:parts.length,geometries:resources.geometries.size,materials:resources.materials.size,textures:0,triangles:parts.reduce((n,p)=>n+(p.mesh.geometry.index?.count||p.mesh.geometry.attributes.position.count)/3,0)};
 let disposed=false;return{group,parts,body,handle,feet:[base],spec,bounds,budget,metadata:shell.metadata,resources,inspect(){return{bounds,budget,...shell.metadata,bodyBinding:null,authoredHiddenSurfaces:true,gripFit:false,liquidSimulation:false};},get disposed(){return disposed;},dispose(){if(disposed)return;disposed=true;for(const g of resources.geometries)g.dispose();for(const m of resources.materials)m.dispose();group.clear();}};
}
export function topology(geometry){const ix=geometry.index,edges=new Map(),p=geometry.attributes.position;let invalid=0,degenerate=0,volume=0;for(const x of p.array)if(!Number.isFinite(x))invalid++;
 for(let k=0;k<ix.count;k+=3){const ids=[ix.getX(k),ix.getX(k+1),ix.getX(k+2)],v=ids.map(i=>[p.getX(i),p.getY(i),p.getZ(i)]);if(length(cross(sub(v[1],v[0]),sub(v[2],v[0])))<1e-10)degenerate++;volume+=dot(v[0],cross(v[1],v[2]))/6;for(let i=0;i<3;i++){const a=ids[i],b=ids[(i+1)%3],key=Math.min(a,b)+':'+Math.max(a,b),r=edges.get(key)||[];r.push(a<b?1:-1);edges.set(key,r);}}
 return{vertices:p.count,triangles:ix.count/3,edges:edges.size,boundaryEdges:[...edges.values()].filter(v=>v.length===1).length,nonmanifoldEdges:[...edges.values()].filter(v=>v.length!==2).length,inconsistentEdges:[...edges.values()].filter(v=>v.length===2&&v[0]===v[1]).length,invalidPositions:invalid,degenerateTriangles:degenerate,signedVolume:volume};}
function hits(T,item,start,end){item.group.updateMatrixWorld(true);const a=item.group.localToWorld(new T.Vector3(...start)),b=item.group.localToWorld(new T.Vector3(...end)),d=b.clone().sub(a),ray=new T.Raycaster(a,d.clone().normalize(),1e-5,d.length()-1e-5);return ray.intersectObjects(item.parts.map(p=>p.mesh),false).map(r=>({part:r.object.name,distance:r.distance}));}
export function inspectOpenings(T,item){const m=item.metadata,rows=[],push=(name,a,b)=>rows.push({name,start:a,end:b,hits:hits(T,item,a,b)});push('open-top-center',[0,1.5,0],[0,.3,0]);push('body-to-spout-port',[0,.70,0],[-.77,.70,0]);
 const centers=[[-.77,.70,0],...m.spoutCenters.slice(1)];for(let i=0;i<centers.length-1;i++)push('spout-center-'+i,centers[i],centers[i+1]);
 for(let i=0;i<m.roseHoleCenters.length;i++){const c=m.roseHoleCenters[i],t=m.roseAxis;push('rose-through-hole-'+i,c.map((v,k)=>v-.045*t[k]),c.map((v,k)=>v+.085*t[k]));}
 push('handle-aperture',[.84,.90,-.35],[.84,.90,.35]);const controls=[{name:'rose-solid-between-holes',a:m.roseHoleCenters[0].map((v,k)=>v+.06*frame(m.roseAxis).u[k]-.05*m.roseAxis[k]),b:m.roseHoleCenters[0].map((v,k)=>v+.06*frame(m.roseAxis).u[k]+.09*m.roseAxis[k])},{name:'body-wall',a:[0,.70,.20],b:[0,.70,.90]},{name:'body-floor',a:[0,.4,0],b:[0,-.1,0]}].map(r=>({name:r.name,start:r.a,end:r.b,hits:hits(T,item,r.a,r.b)}));
 return{finiteClearRays:rows.length,blockedClearRays:rows.filter(r=>r.hits.length).length,rows,occupiedControls:controls,bodyBinding:null,liquidFlowVerified:false,continuousClearanceGuaranteed:false,scope:'finite centerline/port/pore/aperture witnesses on authored geometry only; no fluid connectivity simulation or body grip'};}
