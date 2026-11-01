(function(){
  'use strict';
  var button=document.getElementById('run'),status=document.getElementById('status');
  var Core=window.PetGameCore,Intent=window.PetContractorIntent;
  function clone(value){return JSON.parse(JSON.stringify(value));}
  function prepare(){
    if(!Core||!Intent||typeof Intent.inspect!=='function')throw Error('検証見本の読み込みを確認できませんでした。');
    var current=Core.defaultVillageLayout(),requested=clone(current),revision=7;
    requested.items[0].x=requested.items[0].x===100?99:requested.items[0].x+1;
    var snapshot=JSON.stringify({revision:revision,currentLayout:current});
    function proposal(layout,version){return JSON.stringify({version:1,expectedRevision:version===undefined?revision:version,requestedLayout:layout});}
    var duplicate=clone(requested);duplicate.items[1].id=duplicate.items[0].id;
    var unsupported=clone(requested);unsupported.notSupported=true;
    var outside=clone(requested);outside.items[0].x=101;
    return {snapshot:snapshot,source:JSON.stringify(current),current:current,cases:[
      {name:'形式と保存版が合う希望データ',input:proposal(requested),ok:true},
      {name:'同じ位置の希望データ',input:proposal(current),ok:true},
      {name:'古い保存版を参照するデータ',input:proposal(requested,revision-1),error:'stale_revision'},
      {name:'同じ場所IDを重ねたデータ',input:proposal(duplicate),error:'invalid_proposal'},
      {name:'対象外の項目を含むデータ',input:proposal(unsupported),error:'invalid_proposal'},
      {name:'既存の座標範囲を外れるデータ',input:proposal(outside),error:'invalid_proposal'},
      {name:'希望する配置が欠けたデータ',input:JSON.stringify({version:1,expectedRevision:revision}),error:'invalid_proposal'},
      {name:'JSONとして読めないデータ',input:'{',error:'invalid_proposal'}
    ]};
  }
  try{
    var examples=prepare();button.disabled=false;status.textContent='手動で検証例を実行できます。';
    button.addEventListener('click',function(){
      button.disabled=true;
      var list=document.getElementById('results');list.replaceChildren();
      list.dataset.verified='0';list.dataset.snapshotUnchanged='unverified';
      document.getElementById('report').textContent='入力チェックはまだ完了していません。';
      try{
        var results=examples.cases.map(function(row){
          var result=Intent.inspect(examples.snapshot,row.input);
          var matches=row.ok?result.ok===true&&result.stage==='unsubmitted':result.ok===false&&result.error===row.error;
          var li=document.createElement('li'),name=document.createElement('span'),outcome=document.createElement('strong');
          name.textContent=row.name;outcome.textContent=matches?'確認できました':'確認未完';li.append(name,outcome);list.appendChild(li);
          return {example:row.name,expected:row.ok?'unsubmitted':row.error,matched:matches,result:result};
        });
        var preserved=JSON.stringify(examples.current)===examples.source;
        var passed=results.filter(function(row){return row.matched;}).length;
        status.textContent=passed===examples.cases.length&&preserved?'8例の入力チェックを確認しました。元の配置データは変更していません。':'入力チェックの確認が完了していません。';
        document.getElementById('report').textContent=JSON.stringify({schemaVersion:Intent.version,examples:results,
          suppliedSnapshotUnchanged:preserved,scope:'unsubmitted schema/revision examples only'},null,2);
        list.dataset.verified=String(passed);list.dataset.snapshotUnchanged=String(preserved);
      }catch(error){
        status.textContent='入力チェックを完了できませんでした。結果は未確認です。';
        document.getElementById('report').textContent='入力チェックは未確認です。';
      }finally{button.disabled=false;}
    });
  }catch(error){status.textContent='検証見本の読み込みを確認できませんでした。';}
}());
