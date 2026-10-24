import unittest
from unittest.mock import patch
from encoder_settings import apply_settings, read_settings


class SettingsTests(unittest.TestCase):
    def setUp(self):
        self.encoder = {'ip': '127.0.0.1'}
        self.values = {'protocol': 'srt', 'url': 'srt://10.0.0.1:1935', 'quality': 'High', 'key': ''}
        self.profile = {'profile': 'High', 'configs': [{'resolution': '1080p', 'fps': '60', 'bitrate': 9000000}]}
        self.active = {'platform': 'Original', 'server': 'Primary', 'key': 'secret', 'passphrase': 'phrase'}
        self.platform = {'customizableUrlEnabled': True, 'profiles': [self.profile]}
        self.target = dict(self.active, server='Custom', quality='High', url=self.values['url'])

    @patch('encoder_settings.rest')
    def test_read_settings_returns_server_name_without_credentials(self, api):
        active = {'platform': 'Original', 'server': 'Primary', 'quality': 'High', 'key': 'stream-secret',
                  'url': 'srt://user:password@receiver:9000/live?token=hidden', 'passphrase': 'hidden-passphrase'}
        platform = {'customizableUrlEnabled': True, 'profiles': [self.profile], 'servers': [], 'key': 'platform-secret'}
        api.side_effect = [active, platform, {'status': 'Idle'}, ['Original']]
        result = read_settings(self.encoder)
        self.assertEqual(result['server'], 'Primary')
        self.assertEqual(result['url'], 'srt://receiver:9000/live')
        self.assertNotIn('stream-secret', str(result))
        self.assertNotIn('password', str(result))
        self.assertNotIn('hidden-passphrase', str(result))

    @patch('encoder_settings.rest')
    def test_live_stream_cannot_be_edited(self, api):
        api.side_effect = [self.active, self.platform, {'status': 'Streaming'}]
        with self.assertRaisesRegex(ValueError, 'Stop the stream'):
            apply_settings(self.encoder, self.values)
        self.assertTrue(all(len(c.args) < 3 for c in api.call_args_list))

    @patch('encoder_settings.rest')
    def test_apply_preserves_preset_and_key_without_upload(self, api):
        api.side_effect = [self.active, self.platform, {'status': 'Idle'}, None, self.target]
        self.assertIn('saved and verified', apply_settings(self.encoder, self.values)['message'])
        writes = [c for c in api.call_args_list if len(c.args) > 2]
        self.assertEqual(len(writes), 1)
        self.assertEqual(writes[0].args[1], '/livestreams/0/activePlatform')
        self.assertEqual(writes[0].args[3], self.target)

    @patch('encoder_settings.rest')
    def test_fixed_preset_url_is_not_silently_replaced(self, api):
        platform = dict(self.platform, customizableUrlEnabled=False, servers=[{'server': 'Primary', 'url': 'srt://fixed:1935'}])
        api.side_effect = [self.active, platform]
        with self.assertRaisesRegex(ValueError, 'fixed server URL'):
            apply_settings(self.encoder, self.values)
        self.assertTrue(all(len(c.args) < 3 for c in api.call_args_list))

    @patch('encoder_settings.rest')
    def test_fixed_preset_can_change_quality_and_key(self, api):
        platform = dict(self.platform, customizableUrlEnabled=False, servers=[{'server': 'Primary', 'url': self.values['url']}])
        target = dict(self.active, quality='High')
        api.side_effect = [self.active, platform, {'status': 'Idle'}, None, target]
        self.assertIn('verified', apply_settings(self.encoder, self.values)['message'])
        self.assertEqual(api.call_args_list[3].args[3], target)

    @patch('encoder_settings.rest')
    def test_legacy_bitrate_edit_fails_without_uploading_profile(self, api):
        api.side_effect = [self.active, self.platform]
        with self.assertRaisesRegex(ValueError, 'XML Tool'):
            apply_settings(self.encoder, dict(self.values, bitrate_mbps=6))
        self.assertTrue(all(len(c.args) < 3 for c in api.call_args_list))

    @patch('encoder_settings.time.sleep')
    @patch('encoder_settings.rest')
    def test_verification_failure_does_not_retry_writes(self, api, sleep):
        api.side_effect = [self.active, self.platform, {'status': 'Idle'}, None,
                           ValueError('read failed'), ValueError('read failed'), ValueError('read failed')]
        self.assertEqual(apply_settings(self.encoder, self.values)['verification'], 'unconfirmed')
        self.assertEqual(len([c for c in api.call_args_list if len(c.args) > 2]), 1)

    @patch('encoder_settings.rest')
    def test_invalid_url_does_not_contact_encoder(self, api):
        for changes in [{'protocol': 'rtmp'}, {'url': 'srt://a?secret=value'}, {'url': 'srt://a:wrong'}]:
            with self.assertRaises(ValueError):
                apply_settings(self.encoder, dict(self.values, **changes))
        api.assert_not_called()
