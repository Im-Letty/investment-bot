(function(){
  'use strict';
  var ids=['create','open','read','reopen','close','draft','enqueue','inspect','withdraw','cache','cas-delete','unknown','unknown-read','unknown-retry','wrong-owner','cleanup','missing','clear-fragment'];
  var buttons={},status=document.getElementById('status'),report=document.getElementById('report'),count=document.getElementById('count'),setup=document.getElementById('setup'),join=document.getElementById('join');
  var ready=false,busy=false,config=null,fragmentCleared=false,handle=null,handles=[],observations=[],totalObservations=0,droppedObservations=0;
  var createAttempted=false,cleanupAttempted=false,cleanupDone=false,missingAttempted=false,cachedRaw=null,withdrawExpected=null,unknownExpected=null;
  var journal=null,journalMap=null,journalInitialRaw=null,snapshotJson=null;
  var metric={createCalls:0,openCalls:0,reopenActions:0,closeCalls:0,wrongOwnerOpenCalls:0,deleteOwnedCalls:0,missingOpenCalls:0,journalMapReads:0,journalMapCAS:0,journalMapWrites:0,consumerEnqueueCalls:0,consumerInspectCalls:0,consumerWithdrawCalls:0,rawRepositoryReads:0,rawRepositoryCAS:0,unknownWrapperCAS:0,unknownWrapperCompletedDeletes:0,unknownWrapperSuppressedCommittedACKs:0,unknownAutomaticReadsOrRetries:0};
  var diagnosticKeys=['ownershipTransactions','ownershipCompletions','readTransactions','readCompletions','casTransactions','casTransactionCompletions','putRequestSuccesses','deleteRequestSuccesses','committedAcknowledgements','conflictCompletions','aborts'];
  var consumerCountKeys=['draftReviewCalls','journalReads','reviewRevalidationReads','outboxReads','outboxRevalidationReads','outboxCAS','repositoryReads','expectedValidationReads','expectedRecordRevalidationReads','actualValidationReads','actualRecordRevalidationReads','repositoryCAS'];
  var allowedErrors=['outbox_idb_invalid_options','outbox_idb_invalid_name','outbox_idb_invalid_owner','outbox_idb_ownership_mismatch','outbox_idb_missing_database','outbox_idb_open_blocked','outbox_idb_open_failed','outbox_idb_open_validation_failed','outbox_idb_schema_mismatch','outbox_idb_corrupt_slot','outbox_idb_transaction_failed','outbox_idb_transaction_aborted','outbox_idb_transaction_outcome_missing','outbox_idb_closed','outbox_idb_invalid_cas','outbox_idb_delete_blocked','outbox_idb_delete_failed'];
  var Core=window.PetGameCore,Journal=window.PetContractorDraftJournal,Outbox=window.PetContractorRequestOutbox,Withdrawal=window.PetContractorQueueWithdrawal,IDB=window.PetContractorOutboxIndexedDBRepository;
  function clone(x){return JSON.parse(JSON.stringify(x));}
  function delta(a,b){var out={};Object.keys(a).forEach(function(k){out[k]=typeof a[k]==='number'&&typeof b[k]==='number'&&Number.isFinite(a[k])&&Number.isFinite(b[k])?a[k]-b[k]:null;});return out;}
  function canonical(x){if(Array.isArray(x))return '['+x.map(canonical).join(',')+']';if(x&&typeof x==='object')return '{'+Object.keys(x).sort().map(function(k){return JSON.stringify(k)+':'+canonical(x[k]);}).join(',')+'}';return JSON.stringify(x);}
  function finiteCount(x){return typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;}
  function diagnostics(h){
    var d=h.diagnostics(),out={closed:d.closed===true,requestedWriteDurability:d.requestedWriteDurability==='strict'?'strict':'unobserved',lastActualWriteDurability:['strict','relaxed','default'].indexOf(d.lastActualWriteDurability)>=0?d.lastActualWriteDurability:null};
    diagnosticKeys.forEach(function(k){out[k]=finiteCount(d[k])?d[k]:null;});return out;
  }
  function totals(){
    var out={};diagnosticKeys.forEach(function(k){out[k]=0;});
    handles.forEach(function(h){var d=diagnostics(h);diagnosticKeys.forEach(function(k){if(d[k]===null)out[k]=null;else if(out[k]!==null)out[k]+=d[k];});});return out;
  }
  function safeError(error){var message;try{message=error&&error.message;}catch(ignore){return 'proof_action_unavailable';}return allowedErrors.indexOf(message)>=0?message:'proof_action_unavailable';}
  function replyProjection(value){
    var out={ok:!!value&&value.ok===true};
    ['status','error','scope','freshness'].forEach(function(k){if(value&&typeof value[k]==='string'&&/^[a-z_]{1,80}$/.test(value[k]))out[k]=value[k];});
    if(value&&value.counts){out.counts={};consumerCountKeys.forEach(function(k){if(finiteCount(value.counts[k]))out.counts[k]=value.counts[k];});}
    var queued=value&&value.queued,record=value&&value.record;
    if(queued){out.queuedStage=queued.receipt&&queued.receipt.stage==='queued_for_review'?'queued_for_review':'unverified';out.queuedJournalStage=queued.record&&queued.record.receipt&&queued.record.receipt.stage==='unsubmitted'?'unsubmitted':'unverified';}
    if(record)out.journalStage=record.receipt&&record.receipt.stage==='unsubmitted'?'unsubmitted':'unverified';
    return out;
  }
  function currentJournalRaw(){return journalMap&&journalMap.has('draft')?journalMap.get('draft'):null;}
  function journalState(){return {prepared:journal!==null,stage:journalInitialRaw!==null&&currentJournalRaw()===journalInitialRaw?'unsubmitted':journal===null?'not_prepared':'unverified',originalStoredRawStillExact:journal===null?null:journalInitialRaw!==null&&currentJournalRaw()===journalInitialRaw,sameControlNotCarriedAcrossReload:true};}
  function getReport(){return clone({schemaVersion:1,scope:'dedicated_owned_QA_outbox_IndexedDB_nullable_exact_raw_CAS_only',ready:ready,fragmentValid:config!==null,fragmentValuesAndDatabaseNameOmitted:true,fragmentCleared:fragmentCleared,storageAutomaticOnDocumentLoad:0,storageAutomaticOnReload:0,documentLifetimeCountersResetOnReload:true,currentHandleOpen:handle!==null,returnedHandleCount:handles.length,handleDiagnostics:handles.map(diagnostics),returnedHandlesDiagnosticsTotal:totals(),diagnosticTotalsScope:'returned_handles_in_this_document_only_internal_failed_open_or_cleanup_handles_not_counted',manualCalls:metric,journal:journalState(),cachedRawPresent:typeof cachedRaw==='string',normalWithdrawalTargetPresent:typeof withdrawExpected==='string',unknownTargetRetainedForExplicitManualReadOrRetry:typeof unknownExpected==='string',cleanupAttempted:cleanupAttempted,cleanupDone:cleanupDone,missingOpenAttempted:missingAttempted,manualObservationCount:totalObservations,retainedObservations:observations.length,droppedOldObservationCount:droppedObservations,formalTestCredit:0,rawCASExperimentSeparateFromFreshReadWithdrawal:true,requestSuccessTransactionCompleteAndCallerACKAreSeparate:true,strictRequestIsNotPhysicalFlushOrPowerLossGuarantee:true,ownerGameOrOldJournalIndexedDBConnected:false,externalSendAcceptanceCancellationConstruction:false,observations:observations});}
  function render(){report.textContent=JSON.stringify(getReport(),null,2);report.dataset.observations=String(totalObservations);report.dataset.ready=String(ready);count.textContent='この文書での手動観測 '+totalObservations+' 回';}
  function controls(){
    ids.forEach(function(id){var enabled=ready&&!busy&&config!==null;
      if(['create','open','wrong-owner'].indexOf(id)>=0)enabled=enabled&&handle===null&&!cleanupDone;
      if(id==='create')enabled=enabled&&!createAttempted;
      if(['read','reopen','close','cache','cas-delete','enqueue','inspect','withdraw','unknown','unknown-read','unknown-retry'].indexOf(id)>=0)enabled=enabled&&handle!==null;
      if(id==='draft')enabled=enabled&&journal===null;
      if(id==='enqueue')enabled=enabled&&journal!==null;
      if(id==='cas-delete')enabled=enabled&&typeof cachedRaw==='string';
      if(id==='withdraw'||id==='unknown')enabled=enabled&&typeof withdrawExpected==='string';
      if(id==='unknown-read'||id==='unknown-retry')enabled=enabled&&typeof unknownExpected==='string';
      if(id==='cleanup')enabled=enabled&&!cleanupAttempted&&handle===null;
      if(id==='missing')enabled=enabled&&cleanupDone&&!missingAttempted&&handle===null;
      if(id==='clear-fragment')enabled=enabled&&handle===null;
      buttons[id].disabled=!enabled;
    });
    var linkEnabled=ready&&!busy&&config!==null&&!cleanupDone;join.setAttribute('aria-disabled',String(!linkEnabled));join.tabIndex=linkEnabled?0:-1;
    if(linkEnabled)join.href=window.location.pathname+window.location.search+window.location.hash;else join.removeAttribute('href');
  }
  function options(owner){return {indexedDBFactory:window.indexedDB,dbName:config.name,ownerToken:owner===undefined?config.cap:owner};}
  function keep(h){if(!h||!h.repository||typeof h.repository.read!=='function'||typeof h.repository.compareAndSwap!=='function'||typeof h.close!=='function'||typeof h.diagnostics!=='function')throw Error('proof_handle_unavailable');handles.push(h);handle=h;return h;}
  function closeHandle(){if(handle!==null){metric.closeCalls++;handle.close();handle=null;}}
  function repository(){if(handle===null)throw Error('proof_handle_unavailable');return handle.repository;}
  function withdrawal(repo){return Withdrawal.create({repository:repo||repository()});}
  function observe(id,row){totalObservations++;observations.push(Object.assign({action:id,separateExplicitManualAction:true},row));if(observations.length>60){observations.shift();droppedObservations++;}render();}
  async function digest(raw){if(raw===null)return null;try{var b=await window.crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));return Array.from(new Uint8Array(b)).map(function(x){return x.toString(16).padStart(2,'0');}).join('');}catch(ignore){return null;}}
  async function action(id,operation){
    if(busy||buttons[id].disabled)return;busy=true;controls();status.textContent='明示した専用領域で、この操作だけを確認しています。';
    var before=clone(metric),diagBefore=totals(),journalBefore=currentJournalRaw(),journalControlBefore=journal!==null;
    try{
      var result=await operation();result.delta=delta(metric,before);result.returnedHandlesDiagnosticDelta=delta(totals(),diagBefore);result.journalControlPresentBeforeAction=journalControlBefore;result.journalRawUnchangedDuringAction=journalControlBefore?currentJournalRaw()===journalBefore:null;result.newMemoryJournalSetupThisAction=!journalControlBefore&&journal!==null;
      observe(id,result);status.textContent=result.verified?result.message:'この操作の結果は未確認です。観測記録を確認してください。';
    }catch(error){observe(id,{verified:false,safeError:safeError(error),delta:delta(metric,before),returnedHandlesDiagnosticDelta:delta(totals(),diagBefore),journalControlPresentBeforeAction:journalControlBefore,journalRawUnchangedDuringAction:journalControlBefore?currentJournalRaw()===journalBefore:null});status.textContent='この操作の結果は未確認です。自動ではやり直しません。';}
    finally{busy=false;controls();var focus=buttons[id].disabled?ids.map(function(k){return buttons[k];}).find(function(b){return !b.disabled;}):buttons[id];if(focus)focus.focus({preventScroll:true});}
  }
  var operations={
    create:async function(){createAttempted=true;metric.createCalls++;keep(await IDB.createOwned(options()));return {verified:true,message:'明示した専用領域を作りました。待ち控え本文はまだ読んでいません。',ownershipValidationSeparateFromSlotRead:true};},
    open:async function(){metric.openCalls++;keep(await IDB.openOwned(options()));return {verified:true,message:'専用領域の所有情報を確認して開きました。本文は別の操作で読みます。',ownershipValidationSeparateFromSlotRead:true};},
    read:async function(){metric.rawRepositoryReads++;var raw=await repository().read();return {verified:raw===null||typeof raw==='string',message:raw===null?'現在の待ち控えは空欄です。空になった原因は特定しません。':'現在の待ち控えを読みました。書き換えていません。',slotEmpty:raw===null,rawSHA256:await digest(raw),readOnly:true};},
    reopen:async function(){metric.reopenActions++;closeHandle();metric.openCalls++;keep(await IDB.openOwned(options()));return {verified:true,message:'接続を閉じ、同じ専用領域を開き直しました。本文の確認は「読む」で行います。',automaticSlotReads:0};},
    close:async function(){closeHandle();return {verified:true,message:'このタブの接続を閉じました。保存先は片付けていません。'};},
    draft:async function(){
      var base=Core.defaultVillageLayout(),requested=clone(base);requested.items[0].x=base.items[0].x>2?base.items[0].x-1:base.items[0].x+1;snapshotJson=JSON.stringify({revision:7,currentLayout:base});journalMap=new Map();
      journal=Journal.create({repository:{async read(){metric.journalMapReads++;return currentJournalRaw();},async compareAndSwap(expected,next){metric.journalMapCAS++;if(currentJournalRaw()!==expected)return 'conflict';metric.journalMapWrites++;journalMap.set('draft',next);return 'committed';}}});
      var reply=await journal.recordDraft({requestId:'outbox-idb-synthetic-example',snapshotJson:snapshotJson,proposalJson:JSON.stringify({version:1,expectedRevision:7,requestedLayout:requested})});
      if(reply.ok&&reply.status==='recorded')journalInitialRaw=currentJournalRaw();return {verified:reply.ok===true&&reply.status==='recorded'&&reply.record.receipt.stage==='unsubmitted',message:'ページ専用Mapに架空の未提出下書きを用意しました。IndexedDBにはまだ渡していません。',reply:replyProjection(reply),fixtureOnly:true};
    },
    enqueue:async function(){metric.consumerEnqueueCalls++;var reply=await Outbox.create({journal:journal,repository:repository()}).enqueue({snapshotJson:snapshotJson});return {verified:reply.ok===true&&['queued','replayed'].indexOf(reply.status)>=0&&journalState().originalStoredRawStillExact,message:'下書きの版と配置を照合し、ローカルの待ち控えを確認しました。元の下書きは未提出のままです。',reply:replyProjection(reply),existingConsumerUnchanged:true};},
    inspect:async function(){metric.consumerInspectCalls++;var reply=await withdrawal().inspect();withdrawExpected=reply.ok&&typeof reply.expectedQueuedJson==='string'?reply.expectedQueuedJson:null;return {verified:reply.ok===true&&['stored_local','empty_unattributed'].indexOf(reply.status)>=0,message:withdrawExpected===null?'今は空欄です。取り下げ成功の証明には使いません。':'この控え全体を、次の手動取り下げの対象として記憶しました。',reply:replyProjection(reply),rawSHA256:await digest(withdrawExpected)};},
    withdraw:async function(){metric.consumerWithdrawCalls++;var reply=await withdrawal().withdraw({expectedQueuedJson:withdrawExpected});return {verified:reply.ok===true&&reply.status==='withdrawn_local'||reply.ok===false&&['queue_empty_unattributed','queue_conflict'].indexOf(reply.error)>=0,message:reply.ok?'同じ対象だけをローカルで取り下げました。元の下書きは残ります。':'新しい読取結果が空欄または別の内容のため、取り下げ成功とは扱いません。',reply:replyProjection(reply),existingConsumerFreshRead:true};},
    cache:async function(){metric.rawRepositoryReads++;var raw=await repository().read();cachedRaw=typeof raw==='string'&&raw.length>0?raw:null;return {verified:raw===null||typeof raw==='string',message:cachedRaw===null?'空欄または空文字のため、競合実験用の本文は記憶していません。':'本文を競合実験用に記憶しました。もう一方のタブでも記憶してから、各タブで1回ずつ空にします。',cachedNonempty:cachedRaw!==null,rawSHA256:await digest(raw),freshReadWithdrawalNotInvoked:true};},
    'cas-delete':async function(){metric.rawRepositoryCAS++;var ack=await repository().compareAndSwap(cachedRaw,null);return {verified:ack==='committed'||ack==='conflict',message:ack==='committed'?'記憶した本文と一致し、削除トランザクションの完了を受け取りました。':'記憶した本文と一致しませんでした。追加の削除はしていません。',callerACK:ack==='committed'?'committed':ack==='conflict'?'conflict':'unrecognised',rawRepositoryExperiment:true,cachedExpectedRetained:true,existingWithdrawalCalls:0};},
    unknown:async function(){
      var repo=repository(),read=repo.read,cas=repo.compareAndSwap,beforeDelete=metric.unknownWrapperCompletedDeletes;unknownExpected=withdrawExpected;
      var wrapper={read:function(){return read.call(repo);},async compareAndSwap(expected,next){metric.unknownWrapperCAS++;if(next!==null)throw Error('proof_nullable_delete_required');var ack=await cas.call(repo,expected,next);if(ack==='committed'){metric.unknownWrapperCompletedDeletes++;metric.unknownWrapperSuppressedCommittedACKs++;throw Error('proof_completed_delete_ACK_suppressed');}return ack;}};
      metric.consumerWithdrawCalls++;var reply=await withdrawal(wrapper).withdraw({expectedQueuedJson:unknownExpected});return {verified:reply.ok===false&&reply.error==='write_outcome_unknown'&&reply.counts.repositoryCAS===1&&metric.unknownWrapperCompletedDeletes===beforeDelete+1,message:'取り下げ側の返事は結果不明です。自動読取や再試行はしていません。',reply:replyProjection(reply),wrapperThrowsOnlyAfterActualRepositoryCommittedACK:true,automaticReadOrRetryAfterReply:0};
    },
    'unknown-read':async function(){metric.consumerInspectCalls++;var reply=await withdrawal().inspect();return {verified:reply.ok===true&&reply.status==='empty_unattributed',message:'別の手動操作では空欄でした。以前の操作の成功や削除対象の証明には使いません。',reply:replyProjection(reply),retroactiveSuccessClaimed:false};},
    'unknown-retry':async function(){metric.consumerWithdrawCalls++;var reply=await withdrawal().withdraw({expectedQueuedJson:unknownExpected});return {verified:reply.ok===false&&reply.error==='queue_empty_unattributed'&&reply.counts.repositoryCAS===0,message:'空欄なので追加CASを行わず止めました。以前の取り下げ成功とは扱いません。',reply:replyProjection(reply),retroactiveSuccessClaimed:false};},
    'wrong-owner':async function(){
      metric.wrongOwnerOpenCalls++;var different=(config.cap[0]==='0'?'1':'0')+config.cap.slice(1),unexpected=null,code;
      try{unexpected=await IDB.openOwned(options(different));}catch(error){code=safeError(error);}if(unexpected)unexpected.close();
      return {verified:code==='outbox_idb_ownership_mismatch',message:'違うQA所有指定を受け付けずに止めました。既存の専用領域は変更していません。',safeError:code||'unexpected_open_success',unexpectedReturnedHandleClosed:unexpected!==null};
    },
    cleanup:async function(){cleanupAttempted=true;metric.deleteOwnedCalls++;var reply=await IDB.deleteOwned(options());cleanupDone=!!reply&&reply.status==='deleted_owned_outbox_qa';cachedRaw=null;withdrawExpected=null;return {verified:cleanupDone,message:'所有情報を確認した専用領域だけを片付けました。他の領域は列挙していません。',status:cleanupDone?'deleted_owned_outbox_qa':'unrecognised',otherDatabaseEnumeration:0};},
    missing:async function(){missingAttempted=true;metric.missingOpenCalls++;var unexpected=null,code;try{unexpected=await IDB.openOwned(options());}catch(error){code=safeError(error);}if(unexpected)unexpected.close();return {verified:code==='outbox_idb_missing_database',message:'片付けた領域を作り直さず、存在しないものとして開く操作を拒否しました。',safeError:code||'unexpected_open_success',unexpectedReturnedHandleClosed:unexpected!==null};},
    'clear-fragment':async function(){window.history.replaceState(null,'',window.location.pathname+window.location.search);config=null;fragmentCleared=true;cachedRaw=null;withdrawExpected=null;unknownExpected=null;setup.textContent='このタブのQA指定をURLから消しました。接続は閉じています。';return {verified:window.location.hash==='',message:'このタブの明示QA指定を消しました。保存先への操作はしていません。',storageCalls:0};}
  };
  ids.forEach(function(id){buttons[id]=document.getElementById(id);buttons[id].addEventListener('click',function(){action(id,operations[id]);});});
  try{
    if(!Core||!Journal||!Outbox||!Withdrawal||!IDB||typeof IDB.createOwned!=='function'||typeof IDB.openOwned!=='function'||typeof IDB.deleteOwned!=='function')throw Error('proof_dependencies_unavailable');
    var fragment=window.location.hash.slice(1),params=new URLSearchParams(fragment),keys=Array.from(params.keys());
    if(fragment.length<=1024&&keys.length===2&&keys.indexOf('db')>=0&&keys.indexOf('cap')>=0&&/^pet-contractor-outbox-idb-qa-[a-z0-9-]{1,80}$/.test(params.get('db')||'')&&/^[a-f0-9]{64}$/.test(params.get('cap')||''))config={name:params.get('db'),cap:params.get('cap')};
    ready=true;setup.textContent=config?'明示QA指定を読み取りました。保存先を開くには、下のボタンを使います。':'専用QAのdb名と64桁の架空cap指定が必要です。未指定のため、保存先は操作できません。';
    status.textContent=config?'各ボタンで1つずつ手動確認できます。読み込み時の保存操作は0回です。':'QA指定は未確認です。読み込み時の保存操作は0回です。';
  }catch(error){ready=false;setup.textContent='見本の依存関係を確認できませんでした。';status.textContent='保存先は操作していません。結果は未確認です。';}
  controls();render();
}());
