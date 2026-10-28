import assert from 'node:assert/strict';

// This request authorizes only one derived tree translation. Every other
// field remains byte-for-byte equivalent after normalizing that translation.
export function assertDerivedWorld(world, before, model) {
  const original=typeof before==='string'?JSON.parse(before):structuredClone(before),actual=structuredClone(world);
  const plan=model?.treeRoadClearance;
  if(!plan||!['relocated','already-clear'].includes(plan.status)) {
    assert.deepEqual(actual,original);return;
  }
  const oldTree=original.places.find(p=>p.id==='tree'),tree=actual.places.find(p=>p.id==='tree');
  assert.ok(oldTree&&tree);
  const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,String(a)+' != '+String(b));
  const dx=tree.x-oldTree.x,dy=tree.y-oldTree.y;
  for(const key of ['footprint','entrance']) {
    near(tree[key].x-oldTree[key].x,dx);near(tree[key].y-oldTree[key].y,dy);
    tree[key].x=oldTree[key].x;tree[key].y=oldTree[key].y;
  }
  near((world.places.find(p=>p.id==='tree').footprint.x-world.width/2)/100,plan.to.x);
  near((world.places.find(p=>p.id==='tree').footprint.y-world.height/2)/100,plan.to.z);
  tree.x=oldTree.x;tree.y=oldTree.y;assert.deepEqual(actual,original);
}
