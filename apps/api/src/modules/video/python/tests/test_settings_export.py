import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

from encoder_settings import export_settings
from streaming_xml import parse_streaming_xml, platform_xml, preview_import, apply_import


class StreamingXmlTests(unittest.TestCase):
    def setUp(self):
        self.active = {'platform': 'Site preset', 'server': 'Primary', 'quality': 'High',
                       'url': 'srt://receiver:9000', 'key': 'private-key', 'passphrase': 'private-phrase'}
        self.platform = {'platform': 'Site preset', 'customizableUrlEnabled': True,
                         'servers': [{'server': 'Backup', 'url': 'srt://backup:9000', 'group': 'Secondary'},
                                     {'server': 'Primary', 'url': 'srt://receiver:9000', 'group': 'Primary'}],
                         'profiles': [{'profile': 'High', 'configs': [
                             {'resolution': '720p', 'fps': '30', 'bitrate': 4000000, 'audioBitrate': 128000},
                             {'resolution': '1080p', 'fps': '60', 'bitrate': 9000000, 'audioBitrate': 128000,
                              'videoCodecs': ['H264', 'H265']}]},
                                      {'profile': 'Low', 'configs': [
                             {'resolution': '1080p', 'fps': '30', 'bitrate': 2000000}]}],
                         'credentials': {'username': 'private-user', 'password': 'private-password'}}
        self.xml = platform_xml(self.active, self.platform, True)
        self.values = {'xml': self.xml, 'platform': 'Site preset', 'server': 'Primary', 'quality': 'High'}
        plan = patch('streaming_xml.plan_import', return_value={'filename': 'GfC-Imported.xml'})
        plan.start()
        self.addCleanup(plan.stop)

    @patch('encoder_settings.rest')
    def test_export_uses_official_xml_and_omits_secrets_by_default(self, api):
        api.side_effect = [self.active, self.platform]
        result = export_settings({}, {})
        self.assertEqual(result['format'], 'blackmagic-streaming-xml')
        root = ET.fromstring(result['xml'])
        self.assertEqual(root.tag, 'streaming')
        self.assertIsNone(root.find('./service/key'))
        self.assertIsNone(root.find('./service/credentials'))
        self.assertNotIn('private-', result['xml'])
        self.assertEqual(len(api.call_args_list), 2)
        self.assertTrue(all(len(call.args) == 2 for call in api.call_args_list))

    def test_export_omits_non_streaming_profiles_without_configs(self):
        platform = dict(self.platform, profiles=[{'profile': 'HyperDeck High', 'configs': []}] + self.platform['profiles'])
        _, services = parse_streaming_xml(platform_xml(self.active, platform, True))
        self.assertEqual([p['profile'] for p in services[0]['profiles']], ['High', 'Low'])

    def test_export_preserves_servers_codecs_and_per_format_bitrates(self):
        root, services = parse_streaming_xml(self.xml)
        self.assertEqual([s['server'] for s in services[0]['servers']], ['Primary', 'Backup'])
        self.assertEqual(services[0]['default_quality'], 'High')
        configs = services[0]['profiles'][0]['configs']
        self.assertEqual([c['bitrate'] for c in configs], [4000000, 9000000, 9000000])
        self.assertEqual([c['codec'] for c in configs], ['H264', 'H264', 'H265'])
        self.assertEqual(root.findtext('./service/key'), 'private-key')
        self.assertEqual(root.findtext('./service/credentials/password'), 'private-password')
        self.assertNotIn('private-phrase', self.xml)

    def test_preview_supports_multiple_services_without_returning_secrets(self):
        root = ET.fromstring(self.xml)
        other = ET.fromstring(ET.tostring(root.find('service')))
        other.find('name').text = 'Other service'
        root.append(other)
        preview = preview_import({}, {'xml': ET.tostring(root, encoding='unicode')})
        self.assertEqual(len(preview['services']), 2)
        self.assertNotIn('private-', str(preview))

    def test_doctype_entities_bad_defaults_and_malformed_xml_rejected(self):
        for text in ['not XML', '<settings/>', '<!DOCTYPE streaming [<!ENTITY a "x">]><streaming/>',
                     self.xml.replace('default="High"', 'default="Missing"'),
                     self.xml.replace('<bitrate>4000000</bitrate>', '<bitrate>-1</bitrate>')]:
            with self.assertRaises(ValueError):
                parse_streaming_xml(text)

    def test_oversize_xml_rejected(self):
        with self.assertRaisesRegex(ValueError, '256 KB'):
            parse_streaming_xml(' ' * 262145)

    def test_credentials_and_query_parameters_are_hidden_in_preview(self):
        xml = self.xml.replace('srt://receiver:9000', 'srt://user:password@receiver:9000?token=secret')
        _, services = parse_streaming_xml(xml)
        self.assertEqual(services[0]['servers'][0]['url'], 'srt://receiver:9000')
        self.assertNotIn('password', str(services))
        self.assertNotIn('token', str(services))

    @patch('streaming_xml.rest')
    def test_import_uploads_complete_xml_and_preserves_exact_bitrates(self, api):
        target = {k: self.active[k] for k in ('platform', 'server', 'quality', 'url', 'key', 'passphrase')}
        target['server'] = 'Custom'
        api.side_effect = [self.active, {'status': 'Idle'}, None, self.xml.encode(), self.platform, {'status': 'Idle'}, None, target]
        self.assertIn('verified', apply_import({}, self.values)['message'])
        writes = [c for c in api.call_args_list if len(c.args) > 2]
        self.assertEqual(len(writes), 2)
        self.assertEqual(writes[0].args[3], self.xml.encode())
        self.assertEqual(writes[1].args[3], target)
        self.assertNotIn('/start', str(api.call_args_list))

    @patch('streaming_xml.time.sleep')
    @patch('streaming_xml.rest')
    def test_missing_profile_after_upload_never_activates(self, api, sleep):
        api.side_effect = [self.active, {'status': 'Idle'}, None,
                           self.xml.encode(), {'profiles': []},
                           self.xml.encode(), {'profiles': []},
                           self.xml.encode(), {'profiles': []}]
        with self.assertRaisesRegex(ValueError, 'Activation was not attempted'):
            apply_import({}, self.values)
        writes = [c for c in api.call_args_list if len(c.args) > 2]
        self.assertEqual(len(writes), 1)

    @patch('streaming_xml.rest')
    def test_upload_failure_reports_stage_and_never_activates(self, api):
        api.side_effect = [self.active, {'status': 'Idle'}, ValueError('HTTP 400')]
        with self.assertRaisesRegex(ValueError, 'XML upload failed; activation was not attempted'):
            apply_import({}, self.values)
        self.assertEqual(sum(len(c.args) > 2 for c in api.call_args_list), 1)

    @patch('streaming_xml.rest')
    def test_blank_lines_removed_for_firmware(self, api):
        xml = self.xml.replace('<servers>', '\n\n<servers>')
        target = dict(self.active, server='Custom')
        api.side_effect = [self.active, {'status': 'Idle'}, None, xml.encode(), self.platform,
                           {'status': 'Idle'}, None, target]
        apply_import({}, dict(self.values, xml=xml))
        upload = api.call_args_list[2].args[3].decode()
        self.assertNotIn('\n\n', upload)

    @patch('streaming_xml.rest')
    def test_whitespace_in_xml_names_and_selections_is_normalized(self, api):
        xml = self.xml.replace('<name>Primary</name>', '<name>\n Primary \n</name>')
        xml = xml.replace('<name>Site preset</name>', '<name> Site preset </name>')
        xml = xml.replace('<name>High</name>', '<name> High </name>')
        target = dict(self.active, server='Custom')
        api.side_effect = [self.active, {'status': 'Idle'}, None, xml.encode(), self.platform,
                           {'status': 'Idle'}, None, target]
        result = apply_import({}, dict(self.values, xml=xml, platform=' Site preset ',
                                      server='\nPrimary ', quality=' High '))
        self.assertIn('verified', result['message'])
        self.assertEqual(api.call_args_list[6].args[3], target)

    @patch('streaming_xml.rest')
    def test_firmware_added_defaults_do_not_reject_successful_upload(self, api):
        root = ET.fromstring(self.xml)
        for profile in root.findall('./service/profiles/profile'):
            ET.SubElement(profile, 'low-latency').text = 'false'
        for config in root.findall('./service/profiles/profile/config'):
            if config.find('audio-bitrate') is None:
                ET.SubElement(config, 'audio-bitrate').text = '128000'
            ET.SubElement(config, 'keyframe-interval').text = '2'
            config.set('fps', config.get('fps') + '.0')
        target = dict(self.active, server='Custom')
        api.side_effect = [self.active, {'status': 'Idle'}, None, ET.tostring(root), self.platform,
                           {'status': 'Idle'}, None, target]
        self.assertIn('verified', apply_import({}, self.values)['message'])

    def test_signature_still_detects_changed_bitrate_key_and_url(self):
        from streaming_xml import xml_settings_signature
        original = xml_settings_signature(ET.fromstring(self.xml))
        for tag in ('bitrate', 'key', 'url'):
            root = ET.fromstring(self.xml)
            root.find('.//' + tag).text = 'changed'
            self.assertNotEqual(original, xml_settings_signature(root))

    @patch('streaming_xml.rest')
    def test_streaming_encoder_cannot_import(self, api):
        api.side_effect = [self.active, {'status': 'Streaming'}]
        with self.assertRaisesRegex(ValueError, 'Stop the stream'):
            apply_import({}, self.values)
        self.assertTrue(all(len(c.args) == 2 for c in api.call_args_list))

    @patch('streaming_xml.rest')
    def test_stream_start_between_upload_and_activation_blocks_activation(self, api):
        api.side_effect = [self.active, {'status': 'Idle'}, None, self.xml.encode(), self.platform, {'status': 'Streaming'}]
        with self.assertRaisesRegex(ValueError, 'preset selection was not changed'):
            apply_import({}, self.values)
        self.assertEqual(sum(len(c.args) > 2 for c in api.call_args_list), 1)

    @patch('streaming_xml.rest')
    def test_invalid_selection_does_not_contact_encoder(self, api):
        with self.assertRaises(ValueError):
            apply_import({}, dict(self.values, quality='Missing'))
        api.assert_not_called()

    @patch('streaming_xml.rest')
    def test_query_parameters_are_preserved_when_url_is_not_edited(self, api):
        xml = self.xml.replace('srt://receiver:9000', 'srt://receiver:9000?streamid=private')
        target = dict(self.active, server='Custom', url='srt://receiver:9000?streamid=private')
        api.side_effect = [self.active, {'status': 'Idle'}, None, xml.encode(), self.platform, {'status': 'Idle'}, None, target]
        self.assertIn('verified', apply_import({}, dict(self.values, xml=xml))['message'])
        self.assertEqual(api.call_args_list[6].args[3]['url'], target['url'])

    @patch('streaming_xml.time.sleep')
    @patch('streaming_xml.rest')
    def test_ambiguous_verification_never_repeats_writes(self, api, sleep):
        api.side_effect = [self.active, {'status': 'Idle'}, None, self.xml.encode(), self.platform, {'status': 'Idle'}, None,
                           ValueError('unavailable'), ValueError('unavailable'), ValueError('unavailable')]
        self.assertEqual(apply_import({}, self.values)['verification'], 'unconfirmed')
        self.assertEqual(sum(len(c.args) > 2 for c in api.call_args_list), 2)

    def test_customizable_service_may_omit_servers(self):
        root = ET.fromstring(self.xml)
        service = root.find('service')
        service.remove(service.find('servers'))
        _, services = parse_streaming_xml(ET.tostring(root, encoding='unicode'))
        self.assertEqual(services[0]['servers'], [])
        self.assertTrue(services[0]['customizable_url'])


