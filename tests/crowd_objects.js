/* Regression cases for eight simultaneous tracks, walking, occlusion and custom watch lookup. */
const assert=require('node:assert/strict');
require('../tracker.js');require('../console/watch.js');
const tracker=new Argus.Tracker(480,270),hist=new Float32Array(64);
hist[5]=1;
function people(frame,hidden=false){
 return Array.from({length:8},(_,i)=>{
  const embedding=new Float32Array(8);embedding[i]=1;
  return {box:[14+(i%4)*110+frame*1.5,6+Math.floor(i/4)*135,48,110],
    label:'person',confidence:.93,hist,embedding,index:i};
 }).filter(d=>!hidden||d.index!==0);
}
let result;
for(let i=0;i<5;i++)result=tracker.update(people(i),i*.5);
const ids=result.map(t=>t.id);
assert.equal(new Set(ids).size,8);
for(let i=5;i<10;i++)tracker.update(people(i,true),i*.5);
result=tracker.update(people(10),5);
assert.deepEqual(new Set(result.map(t=>t.id)),new Set(ids));
const W=160,H=100;
function watch(x,y){
 const data=new Uint8Array(W*H*4);
 for(let j=0;j<30;j++)for(let i=0;i<30;i++){
  const v=(i*7+j*29+i*j*3)%251,k=4*((y+j)*W+x+i);
  data[k]=v;data[k+1]=v;data[k+2]=v;
 }return data;
}
const ref=WatchMatch.signature(watch(30,30),W,[30,30,30,30]);
const found=WatchMatch.locate(watch(75,45),W,H,ref);
assert.ok(found&&found.class==='watch (reference)'&&found.score>.95);
assert.equal(WatchMatch.locate(new Uint8Array(W*H*4),W,H,ref),null);
console.log('PASS: eight moving tracks, original IDs after occlusion, taught pattern recovery, blank-scene rejection.');
