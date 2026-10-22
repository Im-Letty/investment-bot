'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../static/mypage-note-editor.js');
const text=model=>E.project(model);
const select=(start,end=start)=>({start,end});

test('plain notes retain exact UTF-16 text, whitespace and mixed newlines without mutating saved notes',()=>{
  for(const body of ['', '  先頭\r\n\r\n次\r末尾\n\t  ', '<script>文字</script> 😀', 'a\nb\n']){
    const note={body},before=JSON.stringify(note),data=E.fromNote(note);
    assert.equal(data.supported,true);assert.equal(text(data.model),body);assert.ok(E.valid(data.model,body));assert.equal(JSON.stringify(note),before);assert.equal(note.richText,undefined);
  }
});
test('known rich data restores only when its authoritative body matches exactly',()=>{
  const rich=E.inline(E.plain('そのまま\r\n保持'),select(0,4),'bold'),note={body:text(rich),richText:rich};
  const data=E.fromNote(note);assert.deepEqual(data.model,rich);data.model.blocks[0].runs[0].text='変更';assert.equal(note.richText.blocks[0].runs[0].text,'そのまま');
  const invalid=[{...rich,version:2},{...rich,blocks:[]},{...rich,blocks:[rich.blocks[0],rich.blocks[0]]}];
  for(const model of invalid){const n={body:'保存された本文',richText:model},before=JSON.stringify(n),out=E.fromNote(n);assert.equal(out.supported,false);assert.equal(text(out.model),n.body);assert.equal(JSON.stringify(n),before);}
  assert.equal(E.fromNote({body:'本文の変更',richText:rich}).supported,false);
});
test('validation rejects malformed marks, checks and breaks instead of saving editable HTML',()=>{
  const base=E.plain('a\nb');
  for(const mutate of [m=>m.blocks[0].runs[0].bold='true',m=>m.blocks[0].break='',m=>m.blocks[1].break='\n',m=>m.blocks[0].type='script',m=>{m.blocks[0].type='check';},m=>m.blocks[0].runs=[{text:null}]]){
    const next=JSON.parse(JSON.stringify(base));mutate(next);assert.equal(E.valid(next),false);
  }
});
test('selected inline formatting splits only the selected runs and preserves every body byte',()=>{
  const original=E.plain('Alpha beta\r\n日本語 😀');
  let model=E.inline(original,select(6,10),'bold');assert.equal(text(model),text(original));assert.deepEqual(model.blocks[0].runs,[{text:'Alpha '},{text:'beta',bold:true}]);
  model=E.inline(model,select(6,10),'italic');assert.equal(model.blocks[0].runs[1].italic,true);
  model=E.inline(model,select(6,10),'bold');assert.deepEqual(model.blocks[0].runs[1],{text:'beta',italic:true});assert.equal(original.blocks[0].runs.length,1);
});
test('formatting a partial surrogate pair covers its whole character and never breaks UTF-16',()=>{
  const model=E.inline(E.plain('a😀b'),select(2,3),'underline');assert.deepEqual(model.blocks[0].runs,[{text:'a'},{text:'😀',underline:true},{text:'b'}]);assert.equal(text(model),'a😀b');
});
test('paragraph and checklist commands preserve exact body bytes and checked metadata is independent',()=>{
  const original=E.plain('買う\r\n確認する');
  let model=E.blockType(original,select(0,100),'check');assert.ok(model.blocks.every(b=>b.type==='check'&&!b.checked));assert.equal(text(model),text(original));
  model=E.check(model,model.blocks[1].id,true);assert.equal(model.blocks[1].checked,true);assert.equal(model.blocks[0].checked,false);assert.equal(text(model),text(original));
  model=E.blockType(model,select(0,100),'check');assert.ok(model.blocks.every(b=>b.type==='paragraph'&&b.checked===undefined));assert.equal(text(model),text(original));
});
test('inserting or replacing literal text keeps surrounding formats and exact CRLF',()=>{
  const original=E.inline(E.plain('ABCD\r\n末尾'),select(0,4),'bold');
  const result=E.replace(original,select(1,3),'😀\r\n新しい');assert.equal(text(result.model),'A😀\r\n新しいD\r\n末尾');assert.ok(E.valid(result.model));assert.equal(result.selection.start,8);assert.equal(result.selection.end,8);assert.equal(original.blocks[0].runs[0].text,'ABCD');
});
test('Enter after a heading creates a normal paragraph and a checklist continues unchecked',()=>{
  let model=E.blockType(E.plain('見出し'),select(0),'heading');let result=E.replace(model,select(3),'\n');assert.deepEqual(result.model.blocks.map(b=>b.type),['heading','paragraph']);
  model=E.blockType(E.plain('買い物'),select(0),'check');model=E.check(model,model.blocks[0].id,true);result=E.replace(model,select(3),'\n次');assert.deepEqual(result.model.blocks.map(b=>b.checked),[true,false]);assert.equal(text(result.model),'買い物\n次');
});

