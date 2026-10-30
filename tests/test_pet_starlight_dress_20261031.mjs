import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import * as T from '../static/vendor/three-0.160.1.module.js';
import {build,spec} from '../static/pet-starlight-dress-volume-proof-20261031/dress.mjs';
import {finiteAudit,weldedComplex,tubeProfile,dressChartAudit,triangleBufferValidity,layerSeparationAudit,planeTriangleWallHits} from '../static/pet-starlight-dress-volume-proof-20261031/audit.mjs';
import {inspectTopology,inspectFaceNormalAgreement} from '../static/pet-breeze-cape-proof-20261029/geometry-audit.mjs';
import {independentPointAudit,independentSegmentAudit} from '../static/pet-breeze-cape-proof-20261029/audit.mjs';
import {fitView} from '../static/pet-scalloped-path-proof-20261027/framing.mjs';
import {startPreview,failureDetails} from '../static/pet-starlight-dress-volume-proof-20261031/entry.mjs';

const root=new URL('../',import.meta.url),dir=new URL('static/pet-starlight-dress-volume-proof-20261031/',root);
const read=n=>readFileSync(new URL(n,dir)),hash=b=>createHash('sha256').update(b).digest('hex');
const model=build(T),inspection=model.inspect(),audit=finiteAudit(T,model);
function vertices(){model.group.updateMatrixWorld(true);return model.parts.flatMap(m=>Array.from({length:m.geometry.attributes.position.count},(_,i)=>new T.Vector3().fromBufferAttribute(m.geometry.attributes.position,i).applyMatrix4(m.matrixWorld)));}
function cameraFor(bounds,view,aspect){const fitted=fitView(T,bounds,view,aspect),camera=new T.PerspectiveCamera(46,aspect,.005,40),target=new T.Vector3(...fitted.targetLocal),yaw=view.yaw*Math.PI/180,pitch=view.pitch*Math.PI/180;camera.position.copy(target).addScaledVector(new T.Vector3(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)),fitted.actualDistance);camera.lookAt(target);camera.rotateZ(view.roll*Math.PI/180);camera.updateMatrixWorld(true);return{camera,fitted};}

