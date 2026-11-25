"""Loopback-only ARGUS-X analytics service, Python 3.9+."""
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import urlparse,parse_qs
from contextlib import closing
import hmac,json,mimetypes,os,secrets,shutil,sqlite3,sys,threading,time,uuid,webbrowser
from host_metrics import metrics
from storage import appearance_score, Store,validate,numeric,feature,digest
ROOT=Path(__file__).resolve().parents[1]
class Denied(Exception):pass
class Application:
    def __init__(self,root):
        self.store=Store(root);self.setup=secrets.token_urlsafe(32);self.sessions={};self.failures=[];self.lock=threading.Lock()
    def handler(self):
        app=self;store=self.store
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def reply(self,status,data=b'',mime='application/json',headers=None):
                if not isinstance(data,bytes):data=json.dumps(data,separators=(',',':')).encode()
                self.send_response(status);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(data)))
                self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.send_header('X-Frame-Options','SAMEORIGIN' if urlparse(self.path).path=='/console/face-frame.html' else 'DENY')
                self.send_header('Referrer-Policy','no-referrer')
                for k,v in (headers or {}).items():self.send_header(k,v)
                self.end_headers();self.wfile.write(data)
            def body(self,limit):
                n=int(self.headers.get('Content-Length',0));validate(0<n<=limit,'Request exceeds size limit');return self.rfile.read(n)
            def auth(self):
                cookie=SimpleCookie();cookie.load(self.headers.get('Cookie',''))
                token=cookie['argus'].value if 'argus' in cookie else ''
                user=app.sessions.get(token)
                if not user or user[2]<time.time():raise Denied('Sign in required')
                return token,user[0],user[1]
            def dispatch(self):
                port=self.server.server_port
                if self.headers.get('Host') not in (f'127.0.0.1:{port}',f'localhost:{port}'):raise Denied('Loopback host required')
                parsed=urlparse(self.path);path=parsed.path
                if self.command=='POST' and self.headers.get('Origin') not in (f'http://127.0.0.1:{port}',f'http://localhost:{port}'):raise Denied('Invalid origin')
                if not path.startswith('/api/'):
                    if self.command!='GET':raise ValueError('Unknown route')
                    p=(ROOT/(path.lstrip('/') or 'console/index.html')).resolve()
                    if ROOT not in p.parents or not p.is_file() or p.suffix.lower() not in ('.js','.html','.css','.jpg','.mp4','.json','.wasm') and not (p.parent==ROOT/'console'/'face' and '-shard' in p.name):
                        return self.reply(404,{'error':'File unavailable'})
                    return self.reply(200,p.read_bytes(),mimetypes.guess_type(str(p))[0] or 'application/octet-stream')
                with closing(store.connect()) as db,db:
                    if path=='/api/status' and self.command=='GET':
                        try:_,name,role=self.auth()
                        except Denied:name=role=None
                        return self.reply(200,dict(initial=not db.execute('SELECT 1 FROM users LIMIT 1').fetchone(),name=name,role=role))
                    if self.command=='POST' and path in ('/api/login','/api/setup'):
                        d=json.loads(self.body(2048));name=d['name'].strip();password=d['password']
                        with app.lock:
                            now=time.time();app.failures=[x for x in app.failures if x>now-60]
                            if len(app.failures)>=10:raise Denied('Too many attempts. Try in one minute.')
                            if path.endswith('setup'):
                                validate(not db.execute('SELECT 1 FROM users').fetchone() and hmac.compare_digest(d.get('token',''),app.setup),'Open the setup link printed by the launcher')
                                store.user(db,name,password,'admin');db.commit()
                            row=db.execute('SELECT * FROM users WHERE name=?',(name,)).fetchone()
                            if not row or not hmac.compare_digest(digest(password,row['salt']),row['digest']):
                                app.failures.append(now);raise Denied('Sign-in failed')
                            token=secrets.token_urlsafe(32);app.sessions[token]=(name,row['role'],now+8*3600);store.log(db,name,'Signed in')
                        db.commit();return self.reply(200,{'role':row['role']},headers={'Set-Cookie':f'argus={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800'})
                    token,name,role=self.auth()
                    if self.command=='GET':
                        if path=='/api/state':return self.reply(200,store.snapshot(db,role))
                        if path=='/api/health':
                            usage=shutil.disk_usage(store.root);cpu,memory,load=metrics()
                            return self.reply(200,dict(database='Connected',storage=sum(p.stat().st_size for p in store.media.glob('*.bin')),diskFree=usage.free,diskTotal=usage.total,memoryUsedPct=memory,cpuUsed=cpu,load1m=load))
                        if path.startswith('/api/photo/'):
                            import base64
                            row=db.execute('SELECT photo FROM gallery WHERE id=?',(int(path.split('/')[-1]),)).fetchone()
                            if not row:return self.reply(404,{'error':'Photo deleted or expired'})
                            photo=store.crypt(row['photo'],True).split(b',',1)[1]
                            return self.reply(200,base64.b64decode(photo),'image/jpeg')
                        if path.startswith('/api/media/'):
                            rid=str(uuid.UUID(path.split('/')[-1]));row=db.execute('SELECT * FROM recordings WHERE id=?',(rid,)).fetchone()
                            if not row:return self.reply(404,{'error':'Recording expired or deleted'})
                            data=store.crypt((store.media/(rid+'.bin')).read_bytes(),True);return self.reply(200,data,row['mime'])
                        return self.reply(404,{'error':'Unknown API'})
                    if path=='/api/logout':
                        app.sessions.pop(token,None);return self.reply(200,{},headers={'Set-Cookie':'argus=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict'})
                    if role!='admin':raise Denied('Administrator access required')
                    db.execute('BEGIN IMMEDIATE')
                    if path=='/api/media':
                        q={k:v[0] for k,v in parse_qs(parsed.query).items()};session=str(uuid.UUID(q['session']));data=self.body(32*1024*1024)
                        webm=data.startswith(bytes.fromhex('1a45dfa3'));mp4=data[4:8]==b'ftyp';validate(webm or mp4,'Use WebM or MP4')
                        rid=str(uuid.uuid4());mime='video/webm' if webm else 'video/mp4'
                        db.execute('INSERT INTO recordings VALUES(?,?,?,?,?,?,?,?)',(rid,session,q['camera'][:80],q['name'][:140],numeric(q['start'],0,1e11),numeric(q['duration'],0,1e8),mime,len(data)))
                        (store.media/(rid+'.bin')).write_bytes(store.crypt(data));store.log(db,name,'Stored recording');db.commit();return self.reply(201,{'id':rid})
                    d=json.loads(self.body(350000));result={}
                    if path=='/api/events':result={'id':store.appearance(db,d)}
                    elif path=='/api/entry':
                        result=store.gallery.entry(db,d)
                        store.log(db,name,'Consented entry · '+result['outcome']+' · '+d['camera'])
                    elif path=='/api/occupancy':
                        camera=str(d['camera'])[:80];hour=int(numeric(d['hour'],0,1e8));bins=d['bins'];validate(len(bins)==40,'Grid size mismatch')
                        pairs=[(camera,hour,i,int(numeric(n,0,100))) for i,n in enumerate(bins) if n]
                        db.executemany('INSERT INTO occupancy VALUES(?,?,?,?) ON CONFLICT(camera,hour,cell) DO UPDATE SET samples=samples+excluded.samples',pairs)
                    elif path=='/api/search-image':
                        validate(d.get('consent') is True,'Authorized reference required');desc=feature(d['descriptor'],48);result={'candidates':[]}
                        for row in db.execute('SELECT * FROM persons'):
                            score=appearance_score(store.profile(row),desc,feature(d['embedding'],576))
                            if score is not None and score>=.80:result['candidates'].append({'person':row['id'],'score':score})
                        result['candidates'].sort(key=lambda p:p['score'],reverse=True);store.log(db,name,'Searched authorized reference image')
                    elif path=='/api/enroll':
                        aid=int(d['appearance']);row=db.execute('SELECT person FROM appearances WHERE id=?',(aid,)).fetchone();validate(row and row[0] is None,'Appearance already linked or expired')
                        pid=store.enroll(db,d);store.gallery.insert(db,pid,None,1,d);store.verify(db,aid,pid);store.log(db,name,f'Enrollment consent recorded · PERSON-{pid:03}');result={'id':pid}
                    elif path=='/api/verify':
                        row=db.execute("SELECT * FROM reviews WHERE id=? AND status='pending'",(int(d['id']),)).fetchone();validate(row,'Candidate no longer pending')
                        if d['accept']:store.verify(db,row['appearance'],row['person'])
                        else:db.execute("UPDATE reviews SET status='rejected' WHERE id=?",(row['id'],))
                        store.log(db,name,'Reviewed candidate '+str(row['id']))
                    elif path=='/api/undo-auto':
                        aid=int(d['appearance'])
                        row=db.execute("SELECT person FROM reviews WHERE appearance=? AND status='automatic'",(aid,)).fetchone()
                        validate(row,'This link is no longer automatic')
                        db.execute("UPDATE reviews SET status='rejected' WHERE appearance=? AND status='automatic'",(aid,))
                        db.execute('UPDATE appearances SET person=NULL WHERE id=?',(aid,))
                        db.execute('UPDATE gallery SET person=NULL WHERE appearance=?',(aid,))
                        db.execute("UPDATE entry_decisions SET outcome='Rejected' WHERE appearance=?",(aid,))
                        store.gallery.decode.cache_clear();store.log(db,name,'Rejected automatic match for appearance '+str(aid))
                    elif path=='/api/face-check':
                        validate(d.get('consent') is True,'Participant confirmation required')
                        row=db.execute('SELECT * FROM persons WHERE id=?',(int(d['person']),)).fetchone();validate(row,'Profile unavailable')
                        ref=store.profile(row).get('face');validate(ref,'Face comparison was not enrolled')
                        probe=feature(d['face'],128);dist=sum((x-y)**2 for x,y in zip(probe,ref))**.5
                        result={'distance':dist,'consistent':dist<.48};store.log(db,name,'Consented one-to-one face comparison')
                    elif path=='/api/delete-person':
                        pid=int(d['id']);db.execute('DELETE FROM persons WHERE id=?',(pid,));store.gallery.decode.cache_clear();store.log(db,name,'Deleted enrolled profile and associated verification data')
                    elif path=='/api/delete-recording':
                        rid=str(uuid.UUID(d['id']));row=db.execute('SELECT session FROM recordings WHERE id=?',(rid,)).fetchone()
                        if row:db.execute('DELETE FROM appearances WHERE session=?',(row[0],))
                        store.delete_clip(db,rid);store.log(db,name,'Deleted recording and its indexed appearances');db.commit();(store.media/(rid+'.bin')).unlink(missing_ok=True)
                    elif path=='/api/camera':
                        label=d['name'].strip()[:80];validate(label,'Enter a camera name')
                        zone=[numeric(x,0,1) for x in d['zone']];validate(len(zone)==4 and zone[0]<zone[2] and zone[1]<zone[3],'Invalid zone rectangle')
                        config={'zone':zone,'alert':bool(d['alert']),'limit':int(numeric(d['limit'],1,50)),'watch':int(numeric(d.get('watch',0),0,999999))}
                        db.execute('INSERT OR REPLACE INTO cameras VALUES(?,?)',(label,json.dumps(config)));store.log(db,name,'Updated camera '+label)
                    elif path=='/api/settings':
                        days=int(numeric(d['days'],1,90));db.execute("INSERT OR REPLACE INTO settings VALUES('days',?)",(str(days),));store.log(db,name,'Updated retention')
                    elif path=='/api/user':store.user(db,d['name'],d['password'],d['role']);store.log(db,name,'Created local account')
                    elif path=='/api/alert':store.log(db,name,'Alert · '+str(d['message'])[:160])
                    else:return self.reply(404,{'error':'Unknown operation'})
                    db.commit();self.reply(200,result)
            def handle_request(self):
                try:self.dispatch()
                except Denied as e:self.reply(403,{'error':str(e)})
                except (ValueError,KeyError,TypeError,IndexError,sqlite3.IntegrityError) as e:self.reply(400,{'error':str(e)})
                except (ConnectionError,BrokenPipeError):pass
                except Exception:
                    import traceback;traceback.print_exc();self.reply(500,{'error':'Local service failed. See the launcher console.'})
            do_GET=do_POST=handle_request
        return Handler

def main():
    root=Path(os.environ.get('ARGUS_DATA_DIR',Path.home()/'.argus-x-studio'));app=Application(root);app.store.maintain();metrics()
    server=ThreadingHTTPServer(('127.0.0.1',0),app.handler())
    url=f'http://127.0.0.1:{server.server_port}/console/index.html#setup={app.setup}'
    print('Open this private local link in Chrome or Edge:',url,flush=True)
    if '--no-browser' not in sys.argv:webbrowser.open(url)
    def maintenance():
        while True:
            time.sleep(300);app.store.maintain()
    threading.Thread(target=maintenance,daemon=True).start()
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()
if __name__=='__main__':main()