// A local DOM fixture exercises contenteditable handlers. This is not Safari verification.
function surface(){
  let selection={anchorNode:null,anchorOffset:0,focusNode:null,focusOffset:0,removeAllRanges(){this.anchorNode=this.focusNode=null;},addRange(r){this.anchorNode=r.startContainer;this.anchorOffset=r.startOffset;this.focusNode=r.endContainer;this.focusOffset=r.endOffset;}};
  const documentEvents={};let focused;
  class Node{
    constructor(tag='div',value){this.nodeType=value===undefined?1:3;this.tagName=value===undefined?tag.toUpperCase():'';this.nodeValue=value;this.childNodes=[];this.parentNode=null;this.attrs={};this.events={};this._text='';this.className='';this.disabled=false;this.hidden=false;}
    get textContent(){return this.nodeType===3?this.nodeValue:this._text+this.childNodes.map(n=>n.textContent).join('');}
    set textContent(value){if(this.nodeType===3)this.nodeValue=String(value);else{this._text=String(value);this.replaceChildren();}}
    get classList(){return {toggle:(c,on)=>{const s=new Set(this.className.split(' ').filter(Boolean));if(on)s.add(c);else s.delete(c);this.className=[...s].join(' ');}};}
    setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return Object.hasOwn(this.attrs,k)?this.attrs[k]:null;}
    appendChild(n){n.parentNode=this;this.childNodes.push(n);return n;}
    replaceChildren(...nodes){this.childNodes.forEach(n=>n.parentNode=null);this.childNodes=[];nodes.forEach(n=>this.appendChild(n));}
    addEventListener(type,fn){(this.events[type]??=[]).push(fn);}
    dispatch(type,extra={}){const e={preventDefault(){this.defaultPrevented=true;},...extra};for(const fn of this.events[type]||[])fn(e);return e;}
    querySelectorAll(tag){const result=[];for(const c of this.childNodes){if(c.tagName===tag.toUpperCase())result.push(c);result.push(...c.querySelectorAll(tag));}return result;}
    focus(){focused=this;this.dispatch('focus');}
    click(){if(!this.disabled)this.dispatch('click');}
  }
  const w={document:{createElement:t=>new Node(t),createTextNode:v=>new Node('',v),createRange:()=>({setStart(n,i){this.startContainer=n;this.startOffset=i;},setEnd(n,i){this.endContainer=n;this.endOffset=i;}}),addEventListener:(type,fn)=>documentEvents[type]=fn},getSelection:()=>selection};
  const host=new Node(),changes=[];let key='A:1:n1',editable=true,reject=false;
  const editor=E.create(w,{host,canRead:k=>k===key,canEdit:k=>editable&&k===key,onChange(model,body,k){changes.push({model,body,key:k});return !reject;}});
  const firstText=(n=host)=>{if(n.nodeType===3)return n;for(const child of n.childNodes){const found=firstText(child);if(found)return found;}return null;};
  return {w,host,editor,changes,firstText,select(n,start,end=start){selection.anchorNode=selection.focusNode=n;selection.anchorOffset=start;selection.focusOffset=end;},load(body,richText){editor.load({body,...(richText?{richText}:{})},key,editable);},button(label){return editor.toolbar.childNodes.find(n=>n.getAttribute('aria-label')===label);},setKey(value){key=value;},setEditable(value){editable=value;editor.setEditable(value);},reject(value){reject=value;},get focused(){return focused;},Node};
}
test('restore renders safe text nodes and performs no writes or automatic rich migration',()=>{
  const h=surface(),body='  <img src=x onerror=bad()>\r\n\n末尾  ';h.load(body);assert.equal(h.editor.getText(),body);assert.equal(h.changes.length,0);assert.equal(h.host.querySelectorAll('img').length,0);assert.equal(h.host.contentEditable,'true');
  const node=h.firstText();h.select(node,2);h.load(body);assert.equal(h.firstText(),node,'an unchanged plain restore retains DOM and native selection');assert.equal(h.changes.length,0);
});
test('toolbar formats the selected rendered text without exposing Markdown markers',()=>{
  const h=surface();h.load('手元のメモ');h.select(h.firstText(),0,2);h.button('太字').dispatch('mousedown');h.button('太字').click();assert.equal(h.editor.getText(),'手元のメモ');assert.equal(h.host.querySelectorAll('strong')[0].textContent,'手元');assert.equal(h.changes.at(-1).body,'手元のメモ');assert.equal(h.button('太字').getAttribute('aria-pressed'),'false','mixed paragraph is not claimed to be entirely bold');
});
test('native typing stages each changed character and keeps the live composition DOM intact',()=>{
  const h=surface();h.load('下書き');const node=h.firstText();h.select(node,3);h.host.dispatch('compositionstart');node.nodeValue='下書きに';h.select(node,4);h.host.dispatch('input',{isComposing:true,inputType:'insertCompositionText'});assert.equal(h.firstText(),node);assert.equal(h.changes.at(-1).body,'下書きに');node.nodeValue='下書き日本語';h.select(node,6);h.host.dispatch('input',{isComposing:true,inputType:'insertCompositionText'});assert.equal(h.firstText(),node);h.host.dispatch('compositionend');assert.equal(h.firstText(),node);assert.equal(h.editor.getText(),'下書き日本語');h.button('元に戻す').click();assert.equal(h.editor.getText(),'下書き','one composed phrase undoes together');
});
test('plain clipboard text is inserted literally and HTML-only or file drops cannot create markup',()=>{
  const h=surface();h.load('前後');h.select(h.firstText(),1);const p=h.host.dispatch('paste',{clipboardData:{getData:type=>type==='text/plain'?'<script>文字</script>\n次':''}});assert.equal(p.defaultPrevented,true);assert.equal(h.editor.getText(),'前<script>文字</script>\n次後');assert.equal(h.host.querySelectorAll('script').length,0);
  const before=h.editor.getText(),count=h.changes.length;h.host.dispatch('drop',{dataTransfer:{getData:()=>''}});h.host.dispatch('paste',{clipboardData:{getData:type=>type==='text/html'?'<b>HTML only</b>':''}});assert.equal(h.editor.getText(),before);assert.equal(h.changes.length,count);
});
test('checklist completion saves metadata with the body unchanged and a native accessible checkbox',()=>{
  const h=surface();h.load('確認する');h.select(h.firstText(),0);h.button('チェックリスト').click();const box=h.host.querySelectorAll('input')[0];assert.equal(box.type,'checkbox');assert.equal(box.getAttribute('contenteditable'),'false');assert.match(box.getAttribute('aria-label'),/確認する/);box.checked=true;box.dispatch('change');assert.equal(h.changes.at(-1).model.blocks[0].checked,true);assert.equal(h.changes.at(-1).body,'確認する');
});
test('read-only recovery disables editing, formatting and checks without hiding confirmed notes',()=>{
  const h=surface();const model=E.blockType(E.plain('既知の内容'),select(0),'check');h.load('既知の内容',model);h.setEditable(false);assert.equal(h.host.contentEditable,'false');assert.equal(h.host.getAttribute('aria-readonly'),'true');assert.ok(h.editor.toolbar.childNodes.every(n=>n.disabled));const box=h.host.querySelectorAll('input')[0];assert.equal(box.disabled,true);box.checked=true;box.dispatch('change');assert.equal(box.checked,false);assert.equal(h.editor.getText(),'既知の内容');assert.equal(h.changes.length,0);
});
test('a stale owner cannot mutate or reveal its text via delayed input, composition or undo',()=>{
  const h=surface();h.load('Aの下書き');h.select(h.firstText(),0,1);h.button('太字').click();h.host.dispatch('compositionstart');const staleNode=h.firstText(),staleBoxCount=h.changes.length;h.setKey('B:2:n2');h.editor.clear();h.load('Bの本文');staleNode.nodeValue='Aの秘密';h.host.dispatch('compositionend');h.host.dispatch('input',{inputType:'historyUndo'});h.host.dispatch('keydown',{key:'z',metaKey:true});assert.equal(h.editor.getText(),'Bの本文');assert.equal(h.changes.length,staleBoxCount);assert.equal(h.host.textContent.includes('Aの秘密'),false);assert.equal(h.button('元に戻す').disabled,true);
});
test('unsupported or mismatched rich metadata remains readable and cannot be silently overwritten',()=>{
  const h=surface();h.load('元本文',{version:9,blocks:[]});assert.equal(h.host.contentEditable,'false');assert.equal(h.editor.notice.hidden,false);assert.equal(h.editor.getText(),'元本文');h.button('太字').click();assert.equal(h.changes.length,0);
});
test('a rejected input or composition callback restores the previous accepted model',()=>{
  const h=surface();h.load('保持');h.reject(true);let node=h.firstText();node.nodeValue='拒否入力';h.host.dispatch('input',{inputType:'insertText'});assert.equal(h.editor.getText(),'保持');assert.equal(h.host.textContent,'保持');
  node=h.firstText();h.host.dispatch('compositionstart');node.nodeValue='拒否確定';h.host.dispatch('compositionend');assert.equal(h.editor.getText(),'保持');assert.equal(h.host.textContent,'保持');
});
test('nested native lines remain a single soft-line paragraph and unsafe inserted nodes contribute no text',()=>{
  const h=surface();h.load('先');const line=h.host.childNodes[0],a=new h.Node('div'),b=new h.Node('div'),script=new h.Node('script');a.appendChild(h.w.document.createTextNode('前'));b.appendChild(h.w.document.createTextNode('後'));script.appendChild(h.w.document.createTextNode('実行文字'));line.replaceChildren(a,b,script);h.host.dispatch('input',{inputType:'insertText'});assert.equal(h.editor.getText(),'前\n後\n');assert.equal(h.editor.getModel().blocks.length,1);assert.ok(E.valid(h.editor.getModel()));
});
test('Enter and undo use the editor model rather than the native shared undo stack',()=>{
  const h=surface();h.load('abc');h.select(h.firstText(),3);let e=h.host.dispatch('beforeinput',{inputType:'insertParagraph'});assert.equal(e.defaultPrevented,true);assert.equal(h.editor.getText(),'abc\n');assert.equal(h.editor.getModel().blocks.length,2);e=h.host.dispatch('beforeinput',{inputType:'historyUndo'});assert.equal(e.defaultPrevented,true);assert.equal(h.editor.getText(),'abc');h.host.dispatch('keydown',{key:'z',metaKey:true,shiftKey:true});assert.equal(h.editor.getText(),'abc\n');
});

