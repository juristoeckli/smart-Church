import unittest
from unittest.mock import patch

from preset_management import delete_preset, preset_deletion_info


class PresetDeletionTests(unittest.TestCase):
    def setUp(self):
        self.info = {'allowed': True, 'reason': '', 'filename': 'Site presets.xml',
                     'services': ['Site preset', 'Backup preset']}
        self.values = {'platform': 'Site preset', 'filename': 'Site presets.xml',
                       'expected_services': ['Site preset', 'Backup preset'], 'confirmed': True}
        self.xml = b'<streaming><service><name>Site preset</name></service><service><name>Backup preset</name></service></streaming>'

    @patch('preset_management.rest')
    def test_builtin_preset_is_protected(self, api):
        api.side_effect = [['Site presets.xml'], self.xml]
        result = preset_deletion_info({}, 'YouTube RTMP')
        self.assertFalse(result['allowed'])
        self.assertIn('Built-in', result['reason'])
        self.assertTrue(all(len(c.args) == 2 for c in api.call_args_list))

    @patch('preset_management.rest')
    def test_file_with_any_active_service_is_protected(self, api):
        api.side_effect = [['Site presets.xml'], self.xml, {'platform': 'Backup preset'}]
        result = preset_deletion_info({}, 'Site preset')
        self.assertFalse(result['allowed'])
        self.assertEqual(result['services'], ['Site preset', 'Backup preset'])

    @patch('preset_management.rest')
    def test_unreadable_file_blocks_deletion(self, api):
        api.side_effect = [['Site presets.xml'], ValueError('unavailable')]
        self.assertFalse(preset_deletion_info({}, 'Site preset')['allowed'])

    @patch('preset_management.rest')
    def test_duplicate_service_in_different_files_is_ambiguous(self, api):
        api.side_effect = [['A.xml', 'B.xml'], self.xml, self.xml]
        self.assertFalse(preset_deletion_info({}, 'Site preset')['allowed'])

    @patch('preset_management.rest')
    def test_confirmation_is_required_before_any_device_access(self, api):
        with self.assertRaisesRegex(ValueError, 'confirmation'):
            delete_preset({}, dict(self.values, confirmed='true'))
        api.assert_not_called()

    @patch('preset_management.preset_deletion_info')
    @patch('preset_management.rest')
    def test_only_confirmed_file_is_deleted(self, api, info):
        info.return_value = self.info
        api.side_effect = [{'platform': 'Other'}, {'status': 'Idle'}, None, []]
        result = delete_preset({}, self.values)
        self.assertIn('verified', result['message'])
        writes = [c for c in api.call_args_list if len(c.args) > 2]
        self.assertEqual(len(writes), 1)
        self.assertEqual(writes[0].args[1:], ('/livestreams/customPlatforms/Site%20presets.xml', 'DELETE'))

    @patch('preset_management.preset_deletion_info')
    @patch('preset_management.rest')
    def test_changed_file_or_service_list_requires_new_confirmation(self, api, info):
        info.return_value = self.info
        for changed in [dict(self.values, filename='../wrong.xml'),
                        dict(self.values, expected_services=['Site preset'])]:
            with self.assertRaisesRegex(ValueError, 'changed'):
                delete_preset({}, changed)
        api.assert_not_called()

    @patch('preset_management.preset_deletion_info')
    @patch('preset_management.rest')
    def test_active_service_is_rechecked_after_confirmation(self, api, info):
        info.return_value = self.info
        api.return_value = {'platform': 'Backup preset'}
        with self.assertRaisesRegex(ValueError, 'Switch to another'):
            delete_preset({}, self.values)
        self.assertTrue(all(len(c.args) == 2 for c in api.call_args_list))

    @patch('preset_management.preset_deletion_info')
    @patch('preset_management.rest')
    def test_streaming_encoder_cannot_delete(self, api, info):
        info.return_value = self.info
        api.side_effect = [{'platform': 'Other'}, {'status': 'Streaming'}]
        with self.assertRaisesRegex(ValueError, 'Stop the stream'):
            delete_preset({}, self.values)
        self.assertTrue(all(len(c.args) == 2 for c in api.call_args_list))

    @patch('preset_management.preset_deletion_info')
    @patch('preset_management.rest')
    def test_ambiguous_delete_is_never_retried(self, api, info):
        info.return_value = self.info
        api.side_effect = [{'platform': 'Other'}, {'status': 'Idle'}, ValueError('timeout')]
        with self.assertRaisesRegex(ValueError, 'outcome uncertain'):
            delete_preset({}, self.values)
        self.assertEqual(sum(len(c.args) > 2 for c in api.call_args_list), 1)

    @patch('preset_management.time.sleep')
    @patch('preset_management.preset_deletion_info')
    @patch('preset_management.rest')
    def test_unconfirmed_readback_does_not_repeat_deletion(self, api, info, sleep):
        info.return_value = self.info
        api.side_effect = [{'platform': 'Other'}, {'status': 'Idle'}, None,
                           ValueError('unavailable'), ValueError('unavailable'), ValueError('unavailable')]
        self.assertEqual(delete_preset({}, self.values)['verification'], 'unconfirmed')
        self.assertEqual(sum(len(c.args) > 2 for c in api.call_args_list), 1)
