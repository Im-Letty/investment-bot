/* The chosen heading picker is a view onto the existing two tab controllers.
   It owns no route, ledger document, draft, owner, scroll or persistent state. */
(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory;
  if(root){var api=factory(root);root.KNMyPageViewPicker=api;if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',api.mount,{once:true});else api.mount();}
})(typeof window==='undefined'?null:window,function(w){
  'use strict';
  var doc=w.document,page,top,label,select,source=[],options=[],observer,discovery;
  function set(node,key,value){if(node.getAttribute(key)!==value)node.setAttribute(key,value);}
  function blocked(){return !page||!page.classList.contains('open')||page.getAttribute('data-mp-view')==='memo'||top.hidden||top.inert||top.getAttribute('aria-hidden')==='true';}
  function sync(){
    if(!select)return;
    var hidden=blocked();if(label.hidden!==hidden)label.hidden=hidden;if(select.disabled!==hidden)select.disabled=hidden;
    source.forEach(function(button,index){
      var text=(button.textContent||'').trim()||(index===0?'ポートフォリオ':'家計簿');
      if(options[index].textContent!==text)options[index].textContent=text;
      var disabled=!!button.disabled||button.getAttribute('aria-disabled')==='true';if(options[index].disabled!==disabled)options[index].disabled=disabled;
    });
    // The controller's selected class is authoritative, including owner changes
    // and visits made from the menu, direct entry or the existing iframe.
    var active=source.findIndex(function(button){return button.classList.contains('on');});
    if(active>=0){var value=active===0?'portfolio':'ledger';if(select.value!==value)select.value=value;}
  }
  function mount(){
    var nextPage=doc.getElementById('myPageOv'),nextTop=nextPage&&nextPage.querySelector('.mp-toptabs');
    if(!nextPage||!nextTop){
      if(!discovery&&typeof w.MutationObserver==='function'){discovery=new w.MutationObserver(mount);discovery.observe(doc.body,{childList:true,subtree:true});}
      return false;
    }
    if(top===nextTop){sync();return true;}
    var buttons=Array.from(nextTop.querySelectorAll('.mp-toptab'));
    if(buttons.length!==2)return false;
    if(discovery){discovery.disconnect();discovery=null;}
    if(observer)observer.disconnect();page=nextPage;top=nextTop;source=buttons;options=[];
    label=doc.createElement('label');label.className='mp-view-picker';
    var name=doc.createElement('span');name.className='mp-view-picker-sr';name.textContent='表示を選ぶ';label.appendChild(name);
    select=doc.createElement('select');select.id='mpViewPicker';select.setAttribute('aria-label','表示を選ぶ');
    ['portfolio','ledger'].forEach(function(value){var option=doc.createElement('option');option.value=value;options.push(option);select.appendChild(option);});label.appendChild(select);top.appendChild(label);
    select.addEventListener('change',function(){
      var index=select.value==='portfolio'?0:select.value==='ledger'?1:-1;
      if(blocked()||index<0||options[index].disabled){sync();return;}
      var selected=source[index];
      if(!selected.classList.contains('on'))selected.click();
      sync();
      // Preserve native select focus unless the existing controller explicitly
      // moved it into a content editor or another dialog.
      if(!blocked()&&(doc.activeElement===select||doc.activeElement===selected||doc.activeElement===doc.body))select.focus({preventScroll:true});
    });
    // Applying the marker last keeps the old two tabs usable if enhancement
    // assets are missing. No attribute on those original tab nodes is changed.
    set(top,'data-mp-picker-ready','true');sync();
    if(typeof w.MutationObserver==='function'){
      observer=new w.MutationObserver(sync);
      observer.observe(page,{attributes:true,attributeFilter:['class','data-mp-view']});
      observer.observe(top,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class','hidden','inert','aria-hidden','aria-disabled','disabled']});
    }
    return true;
  }
  return {mount:mount,sync:sync};
});
