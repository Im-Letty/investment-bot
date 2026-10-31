import {strictContainment} from '../pet-breeze-cape-proof-20261029/geometry-audit.mjs';

export const spec=Object.freeze({
  id:'autumn-market-espalier-pear-tree-v1',
  unit_id:'village:asset-library:autumn-market-espalier-pear-tree:v1',
  category:'trees_and_landscape',style:'atelier_market',season:'autumn',
  bodyBinding:null,authoredDimensionsNotBodyCalibration:true,
  static:true,horticulturalTraining:false,pruning:false,growth:false,
  fruitCollection:false,edibility:false,loadWeatherStability:false,
  physics:false,rig:false,wearingFit:false,normalGame:false,
  contractorConstruction:false,ownershipUnlockSave:false,newOriginalPNG:false
});

function geometry(T,positions,indices,role){
  let volume=0;
  for(let k=0;k<indices.length;k+=3){
    const a=new T.Vector3(...positions.slice(indices[k]*3,indices[k]*3+3));
    const b=new T.Vector3(...positions.slice(indices[k+1]*3,indices[k+1]*3+3));
    const c=new T.Vector3(...positions.slice(indices[k+2]*3,indices[k+2]*3+3));
    volume+=a.dot(b.cross(c))/6;
  }
  if(volume<0)for(let k=0;k<indices.length;k+=3)[indices[k+1],indices[k+2]]=[indices[k+2],indices[k+1]];
  const g=new T.BufferGeometry();
  g.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  g.setIndex(indices);g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();
  g.userData.role=role;
  return g;
}

function roundedLoop(a,b,r,steps=6){
  const p=[];
  for(const[cx,cy,start]of[[a-r,b-r,0],[-a+r,b-r,Math.PI/2],[-a+r,-b+r,Math.PI],[a-r,-b+r,Math.PI*1.5]])
    for(let j=0;j<=steps;j++){const t=start+j/steps*Math.PI/2;p.push([cx+r*Math.cos(t),cy+r*Math.sin(t)]);}
  return p;
}

// Cap rings are separate shading vertices. Topology audits weld coordinates,
// while flat-cap normals remain parallel instead of forming fan-shaped shading.
function flatRoundedPad(T,a,b,halfHeight,r=.12,bevel=.018){
  const loops=[roundedLoop(a-bevel,b-bevel,r-bevel),roundedLoop(a,b,r),roundedLoop(a,b,r),roundedLoop(a-bevel,b-bevel,r-bevel)];
  const levels=[-halfHeight,-halfHeight+bevel,halfHeight-bevel,halfHeight],N=loops[0].length,p=[],ix=[];
  for(let j=0;j<4;j++)for(const[x,y]of loops[j])p.push(x,y,levels[j]);
  for(let j=0;j<3;j++)for(let k=0;k<N;k++){
    const n=(k+1)%N,A=j*N+k,B=j*N+n,C=(j+1)*N+n,D=(j+1)*N+k;
    ix.push(A,B,C,A,C,D);
  }
  for(const[row,flip]of[[0,true],[3,false]]){
    const start=p.length/3;
    for(let k=0;k<N;k++)p.push(...p.slice((row*N+k)*3,(row*N+k)*3+3));
    const center=p.length/3;p.push(0,0,levels[row]);
    for(let k=0;k<N;k++){const n=(k+1)%N;ix.push(center,...(flip?[start+n,start+k]:[start+k,start+n]));}
  }
  const g=geometry(T,p,ix,'closed-rounded-flat-bottom-root-material');
  g.rotateX(-Math.PI/2);g.computeBoundingBox();
  return g;
}

