const {test}=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('../static/view-stability.js');

// Model scroll bounds and frame scheduling, rather than accepting arbitrary
// offsets: a short replacement view really would clamp the old position.
function harness({scrollTop=800,viewport=600,surfaceOffset=1000}={}){
  const listeners=new Map(),frames=[],windowMoves=[],elementMoves=[];
  function style(values={}){
    return {overflowAnchor:'',overflowY:'visible',...values,
      setProperty(name,value){this[name]=value;},
      getPropertyValue(name){return this[name]||'';}};
  }
  function node({id='',tag='DIV',classes=[],parent=null,height=600,content=2400,overflow='visible',anchor=''}={}){
    let top=0,left=0;
    const n={id,tagName:tag,parentElement:parent,children:[],isConnected:true,
      style:style({overflowY:overflow,overflowAnchor:anchor}),clientHeight:height,
      attrs:new Set(),scrollHeight:content,
      get scrollTop(){return top;},set scrollTop(value){top=Math.max(0,Math.min(value,this.scrollHeight-this.clientHeight));},
      get scrollLeft(){return left;},set scrollLeft(value){left=value;},
      scrollTo(options){elementMoves.push({node:this,...options});this.scrollTop=options.top;this.scrollLeft=options.left;},
      matches(selector){return selector.startsWith('#')?this.id===selector.slice(1):selector.startsWith('.')?classes.includes(selector.slice(1)):selector.startsWith('[')?this.attrs.has(selector.slice(1,-1)):this.tagName.toLowerCase()===selector;},
      closest(selectors){for(let current=this;current;current=current.parentElement)if(selectors.split(',').some(selector=>current.matches(selector.trim())))return current;return null;},
      querySelector(selector){for(const child of this.children){if(child.matches(selector))return child;const found=child.querySelector(selector);if(found)return found;}return null;},
      getBoundingClientRect(){return {top:0,height:this.clientHeight};},
      reflow(){this.scrollTop=this.scrollTop;}};
    if(parent)parent.children.push(n);
    return n;
  }
  const html=node({tag:'HTML'}),body=node({tag:'BODY',parent:html});
  const home=node({id:'morning-section',parent:body,height:viewport,overflow:'auto',anchor:'auto'});
  const stock=node({id:'knTabWrap',parent:home});
  const surface=node({classes:['kn-stock-surface'],parent:stock});
  const flow={height:1800};
  surface.getBoundingClientRect=()=>({top:surfaceOffset-home.scrollTop,height:Math.max(flow.height,parseFloat(surface.style.getPropertyValue('--kn-view-min-height'))||0)});
  Object.defineProperty(home,'scrollHeight',{get(){return surfaceOffset+surface.getBoundingClientRect().height;}});
  home.scrollTop=scrollTop;
  const document={documentElement:html,body,
    addEventListener(type,listener){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(listener);},
    removeEventListener(type,listener){listeners.get(type)?.delete(listener);}};
  const window={document,scrollX:12,scrollY:345,
    getComputedStyle:n=>({overflowY:n.style.overflowY}),
    scrollTo(options){windowMoves.push(options);this.scrollX=options.left;this.scrollY=options.top;},
    requestAnimationFrame(fn){frames.push(fn);}};
  const stability=create(window);
  return {window,document,home,stock,surface,flow,node,stability,windowMoves,elementMoves,
    frame(){const current=frames.splice(0);current.forEach(fn=>fn());},
    dispatch(type,event={}){for(const listener of [...(listeners.get(type)||[])])listener({type,...event});},
    listenerCount(type){return listeners.get(type)?.size||0;},
    pendingFrames(){return frames.length;}};
}

test('capture restores the window and every nested scroll owner, including the fixed morning view',()=>{
  const h=harness(),inner=h.node({parent:h.stock,overflow:'auto',height:280,content:1200});
  const button=h.node({tag:'BUTTON',parent:inner});
  inner.scrollTop=175;inner.scrollLeft=29;h.home.scrollLeft=7;
  const saved=h.stability.capture(button);
  assert.deepEqual(saved.scrolls.map(item=>item.node),[inner,h.home]);
  inner.scrollTop=410;inner.scrollLeft=3;h.home.scrollTop=930;h.home.scrollLeft=18;
  h.window.scrollX=40;h.window.scrollY=500;saved.restore();
  assert.equal(inner.scrollTop,175);assert.equal(inner.scrollLeft,29);
  assert.equal(h.home.scrollTop,800);assert.equal(h.home.scrollLeft,7);
  assert.equal(h.window.scrollX,12);assert.equal(h.window.scrollY,345);
  assert.ok(h.elementMoves.every(move=>move.behavior==='instant'));
  assert.deepEqual(h.windowMoves,[{left:12,top:345,behavior:'instant'}]);
  saved.restore();assert.equal(h.windowMoves.length,1,'an unchanged window is not scrolled again');
});

