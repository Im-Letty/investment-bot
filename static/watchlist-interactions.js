/* Favorite-row hearts and deliberate long-press sorting share StockWatch's durable queue. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root&&root.document)root.KNWatchInteractions=api.create(root);
})(typeof window==='undefined'?null:window,function(){
  'use strict';
  const HOLD_MS=450, MOVE_TOLERANCE=9;
  function create(w){
    const doc=w.document,removing=new Set(),listeners=[];
    let gesture=null,mode=null,saving=false,queued=false,message='',suppress=false,disposed=false,observer=null,frame=null,lastRefresh=Promise.resolve();
    const section=()=>doc.getElementById('knWatchSec');
    const rows=()=>{const s=section();return s?Array.from(s.querySelectorAll('[data-watch-symbol]')):[];};
    const store=()=>w.StockWatch&&w.StockWatch.storeFor?w.StockWatch.storeFor(w):null;
    const busy=()=>!!gesture||!!mode||saving||removing.size>0;
    const visible=()=>{
      const s=section(),wrap=doc.getElementById('knTabWrap');
      return !doc.hidden&&!!s&&(!wrap||wrap.dataset.stockMain==='favorites')&&s.getClientRects().length>0;
    };
    const closest=(target,selector)=>target&&target.closest?target.closest(selector):null;
    const rowFor=target=>{const row=closest(target,'[data-watch-symbol]'),s=section();return row&&s&&s.contains(row)?row:null;};
    function listen(target,type,callback,options){target.addEventListener(type,callback,options);listeners.push([target,type,callback,options]);}
    function textNode(tag,className,text){const n=doc.createElement(tag);n.className=className;n.textContent=text;return n;}
    function announce(text){message=text;decorate();}
    function decorate(){
      const s=section();if(!s||disposed)return;
      const list=doc.getElementById('knWatchList');if(list)list.setAttribute('role','list');
      let hint=doc.getElementById('knWatchReorderHint');
      if(!hint){hint=textNode('p','sf-sr-only','長押しして上下に動かすと並べ替えられます。キーボードでは行を選び、Altと上下キーで移動できます。');hint.id='knWatchReorderHint';s.appendChild(hint);}
      let status=doc.getElementById('knWatchActionStatus');
      if(!status){status=textNode('p','sf-watch-action-status','');status.id='knWatchActionStatus';status.setAttribute('role','status');status.setAttribute('aria-live','polite');s.appendChild(status);}
      if(status.textContent!==message)status.textContent=message;
      rows().forEach(row=>{
        const key=row.dataset.watchSymbol,button=row.querySelector('[data-watch-remove]');
        if(button){button.disabled=saving||removing.has(key);button.setAttribute('aria-busy',String(removing.has(key)));}
        row.querySelectorAll('[data-watch-move]').forEach(button=>{button.disabled=saving;});
      });
    }
    function canonicalOrder(){
      const saved=store();if(!saved)return;
      const current=rows(),byKey=new Map(current.map(row=>[row.dataset.watchSymbol,row])),box=doc.getElementById('knWatchList');
      if(box)for(const key of saved.list()){const row=byKey.get(key);if(row)box.appendChild(row);}
    }
    function notify(){
      if(disposed)return Promise.resolve();
      queued=false;
      try{lastRefresh=Promise.resolve(typeof w.__knRefreshWatch==='function'?w.__knRefreshWatch():undefined).catch(()=>{});}catch(_){lastRefresh=Promise.resolve();}
      return lastRefresh;
    }
    function flush(){if(queued&&!busy()&&!disposed)notify();}
    function removeControls(){
      for(const row of rows()){
        row.removeAttribute('data-watch-reordering');row.removeAttribute('data-watch-dragging');row.removeAttribute('aria-busy');
        const controls=row.querySelector('.sf-watch-move-controls');if(controls)controls.remove();
      }
    }
    function stopFrame(){if(frame!==null&&w.cancelAnimationFrame)w.cancelAnimationFrame(frame);frame=null;}
    function clearGesture(){
      const g=gesture;gesture=null;stopFrame();
      if(g){w.clearTimeout(g.timer);if(g.kind==='pointer'&&g.capture&&g.capture.releasePointerCapture)try{g.capture.releasePointerCapture(g.id);}catch(_){} }
      return g;
    }
    function cancelPending(){clearGesture();flush();}
    function finish(restore=true){
      clearGesture();mode=null;removeControls();if(restore)canonicalOrder();decorate();flush();
    }
    function controls(row){
      const bar=textNode('div','sf-watch-move-controls','');
      for(const [value,label] of [['up','上へ'],['down','下へ'],['done','完了']]){
        const button=textNode('button','',label);button.type='button';button.dataset.watchMove=value;button.setAttribute('aria-label',value==='done'?'並べ替えを終了':label+'移動');bar.appendChild(button);
      }
      row.appendChild(bar);
    }
    function activate(row){
      if(!visible()||!row.isConnected||!store()||!store().list().includes(row.dataset.watchSymbol))return false;
      if(mode&&mode.symbol!==row.dataset.watchSymbol)removeControls();
      mode={symbol:row.dataset.watchSymbol,row};row.setAttribute('data-watch-reordering','true');
      if(!row.querySelector('.sf-watch-move-controls'))controls(row);
      announce('並べ替え中です。上下に動かすか「上へ」「下へ」で移動できます。');
      return true;
    }
    function preview(y){
      if(!gesture||!gesture.active)return;
      const current=rows(),moving=gesture.row,box=doc.getElementById('knWatchList');if(!box||!box.contains(moving))return;
      const anchor=current.find(row=>row!==moving&&y<row.getBoundingClientRect().top+row.getBoundingClientRect().height/2);
      const before=anchor||null;
      if(moving.nextElementSibling!==before)box.insertBefore(moving,before);
    }
    function autoscroll(){
      if(frame!==null||!w.requestAnimationFrame)return;
      const tick=()=>{
        frame=null;const g=gesture;if(!g||!g.active||!visible())return;
        let parent=g.row.parentElement;
        while(parent&&parent!==doc.body){
          const style=w.getComputedStyle(parent);
          if(parent.scrollHeight>parent.clientHeight+1&&/(auto|scroll)/.test(style.overflowY))break;
          parent=parent.parentElement;
        }
        parent=parent&&parent!==doc.body?parent:doc.scrollingElement;
        if(parent){
          const rect=parent===doc.scrollingElement?{top:0,bottom:w.innerHeight}:parent.getBoundingClientRect();
          const edge=Math.min(48,(rect.bottom-rect.top)/4),direction=g.y<rect.top+edge?-1:g.y>rect.bottom-edge?1:0;
          if(direction){parent.scrollTop+=direction*9;preview(g.y);}
        }
        frame=w.requestAnimationFrame(tick);
      };
      frame=w.requestAnimationFrame(tick);
    }
    function begin(target,kind,id,x,y){
      suppress=false;
      if(saving||removing.size||!visible())return;
      if(gesture){finish();return;}
      const row=rowFor(target);
      if(mode&&(!row||mode.symbol!==row.dataset.watchSymbol))finish();
      if(!row||closest(target,'[data-watch-remove],.sf-watch-move-controls,input,textarea,select'))return;
      if(!Number.isFinite(x)||!Number.isFinite(y))return;
      const g={kind,id,row,symbol:row.dataset.watchSymbol,x,y,startX:x,startY:y,active:false,timer:null};gesture=g;
      const held=()=>{
        if(gesture!==g||!activate(row)){cancelPending();return;}
        g.active=true;suppress=true;row.setAttribute('data-watch-dragging','true');
        // Capture on the stationary list, since reparenting a captured row releases capture.
        g.capture=section();
        if(kind==='pointer'&&g.capture&&g.capture.setPointerCapture)try{g.capture.setPointerCapture(id);}catch(_){}
        autoscroll();
      };
      if(mode&&mode.symbol===g.symbol)held();else g.timer=w.setTimeout(held,HOLD_MS);
    }
    function move(kind,id,x,y,event){
      const g=gesture;if(!g||g.kind!==kind||g.id!==id)return;
      if(!Number.isFinite(x)||!Number.isFinite(y)){finish();return;}
      if(!visible()||!g.row.isConnected){finish();return;}
      if(!g.active){if(Math.hypot(x-g.startX,y-g.startY)>MOVE_TOLERANCE)cancelPending();return;}
      g.x=x;g.y=y;if(event.cancelable)event.preventDefault();preview(y);
    }
    async function commit(symbol,before,keepMode=false){
      const saved=store();if(!saved||saving)return;
      const focused=doc.activeElement,focusedRow=rowFor(focused),restoreFocus=focusedRow&&focusedRow.dataset.watchSymbol===symbol;
      saving=true;decorate();let ok=false;
      try{
        const result=await saved.move(symbol,before);
        ok=result.status==='moved'||result.status==='unchanged';
        announce(ok?'順番を保存しました。':'一覧が更新されたため、並べ替えをやり直してください。');
      }catch(_){announce('順番を保存できませんでした。もう一度お試しください。');}
      finally{
        saving=false;canonicalOrder();queued=true;
        if(!keepMode||!ok)finish(false);else{decorate();flush();}
        await lastRefresh;
        if(restoreFocus&&!disposed&&visible()&&!focused.isConnected&&(!doc.activeElement||doc.activeElement===focused||doc.activeElement===doc.body)){
          const next=rows().find(row=>row.dataset.watchSymbol===symbol);
          const target=next&&(closest(focused,'[data-watch-remove]')?next.querySelector('[data-watch-remove]'):next);
          if(target)target.focus({preventScroll:true});
        }
      }
    }
    function end(kind,id,event,x,y){
      const g=gesture;if(!g||g.kind!==kind||g.id!==id)return;
      if(Number.isFinite(x)&&Number.isFinite(y)){g.x=x;g.y=y;}
      else{finish();return;}
      if(g.active)preview(g.y);
      clearGesture();if(!g.active){flush();return;}
      suppress=true;g.row.removeAttribute('data-watch-dragging');
      const s=section(),rect=s&&s.getBoundingClientRect();
      if(!visible()||!g.row.isConnected||!rect||g.x<rect.left||g.x>rect.right||g.y<rect.top||g.y>rect.bottom){finish();return;}
      if(event.cancelable)event.preventDefault();
      const current=rows().map(row=>row.dataset.watchSymbol),canonical=store().list();
      if(JSON.stringify(current)===JSON.stringify(canonical)){decorate();return;}
      const index=current.indexOf(g.symbol);commit(g.symbol,current[index+1]||null);
    }
    async function remove(button){
      const key=button.dataset.watchRemove,saved=store();if(!saved||removing.has(key)||saving)return;
      finish();const index=saved.list().indexOf(key);removing.add(key);decorate();
      let success=false;
      try{await saved.remove(key);success=true;message='お気に入りから外しました。';}
      catch(_){message='解除できませんでした。もう一度お試しください。';}
      finally{removing.delete(key);decorate();}
      if(!success){flush();return;}
      await notify();if(disposed)return;decorate();
      const hearts=rows().map(row=>row.querySelector('[data-watch-remove]')).filter(Boolean);
      const focus=hearts[Math.max(0,Math.min(index,hearts.length-1))]||doc.getElementById('knWatchAddBtn');
      if(focus)focus.focus({preventScroll:true});
    }
    function step(row,direction){
      if(saving||gesture)return;
      const list=store()?store().list():[],key=row.dataset.watchSymbol,index=list.indexOf(key);
      if(index<0||direction<0&&index===0||direction>0&&index===list.length-1){announce('これ以上は移動できません。');return;}
      commit(key,direction<0?list[index-1]:list[index+2]||null,!!mode);
    }
    listen(doc,'pointerdown',e=>{
      if(e.pointerType==='touch')return;
      if(e.isPrimary===false||e.button!==0){if(gesture)finish();return;}
      begin(e.target,'pointer',e.pointerId,e.clientX,e.clientY);
    });
    listen(doc,'pointermove',e=>move('pointer',e.pointerId,e.clientX,e.clientY,e),{passive:false});
    listen(doc,'pointerup',e=>end('pointer',e.pointerId,e,e.clientX,e.clientY));
    listen(doc,'pointercancel',()=>{if(gesture&&gesture.kind==='pointer')finish();});
    listen(doc,'lostpointercapture',()=>{if(gesture&&gesture.kind==='pointer')finish();});
    listen(doc,'touchstart',e=>{
      if(e.touches.length!==1){if(gesture||mode)finish();return;}
      const t=e.touches[0];begin(e.target,'touch',t.identifier,t.clientX,t.clientY);
    },{passive:true});
    listen(doc,'touchmove',e=>{
      if(e.touches.length!==1){if(gesture||mode)finish();return;}
      const t=e.touches[0];move('touch',t.identifier,t.clientX,t.clientY,e);
    },{passive:false});
    listen(doc,'touchend',e=>{const g=gesture,t=g&&g.kind==='touch'&&Array.from(e.changedTouches).find(t=>t.identifier===g.id);if(t)end('touch',g.id,e,t.clientX,t.clientY);});
    listen(doc,'touchcancel',()=>{if(gesture||mode)finish();});
    listen(doc,'scroll',()=>{if(gesture&&!gesture.active)cancelPending();},true);
    listen(doc,'contextmenu',e=>{if((gesture&&gesture.active||mode)&&rowFor(e.target)){e.preventDefault();}});
    listen(doc,'click',e=>{
      if(suppress&&e.detail!==0&&section()&&section().contains(e.target)){suppress=false;e.preventDefault();e.stopImmediatePropagation();}
    },true);
    listen(doc,'click',e=>{
      const button=closest(e.target,'[data-watch-remove]');
      if(button&&rowFor(button)){e.preventDefault();e.stopPropagation();remove(button);return;}
      const action=closest(e.target,'[data-watch-move]'),row=action&&rowFor(action);
      if(!row)return;e.preventDefault();e.stopPropagation();
      if(action.dataset.watchMove==='done'){finish();announce('並べ替えを終了しました。');row.focus({preventScroll:true});}
      else step(row,action.dataset.watchMove==='up'?-1:1);
    });
    listen(doc,'keydown',e=>{
      const row=rowFor(e.target);if(!row||closest(e.target,'input,textarea,select'))return;
      if(e.key==='Escape'&&(mode||gesture)){e.preventDefault();finish();announce('並べ替えを終了しました。');row.focus({preventScroll:true});}
      else if(e.altKey&&(e.key==='ArrowUp'||e.key==='ArrowDown')){e.preventDefault();step(row,e.key==='ArrowUp'?-1:1);}
      else if(e.target===row&&(e.key===' '||e.key==='Enter')){e.preventDefault();suppress=false;if(mode)finish();else activate(row);}
    });
    const check=()=>{if((gesture||mode)&&(!visible()||gesture&&!rowFor(gesture.row)||mode&&!rowFor(mode.row)))finish();decorate();};
    listen(doc,'visibilitychange',check);listen(doc,'knStockViewChanged',check);
    if(w.addEventListener){listen(w,'blur',()=>{if(gesture||mode)finish();});listen(w,'storage',e=>{if(e.key==='alert_watchlist_v1'||e.key===null){queued=true;finish();}});}
    if(w.MutationObserver){observer=new w.MutationObserver(check);observer.observe(doc.body,{childList:true,subtree:true,attributes:true,attributeFilter:['style','hidden','class','data-stock-main']});}
    decorate();
    return {isBusy:busy,deferRefresh(){queued=true;},decorate,cancel:finish,
      destroy(){disposed=true;finish();if(observer)observer.disconnect();for(const [target,type,fn,options] of listeners)target.removeEventListener(type,fn,options);}
    };
  }
  return {create,HOLD_MS,MOVE_TOLERANCE};
});
