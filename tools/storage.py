"""Local data store. User records and media live outside the application directory."""
from gallery import Gallery, SCHEMA as GALLERY_SCHEMA
import base64
import ctypes
import hashlib
import hmac
import json
import math
import os
from pathlib import Path
import secrets
import sqlite3
import time
import uuid

SCHEMA = """
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users(name TEXT PRIMARY KEY, salt BLOB NOT NULL, digest BLOB NOT NULL, role TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS persons(id INTEGER PRIMARY KEY AUTOINCREMENT, created REAL NOT NULL, profile BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS cameras(name TEXT PRIMARY KEY, config TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS recordings(id TEXT PRIMARY KEY, session TEXT UNIQUE, camera TEXT, name TEXT, start REAL, duration REAL, mime TEXT, bytes INTEGER);
CREATE TABLE IF NOT EXISTS appearances(id INTEGER PRIMARY KEY, session TEXT, track INTEGER, camera TEXT, at REAL, offset REAL, upper TEXT, lower TEXT, score REAL, x REAL,y REAL, person INTEGER REFERENCES persons ON DELETE SET NULL, UNIQUE(session,track));
CREATE INDEX IF NOT EXISTS by_person ON appearances(person, at);
CREATE INDEX IF NOT EXISTS by_camera ON appearances(camera, at);
CREATE TABLE IF NOT EXISTS reviews(id INTEGER PRIMARY KEY, appearance INTEGER REFERENCES appearances ON DELETE CASCADE,person INTEGER REFERENCES persons ON DELETE CASCADE,score REAL,status TEXT, UNIQUE(appearance,person));
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,at REAL,user TEXT,action TEXT);
CREATE TABLE IF NOT EXISTS occupancy(camera TEXT, hour INTEGER, cell INTEGER, samples INTEGER DEFAULT 0, PRIMARY KEY(camera,hour,cell));
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);
"""
def validate(ok,message):
    if not ok: raise ValueError(message)

def numeric(v,lo,hi):
    v=float(v);validate(math.isfinite(v) and lo<=v<=hi,'Numeric value out of range');return v

def feature(v,n):
    validate(isinstance(v,list) and len(v)==n,'Feature dimensions differ')
    return [numeric(x,-2,2) for x in v]

def appearance_score(profile,desc,embedding):
    # Histograms cover two clothing regions and texture. Learned channels use cosine.
    appearance=sum(min(a,b) for a,b in zip(profile['descriptor'],desc))/3
    ref=profile.get('embedding')
    if not ref or not embedding:return None
    dot=sum(a*b for a,b in zip(ref,embedding))
    scale=math.sqrt(sum(v*v for v in ref)*sum(v*v for v in embedding))
    similarity=dot/scale if scale else 0
    if similarity<.76:return None
    return max(0,min(1,.7*similarity+.3*appearance))

def digest(password,salt):
    return hashlib.pbkdf2_hmac('sha256',password.encode(),salt,300000)

def dpapi(data,decrypt):
    from ctypes import wintypes as wt
    class Blob(ctypes.Structure):
        _fields_=[('size',wt.DWORD),('ptr',ctypes.c_void_p)]
    buf=ctypes.create_string_buffer(data);src=Blob(len(data),ctypes.addressof(buf));dst=Blob()
    fn=ctypes.windll.crypt32.CryptUnprotectData if decrypt else ctypes.windll.crypt32.CryptProtectData
    if not fn(ctypes.byref(src),None,None,None,None,1,ctypes.byref(dst)):raise OSError('Windows data protection failed')
    try:return ctypes.string_at(dst.ptr,dst.size)
    finally:ctypes.windll.kernel32.LocalFree(ctypes.c_void_p(dst.ptr))

