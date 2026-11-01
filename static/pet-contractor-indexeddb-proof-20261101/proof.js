(function(){
  'use strict';
  var Provider=window.PetContractorIndexedDBRepository,Journal=window.PetContractorDraftJournal,Core=window.PetGameCore;
  var byId=function(id){return document.getElementById(id);},handle=null,channel=null,config=null,busy=false;
  var partnerConnected=false,raceId=null,gate=null,ready={},results={},closeWait=null;
  var report={version:1,scope:'dedicated_owned_QA_IndexedDB_only',origin:location.origin,
    ownerGameSaveAccessed:false,normalGameEntryAdded:false,commissionAccepted:false,
    constructionStarted:false,constructionCompleted:false,formalTestCreditFromThisUI:0,
    observations:[],race:null,reopen:null,reload:null,negativeControls:null,cleanup:null};
  function clone(x){return JSON.parse(JSON.stringify(x));}
  function safeError(e){return e&&typeof e.message==='string'&&/^[a-z_]+$/.test(e.message)?e.message:'unexpected_proof_error';}
  function hex(bytes){return Array.from(bytes,function(n){return n.toString(16).padStart(2,'0');}).join('');}
  function randomHex(n){return hex(crypto.getRandomValues(new Uint8Array(n)));}
  async function digest(raw){return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))));}
  function options(token,name){return {indexedDBFactory:window.indexedDB,dbName:name||config.dbName,ownerToken:token||config.ownerToken};}
  function valid(x){return x&&typeof x==='object'&&Object.keys(x).sort().join(',')==='dbName,expectedHash,ownerToken,phase,role,v'&&
    x.v===1&&['main','partner'].includes(x.role)&&['created','partner','reload'].includes(x.phase)&&
    /^pet-contractor-idb-qa-20261101-[a-f0-9]{32}$/.test(x.dbName)&&/^[a-f0-9]{64}$/.test(x.ownerToken)&&
    (x.expectedHash===null||/^[a-f0-9]{64}$/.test(x.expectedHash));}
  function fragment(x){return '#qa='+encodeURIComponent(JSON.stringify(x));}
  function setFragment(x){history.replaceState(null,'',location.pathname+location.search+fragment(x));}
  function controls(){
    byId('create').disabled=busy||!!config;
    byId('connect').disabled=busy||!config||!!handle;
    byId('race').disabled=busy||!handle||config.role!=='main'||!partnerConnected||!!report.race;
    byId('negative').disabled=busy||!handle||config.role!=='main';
    byId('reopen').disabled=busy||!handle||config.role!=='main'||!report.race||!report.race.oneCommitOneConflict||
      !report.race.journalCompatibility||!report.race.journalCompatibility.replayed||!report.race.journalCompatibility.changedRequestConflict;
    byId('reload-ready').disabled=busy||!handle||config.role!=='main'||!report.reopen||!report.reopen.exactRawRetained;
    byId('cleanup').disabled=busy||!handle||config.role!=='main';
  }
  function render(message){
    if(message)byId('status').textContent=message;
    report.connection=handle?handle.diagnostics():null;
    report.namespace=config?{dbName:config.dbName,role:config.role,phase:config.phase}:null;
    byId('report').textContent=JSON.stringify(report,null,2);controls();
  }
  function observe(kind,data){report.observations.push({kind:kind,data:clone(data)});render();}
  function send(type,data){if(channel)channel.postMessage({type:type,token:config.ownerToken,role:config.role,data:data||null});}
  function attachChannel(){
    if(channel)channel.close();
    channel=new BroadcastChannel('pet-contractor-idb-proof:'+config.dbName);
    channel.onmessage=function(event){
      var m=event.data;
      if(!m||m.token!==config.ownerToken||m.role===config.role)return;
      if(m.type==='connected'&&config.role==='main'){
        partnerConnected=true;observe('partner_connected',{dbName:config.dbName});render('相手タブの接続を確認しました。');
      }else if(m.type==='prepare'&&config.role==='partner'&&handle&&!raceId){
        raceId=m.data.raceId;runRace().catch(function(e){observe('race_error',{error:safeError(e)});send('race_error',{error:safeError(e)});});
      }else if(m.type==='ready'&&config.role==='main'&&m.data.raceId===raceId){
        ready.partner=true;releaseWhenReady();
      }else if(m.type==='release'&&config.role==='partner'&&m.data.raceId===raceId&&gate){gate();gate=null;
      }else if(m.type==='result'&&config.role==='main'&&m.data.raceId===raceId){results.partner=m.data;finishRace();
      }else if(m.type==='close'){
        if(handle){handle.close();handle=null;}
        send('closed',{dbName:config.dbName});render('このタブの接続を閉じました。');
      }else if(m.type==='closed'&&config.role==='main'&&closeWait){var done=closeWait;closeWait=null;done();
      }else if(m.type==='deleted'){
        report.cleanup={status:'partner_notified_owned_QA_deleted',dbName:config.dbName};
        history.replaceState(null,'',location.pathname+location.search);render('主タブで専用の見本を片付けました。');
      }else if(m.type==='race_error'&&config.role==='main')observe('partner_race_error',m.data);
    };
  }
  function input(role){
    var base=Core.defaultVillageLayout(),requested=clone(base);
    requested.items[0].x=role==='main'?19:23;
    return {requestId:'qa-'+role+'-draft',snapshotJson:JSON.stringify({revision:7,currentLayout:base}),
      proposalJson:JSON.stringify({version:1,expectedRevision:7,requestedLayout:requested})};
  }
  function releaseWhenReady(){
    if(ready.main&&ready.partner&&gate){send('release',{raceId:raceId});var done=gate;gate=null;done();}
  }
  async function runRace(){
    var measured={raceId:raceId,role:config.role,casCalls:0,acknowledgements:[],initialReadWasNull:false};
    var repository={
      read:async function(){
        var raw=await handle.repository.read();
        if(raw!==null)throw Error('race_requires_empty_owned_slot');
        measured.initialReadWasNull=true;
        var wait=new Promise(function(resolve){gate=resolve;});
        if(config.role==='main'){ready.main=true;releaseWhenReady();}
        else send('ready',{raceId:raceId});
        await wait;return raw;
      },
      compareAndSwap:async function(expected,next){
        measured.casCalls++;var ack=await handle.repository.compareAndSwap(expected,next);
        measured.acknowledgements.push(ack);return ack;
      }
    };
    var answer=await Journal.create({repository:repository}).recordDraft(input(config.role));
    measured.journalResult=answer;measured.provider=handle.diagnostics();
    observe('race_client_result',measured);
    if(config.role==='partner'){send('result',measured);render('相手タブの競合操作が終了しました。主タブの記録を確認してください。');}
    else {results.main=measured;finishRace();}
  }
  async function finishRace(){
    if(!results.main||!results.partner||report.race)return;
    var clients=[results.main,results.partner],acks=clients.flatMap(function(x){return x.acknowledgements;});
    report.race={raceId:raceId,clients:clone(clients),totalCASAttempts:clients.reduce(function(n,x){return n+x.casCalls;},0),
      initialReadsBothNull:clients.every(function(x){return x.initialReadWasNull;}),
      oneCommitOneConflict:acks.length===2&&acks.filter(function(x){return x==='committed';}).length===1&&acks.filter(function(x){return x==='conflict';}).length===1};
    try{
      var journal=Journal.create({repository:handle.repository}),read=await journal.readDraft();
      if(!read.ok||!read.record)throw Error('race_readback_failed');
      var winner=read.record.requestId==='qa-main-draft'?'main':'partner';
      var replay=await journal.recordDraft(input(winner));
      var conflict=await journal.recordDraft(input(winner==='main'?'partner':'main'));
      report.race.journalCompatibility={read:read,replay:replay,changedRequest:conflict,
        winnerRecorded:clients.filter(function(x){return x.journalResult.ok&&x.journalResult.status==='recorded';}).length===1,
        replayed:replay.ok&&replay.status==='replayed',changedRequestConflict:!conflict.ok&&conflict.error==='journal_conflict'};
      report.race.committedRawHash=await digest(await handle.repository.read());
      render(report.race.oneCommitOneConflict?'一方が保存完了、もう一方が競合しました。':'競合確認に未完の結果があります。');
    }catch(e){report.race.compatibilityError=safeError(e);render('競合後の読取が未完です。');}
  }
  function closePartner(){
    if(!partnerConnected&&config.phase!=='reload')return Promise.resolve();
    return new Promise(function(resolve,reject){
      var timer=setTimeout(function(){closeWait=null;reject(Error('partner_close_unconfirmed'));},5000);
      closeWait=function(){clearTimeout(timer);resolve();};send('close');
    });
  }
  async function action(fn){
    if(busy)return;busy=true;controls();
    try{await fn();}catch(e){observe('operation_failed',{error:safeError(e)});render('確認が未完です。記録の理由を確認してください。');}
    finally{busy=false;render();}
  }
  byId('create').onclick=function(){action(async function(){
    if(config)throw Error('namespace_already_selected');
    var selected={v:1,role:'main',dbName:'pet-contractor-idb-qa-20261101-'+randomHex(16),ownerToken:randomHex(32),phase:'created',expectedHash:null};
    var created=await Provider.createOwned({indexedDBFactory:window.indexedDB,dbName:selected.dbName,ownerToken:selected.ownerToken});
    config=selected;handle=created;setFragment(config);attachChannel();
    var partner=Object.assign({},config,{role:'partner',phase:'partner'}),link=byId('partner-link');
    link.href=location.pathname+fragment(partner);link.textContent='同じ専用見本を相手タブで開く';link.removeAttribute('aria-disabled');link.target='_blank';link.rel='noopener';
    observe('created_owned_QA',{dbName:config.dbName,initial:await Journal.create({repository:handle.repository}).readDraft()});
    render('新しい専用見本を作りました。相手タブのリンクを開いてください。');
  });};
  byId('connect').onclick=function(){action(async function(){
    if(!config||!valid(config)||handle)throw Error('invalid_proof_namespace');
    handle=await Provider.openOwned(options());attachChannel();
    var raw=await handle.repository.read(),read=await Journal.create({repository:handle.repository}).readDraft();
    observe('opened_existing_owned_QA',{dbName:config.dbName,rawHash:raw===null?null:await digest(raw),journal:read});
    if(config.role==='partner'){send('connected');render('相手タブとして接続しました。主タブで競合確認を始めてください。');}
    else if(config.phase==='reload'){
      report.reload={expectedHash:config.expectedHash,actualHash:raw===null?null:await digest(raw),
        exactRawHashRetained:raw!==null&&await digest(raw)===config.expectedHash,journal:read,
        proofNamespaceFromExplicitFragment:true,recordDraftCalledAfterReload:false};
      render(report.reload.exactRawHashRetained?'再読込後も同じ未提出下書きを読みました。':'再読込後の照合は未完です。');
    }else render('既存の専用見本に接続しました。');
  });};
  byId('race').onclick=function(){action(async function(){
    if(!handle||!partnerConnected||report.race||raceId)throw Error('race_not_ready');
    raceId=randomHex(8);ready={};results={};send('prepare',{raceId:raceId});
    await runRace();render('二つの接続の結果を待ち、記録を照合します。');
  });};
  byId('negative').onclick=function(){action(async function(){
    var wrong=config.ownerToken[0]==='a'?'b':'a';wrong+=config.ownerToken.slice(1);
    var missing='pet-contractor-idb-qa-20261101-'+randomHex(16),found={};
    try{var x=await Provider.openOwned(options(wrong));x.close();found.wrongOwner='unexpected_success';}
    catch(e){found.wrongOwner=safeError(e);}
    try{var y=await Provider.openOwned(options(config.ownerToken,missing));y.close();found.missing='unexpected_success';}
    catch(e){found.missing=safeError(e);}
    found.missingOwnedControlName=missing;found.unexpectedCreationMustAbort=true;
    found.passed=found.wrongOwner==='idb_ownership_mismatch'&&found.missing==='idb_missing_database';
    report.negativeControls=found;render(found.passed?'所有情報の不一致と未作成領域を拒否しました。':'拒否確認に未完の結果があります。');
  });};
  byId('reopen').onclick=function(){action(async function(){
    var before=await handle.repository.read();await closePartner();handle.close();handle=null;
    handle=await Provider.openOwned(options());var after=await handle.repository.read();
    report.reopen={bothOriginalConnectionsClosed:true,beforeHash:await digest(before),afterHash:await digest(after),
      exactRawRetained:before===after,journal:await Journal.create({repository:handle.repository}).readDraft()};
    render(report.reopen.exactRawRetained?'二つの接続を閉じ、同じ下書きを開き直しました。':'開き直しの照合は未完です。');
  });};
  byId('reload-ready').onclick=function(){action(async function(){
    var raw=await handle.repository.read();config=Object.assign({},config,{phase:'reload',expectedHash:await digest(raw)});setFragment(config);
    observe('ready_for_one_normal_reload',{expectedHash:config.expectedHash,dbName:config.dbName});
    render('再読込の準備ができました。通常の再読込後に「既存の見本を開く」を押してください。');
  });};
  byId('cleanup').onclick=function(){action(async function(){
    var name=config.dbName;await closePartner();handle.close();handle=null;
    var deleted=await Provider.deleteOwned(options());report.cleanup=deleted;
    send('deleted');history.replaceState(null,'',location.pathname+location.search);
    observe('owned_QA_cleanup',{dbName:name,status:deleted.status,enumerationUsed:false,otherDatabasesTouched:false});
    render('この見本で作った専用領域だけを片付けました。');
  });};
  window.addEventListener('pagehide',function(){if(handle)handle.close();if(channel)channel.close();});
  try{
    if(location.hash){
      if(!location.hash.startsWith('#qa='))throw Error('invalid_proof_fragment');
      config=JSON.parse(decodeURIComponent(location.hash.slice(4)));if(!valid(config))throw Error('invalid_proof_fragment');
      observe('explicit_QA_fragment_selected',{dbName:config.dbName,role:config.role,phase:config.phase,storageOpened:false});
    }
  }catch(e){config=null;report.fragmentRejected=true;render('見本の指定が不正です。保存領域を開いていません。');}
  render();
}());
