// One authored fixed panel. Separate closed wood/stone/peg materials overlap at
// finite witnessed joints; open slat channels are not a drainage simulation.
export const spec=Object.freeze({
 id:'winter-coastal-draining-boardwalk-panel-v1',
 unit_id:'village:asset-library:winter-coastal-draining-boardwalk-panel:v1',
 category:'paving_and_tiles',style:'coastal_clear',season:'winter',
 bodyBinding:null,authoredDimensionsNotBodyCalibration:true,static:true,
 drainagePhysics:false,waterTransport:false,walkingNavigation:false,
 loadSlipWeatherStability:false,installation:false,physics:false,rig:false,
 wearingFit:false,normalGame:false,contractorConstruction:false,
 ownershipUnlockSave:false,newOriginalPNG:false
});

const circle=(k,n)=>{
 const q=k*4/n;
 if(Number.isInteger(q))return[[1,0],[0,1],[-1,0],[0,-1]][q%4].slice();
 const t=k/n*Math.PI*2;return[Math.cos(t),Math.sin(t)];
};
function roundedLoop(a,b,r,steps=8){
 const rows=[];
 for(let corner=0;corner<4;corner++){
  const[cx,cz]=[[a-r,b-r],[-a+r,b-r],[-a+r,-b+r],[a-r,-b+r]][corner];
  for(let j=0;j<=steps;j++){
   const t=corner*Math.PI/2+j/steps*Math.PI/2;
   const v=j===0?[[1,0],[0,1],[-1,0],[0,-1]][corner]:j===steps?[[0,1],[-1,0],[0,-1],[1,0]][corner]:[Math.cos(t),Math.sin(t)];
   rows.push([cx+r*v[0],cz+r*v[1]]);
  }
 }
 return rows;
}

function solid(T,positions,indices,role,metadata={}){
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setIndex(indices);
 g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();g.userData={role,...metadata};return g;
}

// Cap shading vertices are deliberately separate from the bevel's. Coplanar
// triangulation therefore cannot turn into a visible fan of tilted normals.
function recessedRoundedSlab(T,{a,b,r,bevel,bottom,top,holes=[],role}){
 const positions=[],indices=[],levels=[bottom,bottom+bevel,top-bevel,top],insets=[bevel,0,0,bevel];
 const loops=levels.map((_,i)=>roundedLoop(a-insets[i],b-insets[i],r-insets[i]));
 const add=(p)=>{const n=positions.length/3;positions.push(...p);return n;};
 const tri=(A,B,C,want)=>{
  const a=new T.Vector3(...positions.slice(A*3,A*3+3)),b=new T.Vector3(...positions.slice(B*3,B*3+3)),c=new T.Vector3(...positions.slice(C*3,C*3+3));
  if(b.sub(a).cross(c.sub(a)).dot(new T.Vector3(...want))<0)[B,C]=[C,B];indices.push(A,B,C);
 };
 const rings=loops.map((loop,j)=>loop.map(([x,z])=>add([x,levels[j],z]))),N=loops[0].length;
 for(let j=0;j<3;j++)for(let k=0;k<N;k++){
  const n=(k+1)%N,dx=loops[j][n][0]-loops[j][k][0],dz=loops[j][n][1]-loops[j][k][1],want=[dz,0,-dx];
  tri(rings[j][k],rings[j][n],rings[j+1][n],want);tri(rings[j][k],rings[j+1][n],rings[j+1][k],want);
 }
 const bottomCap=loops[0].map(([x,z])=>add([x,bottom,z])),bc=add([0,bottom,0]);
 for(let k=0;k<N;k++)tri(bc,bottomCap[k],bottomCap[(k+1)%N],[0,-1,0]);
 const topOutline=loops[3].map(p=>new T.Vector2(...p));
 const holeLoops=holes.map(h=>Array.from({length:h.segments},(_,k)=>{const[x,z]=circle(k,h.segments);return new T.Vector2(h.x+h.radius*x,h.z+h.radius*z);}));
 const topPoints=[...topOutline,...holeLoops.flat()],topIds=topPoints.map(v=>add([v.x,top,v.y]));
 for(const[A,B,C]of T.ShapeUtils.triangulateShape(topOutline,holeLoops))tri(topIds[A],topIds[B],topIds[C],[0,1,0]);
 const recesses=holes.map((h,hi)=>{
  const loop=holeLoops[hi],rim=loop.map(v=>add([v.x,top,v.y])),floor=loop.map(v=>add([v.x,h.floor,v.y]));
  for(let k=0;k<loop.length;k++){
   const n=(k+1)%loop.length,want=[h.x-(loop[k].x+loop[n].x)/2,0,h.z-(loop[k].y+loop[n].y)/2];
   tri(rim[k],rim[n],floor[n],want);tri(rim[k],floor[n],floor[k],want);
  }
  const cap=loop.map(v=>add([v.x,h.floor,v.y])),center=add([h.x,h.floor,h.z]);
  for(let k=0;k<loop.length;k++)tri(center,cap[k],cap[(k+1)%loop.length],[0,1,0]);
  return{centerXZ:[h.x,h.z],radius:h.radius,topY:top,floorY:h.floor,rimVertexIndices:rim,floorVertexIndices:cap};
 });
 return solid(T,positions,indices,role,{recesses,outerSideRings:rings,bottomCapVertexIndices:bottomCap,topCapVertexIndices:topIds,profile:{a,b,r,bevel,bottom,top}});
}