function curvedWood(T,points,r0,r1,sides=12,steps=24){
  const curve=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p)),false,'centripetal');
  const p=[],ix=[],sections=[];
  for(let j=0;j<=steps;j++){
    const t=j/steps,c=curve.getPoint(t),tangent=curve.getTangent(t).normalize();
    const u=new T.Vector3().crossVectors(tangent,new T.Vector3(0,0,1)).normalize();
    const v=new T.Vector3().crossVectors(tangent,u).normalize(),radius=r0+(r1-r0)*t,ids=[];
    for(let k=0;k<sides;k++){
      const a=k/sides*Math.PI*2,q=c.clone().addScaledVector(u,radius*Math.cos(a)).addScaledVector(v,radius*Math.sin(a));
      ids.push(p.length/3);p.push(...q.toArray());
    }
    sections.push({center:c.toArray(),radius,vertices:ids});
  }
  for(let j=0;j<steps;j++)for(let k=0;k<sides;k++){
    const n=(k+1)%sides,A=j*sides+k,B=j*sides+n,C=(j+1)*sides+n,D=(j+1)*sides+k;
    ix.push(A,B,C,A,C,D);
  }
  for(const[row,flip]of[[0,true],[steps,false]]){
    const start=p.length/3;
    for(let k=0;k<sides;k++)p.push(...p.slice((row*sides+k)*3,(row*sides+k)*3+3));
    const center=p.length/3;p.push(...sections[row].center);
    for(let k=0;k<sides;k++){const n=(k+1)%sides;ix.push(center,...(flip?[start+n,start+k]:[start+k,start+n]));}
  }
  return{geometry:geometry(T,p,ix,'closed-tapered-curved-training-or-botanical-wood'),curve,sections};
}

function paddedLeaf(T){
  const p=[0,0,-.5],ix=[],rings=[],N=16,L=10;
  for(let j=1;j<L;j++){
    const t=j/L,z=t-.5,r=Math.sin(Math.PI*t)**.85,row=[];
    for(let k=0;k<N;k++){
      const a=k/N*Math.PI*2;row.push(p.length/3);
      p.push(.27*r*Math.cos(a),.075*r*Math.sin(a)+.045*(1-z*z*4),z);
    }
    rings.push(row);
  }
  const top=p.length/3;p.push(0,0,.5);
  for(let k=0;k<N;k++){
    const n=(k+1)%N;ix.push(0,rings[0][n],rings[0][k]);
    for(let j=0;j<rings.length-1;j++)ix.push(rings[j][k],rings[j][n],rings[j+1][n],rings[j][k],rings[j+1][n],rings[j+1][k]);
    ix.push(top,rings.at(-1)[k],rings.at(-1)[n]);
  }
  return geometry(T,p,ix,'closed-padded-leaf-not-raster-card');
}

function pearGeometry(T){
  const p=[0,-.16,0],ix=[],rings=[],sections=[],N=28,L=28;
  for(let j=1;j<L;j++){
    const t=j/L,y=-.16+.32*t,r=.155*Math.sin(Math.PI*t)**.72*(1-.55*t),row=[];
    for(let k=0;k<N;k++){const a=k/N*Math.PI*2;row.push(p.length/3);p.push(r*Math.cos(a),y,r*Math.sin(a));}
    rings.push(row);sections.push({y,radius:r,vertices:row});
  }
  const top=p.length/3;p.push(0,.16,0);
  for(let k=0;k<N;k++){
    const n=(k+1)%N;ix.push(0,rings[0][k],rings[0][n]);
    for(let j=0;j<rings.length-1;j++)ix.push(rings[j][k],rings[j+1][k],rings[j+1][n],rings[j][k],rings[j+1][n],rings[j][n]);
    ix.push(top,rings.at(-1)[n],rings.at(-1)[k]);
  }
  const g=geometry(T,p,ix,'closed-asymmetric-lower-bulb-upper-neck-pear');g.userData.pearSections=sections;
  return g;
}