test('an invalid oversized composition is not redrawn or staged until composition ends',()=>{
  const h=surface();h.load('元');const node=h.firstText();h.host.dispatch('compositionstart');node.nodeValue='仮'.repeat(1000001);h.host.dispatch('input',{isComposing:true,inputType:'insertCompositionText'});assert.equal(h.firstText(),node);assert.equal(node.nodeValue.length,1000001);assert.equal(h.changes.length,0);h.host.dispatch('compositionend');assert.equal(h.editor.getText(),'元');assert.equal(h.host.textContent,'元');assert.equal(h.changes.length,0);
});
test('a destroyed editing context clears its private content and cannot load or mutate again',()=>{
  const h=surface();h.load('破棄前の内容');h.host.dispatch('compositionstart');h.editor.destroy();assert.equal(h.editor.load({body:'再表示しない'},'A:1:n1',true),false);const node=h.firstText();node.nodeValue='遅れて来た内容';h.host.dispatch('input',{isComposing:true});h.host.dispatch('compositionend');h.button('太字').click();assert.equal(h.host.textContent,'');assert.equal(h.changes.length,0);assert.equal(h.host.contentEditable,'false');
});

test('a same-owner rejected composition keeps the native DOM until its final validation',()=>{
  const h=surface();h.load('保存済み');const node=h.firstText();h.reject(true);h.host.dispatch('compositionstart');node.nodeValue='未確定';h.host.dispatch('input',{isComposing:true,inputType:'insertCompositionText'});assert.equal(h.firstText(),node);assert.equal(node.nodeValue,'未確定');assert.equal(h.editor.getText(),'保存済み');h.host.dispatch('compositionend');assert.equal(h.editor.getText(),'保存済み');assert.equal(h.host.textContent,'保存済み');
});
