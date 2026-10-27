import json
import unittest
from unittest.mock import patch

from encoder_settings import read_stream_summary
from controller import Controller


class StreamSummaryTests(unittest.TestCase):
    def setUp(self):
        self.active = {'platform': 'Site preset', 'quality': 'High', 'server': 'Primary',
                       'url': 'srt://user:private-password@receiver:9000/private-path?token=private-token',
                       'key': 'private-key-abcd', 'passphrase': 'private-passphrase'}

    @patch('encoder_settings.rest')
    def test_only_host_protocol_port_and_masked_key_are_exposed(self, api):
        api.return_value = self.active
        result = read_stream_summary({}, 2)
        self.assertEqual(result['server'], 'srt://receiver:9000')
        self.assertEqual(result['key_masked'], '*****abcd')
        self.assertTrue(result['has_key'])
        self.assertNotIn('private-', json.dumps(result))
        self.assertNotIn('passphrase', result)
        self.assertEqual(result['platform'], 'Site preset')
        api.assert_called_once_with({}, '/livestreams/0/activePlatform', timeout=2)

    @patch('encoder_settings.rest')
    def test_missing_url_and_key_use_selected_platform_server(self, api):
        api.side_effect = [dict(self.active, url='', key=''),
                           {'key': 'preset-key-1234', 'servers': [
                               {'server': 'Backup', 'url': 'rtmp://wrong/live'},
                               {'server': 'Primary', 'url': 'rtmps://destination.example:443/private'}]}]
        result = read_stream_summary({}, 2)
        self.assertEqual(result['server'], 'rtmps://destination.example:443')
        self.assertEqual(result['key_masked'], '*****1234')

    @patch('encoder_settings.rest')
    def test_short_keys_are_not_shown_in_full(self, api):
        for key in ['a', 'ab', 'abc', 'abcd']:
            api.return_value = dict(self.active, key=key)
            result = read_stream_summary({}, 2)
            self.assertEqual(result['key_masked'], '*' * len(key))

    @patch('encoder_settings.rest')
    def test_empty_key_is_reported_as_unconfigured(self, api):
        api.side_effect = [dict(self.active, key=''), {'servers': []}]
        result = read_stream_summary({}, 2)
        self.assertFalse(result['has_key'])
        self.assertEqual(result['key_masked'], '')

    @patch('encoder_settings.rest')
    def test_ipv6_host_keeps_brackets(self, api):
        api.return_value = dict(self.active, url='srt://[2001:db8::1]:9000/private')
        self.assertEqual(read_stream_summary({}, 2)['server'], 'srt://[2001:db8::1]:9000')

    @patch('controller.read_stream_summary', side_effect=ValueError('unavailable'))
    @patch('controller.encoder_request', return_value={'Status': 'Idle'})
    @patch('controller.ping', return_value='Reachable')
    def test_rest_failure_does_not_mark_tcp_control_unavailable(self, ping, request, summary):
        import threading
        controller = Controller.__new__(Controller)
        controller.lock = threading.Lock()
        controller.command_locks = {}
        result = controller.check_encoder({'ip': '127.0.0.1', 'port': 9977}, 2)
        self.assertEqual(result['control'], 'Connected')
        self.assertFalse(result['streaming_settings']['available'])
