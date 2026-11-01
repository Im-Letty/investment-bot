(function(){
  'use strict';
  var Core=window.PetGameCore,story=window.PetOpeningStoryCandidate,values=new Map(),app=null,page=1,busy=true;
  var previous=document.getElementById('previous'),next=document.getElementById('next'),reopen=document.getElementById('reopen');
  var heading=document.getElementById('chapter-title'),status=document.getElementById('status');
  // This sample never reads browser storage or host save adapters. Reopening
  // instantiates the real Core against this same synthetic in-memory store.
  var storage={getItem:function(key){return values.has(key)?values.get(key):null;},
    setItem:async function(key,value){values.set(key,value);return true;}};
  function report(error){
    busy=true;previous.disabled=true;next.disabled=true;reopen.disabled=true;
    status.textContent=error&&error.message?error.message:'見本を開けませんでした。';
  }
  function render(focus){
    var view=app.getOpeningStoryView(),row=story.pages[page-1];
    if(view.candidateId!==story.id||view.pageCount!==story.pages.length)throw Error('物語としおりの版が一致しません。');
    document.getElementById('eyebrow').textContent=row.eyebrow;
    document.getElementById('page-count').textContent=page+' / '+story.pages.length;
    heading.textContent=row.title;
    var prose=document.getElementById('prose');prose.replaceChildren();
    row.paragraphs.forEach(function(text){var p=document.createElement('p');p.textContent=text;prose.appendChild(p);});
    previous.disabled=busy||page===1;
    next.disabled=busy||(page===story.pages.length&&view.complete);
    next.textContent=page===story.pages.length?(view.complete?'しおりを挟みました':'しおりを挟む'):'次のページへ';
    reopen.disabled=busy;
    status.textContent=view.complete?'この見本を、最後まで読みました。':view.readThrough?'しおり：'+view.readThrough+'ページまで':'自分のペースで、ページをめくってください。';
    if(focus)heading.focus();
    window.__openingStoryProofReport={candidateId:story.id,page:page,readThrough:view.readThrough,complete:view.complete,
      storage:'synthetic-memory-only',normalGameIntegration:false,NPCCount:0,revision:app.getState().revision};
  }
  async function open(focus){
    busy=true;previous.disabled=true;next.disabled=true;reopen.disabled=true;
    if(!Core||!story)throw Error('見本の読み込みを確認できませんでした。');
    app=Core.create({storage:storage,legacy:storage});var result=await app.ready;
    if(!result.ok)throw result.error;
    page=Math.min(story.pages.length,app.getOpeningStoryView().readThrough+1);busy=false;render(focus);
  }
  previous.addEventListener('click',function(){if(busy||page===1)return;page--;render(true);});
  next.addEventListener('click',async function(){
    if(busy)return;
    try{
      busy=true;render(false);var view=app.getOpeningStoryView();
      if(page>view.readThrough){
        var result=await app.dispatch({type:'readOpeningStory',expectedRevision:app.getState().revision,candidateId:story.id,page:page});
        if(!result.ok)throw result.error;
      }
      if(page<story.pages.length)page++;
      busy=false;render(true);
    }catch(error){report(error);}
  });
  reopen.addEventListener('click',function(){if(!busy)open(true).catch(report);});
  open(false).catch(report);
}());
