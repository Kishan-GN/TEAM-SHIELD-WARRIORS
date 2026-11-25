/* ARGUS-X pixel tracker. All coordinates use the analysis canvas. */
(function(root){
'use strict';
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const center=b=>[b[0]+b[2]/2,b[1]+b[3]/2];
function overlap(a,b){
  const w=Math.max(0,Math.min(a[0]+a[2],b[0]+b[2])-Math.max(a[0],b[0]));
  const h=Math.max(0,Math.min(a[1]+a[3],b[1]+b[3])-Math.max(a[1],b[1]));
  return w*h/(a[2]*a[3]+b[2]*b[3]-w*h||1);
}
class Detector {
  constructor(w,h,stabilize){this.w=w;this.h=h;this.stabilize=stabilize;}
  camera(gray){
    const {w,h,bg}=this;
    let best=Infinity,shift=[0,0];
    for(let dy=-3;dy<=3;dy++)for(let dx=-4;dx<=4;dx++){
      let sum=0;
      for(let y=6;y<h-6;y+=6)for(let x=6;x<w-6;x+=5){
        const p=y*w+x;
        const k=4*(p-dy*w-dx);
        sum+=Math.min(22,Math.abs(gray[p]-(bg[k]+2*bg[k+1]+bg[k+2])/4));
      }
      sum+=0.6*(Math.abs(dx)+Math.abs(dy));
      if(sum<best){best=sum;shift=[dx,dy];}
    }
    return shift;
  }
  frame(rgb,sensitivity=25){
    const {w,h}=this,n=w*h,gray=new Uint8Array(n);
    for(let p=0;p<n;p++)gray[p]=(rgb[4*p]+2*rgb[4*p+1]+rgb[4*p+2])/4;
    if(!this.previous){
      this.previous=gray;this.bg=new Float32Array(rgb);this.next=new Float32Array(rgb.length);
      return {detections:[],shift:[0,0]};
    }
    const shift=this.stabilize?this.camera(gray):[0,0],[dx,dy]=shift,mask=new Uint8Array(n);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const p=y*w+x,k=p*4,j=((y-dy)*w+x-dx)*4;
      const inside=x-dx>=0&&x-dx<w&&y-dy>=0&&y-dy<h;
      let delta=0;
      for(let c=0;c<3;c++)delta+=Math.abs(rgb[k+c]-(inside?this.bg[j+c]:rgb[k+c]));
      const fg=delta>3*sensitivity;
      mask[p]=fg?1:0;
      const rate=fg?0.008:0.09;
      for(let c=0;c<3;c++)this.next[k+c]=inside?this.bg[j+c]*(1-rate)+rgb[k+c]*rate:rgb[k+c];
    }
    [this.bg,this.next]=[this.next,this.bg];this.previous=gray;
    // Remove thin registration edges by opening the foreground mask.
    const core=new Uint8Array(n);
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
      const k=y*w+x;
      if(mask[k]&&mask[k-1]&&mask[k+1]&&mask[k-w]&&mask[k+w])core[k]=1;
    }
    mask.fill(0);
    for(let k=w+1;k<n-w-1;k++)if(core[k]){
      mask[k]=mask[k-1]=mask[k+1]=mask[k-w]=mask[k+w]=1;
    }
    const detections=[],queue=new Int32Array(n);
    for(let p=0;p<n;p++){
      if(!mask[p])continue;
      let head=0,tail=1,minX=w,minY=h,maxX=0,maxY=0;
      const hist=new Float32Array(64);
      queue[0]=p;mask[p]=0;
      while(head<tail){
        const j=queue[head++],x=j%w,y=(j-x)/w;
        minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
        hist[(rgb[4*j]>>6)*16+(rgb[4*j+1]>>6)*4+(rgb[4*j+2]>>6)]++;
        for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){
          const xx=x+ox,yy=y+oy,k=yy*w+xx;
          if(xx>=0&&xx<w&&yy>=0&&yy<h&&mask[k]){mask[k]=0;queue[tail++]=k;}
        }
      }
      const bw=maxX-minX+1,bh=maxY-minY+1;
      if(tail<32||bw<4||bh<4||tail>n*.38||tail/(bw*bh)<.19)continue;
      for(let k=0;k<64;k++)hist[k]/=tail;
      detections.push({box:[minX,minY,bw,bh],hist,area:tail});
    }
    return {detections:detections.sort((a,b)=>b.area-a.area).slice(0,48),shift};
  }
}
// Rectangular minimum-cost assignment with one unmatched option per track.
function assignment(cost){
  if(!cost.length)return [];
  const n=cost.length,m=cost[0].length,u=Array(n+1).fill(0),v=Array(m+1).fill(0);
  const owner=Array(m+1).fill(0),way=Array(m+1).fill(0);
  for(let i=1;i<=n;i++){
    owner[0]=i;let j=0;
    const min=Array(m+1).fill(Infinity),used=Array(m+1).fill(false);
    do{
      used[j]=true;const row=owner[j];let step=Infinity,next=0;
      for(let k=1;k<=m;k++)if(!used[k]){
        const val=cost[row-1][k-1]-u[row]-v[k];
        if(val<min[k]){min[k]=val;way[k]=j;}
        if(min[k]<step){step=min[k];next=k;}
      }
      for(let k=0;k<=m;k++){if(used[k]){u[owner[k]]+=step;v[k]-=step;}else min[k]-=step;}
      j=next;
    }while(owner[j]);
    do{const prev=way[j];owner[j]=owner[prev];j=prev;}while(j);
  }
  const out=Array(n).fill(-1);
  owner.forEach((i,j)=>{if(i)out[i-1]=j-1;});return out;
}
class Tracker {
  constructor(w,h,{stabilize=true}={}){this.detector=new Detector(w,h,stabilize);this.tracks=[];this.serial=0;this.events=[];this.recoveries=0;}
  frame(rgb,time,sensitivity){const result=this.detector.frame(rgb,sensitivity);return this.update(result.detections,time,result.shift);}
  update(ds,time,shift=[0,0]){
    const dt=Math.max(.001,time-(this.time??time));this.time=time;
    this.events=[];this.uncertain=[];this.shift=shift;
    this.tracks=this.tracks.filter(t=>time-t.seen<=(t.label?30:8));
    const ts=this.tracks;
    for(const t of ts){t.box[0]+=shift[0];t.box[1]+=shift[1];}
    const costs=ts.map(t=>ds.map(d=>{
      if(t.label!==d.label)return 9;
      const gap=time-t.seen,pt=center(t.box),q=center(d.box);
      const predicted=[pt[0]+t.v[0]*Math.min(3,gap),pt[1]+t.v[1]*Math.min(3,gap)];
      const scale=Math.max(10,Math.hypot(...t.shape));
      const spatial=distance(predicted,q)/(scale*(.85+Math.min(4,gap)*1.15));
      let similarity=0;
      for(let k=0;k<64;k++)similarity+=Math.min(t.hist[k],d.hist[k]);
      if(t.embedding&&d.embedding){
        let cosine=0;
        for(let k=0;k<d.embedding.length;k++)cosine+=t.embedding[k]*d.embedding[k];
        if(cosine<.55)return 9;
        similarity=.45*similarity+.55*Math.min(1,cosine);
      }
      const size=Math.abs(Math.log((d.box[2]*d.box[3])/(t.box[2]*t.box[3])));
      if(d.label&&t.misses>0){
        if(similarity<.55||size>1.2)return 9;
        return .55*(1-similarity)+.25*Math.min(spatial,1.7)+.15*size;
      }
      if(spatial>2||size>1.85)return 9;
      if(d.embedding&&t.embedding)return .34*spatial+.36*(1-similarity)+.30*(1-overlap(t.box,d.box))+.10*size;
      return .48*spatial+.43*(1-similarity)+.13*size;
    }));
    const selected=assignment(costs.map(row=>row.concat(ts.map(()=>.78))));
    const held=new Set(),used=new Set();
    selected.forEach((j,i)=>{
      if(j>=ds.length||costs[i][j]>=.78)return;
      const t=ts[i],gap=time-t.seen;
      const alternative=Math.min(Infinity,...costs.filter((_,r)=>r!==i).map(row=>row[j]),...costs[i].filter((_,c)=>c!==j));
      if((gap>.26||alternative<.25)&&alternative-costs[i][j]<.085){
        held.add(j);this.uncertain.push(ds[j].box);return;
      }
      const d=ds[j],a=center(t.box),b=center(d.box);
      if(gap<.45&&d.box[2]>.77*t.shape[0]&&d.box[3]>.77*t.shape[1]){
        for(let k=0;k<2;k++)t.v[k]=.67*t.v[k]+.33*(b[k]-a[k])/Math.max(dt,gap);
      }
      if(t.hits>=3&&(t.label?t.misses>0&&gap>.4:gap>.4)){this.recoveries++;this.events.push({time,id:t.id,type:'Recovered',gap});}
      if(d.box[2]>=.8*t.shape[0]&&d.box[3]>=.8*t.shape[1]){
        for(let k=0;k<2;k++)t.shape[k]=.95*t.shape[k]+.05*d.box[k+2];
      }
      if(gap<.4)for(let k=0;k<64;k++)t.hist[k]=.94*t.hist[k]+.06*d.hist[k];
      if(d.embedding)t.embedding=d.embedding.slice();
      t.misses=0;t.confidence=d.confidence;t.box=d.box.slice();t.seen=time;t.hits++;t.score=Math.max(0,1-costs[i][j]);
      t.path.push(b);if(t.path.length>22)t.path.shift();used.add(j);
      if(t.hits===3)this.events.push({time,id:t.id,type:'Confirmed'});
    });
    ds.forEach((d,j)=>{
      if(used.has(j)||held.has(j))return;
      ts.push({embedding:d.embedding?.slice(),label:d.label,confidence:d.confidence,misses:0,id:++this.serial,box:d.box.slice(),shape:d.box.slice(2),hist:d.hist.slice(),seen:time,hits:1,v:[0,0],score:0,path:[center(d.box)]});
    });
    for(const t of ts)if(t.seen!==time)t.misses++;
    this.tracks=ts.filter(t=>t.hits>=3||time-t.seen<.25).sort((a,b)=>b.seen-a.seen||b.hits-a.hits).slice(0,96);
    return this.tracks.filter(t=>t.hits>=3&&t.seen===time);
  }
}
class Evaluator{
  constructor(){this.total=0;this.matches=0;this.switches=0;this.last={};}
  add(tracks,truth){
    const used=new Set();
    for(const obj of truth.filter(o=>o.visible>=.75)){
      this.total++;const b=obj.box.map(x=>x/2);
      const candidates=tracks.filter(t=>!used.has(t.id)).map(t=>[overlap(t.box,b),t.id]).sort((a,b)=>b[0]-a[0]);
      if(!candidates.length||candidates[0][0]<.35)continue;
      const id=candidates[0][1];used.add(id);this.matches++;
      if(this.last[obj.label]!==undefined&&this.last[obj.label]!==id)this.switches++;
      this.last[obj.label]=id;
    }
  }
}
root.Argus={Tracker,Evaluator,assignment,overlap};
})(typeof window==='undefined'?globalThis:window);
