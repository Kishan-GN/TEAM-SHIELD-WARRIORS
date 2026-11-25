'use strict';
const $=id=>document.getElementById(id),video=$('camera'),screen=$('screen'),out=screen.getContext('2d');
const frame=document.createElement('canvas');frame.width=480;frame.height=288;
const context=frame.getContext('2d',{willReadFrequently:true});
const classes='backpack,bottle,bowl,book,cell phone,chair,clock,cup,keyboard,laptop,mouse,remote,scissors,spoon,teddy bear'.split(',');
for(const name of classes)$('find').add(new Option(name,name));
let assets,net,photo,serial=0,stream=null,engine,source='',running=false,pinned=null,tracks=[],history=[],lastPixels=null,sessionTime=0,uncertain=[],stepNo=0;
const idText=id=>'#'+String(id).padStart(2,'0');
function script(url){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=url;s.onload=resolve;s.onerror=()=>reject(new Error('Missing project asset. Extract the complete ZIP and try again.'));document.head.append(s);});}
async function prepare(){
  if(!assets)assets=(async()=>{
    await Promise.all([script('assets/vision/tf.min.js'),script('assets/vision/weights.js'),script('assets/vision/sample.js')]);
    await Promise.all([script('assets/vision/coco-ssd.min.js'),script('assets/vision/wasm.min.js'),script('assets/vision/wasm-data.js')]);
    let accelerated=false;
    try{
      const paths={};
      for(const [name,encoded] of Object.entries(argusWasm)){
        const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
        paths[name]=URL.createObjectURL(new Blob([bytes],{type:'application/wasm'}));
      }
      paths['tfjs-backend-wasm-threaded-simd.wasm']=paths['tfjs-backend-wasm-simd.wasm'];
      tf.env().set('WASM_HAS_MULTITHREAD_SUPPORT',false);
      tf.wasm.setWasmPaths(paths);accelerated=await tf.setBackend('wasm');
    }catch(e){console.info('WASM backend unavailable',e);}
    if(!accelerated&&!await tf.setBackend('webgl'))await tf.setBackend('cpu');
    const bytes=Uint8Array.from(atob(window.argusBytes),c=>c.charCodeAt(0)).buffer;
    window.argusBytes=null;
    const model=await cocoSsd.load({modelUrl:tf.io.fromMemory({modelTopology:argusGraph,weightSpecs:argusWeights,weightData:bytes})});
    photo=new Image();await new Promise((resolve,reject)=>{photo.onload=resolve;photo.onerror=reject;photo.src=argusSample;});return model;
  })().catch(e=>{assets=null;throw e;});
  return assets;
}
function release(){
  serial++;running=false;
  if(stream)stream.getTracks().forEach(t=>t.stop());
  stream=null;video.hidden=true;video.pause();video.srcObject=null;$('stop').disabled=true;
}
function halt(status='Stopped'){
  release();$('status').textContent=status;
  if(source==='camera'){
    out.clearRect(0,0,960,576);$('screen').hidden=true;$('cover').hidden=false;$('caption').hidden=false;
    $('feed').textContent='Scene preview';tracks=[];uncertain=[];panel();
  }
}
function addEvent(text){
  history.push({seconds:+sessionTime.toFixed(2),text});if(history.length>350)history.shift();
  $('log').replaceChildren?$('log').replaceChildren():$('log').textContent='';
  history.slice(-10).reverse().forEach(e=>{const row=document.createElement('div');row.className='entry';row.textContent=e.seconds.toFixed(1)+' s  ·  '+e.text;$('log').append(row);});
}
function boxData(pred,data){
  const [x,y,w,h]=pred.bbox,box=[x/1.5,y/1.5,w/1.5,h/1.5];
  const hist=new Float32Array(64);let total=0;
  for(let j=Math.max(0,Math.floor(y+h*.2));j<Math.min(288,y+h*.8);j+=3){
    for(let i=Math.max(0,Math.floor(x+w*.2));i<Math.min(480,x+w*.8);i+=3){
      const k=4*(480*j+i);hist[(data[k]>>6)*16+(data[k+1]>>6)*4+(data[k+2]>>6)]++;total++;
    }
  }
  for(let i=0;i<64;i++)hist[i]/=total||1;
  return {label:pred.class,confidence:pred.score,hist,box,area:w*h};
}
// Estimate translation using clipped intensity errors, ignoring textureless regions.
function cameraShift(data){
  const w=80,h=48,gray=new Uint8Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const k=4*(y*6*480+x*6);gray[y*w+x]=(data[k]+2*data[k+1]+data[k+2])/4;}
  const prev=lastPixels;lastPixels=gray;if(!prev)return [0,0];
  let best=Infinity,baseline=Infinity,result=[0,0];
  for(let dy=-2;dy<=2;dy++)for(let dx=-3;dx<=3;dx++){
    let diff=0,n=0;
    for(let y=4;y<h-4;y+=2)for(let x=5;x<w-5;x+=2){
      const p=y*w+x;if(Math.abs(prev[p-1]-prev[p+1])+Math.abs(prev[p-w]-prev[p+w])<12)continue;
      diff+=Math.min(24,Math.abs(prev[p]-gray[p+dy*w+dx]));n++;
    }
    if(n<30)continue;
    const cost=diff/n+.08*(Math.abs(dx)+Math.abs(dy));if(!dx&&!dy)baseline=cost;
    if(cost<best){best=cost;result=[4*dx,4*dy];}
  }
  return best<baseline*.8?result:[0,0];
}
function panel(){
  const filter=$('find').value,found=tracks.filter(t=>!filter||t.label===filter),list=$('list');
  list.textContent='';
  for(const t of found){
    const b=document.createElement('button');b.className='item';b.textContent=t.label+' '+idText(t.id);
    const small=document.createElement('small');small.textContent=t.id===pinned?.id?'Pinned':'Pin item';b.append(small);
    b.onclick=()=>{pinned={id:t.id,label:t.label};addEvent('Pinned '+t.label+' '+idText(t.id));panel();};list.append(b);
  }
  $('searchState').textContent=found.length?found.length+' confirmed in view':filter?'No confirmed '+filter+' in view.':'No confirmed objects in view.';
  if(!pinned){$('pin').textContent='Select a detected item below to follow its ID.';return;}
  const t=engine.tracks.find(t=>t.id===pinned.id),visible=tracks.find(t=>t.id===pinned.id);
  let detail='Memory expired';
  const position=t?(t.box[0]+t.box[2]/2<106?'left':t.box[0]+t.box[2]/2>213?'right':'center'):'';
  if(visible)detail='In view · '+position+' · '+Math.round(100*visible.confidence)+'% detector score';
  else if(t)detail=uncertain.length?'Hidden · possible matches under review':'Last seen '+position+' · '+(sessionTime-t.seen).toFixed(1)+' s ago';
  if(!running)detail='Last session · '+detail;
  $('pin').textContent=pinned.label+' '+idText(pinned.id)+' · '+detail;
}
function overlay(preds){
  if(source==='camera')out.clearRect(0,0,960,576);else out.drawImage(frame,0,0,960,576);out.save();out.scale(3,3);
  function box(b,text,color){
    const [x,y,w,h]=b;out.strokeStyle=color;out.lineWidth=1;out.strokeRect(x,y,w,h);
    out.font='bold 6px sans-serif';const wide=out.measureText(text).width+6,top=Math.max(0,y-9),left=Math.max(0,Math.min(320-wide,x));
    out.fillStyle=color;out.fillRect(left,top,wide,9);out.fillStyle='#102217';out.fillText(text,left+3,top+6.5);
  }
  for(const d of preds){
    const t=tracks.find(t=>t.label===d.label&&Argus.overlap(t.box,d.box)>.95);
    const amb=uncertain.includes(d.box);
    const label=t?d.label+' '+idText(t.id):d.label+(amb?' · uncertain':' · candidate');
    if(!$('find').value||$('find').value===d.label)box(d.box,label,t&&t.id===pinned?.id?'#fff6a2':t?'#b9ff93':'#ffc17b');
  }
  out.restore();
}
function scene(){
  context.fillStyle='#14221b';context.fillRect(0,0,480,288);
  const image=source==='camera'?video:photo,w=image.videoWidth||image.naturalWidth,h=image.videoHeight||image.naturalHeight;
  const scale=Math.min(480/w,288/h);context.drawImage(image,(480-w*scale)/2,(288-h*scale)/2,w*scale,h*scale);
  if(source==='demo'&&stepNo>=7&&stepNo<12){context.fillStyle='#394641';context.fillRect(0,0,480,288);}
}
async function tick(token,started){
  if(token!==serial)return;
  try{
    scene();const data=context.getImageData(0,0,480,288).data;
    const raw=await net.detect(frame,18,Number($('threshold').value)/100);
    if(token!==serial)return;
    sessionTime=source==='demo'?stepNo*.35:(performance.now()-started)/1000;
    const ds=raw.map(p=>boxData(p,data));
    for(const d of ds)if(!Array.from($('find').options).some(o=>o.value===d.label))$('find').add(new Option(d.label,d.label));
    tracks=engine.update(ds,sessionTime,cameraShift(data));uncertain=engine.uncertain;
    for(const e of engine.events){
      const t=engine.tracks.find(t=>t.id===e.id);
      addEvent(e.type+' '+t.label+' '+idText(e.id)+(e.gap?' after '+e.gap.toFixed(1)+' s':''));
    }
    if(uncertain.length&&!tick.wasUncertain)addEvent('Ambiguous observation · identity withheld');
    tick.wasUncertain=uncertain.length>0;
    overlay(ds);panel();$('readout').textContent=tracks.length+' confirmed  /  '+engine.recoveries+' recoveries  /  '+uncertain.length+' uncertain';
    $('export').disabled=false;stepNo++;
    if(source==='demo'&&stepNo>=20){release();$('status').textContent='Demo complete';return;}
    setTimeout(()=>tick(token,started),source==='demo'?280:30);
  }catch(e){if(token===serial){halt('Analysis stopped');$('error').textContent=e.message;}}
}
async function start(sourceName){
  release();const token=serial;source=sourceName;running=true;tracks=[];pinned=null;history=[];uncertain=[];lastPixels=null;stepNo=0;sessionTime=0;tick.wasUncertain=false;
  engine=new Argus.Tracker(320,192);panel();
  $('log').textContent='Waiting for detections.';$('error').textContent='';$('export').disabled=true;$('stop').disabled=false;
  $('readout').textContent='Preparing detector…';$('status').textContent='Starting…';$('feed').textContent=source==='demo'?'Cup occlusion trial':'Laptop camera';
  try{
    if(source==='camera'){
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('Open Start-Live-Camera.bat in Chrome or Edge.');
      const acquired=await navigator.mediaDevices.getUserMedia({audio:false,video:{width:{ideal:640},height:{ideal:480}}});
      if(token!==serial){acquired.getTracks().forEach(t=>t.stop());return;}
      stream=acquired;stream.getVideoTracks()[0].onended=()=>{if(token===serial)halt('Disconnected');};
      video.srcObject=stream;video.hidden=false;$('cover').hidden=true;$('caption').hidden=true;out.clearRect(0,0,960,576);await video.play();
    }
    if(token!==serial)return;
    $('status').textContent='Loading local model…';net=await prepare();if(token!==serial)return;
    $('screen').hidden=false;$('cover').hidden=true;$('caption').hidden=true;
    $('status').textContent=source==='demo'?'Photo simulation':'Live';tick(token,performance.now());
  }catch(e){if(token===serial){halt('Unavailable');$('error').textContent=({NotAllowedError:'Camera access was denied. Allow it in browser settings, then start again.',NotFoundError:'No webcam found. Connect a camera or try the cup demo.',NotReadableError:'Close other camera apps and retry.'})[e.name]||e.message;}}
}
$('sample').onclick=()=>start('demo');$('start').onclick=()=>start('camera');$('stop').onclick=()=>halt();
$('find').onchange=panel;$('threshold').oninput=()=>$('thresholdValue').textContent=$('threshold').value+'%';
$('export').onclick=()=>{
  const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify({source,seconds:sessionTime,pinned,recoveries:engine.recoveries,events:history},null,2)],{type:'application/json'}));
  a.href=url;a.download='argus-identity-history.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
window.addEventListener('pagehide',release);
