/* One worker owns one model. Sources submit at most one sampled frame each. */
self.window=self;
importScripts('watch.js');
async function classifyBoxes(model,tensor,limit,minScore){
 const batch=tensor.expandDims(0);let outputs;
 try{
  outputs=await model.model.executeAsync(batch);
  const scores=await outputs[0].data(),boxes=await outputs[1].data(),count=outputs[0].shape[1],classes=outputs[0].shape[2];
  const [conf,labels]=model.calculateMaxScores(scores,count,classes);
  const order=Array.from({length:count},(_,i)=>i).filter(i=>conf[i]>=minScore).sort((a,b)=>conf[b]-conf[a]);
  const kept=[];
  for(const i of order){
   const [y,x,b,r]=boxes.subarray(i*4,i*4+4),area=Math.max(0,b-y)*Math.max(0,r-x);
   const duplicate=kept.some(j=>{if(labels[i]!==labels[j])return false;
    const [v,u,t,s]=boxes.subarray(j*4,j*4+4);const shared=Math.max(0,Math.min(t,b)-Math.max(v,y))*Math.max(0,Math.min(s,r)-Math.max(u,x));
    return shared/(area+(t-v)*(s-u)-shared||1)>(labels[i]===0?.55:.46);
   });
   if(!duplicate)kept.push(i);if(kept.length>=limit)break;
  }
  return model.buildDetectedObjects(tensor.shape[1],tensor.shape[0],boxes,conf,kept,labels);
 }finally{batch.dispose();if(outputs)tf.dispose(outputs);}
}
async function detectScene(model,tensor,dense){
 const [height,width]=tensor.shape;
 const pred=await classifyBoxes(model,tensor,64,.35);
 if(!dense)return pred;
 const tw=Math.ceil(width*.57),th=Math.ceil(height*.62);
 for(const y of [0,height-th])for(const x of [0,width-tw]){
  const tile=tensor.slice([y,x,0],[th,tw,3]);
  try{
   for(const p of await classifyBoxes(model,tile,32,.36)){
    const [bx,by,w,h]=p.bbox;
    // Interior tile edges can truncate subjects. The overlapping tile or full pass covers them.
    if((x&&bx<2)||(y&&by<2)||(x+tw<width&&bx+w>tw-2)||(y+th<height&&by+h>th-2))continue;
    pred.push({...p,bbox:[x+bx,y+by,w,h]});
   }
  }finally{tile.dispose();}
 }
 const kept=[];
 for(const p of pred.sort((a,b)=>b.score-a.score)){
  const [x,y,w,h]=p.bbox;
  if(kept.some(q=>{if(q.class!==p.class)return false;const [a,b,c,d]=q.bbox;
   const area=Math.max(0,Math.min(x+w,a+c)-Math.max(x,a))*Math.max(0,Math.min(y+h,b+d)-Math.max(y,b));
   return area/(w*h+c*d-area||1)>.42||area/Math.max(1,Math.min(w*h,c*d))>.83;
  }))continue;
  kept.push(p);
 }
 return kept;
}
let loading;
async function load(){
  importScripts('../assets/vision/tf.min.js','../assets/vision/weights.js','../assets/vision/coco-ssd.min.js','../assets/vision/wasm.min.js','../assets/vision/wasm-data.js');
  const decode=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  const paths={};
  for(const [name,data] of Object.entries(argusWasm))paths[name]=URL.createObjectURL(new Blob([decode(data)],{type:'application/wasm'}));
  paths['tfjs-backend-wasm-threaded-simd.wasm']=paths['tfjs-backend-wasm-simd.wasm'];
  tf.env().set('WASM_HAS_MULTITHREAD_SUPPORT',false);tf.wasm.setWasmPaths(paths);
  if(!await tf.setBackend('wasm'))await tf.setBackend('cpu');
  const weightData=decode(argusBytes).buffer;self.argusBytes=null;
  return cocoSsd.load({modelUrl:tf.io.fromMemory({modelTopology:argusGraph,weightSpecs:argusWeights,weightData})});
}
let chain=Promise.resolve();
self.onmessage=({data})=>{
  chain=chain.then(async()=>{
    let tensor;
    try{
      loading=loading||load();const model=await loading;
      const pixels=new Uint8Array(data.rgba),rgb=new Uint8Array(data.width*data.height*3);
      for(let i=0,j=0;i<pixels.length;i+=4){rgb[j++]=pixels[i];rgb[j++]=pixels[i+1];rgb[j++]=pixels[i+2];}
      tensor=tf.tensor3d(rgb,[data.height,data.width,3],'int32');
      const start=performance.now(),pred=await detectScene(model,tensor,data.dense);

      const people=pred.filter(p=>p.class==='person');
      if(people.length){
        const batched=tensor.expandDims(0);
        let map;
        try{
          map=await model.model.executeAsync(batched,'FeatureExtractor/MobilenetV2/expanded_conv_13/expand/Relu6');
          const [,rows,cols,channels]=map.shape,values=await map.data();
          for(const person of people){
            const [x,y,w,h]=person.bbox;
            const left=Math.max(0,Math.min(cols-1,Math.floor((x+.12*w)/data.width*cols)));
            const top=Math.max(0,Math.min(rows-1,Math.floor((y+.08*h)/data.height*rows)));
            const right=Math.min(cols,Math.max(left+1,Math.ceil((x+.88*w)/data.width*cols)));
            const bottom=Math.min(rows,Math.max(top+1,Math.ceil((y+.94*h)/data.height*rows)));
            const vector=new Float32Array(channels);
            for(let r=top;r<bottom;r++)for(let c=left;c<right;c++){
              const k=(r*cols+c)*channels;
              for(let j=0;j<channels;j++)vector[j]+=values[k+j];
            }
            const norm=Math.sqrt(vector.reduce((sum,v)=>sum+v*v,0))||1;
            person.embedding=Array.from(vector,v=>v/norm);
          }
        }finally{batched.dispose();if(map)map.dispose();}
      }
      if(data.logicalWidth){
        const ratio=data.logicalWidth/data.width;
        for(const p of pred)p.bbox=p.bbox.map(v=>v*ratio);
      }
      if(data.watch){
        const watchPixels=data.watchFrame?new Uint8Array(data.watchFrame):pixels;
        const found=WatchMatch.locate(watchPixels,data.logicalWidth||data.width,data.logicalHeight||data.height,data.watch);
        if(found)pred.push(found);
      }
      self.postMessage({id:data.id,pred,latency:performance.now()-start,backend:tf.getBackend()});
    }catch(e){self.postMessage({id:data.id,error:e.message||String(e)});}
    finally{if(tensor)tensor.dispose();}
  });
};
