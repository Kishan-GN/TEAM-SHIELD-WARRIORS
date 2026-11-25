"""Service integration tests using temporary data and artificial appearance vectors."""
import http.client
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
import uuid
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from platform_server import Application, ThreadingHTTPServer

class Platform(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.start();self.cookie=''
        status,_=self.req('setup',{'name':'admin','password':'test-only-password','token':self.app.setup})
        self.assertEqual(status,200)
    def start(self):
        self.app=Application(self.temp.name);self.http=ThreadingHTTPServer(('127.0.0.1',0),self.app.handler())
        self.port=self.http.server_port;self.thread=threading.Thread(target=self.http.serve_forever,daemon=True);self.thread.start()
    def shutdown(self):
        self.http.shutdown();self.thread.join();self.http.server_close()
    def tearDown(self):self.shutdown();self.temp.cleanup()
    def req(self,route,data=None):
        c=http.client.HTTPConnection('127.0.0.1',self.port);hdr={'Origin':f'http://127.0.0.1:{self.port}','Cookie':self.cookie}
        c.request('GET' if data is None else 'POST','/api/'+route,None if data is None else json.dumps(data).encode(),hdr)
        r=c.getresponse();cookie=r.getheader('Set-Cookie')
        if cookie:self.cookie=cookie.split(';')[0]
        result=r.status,json.loads(r.read());c.close();return result
    def event(self,session=None,track=1,dim=0,minutes=0):
        vec=[0]*576;vec[dim]=1
        return dict(session=session or str(uuid.uuid4()),track=track,camera='Desk',at=time.time()+minutes*60,offset=0,upper='blue',lower='gray',score=.88,x=.3,y=.4,descriptor=([1]+[0]*15)*3,embedding=vec)
    def enroll(self):
        d=self.event();_,a=self.req('events',d);fields=dict(d,appearance=a['id'],image='data:image/jpeg;base64,/9j/2Q==',consent=True)
        self.assertEqual(self.req('enroll',dict(fields,consent=False))[0],400)
        status,r=self.req('enroll',fields);self.assertEqual(status,200);return r['id']
    def test_reentry_and_restart(self):
        person=self.enroll();self.shutdown();self.start();self.cookie=''
        self.assertEqual(self.req('state')[0],403)
        self.req('login',{'name':'admin','password':'test-only-password'})
        d=self.event(minutes=30);self.req('events',d);self.req('events',d)
        state=self.req('state')[1];self.assertEqual(len(state['persons']),1);self.assertEqual(len(state['events']),2)
        self.assertEqual(state['reviews'][0]['status'],'pending');self.assertIsNone(state['events'][0]['person'])
        self.req('verify',{'id':state['reviews'][0]['id'],'accept':True})
        self.assertEqual(self.req('state')[1]['events'][0]['person'],person)
    def test_distinct_people_similar_clothes(self):
        self.enroll();key=str(uuid.uuid4());self.req('events',self.event(key,1,2));self.req('events',self.event(key,2,3))
        state=self.req('state')[1];self.assertEqual(len(state['events']),3)
        self.assertEqual(len(state['reviews']),0)
    def test_access_deletion_and_encryption(self):
        person=self.enroll();admin=self.cookie
        with self.app.store.connect() as db:
            sealed=db.execute('SELECT profile FROM persons').fetchone()[0];self.assertNotIn(b'descriptor',sealed)
        self.req('user',dict(name='viewer',password='readonly-test-password',role='viewer'))
        self.req('logout',{});self.req('login',dict(name='viewer',password='readonly-test-password'))
        self.assertEqual(self.req('state')[0],200);self.assertEqual(self.req('delete-person',{'id':person})[0],403)
        self.req('logout',{});self.req('login',dict(name='admin',password='test-only-password'))
        self.req('delete-person',{'id':person});self.assertEqual(self.req('state')[1]['persons'],[])
    def test_retention_alerts_and_occupancy(self):
        self.req('events',self.event(minutes=-10*24*60))
        self.req('settings',dict(days=2));self.req('alert',dict(message='Desk disconnected'))
        self.req('occupancy',dict(camera='Desk',hour=int(time.time()/3600),bins=[2]+[0]*39))
        self.app.store.maintain();s=self.req('state')[1];self.assertFalse(s['events']);self.assertEqual(s['occupancy'][0]['samples'],2)
        self.assertTrue(any('disconnected' in x['action'] for x in s['audit']))
if __name__=='__main__':unittest.main(verbosity=2)