test('the saved original and final artifact, generator, test and dependency bytes are bound without changing source quality or body gates',()=>{
 const manifest=JSON.parse(read('input-manifest.json')),png=read('reference.png');
 assert.equal(hash(png),spec.sourceSHA);assert.equal(manifest.source_original.sha256,spec.sourceSHA);
 assert.equal(png.readUInt32BE(16),1254);assert.equal(png.readUInt32BE(20),1254);assert.equal(png[25],6);
 for(const[name,ref]of Object.entries(manifest.artifacts)){assert.equal(hash(read(name)),ref.sha256,name);assert.equal(read(name).length,ref.bytes,name);}
 for(const group of[manifest.source_files,manifest.unchanged_dependencies])for(const[name,ref]of Object.entries(group)){const bytes=readFileSync(new URL(name,root));assert.equal(hash(bytes),ref.sha256,name);assert.equal(bytes.length,ref.bytes,name);}
 assert.equal(manifest.bodyBinding,null);assert.equal(manifest.source_raw_quality_pending,true);
 for(const name of['new_designs','raw_png_designs','imagegen_calls','body_calibrations','fit_confirmations','village_library_additions','paid_calls'])assert.equal(manifest[name],0,name);
 assert(!/\/Users\//.test(read('SPEC.json').toString()));assert(!/\/Users\//.test(read('input-manifest.json').toString()));
});

test('the connected doubled main material has four true garment boundaries and a closed orientable genus-three triangle complex',()=>{
 const complex=weldedComplex(model.shell.geometry);assert.equal(complex.components,1);assert.equal(complex.eulerCharacteristic,-4);
 assert.deepEqual(Object.keys(model.garmentRims).sort(),['hem','left_cuff','neck','right_cuff']);assert.equal(model.construction.shellBoundaryLoops,4);
 assert.equal(audit.shellWeldedTopology.components,1);assert.equal(audit.shellWeldedTopology.eulerCharacteristic,-4);
});

test('every actual rendered part is a positive closed solid; missing faces and reversed winding are rejected by the same checks',()=>{
 assert.equal(audit.topology.length,model.parts.length);assert(model.parts.length>10);
 for(const part of audit.topology){assert(part.triangleBuffers.pass,part.name);assert(part.triangleBuffers.allPositionValuesFinite,part.name);assert(part.triangleBuffers.allIndicesIntegerAndInRange,part.name);assert(part.closedEdges,part.name);assert.equal(part.badEdges,0,part.name);assert.equal(part.degenerateTriangles,0,part.name);assert.equal(part.invalidNormals,0,part.name);assert(part.signedVolume>0,part.name);assert.equal(part.faceNormals.nonpositiveFaces,0,part.name);assert(part.positiveFiniteTransform,part.name);}
 const open=new T.BoxGeometry(1,1,1);open.setIndex(Array.from(open.index.array).slice(3));assert.equal(inspectTopology(T,open).closedEdges,false);open.dispose();
 const reverse=new T.BoxGeometry(1,1,1),idx=Array.from(reverse.index.array);for(let j=0;j<idx.length;j+=3)[idx[j+1],idx[j+2]]=[idx[j+2],idx[j+1]];reverse.setIndex(idx);assert(inspectTopology(T,reverse).signedVolume<0);assert(inspectFaceNormalAgreement(T,reverse).nonpositiveFaces>0);reverse.dispose();
 const invalid=new T.BoxGeometry(1,1,1),positions=new Float32Array(invalid.attributes.position.array.length+3);positions.set(invalid.attributes.position.array);positions[positions.length-3]=NaN;invalid.setAttribute('position',new T.BufferAttribute(positions,3));const indices=Float32Array.from(invalid.index.array);indices[0]=1.5;invalid.setIndex(new T.BufferAttribute(indices,1));const rejected=triangleBufferValidity(invalid);assert.equal(rejected.allPositionValuesFinite,false,'even an unreferenced NaN vertex is rejected');assert.equal(rejected.allIndicesIntegerAndInRange,false);assert.equal(rejected.pass,false);invalid.dispose();
});

test('each current geometry object has no sampled strict nonadjacent edge/interior crossing',()=>{
 assert.equal(audit.crossings.length,new Set(model.parts.map(m=>m.geometry)).size);
 for(const result of audit.crossings)assert.equal(result.strictEdgeInteriorCrossings,0,result.name);
});

test('all named rims bind actual rendered shell boundary vertices without anatomical sockets',()=>{
 for(const[name,rim]of Object.entries(model.garmentRims)){
  assert(rim.boundaryOuterVertexIndices.length>=16,name);assert(rim.boundaryOuterVertexIndices.includes(rim.actualVertex),name);
  assert.deepEqual(new T.Vector3().fromBufferAttribute(model.shell.geometry.attributes.position,rim.actualVertex).toArray(),rim.actualSurfacePosition);
  assert.equal(rim.bodyBinding,null);assert.equal(rim.anatomicalSocket,false);assert.equal(model.resolveRim(name),rim);
 }
});

test('independent neck, hem and cuff-to-torso routes cross all visible parts and a deliberately inserted cap is detected',()=>{
 assert(audit.independentPassages.count>=30);assert.equal(audit.independentPassages.blocked,0);
 assert.equal(audit.modelDeclaredPassagesRechecked.blocked,0);assert.equal(inspection.passages.blocked,0);
 assert.deepEqual([...new Set(audit.independentPassages.segments.map(p=>p.kind))].sort(),['hem','left_cuff_to_torso','neck','right_cuff_to_torso']);
 for(const kind of['neck','hem','left_cuff_to_torso','right_cuff_to_torso'])assert(audit.independentPassages.segments.filter(p=>p.kind===kind).length>=6,kind);
 const route=audit.independentPassages.segments.find(p=>p.kind==='neck'),a=new T.Vector3(...route.from),b=new T.Vector3(...route.to),middle=a.clone().add(b).multiplyScalar(.5);
 const cap=new T.Mesh(new T.BoxGeometry(.08,.08,.08),new T.MeshBasicMaterial());cap.name='negative-control-inserted-neck-cap';cap.position.copy(middle);cap.updateMatrixWorld(true);
 assert(independentSegmentAudit(T,[...model.parts,cap],route.from,route.to).some(hit=>hit.part===cap.name));cap.geometry.dispose();cap.material.dispose();
});

test('finite wall controls hit material rather than empty space and lining pairs are actual shell vertices',()=>{
 assert(audit.materialControls.length>=7);for(const c of audit.materialControls){assert(c.hits.length>=2,c.name);assert(c.firstWallThicknessAlongRay>.005,c.name);assert(c.firstWallThicknessAlongRay<.12,c.name);}
 assert(audit.liningPairDistances.count>100);assert(audit.liningPairDistances.minimum>.005);assert.equal(audit.liningPairDistances.nonVertexEndpoints,0);
});

test('the covered ivory underlayer stays inside the actual main inner wall in 32 finite cuts, and a breached-layer control fails',()=>{
 assert.equal(audit.layerSeparation.count,32);assert.equal(audit.layerSeparation.failed,0);assert(audit.layerSeparation.minimumSignedClearance>.005);
 const ring=(inner,outer)=>new T.Mesh(new T.LatheGeometry([[inner,-.5],[outer,-.5],[outer,.5],[inner,.5],[inner,-.5]].map(([x,y])=>new T.Vector2(x,y)),64),new T.MeshBasicMaterial());
 const shell=ring(.95,1),under=ring(.85,.90),bad=ring(.85,1.02),options={heights:[0,.2],angles:[0,45,90,135,180,225,270,315]},good=layerSeparationAudit(T,{shell,underskirt:under},options),breach=layerSeparationAudit(T,{shell,underskirt:bad},options);
 assert.equal(good.failed,0,'actual annular baseline has positive clearance');assert.equal(breach.failed,16);assert(breach.profiles.every(p=>p.signedClearance<0),'control extends cream through the main wall');for(const mesh of[shell,under,bad]){mesh.geometry.dispose();mesh.material.dispose();}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute([1,-.5,-.5,1,.5,-.5,1,0,.5],3));g.setIndex([0,1,2]);g.computeVertexNormals();const triangle=new T.Mesh(g,new T.MeshBasicMaterial());assert.equal(planeTriangleWallHits(T,triangle,[0,.5,-.5],[2,.5,-.5]).length,1,'exact triangle vertex is retained by bounded math');assert.equal(planeTriangleWallHits(T,triangle,[0,.500001,-.5],[2,.500001,-.5]).length,0,'an actual off-triangle near miss is rejected');g.dispose();triangle.material.dispose();
});

