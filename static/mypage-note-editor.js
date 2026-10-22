/* Small, local-only note editor. Persist data and text, never editable HTML. */
(function(root,factory){
  'use strict';
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.KNMyPageNoteEditor=api;
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  var sequence=0,types=['paragraph','heading','bullet','check'],marks=['bold','italic','underline'];
  function id(){return 'nb'+Date.now().toString(36)+(++sequence).toString(36);}
  function clone(x){return JSON.parse(JSON.stringify(x));}
  function runText(block){return block.runs.map(function(r){return r.text;}).join('');}
  function project(model){return model.blocks.map(function(b){return runText(b)+b.break;}).join('');}
  function plain(text){
    var blocks=[],at=0,match,re=/\r\n|\r|\n/g;
    while((match=re.exec(text))){blocks.push({id:id(),type:'paragraph',runs:[{text:text.slice(at,match.index)}],break:match[0]});at=match.index+match[0].length;}
    blocks.push({id:id(),type:'paragraph',runs:[{text:text.slice(at)}],break:''});
    return {version:1,blocks:blocks};
  }
  function valid(model,body){
    if(!model||model.version!==1||!Array.isArray(model.blocks)||!model.blocks.length||model.blocks.length>20000)return false;
    var used=Object.create(null),runs=0,total=0;
    for(var i=0;i<model.blocks.length;i++){
      var b=model.blocks[i];
      if(!b||typeof b.id!=='string'||!b.id||used[b.id]||types.indexOf(b.type)<0||!Array.isArray(b.runs)||!b.runs.length)return false;
      used[b.id]=true;if(b.type==='check'&&typeof b.checked!=='boolean'||b.checked!==undefined&&typeof b.checked!=='boolean')return false;
      if(i===model.blocks.length-1?b.break!=='':['\n','\r','\r\n'].indexOf(b.break)<0)return false;
      for(var j=0;j<b.runs.length;j++){
        var r=b.runs[j];if(!r||typeof r.text!=='string'||marks.some(function(k){return r[k]!==undefined&&typeof r[k]!=='boolean';}))return false;
        total+=r.text.length;runs++;if(runs>100000||total>1000000)return false;
      }
    }
    return typeof body!=='string'||project(model)===body;
  }
  function shape(model){return JSON.stringify(model.blocks.map(function(b){var copy=Object.assign({},b);delete copy.id;return copy;}));}
  function fromNote(note){
    if(note.richText===undefined)return {model:plain(note.body),supported:true};
    return valid(note.richText,note.body)?{model:clone(note.richText),supported:true}:{model:plain(note.body),supported:false};
  }
  function positions(model){var at=0;return model.blocks.map(function(b){var p={block:b,start:at,end:at+runText(b).length};at=p.end+b.break.length;return p;});}
  function clampPoint(text,point,end){
    point=Math.max(0,Math.min(text.length,Number.isFinite(point)?point:0));
    if(point>0&&point<text.length&&/[\uD800-\uDBFF]/.test(text[point-1])&&/[\uDC00-\uDFFF]/.test(text[point]))point+=end?1:-1;
    return point;
  }
  function range(model,selection){var text=project(model),a=clampPoint(text,selection&&selection.start,false),b=clampPoint(text,selection&&selection.end,true);return {start:Math.min(a,b),end:Math.max(a,b)};}
  function selectedBlocks(model,selection){
    var r=range(model,selection),ps=positions(model);
    if(r.start===r.end){var found=ps.findIndex(function(p,i){return r.start<=p.end||i===ps.length-1;});return [found];}
    var result=[];ps.forEach(function(p,i){if(p.start<r.end&&p.end>=r.start)result.push(i);});return result;
  }
  function restKey(run){var x={};Object.keys(run).sort().forEach(function(k){if(k!=='text')x[k]=run[k];});return JSON.stringify(x);}
  function mergeRuns(runs){
    var out=[];runs.forEach(function(r){var copy=Object.assign({},r);if(!copy.text&&runs.length>1)return;var last=out[out.length-1];if(last&&restKey(last)===restKey(copy))last.text+=copy.text;else out.push(copy);});return out.length?out:[{text:''}];
  }
  function sliceRuns(runs,start,end){
    var out=[],at=0;runs.forEach(function(r){var next=at+r.text.length;if(next>start&&at<end)out.push(Object.assign({},r,{text:r.text.slice(Math.max(0,start-at),Math.max(0,end-at))}));at=next;});return mergeRuns(out);
  }
  function inline(model,selection,mark){
    if(marks.indexOf(mark)<0)throw Error('note_mark');
    var next=clone(model),r=range(model,selection),ps=positions(model),chosen=selectedBlocks(model,r),collapsed=r.start===r.end;
    var applicable=[];
    chosen.forEach(function(i){var p=ps[i],at=p.start;p.block.runs.forEach(function(run){var end=at+run.text.length;if(collapsed||end>r.start&&at<r.end)applicable.push(run);at=end;});});
    var turnOn=!applicable.length||!applicable.every(function(run){return run[mark]===true;});
    chosen.forEach(function(i){
      var p=ps[i],at=p.start,parts=[];
      next.blocks[i].runs.forEach(function(run){
        var end=at+run.text.length,a=collapsed?at:Math.max(at,r.start),b=collapsed?end:Math.min(end,r.end);
        if(b>a||collapsed&&run.text===''){
          if(a>at)parts.push(Object.assign({},run,{text:run.text.slice(0,a-at)}));
          var middle=Object.assign({},run,{text:run.text.slice(a-at,b-at)});if(turnOn)middle[mark]=true;else delete middle[mark];parts.push(middle);
          if(b<end)parts.push(Object.assign({},run,{text:run.text.slice(b-at)}));
        }else parts.push(run);at=end;
      });next.blocks[i].runs=mergeRuns(parts);
    });return next;
  }
  function blockType(model,selection,type){
    if(types.indexOf(type)<0)throw Error('note_block');var next=clone(model),chosen=selectedBlocks(model,selection),same=type!=='paragraph'&&chosen.every(function(i){return model.blocks[i].type===type;});
    chosen.forEach(function(i){var b=next.blocks[i];b.type=same?'paragraph':type;if(b.type==='check')b.checked=!!b.checked;else delete b.checked;});return next;
  }
  function check(model,blockId,value){var next=clone(model),b=next.blocks.find(function(x){return x.id===blockId&&x.type==='check';});if(!b)return next;b.checked=!!value;return next;}
  function eol(model){return model.blocks.find(function(b){return b.break;})?.break||'\n';}
  function point(model,offset){var ps=positions(model);for(var i=0;i<ps.length;i++){if(offset<=ps[i].end||i===ps.length-1)return {index:i,offset:Math.min(offset-ps[i].start,ps[i].end-ps[i].start)};}return {index:0,offset:0};}
  function replace(model,selection,text){
    var r=range(model,selection),a=point(model,r.start),b=point(model,r.end),first=model.blocks[a.index],last=model.blocks[b.index],prefix=sliceRuns(first.runs,0,a.offset),suffix=sliceRuns(last.runs,b.offset,runText(last).length),flags={};
    var cursor=0,source=first.runs[0];first.runs.forEach(function(run){if(cursor<=a.offset)source=run;cursor+=run.text.length;});marks.forEach(function(k){if(source[k])flags[k]=true;});
    var inserted=plain(text).blocks,rows=[];
    inserted.forEach(function(p,i){var base=i===0?Object.assign({},first):{id:id(),type:first.type==='heading'?'paragraph':first.type};var content=[];if(i===0)content=content.concat(prefix);content.push(Object.assign({},flags,{text:runText(p)}));if(i===inserted.length-1)content=content.concat(suffix);base.runs=mergeRuns(content);base.break=i===inserted.length-1?last.break:p.break;if(base.type==='check')base.checked=i===0?!!first.checked:false;else delete base.checked;rows.push(base);});
    var next=clone(model);next.blocks=next.blocks.slice(0,a.index).concat(rows,next.blocks.slice(b.index+1));next.blocks.forEach(function(row,i){if(i===next.blocks.length-1)row.break='';else if(!row.break)row.break=eol(model);});
    return {model:next,selection:{start:r.start+text.length,end:r.start+text.length}};
  }
  function children(node){return Array.prototype.slice.call(node.childNodes||node.children||[]);}
  function tag(node){return String(node.tagName||'').toUpperCase();}
  function attr(node,key){return node&&node.getAttribute?node.getAttribute(key):null;}
  function contains(root,node){while(node){if(node===root)return true;node=node.parentNode;}return false;}
  function ignored(node){return ['INPUT','BUTTON','SCRIPT','STYLE','IFRAME','OBJECT','EMBED','IMG','SVG','CANVAS','VIDEO','AUDIO'].indexOf(tag(node))>=0||attr(node,'data-note-control')==='true';}
  function scanBlock(node){
    var runs=[],points=new Map(),at=0,blockTags=['DIV','P','LI','H1','H2','H3','H4','H5','H6'];
    function add(text,flags){if(text){runs.push(Object.assign({},flags,{text:text}));at+=text.length;}}
    function walk(n,flags,isRoot){
      var start=at,kids=children(n),bounds=[at];
      if(n.nodeType===3){add(String(n.nodeValue===undefined?n.textContent:n.nodeValue),flags);points.set(n,{start:start,end:at,bounds:null});return;}
      if(ignored(n)){points.set(n,{start:at,end:at,bounds:kids.map(function(){return at;}).concat(at)});return;}
      var own=Object.assign({},flags),name=tag(n);if(name==='B'||name==='STRONG')own.bold=true;if(name==='I'||name==='EM')own.italic=true;if(name==='U')own.underline=true;
      if(name==='BR'){var siblings=children(n.parentNode);if(siblings.length>1&&siblings[siblings.length-1]!==n)add('\n',own);points.set(n,{start:start,end:at,bounds:[at]});return;}
      kids.forEach(function(child,i){
        var isBlock=blockTags.indexOf(tag(child))>=0;
        if(isBlock&&i>0&&at>start&&runs.length&&!runs[runs.length-1].text.endsWith('\n'))add('\n',own);
        walk(child,own,false);
        if(isBlock&&i<kids.length-1&&at>start&&runs.length&&!runs[runs.length-1].text.endsWith('\n'))add('\n',own);
        bounds.push(at);
      });points.set(n,{start:start,end:at,bounds:bounds});
    }
    walk(node,{},true);return {runs:mergeRuns(runs),points:points};
  }
  function scan(host,previous){
    var old=Object.create(null),used=Object.create(null),records=[],model={version:1,blocks:[]},at=0,rootBounds=[0];previous.blocks.forEach(function(b){old[b.id]=b;});
    var nodes=children(host);if(!nodes.length)nodes=[null];
    nodes.forEach(function(node,i){
      var found=node&&old[attr(node,'data-note-block')],blockId=found&&!used[found.id]?found.id:id();used[blockId]=true;
      var info=node?scanBlock(node):{runs:[{text:''}],points:new Map()},type=found?found.type:'paragraph',row=Object.assign({},found||{},{id:blockId,type:type,runs:info.runs,break:i===nodes.length-1?'':found&&found.break||eol(previous)});
      if(type==='check')row.checked=!!(found&&found.checked);else delete row.checked;
      model.blocks.push(row);records.push({node:node,at:at,info:info});at+=runText(row).length+row.break.length;rootBounds.push(at);
    });
    return {model:model,records:records,rootBounds:rootBounds};
  }
  function selectionFrom(host,w,previous,fallback){
    var selection=w.getSelection&&w.getSelection();if(!selection||!contains(host,selection.anchorNode)||!contains(host,selection.focusNode))return fallback||{start:0,end:0};
    var data=scan(host,previous);
    function offset(node,index){
      if(node===host)return data.rootBounds[Math.min(index,data.rootBounds.length-1)];
      for(var i=0;i<data.records.length;i++){var record=data.records[i],p=record.info.points.get(node);if(p)return record.at+(p.bounds?p.bounds[Math.min(index,p.bounds.length-1)]:Math.min(p.end,p.start+index));}
      return 0;
    }
    var a=offset(selection.anchorNode,selection.anchorOffset),b=offset(selection.focusNode,selection.focusOffset);return {start:Math.min(a,b),end:Math.max(a,b)};
  }
  function restoreSelection(host,w,model,selection){
    if(!w.getSelection||!w.document.createRange)return;var wanted=range(model,selection),ps=positions(model),nodes=children(host);
    function endpoint(offset){
      var p=point(model,offset),block=nodes[p.index],remaining=p.offset,answer=null;
      function walk(node){if(answer||ignored(node))return;if(node.nodeType===3){var length=String(node.nodeValue===undefined?node.textContent:node.nodeValue).length;if(remaining<=length)answer={node:node,offset:remaining};else remaining-=length;return;}children(node).forEach(walk);}
      if(block)walk(block);return answer||{node:block||host,offset:0};
    }
    try{var a=endpoint(wanted.start),b=endpoint(wanted.end),r=w.document.createRange();r.setStart(a.node,a.offset);r.setEnd(b.node,b.offset);var s=w.getSelection();s.removeAllRanges();s.addRange(r);}catch(ignore){}
  }
  function render(host,w,model,onCheck){
    host.replaceChildren();model.blocks.forEach(function(b){
      var line=w.document.createElement('div');line.className='mp-note-line mp-note-line-'+b.type;line.setAttribute('data-note-block',b.id);
      if(b.type==='check'){
        var box=w.document.createElement('input');box.type='checkbox';box.checked=!!b.checked;box.className='mp-note-check';box.setAttribute('contenteditable','false');box.setAttribute('data-note-control','true');box.setAttribute('aria-label',(b.checked?'完了を取り消す：':'完了にする：')+(runText(b)||'空のチェック項目'));box.addEventListener('change',function(){onCheck(b.id,box.checked,box);});line.appendChild(box);line.classList.toggle('mp-note-checked',!!b.checked);
      }
      var text=w.document.createElement('span');text.className='mp-note-line-text';
      b.runs.forEach(function(run){var parent=text;[['bold','strong'],['italic','em'],['underline','u']].forEach(function(pair){if(run[pair[0]]){var wrap=w.document.createElement(pair[1]);parent.appendChild(wrap);parent=wrap;}});parent.appendChild(w.document.createTextNode(run.text));});line.appendChild(text);host.appendChild(line);
    });
  }
  function canMount(w){return !!(w&&w.document&&w.document.createTextNode&&w.document.createRange&&w.getSelection);}
  function create(w,options){
    var d=w.document,host=options.host,key='',model=plain(''),supported=true,editable=false,composing=false,bookmark=null,past=[],future=[],compositionSnapshot=null,buttons=[],lastBefore=null,destroyed=false;
    var toolbar=d.createElement('div');toolbar.className='mp-note-formatbar';toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label','メモの書式');
    var notice=d.createElement('p');notice.className='mp-note-editor-notice';notice.hidden=true;notice.setAttribute('role','status');
    host.className='mp-note-rich';host.setAttribute('role','textbox');host.setAttribute('aria-label','自由メモ');host.setAttribute('aria-multiline','true');host.setAttribute('spellcheck','true');
    function readable(){return !destroyed&&!!key&&(!options.canRead||options.canRead(key));}
    function allowed(){return readable()&&editable&&supported&&(!options.canEdit||options.canEdit(key));}
    function saveBookmark(){if(readable())bookmark=selectionFrom(host,w,model,bookmark);}
    function trimHistory(){while(past.length>50||past.length&&JSON.stringify(past).length>2000000)past.shift();}
    function push(snapshot){past.push(snapshot||{model:clone(model),selection:bookmark||{start:0,end:0}});trimHistory();future=[];}
    function update(){
      var can=allowed();host.contentEditable=can?'true':'false';host.setAttribute('aria-readonly',String(!can));
      buttons.forEach(function(item){item.node.disabled=!can||composing||(item.action==='undo'&&!past.length)||(item.action==='redo'&&!future.length);var chosen=selectedBlocks(model,bookmark||{start:0,end:0}),active=false;
        if(marks.indexOf(item.action)>=0)active=chosen.every(function(i){return model.blocks[i].runs.every(function(run){return run[item.action]===true;});});
        else if(types.indexOf(item.action)>=0)active=chosen.every(function(i){return model.blocks[i].type===item.action;});
        if(item.toggle)item.node.setAttribute('aria-pressed',String(active));
      });host.querySelectorAll('input').forEach(function(box){box.disabled=!can||composing;});
    }
    function redraw(selection){var renderKey=key;render(host,w,model,function(blockId,value,box){if(renderKey!==key||!allowed()||composing){box.checked=!!(model.blocks.find(function(b){return b.id===blockId;})||{}).checked;return;}saveBookmark();change(check(model,blockId,value),bookmark,true,true);});if(selection)restoreSelection(host,w,model,selection);update();}
    function change(next,selection,remember,paint){
      if(!allowed()||composing||!valid(next)){if(!readable())clear();return false;}
      if(JSON.stringify(next)===JSON.stringify(model)){update();return true;}
      var previous=clone(model),oldBookmark=bookmark;
      if(remember)push();model=next;bookmark=selection||bookmark;
      if(options.onChange&&options.onChange(clone(model),project(model),key)===false){model=previous;bookmark=oldBookmark;if(!readable())clear();else redraw(bookmark);return false;}
      if(paint)redraw(bookmark);else update();return true;
    }
    function apply(action){
      if(!allowed()||composing)return;saveBookmark();var selected=bookmark||{start:0,end:0};
      if(action==='undo'||action==='redo'){history(action);return;}
      var next=marks.indexOf(action)>=0?inline(model,selected,action):blockType(model,selected,action);change(next,selected,true,true);host.focus();restoreSelection(host,w,model,selected);
    }
    function history(action){
      if(!allowed()||composing)return;var source=action==='undo'?past:future,target=action==='undo'?future:past;if(!source.length)return;
      var snapshot=source.pop();target.push({model:clone(model),selection:bookmark||{start:0,end:0}});var previous=model;model=clone(snapshot.model);bookmark=snapshot.selection;
      if(options.onChange&&options.onChange(clone(model),project(model),key)===false){model=previous;if(!readable())clear();else redraw();return;}redraw(bookmark);host.focus();restoreSelection(host,w,model,bookmark);
    }
    function insert(text){if(!allowed()||composing)return;saveBookmark();var result=replace(model,bookmark||{start:0,end:0},text);change(result.model,result.selection,true,true);host.focus();restoreSelection(host,w,model,result.selection);}
    [['bold','B','太字'],['italic','I','斜体'],['underline','U','下線'],['heading','見出し','見出し'],['bullet','箇条書き','箇条書き'],['check','チェック','チェックリスト'],['undo','↶','元に戻す'],['redo','↷','やり直す']].forEach(function(item){
      var button=d.createElement('button');button.type='button';button.className='mp-note-format';button.textContent=item[1];button.setAttribute('aria-label',item[2]);var toggle=item[0]!=='undo'&&item[0]!=='redo';if(toggle)button.setAttribute('aria-pressed','false');button.addEventListener('mousedown',function(e){saveBookmark();e.preventDefault();});button.addEventListener('click',function(){apply(item[0]);});toolbar.appendChild(button);buttons.push({node:button,action:item[0],toggle:toggle});
    });
    ['keyup','mouseup','touchend','focus','blur'].forEach(function(name){host.addEventListener(name,function(){saveBookmark();update();});});
    function trackSelection(){if(readable()){saveBookmark();update();}}
    if(d.addEventListener)d.addEventListener('selectionchange',trackSelection);
    host.addEventListener('keydown',function(e){
      if(!(e.ctrlKey||e.metaKey)||e.altKey)return;var k=String(e.key||'').toLowerCase();
      if(['b','i','u','z','y'].indexOf(k)>=0){e.preventDefault();if(k==='z')apply(e.shiftKey?'redo':'undo');else if(k==='y')apply('redo');else apply({b:'bold',i:'italic',u:'underline'}[k]);}
    });
    host.addEventListener('compositionstart',function(){if(!allowed())return;saveBookmark();composing=true;compositionSnapshot={model:clone(model),selection:bookmark||{start:0,end:0}};update();});
    host.addEventListener('compositionend',function(){
      if(!composing)return;composing=false;
      if(!readable()){clear();return;}
      if(allowed()){
        var next=scan(host,model).model,previous=clone(model),previousBookmark=bookmark;
        if(!valid(next)){redraw(bookmark);compositionSnapshot=null;return;}
        if(compositionSnapshot&&JSON.stringify(compositionSnapshot.model)!==JSON.stringify(next)){past.push(compositionSnapshot);trimHistory();future=[];}
        model=next;bookmark=selectionFrom(host,w,model,bookmark);
        if(options.onChange&&options.onChange(clone(model),project(model),key)===false){model=previous;bookmark=previousBookmark;if(!readable())clear();else redraw(bookmark);}
      }else redraw(bookmark);
      compositionSnapshot=null;update();
    });
    host.addEventListener('beforeinput',function(e){
      if(!readable()||!allowed()){e.preventDefault();if(!readable())clear();return;}saveBookmark();lastBefore=bookmark;
      if(composing||e.isComposing)return;
      var type=e.inputType||'';
      if(type==='historyUndo'||type==='historyRedo'){e.preventDefault();history(type==='historyUndo'?'undo':'redo');return;}
      var action={formatBold:'bold',formatItalic:'italic',formatUnderline:'underline',insertUnorderedList:'bullet'}[type];if(action){e.preventDefault();apply(action);return;}
      if(type==='insertParagraph'||type==='insertLineBreak'){
        e.preventDefault();var chosen=selectedBlocks(model,bookmark),b=model.blocks[chosen[0]];
        if(type==='insertParagraph'&&(b.type==='check'||b.type==='bullet')&&!runText(b)){change(blockType(model,bookmark,'paragraph'),bookmark,true,true);return;}
        insert(eol(model));
      }
    });
    host.addEventListener('input',function(e){
      if(!readable()){clear();return;}if(!allowed()){redraw(bookmark);return;}
      if(!composing&&(e.inputType==='historyUndo'||e.inputType==='historyRedo')){redraw(bookmark);history(e.inputType==='historyUndo'?'undo':'redo');return;}
      var next=scan(host,model).model,selected=selectionFrom(host,w,model,bookmark);if(!valid(next)){if(!composing)redraw(bookmark);return;}
      if(JSON.stringify(next)===JSON.stringify(model)){bookmark=selected;return;}
      if(!composing){past.push({model:clone(model),selection:lastBefore||bookmark||{start:0,end:0}});trimHistory();future=[];}
      var previous=clone(model),previousBookmark=bookmark;model=next;bookmark=selected;lastBefore=null;
      if(options.onChange&&options.onChange(clone(model),project(model),key)===false){model=previous;bookmark=previousBookmark;if(!readable())clear();else if(!composing)redraw(bookmark);}update();
    });
    host.addEventListener('paste',function(e){e.preventDefault();if(!allowed()||composing)return;var text=e.clipboardData&&e.clipboardData.getData('text/plain');if(typeof text==='string'&&text)insert(text);});
    host.addEventListener('drop',function(e){e.preventDefault();if(!allowed()||composing)return;var text=e.dataTransfer&&e.dataTransfer.getData('text/plain');if(typeof text==='string'&&text)insert(text);});
    function clear(){
      key='';editable=false;supported=true;composing=false;bookmark=null;past=[];future=[];compositionSnapshot=null;lastBefore=null;model=plain('');notice.textContent='';notice.hidden=true;
      var s=w.getSelection&&w.getSelection();if(s&&contains(host,s.anchorNode)&&s.removeAllRanges)s.removeAllRanges();redraw();
    }
    function load(note,nextKey,ok){
      if(destroyed)return false;var data=fromNote(note);if(nextKey===key&&supported===data.supported&&project(model)===note.body&&shape(data.model)===shape(model)){editable=!!ok;update();return;}
      key=nextKey;model=data.model;supported=data.supported;editable=!!ok;composing=false;bookmark=null;past=[];future=[];compositionSnapshot=null;lastBefore=null;notice.hidden=supported;notice.textContent=supported?'':'このメモの装飾はこの画面では編集できません。本文を表示しています。';redraw();
    }
    clear();return {toolbar:toolbar,notice:notice,load:load,clear:clear,destroy:function(){destroyed=true;clear();if(d.removeEventListener)d.removeEventListener('selectionchange',trackSelection);},setEditable:function(ok){editable=!!ok;update();},focus:function(){host.focus();},getModel:function(){return clone(model);},getText:function(){return project(model);}};
  }
  return Object.freeze({plain:plain,valid:valid,fromNote:fromNote,project:project,positions:positions,range:range,selectedBlocks:selectedBlocks,inline:inline,blockType:blockType,check:check,replace:replace,scan:scan,selectionFrom:selectionFrom,restoreSelection:restoreSelection,render:render,canMount:canMount,create:create});
});
