(function(){
  'use strict';
  var ids=['match','stale','layoutchanged','empty','corrupt','readfail','malformed','invalid','accessor'];
  var buttons={},status=document.getElementById('status'),report=document.getElementById('report'),count=document.getElementById('count');
  var observations=[],busy=false,ready=false;
  function clone(v){return JSON.parse(JSON.stringify(v));}
  function canonical(v){
    if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
    if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(function(k){return JSON.stringify(k)+':'+canonical(v[k]);}).join(',')+'}';
    return JSON.stringify(v);
  }
  function sum(k){return observations.reduce(function(n,x){return n+(x.delta?x.delta[k]:0);},0);}
  function getReport(){return clone({schemaVersion:1,scope:'injected_synthetic_queued_receipt_explicit_context_only',
    formalTestCreditFromThisUI:0,actualObservationCount:observations.length,
    externalReadQueuedCalls:sum('externalReadQueuedCalls'),fixtureRepositoryReads:sum('fixtureRepositoryReads'),
    fixtureCurrentJournalReads:sum('fixtureCurrentJournalReads'),fixtureCASCalls:sum('fixtureCASCalls'),
    fixtureCommitsAfterInitialization:sum('fixtureCommitsAfterInitialization'),responseGetterCalls:sum('responseGetterCalls'),
    initialSyntheticMapEntries:observations.reduce(function(n,x){return n+(x.initialSyntheticMapEntries||0);},0),
    initialEntriesAreFixtureSetupNotConsumerWrites:true,ownerStorageConnected:false,externalSend:false,
    contractorAccepted:false,currentOwnerFreshnessGuaranteed:false,constructionStarted:false,constructionCompleted:false,
    observations:observations});}
  ids.forEach(function(id){buttons[id]=document.getElementById(id);});
  function controls(){ids.forEach(function(id){buttons[id].disabled=!ready||busy;});}
  function delta(after,before){var out={};Object.keys(after).forEach(function(k){out[k]=after[k]-before[k];});return out;}
  function append(id,data){observations.push(Object.assign({caseId:id},data));report.textContent=JSON.stringify(getReport(),null,2);report.dataset.observations=String(observations.length);count.textContent='手動の観測 '+observations.length+' 回';}
  function frozen(v){return !v||typeof v!=='object'||Object.isFrozen(v)&&Object.keys(v).every(function(k){return frozen(v[k]);});}
  try{
    var Core=window.PetGameCore,Outbox=window.PetContractorRequestOutbox,QueuedReview=window.PetContractorQueuedReview;
    if(!Core||typeof Core.defaultVillageLayout!=='function'||!Outbox||typeof Outbox.create!=='function'||!QueuedReview||typeof QueuedReview.create!=='function')throw Error('proof_dependency_unavailable');
    function fixture(id){
      var base=Core.defaultVillageLayout(),requested=clone(base),provided={revision:7,currentLayout:clone(base)};
      requested.items[0].x=requested.items[0].x===100?99:requested.items[0].x+1;
      var record={version:1,requestId:'queued-context-example',payload:{snapshot:{revision:7,currentLayout:base},
        proposal:{version:1,expectedRevision:7,requestedLayout:requested}},receipt:{version:1,requestId:'queued-context-example',stage:'unsubmitted',journalRevision:1}};
      var queued={version:1,record:record,receipt:{version:1,requestId:record.requestId,stage:'queued_for_review',scope:'explicit_local_preparation',outboxRevision:1,baseRevision:7}};
      var map=new Map(),counts={externalReadQueuedCalls:0,fixtureRepositoryReads:0,fixtureCurrentJournalReads:0,fixtureCASCalls:0,fixtureCommitsAfterInitialization:0,responseGetterCalls:0};
      if(id!=='empty')map.set('slot',id==='corrupt'?'{':canonical(queued));
      var initial=map.size,rawBefore=map.has('slot')?map.get('slot'):null;
      var nativeOutbox=Outbox.create({journal:{async readDraft(){counts.fixtureCurrentJournalReads++;throw Error('proof_current_journal_read_forbidden');}},
        repository:{async read(){counts.fixtureRepositoryReads++;if(id==='readfail')throw Error('synthetic_read_failed');return map.has('slot')?map.get('slot'):null;},
          async compareAndSwap(){counts.fixtureCASCalls++;throw Error('proof_queue_write_forbidden');}}});
      var outbox={async readQueued(){
        counts.externalReadQueuedCalls++;
        if(id==='malformed')return {ok:true,status:'unrecognized_result'};
        if(id==='accessor'){
          var reply={};Object.defineProperty(reply,'ok',{enumerable:true,get:function(){counts.responseGetterCalls++;return true;}});return reply;
        }
        return nativeOutbox.readQueued();
      }};
      if(id==='stale')provided.revision=8;
      if(id==='layoutchanged')provided.currentLayout.items[1].y=provided.currentLayout.items[1].y===100?99:provided.currentLayout.items[1].y+1;
      var snapshotJson=id==='invalid'?'{}':JSON.stringify(provided);
      return {reviewer:QueuedReview.create({outbox:outbox}),snapshotJson:snapshotJson,provided:provided,
        counts:counts,map:map,rawBefore:rawBefore,initialSyntheticMapEntries:initial};
    }
    ids.forEach(function(id){buttons[id].addEventListener('click',async function(){
      if(busy||buttons[id].disabled)return;busy=true;controls();status.textContent='ページ専用の控えを照合しています。';
      var session,before;
      try{
        session=fixture(id);before=clone(session.counts);
        var reply=await session.reviewer.review({snapshotJson:session.snapshotJson}),difference=delta(session.counts,before);
        var token=reply.ok?reply.status:reply.error;
        var expected={match:'matches_provided_context',stale:'stale_revision',layoutchanged:'base_layout_changed',empty:'empty',corrupt:'corrupt_queue',readfail:'queue_read_failed',malformed:'corrupt_queue',invalid:'invalid_snapshot',accessor:'corrupt_queue'};
        var expectRepository=['malformed','invalid','accessor'].indexOf(id)>=0?0:1;
        var stored=reply.ok&&reply.status!=='empty';
        var rawAfter=session.map.has('slot')?session.map.get('slot'):null;
        var verified=token===expected[id]&&difference.externalReadQueuedCalls===(id==='invalid'?0:1)&&
          difference.fixtureRepositoryReads===expectRepository&&difference.fixtureCurrentJournalReads===0&&
          difference.fixtureCASCalls===0&&difference.fixtureCommitsAfterInitialization===0&&difference.responseGetterCalls===0&&
          rawAfter===session.rawBefore&&frozen(reply)&&
          (!stored||(reply.stage==='queued_for_review'&&reply.scope==='explicit_local_preparation'&&reply.freshness==='provided_context_only'&&
            reply.queued&&reply.queued.receipt.stage==='queued_for_review'&&reply.queued.record.receipt.stage==='unsubmitted'));
        append(id,{verified:!!verified,reply:reply,delta:difference,initialSyntheticMapEntries:session.initialSyntheticMapEntries,
          originalQueuedRawUnchanged:rawAfter===session.rawBefore,fullyFrozenReply:frozen(reply),separateExplicitManualAction:true});
        var messages={match:'渡した版と配置全体が、待ち控えの作成時の文脈と一致しました。',stale:'控えを読んだところ、渡した版とは違いました。',layoutchanged:'版は同じですが、配置全体が違いました。',empty:'待ち控えは空でした。渡した配置の検証と、控えの読取を分けて確認しました。',corrupt:'壊れた控えを拒否しました。空とは扱いません。',readfail:'控えの読取に失敗しました。保存内容は未確認です。',malformed:'不正な読取応答を拒否しました。',invalid:'不正な配置を先に拒否し、控えを読みませんでした。',accessor:'応答の getter を実行せずに拒否しました。'};
        status.textContent=verified?messages[id]:'この例の確認は未完です。観測記録を確認してください。';
      }catch(error){append(id,{verified:false,error:'proof_observation_failed',delta:session&&before?delta(session.counts,before):null});status.textContent='見本の結果は未確認です。';}
      finally{busy=false;controls();buttons[id].focus({preventScroll:true});}
    });});
    window.__contractorQueuedReviewProof=Object.freeze({getReport:getReport});ready=true;controls();
    report.textContent=JSON.stringify(getReport(),null,2);report.dataset.observations='0';
  }catch(error){ready=false;controls();status.textContent='見本を読み込めませんでした。結果は未確認です。';}
}());
