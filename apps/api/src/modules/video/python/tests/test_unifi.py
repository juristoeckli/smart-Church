import unittest
from unifi_monitor import evaluate, mesh_edges


class UnifiTests(unittest.TestCase):
    def setUp(self):
        self.config = {'sites': [
            {'id': 'a', 'name': 'A', 'unifi_host_id': 'ha', 'encoders': [{'destination_site': 'b'}]},
            {'id': 'hub', 'name': 'Hub', 'unifi_host_id': 'hh', 'encoders': []},
            {'id': 'b', 'name': 'B', 'unifi_host_id': 'hb', 'encoders': []}]}

    def test_multihop_connected(self):
        result = evaluate(self.config, [('ha', 'hh', 'up'), ('hh', 'hb', 'up')], 123)[0]
        self.assertEqual(result['status'], 'up')
        self.assertEqual(result['via'], ['A', 'Hub', 'B'])
        self.assertEqual(result['hops'], 2)

    def test_failed_and_unknown_hops(self):
        for state in ['down', 'unknown']:
            result = evaluate(self.config, [('ha', 'hh', 'up'), ('hh', 'hb', state)], 123)[0]
            self.assertEqual(result['status'], state)

    def test_both_endpoints_must_explicitly_be_connected(self):
        def response(a, b):
            return {'status': {'connections': [{'sites': [
                {'hostId': 'ha', 'status': a}, {'hostId': 'hb', 'status': b}]}]}}
        good = {'connected': True, 'offline': False, 'errors': []}
        self.assertEqual(mesh_edges(response(good, good))[0][2], 'up')
        self.assertEqual(mesh_edges(response(good, {'connected': False}))[0][2], 'down')
        self.assertEqual(mesh_edges(response({}, {}))[0][2], 'unknown')

    def test_missing_path_is_unknown(self):
        self.assertEqual(evaluate(self.config, [], 123)[0]['status'], 'unknown')

    def test_alternate_healthy_path(self):
        result = evaluate(self.config, [('ha', 'hb', 'down'), ('ha', 'hh', 'up'), ('hh', 'hb', 'up')], 123)[0]
        self.assertEqual(result['status'], 'up')


if __name__ == '__main__':
    unittest.main()