function roundedPeg(T){
 const p=[],ix=[],N=32,rows=[[.332,.036],[.340,.044],[.400,.044],[.408,.036]],rings=[];
 for(const[y,r]of rows){const ring=[];for(let k=0;k<N;k++){const[x,z]=circle(k,N);ring.push(p.length/3);p.push(x*r,y,z*r);}rings.push(ring);}
 for(let j=0;j<3;j++)for(let k=0;k<N;k++){const n=(k+1)%N,A=rings[j][k],B=rings[j][n],C=rings[j+1][n],D=rings[j+1][k];ix.push(A,C,B,A,D,C);}
 for(const[j,up]of[[0,false],[3,true]]){
  const cap=rings[j].map(id=>{const n=p.length/3;p.push(...p.slice(id*3,id*3+3));return n;}),center=p.length/3;p.push(0,rows[j][0],0);
  for(let k=0;k<N;k++){const n=(k+1)%N;ix.push(center,...(up?[cap[n],cap[k]]:[cap[k],cap[n]]));}
 }
 return solid(T,p,ix,'closed-fixed-rounded-recessed-peg',{topY:.408,bottomY:.332});
}

export function build(T){
 const group=new T.Group();group.name=spec.id;
 const parts=[],geometries=new Set(),materials=[],contactWitnesses=[];
 const mat=(name,color,roughness)=>{const m=new T.MeshStandardMaterial({name,color,roughness,metalness:0});materials.push(m);return m;};
 const wood=mat('pale-coastal-rounded-timber','#c8b291',.82),stone=mat('soft-cool-closed-stone-bearers','#aab7bd',.91),pegMaterial=mat('fixed-muted-blue-recessed-wood-pegs','#91aab1',.76);
 const add=(name,g,material,position)=>{geometries.add(g);const part=new T.Mesh(g,material);part.name=name;part.position.fromArray(position);part.castShadow=true;part.receiveShadow=true;group.add(part);parts.push(part);return part;};
 const slatGeometry=recessedRoundedSlab(T,{a:1.4,b:.17,r:.09,bevel:.025,bottom:.20,top:.42,holes:[-.9,.9].map(x=>({x,z:0,radius:.058,floor:.338,segments:32})),role:'closed-rounded-timber-slat-with-two-real-blind-peg-recesses'});
 const bearerGeometry=recessedRoundedSlab(T,{a:.21,b:1.50,r:.10,bevel:.025,bottom:0,top:.23,role:'closed-broad-stone-bearer-with-true-flat-bottom'});
 const pegGeometry=roundedPeg(T),slats=[],pegs=[],bearers=[-1,1].map((s,i)=>add('broad-flat-stone-bearer-'+i,bearerGeometry,stone,[s*.9,0,0])),recessProfiles=[];
 for(let k=0;k<7;k++){
  const z=(k-3)*.415,slat=add('rounded-recessed-timber-slat-'+k,slatGeometry,wood,[0,0,z]);slats.push(slat);
  for(let side=0;side<2;side++){
   const x=[-.9,.9][side],peg=add('fixed-recessed-peg-'+k+'-'+side,pegGeometry,pegMaterial,[x,0,z]);pegs.push(peg);
   contactWitnesses.push({part:slat.name,target:bearers[side].name,point:[x,.215,z],meaning:'Finite strict timber-to-stone overlap; no installed fixing or load proof'});
   contactWitnesses.push({part:peg.name,target:slat.name,point:[x,.335,z],meaning:'Fixed peg overlaps the actual blind-cup floor material'});
   recessProfiles.push({part:slat.name,peg:peg.name,...slatGeometry.userData.recesses[side],centerXZ:[x,z],scope:'Actual named slat/peg and stored local rim/floor vertex indices; per-part matrix gives world positions'});
  }
 }
 const passages=[],restrictions=[],channelSections=[];
 for(let k=0;k<6;k++){
  const z=(slats[k].position.z+slats[k+1].position.z)/2;
  for(const x of[-1.22,0,1.22])passages.push({kind:'selected-all-part-through-channel',channel:k,from:[x,.65,z],to:[x,-.15,z]});
  passages.push({kind:'selected-all-part-along-channel-above-bearers',channel:k,from:[-1.55,.30,z],to:[1.55,.30,z]});
  for(let side=0;side<2;side++)restrictions.push({kind:'intentional-closed-bearer-below-channel',channel:k,part:bearers[side].name,from:[[ -.9,.9][side],.65,z],to:[[-.9,.9][side],-.15,z]});
  channelSections.push({channel:k,leftPart:slats[k].name,rightPart:slats[k+1].name,y:.30,xSamples:[-1.1,-.55,0,.55,1.1],fromZ:slats[k].position.z+.17,toZ:slats[k+1].position.z-.17,minimum:.074,maximum:.076});
 }
 const thicknessSamples=[];
 for(const p of slats)thicknessSamples.push({kind:'actual-solid-slat-wall',part:p.name,from:[0,.55,p.position.z],to:[0,.1,p.position.z],minimum:.219,maximum:.221});
 for(const p of bearers)thicknessSamples.push({kind:'actual-solid-stone-bearer',part:p.name,from:[p.position.x,.4,0],to:[p.position.x,-.1,0],minimum:.229,maximum:.231});
 for(const p of pegs.slice(0,2))thicknessSamples.push({kind:'actual-occupied-fixed-peg',part:p.name,from:[p.position.x-.1,.37,p.position.z],to:[p.position.x+.1,.37,p.position.z],minimum:.087,maximum:.089});
 const supportFaces=bearers.map(p=>({part:p.name,samples:[[p.position.x,0,0],[p.position.x-.07,0,-1.05],[p.position.x+.07,0,-1.05],[p.position.x-.07,0,1.05],[p.position.x+.07,0,1.05]],scope:'Five finite true bearer-bottom samples, not an installed area/load guarantee'}));
 group.updateMatrixWorld(true);
 const slabProfiles=[...slats,...bearers].map(p=>({part:p.name,sections:p.geometry.userData.outerSideRings.map(ids=>({vertices:ids.slice(),y:p.geometry.attributes.position.getY(ids[0])})),scope:'Actual four indexed rounded-rectangle rings; bevel construction, not continuous curvature or load'}));
 const thicknessPairs=[];
 for(const p of[...slats,...bearers])for(const k of[0,9,18,27]){
  const g=p.geometry,innerVertexIndex=g.userData.bottomCapVertexIndices[k],outerVertexIndex=g.userData.topCapVertexIndices[k];
  const outer=new T.Vector3().fromBufferAttribute(g.attributes.position,outerVertexIndex).applyMatrix4(p.matrixWorld),inner=new T.Vector3().fromBufferAttribute(g.attributes.position,innerVertexIndex).applyMatrix4(p.matrixWorld);
  thicknessPairs.push({part:p.name,outerVertexIndex,innerVertexIndex,outer:outer.toArray(),inner:inner.toArray(),distance:outer.distanceTo(inner),scope:'Actual stored world vertex pair; occupied chord checks remain separate'});
 }
 group.updateMatrixWorld(true);const box=new T.Box3().setFromObject(group,true),bounds={min:box.min.toArray(),max:box.max.toArray()};let disposed=false;
 const inspect=()=>({parts:parts.length,triangles:parts.reduce((n,p)=>n+p.geometry.index.count/3,0),actualStoredVertices:parts.reduce((n,p)=>n+p.geometry.attributes.position.count,0),geometryObjects:geometries.size,slats:slats.length,bearers:bearers.length,fixedPegs:pegs.length,strictJoinWitnesses:contactWitnesses.length,selectedAllPartChannelSegments:passages.length,intentionalBearerBlocks:restrictions.length,occupiedChords:thicknessSamples.length,bearerBottomSamples:supportFaces.reduce((n,r)=>n+r.samples.length,0),bodyBinding:null,drainageWalkingLoadSlipInstallationPhysicsGameSaveVerified:false});
 return{group,parts,base:slats[3],shell:slats[3],slats,bearers,pegs,supportFaces,contactWitnesses,passages,restrictions,channelSections,recessProfiles,slabProfiles,thicknessSamples,thicknessPairs,bounds,
  interiorViews:{structure:{eye:[2.15,.55,2.1],target:[0,.18,0],scope:'Partial low oblique bearer-to-slat structure observation; not every underside pixel'},channels:{eye:[.12,1.35,1.52],target:[0,.20,.20],scope:'Partial channel/recess observation; clear selected gaps and intentional bearer blockage remain distinct'}},
  resources:{geometries:[...geometries],materials},inspect,
  dispose(){if(disposed)return;disposed=true;for(const g of geometries)g.dispose();for(const m of materials)m.dispose();}
 };
}
