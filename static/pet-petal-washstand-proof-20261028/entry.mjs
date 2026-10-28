/* One startup attempt. Diagnostics contain enums/identifiers only, never URLs or stacks. */
const phases=new Set(['entry','module_loading','module_loaded','main_started','manifest_request','manifest_loaded','world_built','art_loading','art_ready','geometry_built','placement_ready','renderer_created','controls_bound','ready']);
export function failureDetails(error){
 const kind=['Error','SyntaxError','TypeError','ReferenceError','RangeError','URIError','EvalError'].includes(error?.name)?error.name:'UnknownError',message=typeof error?.message==='string'?error.message:'';
 let category='initialisation_failure',detail=null;
 if(/does not provide an export named/.test(message)){category='module_missing_export';const m=message.match(/export named ['"]([A-Za-z_$][\w$]*)['"]/);detail=m?m[1]:null;}
 else if(/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(message))category='module_graph_fetch_failure';
 else if(kind==='SyntaxError')category='module_parse_failure';
 else if(/^petal_washstand_[a-z0-9_]+$/.test(message)){category='preview_internal_failure';detail=message;}
 else if(kind==='ReferenceError'){const m=message.match(/^([A-Za-z_$][\w$]*) is not defined$/);if(m){category='missing_runtime_binding';detail=m[1];}}
 else {const m=message.match(/^Cannot read properties of (?:null|undefined) \(reading ['"]([A-Za-z_$][\w$]*)['"]\)$/);if(m){category='missing_runtime_property';detail=m[1];}}
 return{kind,category,detail,rawMessageStackOrURLSaved:false};
}
export async function startPreview({doc=globalThis.document,load=()=>import('./viewer.mjs'),watchMs=15000}={}){
 const stage=doc?.getElementById('stage'),status=doc?.getElementById('status'),report=doc?.getElementById('report');let module=null,phase='entry',complete=false,watch=null;
 function update(next,extra={}){phase=next;if(stage)stage.dataset.startupPhase=next;if(report)report.textContent=JSON.stringify({startup:{phase:next,...extra}},null,2);}
 update('entry');watch=setTimeout(()=>{if(!complete)update('waiting',{lastPhase:phase,observation:'Startup is still unconfirmed; timeout does not establish the cause and does not retry.'});},watchMs);
 try{update('module_loading');module=await load();update('module_loaded');if(typeof module?.start!=='function')throw Error('petal_washstand_start_export_missing');await module.start(next=>{if(phases.has(next)){phase=next;if(stage)stage.dataset.startupPhase=next;if(next!=='ready')update(next);else complete=true;}});if(stage?.dataset.ready==='true')complete=true;return complete;}
 catch(error){let cleanupFailed=false;try{const result=module?.cleanup?.();cleanupFailed=Boolean(result?.failed);}catch{cleanupFailed=true;}finally{complete=true;if(stage){stage.dataset.ready='false';stage.dataset.failed='true';stage.dataset.startupPhase='failed';}if(status)status.textContent='見本を読み込めませんでした。確認メモに読み込みの状態を表示しています。';if(report)report.textContent=JSON.stringify({startup:{phase:'failed',phaseAtFailure:phase,failure:failureDetails(error),cleanupFailed,automaticRetry:false}},null,2);}return false;}
 finally{if(watch!==null)clearTimeout(watch);}
}
if(typeof document!=='undefined')void startPreview();
