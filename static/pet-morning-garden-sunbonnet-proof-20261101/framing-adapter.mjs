/* Numeric actual-bounds adapter; the preserved shared camera helper is unchanged. */
import{fitView}from'../pet-scalloped-path-proof-20261027/framing.mjs';
export function authoredBoundsArrays(bounds){
 const array=v=>Array.isArray(v)?v.slice():typeof v?.toArray==='function'?v.toArray():null,min=array(bounds?.min),max=array(bounds?.max);
 if(!min||!max||min.length!==3||max.length!==3||![...min,...max].every(Number.isFinite)||max.some((v,i)=>v<=min[i]))throw Error('sunbonnet_invalid_real_bounds');
 return{min,max};
}
export function fitSunbonnetView(T,bounds,view,aspect){
 const arrays=authoredBoundsArrays(bounds),fit=fitView(T,arrays,view,aspect),n=fit.ndcBounds;
 if(!Object.values(n).every(Number.isFinite)||n.maxX-n.minX<=1e-8||n.maxY-n.minY<=1e-8)throw Error('sunbonnet_collapsed_framing');
 return{...fit,authoredBounds:arrays,wholeModelFraming:true,scope:'whole actual authored sunbonnet box corners; camera only, no item scaling or body calibration'};
}
