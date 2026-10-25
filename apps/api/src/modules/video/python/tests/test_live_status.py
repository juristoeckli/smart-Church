import threading,unittest
from unittest.mock import patch
from controller import Controller
class LiveStateTests(unittest.TestCase):
 @patch('controller.encoder_request',return_value={'Status':'Streaming'})
 def test_publish_is_immediate_and_only_updates_target(self,request):
  c=Controller.__new__(Controller);c.lock=threading.Lock();c.command_locks={};c.config={'timeout_seconds':2};c.live_encoder_states={}
  e={'id':'one','ip':'127.0.0.1','port':9977};other={'id':'two','ip':'127.0.0.2','port':9977,'state':{'Status':'Idle'}}
  c.snapshot={'sites':[{'id':'site','encoders':[dict(e,state={'Status':'Idle'},error='old'),other]}]}
  c.publish_encoder_state('site',e)
  self.assertEqual(c.snapshot['sites'][0]['encoders'][0]['state']['Status'],'Streaming')
  self.assertNotIn('error',c.snapshot['sites'][0]['encoders'][0])
  self.assertEqual(other['state']['Status'],'Idle')
if __name__ == '__main__':
 unittest.main()
