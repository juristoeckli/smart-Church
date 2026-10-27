import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import routing_presets as presets

class PresetTests(unittest.TestCase):
 def setUp(self):
  temporary_directory=tempfile.TemporaryDirectory(prefix='smart-gfc-presets-')
  temporary=Path(temporary_directory.name)
  self.addCleanup(temporary_directory.cleanup)
  change=patch.object(presets,'ROOT',temporary/'routing-presets');change.start();self.addCleanup(change.stop)
  self.state={'connected':True,'model':'Test','inputs':['In A','In B'],'outputs':['Out A','Out B'],'routes':[1,0],'locks':['U','U']}
  self.preset=presets.snapshot('Sunday',self.state);self.device={'inputs':2,'outputs':2,'name':'Test'}
 def test_save_list_read_and_export_roundtrip(self):
  saved=presets.save('site','router',self.preset);self.assertEqual(len(list(presets.ROOT.glob('*.json'))),1)
  entry=presets.list_presets('site','router')[0];self.assertEqual(entry['name'],'Sunday')
  data,revision=presets.read('site','router',saved['id']);self.assertEqual(revision,entry['revision'])
  for fmt in ['json','bmd-text']:
   text=presets.export(data,fmt)['content'];restored=presets.import_file(text,'Imported',self.device)
   self.assertEqual(restored['routes'],[1,0]);self.assertEqual(restored['name'],'Imported')
 def test_scope_and_path_traversal(self):
  saved=presets.save('site','router',self.preset)
  with self.assertRaisesRegex(ValueError,'different'):presets.read('other','router',saved['id'])
  with self.assertRaises(ValueError):presets.read('site','router','../../config')
  self.assertEqual(presets.list_presets('other','router'),[])
 def test_replacement_is_never_allowed(self):
  saved=presets.save('site','router',self.preset);entry=saved['presets'][0]
  with self.assertRaisesRegex(ValueError,'Replacing'):
   presets.save('site','router',dict(self.preset,routes=[0,1]),saved['id'],entry['revision'])
  self.assertEqual(presets.read('site','router',saved['id'])[0]['routes'],[1,0])
 def test_configurable_global_limit_and_delete(self):
  saved=presets.save('site','router',self.preset,limit=2);entry=saved['presets'][0]
  presets.save('other','router',self.preset,limit=2)
  with self.assertRaisesRegex(ValueError,'limit reached'):
   presets.save('site','router',dict(self.preset,name='New'),limit=2)
  with self.assertRaisesRegex(ValueError,'Confirm'):
   presets.delete('site','router',saved['id'],entry['revision'],False,limit=2)
  with self.assertRaisesRegex(ValueError,'changed'):
   presets.delete('site','router',saved['id'],'stale',True,limit=2)
  data,_=presets.read('site','router',saved['id'])
  self.assertIn('saved_at_utc',data);self.assertGreater(data['saved_at'],0)
  result=presets.delete('site','router',saved['id'],entry['revision'],True,limit=2)
  self.assertEqual(result['stored_count'],1)
  result=presets.save('site','router',dict(self.preset,name='New'),limit=2)
  self.assertEqual(result['stored_count'],2);self.assertEqual(result['limit'],2)
 def test_duplicate_names_do_not_overwrite(self):
  saved=presets.save('site','router',self.preset)
  with self.assertRaisesRegex(ValueError,'already exists'):presets.save('site','router',self.preset)
  self.assertEqual(len(presets.list_presets('site','router')),1)
 def test_import_rejects_commands_duplicates_incomplete_and_wrong_size(self):
  for text in ['VIDEO OUTPUT ROUTING:\n0 1\nVIDEO OUTPUT LOCKS:\n0 F\n','VIDEO OUTPUT ROUTING:\n0 1\n0 0\n','VIDEO OUTPUT ROUTING:\n0 1\n','VIDEO OUTPUT ROUTING:\n0 99\n1 0\n']:
   with self.assertRaises(ValueError):presets.import_file(text,'Test',self.device)
  wrong=dict(self.preset,input_count=3,inputs=['A','B','C'])
  with self.assertRaisesRegex(ValueError,'dimensions'):presets.import_file(json.dumps(wrong),'Test',self.device)
 def test_preview_lists_changes_and_locks_without_editing_state(self):
  current=dict(self.state,routes=[0,1],locks=['U','L'])
  result=presets.preview(self.preset,current)
  self.assertEqual(len(result['changes']),2);self.assertTrue(result['changes'][1]['locked'])
  self.assertEqual(current['routes'],[0,1])
 def test_exports_do_not_include_controller_identity(self):
  text=presets.export(dict(self.preset,site='site',device='router'),'json')['content']
  self.assertNotIn('"site"',text);self.assertNotIn('"device"',text)

class ControllerPresetTests(unittest.TestCase):
 setUp=PresetTests.setUp
 def controller(self):
  import threading
  from controller import Controller
  c=Controller.__new__(Controller);c.lock=threading.Lock();c.command_locks={};c.videohub_states={}
  return c
 def config(self):
  return {'timeout_seconds':2,'sites':[{'id':'site','devices':[dict(self.device,id='router',ip='127.0.0.1',port=9990,type='videohub')]}]}
 @patch('controller.load_config')
 @patch('controller.videohub_request')
 def test_preview_is_read_only_and_recall_requires_confirmation(self,api,config):
  config.return_value=self.config();api.return_value=self.state
  saved=presets.save('site','router',self.preset);c=self.controller()
  request={'site':'site','device':'router','id':saved['id'],'operation':'preview'}
  preview=c.videohub_presets(request);self.assertEqual(preview['name'],'Sunday')
  self.assertEqual(api.call_args.kwargs,{})
  api.reset_mock()
  with self.assertRaisesRegex(ValueError,'Confirm'):c.videohub_presets(dict(request,operation='recall',revision=preview['revision']))
  api.assert_not_called()
 @patch('controller.load_config')
 @patch('controller.videohub_request')
 def test_recall_uses_reviewed_revision_and_routes(self,api,config):
  config.return_value=self.config();api.return_value=self.state
  saved=presets.save('site','router',self.preset);entry=saved['presets'][0];c=self.controller()
  request={'site':'site','device':'router','id':saved['id'],'operation':'recall','confirmed':True,'revision':entry['revision'],'expected_routes':[0,1],'actor':'operator'}
  from routing_history import RoutingHistory
  c.routing_history=RoutingHistory(presets.ROOT.parent)
  def verified(*args,**kwargs):
   kwargs['observe'](dict(self.state,routes=[0,1]))
   return self.state
  api.side_effect=verified
  result=c.videohub_presets(request);self.assertIn('verified',result['message'])
  self.assertEqual(api.call_args.kwargs['routes'],[1,0])
  self.assertEqual(api.call_args.kwargs['expected_routes'],[0,1])
  self.assertTrue(callable(api.call_args.kwargs['observe']))
  events=c.routing_history.read('site|router')['events']
  self.assertEqual([change['user'] for change in events[-1]['changes']],['operator','operator'])
  api.reset_mock()
  with self.assertRaisesRegex(ValueError,'changed'):c.videohub_presets(dict(request,revision='stale'))
  api.assert_not_called()

if __name__=='__main__':unittest.main()
