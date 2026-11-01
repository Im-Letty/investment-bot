(function(){
  'use strict';
  var ids=['match','stale','layoutchanged','empty','corrupt','readfail','malformed'],buttons={};
  var status=document.getElementById('status'),report=document.getElementById('report'),observations=[],busy=false,ready=false;
  ids.forEach(function(id){buttons[id]=document.getElementById(id);});
  function clone(value){return JSON.parse(JSON.stringify(value));}
  function getReport(){return clone({schemaVersion:1,scope:'caller_provided_context_comparison_synthetic_map_only',
    formalTestCreditFromThisUI:0,actualObservationCount:observations.length,CAS_calls:observations.reduce(function(sum,row){return sum+(row.result.counts?row.result.counts.CAS:0);},0),
    ownerGameSaveAccessed:false,currentGameFreshnessGuaranteed:false,commissionAccepted:false,constructionStarted:false,
    observations:observations});}
  function controls(){ids.forEach(function(id){buttons[id].disabled=!ready||busy;});}
  function append(caseId,result,verified){
    observations.push({caseId:caseId,verified:!!verified,result:result});
    report.textContent=JSON.stringify(getReport(),null,2);report.dataset.observations=String(observations.length);
  }
  try{
    var Core=window.PetGameCore,Journal=window.PetContractorDraftJournal,Review=window.PetContractorDraftReview;
    if(!Core||typeof Core.defaultVillageLayout!=='function'||!Journal||typeof Journal.create!=='function'||!Review||typeof Review.create!=='function')throw Error('proof_dependency_unavailable');
    ids.forEach(function(id){buttons[id].addEventListener('click',async function(){
      if(busy||buttons[id].disabled)return;
      busy=true;controls();status.textContent='渡された見本の文脈と比較しています。';
      try{
        var base=Core.defaultVillageLayout(),requested=clone(base),provided={revision:7,currentLayout:clone(base)};
        requested.items[0].x=requested.items[0].x===100?99:requested.items[0].x+1;
        var saved={version:1,requestId:'manual-review-example',payload:{snapshot:{revision:7,currentLayout:base},
          proposal:{version:1,expectedRevision:7,requestedLayout:requested}},
          receipt:{version:1,requestId:'manual-review-example',stage:'unsubmitted',journalRevision:1}};
        // Explicit fixture data, never a recordDraft or CAS call. Each click has
        // a new synthetic Map and cannot reach browser or owner game storage.
        var map=new Map(),counts={repositoryReads:0,externalJournalReads:0,CAS:0};
        if(id!=='empty')map.set('slot',id==='corrupt'?'{':JSON.stringify(saved));
        if(id==='stale')provided.revision=8;
        if(id==='layoutchanged')provided.currentLayout.items[1].y=provided.currentLayout.items[1].y===100?99:provided.currentLayout.items[1].y+1;
        var repository={async read(){counts.repositoryReads++;if(id==='readfail')throw Error('private_synthetic_read_failure');return map.has('slot')?map.get('slot'):null;},
          async compareAndSwap(){counts.CAS++;throw Error('proof_write_forbidden');}};
        var journal=Journal.create({repository:repository}),injected={async readDraft(){
          counts.externalJournalReads++;
          if(id==='malformed')return {ok:true,status:'recorded_unsubmitted',record:saved,accepted:true};
          return journal.readDraft();
        }};
        var before=clone(counts),reply=await Review.create({journal:injected}).review({snapshotJson:JSON.stringify(provided)});
        var expected={match:'matches_provided_context',stale:'stale_revision',layoutchanged:'base_layout_changed',empty:'empty',corrupt:'corrupt_journal',readfail:'repository_read_failed',malformed:'corrupt_journal'};
        var expectedValidation=['match','stale','layoutchanged'].indexOf(id)>=0?1:0;
        var verified=(reply.ok?reply.status:reply.error)===expected[id]&&counts.externalJournalReads===1&&counts.CAS===0&&
          reply.reads.journal===1&&reply.reads.revalidation===expectedValidation&&(!reply.record||reply.record.receipt.stage==='unsubmitted');
        append(id,{reply:reply,before:before,counts:clone(counts),external_injected_reads:counts.externalJournalReads,
          isolated_validation_reads:reply.reads.revalidation,reviewCAS:counts.CAS,suppliedContextOnly:true},verified);
        var messages={match:'渡された同じ版・同じ配置と一致しました。本人の現在状態の保証ではありません。',stale:'保存時と渡された版が違います。下書きは未提出のままです。',layoutchanged:'版は同じでも配置全体が違います。下書きは未提出のままです。',empty:'この見本の枠は空でした。',corrupt:'壊れた記録を拒否しました。空の枠とは扱いません。',readfail:'読取に失敗しました。空や未記録とは決めません。',malformed:'不正な読取応答を拒否しました。'};
        status.textContent=verified?messages[id]:'この例の確認は未完です。観測記録を確認してください。';
      }catch(error){append(id,{error:'proof_observation_failed',counts:counts?clone(counts):null},false);status.textContent='見本の結果は未確認です。';}
      finally{busy=false;controls();}
    });});
    window.__contractorDraftReviewProof=Object.freeze({getReport:getReport});ready=true;controls();
    report.textContent=JSON.stringify(getReport(),null,2);report.dataset.observations='0';
  }catch(error){ready=false;controls();status.textContent='見本を読み込めませんでした。結果は未確認です。';}
}());
