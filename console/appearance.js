/* Coarse visible clothing descriptors. Texture votes measure gradient directions. */
const palette=['black','charcoal','gray','white','red','orange','yellow','green','teal','cyan','blue','navy','purple','pink','brown','beige'];
function colorBin(r,g,b){
 const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;
 if(mx<40)return 0;
 if(d<Math.max(18,mx*.17))return mx<80?1:mx<173?2:3;
 let h=mx===r?(g-b)/d:mx===g?2+(b-r)/d:4+(r-g)/d;
 h=(h*60+360)%360;
 if(h<16||h>=344)return 4;
 if(h<49)return mx<145?14:d/mx<.48?15:5;
 if(h<70)return 6;if(h<160)return 7;if(h<185)return 8;if(h<205)return 9;
 if(h<258)return mx<125?11:10;if(h<310)return 12;return 13;
}
function describe(data,w,h,box){
 const [x,y,bw,bh]=box,parts=[Array(16).fill(0),Array(16).fill(0),Array(16).fill(0)],hist=new Float32Array(64);
 const luma=k=>(data[k]+2*data[k+1]+data[k+2])/4;
 for(let j=Math.max(1,Math.floor(y+bh*.22));j<Math.min(h-1,y+bh*.92);j+=2)
 for(let i=Math.max(1,Math.floor(x+bw*.24));i<Math.min(w-1,x+bw*.76);i+=2){
   const k=4*(j*w+i),r=data[k],g=data[k+1],b=data[k+2];
   parts[j<y+bh*.58?0:1][colorBin(r,g,b)]++;
   const gx=luma(k+4)-luma(k-4),gy=luma(k+w*4)-luma(k-w*4);
   parts[2][Math.min(15,Math.floor((Math.atan2(gy,gx)+Math.PI)*16/(2*Math.PI)))]+=Math.min(64,Math.hypot(gx,gy));
   hist[(r>>6)*16+(g>>6)*4+(b>>6)]++;
 }
 const norm=a=>{const n=a.reduce((s,v)=>s+v,0)||1;return Array.from(a,v=>v/n);};
 const dominant=a=>Math.max(...a)>0?palette[a.indexOf(Math.max(...a))]:'unknown';
 return {descriptor:parts.flatMap(norm),upper:dominant(parts[0]),lower:dominant(parts[1]),hist:Float32Array.from(norm(hist))};
}