test('capture still includes a currently short morning view and skips a detached nested owner',()=>{
  const h=harness();h.flow.height=20;h.home.clientHeight=h.home.scrollHeight;
  const inner=h.node({parent:h.stock,overflow:'auto',height:100,content:400});
  const saved=h.stability.capture(inner);
  assert.deepEqual(saved.scrolls.map(item=>item.node),[inner,h.home]);
  inner.scrollTop=80;inner.isConnected=false;saved.restore();
  assert.equal(inner.scrollTop,80,'a removed pane must not receive restoration writes');
  assert.equal(h.elementMoves.some(move=>move.node===inner),false);
});

test('a long calendar replaced by a short panel keeps the heading position with only the visible remainder reserved',()=>{
  const unprotected=harness();
  const saved=unprotected.stability.capture(unprotected.stock);
  unprotected.flow.height=80;unprotected.home.reflow();saved.restore();
  assert.equal(unprotected.home.scrollTop,480,'browser scroll bounds prevent restoring without room below');

  const h=harness(),before=h.surface.getBoundingClientRect().top;
  h.stability.hold(h.stock,{reserve:true});
  assert.equal(h.surface.style.getPropertyValue('--kn-view-min-height'),'400px');
  h.flow.height=80;h.home.reflow();h.frame();h.frame();
  assert.equal(h.home.scrollTop,800);
  assert.equal(h.surface.getBoundingClientRect().top,before,'the visible heading remains at its prior screen position');
  assert.equal(h.surface.getBoundingClientRect().height,400,'the old 1800px list height is not retained');
  assert.equal(h.home.style.overflowAnchor,'auto');
});

test('the reserved floor never exceeds one viewport and adds nothing for a surface below it',()=>{
  for(const [scrollTop,expected]of [[1500,'600px'],[800,'400px'],[0,'0px']]){
    const h=harness({scrollTop});h.stability.hold(h.stock,{reserve:true});
    assert.equal(h.surface.style.getPropertyValue('--kn-view-min-height'),expected);
    assert.ok(parseFloat(expected)<=h.home.clientHeight);
    h.frame();h.frame();
  }
});

test('collapsing a disclosure deep inside a stock panel preserves its visible position without retaining the whole expanded panel',()=>{
  const normal=harness({scrollTop:1500});
  normal.stability.hold(normal.stock,{reserve:true});
  assert.equal(normal.surface.style.getPropertyValue('--kn-view-min-height'),'600px');
  normal.flow.height=600;normal.home.reflow();normal.frame();normal.frame();
  assert.equal(normal.home.scrollTop,1000,'a normal tab floor remains one viewport and does not retain a deep panel offset');

  const h=harness({scrollTop:1500}),before=h.surface.getBoundingClientRect().top;
  h.stability.hold(h.stock,{reserve:true,disclosure:true});
  assert.equal(h.surface.style.getPropertyValue('--kn-view-min-height'),'1100px');
  h.flow.height=600;h.home.reflow();h.frame();h.frame();
  assert.equal(h.home.scrollTop,1500);
  assert.equal(h.surface.getBoundingClientRect().top,before);
  assert.equal(h.surface.getBoundingClientRect().height,1100,'only the height down to the visible viewport bottom is retained, rather than all 1800px');
  assert.equal(h.home.style.overflowAnchor,'auto');
});

test('a stock summary click selects disclosure preservation even without a tab-control attribute',()=>{
  const h=harness({scrollTop:1500}),summary=h.node({tag:'SUMMARY',parent:h.surface});
  h.dispatch('click',{target:summary});
  assert.equal(h.pendingFrames(),1);
  assert.equal(h.surface.style.getPropertyValue('--kn-view-min-height'),'1100px');
  h.flow.height=600;h.home.reflow();h.frame();h.frame();
  assert.equal(h.home.scrollTop,1500);
  assert.equal(h.listenerCount('wheel'),0);
});

test('hold corrects layout movement on each of two frames and then removes its transient listeners',()=>{
  const h=harness();h.home.style.overflowAnchor='';
  h.stability.hold(h.stock);
  assert.equal(h.home.style.overflowAnchor,'none');
  h.home.scrollTop=970;h.window.scrollY=450;
  assert.equal(h.home.scrollTop,970,'the correction waits for layout rather than writing during the click');
  h.frame();assert.equal(h.home.scrollTop,800);assert.equal(h.window.scrollY,345);
  assert.equal(h.home.style.overflowAnchor,'none');
  h.home.scrollTop=880;h.frame();
  assert.equal(h.home.scrollTop,800);assert.equal(h.home.style.overflowAnchor,'');
  assert.equal(h.pendingFrames(),0);
  for(const type of ['wheel','touchmove','pointerdown','keydown'])assert.equal(h.listenerCount(type),0);
  assert.equal(h.listenerCount('click'),1,'the permanent click integration remains installed');
});

