'use strict';
if(!Element.prototype.replaceChildren)Element.prototype.replaceChildren=function(...nodes){this.textContent='';this.append(...nodes);};
function uuid(){
 if(crypto.randomUUID)return crypto.randomUUID();
 const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
 const hex=Array.from(bytes,v=>v.toString(16).padStart(2,'0')).join('');
 return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
}
const $=id=>document.getElementById(id);
const pages=['Overview','Live detection','Camera management','Person directory','Person profile','Person re-identification','Cross-video person search','Video recordings','Analytics & reports','Identity match history','System health','Settings'];
const sources=new Map(),pending=new Map(),activeDevices=new Set();
let profileId=null,page=pages[0],db,role='',name='',worker,requestId=0,inFlight=0,epoch=0,setup=false,health={},filter={},reportDays=7,heatCamera='',previewUrl=null,faceReady;
const setupToken=new URLSearchParams(location.hash.slice(1)).get('setup')||'';
history.replaceState(null,'',location.pathname);
const pid=i=>'PERSON-'+String(i).padStart(3,'0'),clock=t=>new Date(t*1000).toLocaleString(),clamp=x=>Math.max(0,Math.min(1,x));
function element(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function button(label,fn){const b=element('button',label);b.onclick=()=>run(fn);return b;}
function input(type,value=''){const n=element('input');n.type=type;n.value=value;return n;}
function select(items,value){const n=element('select');for(const [k,v] of items)n.add(new Option(v,k));n.value=value;return n;}
function lab(label,node){const n=element('label',label);n.append(node);return n;}
function card(title){const n=element('article',undefined,'card');if(title)n.append(element('h2',title));return n;}
function toast(text){$('notice').textContent=text;}
async function run(fn){try{return await fn();}catch(e){toast(e.message||String(e));}}
async function api(path,data){
 const options=data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)};
 const r=await fetch('/api/'+path,options),body=await r.json();if(!r.ok)throw Error(body.error||'Request failed');return body;
}
async function refresh(){const version=++epoch;const result=await api('state');if(version===epoch){db=result;render();}}
function table(head,rows,empty='No records yet.'){
 if(!rows.length)return element('p',empty);
 const wrap=element('div',undefined,'tablebox'),t=element('table'),thead=t.createTHead(),hr=thead.insertRow();head.forEach(h=>hr.append(element('th',h)));
 const body=t.createTBody();rows.forEach(cols=>{const r=body.insertRow();cols.forEach(x=>{const td=r.insertCell();if(x instanceof Node)td.append(x);else td.textContent=x??'—';});});wrap.append(t);return wrap;
}
function metrics(items){const g=element('div',undefined,'grid');for(const [k,v] of items){const m=element('div',undefined,'metric');m.append(element('label',k),element('strong',String(v)));g.append(m);}return g;}
function showDialog(...nodes){$('dialogContent').replaceChildren(...nodes);const d=$('dialog');if(d.showModal){if(!d.open)d.showModal();}else d.setAttribute('open','');}
function closeDialog(){const d=$('dialog');if(d.close)d.close();else d.removeAttribute('open');$('dialogContent').replaceChildren();if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}}
$('closeDialog').onclick=closeDialog;
function navigate(p){page=p;toast('');render();if(!['Live detection','Cross-video person search'].includes(p))run(refresh);if(p==='System health')run(async()=>{health=await api('health');render();});}
function isAdmin(){return role==='admin';}
function authorize(){if(!isAdmin())throw Error('An administrator must perform this action.');}
function resetWorker(){
 if(worker)worker.terminate();worker=null;for(const p of pending.values())p.reject(Error('Analysis stopped'));pending.clear();
}
function infer(pixels,w,h,options={}){
 if(!worker){worker=new Worker('inference.js');worker.onmessage=e=>{const m=e.data,p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m);}};worker.onerror=()=>resetWorker();}
 const id=++requestId;
 return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});worker.postMessage({id,rgba:pixels.buffer,width:w,height:h,...options},[pixels.buffer]);});
}
function nextVideo(video,name){return new Promise((resolve,reject)=>{
 const ok=()=>{done();resolve();},bad=()=>{done();reject(Error('Video could not be decoded'));};
 const timeout=setTimeout(bad,10000);function done(){clearTimeout(timeout);video.removeEventListener(name,ok);video.removeEventListener('error',bad);}
 video.addEventListener(name,ok,{once:true});video.addEventListener('error',bad,{once:true});
});}
async function seek(v,t){if(Math.abs(v.currentTime-t)<.001&&v.readyState>=2)return;const p=nextVideo(v,'seeked');v.currentTime=t;await p;}
function crop(surface,b){
 const cv=element('canvas');cv.width=Math.max(1,Math.min(180,Math.round(b[2])));cv.height=Math.max(1,Math.min(240,Math.round(b[3])));
 cv.getContext('2d').drawImage(surface,b[0],b[1],b[2],b[3],0,0,cv.width,cv.height);return cv;
}
async function facial(image){
 if(!faceReady)faceReady=new Promise((resolve,reject)=>{const f=element('iframe');f.hidden=true;f.src='face-frame.html';f.onload=()=>resolve(f.contentWindow);f.onerror=()=>reject(Error('Face component unavailable'));document.body.append(f);});
 const w=await faceReady;return w.descriptor(image);
}
function cameraConfig(n){const row=db.cameras.find(c=>c.name===n);return row?JSON.parse(row.config):{zone:[.25,.25,.75,.75],alert:false,limit:5,watch:0};}
async function storeVideo(s,blob,duration){
 const q=new URLSearchParams({session:s.id,camera:s.camera,name:s.label,start:s.start,duration});
 const r=await fetch('/api/media?'+q,{method:'POST',body:blob});const j=await r.json();if(!r.ok)throw Error(j.error);return j.id;
}
function persistedIdentity(rec){
 if(!rec)return null;
 const known=db.events.find(e=>e.id===rec.aid);
 return known?known.person:rec.decision?.person;
}
function displayEntry(s,result){
 const panel=s.matchPanel,entry=element('article',undefined,'matchEntry');
 const candidate=result.reference?.person;
 const title=result.person?pid(result.person):'Unknown · review required';
 entry.append(element('strong',title),element('small',result.outcome));
 const photos=element('div',undefined,'matchPhotos');
 for(const [caption,id] of [['Entry photo',result.capture],['Saved reference',result.reference?.id]]){
  const cell=element('div');if(id){const im=element('img');im.src='/api/photo/'+id;im.alt=caption;cell.append(im);}cell.append(element('small',caption));photos.append(cell);
 }
 entry.append(photos);
 if(result.reference)entry.append(element('b',(100*result.similarity).toFixed(1)+'% appearance similarity'),element('div',pid(candidate)+' · '+result.reference.camera+' · '+clock(result.reference.at)));
 else entry.append(element('div','First reference saved'));
 entry.append(element('small',result.searched+' references compared · '+result.ms.toFixed(1)+' ms'));
 panel.prepend(entry);while(panel.children.length>5)panel.lastChild.remove();
}
const supportedClasses=['person','bicycle','car','motorcycle','airplane','bus','train','truck','boat','traffic light','fire hydrant','stop sign','parking meter','bench','bird','cat','dog','horse','sheep','cow','elephant','bear','zebra','giraffe','backpack','umbrella','handbag','tie','suitcase','frisbee','skis','snowboard','sports ball','kite','baseball bat','baseball glove','skateboard','surfboard','tennis racket','bottle','wine glass','cup','fork','knife','spoon','bowl','banana','apple','sandwich','orange','broccoli','carrot','hot dog','pizza','donut','cake','chair','couch','potted plant','bed','dining table','toilet','tv','laptop','mouse','remote','keyboard','cell phone','microwave','oven','toaster','sink','refrigerator','book','clock','vase','scissors','teddy bear','hair drier','toothbrush'];
function teachWatch(s){
 if(!s.step)throw Error('Wait for the first camera result.');
 const shot=element('canvas');shot.width=480;shot.height=270;
 const ctx=shot.getContext('2d');ctx.drawImage(s.surface,0,0);const original=ctx.getImageData(0,0,480,270);
 shot.style.cssText='width:min(540px,75vw);height:auto;touch-action:none;cursor:crosshair';
 const status=element('p','Drag a rectangle tightly around your watch on this frozen frame. Include the face and strap details.');let first=null,box=null;
 const point=e=>{const r=shot.getBoundingClientRect();return [Math.round(480*clamp((e.clientX-r.left)/r.width)),Math.round(270*clamp((e.clientY-r.top)/r.height))];};
 shot.onpointerdown=e=>{first=point(e);shot.setPointerCapture(e.pointerId);};
 shot.onpointermove=e=>{if(!first)return;const [x,y]=point(e);box=[Math.min(x,first[0]),Math.min(y,first[1]),Math.abs(x-first[0]),Math.abs(y-first[1])];ctx.putImageData(original,0,0);ctx.strokeStyle='#ffe18d';ctx.lineWidth=2;ctx.strokeRect(...box);};
 shot.onpointerup=()=>first=null;
 showDialog(element('h2','Teach my watch'),status,shot,button('Use this reference',()=>{
  if(!box||Math.min(box[2],box[3])<18){status.textContent='Move the watch closer, or select a region at least 18 pixels wide and tall.';return;}
  const ref=WatchMatch.signature(original.data,480,box);
  if(ref.contrast<9){status.textContent='The selected area needs more visible watch detail.';return;}
  s.watch=ref;s.filter.value='watch (reference)';closeDialog();toast('Watch reference active for this source. Keep a similar viewing angle.');
 }));
}
function sourceCard(s){
 const c=card(s.label),box=element('div',undefined,'media');s.overlay=element('canvas');s.overlay.width=480;s.overlay.height=270;
 box.append(s.video,s.overlay);s.details=element('div','Opening source…','details');s.people=element('div',undefined,'row');if(s.persistent){
  const layout=element('div',undefined,'matchLayout'),side=element('div',undefined,'matchSide');
  s.matchPanel=element('div');side.append(element('h2','Entry matches'),s.matchPanel);
  layout.append(box,side);c.append(layout);
 }else c.append(box);
 const settings=element('div',undefined,'toolbar');s.filter=select([['','All people and objects'],...supportedClasses.map(n=>[n,n]),['watch (reference)','My watch · reference']], '');
 s.dense=input('checkbox');s.dense.checked=true;
 settings.append(lab('Show detections',s.filter),lab('Crowd & small-item scan',s.dense),button('Teach my watch',()=>teachWatch(s)));
 s.objectList=element('p');c.append(settings,s.details,s.objectList,s.people,button('Stop source',()=>stop(s)));s.card=c;$('sources').append(c);
}
async function begin(kind){
 authorize();if(sources.size>=3)throw Error('Up to three sources can be open at once.');
 const file=kind==='upload'?$('upload').files[0]:null;
 if(kind==='live'&&!$('authorized').checked||kind==='upload'&&!$('fileConsent').checked)throw Error('Confirm authorization for this source.');
 if(kind==='upload'&&(!file||file.size>32*1024*1024))throw Error('Choose an MP4 or WebM under 32 MB.');
 const camera=kind==='live'?$('camName').value.trim():('Upload · '+file.name).slice(0,80);
 if(!camera)throw Error('Enter a camera name.');
 const s={id:uuid(),camera,kind,persistent:$(kind==='live'?'returnMode':'fileReturnMode').checked,episode:0,label:kind==='live'?camera:file.name,start:Date.now()/1000,track:new Argus.Tracker(480,270),ids:new Map(),zoned:new Set(),live:true,visible:[],step:0,video:element('video'),surface:element('canvas'),ticks:0,ms:0,fps:null,observations:0};
 s.video.muted=true;s.video.playsInline=true;s.surface.width=480;s.surface.height=270;s.hd=element('canvas');s.hd.width=960;s.hd.height=540;s.hdCtx=s.hd.getContext('2d',{willReadFrequently:true});s.ctx=s.surface.getContext('2d',{willReadFrequently:true});
 sources.set(s.id,s);sourceCard(s);
 try{
  if(kind==='live'){
   const device=$('device').value;s.stream=await navigator.mediaDevices.getUserMedia({video:device?{deviceId:{exact:device}}:{width:{ideal:960},height:{ideal:540}},audio:false});
   if(!s.live){s.stream.getTracks().forEach(t=>t.stop());return;}
   const track=s.stream.getVideoTracks()[0];s.device=track.getSettings().deviceId||device||'default';
   if(activeDevices.has(s.device)){s.device=null;throw Error('This device is already open. Choose another camera.');}
   activeDevices.add(s.device);s.video.srcObject=s.stream;await s.video.play();if(!s.live)return;
   track.onended=()=>{if(s.live){run(()=>api('alert',{message:camera+' disconnected'}));run(()=>stop(s));}};
   if(!db.cameras.some(c=>c.name===camera))await api('camera',{name:camera,zone:[.25,.25,.75,.75],alert:false,limit:5});
   if(!s.live)return;s.start=Date.now()/1000;
   if($('record').checked){
    if(!window.MediaRecorder)throw Error('Recording is unavailable in this browser.');
    const mime=['video/webm;codecs=vp8','video/webm','video/mp4'].find(t=>MediaRecorder.isTypeSupported(t));
    if(!mime)throw Error('No supported recording codec.');
    s.rec=new MediaRecorder(s.stream,{mimeType:mime,videoBitsPerSecond:1200000});s.chunks=[];s.size=0;
    s.rec.ondataavailable=e=>{if(e.data.size){s.chunks.push(e.data);s.size+=e.data.size;}if(s.size>25e6&&s.live)run(()=>stop(s));};
    s.recorded=new Promise((resolve,reject)=>{s.rec.onstop=resolve;s.rec.onerror=e=>reject(Error(e.error?.message||'Recording failed'));});
    s.rec.start(1000);s.limitTimer=setTimeout(()=>run(()=>stop(s)),60000);
   }
  }else{
   s.localUrl=URL.createObjectURL(file);const ready=nextVideo(s.video,'loadeddata');s.video.src=s.localUrl;await ready;
   if(!s.live)return;if(!Number.isFinite(s.video.duration)||s.video.duration<=0)throw Error('The clip needs a finite duration.');
   await storeVideo(s,file,s.video.duration);
  }
  if(!s.live)return;await refresh();run(()=>processSource(s));
 }catch(e){await stop(s);if(kind==='live')await api('alert',{message:camera+' connection failed'});throw e;}
}
async function stop(s){
 if(!s.live)return;s.live=false;clearTimeout(s.limitTimer);clearTimeout(s.timer);sources.delete(s.id);s.card.remove();
 if(s.device)activeDevices.delete(s.device);
 const elapsed=Math.max(.01,Date.now()/1000-s.start);
 if(s.rec&&s.rec.state!=='inactive')s.rec.stop();s.stream?.getTracks().forEach(t=>t.stop());
 s.video.pause();s.video.srcObject=null;s.video.removeAttribute('src');s.video.load();
 if(s.localUrl)URL.revokeObjectURL(s.localUrl);
 if(s.recorded){await s.recorded;await storeVideo(s,new Blob(s.chunks,{type:s.rec.mimeType}),elapsed);toast('Recording saved.');}
 if(!sources.size)resetWorker();await refresh();
}
function draw(s,raw,scale,dx,dy){
 const ctx=s.overlay.getContext('2d');ctx.clearRect(0,0,480,270);ctx.font='bold 11px sans-serif';
 const conf=cameraConfig(s.camera);if(conf.alert){const [a,b,c,d]=conf.zone;ctx.strokeStyle='#ffd390';ctx.setLineDash([5,4]);ctx.strokeRect(a*480,b*270,(c-a)*480,(d-b)*270);ctx.setLineDash([]);}
 function box(b,label,color){
  const [x,y,w,h]=b;ctx.strokeStyle=color;ctx.lineWidth=1.6;ctx.strokeRect(x,y,w,h);
  ctx.font='bold 8px sans-serif';const width=Math.min(480,ctx.measureText(label).width+5),left=Math.max(0,Math.min(480-width,x)),top=Math.max(0,y-11);
  ctx.fillStyle='#102021';ctx.fillRect(left,top,width,11);ctx.fillStyle=color;ctx.fillText(label,left+2,top+8);
 }
 s.people.replaceChildren();const filter=s.filter.value;
 for(const p of raw){
  if(filter&&filter!==p.class)continue;
  if(p.class==='person'&&s.visible.some(t=>Argus.overlap(t.box,p.bbox)>.9))continue;
  box(p.bbox,p.class+(p.class==='person'?' · acquiring':'')+' '+Math.round(100*p.score)+'%',p.class==='person'?'#ffe2a6':'#8be0ff');
 }
 for(const t of s.visible){
  const rec=s.ids.get(t.id),person=persistedIdentity(rec);
  const label=person?'Person '+person:s.persistent?'Track '+t.id+' · review':'Person '+t.id;
  if(!filter||filter==='person')box(t.box,label,person?'#b0ffbb':'#ffe2a6');
  if(rec){s.people.append(button(label+' · '+rec.attr.upper+' / '+rec.attr.lower+(rec.attr.accessories?.length?' · '+rec.attr.accessories.join(', '):''),()=>inspectTrack(s,t.id)));}
 }
 if(!filter||filter==='person'){
  const visibleIds=new Set(s.visible.map(t=>t.id));
  for(const t of s.track.tracks){
   if(t.hits<3||visibleIds.has(t.id))continue;
   const rec=s.ids.get(t.id),person=persistedIdentity(rec);
   if(!rec)continue;
   const label=person?'Person '+person:s.persistent?'Track '+t.id:'Person '+t.id;
   s.people.append(element('small',label+' · last seen '+Math.max(0,s.track.time-t.seen).toFixed(1)+' s ago'));
  }
 }
 if(!filter||filter==='person')for(const b of s.track.uncertain)box(b,'Person · uncertain','#eeaa70');
}
async function processSource(s){
 if(!s.live)return;
 try{
  const v=s.video;
  if(s.kind==='upload'){
   if(s.step/3>=v.duration){await stop(s);toast('Video indexing finished. Open Cross-video person search to review candidates.');return;}
   await seek(v,Math.min(s.step/3,Math.max(0,v.duration-.001)));
  }else if(v.readyState<2||v.currentTime===s.lastTime){s.timer=setTimeout(()=>run(()=>processSource(s)),60);return;}
  if(!s.live)return;
  const mediaTime=v.currentTime,stamp=performance.now();s.lastTime=mediaTime;
  const ratio=Math.min(480/v.videoWidth,270/v.videoHeight),w=v.videoWidth*ratio,h=v.videoHeight*ratio,dx=(480-w)/2,dy=(270-h)/2;
  s.ctx.fillStyle='#101719';s.ctx.fillRect(0,0,480,270);s.ctx.drawImage(v,dx,dy,w,h);
  const data=s.ctx.getImageData(0,0,480,270).data;
  const hd=s.dense.checked&&v.videoWidth>480;
  if(hd){s.hdCtx.fillStyle='#101719';s.hdCtx.fillRect(0,0,960,540);s.hdCtx.drawImage(v,2*dx,2*dy,2*w,2*h);}
  const input=hd?s.hdCtx.getImageData(0,0,960,540).data:data.slice();
  const ans=await infer(input,hd?960:480,hd?540:270,{dense:s.dense.checked,watch:s.watch,watchFrame:s.watch&&hd?data.buffer:undefined,logicalWidth:480,logicalHeight:270});if(!s.live)return;
  const det=ans.pred.filter(p=>p.class==='person').map(p=>({label:'person',box:p.bbox,confidence:p.score,embedding:p.embedding,...describe(data,480,270,p.bbox)}));
  s.visible=s.track.update(det,mediaTime);s.ms=ans.latency;s.backend=ans.backend;s.delay=performance.now()-stamp;s.observations++;
  const frames=v.getVideoPlaybackQuality?.().totalVideoFrames;
  if(frames!==undefined&&s.kind==='live'){
   if(s.prevFrames!==undefined&&stamp-s.prevAt>=700){s.fps=(frames-s.prevFrames)*1000/(stamp-s.prevAt);s.prevAt=stamp;s.prevFrames=frames;}
   if(s.prevFrames===undefined){s.prevFrames=frames;s.prevAt=stamp;}
  }
  const zone=cameraConfig(s.camera);
  const sec=Math.floor(mediaTime);
  if(s.heatSec!==sec){s.heatSec=sec;const bins=Array(40).fill(0);
   for(const t of s.visible){const x=clamp((t.box[0]+t.box[2]/2)/480),y=clamp((t.box[1]+t.box[3]/2)/270);bins[Math.min(7,Math.floor(x*8))+8*Math.min(4,Math.floor(y*5))]++;}
   if(bins.some(Boolean))await api('occupancy',{camera:s.camera,hour:Math.floor((s.start+sec)/3600),bins});
  }
  const present=new Set(s.visible.map(t=>t.id));
  if(s.persistent)for(const [id,record] of s.ids){
   if(!present.has(id)&&record.goneSince==null)record.goneSince=mediaTime;
  }
  for(const t of s.visible){
   const d=det.find(o=>Argus.overlap(t.box,o.box)>.97);if(!d)continue;
   const x=clamp((t.box[0]+t.box[2]/2)/480),y=clamp((t.box[1]+t.box[3]/2)/270);
   const previous=s.ids.get(t.id);
   const returned=previous?.goneSince!=null&&mediaTime-previous.goneSince>=.5;
   if(!previous||s.persistent&&returned){
    const offset=s.kind==='live'?Math.max(0,Date.now()/1000-s.start):mediaTime;
    const accessories=ans.pred.filter(p=>['backpack','handbag','tie'].includes(p.class)&&Argus.overlap(t.box,p.bbox)>.04).map(p=>p.class);
    const att={accessories,embedding:d.embedding,session:s.id,track:s.persistent?++s.episode:t.id,camera:s.camera,at:s.start+offset,offset,upper:d.upper,lower:d.lower,score:t.confidence,x,y,descriptor:d.descriptor};
    const photo=crop(s.surface,d.box);
    const occupied=s.visible.filter(o=>o.id!==t.id).map(o=>s.ids.get(o.id)?.aid).filter(Boolean);
    const r=s.persistent?await api('entry',{...att,image:photo.toDataURL('image/jpeg',.82),participantConsent:true,occupied,prior:previous?.aid}):await api('events',att);
    if(!s.live)return;
    s.ids.set(t.id,{aid:r.id,attr:att,crop:photo,decision:r});
    if(s.persistent){displayEntry(s,r);}else await refresh();
    if(!s.live)return;
   }
   const rec=s.ids.get(t.id);rec.goneSince=null;rec.crop=crop(s.surface,d.box);rec.attr.descriptor=d.descriptor;rec.attr.embedding=d.embedding;rec.attr.upper=d.upper;rec.attr.lower=d.lower;
   const inside=zone.alert&&x>=zone.zone[0]&&x<=zone.zone[2]&&y>=zone.zone[1]&&y<=zone.zone[3];
   if(inside&&!s.zoned.has(t.id)){s.zoned.add(t.id);await alertEvent(s,'entered configured zone · track '+t.id);}
   if(!inside)s.zoned.delete(t.id);
   const person=persistedIdentity(rec);
   if(person&&person===zone.watch&&!rec.alerted){rec.alerted=true;await alertEvent(s,'verified '+pid(person)+' in view');}
  }
  if(s.visible.length>zone.limit&&!s.crowded)await alertEvent(s,'occupancy exceeded '+zone.limit);s.crowded=s.visible.length>zone.limit;
  if(!s.live)return;
  s.objectCounts={};for(const p of ans.pred)if(p.class!=='person')s.objectCounts[p.class]=(s.objectCounts[p.class]||0)+1;
  s.objectList.textContent=Object.entries(s.objectCounts).map(([label,n])=>label+' × '+n).join(' · ')||'No objects detected in this sample.';
  draw(s,ans.pred,ratio,dx,dy);s.step++;
  s.details.textContent=s.visible.length+' confirmed people · '+ans.pred.filter(p=>p.class!=='person').length+' objects · '+(s.fps===null?'capture FPS unavailable':s.fps.toFixed(1)+' displayed FPS')+' · '+Math.round(s.ms)+' ms inference · '+Math.round(s.delay)+' ms sample-to-result'+(s.kind==='upload'?' · '+mediaTime.toFixed(1)+' / '+v.duration.toFixed(1)+' s':'');
  if(page==='Overview'||page==='System health')render();
  s.timer=setTimeout(()=>run(()=>processSource(s)),s.kind==='upload'?0:50);
 }catch(e){if(s.live){await stop(s);throw e;}}
}
async function alertEvent(s,message){const text=s.camera+' · '+message;await api('alert',{message:text});toast(text);}
function inspectTrack(s,tid){
 const rec=s.ids.get(tid);if(!rec)return;
 const shot=element('img');shot.src=rec.crop.toDataURL('image/jpeg',.8);shot.className='tileimg';
 const consent=input('checkbox'),face=input('checkbox');
 const enroll=button('Enroll participant',async()=>{
  if(!consent.checked)throw Error('Confirm participant consent first.');
  const img=await imageOf(shot.src);
  const data={...rec.attr,appearance:rec.aid,image:shot.src,consent:true,faceConsent:face.checked};
  if(face.checked)data.face=await facial(img);
  const r=await api('enroll',data);closeDialog();await refresh();toast('Enrolled '+pid(r.id));
 });
 const choices=select(db.persons.filter(p=>p.face).map(p=>[p.id,pid(p.id)]),db.persons.find(p=>p.face)?.id||'');
 const compare=button('Compare to selected enrollment',async()=>{
  if(!consent.checked||!face.checked||!choices.value)throw Error('Select an enrolled participant and confirm current face-comparison consent.');
  const r=await api('face-check',{person:+choices.value,consent:true,face:await facial(await imageOf(shot.src))});
  closeDialog();toast('One-to-one face distance '+r.distance.toFixed(3)+' · '+(r.consistent?'consistent with reference':'insufficient similarity')+'. Human verification required.');
 });
 showDialog(element('h2','Track '+tid+' · '+s.camera),shot,element('p','Stored enrollment includes a reference crop and appearance descriptor. Enroll only a participant who has explicitly agreed.'),lab('Participant agreed to this enrollment or comparison',consent),lab('Participant separately agreed to face processing',face),enroll,choices,compare);
}
function imageOf(src){return new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(Error('Image could not be opened'));i.src=src;});}
function playback(r,offset=0){
 return button('Play at '+offset.toFixed(1)+' s',async()=>{
  const resp=await fetch('/api/media/'+r.id);if(!resp.ok)throw Error('Recording no longer available');
  const blob=await resp.blob();closeDialog();previewUrl=URL.createObjectURL(blob);
  const v=element('video');v.controls=true;v.src=previewUrl;v.onloadedmetadata=()=>{v.currentTime=Math.min(offset,Number.isFinite(v.duration)?v.duration:offset);};showDialog(element('h2',r.name),v);
 });
}
function clipAction(e){const r=db.recordings.find(v=>v.session===e.session);return r?playback(r,e.offset):'Unrecorded';}
function viewPerson(id){profileId=id;navigate('Person profile');}
function filteredEvents(){
 return db.events.filter(e=>{
  const d=new Date(e.at*1000),local=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString(),merit=db.reviews.filter(r=>r.appearance===e.id&&r.status!=='rejected');
  return (!filter.person||(e.person&&pid(e.person).toLowerCase().includes(filter.person.toLowerCase()))||merit.some(r=>pid(r.person).toLowerCase().includes(filter.person.toLowerCase())))&&
   (!filter.camera||e.camera.toLowerCase().includes(filter.camera.toLowerCase()))&&(!filter.color||[e.upper,e.lower].some(c=>c.includes(filter.color.toLowerCase())))&&
   (!filter.date||local.startsWith(filter.date))&&(!filter.time||local.slice(11,16)>=filter.time)&&(!filter.recording||db.recordings.some(r=>r.session===e.session&&r.name.toLowerCase().includes(filter.recording.toLowerCase())))&&
   (!filter.score||merit.some(r=>r.score>=Number(filter.score)/100));
 });
}
function filters(){
 const c=card();c.classList.add('toolbar');const widgets={};
 for(const [k,label,type] of [['person','Person ID','text'],['camera','Camera','text'],['color','Color','text'],['date','Date','date'],['time','From time','time'],['recording','Recording','text'],['score','Min. match score %','number']]){
  widgets[k]=input(type,filter[k]||'');if(k==='score'){widgets[k].min=0;widgets[k].max=100;}c.append(lab(label,widgets[k]));
 }c.append(button('Apply',()=>{for(const k in widgets)filter[k]=widgets[k].value;render();}),button('Clear',()=>{filter={};render();}));return c;
}
function eventTable(events){
 return table(['When','Source','Person / track','Clothing','Detection','Segment'],events.map(e=>[clock(e.at),e.camera,e.person?button(pid(e.person),()=>viewPerson(e.person)):'Track '+e.track,e.upper+' / '+e.lower,Math.round(e.score*100)+'%',clipAction(e)]));
}
function reviewTable(reviews){
 return table(['Candidate','Appearance','Score','Candidate clip','Verified reference clip','Decision'],reviews.map(r=>{
  const e=db.events.find(x=>x.id===r.appearance);if(!e)return [];
  const original=db.events.find(x=>x.person===r.person&&x.session!==e.session&&db.recordings.some(v=>v.session===x.session));
  const decision=element('div',undefined,'row');
  if(r.status==='pending'&&isAdmin()){
   for(const accept of [true,false])decision.append(button(accept?'Verify':'Reject',async()=>{await api('verify',{id:r.id,accept});await refresh();}));
  }else if(r.status==='automatic'&&isAdmin()){
   decision.append(button('Reject automatic link',async()=>{await api('undo-auto',{appearance:r.appearance});await refresh();}));
  }else decision.textContent=r.status;
  return [button(pid(r.person),()=>viewPerson(r.person)),e.camera+' · '+clock(e.at),Math.round(100*r.score)+'%',clipAction(e),original?clipAction(original):'No recorded reference',decision];
 }), 'No matching candidates. Enroll a consenting participant, then index another authorized appearance.');
}
function reportEvents(){return db.events.filter(e=>Date.now()/1000-e.at<=reportDays*86400);}
function csv(events){
 const rows=[['Event','Time','Camera','Track','Verified person','Upper','Lower','Detection score','Offset seconds'],...events.map(e=>[e.id,new Date(e.at*1000).toISOString(),e.camera,e.track,e.person?pid(e.person):'',e.upper,e.lower,e.score,e.offset])];
 const text=rows.map(r=>r.map(c=>{let v=String(c);if(/^[=+@\-]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';}).join(',')).join('\r\n');
 const url=URL.createObjectURL(new Blob([text],{type:'text/csv'})),a=element('a');a.href=url;a.download='ARGUS-X-events.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function chart(events){
 const c=card('Appearance trend'),bars=element('div',undefined,'bars'),bucket=Array(12).fill(0),now=Date.now()/1000,span=reportDays*86400/12;
 events.forEach(e=>{const n=11-Math.floor((now-e.at)/span);if(n>=0&&n<12)bucket[n]++;});
 const info=element('p','Select a bar to inspect its interval.');
 bucket.forEach((v,i)=>{const label=clock(now-(12-i)*span)+' – '+clock(now-(11-i)*span)+' · '+v+' appearances';const b=button('',()=>{info.textContent=label;});b.title=label;b.setAttribute('aria-label',label);b.style.height=Math.max(3,100*v/Math.max(1,...bucket))+'%';bars.append(b);});c.append(bars,info);return c;
}
function render(){
 if(!db)return;
 $('title').textContent=page;
 $('nav').querySelectorAll('button').forEach(b=>b.classList.toggle('current',b.textContent===page));
 $('controls').hidden=page!=='Live detection'||!isAdmin();$('searchControls').hidden=page!=='Cross-video person search'||!isAdmin();
 $('sources').hidden=!['Live detection','Cross-video person search'].includes(page);
 for(const s of sources.values())s.card.hidden=page!==(s.kind==='live'?'Live detection':'Cross-video person search');
 const c=$('content');c.replaceChildren();
 const active=[...sources.values()].filter(s=>s.kind==='live'),seen=active.reduce((n,s)=>n+s.visible.length,0);
 if(page==='Overview'){
  c.append(metrics([['Enrolled persons',db.persons.length],['Currently in view',seen],['Appearance events',db.events.length],['Active cameras',active.length],['Recordings',db.recordings.length],['Verified candidates',db.reviews.filter(r=>r.status==='verified').length]]),chart(reportEvents()));
  const a=card('Recent activity');a.append(eventTable(db.events.slice(0,8)));c.append(a);
 }else if(page==='Live detection'){
  if(!active.length)c.append(element('p',isAdmin()?'Choose a camera, confirm capture authorization, and start the feed.':'Live capture is available to administrators.'));
 }else if(page==='Camera management'){
  const form=card('Configure a camera zone'),label=input('text','Desk camera'),coords=[.25,.25,.75,.75].map(v=>input('number',v)),alert=input('checkbox'),limit=input('number',5),watch=select([[0,'None'],...db.persons.map(p=>[p.id,pid(p.id)])],0);
  const fields=element('div',undefined,'toolbar');fields.append(lab('Camera name',label));coords.forEach((n,i)=>{n.step=.05;n.min=0;n.max=1;fields.append(lab(['Left (0–1)','Top (0–1)','Right (0–1)','Bottom (0–1)'][i],n));});
  fields.append(lab('Zone alerts',alert),lab('Occupancy limit',limit),lab('Watch verified participant',watch),button('Save configuration',async()=>{await api('camera',{name:label.value,zone:coords.map(n=>Number(n.value)),alert:alert.checked,limit:Number(limit.value),watch:Number(watch.value)});await refresh();toast('Camera settings saved.');}));
  form.append(fields);if(isAdmin())c.append(form);
  c.append(table(['Camera','Capture','Zone','Capacity','Action'],db.cameras.map(r=>{const conf=JSON.parse(r.config);return [r.name,active.some(s=>s.camera===r.name)?'Live':'Idle',conf.alert?conf.zone.join(', '):'Off',conf.limit,button('Select',()=>{label.value=r.name;coords.forEach((n,i)=>n.value=conf.zone[i]);alert.checked=conf.alert;limit.value=conf.limit;watch.value=conf.watch||0;$('camName').value=r.name;})];})));
 }else if(page==='Person directory'){
  const search=input('search',filter.directory||''),gallery=element('div',undefined,'grid');
  function drawGallery(){gallery.replaceChildren();const found=db.persons.filter(p=>[pid(p.id),p.upper,p.lower].join(' ').toLowerCase().includes(search.value.toLowerCase()));for(const p of found){const n=card(pid(p.id)),im=element('img');im.className='tileimg';im.src=p.image;im.alt='Consented enrollment reference';n.append(im,element('p',p.upper+' / '+p.lower),button('View profile',()=>viewPerson(p.id)));gallery.append(n);}if(!found.length)gallery.append(element('p','No matching enrolled profiles.'));}
  search.oninput=()=>{filter.directory=search.value;drawGallery();};c.append(lab('Search ID or clothing color',search),gallery);drawGallery();
 }else if(page==='Person profile'){
  const p=db.persons.find(v=>v.id===profileId)||db.persons[0];if(!p){c.append(element('p','No enrolled profiles. Select a confirmed live track to enroll a participant.'));return;}
  const picker=select(db.persons.map(x=>[x.id,pid(x.id)]),p.id);picker.onchange=()=>viewPerson(+picker.value);c.append(lab('Participant',picker));
  const events=db.events.filter(e=>e.person===p.id),im=element('img');im.className='tileimg';im.src=p.image;const a=card(pid(p.id));a.append(im,element('p','Enrolled '+clock(p.created)+' · upper '+p.upper+' / lower '+p.lower+' · accessories '+(p.accessories?.join(', ')||'none recorded')+' · face comparison '+(p.face?'enabled':'off')));
  if(isAdmin())a.append(button('Delete enrollment',async()=>{if(!confirm('Delete the stored reference, face descriptor and identity links for '+pid(p.id)+'?'))return;await api('delete-person',{id:p.id});profileId=null;await refresh();}));
  c.append(a,metrics([['Linked appearances',events.length],['Sources',new Set(events.map(e=>e.camera)).size],['First linked',events.length?clock(events[events.length-1].at):'—'],['Last linked',events.length?clock(events[0].at):'—']]),eventTable(events));
 }else if(page==='Person re-identification'||page==='Identity match history'){
  c.append(element('p','Appearance similarity proposes candidates. A reviewer verifies a link using the reference and source evidence.'),reviewTable(db.reviews.filter(r=>page==='Identity match history'||r.status==='pending')));
 }else if(page==='Cross-video person search'){
  if(isAdmin()){
   const ref=card('Search with a participant reference'),picker=input('file'),consent=input('checkbox');picker.accept='image/jpeg,image/png';
   ref.append(lab('Reference showing one person',picker),lab('Participant authorized this search',consent),button('Find candidates',async()=>{
    if(!consent.checked||!picker.files[0]||picker.files[0].size>8e6)throw Error('Select an authorized image under 8 MB.');
    const url=URL.createObjectURL(picker.files[0]);
    try{const img=await imageOf(url),cv=element('canvas');cv.width=480;cv.height=270;const ctx=cv.getContext('2d');const k=Math.min(480/img.width,270/img.height);ctx.drawImage(img,(480-img.width*k)/2,(270-img.height*k)/2,img.width*k,img.height*k);
     const bytes=ctx.getImageData(0,0,480,270).data,res=await infer(bytes.slice(),480,270),people=res.pred.filter(p=>p.class==='person');
     if(people.length!==1)throw Error('Exactly one detectable person is needed in the reference.');
     const a=describe(bytes,480,270,people[0].bbox);const matches=await api('search-image',{descriptor:a.descriptor,embedding:people[0].embedding,consent:true});
     showDialog(element('h2','Reference candidates'),table(['Participant','Appearance similarity'],matches.candidates.map(m=>[button(pid(m.person),()=>{closeDialog();viewPerson(m.person);}),Math.round(m.score*100)+'%']),'No enrolled profile reached the candidate threshold.'));
    }finally{URL.revokeObjectURL(url);}
   }));c.append(ref);
  }
  c.append(filters());const ev=filteredEvents();c.append(reviewTable(db.reviews.filter(r=>ev.some(e=>e.id===r.appearance))),eventTable(ev));
 }else if(page==='Video recordings'){
  c.append(table(['Recording','Source','Start','Duration','Size','Playback','Retention'],db.recordings.map(r=>[r.name,r.camera,clock(r.start),r.duration.toFixed(1)+' s',(r.bytes/1048576).toFixed(1)+' MB',playback(r),isAdmin()?button('Delete',async()=>{if(confirm('Delete this recording and its indexed appearances?')){await api('delete-recording',{id:r.id});await refresh();}}):'Managed'])));
 }else if(page==='Analytics & reports'){
  const ev=reportEvents(),period=select([[1,'Daily'],[7,'Weekly'],[30,'Monthly · 30 days']],reportDays);period.onchange=()=>{reportDays=+period.value;render();};
  const controls=element('div',undefined,'toolbar');controls.append(lab('Report interval',period),button('Export CSV',()=>csv(ev)),button('Print / Save PDF',()=>print()));c.append(controls,metrics([['Appearances',ev.length],['Verified participants',new Set(ev.filter(e=>e.person).map(e=>e.person)).size],['Sources',new Set(ev.map(e=>e.camera)).size]]),chart(ev));
  const bins=db.occupancy.filter(o=>o.hour>=(Date.now()/1000-reportDays*86400)/3600-1);const h=card('Occupancy heatmap · sampled person-seconds'),names=[...new Set(bins.map(o=>o.camera))];if(!names.includes(heatCamera))heatCamera=names[0]||'';const cam=select(names.map(n=>[n,n]),heatCamera);cam.onchange=()=>{heatCamera=cam.value;render();};h.append(cam);
  const grid=element('div',undefined,'heat'),cells=Array(40).fill(0);bins.filter(o=>o.camera===heatCamera).forEach(o=>cells[o.cell]+=o.samples);
  cells.forEach(n=>{const cell=element('span',n);cell.style.background='rgba(84,195,153,'+(.08+.8*n/Math.max(1,...cells))+')';grid.append(cell);});h.append(grid);c.append(h,eventTable(ev));
 }else if(page==='System health'){
  c.append(metrics([['Database',health.database||'Checking'],['Encrypted media',((health.storage||0)/1048576).toFixed(1)+' MB'],['Free disk',health.diskFree?(health.diskFree/1073741824).toFixed(1)+' GB':'—'],['System RAM used',health.memoryUsedPct==null?'Unavailable':health.memoryUsedPct+'%'],['System CPU used',health.cpuUsed==null?'Awaiting second sample':health.cpuUsed+'%'],['GPU utilization','Unavailable']]),table(['Source','Backend','Inference time','Capture FPS','Processing delay'],[...sources.values()].map(s=>[s.camera,s.backend||'Starting',Math.round(s.ms)+' ms',s.fps?.toFixed(1)||'Unavailable',s.delay?Math.round(s.delay)+' ms':'—'])),button('Refresh health',()=>navigate(page)));
 }else if(page==='Settings'){
  const a=card('Local access and retention');a.append(element('p','Signed in as '+name+' · '+role+'. Recordings and appearance events expire after '+(db.settings.days||7)+' days. Enrollments persist until removed.'));
  if(isAdmin()){
   const days=input('number',db.settings.days||7);days.min=1;days.max=90;a.append(lab('Retention in days (1–90)',days),button('Save retention',async()=>{await api('settings',{days:+days.value});await refresh();}));
   const u=input('text'),p=input('password'),r=select([['viewer','Viewer'],['admin','Administrator']],'viewer');
   const b=card('Create a local account');b.append(lab('Account name',u),lab('Password (10+ characters)',p),lab('Role',r),button('Create account',async()=>{await api('user',{name:u.value,password:p.value,role:r.value});await refresh();toast('Account created.');}));c.append(b);
  }
  c.append(a);if(isAdmin())c.append(table(['Time','Account','Audit event'],db.audit.slice(0,100).map(x=>[clock(x.at),x.user,x.action])));
 }
}
$('devices').onclick=()=>run(async()=>{const devices=await navigator.mediaDevices.enumerateDevices();$('device').replaceChildren(new Option('Default camera',''));devices.filter(d=>d.kind==='videoinput').forEach((d,i)=>$('device').add(new Option(d.label||'Camera '+(i+1),d.deviceId)));});
$('start').onclick=()=>run(()=>begin('live'));$('indexClip').onclick=()=>run(()=>begin('upload'));
$('logout').onclick=()=>run(async()=>{for(const s of [...sources.values()])await stop(s);await api('logout',{});location.reload();});
$('auth').onsubmit=async e=>{e.preventDefault();try{await api(setup?'setup':'login',{name:$('account').value,password:$('pass').value,token:setupToken});$('pass').value='';await boot();}catch(e){$('authError').textContent=e.message;}};
async function boot(){
 if(location.protocol==='file:'){throw Error('Open Start-Analytics.bat for the local sign-in workspace.');}
 const state=await api('status');setup=state.initial;
 if(!state.name){$('authTitle').textContent=setup?'Create local administrator':'Sign in';$('authHint').textContent=setup?'Use the private local link opened by the launcher. Choose a password of at least ten characters.':'Your workspace is stored on this computer.';return;}
 role=state.role;name=state.name;$('gate').hidden=true;$('shell').hidden=false;$('who').textContent=name+' · '+role;$('nav').replaceChildren();pages.forEach(p=>$('nav').append(button(p,()=>navigate(p))));await refresh();
}
window.addEventListener('pagehide',()=>{for(const s of sources.values())s.stream?.getTracks().forEach(t=>t.stop());resetWorker();});
boot().catch(e=>$('authError').textContent=e.message);
