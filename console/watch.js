/* Instance matching: a user-supplied watch crop, sampled at several scales. */
(function(root){
 const N=10;
 function signature(data,width,box){
  const [x,y,w,h]=box,out=new Float32Array(N*N),mean=[0,0,0];let sum=0;
  for(let r=0;r<N;r++)for(let c=0;c<N;c++){
   const k=4*(Math.floor(y+(r+.5)*h/N)*width+Math.floor(x+(c+.5)*w/N));
   const lum=(data[k]+2*data[k+1]+data[k+2])/4;out[r*N+c]=lum;sum+=lum;
   for(let j=0;j<3;j++)mean[j]+=data[k+j]/(N*N);
  }
  let energy=0;for(let i=0;i<out.length;i++){out[i]-=sum/out.length;energy+=out[i]*out[i];}
  const norm=Math.sqrt(energy);return {w,h,mean,contrast:norm/N,v:Array.from(out,a=>a/(norm||1))};
 }
 function locate(data,width,height,ref){
  if(!ref||ref.contrast<9)return null;
  let best=.78,bbox=null;
  for(const scale of [.72,.85,1,1.18,1.4]){
   const w=Math.round(ref.w*scale),h=Math.round(ref.h*scale);
   const step=Math.max(2,Math.round(Math.min(w,h)/10));
   for(let y=0;y<=height-h;y+=step)for(let x=0;x<=width-w;x+=step){
    let sum=0,squares=0,dot=0,rSum=0,gSum=0,bSum=0;
    for(let r=0;r<N;r++){const row=width*Math.floor(y+(r+.5)*h/N);
     for(let c=0;c<N;c++){
      const k=4*(row+Math.floor(x+(c+.5)*w/N)),red=data[k],g=data[k+1],b=data[k+2],lum=(red+2*g+b)/4;
      sum+=lum;squares+=lum*lum;dot+=ref.v[r*N+c]*lum;rSum+=red;gSum+=g;bSum+=b;
     }
    }
    const energy=squares-sum*sum/(N*N);if(energy<6400)continue;
    const colorError=(Math.abs(rSum/100-ref.mean[0])+Math.abs(gSum/100-ref.mean[1])+Math.abs(bSum/100-ref.mean[2]))/765;
    const score=dot/Math.sqrt(energy)-.4*colorError;
    if(score>best){best=score;bbox=[x,y,w,h];}
   }
  }
  return bbox?{class:'watch (reference)',bbox,score:Math.min(1,best)}:null;
 }
 root.WatchMatch={signature,locate};
})(typeof self==='undefined'?globalThis:self);
