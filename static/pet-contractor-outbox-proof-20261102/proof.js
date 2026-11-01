(function(){
  'use strict';
  var ids=['queue','replay','stale','layoutchanged','conflict','corrupt','readfail','unknown','readStored','recover'];
  var buttons={},status=document.getElementById('status'),report=document.getElementById('report');
  var observations=[],busy=false,ready=false,unknownSession=null;
  function clone(value){return JSON.parse(JSON.stringify(value));}
  function canonical(value){
    if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
    if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(function(key){return JSON.stringify(key)+':'+canonical(value[key]);}).join(',')+'}';
    return JSON.stringify(value);
  }
  function getReport(){return clone({schemaVersion:1,scope:'separate_injected_local_outbox_synthetic_memory_only',
    formalTestCreditFromThisUI:0,actualObservationCount:observations.length,
    outboxCAS:observations.reduce(function(sum,row){return sum+(row.delta?row.delta.outboxCAS:0);},0),
    actualSyntheticCommits:observations.reduce(function(sum,row){return sum+(row.delta?row.delta.commits:0);},0),
    originalJournalWrites:observations.reduce(function(sum,row){return sum+(row.delta?row.delta.sourceCAS:0);},0),
    ownerStorageAccessed:false,externalSend:false,contractorAccepted:false,currentOwnerFreshnessGuaranteed:false,
    constructionStarted:false,constructionCompleted:false,observations:observations});}
  ids.forEach(function(id){buttons[id]=document.getElementById(id);});
  function controls(){ids.forEach(function(id){buttons[id].disabled=!ready||busy||((id==='recover'||id==='readStored')&&!unknownSession);});}
  function delta(after,before){var result={};Object.keys(after).forEach(function(key){result[key]=after[key]-before[key];});return result;}
  function append(id,entry){observations.push(Object.assign({caseId:id},entry));report.textContent=JSON.stringify(getReport(),null,2);report.dataset.observations=String(observations.length);}
  function envelope(record){return {version:1,record:clone(record),receipt:{version:1,requestId:record.requestId,
    stage:'queued_for_review',scope:'explicit_local_preparation',outboxRevision:1,baseRevision:record.payload.snapshot.revision}};}
  try{
    var Core=window.PetGameCore,Journal=window.PetContractorDraftJournal,Outbox=window.PetContractorRequestOutbox;
    if(!Core||typeof Core.defaultVillageLayout!=='function'||!Journal||typeof Journal.create!=='function'||!Outbox||typeof Outbox.create!=='function')throw Error('proof_dependency_unavailable');
    function fixture(id){
      var base=Core.defaultVillageLayout(),requested=clone(base),provided={revision:7,currentLayout:clone(base)};
      requested.items[0].x=requested.items[0].x===100?99:requested.items[0].x+1;
      var source={version:1,requestId:'local-outbox-example',payload:{snapshot:{revision:7,currentLayout:base},
        proposal:{version:1,expectedRevision:7,requestedLayout:requested}},
        receipt:{version:1,requestId:'local-outbox-example',stage:'unsubmitted',journalRevision:1}};
      var sourceRaw=canonical(source),map=new Map(),counts={sourceJournalReads:0,sourceRepositoryReads:0,sourceCAS:0,outboxReads:0,outboxCAS:0,commits:0};
      if(id==='replay'||id==='stale'||id==='layoutchanged')map.set('slot',canonical(envelope(source)));
      if(id==='conflict'){
        var other=clone(source);other.requestId='another-local-outbox-example';other.receipt.requestId=other.requestId;
        map.set('slot',canonical(envelope(other)));
      }
      if(id==='corrupt')map.set('slot','{');
      if(id==='stale')provided.revision=8;
      if(id==='layoutchanged')provided.currentLayout.items[1].y=provided.currentLayout.items[1].y===100?99:provided.currentLayout.items[1].y+1;
      var sourceJournal=Journal.create({repository:{async read(){counts.sourceRepositoryReads++;return sourceRaw;},
        async compareAndSwap(){counts.sourceCAS++;throw Error('proof_original_journal_write_forbidden');}}});
      var journal={async readDraft(){counts.sourceJournalReads++;return sourceJournal.readDraft();}};
      var repository={async read(){counts.outboxReads++;if(id==='readfail')throw Error('private_synthetic_queue_read_failure');return map.has('slot')?map.get('slot'):null;},
        async compareAndSwap(expected,next){
          counts.outboxCAS++;
          var current=map.has('slot')?map.get('slot'):null;
          if(current!==expected)return 'conflict';
          map.set('slot',next);counts.commits++;
          if(id==='unknown')throw Error('private_synthetic_acknowledgement_lost_after_commit');
          return 'committed';
        }};
      return {outbox:Outbox.create({journal:journal,repository:repository}),provided:provided,sourceRaw:sourceRaw,
        source:source,map:map,counts:counts,unknownObservationIndex:null};
    }
    ids.forEach(function(id){buttons[id].addEventListener('click',async function(){
      if(busy||buttons[id].disabled)return;
      busy=true;controls();status.textContent='ページ専用の見本を確認しています。';
      var session,before;
      try{
        session=(id==='recover'||id==='readStored')?unknownSession:fixture(id);
        before=clone(session.counts);
        var reply=id==='readStored'?await session.outbox.readQueued():await session.outbox.enqueue({snapshotJson:JSON.stringify(session.provided)});
        var difference=delta(session.counts,before),token=reply.ok?reply.status:reply.error;
        var expected={queue:'queued',replay:'replayed',stale:'stale_revision',layoutchanged:'base_layout_changed',
          conflict:'queue_conflict',corrupt:'corrupt_queue',readfail:'queue_read_failed',unknown:'write_outcome_unknown',readStored:'stored_local',recover:'replayed'};
        var noOutbox=id==='stale'||id==='layoutchanged';
        var expectCAS=id==='queue'||id==='unknown'?1:0;
        var expectJournal=id==='readStored'?0:1;
        var expectOutboxRevalidation=['replay','conflict','readStored','recover'].indexOf(id)>=0?1:0;
        var verified=token===expected[id]&&difference.sourceCAS===0&&difference.sourceJournalReads===expectJournal&&
          difference.sourceRepositoryReads===expectJournal&&difference.outboxReads===(noOutbox?0:1)&&
          difference.outboxCAS===expectCAS&&difference.commits===expectCAS&&
          reply.scope==='explicit_local_preparation'&&reply.counts.outboxReads===difference.outboxReads&&
          reply.counts.outboxCAS===difference.outboxCAS&&reply.counts.journalReads===expectJournal&&
          reply.counts.draftReviewCalls===expectJournal&&reply.counts.reviewRevalidationReads===expectJournal&&
          reply.counts.outboxRevalidationReads===expectOutboxRevalidation&&
          (!reply.queued||(reply.queued.record.receipt.stage==='unsubmitted'&&reply.queued.receipt.stage==='queued_for_review'&&
            reply.queued.receipt.scope==='explicit_local_preparation'))&&
          (id!=='readStored'||reply.freshness==='not_checked')&&
          ((id!=='queue'&&id!=='unknown')||session.map.has('slot'));
        if(id==='unknown'&&verified){session.unknownObservationIndex=observations.length;unknownSession=session;}
        append(id,{verified:!!verified,reply:reply,before:before,after:clone(session.counts),delta:difference,
          originalJournalRawUnchanged:session.sourceRaw===canonical(session.source),
          actualSyntheticOutboxRecordPresent:session.map.has('slot'),
          priorUnknownObservationIndex:(id==='recover'||id==='readStored')?session.unknownObservationIndex:null,
          separateExplicitManualAction:true});
        var messages={queue:'ページ専用の待ち控えに記録しました。業者への送信ではありません。',
          replay:'明示した文脈をもう一度照合し、同じ待ち控えを返しました。追加記録はありません。',
          stale:'保存時と渡された版が違うため、待ち控えにはアクセスしませんでした。',
          layoutchanged:'版は同じでも配置全体が違うため、待ち控えにはアクセスしませんでした。',
          conflict:'別の待ち控えを上書きせずに止めました。',
          corrupt:'壊れた待ち控えを拒否しました。空の枠とは扱いません。',
          readfail:'待ち控えを読めませんでした。空や未記録とは決めません。',
          unknown:'返事が途切れたため結果は未確定です。自動で再記録しません。下のボタンで手動確認できます。',
          readStored:'保存済みのローカル待ち控えを読みました。現在の文脈との一致は確認していません。',
          recover:'明示した文脈と同じ待ち控えを確認しました。追加の記録操作はありません。'};
        status.textContent=verified?messages[id]:'この例の確認は未完です。観測記録を確認してください。';
      }catch(error){append(id,{verified:false,error:'proof_observation_failed',delta:session&&before?delta(session.counts,before):null});status.textContent='見本の結果は未確認です。';}
      finally{busy=false;controls();}
    });});
    window.__contractorOutboxProof=Object.freeze({getReport:getReport});ready=true;controls();
    report.textContent=JSON.stringify(getReport(),null,2);report.dataset.observations='0';
  }catch(error){ready=false;controls();status.textContent='見本を読み込めませんでした。結果は未確認です。';}
}());