class Store:
    def __init__(self,root):
        self.root=Path(root);self.root.mkdir(exist_ok=True,parents=True,mode=0o700)
        self.media=self.root/'media';self.media.mkdir(exist_ok=True,mode=0o700)
        self.db=self.root/'studio.sqlite3'
        if os.name!='nt':
            from cryptography.hazmat.primitives.ciphers.aead import AESGCM
            key=self.root/'vault.key'
            if not key.exists():
                with key.open('xb') as f:os.chmod(key,0o600);f.write(secrets.token_bytes(32))
            self.cipher=AESGCM(key.read_bytes())
        self.gallery=Gallery(self)
        with self.connect() as db:
            db.executescript(SCHEMA+GALLERY_SCHEMA);self.gallery.migrate(db)
    def connect(self):
        db=sqlite3.connect(self.db,timeout=15);db.row_factory=sqlite3.Row;db.execute('PRAGMA foreign_keys=ON');return db
    def crypt(self,data,decrypt=False):
        if os.name=='nt':return dpapi(data,decrypt)
        if decrypt:return self.cipher.decrypt(data[:12],data[12:],None)
        nonce=secrets.token_bytes(12);return nonce+self.cipher.encrypt(nonce,data,None)
    def profile(self,row):return json.loads(self.crypt(row['profile'],True))
    def seal(self,d):return self.crypt(json.dumps(d,separators=(',',':')).encode())
    def log(self,db,user,action):db.execute('INSERT INTO audit(at,user,action) VALUES(?,?,?)',(time.time(),user,action[:280]))
    def user(self,db,name,password,role):
        validate(1<=len(name)<=48 and 10<=len(password)<=256 and role in ('admin','viewer'),'Use a name and a password of at least ten characters')
        salt=secrets.token_bytes(16);db.execute('INSERT INTO users VALUES(?,?,?,?)',(name,salt,digest(password,salt),role))
    def enroll(self,db,d):
        validate(d.get('consent') is True,'Explicit participant consent is required')
        desc=feature(d['descriptor'],48)
        image=d.get('image','');validate(isinstance(image,str) and image.startswith('data:image/jpeg;base64,') and len(image)<120000,'Invalid reference crop')
        profile={'embedding':feature(d['embedding'],576),'descriptor':desc,'image':image,'upper':str(d['upper'])[:30],'lower':str(d['lower'])[:30],'consent':True,'accessories':[s for s in d.get('accessories',[]) if s in ('backpack','handbag','tie')]}
        if d.get('face') is not None:
            validate(d.get('faceConsent') is True,'Separate face consent required');profile['face']=feature(d['face'],128)
        return db.execute('INSERT INTO persons(created,profile) VALUES(?,?)',(time.time(),self.seal(profile))).lastrowid
    def appearance(self,db,d,review=True):
        session=str(uuid.UUID(d['session']));track=int(numeric(d['track'],1,999999))
        desc=feature(d['descriptor'],48);embedding=feature(d['embedding'],576)
        cursor=db.execute('INSERT OR IGNORE INTO appearances(session,track,camera,at,offset,upper,lower,score,x,y) VALUES(?,?,?,?,?,?,?,?,?,?)',
            (session,track,str(d['camera'])[:80],numeric(d['at'],0,1e11),numeric(d['offset'],0,1e8),str(d['upper'])[:30],str(d['lower'])[:30],numeric(d['score'],0,1),numeric(d['x'],0,1),numeric(d['y'],0,1)))
        row=db.execute('SELECT id FROM appearances WHERE session=? AND track=?',(session,track)).fetchone()
        if cursor.rowcount and review:
            for person in db.execute('SELECT * FROM persons'):
                similarity=appearance_score(self.profile(person),desc,embedding)
                if similarity is not None and similarity>=.80:db.execute('INSERT INTO reviews(appearance,person,score,status) VALUES(?,?,?,?)',(row['id'],person['id'],min(1,similarity),'pending'))
        return row['id']
    def verify(self,db,appearance,person):
        db.execute('UPDATE gallery SET person=? WHERE appearance=?',(person,appearance))
        db.execute("UPDATE entry_decisions SET outcome=\'Verified\' WHERE appearance=?",(appearance,))
        db.execute("UPDATE appearances SET person=? WHERE id=?",(person,appearance))
        db.execute("UPDATE reviews SET status=CASE WHEN person=? THEN 'verified' ELSE 'rejected' END WHERE appearance=?",(person,appearance))
    def snapshot(self,db,role):
        def rows(q):return [dict(r) for r in db.execute(q)]
        persons=[]
        for r in db.execute('SELECT * FROM persons ORDER BY id DESC'):
            p=self.profile(r)
            persons.append({'id':r['id'],'created':r['created'],'upper':p['upper'],'lower':p['lower'],'accessories':p.get('accessories',[]),'face':bool(p.get('face')),'image':p['image']})
        return dict(occupancy=rows('SELECT * FROM occupancy'),persons=persons,events=rows('SELECT * FROM appearances ORDER BY at DESC'),reviews=rows('SELECT * FROM reviews ORDER BY id DESC'),recordings=rows('SELECT * FROM recordings ORDER BY start DESC'),cameras=rows('SELECT * FROM cameras ORDER BY name'),audit=rows('SELECT * FROM audit ORDER BY id DESC LIMIT 500') if role=='admin' else [],settings={r['key']:r['value'] for r in db.execute('SELECT * FROM settings')})
    def delete_clip(self,db,rid):
        db.execute('DELETE FROM recordings WHERE id=?',(rid,))
    def maintain(self):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE');row=db.execute("SELECT value FROM settings WHERE key='days'").fetchone()
            cutoff=time.time()-86400*int(row[0] if row else 7)
            db.execute('DELETE FROM recordings WHERE start<?',(cutoff,))
            db.execute('DELETE FROM appearances WHERE at<?',(cutoff,))
            db.execute('DELETE FROM audit WHERE at<?',(cutoff,))
            db.execute('DELETE FROM occupancy WHERE hour<?',(int(cutoff//3600),))
            keep={r[0] for r in db.execute('SELECT id FROM recordings')}
            for p in self.media.glob('*.bin'):
                if p.stem not in keep:p.unlink(missing_ok=True)
