"""Blackmagic Streaming XML import, preview and export."""
import re
import time
import urllib.parse
import xml.etree.ElementTree as ET

from encoder_settings import rest

MAX_XML_BYTES = 262144


def _name(element, label):
    name = (element.findtext('name') or '').strip()
    if not name or len(name) > 256:
        raise ValueError('Missing or invalid ' + label + ' name')
    return name


def _url(value, allow_empty=False):
    if not value and allow_empty:
        return
    try:
        parsed = urllib.parse.urlsplit(value)
        parsed.port
        valid = parsed.scheme.lower() in ('rtmp', 'rtmps', 'srt') and parsed.hostname
    except ValueError:
        valid = False
    if not valid or any(c in value for c in '\r\n'):
        raise ValueError('XML server URLs must use RTMP, RTMPS or SRT')


def _safe_url(value):
    p = urllib.parse.urlsplit(value)
    return urllib.parse.urlunsplit((p.scheme, p.netloc.split('@')[-1], p.path, '', ''))


def parse_streaming_xml(text):
    if not isinstance(text, str) or not text.strip() or len(text.encode('utf-8')) > MAX_XML_BYTES:
        raise ValueError('Choose a Blackmagic streaming XML file of 256 KB or smaller')
    if re.search(r'<!\s*(DOCTYPE|ENTITY)\b', text, re.I):
        raise ValueError('XML document types and entities are not supported')
    try:
        root = ET.fromstring(text)
    except (ET.ParseError, ValueError):
        raise ValueError('The file is not valid streaming XML') from None
    if root.tag != 'streaming' or not 1 <= len(root.findall('service')) <= 64:
        raise ValueError('Blackmagic streaming XML requires a streaming root and service elements')
    services, names = [], set()
    for service in root.findall('service'):
        name = _name(service, 'service')
        if name in names:
            raise ValueError('XML service names must be unique')
        names.add(name)
        custom = service.get('customizable-url', 'false')
        if custom not in ('true', 'false'):
            raise ValueError('Invalid customizable-url attribute')
        servers, server_names = [], set()
        for server in service.findall('./servers/server'):
            server_name = _name(server, 'server')
            if server_name in server_names:
                raise ValueError('XML server names must be unique within a service')
            server_names.add(server_name)
            url = (server.findtext('url') or '').strip()
            _url(url, custom == 'true')
            servers.append({'server': server_name, 'url': _safe_url(url),
                            'group': server.get('group', '')})
        if not servers and custom != 'true':
            raise ValueError('Each service requires servers or customizable-url="true"')
        profiles, profile_names = [], set()
        for profile in service.findall('./profiles/profile'):
            quality = _name(profile, 'quality profile')
            if quality in profile_names:
                raise ValueError('XML quality profile names must be unique within a service')
            profile_names.add(quality)
            configs = []
            for config in profile.findall('config'):
                resolution, fps = config.get('resolution', ''), config.get('fps', '')
                codec = config.get('codec', 'H264')
                try:
                    bitrate = int(config.findtext('bitrate', ''))
                    frame_rate = float(fps)
                    audio = int(config.findtext('audio-bitrate', '128000'))
                except ValueError:
                    raise ValueError('Each XML video config requires resolution, fps and bitrate') from None
                if (not re.fullmatch(r'\d+[pi]', resolution) or not 0 < frame_rate <= 240
                        or not 0 < bitrate <= 1_000_000_000 or codec not in ('H264', 'H265')
                        or audio != 128000):
                    raise ValueError('Unsupported XML video config or audio bitrate (128000 required)')
                configs.append({'resolution': resolution, 'fps': fps, 'codec': codec, 'bitrate': bitrate})
            if not configs:
                raise ValueError('Each XML quality profile requires video configs')
            profiles.append({'profile': quality, 'configs': configs})
        if not profiles:
            raise ValueError('Each XML service requires quality profiles')
        profiles_node = service.find('profiles')
        default = (profiles_node.get('default') or profiles[0]['profile']).strip()
        if default not in profile_names:
            raise ValueError('XML default quality must match a profile name')
        services.append({'platform': name, 'customizable_url': custom == 'true', 'servers': servers,
                         'profiles': profiles, 'default_quality': default,
                         'has_key': bool(service.findtext('key')),
                         'has_credentials': service.find('credentials') is not None})
    return root, services


