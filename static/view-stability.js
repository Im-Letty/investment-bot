/* Keep local view changes from moving the page that contains them. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports={create:factory};
  if(root&&root.document)root.KNViewStability=factory(root);
})(typeof window==='undefined'?null:window,function(w){
  'use strict';
  var doc=w.document,active=null;
  function capture(trigger){
    var scrolls=[],node=trigger;
    while(node&&node!==doc.documentElement){
      var style=w.getComputedStyle(node);
      if(node.id==='morning-section'||/auto|scroll|hidden/.test(style.overflowY)&&node.scrollHeight>node.clientHeight)
        scrolls.push({node:node,top:node.scrollTop,left:node.scrollLeft});
      node=node.parentElement;
    }
    var x=w.scrollX||0,y=w.scrollY||0;
    return {scrolls:scrolls,restore:function(){
      if((w.scrollX||0)!==x||(w.scrollY||0)!==y)w.scrollTo({left:x,top:y,behavior:'instant'});
      scrolls.forEach(function(item){if(item.node.isConnected!==false)item.node.scrollTo({top:item.top,left:item.left,behavior:'instant'});});
    }};
  }
  function reserve(root,snapshot,disclosure){
    var surface=root.querySelector('.kn-stock-surface'),owner=snapshot.scrolls[0];
    if(!surface||!owner)return;
    var viewport=owner.node.getBoundingClientRect(),paper=surface.getBoundingClientRect();
    // Reserve only the visible remainder, never the full height of the old list.
    // Keep this floor after the change; removing it immediately would clamp again.
    // A disclosure can be deep inside the paper: include the content above it
    // so closing the last details does not pull the page back to its new end.
    var limit=disclosure?paper.height:owner.node.clientHeight;
    var height=Math.max(0,Math.min(limit,viewport.top+owner.node.clientHeight-paper.top));
    surface.style.setProperty('--kn-view-min-height',Math.ceil(height)+'px');
  }
  function hold(root,options){
    if(active)active.cancel();
    var saved=options&&options.snapshot||capture(root),finished=false,cancelled=false;
    var styles=saved.scrolls.map(function(item){
      var node=item.node,previous=node.style.overflowAnchor;
      node.style.overflowAnchor='none';return {node:node,previous:previous};
    });
    if(options&&options.reserve)reserve(root,saved,options.disclosure);
    function finish(){
      if(finished)return;finished=true;
      styles.forEach(function(item){item.node.style.overflowAnchor=item.previous;});
      ['wheel','touchmove','pointerdown','keydown'].forEach(function(type){doc.removeEventListener(type,intent,true);});
      if(active===transaction)active=null;
    }
    function intent(event){
      if(event.type==='keydown'&&!['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key))return;
      cancelled=true;finish();
    }
    var transaction={cancel:function(){cancelled=true;finish();}};active=transaction;
    ['wheel','touchmove','pointerdown','keydown'].forEach(function(type){doc.addEventListener(type,intent,{capture:true,passive:true});});
    // Two frames cover the immediate layout and queued view decorations.
    // A wheel/touch/key gesture cancels this, so it cannot undo deliberate scrolling.
    w.requestAnimationFrame(function(){
      if(cancelled)return;saved.restore();
      w.requestAnimationFrame(function(){if(!cancelled)saved.restore();finish();});
    });
    return saved;
  }
  doc.addEventListener('click',function(event){
    var target=event.target&&event.target.closest?event.target:null;if(!target||target.closest('dialog'))return;
    var stock=target.closest('#knTabWrap');
    if(stock&&target.closest('[data-kn-tab],[data-divsub],.kn-stock-home,.dc-filter,.dc-month-arrow,.dc-day,[data-rank-setting],summary')){
      hold(stock,{reserve:true,disclosure:!!target.closest('summary')});return;
    }
    var summary=target.closest('summary'),news=summary&&summary.closest('#knNewsDigest,#knCompanyNewsSection');
    if(news)hold(news);
  },true);
  return {capture:capture,hold:hold};
});