test('fixed collar, bow, underskirt and star trims connect through strict shared material witnesses, with outside-point rejection',()=>{
 assert.equal(audit.independentAttachments.failed,0);assert.equal(audit.connectedPartCount,model.parts.length);assert(audit.independentAttachments.count>=model.parts.length-1);assert(audit.independentAttachments.minimumClearance>1e-5);
 for(const c of audit.independentAttachments.contacts){assert(c.partAudit.strictInside,c.part);assert(c.targetAudit.strictInside,c.target);}
 assert.equal(independentPointAudit(T,model.shell,[100,100,100]).strictInside,false);
});

test('actual closed trim sections keep constant radius and finite smooth turns; a pinched section fails the radius criterion',()=>{
 assert(audit.bindingProfiles.length>=4);for(const profile of audit.bindingProfiles){assert(profile.closed,profile.name);assert(profile.sections>100,profile.name);assert(profile.radialSegments>=8,profile.name);assert(profile.minimumActualSectionRadius>.005,profile.name);assert(profile.radiusRange<1e-6,profile.name);assert(profile.endpointCenterGap<1e-6,profile.name);assert(profile.maximumAdjacentCenterlineTurnDegrees<25,profile.name);}
 const original=model.parts.find(m=>m.userData.tube?.closed),broken=original.clone();broken.geometry=original.geometry.clone();broken.userData=structuredClone(original.userData);const section=broken.userData.tube.sections[10],id=section.vertices[0],p=broken.geometry.attributes.position,c=new T.Vector3(...section.center),v=new T.Vector3().fromBufferAttribute(p,id);v.sub(c).multiplyScalar(.4).add(c);p.setXYZ(id,v.x,v.y,v.z);assert(tubeProfile(T,broken).radiusRange>1e-4);broken.geometry.dispose();
});

