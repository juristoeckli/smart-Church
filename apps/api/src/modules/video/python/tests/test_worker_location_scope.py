import importlib
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

MODULE_DIR = Path(__file__).resolve().parents[1]
LOCATION_A = '00000000-0000-4000-8000-000000000001'
LOCATION_B = '00000000-0000-4000-8000-000000000002'
CONFIG = {
    'sites': [
        {'id': 'site-a', 'department_id': LOCATION_A, 'name': 'Location A', 'router_ip': '', 'encoders': [], 'devices': []},
        {'id': 'site-b', 'department_id': LOCATION_B, 'name': 'Location B', 'router_ip': '', 'encoders': [], 'devices': []},
    ]
}

CONFIG_PATH = Path(__file__).with_name('video-test-config.json')
sys.path.insert(0, str(MODULE_DIR))
video_worker = importlib.import_module('worker')


class WorkerLocationScopeTests(unittest.TestCase):
    def setUp(self):
        video_worker.controller.config = video_worker.load_config()
        video_worker.controller.snapshot = {
            'sites': [
                {'id': 'site-a', 'department_id': LOCATION_A, 'name': 'Location A', 'router_ip': '', 'encoders': [], 'devices': []},
                {'id': 'site-b', 'department_id': LOCATION_B, 'name': 'Location B', 'router_ip': '', 'encoders': [], 'devices': []},
            ],
            'error': None,
            'updated': 123,
        }
        video_worker.controller.videohub_states = {'site-a|hub': {'connected': True}, 'site-b|hub': {'connected': True}}
        video_worker.controller.restart_cycles = {'site-a': {}, 'site-b': {}}

    def test_status_only_includes_selected_locations_equipment(self):
        result = video_worker.dispatch('status', {'department_id': LOCATION_A})
        self.assertEqual([site['id'] for site in result['sites']], ['site-a'])
        self.assertEqual(list(result['videohubs']), ['site-a|hub'])
        self.assertEqual(list(result['restart_cycles']), ['site-a'])

    def test_unmapped_location_receives_empty_status(self):
        result = video_worker.dispatch('status', {'department_id': '00000000-0000-4000-8000-000000000003'})
        self.assertEqual(result['sites'], [])
        with self.assertRaisesRegex(ValueError, 'not configured for this location'):
            video_worker.dispatch('restart-site', {'department_id': '00000000-0000-4000-8000-000000000003', 'site_id': 'site-a'})

    def test_non_uuid_location_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Choose a configured location'):
            video_worker.dispatch('status', {'department_id': 'site-a'})

    def test_location_can_map_to_multiple_video_sites(self):
        duplicate = dict(CONFIG)
        duplicate['sites'] = [*CONFIG['sites'], dict(CONFIG['sites'][0], id='site-a-copy')]
        with patch.object(Path, 'read_text', return_value=json.dumps(duplicate)):
            loaded = video_worker.load_config()
        self.assertEqual([site['id'] for site in loaded['sites'] if site['department_id'] == LOCATION_A], ['site-a', 'site-a-copy'])

    def test_status_includes_all_sites_for_selected_location(self):
        video_worker.controller.snapshot['sites'].append(
            {'id': 'site-a-copy', 'department_id': LOCATION_A, 'name': 'Location A Extra', 'router_ip': '', 'encoders': [], 'devices': []})
        result = video_worker.dispatch('status', {'department_id': LOCATION_A})
        self.assertEqual([site['id'] for site in result['sites']], ['site-a', 'site-a-copy'])

    def test_operations_require_site_when_location_has_multiple_sites(self):
        duplicate = dict(CONFIG)
        duplicate['sites'] = [*CONFIG['sites'], dict(CONFIG['sites'][0], id='site-a-copy')]
        with patch.object(Path, 'read_text', return_value=json.dumps(duplicate)):
            with self.assertRaisesRegex(ValueError, 'Select a site'):
                video_worker.dispatch('restart-site', {'department_id': LOCATION_A})

    def test_requested_site_must_be_mapped_to_location(self):
        with self.assertRaisesRegex(ValueError, 'not configured for this location'):
            video_worker.dispatch('restart-site', {'department_id': LOCATION_A, 'site_id': 'site-b'})


if __name__ == '__main__':
    unittest.main()