for(const [type,extra]of [['wheel',{}],['touchmove',{}],['pointerdown',{}],...['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].map(key=>['keydown',{key}])]){
  test(`${type}${extra.key?' '+JSON.stringify(extra.key):''} cancels a hold so it cannot undo intentional scrolling`,()=>{
    const h=harness();h.stability.hold(h.stock);
    h.frame();h.dispatch(type,extra);h.home.scrollTop=940;h.window.scrollY=470;h.frame();
    assert.equal(h.home.scrollTop,940);assert.equal(h.window.scrollY,470);
    assert.equal(h.home.style.overflowAnchor,'auto');
    assert.equal(h.listenerCount('keydown'),0);
  });
}

test('typing and activation keys do not discard the pending layout correction',()=>{
  const h=harness();h.stability.hold(h.stock);
  for(const key of ['n','Enter','Tab','Escape'])h.dispatch('keydown',{key});
  h.home.scrollTop=940;h.frame();h.frame();
  assert.equal(h.home.scrollTop,800);assert.equal(h.home.style.overflowAnchor,'auto');
});

test('successive holds supersede old frames and restore the original scroll-anchor styles',()=>{
  const h=harness();h.home.style.overflowAnchor='';
  h.stability.hold(h.stock);
  h.home.scrollTop=910;
  h.stability.hold(h.stock);
  assert.equal(h.home.style.overflowAnchor,'none');
  h.home.scrollTop=1000;h.frame();
  assert.equal(h.home.scrollTop,910,'a cancelled earlier frame must not restore the earlier 800px position');
  h.frame();assert.equal(h.home.scrollTop,910);assert.equal(h.home.style.overflowAnchor,'');
  assert.equal(h.listenerCount('wheel'),0);
});

test('closing a modal uses its opening snapshot through both frames instead of recapturing the moved background',()=>{
  const h=harness(),inner=h.node({parent:h.stock,overflow:'auto',height:280,content:1200});
  const button=h.node({tag:'BUTTON',parent:inner});inner.scrollTop=175;
  const opening=h.stability.capture(button);
  // Native dialog focus or viewport changes can move the background while open.
  h.home.scrollTop=920;inner.scrollTop=310;h.window.scrollY=510;
  const retained=h.stability.hold(h.stock,{snapshot:opening});
  assert.equal(retained,opening,'the caller-supplied opening snapshot is authoritative');
  opening.restore();
  assert.equal(h.home.scrollTop,800);assert.equal(inner.scrollTop,175);
  h.frame();
  assert.equal(h.home.scrollTop,800,'the first frame must not put back the 920px position seen at close');
  assert.equal(inner.scrollTop,175);assert.equal(h.window.scrollY,345);
  h.home.scrollTop=950;inner.scrollTop=360;h.window.scrollY=530;h.frame();
  assert.equal(h.home.scrollTop,800);assert.equal(inner.scrollTop,175);
  assert.equal(h.window.scrollY,345);assert.equal(h.home.style.overflowAnchor,'auto');
  assert.equal(inner.style.overflowAnchor,'');
});

test('delegated stock controls reserve space, while modal and unrelated clicks do not start a hold',()=>{
  const h=harness(),button=h.node({tag:'BUTTON',parent:h.stock});button.attrs.add('data-kn-tab');
  h.dispatch('click',{target:button});assert.equal(h.pendingFrames(),1);
  assert.equal(h.surface.style.getPropertyValue('--kn-view-min-height'),'400px');h.frame();h.frame();
  const dialog=h.node({tag:'DIALOG',parent:h.stock}),modalButton=h.node({tag:'BUTTON',parent:dialog});modalButton.attrs.add('data-kn-tab');
  h.dispatch('click',{target:modalButton});assert.equal(h.pendingFrames(),0);
  h.dispatch('click',{target:h.node({tag:'BUTTON',parent:h.document.body})});assert.equal(h.pendingFrames(),0);
});

test('news expansion preserves its containing morning scroll without reserving stock-panel space',()=>{
  const h=harness(),news=h.node({id:'knNewsDigest',parent:h.home}),summary=h.node({tag:'SUMMARY',parent:news});
  h.dispatch('click',{target:summary});h.home.scrollTop=910;h.frame();h.frame();
  assert.equal(h.home.scrollTop,800);assert.equal(h.surface.style.getPropertyValue('--kn-view-min-height'),'');
});
