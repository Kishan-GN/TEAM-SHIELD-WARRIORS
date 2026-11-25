const assert=require('node:assert/strict');
require('../tracker.js');
const engine=new Argus.Tracker(320,192);
function observed(label,x,color){
  const hist=new Float32Array(64);hist[color]=1;
  return {label,box:[x,30,36,48],hist,confidence:.91};
}
const cup=observed('cup',45,5),bottle=observed('bottle',125,5);
for(let i=0;i<4;i++)engine.update([cup,bottle],i*.3);
const original=engine.tracks.find(t=>t.label==='cup').id;
engine.update([bottle],1.4);
engine.update([observed('bottle',45,5)],2);
assert.ok(engine.tracks.find(t=>t.id===original).seen<1);
let match=engine.update([observed('cup',88,5)],12);
assert.equal(match[0].id,original);
assert.equal(engine.recoveries,1);
engine.update([],13);
match=engine.update([observed('cup',90,44)],14);
assert.ok(!match.some(t=>t.id===original));
engine.update([],48);
assert.equal(engine.tracks.length,0);
console.log('PASS: class gate, 10+ second recovery, appearance rejection and memory expiry.');