test('actual front/back and lining graph triangles avoid slivers and abrupt finite folds, with separate synthetic negative controls',()=>{
 for(const chart of Object.values(audit.conditionedCloth)){assert(chart.pass);assert(chart.minimumPlanarTriangleQuality>.20);assert(chart.maximumAdjacentFaceDihedralDegrees<25);}
 const flat={positions:[[0,0,0],[1,0,0],[0,1,0],[1,1,0]],faces:[[0,1,2],[1,3,2]],regions:['front','front']};assert(dressChartAudit(T,flat).pass);
 const steep=structuredClone(flat);steep.positions[1][2]=2;steep.positions[3][2]=2;const steepPlane=dressChartAudit(T,steep);assert(steepPlane.minimumAbsoluteFaceNormalZ<.8);assert.equal(steepPlane.maximumAdjacentFaceDihedralDegrees,0);assert(steepPlane.pass,'a uniformly tilted planar surface is not a fold');
 const folded=structuredClone(flat);folded.positions[3][2]=3;const fold=dressChartAudit(T,folded);assert(fold.minimumPlanarTriangleQuality>.20);assert(fold.maximumAdjacentFaceDihedralDegrees>25);assert.equal(fold.pass,false);
 const sliver={positions:[[0,0,0],[1,0,0],[0,.001,0],[1,.001,0]],faces:flat.faces,regions:flat.regions};assert.equal(dressChartAudit(T,sliver).pass,false);
});

test('135 finite phone and landscape cameras contain every actual fixed-pose vertex and every box corner',()=>{
 const points=vertices(),before=model.group.matrixWorld.toArray();let combinations=0;
 for(const aspect of[320/350,390/350,844/320])for(const yaw of[0,45,90,180,270])for(const pitch of[-80,12,82])for(const roll of[-25,0,25]){
  const{camera,fitted}=cameraFor(model.bounds,{yaw,pitch,roll,distance:1},aspect);
  for(const point of points){const depth=-point.clone().applyMatrix4(camera.matrixWorldInverse).z,q=point.clone().project(camera);assert(depth>camera.near&&depth<camera.far);assert(Math.abs(q.x)<1&&Math.abs(q.y)<1);}
  for(const x of[model.bounds.min[0],model.bounds.max[0]])for(const y of[model.bounds.min[1],model.bounds.max[1]])for(const z of[model.bounds.min[2],model.bounds.max[2]]){const q=new T.Vector3(x,y,z).project(camera);assert(Math.abs(q.x)<1&&Math.abs(q.y)<1);}
  assert(fitted.actualDistance>=fitted.minimumDistance);combinations++;
 }
 assert.equal(combinations,135);assert.deepEqual(model.group.matrixWorld.toArray(),before);assert.deepEqual(model.group.scale.toArray(),[1,1,1]);
});

