'use strict';
const el=id=>document.getElementById(id);
const video=el('video'),view=el('view'),ctx=view.getContext('2d');
const sample=document.createElement('canvas');
sample.width=320;sample.height=180;
const pixels=sample.getContext('2d',{willReadFrequently:true});
let generation=0,stream=null,timer=0,tracker,startedAt,mediaTime,frozen=false,warming=true;
let sides=new Map(),counts={left:0,right:0},events=[],active=0;
function stats(){
  el('active').textContent=active;el('rec').textContent=tracker?tracker.recoveries:0;
  for(const direction of ['left','right'])el(direction).textContent=counts[direction];
  el('events').textContent=events.slice(-6).reverse().map(e=>
    e.seconds.toFixed(1)+' s   ·   ID '+e.id+'   ·   '+(e.direction==='right'?'Left → right':'Right → left')
  ).join('   |   ')||'Waiting for a crossing.';
}
function stop(message='Camera off'){
  generation++;clearTimeout(timer);
  if(stream)stream.getTracks().forEach(track=>track.stop());
  stream=null;video.pause();video.srcObject=null;frozen=false;active=0;
  el('start').disabled=false;el('stop').disabled=true;el('freeze').disabled=true;
  el('freeze').textContent='Freeze display';el('state').textContent=message;
  ctx.clearRect(0,0,view.width,view.height);el('hint').hidden=false;stats();
}
function countCrossings(tracks,time){
  const retained=new Set(tracker.tracks.map(t=>t.id));
  for(const id of sides.keys())if(!retained.has(id))sides.delete(id);
  for(const t of tracks){
    if(Math.min(t.box[2],t.box[3])<7)continue;
    const x=t.box[0]+t.box[2]/2;
    let memory=sides.get(t.id);
    if(!memory||time-memory.time>=.8){
      memory={side:null,pending:null,hits:0};sides.set(t.id,memory);
    }
    memory.time=time;
    if(Math.abs(x-160)<6){memory.hits=0;continue;}
    const side=x>160?'right':'left';
    memory.hits=side===memory.pending?memory.hits+1:1;memory.pending=side;
    if(memory.hits<2)continue;
    if(memory.side&&memory.side!==side){
      counts[side]++;events.push({seconds:time,id:t.id,direction:side});
      if(events.length>500)events.shift();
    }
    memory.side=side;
  }
}
function draw(rect,tracks){
  ctx.fillStyle='#101615';ctx.fillRect(0,0,960,540);
  ctx.drawImage(video,...rect.map(x=>x*3));
  ctx.save();ctx.scale(3,3);ctx.strokeStyle='#ffffff';ctx.lineWidth=.8;
  ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(160,rect[1]);ctx.lineTo(160,rect[1]+rect[3]);ctx.stroke();ctx.setLineDash([]);
  function mark(b,text,color){
    ctx.strokeStyle=color;ctx.strokeRect(...b);ctx.font='bold 6px monospace';
    const y=Math.max(8,b[1]);ctx.fillStyle=color;ctx.fillRect(b[0],y-8,ctx.measureText(text).width+4,8);
    ctx.fillStyle='#162016';ctx.fillText(text,b[0]+2,y-2);
  }
  for(const t of tracks)mark(t.box,'ID '+t.id,'#c1f68c');
  for(const b of tracker.uncertain||[])mark(b,'UNCERTAIN','#ffbe68');
  ctx.restore();stats();
}
function frame(token){
  if(token!==generation||!stream)return;
  try{
    if(video.readyState>=2&&video.videoWidth&&video.currentTime!==mediaTime){
      mediaTime=video.currentTime;
      const now=performance.now(),time=(now-startedAt)/1000;
      const scale=Math.min(320/video.videoWidth,180/video.videoHeight);
      const w=video.videoWidth*scale,h=video.videoHeight*scale,rect=[(320-w)/2,(180-h)/2,w,h];
      let tracks=[];
      if(time>=1){
        if(warming){warming=false;el('state').textContent='Live';el('freeze').disabled=false;}
        pixels.fillStyle='#101615';pixels.fillRect(0,0,320,180);pixels.drawImage(video,...rect);
        tracks=tracker.frame(pixels.getImageData(0,0,320,180).data,time,Number(el('threshold').value));
        active=tracks.length;countCrossings(tracks,time);
      }
      if(!frozen)draw(rect,tracks);
    }
    timer=setTimeout(()=>frame(token),80);
  }catch(error){stop('Camera stopped');el('error').textContent='Frame processing stopped. '+error.message;}
}
async function start(){
  const token=++generation;el('start').disabled=true;el('stop').disabled=false;
  el('error').textContent='';el('state').textContent='Requesting camera';
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Open Start-Live-Camera.bat and use Chrome or Edge on this laptop.');
    const acquired=await navigator.mediaDevices.getUserMedia({audio:false,video:{width:{ideal:640},height:{ideal:360},frameRate:{ideal:24}}});
    if(token!==generation){acquired.getTracks().forEach(t=>t.stop());return;}
    stream=acquired;
    const device=stream.getVideoTracks()[0];
    device.onended=()=>{if(token===generation)stop('Camera disconnected');};
    video.srcObject=stream;await video.play();
    if(token!==generation)return;
    tracker=new Argus.Tracker(320,180,{stabilize:false});counts={left:0,right:0};events=[];sides.clear();active=0;
    startedAt=performance.now();mediaTime=-1;warming=true;frozen=false;
    el('device').textContent=device.label||'Laptop camera';el('state').textContent='Keep scene empty…';
    el('hint').hidden=true;el('save').disabled=false;stats();frame(token);
  }catch(error){
    if(token!==generation)return;
    stop('Camera unavailable');
    const tips={NotAllowedError:'Allow camera access in the browser address bar and in Windows camera privacy settings, then try again.',
      NotFoundError:'No camera was found. Enable the built-in webcam or connect a USB camera.',
      NotReadableError:'Close other camera apps, check the privacy shutter, and try again.'};
    el('error').textContent=tips[error.name]||error.message;
  }
}
el('start').onclick=start;el('stop').onclick=()=>stop();
el('freeze').onclick=()=>{
  if(warming)return;
  frozen=!frozen;el('freeze').textContent=frozen?'Resume display':'Freeze display';
  el('state').textContent=frozen?'Display frozen · counting continues':'Live';
};
el('threshold').oninput=()=>el('level').textContent=el('threshold').value;
el('save').onclick=()=>{
  const report={camera:el('device').textContent,counts:{...counts},recoveries:tracker.recoveries,recentCrossings:events,retainedEventLimit:500};
  const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='argus-live-counts.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
window.addEventListener('pagehide',()=>stop());
