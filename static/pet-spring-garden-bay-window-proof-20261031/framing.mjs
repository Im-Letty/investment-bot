/* Explicit Box3-to-array adapter for the preserved existing camera helper. No object scaling. */
import{fitView}from'../pet-scalloped-path-proof-20261027/framing.mjs';
export function authoredBoundsArrays(bounds){
 const array=v=>Array.isArray(v)?v.slice():typeof v?.toArray==='function'?v.toArray():null,min=array(bounds?.min),max=array(bounds?.max);
 if(!min||!max||min.length!==3||max.length!==3||![...min,...max].every(Number.isFinite)||max.some((v,i)=>v<=min[i]))throw Error('bay_window_invalid_real_bounds');
 return{min,max};
}
export function fitBayWindowView(T,bounds,view,aspect){
 const arrays=authoredBoundsArrays(bounds),f=fitView(T,arrays,view,aspect),n=f.ndcBounds;
 if(!Object.values(n).every(Number.isFinite)||n.maxX-n.minX<=1e-8||n.maxY-n.minY<=1e-8)throw Error('bay_window_collapsed_framing');
 return{...f,authoredBounds:arrays,scope:'whole actual authored bay_window box corners; camera-only framing, no body calibration or item/world scale change'};
}
