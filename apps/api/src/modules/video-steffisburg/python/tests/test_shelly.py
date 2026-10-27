import io
import json
import unittest
import urllib.error
from unittest.mock import patch

from shelly_monitor import read_relay


class ShellyTests(unittest.TestCase):
    @patch('shelly_monitor.urllib.request.build_opener')
    def test_true_and_false_outputs_are_measured_without_writes(self, build):
        for output, expected in [(True, 'on'), (False, 'off')]:
            build.return_value.open.return_value = io.BytesIO(json.dumps({'id': 0, 'output': output}).encode())
            result = read_relay({'ip': '10.0.0.2'}, 2)
            self.assertEqual(result['power'], expected)
            self.assertIsNotNone(result['power_checked_at'])
            request = build.return_value.open.call_args.args[0]
            self.assertEqual(request.get_method(), 'GET')
            self.assertTrue(request.full_url.endswith('/rpc/Switch.GetStatus?id=0'))
            self.assertIsNone(request.data)

    @patch('shelly_monitor.urllib.request.build_opener')
    def test_invalid_status_does_not_become_on(self, build):
        for status in [{'id': 0, 'output': 'false'}, {'id': 1, 'output': True}, {}, []]:
            build.return_value.open.return_value = io.BytesIO(json.dumps(status).encode())
            self.assertEqual(read_relay({'ip': '10.0.0.2'}, 2)['power'], 'unknown')

    @patch('shelly_monitor.urllib.request.build_opener')
    def test_authentication_failure_is_reported(self, build):
        build.return_value.open.side_effect = urllib.error.HTTPError('url', 401, 'Unauthorized', {}, None)
        result = read_relay({'ip': '10.0.0.2'}, 2)
        self.assertEqual(result['power'], 'unknown')
        self.assertEqual(result['power_error'], 'Shelly authentication required')

    @patch('shelly_monitor.urllib.request.build_opener')
    def test_connection_failure_is_unknown(self, build):
        build.return_value.open.side_effect = TimeoutError()
        self.assertEqual(read_relay({'ip': '10.0.0.2'}, 2)['power'], 'unknown')

    @patch('shelly_monitor.urllib.request.build_opener')
    def test_unconfigured_address_does_not_connect(self, build):
        result = read_relay({'ip': ''}, 2)
        self.assertEqual(result['power'], 'unknown')
        self.assertIsNone(result['power_checked_at'])
        build.assert_not_called()