test('the old Vector3-corner collapse is an effective positive control against the actual dress vertices',()=>{
 const box=new T.Box3().setFromObject(model.group),view={yaw:90,pitch:10,roll:0,distance:1},aspect=320/350,old=cameraFor({min:box.min,max:box.max},view,aspect),fixed=cameraFor({min:box.min.toArray(),max:box.max.toArray()},view,aspect);
 assert.equal(old.fitted.ndcBounds.minX,old.fitted.ndcBounds.maxX);assert.equal(old.fitted.ndcBounds.minY,old.fitted.ndcBounds.maxY);assert(old.fitted.actualDistance<fixed.fitted.minimumDistance);
 assert(vertices().some(point=>{const q=point.clone().project(old.camera);return Math.abs(q.x)>1||Math.abs(q.y)>1;}));
 assert.deepEqual(model.bounds,{min:box.min.toArray(),max:box.max.toArray()});assert.throws(()=>fitView(T,model.bounds,{...view,roll:NaN},1),/invalid/);
});

test('authored back, depth, lining and fixed decorations preserve the source motifs and all body, rig and game gates',()=>{
 const names=model.parts.map(m=>m.name).join(' ');for(const motif of['collar','bow','star','underskirt'])assert(names.includes(motif),motif);
 assert.equal(spec.bodyBinding,null);for(const flag of['bodyMeasurements','wearingFit','rig','clothPhysics','normalGame','unlockSave','newRaw','newDesign','newVillageLibraryCandidate'])assert.equal(spec[flag],false,flag);
 assert.equal(inspection.bodyBinding,null);assert.equal(audit.bodyBinding,null);assert.equal(audit.ownershipUnlockSave,false);assert.equal(model.budget.textures,0);
 const colors=model.shell.geometry.attributes.color;assert(colors,'continuous fabric colour band is stored on the actual shell vertices');assert.equal(colors.itemSize,3);assert.equal(colors.count,model.shell.geometry.attributes.position.count);assert(Array.from(colors.array).every(v=>Number.isFinite(v)&&v>=0&&v<=1));assert((Array.isArray(model.shell.material)?model.shell.material:[model.shell.material]).some(m=>m.vertexColors===true));
 assert(new T.Vector3(...model.interiorView.eye).y<model.bounds.min[1]);
});

test('the finite certificate reproduces these actual triangle probes and the current audit recipe bytes',()=>{
 const cert=JSON.parse(read('finite-geometry-certificate.json'));assert.equal(cert.model_sha256,hash(read('dress.mjs')));assert.equal(cert.audit_sha256,hash(read('audit.mjs')));assert.equal(cert.source_original_sha256,spec.sourceSHA);assert.deepEqual(cert.audit,audit);assert.equal(cert.audit.result,'pass');assert.equal(cert.bodyBinding,null);
});

test('viewer source binds real numeric-array bounds, raw canvas export and phone fixtures without storage or automatic download',()=>{
 const v=read('viewer.mjs').toString(),html=read('index.html').toString(),demo=readFileSync(new URL('static/pet-starlight-dress-volume-demo.html',root),'utf8');
 for(const name of['front','side','back','top','bottom','interior'])assert(html.includes('data-view="'+name+'"'));
 assert(v.includes('realBox.min.toArray()'));assert(v.includes('sampledActualVertices:wholeVertices.length'));assert(v.includes('window.starlightDressProof=api'));assert(v.includes("renderer.domElement.toDataURL('image/png')"));assert(!v.includes("$('download').click"));assert(!/localStorage|sessionStorage|indexedDB/.test(v));for(const width of['320','390','844'])assert(demo.includes(width));assert(v.includes('wholeModelFraming:false'));
});

