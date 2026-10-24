/* Approved cozy-room geometry. Presentation only: saved game state belongs to the caller. */
(function(global){
'use strict';
var instanceId=0,threePromise=null;
const thumbnailCache=new Map();
function clone(value){return JSON.parse(JSON.stringify(value));}
function loadThree(){if(!threePromise)threePromise=import('/static/vendor/three-0.160.1.module.js').catch(function(error){threePromise=null;throw error;});return threePromise;}
async function mount(options){
 const opts=options||{},host=opts.host;
 if(!host||typeof host.appendChild!=='function')throw new TypeError('room_host_required');
 const doc=host.ownerDocument||document,win=doc.defaultView||global,editable=opts.editable===true;
 let disposed=false,failed=false,busy=false,renderer=null,scene=null,resizeObserver=null;
 let refreshControls=()=>{};
 let state=clone(opts.layout),saved=clone(opts.savedLayout||opts.layout),history=[],selected=null,category='furniture',drag=null;
 const removers=[],geometries=new Set(),allMaterials=new Set(),textures=new Set(),objectGroups=new Map();
 const id='pet-cozy-'+(++instanceId),root=doc.createElement('section');
 root.className='ipg-cozy-room'+(editable?' is-editable':' is-readonly');
 root.setAttribute('aria-label','カントリーなお部屋'+(editable?'の模様替え':''));
 const shell=doc.createElement('div');shell.className='room-shell';root.appendChild(shell);
 const top=doc.createElement('header');top.className='room-top';
 top.innerHTML='<h3 class="room-title">お部屋の模様替え</h3><div class="room-save"><button type="button" data-action="restore">保存に戻す</button><button type="button" class="room-save-main" data-action="save">配置を保存</button></div>';
 const content=doc.createElement('div');content.className='room-content';
 const sceneWrap=doc.createElement('div');sceneWrap.className='room-scene-wrap';
 const stage=doc.createElement('div');stage.className='room-stage';stage.dataset.cozyStage='true';
 stage.setAttribute('aria-label',editable?'家具を選んで置く場所を変えられるお部屋':'育成中のキャラクターのお部屋');
 const loading=doc.createElement('div');loading.className='room-loading';loading.textContent='お部屋をひらいています…';stage.appendChild(loading);
 const view=doc.createElement('div');view.className='room-view';view.setAttribute('role','group');view.setAttribute('aria-label','お部屋の見かた');
 view.innerHTML='<button type="button" data-camera="room" aria-pressed="true">お部屋</button><button type="button" data-camera="top" aria-pressed="false">上から</button>';
 stage.appendChild(view);sceneWrap.appendChild(stage);content.appendChild(sceneWrap);
 const selectionUI=doc.createElement('div');selectionUI.className='room-selection';
 selectionUI.innerHTML='<select class="room-placed-select" aria-label="配置中の家具"></select><span class="room-hint">家具を指で押したまま動かす</span>';
 const placedSelect=selectionUI.querySelector('select');let placedSignature='';
 const actions=doc.createElement('div');actions.className='room-actions';actions.setAttribute('role','group');actions.setAttribute('aria-label','選んだ家具の操作');
 actions.innerHTML='<button type="button" data-move="left" aria-label="左へ動かす">←</button><button type="button" data-move="back" aria-label="奥へ動かす">↑</button><button type="button" data-move="front" aria-label="手前へ動かす">↓</button><button type="button" data-move="right" aria-label="右へ動かす">→</button><button type="button" data-action="rotate">回す</button><button type="button" data-action="remove">しまう</button><button type="button" data-action="undo" class="room-secondary" disabled>ひとつ戻す</button>';
 const panel=doc.createElement('aside');panel.className='room-panel';panel.setAttribute('aria-label','家具とお部屋の着せ替えカタログ');
 const tabs=doc.createElement('div');tabs.className='room-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','模様替えの種類');
 const catalogEl=doc.createElement('div');catalogEl.className='room-catalog';catalogEl.id=id+'-catalog';catalogEl.setAttribute('role','tabpanel');
 for(const row of [{key:'furniture',label:'家具'},{key:'wall',label:'壁紙'},{key:'floor',label:'床'}]){
  const b=doc.createElement('button');b.type='button';b.dataset.category=row.key;b.id=id+'-'+row.key;b.textContent=row.label;b.setAttribute('role','tab');b.setAttribute('aria-selected',String(row.key==='furniture'));b.setAttribute('aria-controls',catalogEl.id);tabs.appendChild(b);
 }
 panel.append(tabs,catalogEl);
 const status=doc.createElement('output');status.className='room-status';status.setAttribute('aria-live','polite');status.textContent='家具を選ぶと、お部屋の中で動かせます。';
 const foot=doc.createElement('p');foot.className='room-footnote';foot.textContent='家具を指で動かして、配置を保存できます。';
 if(editable){shell.appendChild(top);sceneWrap.append(selectionUI,actions);content.appendChild(panel);}
 shell.appendChild(content);if(editable)shell.append(status,foot);host.appendChild(root);
 function isCurrent(){if(disposed||failed)return false;try{return typeof opts.canRun!=='function'||opts.canRun()!==false;}catch(_){return false;}}
 function listen(target,name,fn,config){target.addEventListener(name,fn,config);removers.push(()=>target.removeEventListener(name,fn,config));}
 function announce(message){if(!disposed)status.textContent=message;}
 function emitDraft(){if(!isCurrent()||!editable)return;try{if(typeof opts.onDraftChange==='function')opts.onDraftChange(clone(state));}catch(_){}}
 function trackMaterial(material){allMaterials.add(material);return material;}
 function disposeGeometry(g){if(geometries.delete(g))g.dispose();}
 function disposeGroup(group){group.traverse(o=>{if(o.geometry)disposeGeometry(o.geometry);});}
 function clearResources(){
  if(resizeObserver){resizeObserver.disconnect();resizeObserver=null;}
  while(removers.length){try{removers.pop()();}catch(_){}}
  for(const g of geometries){try{g.dispose();}catch(_){}}geometries.clear();
  for(const m of allMaterials){try{m.dispose();}catch(_){}}allMaterials.clear();
  for(const t of textures){try{t.dispose();}catch(_){}}textures.clear();
  if(scene)scene.traverse(o=>{if(o.shadow&&typeof o.shadow.dispose==='function')o.shadow.dispose();});
  objectGroups.clear();
  if(renderer){try{renderer.renderLists.dispose();renderer.dispose();renderer.forceContextLoss();}catch(_){}renderer=null;}
 }
 function destroy(){if(disposed)return;cancelDrag();disposed=true;clearResources();root.remove();}
 function fail(code){
  if(disposed||failed)return;cancelDrag();failed=true;clearResources();
  root.dataset.loadError=code;loading.hidden=false;loading.textContent='お部屋を表示できませんでした。いったん閉じて、開き直してください。';loading.setAttribute('role','alert');
  view.hidden=true;root.querySelectorAll('button').forEach(b=>{b.disabled=true;});announce('お部屋の表示を確認できませんでした。配置は変更していません。');
  try{if(typeof opts.onError==='function')opts.onError(code);}catch(_){}
 }
 function setBusy(value){if(disposed||failed)return;busy=!!value;if(busy)cancelDrag();root.setAttribute('aria-busy',String(busy));root.querySelectorAll('button,select').forEach(b=>{b.disabled=busy||b.dataset.ipgDisabled==='1';});refreshControls();}
 const controller={destroy,getDraft:()=>clone(state),setBusy,stage,root};
 function cancelDrag(){if(drag&&typeof finishDrag==='function')finishDrag(false);}
 if(!isCurrent()){destroy();return null;}
 let THREE;
 try{THREE=await loadThree();}catch(_){if(isCurrent())fail('room_renderer_load_failed');else destroy();return null;}
 if(!isCurrent()){destroy();return null;}
 try{
  const metadata=new Map((Array.isArray(opts.types)?opts.types:[]).map(row=>[row.id,row]));
  if(!state||state.version!==1||!Array.isArray(state.objects)||!Number.isInteger(state.nextId)||state.nextId<1)throw new Error('room_layout');
  for(const o of state.objects)if(!metadata.has(o.type)||!Number.isFinite(o.x)||!Number.isFinite(o.z))throw new Error('room_layout');
  scene=new THREE.Scene();
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:false});
  renderer.setPixelRatio(Math.min(win.devicePixelRatio||1,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
  const canvas=renderer.domElement;canvas.dataset.cozyCanvas='true';canvas.setAttribute('aria-label',editable?'立体のお部屋。家具を指で押したまま動かせます。選んだ家具は矢印キーでも動かせます。':'立体のお部屋');if(editable)canvas.tabIndex=0;stage.prepend(canvas);
  const camera=new THREE.OrthographicCamera(-6,6,6,-6,.1,80);let cameraMode='room';
  const hemi=new THREE.HemisphereLight(0xfff9e5,0xc5a891,1.75);scene.add(hemi);
  const sun=new THREE.DirectionalLight(0xffedcf,2.2);sun.position.set(-3,10,7);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-7;sun.shadow.camera.right=7;sun.shadow.camera.top=7;sun.shadow.camera.bottom=-7;sun.shadow.normalBias=.04;sun.shadow.bias=-.0001;sun.shadow.radius=5;scene.add(sun);
  const fill=new THREE.DirectionalLight(0xe8e5ff,.55);fill.position.set(6,4,-4);scene.add(fill);
const materials=new Map();
function mat(color,rough=.8){const k=color+':'+rough;if(!materials.has(k))materials.set(k,trackMaterial(new THREE.MeshStandardMaterial({color,roughness:rough,metalness:0})));return materials.get(k);}
function rb(w,h,d,r=.06){const g=new THREE.BoxGeometry(w,h,d,5,5,5),p=g.attributes.position,v=new THREE.Vector3(),inner=new THREE.Vector3();const rr=Math.min(r,w/2,h/2,d/2);for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i);inner.set(Math.max(-w/2+rr,Math.min(w/2-rr,v.x)),Math.max(-h/2+rr,Math.min(h/2-rr,v.y)),Math.max(-d/2+rr,Math.min(d/2-rr,v.z)));v.sub(inner).normalize().multiplyScalar(rr).add(inner);p.setXYZ(i,v.x,v.y,v.z);}g.computeVertexNormals();return g;}
function mesh(g,m,parent,x=0,y=0,z=0){geometries.add(g);const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;}
function box(parent,w,h,d,color,x=0,y=0,z=0,r=.05){return mesh(rb(w,h,d,r),mat(color),parent,x,y,z);}
function cyl(parent,top,bottom,h,color,x=0,y=0,z=0,segments=24){return mesh(new THREE.CylinderGeometry(top,bottom,h,segments),mat(color),parent,x,y,z);}
function ball(parent,x,y,z,sx,sy,sz,color){const o=mesh(new THREE.SphereGeometry(1,20,12),mat(color),parent,x,y,z);o.scale.set(sx,sy,sz);return o;}
const textureCache=new Map();let ginghamMaterial=null;
function fabricMaterial(){if(!ginghamMaterial)ginghamMaterial=trackMaterial(new THREE.MeshStandardMaterial({map:texture('gingham'),roughness:.9}));return ginghamMaterial;}
function texture(kind){if(textureCache.has(kind))return textureCache.get(kind);const c=doc.createElement('canvas');c.width=c.height=512;const x=c.getContext('2d');
 if(kind==='honey'||kind==='oak'){x.fillStyle=kind==='honey'?'#bc8b58':'#cdb89a';x.fillRect(0,0,512,512);x.save();x.translate(256,256);x.rotate(Math.PI/4);const colors=kind==='honey'?['#c49a65','#cfa777','#b98e5d','#c7a06d']:['#d3bfa0','#decaad','#c6b092','#d7c3a4'];for(let row=-13;row<13;row++)for(let col=-4;col<4;col++){const px=col*180+(row%2)*90,py=row*36;x.fillStyle=colors[((row*7+col*3)%4+4)%4];x.fillRect(px,py,179,35);x.strokeStyle='rgba(101,66,34,.23)';x.lineWidth=1;x.strokeRect(px+.5,py+.5,178,34);x.strokeStyle='rgba(113,76,43,.12)';x.lineWidth=.8;for(let grain=0;grain<3;grain++){const gy=py+8+grain*9;x.beginPath();x.moveTo(px+7,gy);x.quadraticCurveTo(px+72,gy-3+(row%3),px+170,gy+1);x.stroke();}}x.restore();}
 else if(kind==='check'){x.fillStyle='#f1e9cd';x.fillRect(0,0,512,512);for(let a=0;a<8;a++)for(let b=0;b<8;b++){x.fillStyle=(a+b)%2?'#c6d0ab':'#e8e5cd';x.fillRect(a*64,b*64,64,64);}x.strokeStyle='rgba(255,255,255,.18)';for(let i=0;i<512;i+=8){x.beginPath();x.moveTo(0,i);x.lineTo(512,i);x.stroke();}}
 else if(kind==='brick'){x.fillStyle='#f4e8d0';x.fillRect(0,0,512,512);for(let row=0;row<9;row++)for(let col=-1;col<5;col++){x.fillStyle=['#e2cba8','#e6d1af','#ead7b9'][(row+col+12)%3];x.fillRect(col*128+(row%2)*64+3,row*58+3,122,52);}}
 else if(kind==='floral'){x.fillStyle='#f3e8dc';x.fillRect(0,0,512,512);for(let a=0;a<7;a++)for(let b=0;b<7;b++){const px=28+a*76+(b%2)*15,py=25+b*77;x.strokeStyle='#b9c3a6';x.lineWidth=3;x.beginPath();x.moveTo(px,py+17);x.quadraticCurveTo(px+9,py+1,px+2,py-15);x.stroke();x.fillStyle='#d9aeae';for(let k=0;k<5;k++){const t=k*Math.PI*2/5;x.beginPath();x.ellipse(px+Math.cos(t)*5,py-8+Math.sin(t)*5,5,3,t,0,7);x.fill();}x.fillStyle='#c5ab77';x.beginPath();x.arc(px,py-8,2,0,7);x.fill();}}
 else if(kind==='mint'){x.fillStyle='#d7e0ce';x.fillRect(0,0,512,512);x.fillStyle='#c4d0bc';for(let a=0;a<8;a++)x.fillRect(a*64,0,2,512);}
 else if(kind==='gingham'){x.fillStyle='#fff8df';x.fillRect(0,0,512,512);for(let a=0;a<8;a++)for(let b=0;b<8;b++){x.fillStyle=a%2&&b%2?'#c8d397':a%2||b%2?'#e0e5b8':'#fff6d8';x.fillRect(a*64,b*64,64,64);}}
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=4;textures.add(t);textureCache.set(kind,t);return t;
}
function wallPattern(kind){const t=texture(kind);t.repeat.set(3,1);return t;}
let wallTexture=wallPattern(state.wall),floorTexture=texture(state.floor);
const floorMat=trackMaterial(new THREE.MeshStandardMaterial({map:floorTexture,roughness:.88}));const wallMat=trackMaterial(new THREE.MeshStandardMaterial({map:wallTexture,roughness:.94}));
const architecture=new THREE.Group();scene.add(architecture);box(architecture,8.3,.3,8.3,'#a7764e',0,-.2,0,.08);
const floor=mesh(new THREE.BoxGeometry(8,.08,8),floorMat,architecture,0,-.025,0);
const back=mesh(new THREE.BoxGeometry(8.1,2.8,.18),wallMat,architecture,0,1.4,-4.03);const left=mesh(new THREE.BoxGeometry(.18,2.8,8.1),wallMat,architecture,-4.03,1.4,0);
box(architecture,8.2,.12,.28,'#b28d63',0,.08,-3.92,.02);box(architecture,.28,.12,8.2,'#b28d63',-3.92,.08,0,.02);
box(architecture,8.2,.12,.25,'#d7ba8f',0,2.78,-4.02,.02);box(architecture,.25,.12,8.2,'#d7ba8f',-4.02,2.78,0,.02);
// The window is a fixed architectural detail, while all room furniture below is editable.
const windowGroup=new THREE.Group();architecture.add(windowGroup);windowGroup.position.set(.95,1.9,-3.9);
box(windowGroup,1.65,1.2,.09,'#9dbb9d',0,0,.02,.02);box(windowGroup,1.7,.1,.15,'#b69265',0,.65,.08);box(windowGroup,1.7,.1,.24,'#b69265',0,-.65,.13);box(windowGroup,.09,1.3,.13,'#b69265',-.8,0,.09);box(windowGroup,.09,1.3,.13,'#b69265',.8,0,.09);box(windowGroup,.06,1.2,.13,'#b69265',0,0,.1);box(windowGroup,1.6,.06,.13,'#b69265',0,0,.1);
for(const side of [-1,1]){for(let k=0;k<5;k++)cyl(windowGroup,.06,.065,1.32,k%2?'#f4dfcf':'#ead0c3',side*(.9+k*.07),-.02,.12,12);box(windowGroup,.5,.08,.18,'#d8b69b',side*1.03,.7,.12);}
const shelf=new THREE.Group();architecture.add(shelf);shelf.position.set(-2.15,2.2,-3.82);box(shelf,1.35,.08,.28,'#ba9365',0,0,0);for(let i=0;i<4;i++){const co=['#abbe9c','#d7b18c','#d8a9a2','#e7d9b7'][i];cyl(shelf,.09,.08,.26,co,-.45+i*.3,.16,0);}
const definitions={
 bed:{label:'チェックのベッド',w:1.65,d:2.55,build(){const g=new THREE.Group();for(const x of [-.65,.65])for(const z of [-1.07,1.07]){cyl(g,.07,.065,.45,'#d4bb91',x,.22,z);ball(g,x,.5,z,.11,.11,.11,'#e0cfab');}box(g,1.6,.22,2.46,'#d1b389',0,.48,0,.1);box(g,1.54,.24,2.37,'#fff4d8',0,.68,0,.12);const blanket=mesh(rb(1.58,.18,1.72,.1),fabricMaterial(),g,0,.83,.3);box(g,1.13,.2,.55,'#fff8e8',0,.9,-.8,.17);box(g,1.55,.75,.16,'#dfc7a1',0,.89,-1.15,.18);for(let x=-.53;x<.6;x+=.35)box(g,.045,.52,.07,'#f1e3c8',x,.98,-1.04,.02);return g;}},
 table:{label:'まるい木のテーブル',w:1.65,d:1.35,build(){const g=new THREE.Group();box(g,1.65,.15,1.35,'#d9b584',0,.93,0,.24);for(const x of [-.59,.59])for(const z of [-.42,.42])cyl(g,.07,.05,.9,'#c39a6a',x,.44,z);const tray=cyl(g,.27,.25,.04,'#9b7850',.15,1.035,.05);cyl(g,.09,.08,.17,'#eee5c9',-.12,1.13,.01);const handle=mesh(new THREE.TorusGeometry(.06,.018,8,16),mat('#eee5c9'),g,-.22,1.14,.01);handle.rotation.y=Math.PI/2;ball(g,.25,1.11,.04,.15,.07,.11,'#ce8f5c');return g;}},
 chair:{label:'木のチェア',w:.75,d:.8,build(){const g=new THREE.Group();for(const x of [-.26,.26])for(const z of [-.28,.28])cyl(g,.04,.035,.7,'#c7a371',x,.35,z,16);box(g,.72,.1,.72,'#dec39b',0,.72,0,.15);box(g,.6,.08,.57,'#eee6d3',0,.79,.03,.18);for(const x of [-.28,.28])cyl(g,.035,.035,.66,'#d1b082',x,1.03,-.28,16);box(g,.64,.15,.1,'#d8b98c',0,1.34,-.28,.06);return g;}},
 cupboard:{label:'ガラスの食器棚',w:1.5,d:.66,build(){const g=new THREE.Group();box(g,1.47,2.18,.62,'#d6bb94',0,1.15,0,.09);box(g,1.36,.85,.66,'#e8d9bb',0,.5,.04,.06);for(const x of [-.34,.34]){box(g,.6,.7,.06,'#ede2c9',x,.51,.39,.025);ball(g,x+.2,.58,.44,.035,.035,.035,'#9d8255');}box(g,1.32,1.05,.05,'#c8ad86',0,1.55,-.28);for(const y of [1.08,1.55,2.05])box(g,1.36,.065,.6,'#e9d9b8',0,y,.02,.02);for(let i=0;i<5;i++){cyl(g,.075,.065,.14,['#f6eed9','#d8c5a7','#c4d0b2'][i%3],-.48+i*.24,1.68,.05,20);cyl(g,.12,.115,.028,'#e9dfc8',-.48+i*.24,1.13,.08,20);}for(const x of [-.68,0,.68])box(g,.045,1.04,.08,'#eadbc0',x,1.57,.31,.012);box(g,1.59,.12,.73,'#e2cba6',0,2.27,.02,.06);return g;}},
 plant:{label:'みどりの鉢植え',w:.85,d:.85,build(){const g=new THREE.Group();cyl(g,.33,.25,.52,'#b98c64',0,.27,0);cyl(g,.35,.35,.08,'#c69a70',0,.53,0);cyl(g,.28,.28,.035,'#6d5b42',0,.57,0);for(let i=0;i<7;i++){const a=i*2.4,px=Math.cos(a)*.27,pz=Math.sin(a)*.27;const stem=cyl(g,.017,.02,.95,'#6d8c55',px/2,1.0,pz/2,10);stem.rotation.z=Math.sin(a)*.22;const leaf=ball(g,px,1.42+(i%3)*.13,pz,.22,.43,.075,i%2?'#8ca96d':'#6c8b58');leaf.rotation.z=-Math.cos(a)*.55;leaf.rotation.y=a;}return g;}},
 counter:{label:'カフェのカウンター',w:1.85,d:.85,build(){const g=new THREE.Group();box(g,1.8,.96,.78,'#e3ccb1',0,.52,0,.06);for(let x=-.7;x<.85;x+=.27)box(g,.025,.75,.025,'#c9af8e',x,.53,.407,.01);box(g,1.97,.12,.96,'#d4ab79',0,1.05,0,.08);box(g,.58,.11,.42,'#a68a68',-.45,1.16,.02,.05);ball(g,-.46,1.26,.02,.23,.09,.15,'#bc7e4a');const kettle=cyl(g,.15,.17,.27,'#d8a9a0',.55,1.24,.02);ball(g,.55,1.4,.02,.14,.05,.14,'#e5b8ac');const handle=mesh(new THREE.TorusGeometry(.13,.025,8,20),mat('#8d7761'),g,.55,1.46,.02);handle.rotation.y=Math.PI/2;return g;}},
 lamp:{label:'森色のフロアランプ',w:.65,d:.65,build(){const g=new THREE.Group();cyl(g,.25,.3,.09,'#718069',0,.065,0);cyl(g,.032,.04,1.95,'#718069',0,1.02,0,16);cyl(g,.22,.43,.42,'#a5b48b',0,2.03,0);cyl(g,.41,.41,.04,'#e9dcc1',0,1.81,0);ball(g,0,1.8,0,.11,.11,.11,'#fff1cc');return g;}},
 rug:{label:'やわらかラグ',w:2.9,d:2.25,flat:true,build(){const g=new THREE.Group();const r=box(g,2.9,.025,2.25,'#e2c5b4',0,.026,0,.36);box(g,2.62,.028,1.97,'#eee0c4',0,.041,0,.32);box(g,2.45,.029,1.8,'#e5d5b7',0,.056,0,.29);return g;}}
};

  // Imported placements retain their sourceId and position. They cannot be added from this catalogue.
  definitions.legacy_window={build(){const g=new THREE.Group();box(g,1.65,1.3,.18,'#d2b58b',0,.92,0);box(g,1.43,1.07,.2,'#a9c6b1',0,.93,.02);box(g,.06,1.08,.24,'#ecd8b7',0,.93,.04);box(g,1.45,.06,.24,'#ecd8b7',0,.93,.04);return g;}};
  definitions.legacy_bowl={build(){const g=new THREE.Group();cyl(g,.32,.26,.16,'#d7b7b8',0,.1,0);cyl(g,.26,.26,.02,'#a8c5c1',0,.19,0);return g;}};
  definitions.legacy_toy={build(){const g=new THREE.Group();ball(g,0,.37,0,.36,.36,.36,'#e4c891');box(g,.66,.07,.1,'#e9a99b',0,.4,0,.03);return g;}};
  definitions.decor_house={build(){const g=new THREE.Group();box(g,1.05,.85,.94,'#e6d3a7',0,.45,0,.06);const roof=mesh(new THREE.ConeGeometry(.84,.62,4),mat('#b9a0b6'),g,0,1.15,0);roof.rotation.y=Math.PI/4;box(g,.3,.48,.06,'#bc9c76',0,.27,.5,.07);return g;}};
  definitions.decor_tree={build(){const g=new THREE.Group();cyl(g,.09,.13,.9,'#b58c63',0,.45,0);ball(g,0,1.08,0,.49,.65,.49,'#a8bd87');ball(g,-.22,.95,.1,.3,.4,.3,'#91ab72');return g;}};
  function flowerBuild(sunflower){const g=new THREE.Group();cyl(g,.014,.02,.65,'#789769',0,.34,0,12);const co=sunflower?'#e3bd69':'#d8b0c4';for(let i=0;i<8;i++){const a=i*Math.PI/4;ball(g,Math.cos(a)*.17,.71+Math.sin(a)*.17,0,.1,.13,.045,co);}ball(g,0,.71,.025,.1,.1,.06,sunflower?'#9e7951':'#e7d399');return g;}
  definitions.decor_flower={build:()=>flowerBuild(false)};
  definitions.decor_sunflower={build:()=>flowerBuild(true)};
  definitions.decor_fountain={build(){const g=new THREE.Group();cyl(g,.58,.52,.15,'#c7c6b6',0,.1,0);cyl(g,.48,.48,.025,'#a8c8c9',0,.19,0);cyl(g,.08,.13,.65,'#d5d2bf',0,.47,0);cyl(g,.3,.2,.1,'#d8d2bc',0,.8,0);cyl(g,.25,.25,.025,'#b7d6d3',0,.87,0);return g;}};
  definitions.decor_mushroom={build(){const g=new THREE.Group();cyl(g,.1,.16,.38,'#e6d6b7',0,.19,0);ball(g,0,.46,0,.35,.22,.35,'#d2a6a6');for(let i=0;i<5;i++){const a=i*2.4;ball(g,Math.cos(a)*.19,.61,Math.sin(a)*.19,.045,.025,.045,'#f6ead0');}return g;}};
  definitions.decor_lantern={build(){const g=new THREE.Group();box(g,.46,.07,.46,'#9c947c',0,.05,0,.05);box(g,.39,.56,.39,'#eadfba',0,.35,0,.06);for(const x of [-.2,.2])for(const z of [-.2,.2])box(g,.035,.63,.035,'#98977d',x,.36,z,.01);cyl(g,.13,.32,.18,'#9caa8e',0,.77,0);return g;}};
  for(const [key,def] of Object.entries(definitions)){const meta=metadata.get(key);if(meta){def.label=meta.name;def.w=meta.width;def.d=meta.depth;def.flat=!!meta.flat;}}
  for(const o of state.objects)if(!definitions[o.type])throw new Error('room_layout');
  const catalogTypes=(Array.isArray(opts.furniture)?opts.furniture:[]).filter(row=>metadata.has(row.id)&&definitions[row.id]&&!row.sourceId&&['bed','table','chair','cupboard','plant','counter','lamp','rug'].includes(row.id));
  function canAddType(key){const spec=catalogTypes.find(row=>row.id===key);return !!spec&&(!Number.isSafeInteger(spec.limit)||state.objects.filter(row=>row.type===key).length<spec.limit);}
  selected=state.objects.some(o=>o.id===opts.initialSelectedId)?opts.initialSelectedId:(state.objects.find(o=>o.type==='table')||state.objects[0]||{}).id;
  const objectLayer=new THREE.Group();scene.add(objectLayer);
  const selectionGeometry=new THREE.PlaneGeometry(1,1);geometries.add(selectionGeometry);
  const selection=new THREE.Mesh(selectionGeometry,trackMaterial(new THREE.MeshBasicMaterial({color:0x88bcb0,transparent:true,opacity:.23,depthWrite:false,side:THREE.DoubleSide})));selection.rotation.x=-Math.PI/2;selection.position.y=.065;scene.add(selection);
  const ray=new THREE.Raycaster(),pointer=new THREE.Vector2(),ground=new THREE.Plane(new THREE.Vector3(0,1,0),0),planePoint=new THREE.Vector3();
  const wallOptions=[{key:'brick',label:'クリームれんが'},{key:'floral',label:'小花の壁紙'},{key:'mint',label:'セージの板壁'}];
  const floorOptions=[{key:'honey',label:'はちみつの木'},{key:'oak',label:'しろいオーク'},{key:'check',label:'やさしいタイル'}];
  const swatches=new Map();
  function canEdit(){return editable&&!busy&&isCurrent();}
  function selectedObject(){return state.objects.find(o=>o.id===selected);}
  function bounds(o){const d=definitions[o.type];return o.r%2?{w:d.d,d:d.w}:{w:d.w,d:d.d};}
  function valid(o){const b=bounds(o);if(!b||Math.abs(o.x)+b.w/2>3.85+1e-9||Math.abs(o.z)+b.d/2>3.85+1e-9)return false;if(definitions[o.type].flat)return true;return !state.objects.some(p=>{if(p.id===o.id||definitions[p.type].flat)return false;const q=bounds(p);return Math.abs(o.x-p.x)<(b.w+q.w)/2+.06&&Math.abs(o.z-p.z)<(b.d+q.d)/2+.06;});}
  function remember(){cancelDrag();history.push(clone(state));if(history.length>30)history.shift();}
  function dirty(){return JSON.stringify(state)!==JSON.stringify(saved);}
  function disable(control,condition){control.dataset.ipgDisabled=condition?'1':'0';control.disabled=busy||condition;}
  function syncSelection(){
   stage.dataset.layout=JSON.stringify(state);stage.dataset.selectedId=selected==null?'':String(selected);
   const o=selectedObject();selection.visible=editable&&!!o&&!busy;
   const signature=JSON.stringify(state.objects.map(row=>[row.id,row.type]));
   if(placedSignature!==signature){
    placedSignature=signature;placedSelect.replaceChildren();const totals=new Map(),counts=new Map();
    for(const row of state.objects)totals.set(row.type,(totals.get(row.type)||0)+1);
    const prompt=doc.createElement('option');prompt.value='';prompt.textContent='家具を選んでください';placedSelect.appendChild(prompt);
    for(const row of state.objects){const option=doc.createElement('option'),n=(counts.get(row.type)||0)+1;counts.set(row.type,n);option.value=String(row.id);option.textContent=definitions[row.type].label+(totals.get(row.type)>1?' '+n:'');placedSelect.appendChild(option);}
   }
   placedSelect.value=o?String(o.id):'';disable(placedSelect,!state.objects.length);

   actions.querySelectorAll('[data-move],[data-action="rotate"],[data-action="remove"]').forEach(b=>{disable(b,!o);});
   disable(actions.querySelector('[data-action="undo"]'),!history.length);
   disable(top.querySelector('[data-action="restore"]'),!dirty());disable(top.querySelector('[data-action="save"]'),false);
   root.querySelectorAll('[data-furniture],[data-surface],[data-category],[data-camera]').forEach(b=>{disable(b,false);});
   root.querySelectorAll('[data-furniture]').forEach(b=>disable(b,!canAddType(b.dataset.furniture)));
   if(o){const b=bounds(o);selection.scale.set(b.w+.2,b.d+.2,1);selection.position.set(o.x,.075,o.z);}
  }
  refreshControls=syncSelection;
  // The returned coordinates are stage-local CSS pixels and mark the pet's feet.
  function projectPet(){
   if(!isCurrent()||typeof opts.onProjectPet!=='function')return;
   const candidates=[[-2,2],[-1.5,2.5],[-2.5,1.5],[0,2.5],[1.5,2.5],[2.5,2],[-.5,1.5],[0,0]];
   function clear(x,z){return !state.objects.some(o=>{if(definitions[o.type].flat)return false;const b=bounds(o);return Math.abs(o.x-x)<b.w/2+.38&&Math.abs(o.z-z)<b.d/2+.38;});}
   const anchor=candidates.find(p=>clear(p[0],p[1]))||candidates[0];
   const p=new THREE.Vector3(anchor[0],.03,anchor[1]).project(camera),width=stage.clientWidth,height=stage.clientHeight;
   if(width<=0||height<=0)return;
   const unit=new THREE.Vector3(anchor[0],1.5,anchor[1]).project(camera);
   const scale=Math.max(.45,Math.min(1.2,Math.abs(unit.y-p.y)*height/2/150));
   try{opts.onProjectPet({left:(p.x+1)*width/2,top:(1-p.y)*height/2,scale});}catch(_){}
  }
  function render(){if(!renderer||!isCurrent())return;renderer.render(scene,camera);projectPet();}
  function drawObjects(){
   for(const g of objectGroups.values()){disposeGroup(g);objectLayer.remove(g);}objectGroups.clear();
   for(const o of state.objects){const g=definitions[o.type].build();g.position.set(o.x,0,o.z);g.rotation.y=o.r*Math.PI/2;g.traverse(x=>{x.userData.itemId=o.id;});objectLayer.add(g);objectGroups.set(o.id,g);}
   syncSelection();render();
  }
  function resize(){
   if(!renderer||!isCurrent())return;cancelDrag();const width=stage.clientWidth,height=stage.clientHeight;if(width<=0||height<=0)return;
   renderer.setSize(width,height,false);const aspect=width/height,v=11.8/Math.min(1.08,aspect);camera.left=-v*aspect/2;camera.right=v*aspect/2;camera.top=v/2;camera.bottom=-v/2;
   if(cameraMode==='top'){camera.position.set(.01,18,8);camera.lookAt(0,0,.3);}else{camera.position.set(11,11,14);camera.lookAt(0,.8,0);}camera.updateProjectionMatrix();render();
  }
  function applyState(next){cancelDrag();state=clone(next);if(!state.objects.some(o=>o.id===selected))selected=(state.objects[0]||{}).id;wallTexture=wallPattern(state.wall);floorTexture=texture(state.floor);wallMat.map=wallTexture;floorMat.map=floorTexture;wallMat.needsUpdate=floorMat.needsUpdate=true;drawObjects();if(editable)catalog();}
  function moveTo(x,z,saveHistory=true,owner=null){
   if(!canEdit())return false;if(drag&&owner!==drag)cancelDrag();const o=selectedObject();if(!o||!Number.isFinite(x)||!Number.isFinite(z))return false;
   const nx=Math.round(x*2)/2,nz=Math.round(z*2)/2;if(nx===o.x&&nz===o.z)return true;const next={...o,x:nx,z:nz};if(!valid(next)){announce('ここには置けません。空いている床を選んでください。');return false;}
   if(saveHistory)remember();o.x=nx;o.z=nz;objectGroups.get(o.id).position.set(nx,0,nz);syncSelection();render();if(saveHistory)emitDraft();announce(definitions[o.type].label+'を動かしました。');return true;
  }
  function select(id){if(!canEdit())return;cancelDrag();selected=id;syncSelection();render();}
  function eventRay(e){
   const rect=canvas.getBoundingClientRect();if(!Number.isFinite(rect.width)||!Number.isFinite(rect.height)||rect.width<=0||rect.height<=0||!Number.isFinite(e.clientX)||!Number.isFinite(e.clientY))return null;
   pointer.set((e.clientX-rect.left)/rect.width*2-1,-((e.clientY-rect.top)/rect.height)*2+1);ray.setFromCamera(pointer,camera);const point=ray.ray.intersectPlane(ground,planePoint);return point&&Number.isFinite(point.x)&&Number.isFinite(point.z)?point:null;
  }
  function sameDrag(d){return state===d.state&&selected===d.id&&state.objects.find(o=>o.id===d.id)===d.object;}
  // Assigned here so lifecycle methods defined before the asynchronous import can cancel safely.
  finishDrag=function(commit,e){
   if(!drag||(e&&e.pointerId!==drag.pointerId))return;const d=drag,owned=sameDrag(d);drag=null;canvas.classList.remove('room-dragging');
   try{if(typeof canvas.releasePointerCapture==='function'&&(!canvas.hasPointerCapture||canvas.hasPointerCapture(d.pointerId)))canvas.releasePointerCapture(d.pointerId);}catch(_){}
   if(!owned)return;const changed=JSON.stringify(state)!==JSON.stringify(d.before);
   if(commit&&changed&&isCurrent()){history.push(d.before);if(history.length>30)history.shift();syncSelection();emitDraft();}
   else if(!commit&&changed){applyState(d.before);announce('家具の移動を取り消しました。');}
  };
  function startDrag(e){
   if(!canEdit()||drag||e.isPrimary===false||e.button!==0)return;const point=eventRay(e);if(!point)return;
   const hit=ray.intersectObjects(objectLayer.children,true).find(h=>state.objects.some(o=>o.id===h.object.userData.itemId));if(!hit)return;select(hit.object.userData.itemId);const o=selectedObject();if(!o)return;
   drag={pointerId:e.pointerId,id:o.id,object:o,state,startX:e.clientX,startY:e.clientY,offsetX:o.x-point.x,offsetZ:o.z-point.z,before:clone(state),moved:false};canvas.classList.add('room-dragging');try{canvas.focus({preventScroll:true});canvas.setPointerCapture(e.pointerId);}catch(_){}if(e.cancelable)e.preventDefault();
  }
  function moveDrag(e){
   const d=drag;if(!d||e.pointerId!==d.pointerId)return;if(!canEdit()||!sameDrag(d)){finishDrag(false,e);return;}
   if(Math.hypot(e.clientX-d.startX,e.clientY-d.startY)<4&&!d.moved)return;const point=eventRay(e);if(!point)return;
   const oldX=d.object.x,oldZ=d.object.z;if(moveTo(point.x+d.offsetX,point.z+d.offsetZ,false,d)&&(oldX!==d.object.x||oldZ!==d.object.z))d.moved=true;if(e.cancelable)e.preventDefault();
  }
  function releaseDrag(e){if(!drag||e.pointerId!==drag.pointerId)return;moveDrag(e);finishDrag(true,e);}
  function addFurniture(key){
   if(!canAddType(key))return;
   if(!canEdit()||!catalogTypes.some(row=>row.id===key))return;if(state.objects.length>=24){announce('家具がいっぱいです。いったんしまってから置いてください。');return;}
   const next={id:state.nextId,type:key,x:0,z:0,r:0};let spot=null;for(let z=2.5;z>=-3.5&&!spot;z-=.5)for(let x=-3;x<=3;x+=.5){const test={...next,x,z};if(valid(test)){spot=test;break;}}
   if(!spot){announce('空いている場所がありません。家具をしまうか動かしてください。');return;}remember();state.objects.push(spot);state.nextId++;selected=spot.id;drawObjects();emitDraft();announce(definitions[key].label+'を置きました。');
  }
  function makeThumbnail(key){
   if(thumbnailCache.has(key))return thumbnailCache.get(key);
   const ts=new THREE.Scene();ts.add(new THREE.HemisphereLight(0xfff9e9,0xc4b196,1.8));const light=new THREE.DirectionalLight(0xfff0d2,2.1);light.position.set(-3,7,5);ts.add(light);
   const g=definitions[key].build();ts.add(g);const tc=new THREE.OrthographicCamera(-1.65,1.65,1.45,-1.25,.1,30);tc.position.set(5,4.5,6);tc.lookAt(0,key==='rug'?0:.8,0);
   const oldRatio=renderer.getPixelRatio(),oldSize=renderer.getSize(new THREE.Vector2());
   try{renderer.setPixelRatio(1);renderer.setSize(136,112,false);renderer.render(ts,tc);const url=canvas.toDataURL('image/png');thumbnailCache.set(key,url);return url;}
   finally{disposeGroup(g);renderer.setPixelRatio(oldRatio);renderer.setSize(oldSize.x,oldSize.y,false);}
  }
  function catalog(){
   catalogEl.replaceChildren();tabs.querySelectorAll('[data-category]').forEach(b=>{b.setAttribute('aria-selected',String(b.dataset.category===category));b.tabIndex=b.dataset.category===category?0:-1;});catalogEl.setAttribute('aria-labelledby',id+'-'+category);
   if(category==='furniture')for(const row of catalogTypes){const b=doc.createElement('button');b.type='button';b.dataset.furniture=row.id;b.setAttribute('aria-label',definitions[row.id].label+'をお部屋に置く');const img=doc.createElement('img');img.className='room-thumb';img.src=makeThumbnail(row.id);img.alt='';b.append(img,doc.createTextNode(definitions[row.id].label));catalogEl.appendChild(b);}
   else for(const row of category==='wall'?wallOptions:floorOptions){const b=doc.createElement('button');b.type='button';b.dataset.surface=row.key;b.setAttribute('aria-pressed',String(state[category]===row.key));const sw=doc.createElement('span');sw.className='room-swatch';if(!swatches.has(row.key))swatches.set(row.key,texture(row.key).image.toDataURL('image/png'));sw.style.backgroundImage='url('+swatches.get(row.key)+')';sw.style.backgroundSize='cover';b.append(sw,doc.createTextNode(row.label));catalogEl.appendChild(b);}
   syncSelection();render();
  }
  function changeSurface(kind,key){
   if(!canEdit()||state[kind]===key)return;const list=kind==='wall'?wallOptions:floorOptions;if(!list.some(row=>row.key===key))return;remember();state[kind]=key;
   if(kind==='wall'){wallTexture=wallPattern(key);wallMat.map=wallTexture;wallMat.needsUpdate=true;}else{floorTexture=texture(key);floorMat.map=floorTexture;floorMat.needsUpdate=true;}catalog();render();emitDraft();announce((kind==='wall'?'壁紙':'床')+'を変えました。');
  }
  async function saveLayout(){
   if(!canEdit()||typeof opts.onSave!=='function')return;cancelDrag();setBusy(true);
   try{const result=await opts.onSave(clone(state));if(!isCurrent())return;if(result&&result.ok===true){saved=clone(state);history=[];announce('配置を保存しました。');}else announce(result&&typeof result.message==='string'?result.message.slice(0,160):'配置を保存できませんでした。もう一度お試しください。');}
   catch(_){if(isCurrent())announce('配置を保存できませんでした。もう一度お試しください。');}
   finally{if(isCurrent())setBusy(false);}
  }
  function rootClick(e){
   const button=e.target&&e.target.closest?e.target.closest('button'):null;if(!button||!root.contains(button)||button.disabled)return;
   if(button.dataset.camera){if(!isCurrent()||busy)return;cancelDrag();cameraMode=button.dataset.camera;view.querySelectorAll('[data-camera]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));resize();return;}
   if(!canEdit())return;cancelDrag();
   if(button.dataset.category){category=button.dataset.category;catalog();return;}
   if(button.dataset.furniture){addFurniture(button.dataset.furniture);return;}
   if(button.dataset.surface){changeSurface(category,button.dataset.surface);return;}
   if(button.dataset.move){const o=selectedObject();if(o){const delta={left:[-.5,0],right:[.5,0],back:[0,-.5],front:[0,.5]}[button.dataset.move];moveTo(o.x+delta[0],o.z+delta[1]);}return;}
   const action=button.dataset.action,o=selectedObject();
   if(action==='rotate'&&o){const next={...o,r:(o.r+1)%4};if(!valid(next)){announce('回すためのすき間がありません。少し動かしてから試してください。');return;}remember();o.r=next.r;objectGroups.get(o.id).rotation.y=o.r*Math.PI/2;syncSelection();render();emitDraft();announce(definitions[o.type].label+'の向きを変えました。');}
   else if(action==='remove'&&o){remember();const label=definitions[o.type].label;state.objects=state.objects.filter(row=>row.id!==o.id);selected=null;drawObjects();emitDraft();announce(label+'をしまいました。');}
   else if(action==='undo'&&history.length){applyState(history.pop());emitDraft();announce('ひとつ前の配置に戻しました。');}
   else if(action==='restore'&&dirty()){remember();applyState(saved);emitDraft();announce('保存した配置に戻しました。');}
   else if(action==='save')saveLayout();
  }
  listen(root,'click',cancelDrag,true);listen(root,'click',rootClick);
  if(editable)listen(placedSelect,'change',()=>{if(!canEdit())return;const next=Number(placedSelect.value);if(state.objects.some(o=>o.id===next))select(next);else{selected=null;syncSelection();render();}});
  if(editable){
   listen(canvas,'pointerdown',startDrag);listen(canvas,'pointermove',moveDrag);listen(canvas,'pointerup',releaseDrag);listen(canvas,'pointercancel',e=>finishDrag(false,e));listen(canvas,'lostpointercapture',e=>finishDrag(false,e));
   listen(win,'pointermove',e=>{if(e.target!==canvas)moveDrag(e);});listen(win,'pointerup',releaseDrag);listen(win,'pointercancel',e=>finishDrag(false,e));listen(win,'blur',cancelDrag);listen(win,'pagehide',cancelDrag);
   listen(doc,'visibilitychange',()=>{if(doc.hidden)cancelDrag();});listen(win,'pointerout',e=>{if(e.relatedTarget===null)finishDrag(false,e);});
   listen(root,'keydown',e=>{
    if(!isCurrent()||e.isComposing||e.altKey||e.ctrlKey||e.metaKey)return;
    if(e.key==='Escape'){if(drag){cancelDrag();e.preventDefault();return;}if(!busy&&typeof opts.onCancel==='function'){e.preventDefault();opts.onCancel();}return;}
    const target=e.target;if(target===canvas&&canEdit()){const d={ArrowLeft:[-.5,0],ArrowRight:[.5,0],ArrowUp:[0,-.5],ArrowDown:[0,.5]}[e.key],o=selectedObject();if(d&&o){e.preventDefault();moveTo(o.x+d[0],o.z+d[1]);}}
    if(target&&target.dataset&&target.dataset.category&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const all=Array.from(tabs.querySelectorAll('[data-category]')),i=all.indexOf(target),next=e.key==='Home'?0:e.key==='End'?all.length-1:(i+(e.key==='ArrowRight'?1:-1)+all.length)%all.length;if(!busy){category=all[next].dataset.category;catalog();all[next].focus();}}
   });
  }
  listen(canvas,'webglcontextlost',e=>{e.preventDefault();fail('room_context_lost');});
  if(typeof win.ResizeObserver==='function'){resizeObserver=new win.ResizeObserver(resize);resizeObserver.observe(stage);}else listen(win,'resize',resize);
  drawObjects();if(editable)catalog();resize();loading.hidden=true;root.dataset.ready='true';
 }catch(_){if(isCurrent())fail('room_renderer_init_failed');else destroy();}
 return failed||disposed?null:controller;
 // This binding deliberately lives across the import boundary for early destroy.
 var finishDrag;
}
global.PetCozyRoom=Object.freeze({mount:mount});
})(window);
