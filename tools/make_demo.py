"""Rebuild the deterministic, annotated test clip. Requires Pillow and ffmpeg."""
from pathlib import Path
import json, math, random, subprocess
from PIL import Image, ImageDraw
ROOT=Path(__file__).resolve().parent.parent
W,H,FPS=640,360,12
rng=random.Random(17)
bg=Image.new('RGB',(W+64,H),'#26343c')
d=ImageDraw.Draw(bg)
for y in range(H):
    d.line((0,y,W+64,y),fill=(30+y//30,42+y//24,49+y//25))
for y in range(0,H,36):
    for x in range(-45+(y//36%2)*45,W+64,90):
        d.rectangle((x,y,x+88,y+34),outline='#34444a')
for _ in range(5000):
    x,y=rng.randrange(W+64),rng.randrange(H)
    d.point((x,y),fill=rng.choice(['#405257','#2d3d41','#38494b']))
for y in [69,271]:
    d.line((0,y,W+64,y), fill='#929075',width=2)
    for x in range(0,W+64,43):
        d.rectangle((x,y+6,x+22,y+7),fill='#636c65')
for x,y,t in [(44,25,'BAY   /   04'),(458,312,'LOADING   ZONE')]:
    d.text((x,y),t,fill='#83918e',font_size=18)
def crate(draw,x,y,color,band):
    draw.rectangle((x,y,x+42,y+34),fill=color,outline='#202b2e',width=2)
    draw.rectangle((x+6,y+4,x+11,y+30),fill=band)
    draw.rectangle((x+29,y+4,x+34,y+30),fill=band)
    draw.line((x+13,y+17,x+28,y+17),fill='#514d41',width=2)
def pillar(draw):
    draw.rectangle((293,86,371,259),fill='#26353c',outline='#6a7c80',width=2)
    for y in range(92,249,13):
        draw.line((301,y,363,y),fill='#45555c',width=3)
    draw.rectangle((294,82,370,92),fill='#9c9871')
    draw.text((308,157),'P 04',font_size=17,fill='#a9b6ac')
args=['ffmpeg','-y','-loglevel','error','-f','rawvideo','-pixel_format','rgb24','-video_size','640x360','-framerate','12','-i','-','-c:v','libx264','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',str(ROOT/'assets/bay-04.mp4')]
proc=subprocess.Popen(args,stdin=subprocess.PIPE)
truth=[]
for i in range(168):
    shift=round(12+9*math.sin(i/37)+i/10)
    scene=bg.copy()
    d=ImageDraw.Draw(scene)
    row=[]
    if i>=8:
        t=i-8
        for label,x,y,color,band in [('A',round(47+t*3.4),123,'#c39153','#f5d5a4'),('B',round(604-t*3.4),181,'#a78b59','#728e97')]:
            # Slow appearance change in the second half.
            if label=='A' and t>84: color='#b08049'
            crate(d,x,y,color,band)
            cover=max(0,min(x+43,372)-max(x,293))
            row.append(dict(label=label,box=[x-shift,y,43,35],visible=round(1-cover/43,2)))
    pillar(d)
    proc.stdin.write(scene.crop((shift,0,shift+W,H)).tobytes())
    truth.append(row)
proc.stdin.close()
if proc.wait(): raise SystemExit('ffmpeg failed')
(ROOT/'assets/truth.js').write_text('window.ARGUS_TRUTH='+json.dumps(truth,separators=(',',':'))+';')
# Embed the VP8 edition for browsers that disable file-to-canvas access or H.264.
import base64
# Seekable WebM requires duration metadata from a regular output file.
import tempfile
with tempfile.TemporaryDirectory() as temp:
    path=Path(temp)/'demo.webm'
    subprocess.run(['ffmpeg','-loglevel','error','-i',str(ROOT/'assets/bay-04.mp4'),'-c:v','libvpx','-crf','4','-b:v','2M',str(path)],check=True)
    webm=path.read_bytes()
(ROOT/'assets/demo.js').write_text("window.ARGUS_DEMO='data:video/webm;base64,"+base64.b64encode(webm).decode()+"';")
