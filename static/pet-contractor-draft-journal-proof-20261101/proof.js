(function(){
  'use strict';
  var ids=['record','replay','conflict','reopen','compete','unknown','reconcile'];
  var buttons={},status=document.getElementById('status'),report=document.getElementById('report');
  ids.forEach(function(id){buttons[id]=document.getElementById(id);});
  var observations=[],busy=false,ready=false,mainRecorded=false,unknownObserved=false;
  function clone(value){return JSON.parse(JSON.stringify(value));}
  function memory(){
    var map=new Map(),counts={reads:0,CAS:0,commits:0};
    return {counts:counts,repository:function(loseAcknowledgement){return {
      async read(){counts.reads++;return map.has('slot')?map.get('slot'):null;},
      async compareAndSwap(expected,next){
        counts.CAS++;
        // One synchronous compare/write is the atomic point for this synthetic
        // backing Map shared by independently created adapter clients.
        var current=map.has('slot')?map.get('slot'):null;
        if(current!==expected)return 'conflict';
        map.set('slot',next);counts.commits++;
        if(loseAcknowledgement)throw Error('synthetic_post_commit_ack_lost');
        return 'committed';
      }
    };}};
  }
  function controls(){
    ids.forEach(function(id){buttons[id].disabled=!ready||busy;});
    buttons.record.disabled=!ready||busy||mainRecorded;
    buttons.replay.disabled=!ready||busy||!mainRecorded;
    buttons.conflict.disabled=!ready||busy||!mainRecorded;
    buttons.unknown.disabled=!ready||busy||unknownObserved;
    buttons.reconcile.disabled=!ready||busy||!unknownObserved;
  }
  function append(caseId,value,verified){
    observations.push({caseId:caseId,verified:verified,result:value});
    if(observations.length>16)observations.shift();
    var valueReport={schemaVersion:1,moduleVersion:window.PetContractorDraftJournal.version,
      scope:'synthetic one-slot unsubmitted draft journal only',observations:observations};
    report.textContent=JSON.stringify(valueReport,null,2);
    report.dataset.observations=String(observations.length);
  }
  function manual(id,task){
    buttons[id].addEventListener('click',async function(){
      if(busy||buttons[id].disabled)return;
      busy=true;controls();status.textContent='見本の結果を確認しています。';
      try{await task();}
      catch(error){append(id,{error:'proof_observation_failed'},false);status.textContent='見本の結果を確認できませんでした。記録の有無を決めず、結果は未確認として残します。';}
      finally{busy=false;controls();}
    });
  }
  try{
    var Core=window.PetGameCore,Journal=window.PetContractorDraftJournal;
    if(!Core||typeof Core.defaultVillageLayout!=='function'||!Journal||typeof Journal.create!=='function')throw Error('proof_dependency_unavailable');
    var current=Core.defaultVillageLayout(),requested=clone(current);
    requested.items[0].x=requested.items[0].x===100?99:requested.items[0].x+1;
    function request(id){return {requestId:id,snapshotJson:JSON.stringify({revision:7,currentLayout:current}),
      proposalJson:JSON.stringify({version:1,expectedRevision:7,requestedLayout:requested})};}
    var main=memory(),mainRepository=main.repository(false),mainClient=Journal.create({repository:mainRepository});
    var unknownStore=memory(),unknownClient=Journal.create({repository:unknownStore.repository(true)});
    var mainRequest=request('synthetic-draft-1'),unknownRequest=request('synthetic-unknown-1');
    manual('record',async function(){
      var before=clone(main.counts),value=await mainClient.recordDraft(mainRequest);
      mainRecorded=value.ok===true;
      var verified=value.ok&&value.status==='recorded'&&main.counts.commits-before.commits===1;
      append('record',{reply:value,counts:clone(main.counts),before:before},!!verified);
      status.textContent=verified?'見本の下書きを未提出のまま1件記録しました。':value.status==='replayed'?'同じ見本の記録を読み戻しました。':'見本の記録は未確認です。';
    });
    manual('replay',async function(){
      var before=clone(main.counts),formatted=clone(mainRequest);
      formatted.snapshotJson=JSON.stringify(JSON.parse(formatted.snapshotJson),null,2);
      formatted.proposalJson=JSON.stringify(JSON.parse(formatted.proposalJson),null,3);
      var value=await mainClient.recordDraft(formatted),verified=value.ok&&value.status==='replayed'&&main.counts.CAS===before.CAS;
      append('replay',{reply:value,counts:clone(main.counts),before:before},!!verified);
      status.textContent=verified?'同じIDと内容の記録を返しました。追加の書き込みはありません。':'重複記録の確認が完了していません。';
    });
    manual('conflict',async function(){
      var changed=clone(mainRequest),proposal=JSON.parse(changed.proposalJson),before=clone(main.counts);
      proposal.requestedLayout.items[1].y=proposal.requestedLayout.items[1].y===100?99:proposal.requestedLayout.items[1].y+1;
      changed.proposalJson=JSON.stringify(proposal);
      var value=await mainClient.recordDraft(changed),verified=value.error==='journal_conflict'&&main.counts.CAS===before.CAS;
      append('content_conflict',{reply:value,counts:clone(main.counts),before:before},verified);
      status.textContent=verified?'違う内容は競合として止まり、元の下書きを上書きしませんでした。':'内容の競合を確認できませんでした。';
    });
    manual('reopen',async function(){
      var before=clone(main.counts);mainClient=Journal.create({repository:mainRepository});
      var value=await mainClient.readDraft(),verified=value.ok&&main.counts.CAS===before.CAS;
      mainRecorded=value.ok&&value.record!==null;
      append('reopen_same_memory',{reply:value,counts:clone(main.counts),before:before},!!verified);
      status.textContent=verified?(value.record?'同じメモリから下書きを読み戻しました。':'同じメモリの枠は空でした。'):'見本の読み戻しは未確認です。';
    });
    manual('compete',async function(){
      var separate=memory(),a=Journal.create({repository:separate.repository(false)}),b=Journal.create({repository:separate.repository(false)});
      var replies=await Promise.all([a.recordDraft(request('synthetic-client-a')),b.recordDraft(request('synthetic-client-b'))]);
      var verified=replies.filter(function(x){return x.ok;}).length===1&&replies.filter(function(x){return x.error==='journal_conflict';}).length===1&&separate.counts.commits===1;
      append('independent_client_conflict',{replies:replies,counts:clone(separate.counts)},verified);
      status.textContent=verified?'2つの見本要求のうち1件だけを記録し、もう1件は競合として止まりました。':'同時の記録要求を確認できませんでした。';
    });
    manual('unknown',async function(){
      var value=await unknownClient.recordDraft(unknownRequest);
      unknownObserved=value.error==='write_outcome_unknown';
      var verified=unknownObserved&&unknownStore.counts.CAS===1&&unknownStore.counts.commits===1;
      append('unknown_ack',{reply:value,fixtureCounts:clone(unknownStore.counts)},verified);
      status.textContent=unknownObserved?'応答が不明です。未記録とは決めず、手動の読み戻しへ進めます。':'応答不明の見本を確認できませんでした。';
    });
    manual('reconcile',async function(){
      var before=clone(unknownStore.counts),read=await unknownClient.readDraft(),retry=null;
      // This explicit manual operation does not write an empty/unreadable slot.
      if(read.ok&&read.record!==null)retry=await unknownClient.recordDraft(unknownRequest);
      var verified=read.ok&&read.record!==null&&retry&&retry.status==='replayed'&&unknownStore.counts.CAS===before.CAS;
      append('manual_unknown_reconciliation',{read:read,retry:retry,counts:clone(unknownStore.counts),before:before},!!verified);
      status.textContent=verified?'同じ記録を読み戻せました。追加の書き込みをせず、前の記録を返しました。':'記録を確定できません。追加の書き込みをせず、未確認として残します。';
    });
    window.__contractorDraftJournalProof={getReport:function(){return clone({schemaVersion:1,scope:'synthetic one-slot unsubmitted draft journal only',observations:observations});}};
    ready=true;controls();status.textContent='ボタンを押すと、ページ専用の見本で記録と読み戻しを確認できます。';
  }catch(error){ready=false;controls();status.textContent='見本を読み込めませんでした。結果は未確認です。';report.textContent='見本の操作はまだ完了していません。';}
}());