def preview_import(encoder, values):
    _, services = parse_streaming_xml(values.get('xml'))
    return {'services': services}


def platform_xml(active, platform, include_secrets=False):
    root = ET.Element('streaming')
    custom = platform.get('customizableUrlEnabled', False)
    service = ET.SubElement(root, 'service', {'customizable-url': str(bool(custom)).lower()})
    ET.SubElement(service, 'name').text = active['platform']
    if include_secrets:
        key = active.get('key') or platform.get('key')
        if key:
            ET.SubElement(service, 'key').text = key
    servers = ET.SubElement(service, 'servers')
    rows = sorted(platform.get('servers', []), key=lambda s: s['server'] != active.get('server'))
    if not rows:
        rows = [{'server': active.get('server', 'Custom'), 'url': active.get('url', '')}]
    for row in rows:
        attrs = {'group': row['group']} if row.get('group') else {}
        item = ET.SubElement(servers, 'server', attrs)
        ET.SubElement(item, 'name').text = row['server']
        url = active.get('url') if row['server'] == active.get('server') and active.get('url') else row.get('url', '')
        p = urllib.parse.urlsplit(url)
        if not include_secrets and (p.username or p.password or p.query or p.fragment):
            raise ValueError('A server URL contains credentials or parameters; enable Include secrets to export it intact')
        ET.SubElement(item, 'url').text = url
        extensions = row.get('srtExtensions')
        if extensions:
            if not include_secrets:
                raise ValueError('This preset contains SRT stream ID parameters; enable Include secrets to export them intact')
            stream_id = extensions.get('streamId') if isinstance(extensions, dict) else None
            if isinstance(stream_id, dict):
                stream_id = [{'key': k, 'value': v} for k, v in stream_id.items()]
            if not isinstance(stream_id, list) or not all(isinstance(v, dict) and 'key' in v and 'value' in v for v in stream_id):
                raise ValueError('This preset has SRT extensions that cannot be exported safely')
            ext = ET.SubElement(item, 'srt-extensions')
            stream = ET.SubElement(ext, 'stream-id')
            for entry in stream_id:
                ET.SubElement(stream, 'item', {'key': str(entry['key']), 'value': str(entry['value'])})
    profiles = ET.SubElement(service, 'profiles', {'default': active['quality']})
    for profile in platform.get('profiles', []):
        # Firmware also lists HyperDeck presets without streaming video configs.
        if not profile.get('configs'):
            continue
        quality = ET.SubElement(profiles, 'profile')
        ET.SubElement(quality, 'name').text = profile['profile']
        for config in profile.get('configs', []):
            for codec in config.get('videoCodecs') or ['H264']:
                entry = ET.SubElement(quality, 'config', {'resolution': config['resolution'],
                                      'fps': str(config['fps']), 'codec': codec})
                ET.SubElement(entry, 'bitrate').text = str(config['bitrate'])
                ET.SubElement(entry, 'audio-bitrate').text = str(config.get('audioBitrate', 128000))
    credentials = active.get('credentials') or platform.get('credentials')
    if include_secrets and credentials:
        element = ET.SubElement(service, 'credentials')
        ET.SubElement(element, 'username').text = credentials.get('username', '')
        ET.SubElement(element, 'password').text = credentials.get('password', '')
    ET.indent(root, space='  ')
    text = ET.tostring(root, encoding='utf-8', xml_declaration=True).decode('utf-8')
    parse_streaming_xml(text)
    return text