export function build(T){
  const group=new T.Group();group.name=spec.id;
  const parts=[],owned=new Set(),materials=[],contacts=[],curvedProfiles=[];
  const material=(name,color,roughness=.8)=>{const m=new T.MeshStandardMaterial({name,color,roughness,metalness:0});materials.push(m);return m;};
  const wood=material('soft-honey-training-wood','#c3a076'),bark=material('rounded-warm-pear-bark','#a78560');
  const rootMaterial=material('broad-root-material-with-muted-moss','#a89b78'),sage=material('padded-sage-leaves','#a6b77f',.72),olive=material('padded-olive-leaves','#8c9f69',.74);
  const gold=material('warm-autumn-gold-pears','#d6bf7b',.6),cream=material('cream-yellow-pears','#e0ce95',.62);
  const add=(name,g,mat,pos=[0,0,0])=>{owned.add(g);const m=new T.Mesh(g,mat);m.name=name;m.position.fromArray(pos);m.castShadow=true;m.receiveShadow=true;group.add(m);parts.push(m);return m;};
  const join=(part,target,seed,meaning)=>{
    group.updateMatrixWorld(true);
    const candidates=[seed];
    for(const r of[.003,.008,.016,.026])for(const a of[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],[1,1,1],[-1,1,1],[1,-1,1],[1,1,-1],[-1,-1,-1]])
      candidates.push(new T.Vector3(...seed).addScaledVector(new T.Vector3(...a).normalize(),r).toArray());
    let found=null;
    for(const point of candidates){const a=strictContainment(T,part,point),b=strictContainment(T,target,point);if(a.inside&&b.inside&&Math.min(a.minimumSurfaceClearance,b.minimumSurfaceClearance)>1e-6){found={point,clearance:Math.min(a.minimumSurfaceClearance,b.minimumSurfaceClearance)};break;}}
    contacts.push({part:part.name,target:target.name,point:found?.point||seed,producerFound:!!found,producerClearance:found?.clearance??null,meaning,scope:'One finite strict common-material witness; not a fastening/load/horticultural guarantee'});
  };
  const padG=flatRoundedPad(T,.38,.40,.07),rootPads=[
    add('broad-flat-left-root-pad',padG,rootMaterial,[-.62,.07,.10]),
    add('broad-flat-right-root-pad',padG,rootMaterial,[.62,.07,.10]),
    add('broad-flat-rear-root-pad',padG,rootMaterial,[0,.07,-.38])
  ];
  const base=add('low-rounded-connected-root-collar',flatRoundedPad(T,.9,.24,.11,.13),bark,[0,.15,-.05]);
  for(const p of rootPads)join(p,base,[p.position.x,.10,p.position.z===-.38?-.15:.04],'actual broad root-pad to low collar overlap');
  const tube=(name,points,r0,r1,mat,sides=12,steps=24)=>{
    const q=curvedWood(T,points,r0,r1,sides,steps),mesh=add(name,q.geometry,mat);
    curvedProfiles.push({part:name,sections:q.sections});return{...q,mesh};
  };
  const trunkData=tube('gently-curved-tapered-pear-trunk',[[0,.16,.07],[-.055,.56,.07],[.025,1.02,.07],[0,1.49,.07]],.125,.052,bark,16,30),trunk=trunkData.mesh;
  join(trunk,base,[0,.205,.07],'trunk rooted inside connected low collar');
  const ribs=[
    [[-.30,.23,-.15],[-.56,.70,-.15],[-.85,1.20,-.15],[-1.03,1.58,-.15]],
    [[-.10,.23,-.15],[-.17,.80,-.15],[-.30,1.40,-.15],[-.43,1.86,-.15]],
    [[.10,.23,-.15],[.17,.80,-.15],[.30,1.40,-.15],[.43,1.86,-.15]],
    [[.30,.23,-.15],[.56,.70,-.15],[.85,1.20,-.15],[1.03,1.58,-.15]]
  ].map((points,k)=>tube('rounded-fan-training-rib-'+k,points,.062,.052,wood,12,30));
  for(const q of ribs)join(q.mesh,base,q.curve.getPoint(.018).toArray(),'training rib ends inside low wooden base');
  const rails=[];
  for(const[t,name]of[[.56,'middle'],[1,'upper']]){
    const pts=ribs.map(q=>q.curve.getPoint(t).toArray()),q=tube('rounded-'+name+'-fan-backrail',pts,.052,.052,wood,12,48);rails.push(q.mesh);
    ribs.forEach((rib,k)=>join(q.mesh,rib.mesh,pts[k],'curved backrail to actual fan rib material'));
  }
  const rodGeometry=new T.CylinderGeometry(1,1,1,12,1,false);
  const rod=(name,a,b,r,mat=bark)=>{
    const from=new T.Vector3(...a),to=new T.Vector3(...b),delta=to.clone().sub(from),m=add(name,rodGeometry,mat,from.clone().add(to).multiplyScalar(.5).toArray());
    m.scale.set(r,delta.length(),r);m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize());return m;
  };
  const branches=[],ties=[],leaves=[],petioles=[],pears=[],pearStems=[],leafG=paddedLeaf(T),pearG=pearGeometry(T);
  const stations=[[0,.40,.26],[3,.40,.26],[0,.76,.50],[3,.76,.50],[1,.78,.69],[2,.78,.69]];
  for(let i=0;i<stations.length;i++){
    const[ri,t,tt]=stations[i],station=ribs[ri].curve.getPoint(t),sign=station.x<0?-1:1,start=trunkData.curve.getPoint(tt),front=[station.x,station.y,.07],end=[station.x+sign*.13,station.y+.035,.08],mid=start.clone().lerp(new T.Vector3(...front),.50);mid.y+=.045;
    const branch=tube('trained-lateral-branch-'+i,[start.toArray(),mid.toArray(),front,end],.060,.027,bark,12,30);branches.push(branch.mesh);
    join(branch.mesh,trunk,start.clone().add(branch.curve.getTangent(0).multiplyScalar(.018)).toArray(),'botanical branch inside actual trunk');
    const tie=rod('fixed-rounded-training-spacer-'+i,[station.x,station.y,-.19],[station.x,station.y,.11],.025,wood);ties.push(tie);
    join(tie,ribs[ri].mesh,station.toArray(),'fixed spacer overlaps real back rib');join(tie,branch.mesh,front,'fixed spacer overlaps real trained branch');
    for(let j=0;j<3;j++){
      const at=branch.curve.getPoint([.45,.74,.94][j]),dir=new T.Vector3(sign*(j===1?.45:.75),.55+j*.08,j===1?-.12:.12).normalize(),length=.32+j*.025;
      const pet=rod('leaf-petiole-'+i+'-'+j,at.toArray(),at.clone().addScaledVector(dir,.095).toArray(),.010);petioles.push(pet);
      join(pet,branch.mesh,at.clone().addScaledVector(dir,.018).toArray(),'petiole inside branch material');
      const center=at.clone().addScaledVector(dir,.057+length*.5),leaf=add('closed-padded-leaf-'+i+'-'+j,leafG,(i+j)%2?sage:olive,center.toArray());leaf.scale.setScalar(length);leaf.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),dir);leaves.push(leaf);
      join(leaf,pet,at.clone().addScaledVector(dir,.083).toArray(),'padded leaf base joined to its real petiole');
    }
    const attachment=branch.curve.getPoint(.91),center=new T.Vector3(attachment.x+sign*.012,attachment.y-.225,.105),stem=rod('fixed-pear-stem-'+i,attachment.clone().add(new T.Vector3(0,.008,0)).toArray(),center.clone().add(new T.Vector3(0,.105,0)).toArray(),.012);pearStems.push(stem);
    join(stem,branch.mesh,attachment.clone().add(new T.Vector3(0,-.012,0)).toArray(),'fixed pear stem joined to actual branch');
    const pear=add('small-lower-bulb-upper-neck-pear-'+i,pearG,i%2?cream:gold,center.toArray());pears.push(pear);
    join(pear,stem,center.clone().add(new T.Vector3(0,.125,0)).toArray(),'actual pear neck material joined to fixed stem');
  }
  group.updateMatrixWorld(true);
  const supportFaces=rootPads.map(p=>({part:p.name,scope:'Five finite samples on this actual broad flat root-pad bottom, not a physical stability/contact-area proof',samples:[[p.position.x,0,p.position.z],[p.position.x-.12,0,p.position.z],[p.position.x+.12,0,p.position.z],[p.position.x,0,p.position.z-.12],[p.position.x,0,p.position.z+.12]]}));
  const passages=[];
  for(const[x,y]of[[-.70,1.32],[.70,1.32],[-.20,1.70],[.20,1.70]])passages.push({scope:'wood_frame_only',from:[x,y,.45],to:[x,y,-.45]});
  const thicknessSamples=[];
  for(const p of rootPads)thicknessSamples.push({part:p.name,kind:'actual_root_pad_vertical_material',from:[p.position.x,.4,p.position.z],to:[p.position.x,-.2,p.position.z],minimum:.139,maximum:.141});
  for(const q of[ribs[0],ribs[3],trunkData]){const c=q.curve.getPoint(.50);thicknessSamples.push({part:q.mesh.name,kind:'actual_closed_wood_front_back_material',from:[c.x,c.y,.5],to:[c.x,c.y,-.5],minimum:.08,maximum:.25});}
  for(const p of[pears[0],pears[1]])thicknessSamples.push({part:p.name,kind:'actual_pear_lower_bulb_material',from:[p.position.x,p.position.y-.04,.5],to:[p.position.x,p.position.y-.04,-.5],minimum:.18,maximum:.28});
  const box=new T.Box3().setFromObject(group,true),bounds={min:box.min.toArray(),max:box.max.toArray()};
  const fruitTarget=pears[0].position.clone().add(new T.Vector3(0,.06,0));
  const interiorViews={structure:{eye:[1.15,1.10,1.50],target:[.10,1.15,-.08],scope:'Partial oblique observation of trained branches, spacers and rear fan; not every surface/pixel'},fruit:{eye:fruitTarget.clone().add(new T.Vector3(-.30,.16,.65)).toArray(),target:fruitTarget.toArray(),scope:'Partial fixed pear/stem/nearby padded leaf observation; not growth/harvest or every surface'}};
  let disposed=false;
  const resources={geometries:[...owned],materials};
  function inspect(){if(disposed)throw Error('pear_tree_disposed');return{spec,closedParts:parts.length,triangles:parts.reduce((n,p)=>n+p.geometry.index.count/3,0),geometryObjectCount:owned.size,materialCount:materials.length,rootPads:rootPads.length,trainingRibs:ribs.length,backrails:rails.length,trainedBranches:branches.length,paddedLeaves:leaves.length,fixedPears:pears.length,fixedPearStems:pearStems.length,textures:0,bounds,bodyBinding:null,static:true,horticulturalTraining:false,growth:false,fruitCollection:false,loadWeatherStability:false,physics:false,rig:false,normalGame:false,ownershipUnlockSave:false};}
  return{group,parts,base,root:base,feet:rootPads,rootPads,trunk,trainingRibs:ribs.map(q=>q.mesh),backrails:rails,branches,trainingSpacers:ties,leaves,petioles,pears,pearStems,woodParts:[base,trunk,...ribs.map(q=>q.mesh),...rails,...branches,...ties],contactWitnesses:contacts,passages,thicknessSamples,curvedProfiles,pearSections:pearG.userData.pearSections,supportFaces,bounds,interiorViews,resources,inspect,get disposed(){return disposed;},dispose(){if(disposed)return false;disposed=true;for(const g of owned)g.dispose();for(const m of materials)m.dispose();group.clear();return true;}};
}
