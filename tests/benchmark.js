/* Run from any directory with Node and ffmpeg installed. */
const {execFileSync}=require('node:child_process');
const path=require('node:path');
global.window=global;
require('../tracker.js');require('../assets/truth.js');
const bytes=execFileSync('ffmpeg',['-loglevel','error','-i',path.join(__dirname,'../assets/bay-04.mp4'),'-vf','scale=320:180','-f','rawvideo','-pix_fmt','rgba','-'],{maxBuffer:64*1024*1024});
const engine=new Argus.Tracker(320,180),ev=new Argus.Evaluator(),size=320*180*4;
for(let i=0;i<ARGUS_TRUTH.length;i++){
 const tracks=engine.frame(bytes.subarray(i*size,(i+1)*size),i/12,25);
 ev.add(tracks,ARGUS_TRUTH[i]);
}
console.log({matches:ev.matches,visible:ev.total,switches:ev.switches,recoveries:engine.recoveries});
if(ev.switches||ev.matches/ev.total<.88||engine.recoveries<2)process.exitCode=1;