def xml_settings_signature(root):
    """Compare settings, allowing firmware-added defaults and reordered elements."""
    import copy
    root = copy.deepcopy(root)
    for service in root.findall('service'):
        service.set('customizable-url', service.get('customizable-url', 'false'))
        if service.find('key') is None:
            ET.SubElement(service, 'key').text = ''
        profiles = service.find('profiles')
        if profiles is not None and not profiles.get('default'):
            profiles.set('default', (profiles.findtext('./profile/name') or '').strip())
        for profile in service.findall('./profiles/profile'):
            if profile.find('low-latency') is None:
                ET.SubElement(profile, 'low-latency').text = 'false'
            for config in profile.findall('config'):
                config.set('codec', config.get('codec', 'H264'))
                config.set('fps', format(float(config.get('fps', '0')), '.12g'))
                for tag, default in [('audio-bitrate', '128000'), ('keyframe-interval', '2')]:
                    if config.find(tag) is None:
                        ET.SubElement(config, tag).text = default
    def signature(node):
        text = node.text or ''
        if node.tag not in ('key', 'password', 'username'):
            text = text.strip()
        attrs = tuple(sorted((key, val.strip()) for key, val in node.attrib.items()))
        return (node.tag, attrs, text, tuple(sorted(signature(child) for child in node)))
    return signature(root)


def plan_import(encoder, values):
    """Resolve file ownership before an explicit upload; never write here."""
    _, services = parse_streaming_xml(values.get('xml'))
    incoming = {s['platform'] for s in services}
    files = rest(encoder, '/livestreams/customPlatforms') or []
    if not isinstance(files, list) or not all(isinstance(f, str) and f for f in files):
        raise ValueError('Could not read custom preset file inventory')
    owners, custom_names = [], set()
    from preset_management import _names
    for filename in files:
        try:
            names = set(_names(rest(encoder, '/livestreams/customPlatforms/' +
                                   urllib.parse.quote(filename, safe=''), raw_response=True)))
        except (ValueError, ET.ParseError):
            raise ValueError('Could not inspect existing preset files; upload cancelled') from None
        custom_names.update(names)
        if incoming & names:
            owners.append((filename, names))
    if len(owners) > 1:
        raise ValueError('Services belong to different custom files. Edit one file at a time or use new service names')
    platforms = rest(encoder, '/livestreams/platforms')
    if not isinstance(platforms, list):
        raise ValueError('Could not read the encoder service inventory')
    if incoming & (set(platforms) - custom_names):
        raise ValueError('A service name matches a built-in preset. Rename that service in the XML editor before sending')
    if owners:
        filename, existing = owners[0]
        if not existing <= incoming:
            raise ValueError('The existing XML file contains other services. Include them before replacing the file, or use a new service name')
    else:
        filename = 'GfC-Imported.xml'
        counter = 2
        while filename in files:
            filename = 'GfC-Imported-' + str(counter) + '.xml'
            counter += 1
    return {'filename': filename, 'services': [s['platform'] for s in services], 'replaces_existing': bool(owners)}


