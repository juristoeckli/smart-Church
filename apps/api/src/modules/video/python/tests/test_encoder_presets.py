import unittest
from unittest.mock import patch

from encoder_settings import apply_preset, read_preset


class PresetTests(unittest.TestCase):
    def setUp(self):
        self.encoder = {'ip': '127.0.0.1'}
        self.values = {'platform': 'Site preset', 'server': 'Default', 'quality': 'High'}
        self.platform = {'key': 'saved-secret', 'customizableUrlEnabled': False,
                         'servers': [{'server': 'Default', 'url': 'rtmp://receiver/live'}],
                         'profiles': [{'profile': 'High', 'configs': []}]}
        self.target = dict(self.values, key='saved-secret')

    @patch('encoder_settings._preset_deletion_info', return_value={'allowed': False, 'reason': 'Built-in presets cannot be deleted'})
    @patch('encoder_settings.rest')
    def test_read_hides_credentials(self, api, deletion_info):
        self.platform['servers'][0]['url'] = 'srt://user:password@receiver:9000?secret=hidden#fragment'
        api.return_value = self.platform
        result = read_preset(self.encoder, self.values)
        self.assertEqual(result['servers'][0]['url'], 'srt://receiver:9000')
        self.assertTrue(result['has_key'])
        self.assertNotIn('saved-secret', str(result))
        self.assertNotIn('password', str(result))

    @patch('encoder_settings.rest')
    def test_apply_uses_saved_preset_and_does_not_start_stream(self, api):
        api.side_effect = [self.platform, {'key': 'old-secret'}, {'status': 'Idle'}, None, self.target]
        result = apply_preset(self.encoder, self.values)
        self.assertIn('verified', result['message'])
        writes = [call for call in api.call_args_list if len(call.args) > 2]
        self.assertEqual(len(writes), 1)
        self.assertEqual(writes[0].args[1:4], ('/livestreams/0/activePlatform', 'PUT', self.target))

    @patch('encoder_settings.rest')
    def test_streaming_encoder_cannot_apply_preset(self, api):
        api.side_effect = [self.platform, {}, {'status': 'Streaming'}]
        with self.assertRaisesRegex(ValueError, 'Stop the stream'):
            apply_preset(self.encoder, self.values)
        self.assertTrue(all(len(call.args) < 3 for call in api.call_args_list))

    @patch('encoder_settings.rest')
    def test_unknown_quality_does_not_write(self, api):
        api.return_value = self.platform
        with self.assertRaisesRegex(ValueError, 'supported by this preset'):
            apply_preset(self.encoder, dict(self.values, quality='Unsupported'))
        self.assertEqual(api.call_count, 1)

    @patch('encoder_settings.rest')
    def test_missing_saved_key_preserves_current_key(self, api):
        self.platform.pop('key')
        target = dict(self.values, key='current-secret')
        api.side_effect = [self.platform, {'key': 'current-secret'}, {'status': 'Idle'}, None, target]
        self.assertIn('verified', apply_preset(self.encoder, self.values)['message'])
        self.assertEqual(api.call_args_list[3].args[3]['key'], 'current-secret')

    @patch('encoder_settings.time.sleep')
    @patch('encoder_settings.rest')
    def test_unconfirmed_write_is_not_retried_or_undone(self, api, sleep):
        api.side_effect = [self.platform, {}, {'status': 'Idle'}, None,
                           ValueError('unavailable'), ValueError('unavailable'), ValueError('unavailable')]
        self.assertEqual(apply_preset(self.encoder, self.values)['verification'], 'unconfirmed')
        self.assertEqual(sum(len(call.args) > 2 for call in api.call_args_list), 1)
