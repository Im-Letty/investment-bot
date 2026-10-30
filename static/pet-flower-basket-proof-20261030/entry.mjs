const phases=new Set(['module_loading','module_loaded','manifest_request','manifest_loaded','reference_ready','geometry_built','world_built','art_ready','art_loading','placement_ready','renderer_created','controls_bound','ready']);
const codes=new Set(['basket_manifest_http_failed','basket_manifest_mismatch','basket_reference_http_failed','basket_reference_sha_failed','basket_start_missing','basket_three_required','basket_invalid_patch_domain','basket_authored_passage_blocked']);
export function failureDetails(error){return{kind:['Error','SyntaxError','TypeError','ReferenceError','RangeError'].includes(error?.name)?error.name:'UnknownError',code:codes.has(error?.message)?error.message:null,rawMessageStackOrURLSaved:false};}
export async function startPreview({doc=globalThis.document,load=()=>import('./viewer.mjs')}={}){
 const stage=doc?.getElementById('stage'),status=doc?.getElementById('status'),report=doc?.getElementById('report');let api=null,phase='module_loading';if(stage)stage.dataset.startupPhase=phase;
 try{api=await load();phase='module_loaded';if(typeof api?.start!=='function')throw Error('basket_start_missing');await api.start(next=>{if(phases.has(next)){phase=next;if(stage)stage.dataset.startupPhase=next;}});return stage?.dataset.ready==='true';}
 catch(error){let cleanupFailed=false;try{cleanupFailed=Boolean(api?.cleanup?.()?.failed);}catch{cleanupFailed=true;}if(stage){stage.dataset.ready='false';stage.dataset.startupPhase='failed';}if(status)status.textContent='見本の読み込みを確認できませんでした。';if(report)report.textContent=JSON.stringify({startup:{phase:'failed',phaseAtFailure:phase,failure:failureDetails(error),cleanupFailed,automaticRetry:false}},null,2);return false;}
}
if(typeof document!=='undefined')void startPreview();