def apply_import(encoder, values):
    # XML names are trimmed during parsing; normalize selection values identically.
    values = dict(values)
    for field in ('platform', 'server', 'quality'):
        selected = values.get(field)
        if not isinstance(selected, str):
            raise ValueError('Select a service, server and quality profile from the imported XML')
        values[field] = selected.strip()
    text = values.get('xml')
    root, services = parse_streaming_xml(text)
    service = next((s for s in services if s['platform'] == values.get('platform')), None)
    if not service:
        raise ValueError('Select a service from the imported XML')
    source = next(s for s in root.findall('service') if _name(s, 'service') == service['platform'])
    server = next((s for s in source.findall('./servers/server') if _name(s, 'server') == values.get('server')), None)
    if server is None and (not service['customizable_url'] or service['servers'] or values.get('server') != 'Custom'):
        raise ValueError('Select a server from the imported XML')
    if not any(p['profile'] == values.get('quality') for p in service['profiles']):
        raise ValueError('Select a quality profile from the imported XML')
    url = (server.findtext('url') or '').strip() if server is not None else ''
    if service['customizable_url']:
        url = values.get('url', '').strip() or url
    _url(url)
    plan = plan_import(encoder, values)
    if values.get('filename') and values['filename'] != plan['filename']:
        raise ValueError('Preset file inventory changed. Review Send to encoder again')
    active = rest(encoder, '/livestreams/0/activePlatform')
    target = {'platform': service['platform'], 'server': values['server'], 'quality': values['quality'],
              'key': source.findtext('key') or active.get('key', '')}
    if service['customizable_url']:
        target['server'] = 'Custom'
        target['url'] = url
    # The XML specification does not define an SRT encryption passphrase element.
    # Preserve the current device value if one is available.
    if urllib.parse.urlsplit(url).scheme.lower() == 'srt' and active.get('passphrase'):
        target['passphrase'] = active['passphrase']
    if rest(encoder, '/livestreams/0')['status'] != 'Idle':
        raise ValueError('Stop the stream before importing XML settings')
    # Upload the complete document so other services, backups, per-format bitrates,
    # credentials and SRT extensions are retained.
    # Firmware requires blank lines to be removed from uploaded XML.
    upload = '\n'.join(line for line in text.splitlines() if line.strip()).encode('utf-8')
    try:
        rest(encoder, '/livestreams/customPlatforms/' + urllib.parse.quote(plan['filename'], safe=''),
             'PUT', upload, xml=True)
    except ValueError as exc:
        raise ValueError('XML upload failed; activation was not attempted. ' + str(exc)) from None
    # A 204 alone does not establish that the firmware published the new profiles.
    published = False
    for delay in (0, .25, .75):
        if delay:
            time.sleep(delay)
        try:
            stored = rest(encoder, '/livestreams/customPlatforms/' + urllib.parse.quote(plan['filename'], safe=''),
                          raw_response=True)
            saved_root, saved_services = parse_streaming_xml(stored.decode('utf-8-sig'))
            if xml_settings_signature(root) != xml_settings_signature(saved_root):
                continue
            saved = rest(encoder, '/livestreams/platforms/' + urllib.parse.quote(service['platform'], safe=''))
            selected_profile = next((p for p in saved.get('profiles', []) if p.get('profile') == values['quality']), None)
            if not selected_profile:
                continue
            expected_profile = next(p for p in service['profiles'] if p['profile'] == values['quality'])
            expected_modes = {(c['resolution'], float(c['fps']), c['codec'], c['bitrate'])
                              for c in expected_profile['configs']}
            actual_modes = {(c['resolution'], float(c['fps']), codec, c['bitrate'])
                            for c in selected_profile.get('configs', [])
                            for codec in c.get('videoCodecs') or ['H264']}
            if actual_modes != expected_modes:
                continue
            published = True
            break
        except (ValueError, AttributeError, UnicodeError, KeyError, TypeError):
            pass
    if not published:
        raise ValueError('Upload was sent, but the encoder did not confirm the XML file and selected profile. Activation was not attempted; review the preset list before retrying')
    if rest(encoder, '/livestreams/0')['status'] != 'Idle':
        raise ValueError('XML uploaded but the stream became active; preset selection was not changed')
    try:
        rest(encoder, '/livestreams/0/activePlatform', 'PUT', target)
    except ValueError as exc:
        raise ValueError('XML file uploaded, but activating the selected service/server/profile failed. ' + str(exc)) from None
    for delay in (0, .25, .75):
        if delay:
            time.sleep(delay)
        try:
            actual = rest(encoder, '/livestreams/0/activePlatform')
            if all((actual.get(k) or '') == (v or '') for k, v in target.items()):
                return {'message': 'XML file, selected profile and active settings verified on the encoder. Stream remains stopped.',
                        'filename': plan['filename'], 'platform': target['platform'], 'quality': target['quality']}
        except ValueError:
            pass
    return {'message': 'Encoder accepted the XML; preset selection read-back is unconfirmed. Reopen Settings to check.',
            'verification': 'unconfirmed'}
