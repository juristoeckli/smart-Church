import socket,threading,unittest
from videohub import request

PRELUDE=b'PROTOCOL PREAMBLE:\nVersion: 2.5\n\nVIDEOHUB DEVICE:\nDevice present: true\nModel name: Test\nVideo inputs: 2\nVideo outputs: 2\n\nINPUT LABELS:\n0 Input A\n1 Input B\n\nOUTPUT LABELS:\n0 Output A\n1 Output B\n\nVIDEO OUTPUT LOCKS:\n0 U\n1 U\n\nVIDEO OUTPUT ROUTING:\n0 0\n1 1\n\n'

class VideohubTests(unittest.TestCase):
 def run_server(self,route=False,locked=False,nak=False,conflict=False,many=False):
  server=socket.socket();server.bind(('127.0.0.1',0));server.listen();self.addCleanup(server.close);device={'ip':'127.0.0.1','port':server.getsockname()[1]};received=[]
  def worker():
   try:
    conn,_=server.accept()
    with conn:
     conn.settimeout(2);prelude=PRELUDE.replace(b'0 U',b'0 L') if locked else PRELUDE
     # Fragment CRLF responses, including a multi-word UTF-8 label.
     prelude=prelude.replace(b'Input A','Sänger Podium'.encode()).replace(b'\n',b'\r\n')
     for i in range(0,len(prelude),17):conn.sendall(prelude[i:i+17])
     if route and not locked and not conflict:
      command=conn.recv(1024);received.append(command)
      if nak:conn.sendall(b'NAK\n\n');return
      conn.sendall(b'VIDEO OUTPUT ROUTING:\n0 1\n\nACK\n\n')
      received.append(conn.recv(1024));conn.sendall(b'ACK\n\nVIDEO OUTPUT ROUTING:\n0 1\n1 0\n\n' if many else b'ACK\n\nVIDEO OUTPUT ROUTING:\n0 1\n1 1\n\n')
     else:
      data=conn.recv(1024)
      if data:received.append(data)
   except (OSError,TimeoutError):pass
  thread=threading.Thread(target=worker,daemon=True);thread.start();return device,received,thread
 def test_read_only_labels_and_routes(self):
  d,w,t=self.run_server();state=request(d);t.join(1);self.assertEqual(state['inputs'][0],'Sänger Podium');self.assertEqual(state['routes'],[0,1]);self.assertEqual(w,[])
 def test_route_verifies_echo_and_preserves_other_outputs(self):
  d,w,t=self.run_server(route=True);state=request(d,output=0,input_=1,expected=0);t.join(1);self.assertEqual(state['routes'],[1,1]);self.assertEqual(w,[b'VIDEO OUTPUT ROUTING:\n0 1\n\n',b'VIDEO OUTPUT ROUTING:\n\n'])
 def test_batch_recall_is_one_write_and_verifies_all_routes(self):
  d,w,t=self.run_server(route=True,many=True);state=request(d,routes=[1,0],expected_routes=[0,1]);t.join(1)
  self.assertEqual(state['routes'],[1,0]);self.assertEqual(w,[b'VIDEO OUTPUT ROUTING:\n0 1\n1 0\n\n',b'VIDEO OUTPUT ROUTING:\n\n'])
 def test_batch_recall_aborts_if_preview_is_stale(self):
  d,w,t=self.run_server(conflict=True)
  with self.assertRaisesRegex(ValueError,'elsewhere'):request(d,routes=[1,0],expected_routes=[1,1])
  t.join(1);self.assertEqual(w,[])
 def test_unchanged_locked_outputs_do_not_block_noop_recall(self):
  d,w,t=self.run_server(locked=True);state=request(d,routes=[0,1],expected_routes=[0,1]);t.join(1)
  self.assertEqual(state['routes'],[0,1]);self.assertEqual(w,[])
 def test_locked_output_is_not_modified(self):
  d,w,t=self.run_server(route=True,locked=True)
  with self.assertRaisesRegex(ValueError,'locked'):request(d,output=0,input_=1,expected=0)
  t.join(1);self.assertEqual(w,[])
 def test_external_route_change_is_not_overwritten(self):
  d,w,t=self.run_server(route=True,conflict=True)
  with self.assertRaisesRegex(ValueError,'elsewhere'):request(d,output=0,input_=1,expected=1)
  t.join(1);self.assertEqual(w,[])
 def test_nak_does_not_retry_write(self):
  d,w,t=self.run_server(route=True,nak=True)
  with self.assertRaisesRegex(ValueError,'not confirmed'):request(d,output=0,input_=1,expected=0)
  t.join(1);self.assertEqual(len(w),1)
 def test_invalid_indices_do_not_write(self):
  d,w,t=self.run_server()
  with self.assertRaisesRegex(ValueError,'outside'):request(d,output=4,input_=1,expected=0)
  t.join(1);self.assertEqual(w,[])

if __name__=='__main__':unittest.main()
