/* Display source dates relative to the Japanese calendar, including cached data. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.KNDividendDates=api;})(typeof window==='undefined'?null:window,function(){
 'use strict';
 function classify(value,now=Date.now(),monthly=false){
  const pattern=monthly?/^\d{4}-(0[1-9]|1[0-2])$/:/^\d{4}-\d{2}-\d{2}$/;
  if(typeof value!=='string'||!pattern.test(value))return {state:'unknown',date:null};
  const check=new Date(value+(monthly?'-01':'')+'T00:00:00Z');
  if(!Number.isFinite(check.getTime())||check.toISOString().slice(0,monthly?7:10)!==value)return {state:'unknown',date:null};
  const today=new Date(now+9*3600000).toISOString().slice(0,monthly?7:10);
  return {state:value<today?'past':value===today?'current':'future',date:value};
 }
 function describe(value,now=Date.now(),monthly=false){
  const result=classify(value,now,monthly);
  if(result.state==='unknown')return '次回未確認';
  const display=value.replace(/-/g,'/');
  if(result.state==='past')return '次回未確認（過去の記録：'+display+'）';
  return display+(result.state==='current'?(monthly?'（今月の予定）':'（本日の予定）'):'（予定）');
 }
 return {classify,describe};
});