class XmlUploadDestinationTests(unittest.TestCase):
    def setUp(self):
        self.xml = '<streaming><service><name>Test</name><servers><server><name>Primary</name><url>srt://receiver:9000</url></server></servers><profiles><profile><name>High</name><config resolution="1080p" fps="30"><bitrate>6000000</bitrate></config></profile></profiles></service></streaming>'

    @patch('streaming_xml.rest')
    def test_updates_original_custom_file(self, api):
        from streaming_xml import plan_import
        api.side_effect = [['Original.xml'], self.xml.encode(), ['Test', 'YouTube']]
        self.assertEqual(plan_import({}, {'xml': self.xml})['filename'], 'Original.xml')
        self.assertTrue(all(len(c.args) == 2 for c in api.call_args_list))

    @patch('streaming_xml.rest')
    def test_builtin_name_collision_is_rejected_before_writes(self, api):
        from streaming_xml import plan_import
        api.side_effect = [None, ['Test']]
        with self.assertRaisesRegex(ValueError, 'built-in'):
            plan_import({}, {'xml': self.xml})

    @patch('streaming_xml.rest')
    def test_chooses_unused_filename(self, api):
        from streaming_xml import plan_import
        other = self.xml.replace('<name>Test</name>', '<name>Other</name>')
        api.side_effect = [['GfC-Imported.xml'], other.encode(), ['Other']]
        self.assertEqual(plan_import({}, {'xml': self.xml})['filename'], 'GfC-Imported-2.xml')

    @patch('streaming_xml.rest')
    def test_unrelated_services_cannot_be_removed(self, api):
        from streaming_xml import plan_import
        root = ET.fromstring(self.xml)
        other = ET.fromstring(ET.tostring(root.find('service')))
        other.find('name').text = 'Other'
        root.append(other)
        api.side_effect = [['Original.xml'], ET.tostring(root), ['Test', 'Other']]
        with self.assertRaisesRegex(ValueError, 'other services'):
            plan_import({}, {'xml': self.xml})
