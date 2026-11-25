'use strict';
const $=id=>document.getElementById(id),video=$('video'),view=$('view'),ctx=view.getContext('2d');
const sample=document.createElement('canvas');sample.width=320;sample.height=180;
const pixels=sample.getContext('2d',{willReadFrequently:true});
const fps=12,tag=id=>'ID '+String(id).padStart(2,'0');
let tracker,evaluator,tracks,history,events,index,threshold,playing=false,busy=false,isDemo=true,ready=false;
let generation=0,objectURL=null,timer,ambiguous=false;
function status(s){$('state').textContent=s;}
function pause(){
  playing=false;clearTimeout(timer);$('play').textContent=index>0?'▶  Resume':'▶  Run tracking';
  if(ready)status('Paused');
}
function initialize(){
  tracker=new Argus.Tracker(320,180);evaluator=new Argus.Evaluator();tracks=[];events=[];history=[];
  index=0;ambiguous=false;threshold=Number($('sensitivity').value);busy=false;
}
function load(file){
  generation++;video.onseeked=null;pause();initialize();ready=false;isDemo=!file;
  $('play').disabled=true;$('restart').disabled=true;$('export').disabled=true;
  if(objectURL)URL.revokeObjectURL(objectURL);objectURL=file?URL.createObjectURL(file):null;
  $('source').textContent=file?file.name:'Bay 04 · Occlusion trial';
  $('error').textContent='';status('Loading');$('note').textContent=isDemo?
    'Generated benchmark · 12 samples/s · Recall and switches use labeled crates at least 75% visible.':
    'Uploaded video · 12 samples/s · Ground-truth metrics require labels and are unavailable for uploads.';
  video.src=objectURL||ARGUS_DEMO;video.load();summary();renderEvents();
}
function rectangle(){
  const scale=Math.min(320/video.videoWidth,180/video.videoHeight);
  const w=video.videoWidth*scale,h=video.videoHeight*scale;
  return [(320-w)/2,(180-h)/2,w,h];
}
function draw(){
  ctx.fillStyle='#101615';ctx.fillRect(0,0,960,540);
  ctx.drawImage(video,...rectangle().map(n=>n*3));
  ctx.save();ctx.scale(3,3);
  function box(b,color,label){
    const [x,y,w,h]=b;ctx.strokeStyle=color;ctx.lineWidth=.85;ctx.strokeRect(x,y,w,h);
    ctx.font='bold 5px monospace';const width=ctx.measureText(label).width+4,top=Math.max(0,y-8);
    ctx.fillStyle=color;ctx.fillRect(x,top,width,7);ctx.fillStyle='#102015';ctx.fillText(label,x+2,top+5.3);
  }
  for(const t of tracks){
    if($('trails').checked&&t.path.length){
      ctx.beginPath();t.path.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));
      ctx.strokeStyle='#bffc8e';ctx.lineWidth=.6;ctx.stroke();
    }
    box(t.box,'#c1f68c',tag(t.id));
  }
  for(const b of tracker.uncertain||[])box(b,'#ffbe68','UNCERTAIN');
  ctx.restore();
}
function summary(){
  const memory=tracker.tracks.filter(t=>t.hits>=3);
  $('memoryCount').textContent=memory.length+' IDs';$('active').textContent=tracks.length;
  $('recoveries').textContent=tracker.recoveries;
  $('switches').textContent=isDemo&&evaluator.total?evaluator.switches:'—';
  $('recall').textContent=isDemo&&evaluator.total?(100*evaluator.matches/evaluator.total).toFixed(1)+'%':'—';
  $('memory').innerHTML=memory.length?memory.map(t=>{
    const seen=t.seen===tracker.time;
    return '<div class="idrow"><b>'+tag(t.id)+'</b><span>'+(seen?'Active · '+Math.round(100*t.score)+'% match':'Missing · '+(tracker.time-t.seen).toFixed(1)+' s')+'</span></div>';
  }).join(''):'<p class="empty">Confirmed identities appear here after three matched samples.</p>';
  const duration=ready?video.duration:0,time=Math.min(index/fps,duration);
  $('progress').value=duration?time/duration:0;$('clock').textContent=time.toFixed(1)+' / '+duration.toFixed(1)+' s';
}
function renderEvents(){
  $('events').textContent='';
  if(!events.length){$('events').textContent='Run tracking to see identity confirmations and recoveries.';return;}
  for(const e of events.slice(-30).reverse()){
    const row=document.createElement('div');row.className='eventrow';
    const time=document.createElement('time');time.textContent=e.time.toFixed(2)+' s';
    const id=document.createElement('b');id.textContent=e.id?tag(e.id):'Review';
    row.append(time,id,document.createTextNode(e.type+(e.gap?' after '+e.gap.toFixed(2)+' s':'')));$('events').append(row);
  }
}
function capture(){
  const time=index/fps;
  pixels.fillStyle='#101615';pixels.fillRect(0,0,320,180);pixels.drawImage(video,...rectangle());
  tracks=tracker.frame(pixels.getImageData(0,0,320,180).data,time,threshold);
  if(isDemo&&ARGUS_TRUTH[index])evaluator.add(tracks,ARGUS_TRUTH[index]);
  const found=tracker.events.slice();
  if(tracker.uncertain.length&&!ambiguous)found.push({time,type:'Ambiguous match held'});
  ambiguous=tracker.uncertain.length>0;
  if(found.length){events.push(...found);renderEvents();}
  history.push({time,tracks:tracks.map(t=>({id:t.id,box:t.box.slice(),score:+t.score.toFixed(3)})),uncertain:tracker.uncertain});
  index++;draw();summary();$('export').disabled=false;
}
function finish(){
  pause();status('Complete');$('play').textContent='↻  Replay';$('progress').value=1;
}
function step(){
  if(!playing||busy||!ready)return;
  if(index/fps>=video.duration-.001){finish();return;}
  const token=generation,target=index/fps+.001,start=performance.now();busy=true;
  function process(){
    if(token!==generation)return;
    busy=false;
    try{capture();}catch(e){pause();$('error').textContent='Frame analysis failed. '+e.message;return;}
    if(index/fps>=video.duration-.001){finish();return;}
    if(playing)timer=setTimeout(step,Math.max(0,1000/fps-(performance.now()-start)));
  }
  if(Math.abs(video.currentTime-target)<.0005&&!video.seeking){process();return;}
  video.onseeked=()=>{video.onseeked=null;process();};video.currentTime=Math.min(target,video.duration-.0001);
}
function start(){
  if(!ready)return;
  if(index/fps>=video.duration-.001)initialize();
  playing=true;status('Tracking');$('play').textContent='Ⅱ  Pause';step();
}
video.onloadeddata=()=>{
  if(!Number.isFinite(video.duration)||video.duration<=0){$('error').textContent='Use a video file with a finite duration, such as an MP4.';return;}
  ready=true;$('play').disabled=false;$('restart').disabled=false;status('Ready');draw();summary();
};
video.onerror=()=>{pause();ready=false;status('Unavailable');$('play').disabled=true;$('error').textContent='This video could not be decoded. Try an H.264 MP4 in Chrome or Edge.';};
$('play').onclick=()=>playing?pause():start();
$('restart').onclick=()=>{generation++;video.onseeked=null;pause();initialize();summary();renderEvents();start();};
$('demo').onclick=()=>load(null);
$('file').onchange=e=>{const f=e.target.files[0];if(f)load(f);e.target.value='';};
$('sensitivity').oninput=()=>$('level').textContent=$('sensitivity').value;
$('trails').onchange=()=>{if(ready)draw();};
$('export').onclick=()=>{
  const data={source:$('source').textContent,sampleRate:fps,threshold,coordinates:'xywh on 320x180 letterboxed frame',complete:index/fps>=video.duration-.001,
    recoveries:tracker.recoveries,evaluation:isDemo?{matched:evaluator.matches,visible:evaluator.total,idSwitches:evaluator.switches}:null,events,frames:history};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'})),a=document.createElement('a');
  a.href=url;a.download='argus-session.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
load(null);
