(function(){
  'use strict';
  var ids=['inspect','withdraw','differentid','differentpayload','empty','corrupt','readfail','casconflict','invalid','malformed','unsupported','unknown','read-empty','retry-empty'];
  var status=document.getElementById('status'),report=document.getElementById('report'),count=document.getElementById('count');
  var buttons={},observations=[],busy=false,ready=false,unknownSession=null;
  function clone(x){return JSON.parse(JSON.stringify(x));}
  function canonical(x){if(Array.isArray(x))return '['+x.map(canonical).join(',')+']';if(x&&typeof x==='object')return '{'+Object.keys(x).sort().map(function(k){return JSON.stringify(k)+':'+canonical(x[k]);}).join(',')+'}';return JSON.stringify(x);}
  function frozen(x){return !x||typeof x!=='object'||Object.isFrozen(x)&&Object.keys(x).every(function(k){return frozen(x[k]);});}
  function difference(a,b){var out={};Object.keys(a).forEach(function(k){out[k]=a[k]-b[k];});return out;}
  function controls(){ids.forEach(function(id){buttons[id].disabled=!ready||busy||(['read-empty','retry-empty'].indexOf(id)>=0&&!unknownSession);});}
  function sum(k){return observations.reduce(function(n,x){return n+(x.delta?x.delta[k]:0);},0);}
  function getReport(){return clone({schemaVersion:1,scope:'explicit_local_preparation_nullable_CAS_synthetic_Map_only',actualObservationCount:observations.length,formalTestCreditFromThisUI:0,repositoryReads:sum('repositoryReads'),repositoryCAS:sum('repositoryCAS'),actualMapClearsAfterInitialization:sum('ownMapClears'),simulatedConcurrentWrites:sum('simulatedConcurrentWrites'),originalJournalReadsAfterInitialization:sum('originalJournalReads'),originalJournalWritesAfterInitialization:sum('originalJournalWrites'),responseGetterCalls:sum('responseGetterCalls'),fixtureInitialWritesAreSeparateFromConsumerWrites:true,successACKsAreNotEqualToMapClears:true,ownerStorageConnected:false,normalGameConnected:false,oldIndexedDBAdapterNullableTargetSupported:false,oldIndexedDBIntegrationVerified:false,arbitraryHostAtomicityDurabilityVerified:false,externalSendAcceptOrCancellation:false,constructionStartedOrCompleted:false,observations:observations});}
  function append(id,row){observations.push(Object.assign({caseId:id},row));report.textContent=JSON.stringify(getReport(),null,2);report.dataset.observations=String(observations.length);count.textContent='手動の観測 '+observations.length+' 回';}
  ids.forEach(function(id){buttons[id]=document.getElementById(id);});
  try{
    var Core=window.PetGameCore,Journal=window.PetContractorDraftJournal,Outbox=window.PetContractorRequestOutbox,Withdrawal=window.PetContractorQueueWithdrawal;
    if(!Core||!Journal||!Outbox||!Withdrawal||typeof Withdrawal.create!=='function')throw Error('proof_dependency_unavailable');
    async function stored(requestId,amount){
      var base=Core.defaultVillageLayout(),requested=clone(base),snapshotJson=JSON.stringify({revision:7,currentLayout:base});
      requested.items[0].x=base.items[0].x>2?base.items[0].x-amount:base.items[0].x+amount;
      var jm=new Map(),qm=new Map(),setup={journalReads:0,journalWrites:0,outboxReads:0,outboxWrites:0};
      var journal=Journal.create({repository:{async read(){setup.journalReads++;return jm.has('draft')?jm.get('draft'):null;},async compareAndSwap(expected,next){if((jm.has('draft')?jm.get('draft'):null)!==expected)return 'conflict';setup.journalWrites++;jm.set('draft',next);return 'committed';}}});
      var draft=await journal.recordDraft({requestId:requestId,snapshotJson:snapshotJson,proposalJson:JSON.stringify({version:1,expectedRevision:7,requestedLayout:requested})});
      if(!draft.ok)throw Error('proof_fixture_draft_unavailable');
      var outbox=Outbox.create({journal:journal,repository:{async read(){setup.outboxReads++;return qm.has('slot')?qm.get('slot'):null;},async compareAndSwap(expected,next){if((qm.has('slot')?qm.get('slot'):null)!==expected)return 'conflict';setup.outboxWrites++;qm.set('slot',next);return 'committed';}}});
      var queued=await outbox.enqueue({snapshotJson:snapshotJson});if(!queued.ok||queued.status!=='queued')throw Error('proof_fixture_outbox_unavailable');
      return {queuedRaw:qm.get('slot'),journalMap:jm,journalRaw:jm.get('draft'),setup:setup};
    }
    async function fixture(id){
      var a=await stored('withdrawal-example',1),b=null,map=new Map([['slot',a.queuedRaw]]),metrics={repositoryReads:0,repositoryCAS:0,ownMapClears:0,simulatedConcurrentWrites:0,originalJournalReads:0,originalJournalWrites:0,responseGetterCalls:0};
      if(['differentid','differentpayload','casconflict'].indexOf(id)>=0)b=await stored(id==='differentid'?'another-local-example':'withdrawal-example',2);
      if(id==='differentid'||id==='differentpayload')map.set('slot',b.queuedRaw);
      if(id==='empty')map.delete('slot');if(id==='corrupt')map.set('slot','{');
      var rawBefore=map.has('slot')?map.get('slot'):null;
      var repository={async read(){metrics.repositoryReads++;if(id==='readfail')throw Error('synthetic_read_failed');if(id==='malformed'){var object={};Object.defineProperty(object,'bad',{enumerable:true,get:function(){metrics.responseGetterCalls++;return true;}});return object;}return map.has('slot')?map.get('slot'):null;},async compareAndSwap(expected,next){
        metrics.repositoryCAS++;
        if(id==='unsupported')throw Error('synthetic_adapter_cannot_clear');
        if(id==='casconflict'){map.set('slot',b.queuedRaw);metrics.simulatedConcurrentWrites++;}
        if((map.has('slot')?map.get('slot'):null)!==expected)return 'conflict';
        if(next!==null)throw Error('proof_non_null_write_forbidden');map.delete('slot');metrics.ownMapClears++;
        if(id==='unknown')throw Error('synthetic_ACK_unavailable');return 'committed';
      }};
      return {consumer:Withdrawal.create({repository:repository}),expectedQueuedJson:id==='invalid'?'{}':a.queuedRaw,map:map,metrics:metrics,rawBefore:rawBefore,journalMap:a.journalMap,journalRaw:a.journalRaw,originalSetup:a.setup,setupSnapshot:clone(a.setup),fixtureInitialJournalWrites:a.setup.journalWrites,fixtureInitialOutboxWrites:a.setup.outboxWrites,otherInitialWrites:b?b.setup.journalWrites+b.setup.outboxWrites:0};
    }
    var expected={inspect:'stored_local',withdraw:'withdrawn_local',differentid:'queue_conflict',differentpayload:'queue_conflict',empty:'queue_empty_unattributed',corrupt:'corrupt_queue',readfail:'queue_read_failed',casconflict:'queue_conflict',invalid:'invalid_expected_queue',malformed:'corrupt_queue',unsupported:'write_outcome_unknown',unknown:'write_outcome_unknown','read-empty':'empty_unattributed','retry-empty':'queue_empty_unattributed'};
    ids.forEach(function(id){buttons[id].addEventListener('click',async function(){
      if(busy||buttons[id].disabled)return;busy=true;controls();status.textContent='このページ専用の控えを確認しています。';var s,before;
      try{
        var reusedUnknownFixture=['read-empty','retry-empty'].indexOf(id)>=0;
        s=reusedUnknownFixture?unknownSession:await fixture(id);before=clone(s.metrics);
        var rawAtActionStart=s.map.has('slot')?s.map.get('slot'):null;
        var reply=id==='inspect'||id==='read-empty'?await s.consumer.inspect():await s.consumer.withdraw({expectedQueuedJson:s.expectedQueuedJson});
        var delta=difference(s.metrics,before),token=reply.ok?reply.status:reply.error,rawAfter=s.map.has('slot')?s.map.get('slot'):null;
        var expectCAS=['withdraw','casconflict','unsupported','unknown'].indexOf(id)>=0?1:0,expectClear=['withdraw','unknown'].indexOf(id)>=0?1:0;
        var journalUnchanged=s.journalMap.get('draft')===s.journalRaw&&JSON.stringify(s.originalSetup)===JSON.stringify(s.setupSnapshot);
        var verified=token===expected[id]&&delta.repositoryReads===(id==='invalid'?0:1)&&delta.repositoryCAS===expectCAS&&delta.ownMapClears===expectClear&&delta.originalJournalReads===0&&delta.originalJournalWrites===0&&delta.responseGetterCalls===0&&journalUnchanged&&frozen(reply)&&reply.scope==='explicit_local_preparation';
        if(['withdraw','unknown','read-empty','retry-empty','empty'].indexOf(id)>=0)verified=verified&&rawAfter===null;
        else if(id!=='casconflict')verified=verified&&rawAfter===s.rawBefore;
        if(id==='inspect')verified=verified&&reply.expectedQueuedJson===s.rawBefore&&reply.freshness==='not_checked'&&reply.queued.record.receipt.stage==='unsubmitted';
        if(id==='read-empty')verified=verified&&reply.queued===null&&reply.expectedQueuedJson===null;
        if(id==='casconflict')verified=verified&&delta.simulatedConcurrentWrites===1&&rawAfter!==s.rawBefore;
        if(id==='unknown')unknownSession=s;
        append(id,{verified:!!verified,reply:reply,delta:delta,originalJournalUnchanged:journalUnchanged,slotEmptyAfterObservation:rawAfter===null,slotUnchangedDuringThisAction:rawAfter===rawAtActionStart,fullyFrozenReply:frozen(reply),reusedUnknownFixture:reusedUnknownFixture,fixtureInitialJournalWritesThisAction:reusedUnknownFixture?0:s.fixtureInitialJournalWrites,fixtureInitialOutboxWritesThisAction:reusedUnknownFixture?0:s.fixtureInitialOutboxWrites,otherFixtureInitialWritesThisAction:reusedUnknownFixture?0:s.otherInitialWrites,initializationNotConsumerWrite:true,separateExplicitManualAction:true});
        var messages={inspect:'ページ内の控えを読み取りました。送信や書き換えはしていません。',withdraw:'選んだ控えと内容が同じため、ローカルの待ち控えだけを取り下げました。',differentid:'別のIDの控えを取り下げずに止めました。',differentpayload:'同じIDでも内容が違うため、取り下げずに止めました。',empty:'空欄でした。以前の取り下げ成功とは扱いません。',corrupt:'壊れた控えを変更せずに止めました。',readfail:'読み取りに失敗しました。控えの内容は未確認です。',casconflict:'途中で別の控えに変わったため、その内容を残して止めました。',invalid:'指定の形式が違うため、保存先を読む前に止めました。',malformed:'読み取り応答の形式が違うため、書き換えずに止めました。',unsupported:'保存先が空欄への書き込みに対応していません。成功とは扱いません。',unknown:'結果の返事が不明です。自動でやり直していません。','read-empty':'今は空欄です。先ほどの取り下げが成功した証明にはなりません。','retry-empty':'空欄なので追加の書き換えをせず止めました。以前の成功とは扱いません。'};
        status.textContent=verified?messages[id]:'この例の結果は未確認です。観測記録を確認してください。';
      }catch(error){append(id,{verified:false,error:'proof_observation_failed',delta:s&&before?difference(s.metrics,before):null});status.textContent='見本の結果は未確認です。';}
      finally{busy=false;controls();buttons[id].focus({preventScroll:true});}
    });});
    window.__contractorWithdrawalProof=Object.freeze({getReport:getReport});ready=true;controls();status.textContent='各ボタンで、ページ専用の架空の例を確認できます。';report.textContent=JSON.stringify(getReport(),null,2);report.dataset.observations='0';
  }catch(error){ready=false;controls();status.textContent='見本を読み込めませんでした。結果は未確認です。';}
}());
