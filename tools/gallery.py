"""Persistent, encrypted appearance gallery. Search vectors without decoding images."""
import functools
import math
import struct
import time

SCHEMA="""
CREATE TABLE IF NOT EXISTS gallery(
 id INTEGER PRIMARY KEY AUTOINCREMENT, person INTEGER REFERENCES persons ON DELETE CASCADE,
 appearance INTEGER UNIQUE REFERENCES appearances ON DELETE CASCADE, anchor INTEGER NOT NULL DEFAULT 0,
 at REAL NOT NULL,camera TEXT NOT NULL, photo BLOB NOT NULL, vector BLOB NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS gallery_anchor ON gallery(person) WHERE anchor=1;
CREATE INDEX IF NOT EXISTS gallery_person ON gallery(person);
CREATE TABLE IF NOT EXISTS entry_decisions(
 appearance INTEGER PRIMARY KEY REFERENCES appearances ON DELETE CASCADE,
 outcome TEXT, reference INTEGER REFERENCES gallery ON DELETE SET NULL, score REAL, searched INTEGER, elapsed REAL);
"""
PACK=struct.Struct('<624f')
def packed(hist,embedding):
    norm=math.sqrt(sum(x*x for x in embedding)) or 1
    return PACK.pack(*hist,*(x/norm for x in embedding))

class Gallery:
    def __init__(self,store):
        self.store=store
        self.decode=functools.lru_cache(maxsize=8192)(self._decode)
    def _decode(self,key,blob):
        return PACK.unpack(self.store.crypt(blob,True))
    def insert(self,db,person,appearance,anchor,d):
        return db.execute('INSERT INTO gallery(person,appearance,anchor,at,camera,photo,vector) VALUES(?,?,?,?,?,?,?)',
            (person,appearance,anchor,d.get('at',time.time()),d.get('camera','Enrollment'),self.store.crypt(d['image'].encode()),self.store.crypt(packed(d['descriptor'],d['embedding'])))).lastrowid
    def migrate(self,db):
        for row in db.execute('SELECT * FROM persons WHERE id NOT IN (SELECT person FROM gallery WHERE anchor=1 AND person IS NOT NULL)'):
            p=self.store.profile(row)
            if p.get('embedding'):self.insert(db,row['id'],None,1,dict(p,at=row['created']))
    def rank(self,db,desc,embedding):
        start=time.perf_counter();n=math.sqrt(sum(x*x for x in embedding)) or 1
        q=[v/n for v in embedding];best={};anchors={};count=0
        for row in db.execute("""SELECT g.id,g.person,g.anchor,g.vector FROM gallery g
                            LEFT JOIN entry_decisions d ON d.appearance=g.appearance
                            WHERE g.person IS NOT NULL AND (d.outcome IS NULL OR d.outcome!='First capture')"""):
            count+=1;v=self.decode(row['id'],row['vector'])
            cos=sum(a*b for a,b in zip(q,v[48:]));color=sum(min(a,b) for a,b in zip(desc,v[:48]))/3
            score=min(1,max(0,.70*cos+.30*color));pid=row['person']
            if row['anchor']:anchors[pid]=score
            if pid not in best or score>best[pid][0]:best[pid]=(score,row['id'])
        ranked=sorted(((sc,pid,ref,anchors.get(pid,0)) for pid,(sc,ref) in best.items()),reverse=True)
        return ranked,count,round(1000*(time.perf_counter()-start),1)
    def result(self,db,aid):
        r=db.execute('SELECT a.person,e.* FROM entry_decisions e JOIN appearances a ON a.id=e.appearance WHERE e.appearance=?',(aid,)).fetchone()
        if not r:return None
        ref=db.execute('SELECT id,person,camera,at FROM gallery WHERE id=?',(r['reference'],)).fetchone()
        now=db.execute('SELECT id FROM gallery WHERE appearance=?',(aid,)).fetchone()
        return dict(id=aid,person=r['person'],outcome=r['outcome'],similarity=r['score'],reference=dict(ref) if ref else None,capture=now[0] if now else None,searched=r['searched'],ms=r['elapsed'])
    def entry(self,db,d):
        from storage import validate,feature
        validate(d.get('participantConsent') is True,'Consent for entry photographs and matching is required')
        hist=feature(d['descriptor'],48);embedding=feature(d['embedding'],576)
        image=d.get('image','');validate(isinstance(image,str) and image.startswith('data:image/jpeg;base64,') and 23<len(image)<120000,'Invalid entry photograph')
        aid=self.store.appearance(db,d,review=False);existing=self.result(db,aid)
        if existing:return existing
        ranked,count,ms=self.rank(db,hist,embedding)
        busy=d.get('occupied',[]);validate(isinstance(busy,list) and len(busy)<=64,'Invalid active track list')
        used={r[0] for a in busy for r in db.execute('SELECT person FROM appearances WHERE id=? AND session=?',(int(a),d['session']))}
        score,pid,ref,anchor=ranked[0] if ranked else (None,None,None,None)
        margin=(score-ranked[1][0]) if len(ranked)>1 else 1
        prior=None
        if d.get('prior') is not None:
            prior=db.execute('SELECT person FROM appearances WHERE id=? AND session=? AND at<=? AND at>=?',(int(d['prior']),d['session'],d['at'],d['at']-30)).fetchone()
        continuity=bool(prior and prior[0]==pid and score is not None and score>=.87 and anchor>=.82 and margin>=.04)
        strong=score is not None and score>=.925 and anchor>=.84 and margin>=.055
        if (strong or continuity) and pid not in used:
            outcome='Recovered'
            db.execute('INSERT INTO reviews(appearance,person,score,status) VALUES(?,?,?,?)',(aid,pid,score,'automatic'))
        elif (score is None or score<.72) and not (prior and prior[0]):
            pid=self.store.enroll(db,dict(d,consent=True));outcome='First capture';ref=None
            self.insert(db,pid,None,1,d)
        else:
            outcome='Needs review';pid=None
            for sc,candidate,_,_ in ranked[:3]:
                if sc>=.72:db.execute('INSERT INTO reviews(appearance,person,score,status) VALUES(?,?,?,?)',(aid,candidate,sc,'pending'))
        db.execute('UPDATE appearances SET person=? WHERE id=?',(pid,aid))
        self.insert(db,pid,aid,0,d)
        db.execute('INSERT INTO entry_decisions VALUES(?,?,?,?,?,?)',(aid,outcome,ref,score,count,ms))
        return self.result(db,aid)
