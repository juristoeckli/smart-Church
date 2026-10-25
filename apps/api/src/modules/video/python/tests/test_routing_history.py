import copy
import tempfile
import unittest
import threading
from unittest.mock import patch
from routing_history import RoutingHistory, EXTERNAL


class HistoryTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.TemporaryDirectory()
        self.addCleanup(self.root.cleanup)
        self.history = RoutingHistory(self.root.name)
        self.state = {'connected': True, 'checked_at': 1, 'inputs': ['A', 'B'],
                      'outputs': ['X', 'Y'], 'routes': [0, 1], 'locks': ['U', 'U']}

    def test_confirmed_routes_attribute_only_targeted_outputs_and_do_not_duplicate(self):
        self.history.observe('s|d', self.state)
        changed = copy.deepcopy(self.state)
        changed['routes'] = [1, 0]
        self.history.observe('s|d', changed, 'juri', [0])
        self.history.observe('s|d', changed)
        events = self.history.read('s|d')['events']
        self.assertEqual(len(events), 2)
        self.assertEqual([c['user'] for c in events[-1]['changes']], ['juri', EXTERNAL])
        self.assertEqual(events[0]['state']['routes'], [0, 1])
        self.assertEqual(self.history.read('other|device')['events'], [])

    def test_persists_and_starts_new_baseline_after_restart_without_guessing_offline_changes(self):
        self.history.observe('s|d', self.state)
        restarted = RoutingHistory(self.root.name)
        changed = copy.deepcopy(self.state); changed['routes'] = [1, 1]
        restarted.observe('s|d', changed)
        events = restarted.read('s|d')['events']
        self.assertEqual(len(events), 2)
        self.assertEqual(events[-1]['kind'], 'baseline')
        self.assertEqual(events[-1]['changes'], [])

    def test_failed_write_does_not_advance_baseline(self):
        self.history.observe('s|d', self.state)
        changed = copy.deepcopy(self.state); changed['routes'] = [1, 1]
        with patch('routing_history.os.replace', side_effect=OSError('Disk full')):
            with self.assertRaises(OSError):
                self.history.observe('s|d', changed, 'juri', [0])
        self.assertEqual(len(self.history.read('s|d')['events']), 1)
        self.history.observe('s|d', changed)
        self.assertEqual(self.history.read('s|d')['events'][-1]['changes'][0]['user'], EXTERNAL)

    def test_metadata_changes_and_disconnected_states(self):
        self.history.observe('s|d', self.state)
        self.history.observe('s|d', {'connected': False})
        changed = copy.deepcopy(self.state); changed['locks'][0] = 'L'
        self.history.observe('s|d', changed)
        self.assertEqual(len(self.history.read('s|d')['events']), 2)
        self.assertEqual(self.history.read('s|d')['events'][-1]['user'], EXTERNAL)
        self.assertEqual(self.history.read('s|d')['events'][-1]['kind'], 'baseline')

    def test_retention(self):
        with patch('routing_history.time.time', return_value=1):
            self.history.observe('old|d', self.state)
        self.history.observe('new|d', self.state)
        self.assertEqual(self.history.read('old|d')['events'], [])

    def test_event_limit(self):
        self.history.observe('s|d', self.state)
        self.history.events *= 2000
        changed = copy.deepcopy(self.state); changed['routes'] = [1, 1]
        self.history.observe('s|d', changed)
        self.assertEqual(len(self.history.events), 2000)

    def test_same_user_groups_within_fixed_window_preserving_each_change(self):
        with patch('routing_history.time.time', return_value=1000):
            self.history.observe('s|d', self.state)
        for moment, route in [(1010, 1), (1200, 0), (1311, 1)]:
            changed = copy.deepcopy(self.state); changed['routes'][0] = route
            with patch('routing_history.time.time', return_value=moment):
                self.history.observe('s|d', changed, 'juri', [0])
        events = self.history.events
        self.assertEqual(len(events), 3)
        self.assertEqual(events[1]['started_at'], 1010)
        self.assertEqual(events[1]['time'], 1200)
        self.assertEqual([c['time'] for c in events[1]['changes']], [1010, 1200])
        self.assertEqual(events[1]['state']['routes'], [0, 1])

    def test_different_user_and_disabled_grouping(self):
        self.history.observe('s|d', self.state)
        for user, value in [('juri', 1), ('other', 0), ('juri', 1)]:
            changed = copy.deepcopy(self.state); changed['routes'][0] = value
            self.history.observe('s|d', changed, user, [0])
        self.assertEqual(len(self.history.events), 4)
        self.history.merge_window_seconds = 0
        changed['routes'][0] = 0
        self.history.observe('s|d', changed, 'juri', [0])
        self.assertEqual(len(self.history.events), 5)

    def test_metadata_detail_and_failed_merge_preserves_persisted_event(self):
        self.history.observe('s|d', self.state)
        changed = copy.deepcopy(self.state); changed['locks'][0] = 'L'
        self.history.observe('s|d', changed)
        self.assertEqual(self.history.events[-1]['details'][0]['before'], 'U')
        changed['locks'][0] = 'U'
        with patch('routing_history.os.replace', side_effect=OSError('Disk full')):
            with self.assertRaises(OSError): self.history.observe('s|d', changed)
        self.assertEqual(len(self.history.events[-1]['details']), 1)

    def test_controller_attributes_verified_change_and_preserves_unconfirmed_outcome(self):
        from controller import Controller
        c = Controller.__new__(Controller)
        c.lock = threading.Lock(); c.command_locks = {}; c.videohub_states = {}
        c.routing_history = self.history
        config = {'timeout_seconds': 1, 'sites': [{'id': 's', 'devices': [
            {'id': 'd', 'type': 'videohub', 'ip': '127.0.0.1', 'port': 9990}]}]}
        data = {'site': 's', 'device': 'd', 'input': 1, 'output': 0,
                'expected_input': 0, 'actor': 'juri'}
        def verified(*args, **kwargs):
            kwargs['observe'](self.state)
            result = copy.deepcopy(self.state); result['routes'][0] = 1
            return result
        with patch('controller.load_config', return_value=config), patch('controller.videohub_request', side_effect=verified):
            c.route_videohub(data)
        self.assertEqual(self.history.read('s|d')['events'][-1]['changes'][0]['user'], 'juri')
        def uncertain(*args, **kwargs):
            kwargs['observe'](c.videohub_states['s|d'])
            raise ValueError('Not confirmed')
        with patch('controller.load_config', return_value=config), patch('controller.videohub_request', side_effect=uncertain):
            with self.assertRaises(ValueError): c.route_videohub(data)
        self.assertEqual(len(self.history.read('s|d')['events']), 2)