function bindings(source){
 const start=source.indexOf(' const on='),end=source.indexOf(' const resize=',start);assert(start>=0&&end>start,'actual viewer event block');
 function node(id){return{id,value:({yaw:'18',pitch:'14',roll:'0',distance:'3'})[id]||'',min:'-360',max:'360',dataset:{},attrs:{},listeners:{},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,fn){this.listeners[k]=fn;},focus(){},setPointerCapture(){}};}
 const nodes=Object.fromEntries(['yaw','pitch','roll','distance','reset','markers','lighting'].map(k=>[k,node(k)])),stage=node('stage'),peers=['front','side','back','top','bottom','interior'].map(name=>{const p=node(name);p.dataset.view=name;return p;}),window=node('window'),document=node('document');document.querySelectorAll=()=>peers;
 const context={document,window,stage,$:id=>nodes[id],events:{signal:{}},markers:{visible:false},lights:[],scene:{background:{set(){}}},paint(){},Math,Number,Object};vm.createContext(context);
 vm.runInContext("let cameraMode='whole',drag=null;"+source.slice(start,end)+';globalThis.fixture={setView,getMode:()=>cameraMode};',context);
 return{nodes,peers,stage,fixture:context.fixture,pressed:()=>peers.filter(p=>p.attrs['aria-pressed']==='true').map(p=>p.dataset.view)};
}
test('actual event bindings clear presets for reset, sliders, drag and keyboard; old reset mutation is detected',()=>{
 const source=read('viewer.mjs').toString(),b=bindings(source),clear=()=>assert.deepEqual(b.pressed(),[]);
 b.fixture.setView('interior');assert.deepEqual(b.pressed(),['interior']);b.nodes.reset.listeners.click();clear();assert.equal(b.fixture.getMode(),'whole');
 for(const id of['yaw','pitch','roll','distance']){b.fixture.setView('back');b.nodes[id].listeners.input();clear();assert.equal(b.fixture.getMode(),'whole');}
 b.fixture.setView('top');b.stage.listeners.pointerdown({button:0,isPrimary:true,pointerId:1,clientX:0,clientY:0});clear();b.stage.listeners.pointermove({pointerId:1,clientX:25,clientY:10});assert.equal(Number(b.nodes.yaw.value),10);b.stage.listeners.pointerup();
 for(const key of['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','q','e']){b.fixture.setView('side');let prevented=false;b.stage.listeners.keydown({key,preventDefault(){prevented=true;}});assert(prevented);clear();assert.equal(b.fixture.getMode(),'whole');}
 const broken=source.replace(/(on\(\$\('reset'\),'click',\(\)=>\{cameraMode='whole';)markView\(null\);/,'$1');assert.notEqual(broken,source);const old=bindings(broken);old.fixture.setView('bottom');old.nodes.reset.listeners.click();assert.deepEqual(old.pressed(),['bottom'],'negative control preserves the stale button and must fail the clear criterion');
});

test('startup failures clean resources once and keep private exception, stack and URL text out of public details',async()=>{
 const nodes=Object.fromEntries(['stage','status','report'].map(k=>[k,{dataset:{},textContent:''}]));let disposed=0;
 assert.equal(await startPreview({doc:{getElementById:id=>nodes[id]},load:async()=>({start(){throw Error('private https://invalid.example/private-key')},cleanup(){disposed++;return{failed:0}}})}),false);
 assert.equal(disposed,1);assert.equal(nodes.stage.dataset.ready,'false');assert(!nodes.report.textContent.includes('private'));assert.equal(failureDetails(Error('private')).rawMessageStackOrURLSaved,false);assert.equal(failureDetails(Error('dress_invalid_probe')).code,'dress_invalid_probe');
});

test('resource disposal is idempotent and destroys each unique geometry and material exactly once',()=>{
 const m=build(T),uniqueMaterials=new Set(m.resources.materials);let geometries=0,materials=0;for(const g of m.resources.geometries)g.addEventListener('dispose',()=>geometries++);for(const material of uniqueMaterials)material.addEventListener('dispose',()=>materials++);
 assert.throws(()=>m.resolveRim('measured_body_anchor'),/unknown_rim/);assert.equal(m.dispose(),true);assert.equal(geometries,m.resources.geometries.size);assert.equal(materials,uniqueMaterials.size);assert.equal(m.dispose(),false);assert.equal(m.group.children.length,0);assert.throws(()=>m.inspect(),/disposed/);assert.throws(()=>build(null),/three_required/);
});
