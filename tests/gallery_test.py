import base64,sys,tempfile,time,unittest,uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from storage import Store
class Returns(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.store=Store(self.temp.name);self.db=self.store.connect()
        self.data=dict(session=str(uuid.uuid4()),track=1,camera='A',at=time.time(),offset=0,upper='blue',lower='gray',score=.96,x=.5,y=.5,descriptor=([1]+[0]*15)*3,embedding=[1]+[0]*575,participantConsent=True,image='data:image/jpeg;base64,'+base64.b64encode(b'\xff\xd8\xff\xd9').decode())
    def tearDown(self):self.db.close();self.temp.cleanup()
    def submit(self,**changes):
        with self.db:return self.store.gallery.entry(self.db,dict(self.data,**changes))
    def test_return(self):
        a=self.submit();self.assertEqual(a['person'],1)
        self.assertEqual(self.submit(),a)
        b=self.submit(track=2,offset=40);self.assertEqual((b['person'],b['outcome'],b['searched']),(1,'Recovered',1))
        self.db.close();self.store=Store(self.temp.name);self.db=self.store.connect()
        c=self.submit(session=str(uuid.uuid4()),camera='B',at=time.time()+1800)
        self.assertEqual(c['person'],1);self.assertEqual(c['searched'],2);self.assertEqual(c['similarity'],1)
    def test_occupied_and_ambiguous(self):
        a=self.submit();b=self.submit(track=2,occupied=[a['id']]);self.assertIsNone(b['person']);self.assertEqual(b['outcome'],'Needs review')
        with self.db:
            pid=self.store.enroll(self.db,dict(self.data,consent=True));self.store.gallery.insert(self.db,pid,None,1,self.data)
        self.assertIsNone(self.submit(track=3)['person'])
    def test_new_and_consent(self):
        with self.assertRaises(ValueError):self.submit(participantConsent=False)
        self.submit();b=self.submit(track=2,embedding=[0,1]+[0]*574)
        self.assertEqual(b['person'],2)
    def test_gallery_scale(self):
        self.submit()
        with self.db:
            for _ in range(2999):self.store.gallery.insert(self.db,1,None,0,self.data)
        res=self.submit(track=2);self.assertEqual(res['searched'],3000);self.assertEqual(res['person'],1)
        print('3,000 stored reference vectors, cold search: %.1f ms'%res['ms'])
if __name__=='__main__':unittest.main(verbosity=2)
