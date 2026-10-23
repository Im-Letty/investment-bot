/* A read-only view of the saved village economy. No rewards, time or storage here. */
(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./pet-town-walk.js'));
  else root.PetVillageEconomyScene=factory(root.PetTownWalk);
}(typeof window!=='undefined'?window:this,function(Town){
  'use strict';
  function finite(n){return typeof n==='number'&&Number.isFinite(n);}
  function clean(rows){return Array.isArray(rows)?rows.filter(function(p){return p&&typeof p.id==='string'&&typeof p.name==='string';}):[];}
  function valid(world,x,y){return Town&&typeof Town.isWalkable==='function'&&Town.isWalkable(world,x,y);}
  function slots(world,view){
    if(!world||!finite(world.width)||!finite(world.height)||!Array.isArray(world.places))return [];
    var reserved=[],sites=[];
    // Fixed bounded candidates; saved building positions, water and approaches remain authoritative.
    var candidates=[[43,65],[62,49],[33,89],[39,48],[55,19],[18,43],[59,77],[79,43],[13,84],[84,17],[39,12],[15,16]];
    for(var gy=18;gy<=84;gy+=11)for(var gx=13;gx<=79;gx+=11)candidates.push([gx,gy]);
    clean(view&&view.shops).slice(0,3).forEach(function(shop){
      var found=null;
      for(var i=0;i<candidates.length;i++){
        var x=candidates[i][0]/100*world.width,y=candidates[i][1]/100*world.height;
        if(!valid(world,x,y+90)||!valid(world,x-110,y-75)||!valid(world,x+110,y-75)||!valid(world,x,y-165))continue;
        if(world.places.some(function(p){return Math.hypot(p.x-x,p.y-y)<360;})||reserved.some(function(p){return Math.hypot(p.x-x,p.y-y)<360;}))continue;
        found={id:'economy-'+shop.id,label:shop.name,x:x,y:y,entrance:{x:x,y:y+90},footprint:{x:x,y:y-48,rx:94,ry:66},shopId:shop.id,status:['open','building'].indexOf(shop.status)>=0?shop.status:'funding'};
        break;
      }
      if(found){reserved.push(found);sites.push(found);}
    });
    return sites;
  }
  function personPoint(world,place,index){
    if(!place)return null;
    var offsets=[[180,170],[-180,170],[210,100],[-210,100],[0,250],[100,250],[-100,250]];
    for(var i=0;i<offsets.length;i++){
      var row=offsets[(i+index)%offsets.length],p={x:place.x+row[0],y:place.y+row[1]};
      if(valid(world,p.x,p.y))return p;
    }
    return null;
  }
  function mount(options){
    options=options||{};
    var surface=options.worldElement,world=options.world,doc=surface&&surface.ownerDocument;
    var nodes=[],added=[],disposed=false,view=options.view||{};
    function allowed(){if(disposed||!surface||surface.isConnected===false)return false;try{return typeof options.canRun!=='function'||!!options.canRun();}catch(_){return false;}}
    function create(tag,cls,text){var el=doc.createElement(tag);el.className=cls;if(text!==undefined)el.textContent=text;return el;}
    function append(el,x,y){el.style.left=x+'px';el.style.top=y+'px';el.style.zIndex=String(Math.round(y));surface.appendChild(el);nodes.push(el);}
    if(!doc||!allowed()||!world||!Array.isArray(world.places))return {dispose:function(){disposed=true;}};
    var original=world.places.slice();
    slots(world,view).forEach(function(site){
      var el=create('div','pve-scene-project');el.dataset.shopId=site.shopId;el.dataset.status=site.status;
      el.setAttribute('role','img');el.setAttribute('aria-label',site.label+(site.status==='open'?'・開店しました':site.status==='building'?'・建設中':'・みんなで建設資金を募集中'));
      if(site.status==='open'){
        var image=create('img','pve-scene-building');image.src='/static/pet-village-art/'+(site.shopId==='cafe'?'cafe.webp':'shop.webp');image.alt='';image.draggable=false;image.decoding='async';
        image.addEventListener('error',function(){image.hidden=true;el.className+=' pve-scene-no-art';});el.appendChild(image);
      }else el.appendChild(create('span','pve-scene-foundation',site.status==='building'?'建設中':'建設予定地'));
      el.appendChild(create('strong','pve-scene-shop-name',site.label));
      append(el,site.x,site.y);world.places.push(site);added.push(site);
    });
    var residents=clean(view.residents).slice(0,6),visitors=clean(view.visitors).slice(0,3);
    residents.concat(visitors).forEach(function(p,index){
      var visitor=index>=residents.length;
      var id=visitor?'cafe':index%2?'shop':'home',place=original.filter(function(row){return row.id===id;})[0];
      var point=personPoint(world,place,index);if(!point)return;
      var el=create('div','pve-scene-person');el.dataset.personId=p.id;el.dataset.visitor=String(visitor);
      el.setAttribute('role','img');el.setAttribute('aria-label',p.name+(visitor?'・遊びに来たお客さん':'・村の住人'));
      var image=create('img','pve-scene-person-art');image.src='/static/pet_lilac_reference_v2.png';image.alt='';image.draggable=false;image.decoding='async';
      image.addEventListener('error',function(){image.hidden=true;});
      el.appendChild(image);el.appendChild(create('span','pve-scene-person-tag',p.name+' · '+(visitor?'旅人':'住人')));
      append(el,point.x,point.y);
    });
    function visibility(){nodes.forEach(function(el){el.dataset.paused=String(!!doc.hidden||!allowed());});}
    doc.addEventListener('visibilitychange',visibility);visibility();
    return {dispose:function(){
      if(disposed)return;disposed=true;doc.removeEventListener('visibilitychange',visibility);
      nodes.forEach(function(el){if(el.parentNode)el.parentNode.removeChild(el);});
      added.forEach(function(site){var i=world.places.indexOf(site);if(i>=0)world.places.splice(i,1);});nodes=[];added=[];
    }};
  }
  return Object.freeze({mount:mount,projectSites:slots});
}));
