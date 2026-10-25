"""Blackmagic REST settings editor. No writes occur until Apply is requested."""
import json
import math
import time
import urllib.parse
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET


def rest(encoder, path, method='GET', data=None, xml=False, timeout=5, raw_response=False):
    body = data if xml else json.dumps(data).encode() if data is not None else None
    request = urllib.request.Request('http://' + encoder['ip'] + '/control/api/v1' + path,
        data=body, method=method, headers={'Content-Type': 'application/xml' if xml else 'application/json'})
    try:
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=timeout) as response:
            raw = response.read(2_000_000)
        return raw if raw_response else json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        raise ValueError('Encoder settings API request failed (HTTP ' + str(exc.code) + ')') from None
    except Exception as exc:
        # URLs and device error bodies can contain stream credentials.
        raise ValueError('Encoder settings API request failed (' + type(exc).__name__ + ')') from None


def read_stream_summary(encoder, timeout):
    """Small public summary; never return full keys, credentials or URL paths."""
    active = rest(encoder, '/livestreams/0/activePlatform', timeout=timeout)
    platform = None
    if not active.get('url') or not active.get('key'):
        platform = rest(encoder, '/livestreams/platforms/' + urllib.parse.quote(active['platform'], safe=''),
                        timeout=timeout)
    server = next((s for s in (platform or {}).get('servers', []) if s['server'] == active['server']), {})
    url = active.get('url') or server.get('url', '')
    parsed = urllib.parse.urlsplit(url)
    endpoint = ''
    if parsed.hostname and parsed.scheme.lower() in ('rtmp', 'rtmps', 'srt'):
        host = '[' + parsed.hostname + ']' if ':' in parsed.hostname else parsed.hostname
        endpoint = parsed.scheme.lower() + '://' + host + (':' + str(parsed.port) if parsed.port else '')
    key = active.get('key') or (platform or {}).get('key') or ''
    if not isinstance(key, str):
        key = ''
    # Short keys must not be disclosed in their entirety.
    masked = '*****' + key[-4:] if len(key) > 4 else '*' * len(key)
    return {'available': True, 'platform': active['platform'], 'quality': active.get('quality', ''),
            'server': endpoint, 'server_name': active.get('server', ''), 'key_masked': masked, 'has_key': bool(key), 'checked_at': time.time()}


def read_settings(encoder):
    active = rest(encoder, '/livestreams/0/activePlatform')
    platform = rest(encoder, '/livestreams/platforms/' + urllib.parse.quote(active['platform'], safe=''))
    server = next((s for s in platform['servers'] if s['server'] == active['server']), {})
    url = active.get('url') or server.get('url', '')
    # Keep credentials out of read responses and DOM by default.
    parsed = urllib.parse.urlsplit(url)
    url = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc.split('@')[-1], parsed.path, '', ''))
    return {'platform': active['platform'], 'server': active.get('server', ''), 'quality': active['quality'], 'url': url,
            'protocol': parsed.scheme.lower(), 'has_key': bool(active.get('key')),
            'profiles': platform['profiles'], 'status': rest(encoder, '/livestreams/0')['status'],
            'presets': rest(encoder, '/livestreams/platforms'),
            'customizable_url': bool(platform.get('customizableUrlEnabled'))}


def apply_settings(encoder, values):
    """Update the active configuration without creating or replacing presets."""
    protocol = values.get('protocol', '').lower()
    url = values.get('url', '').strip()
    try:
        parsed = urllib.parse.urlsplit(url)
        parsed.port
    except ValueError:
        raise ValueError('Provide a valid destination URL') from None
    if protocol not in ('rtmp', 'rtmps', 'srt') or parsed.scheme.lower() != protocol or not parsed.hostname:
        raise ValueError('Provide a valid destination URL matching RTMP, RTMPS or SRT')
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('Use a URL without embedded credentials, query parameters or fragments; use the key/passphrase fields')
    if any(c in url for c in '\r\n'):
        raise ValueError('Invalid destination URL')
    active = rest(encoder, '/livestreams/0/activePlatform')
    platform = rest(encoder, '/livestreams/platforms/' + urllib.parse.quote(active['platform'], safe=''))
    profile = next((p for p in platform['profiles'] if p['profile'] == values.get('quality')), None)
    if not profile or not profile.get('configs'):
        raise ValueError('Select a quality profile supported by this encoder')
    # Old clients must not silently create a preset or flatten per-mode bitrate rules.
    if 'bitrate_mbps' in values:
        try:
            bitrate = float(values['bitrate_mbps']) * 1_000_000
            if not math.isfinite(bitrate) or bitrate != profile['configs'][0]['bitrate']:
                raise ValueError()
        except (ValueError, TypeError, KeyError):
            raise ValueError('Edit profile bitrates in BMD Streaming XML Tool; no settings were changed') from None
    server = next((s for s in platform.get('servers', []) if s['server'] == active.get('server')), {})
    target = {'platform': active['platform'], 'quality': profile['profile'],
              'server': active.get('server', ''),
              'key': values.get('key') or active.get('key') or platform.get('key', '')}
    if platform.get('customizableUrlEnabled'):
        target.update(server='Custom', url=url)
    elif url != server.get('url', ''):
        raise ValueError('This preset has a fixed server URL. Edit its XML or select another preset; no settings were changed')
    if protocol == 'srt':
        target['passphrase'] = values.get('passphrase') or active.get('passphrase', '')
    if rest(encoder, '/livestreams/0')['status'] != 'Idle':
        raise ValueError('Stop the stream before changing settings')
    rest(encoder, '/livestreams/0/activePlatform', 'PUT', target)
    for delay in (0, .25, .75):
        if delay:
            time.sleep(delay)
        try:
            actual = rest(encoder, '/livestreams/0/activePlatform')
            if all((actual.get(k) or '') == (v or '') for k, v in target.items()):
                return {'message': 'Encoder settings saved and verified. Existing preset retained. Stream remains stopped.'}
        except ValueError:
            pass
    return {'message': 'Settings were sent but read-back did not confirm them. Reopen Settings to check before retrying.',
            'verification': 'unconfirmed'}



def _preset_deletion_info(encoder, name):
    from preset_management import preset_deletion_info
    return preset_deletion_info(encoder, name)


def read_preset(encoder, values):
    name = values.get('platform')
    if not isinstance(name, str) or not name:
        raise ValueError('Select an encoder preset')
    platform = rest(encoder, '/livestreams/platforms/' + urllib.parse.quote(name, safe=''))
    servers = []
    for server in platform.get('servers', []):
        parsed = urllib.parse.urlsplit(server.get('url', ''))
        url = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc.split('@')[-1], parsed.path, '', ''))
        servers.append({'server': server['server'], 'url': url})
    return {'platform': name, 'servers': servers, 'profiles': platform.get('profiles', []),
            'default_quality': platform.get('defaultProfile'), 'has_key': bool(platform.get('key')),
            'deletion': _preset_deletion_info(encoder, name)}


def apply_preset(encoder, values):
    name = values.get('platform')
    if not isinstance(name, str) or not name:
        raise ValueError('Select an encoder preset')
    platform = rest(encoder, '/livestreams/platforms/' + urllib.parse.quote(name, safe=''))
    server = next((s for s in platform.get('servers', []) if s['server'] == values.get('server')), None)
    profile = next((p for p in platform.get('profiles', []) if p['profile'] == values.get('quality')), None)
    if server is None or profile is None:
        raise ValueError('Select a server and quality supported by this preset')
    active = rest(encoder, '/livestreams/0/activePlatform')
    # Recheck immediately before writing; selecting a preset never starts a stream.
    if rest(encoder, '/livestreams/0')['status'] != 'Idle':
        raise ValueError('Stop the stream before changing presets')
    target = {'platform': name, 'server': server['server'], 'quality': profile['profile'],
              'key': platform.get('key') or active.get('key', '')}
    url = server.get('url', '')
    if platform.get('customizableUrlEnabled'):
        target['server'] = 'Custom'
        target['url'] = url or active.get('url', '')
    if urllib.parse.urlsplit(url or target.get('url', '')).scheme.lower() == 'srt':
        target['passphrase'] = platform.get('passphrase') or active.get('passphrase', '')
    rest(encoder, '/livestreams/0/activePlatform', 'PUT', target)
    for delay in (0, .25, .75):
        if delay:
            time.sleep(delay)
        try:
            actual = rest(encoder, '/livestreams/0/activePlatform')
            if all((actual.get(k) or '') == (v or '') for k, v in target.items()):
                return {'message': 'Encoder preset applied and verified. Stream remains stopped.'}
        except ValueError:
            pass
    return {'message': 'Encoder accepted the preset; read-back is unconfirmed. Reopen Settings to check.',
            'verification': 'unconfirmed'}


def export_settings(encoder, values):
    from streaming_xml import platform_xml
    active = rest(encoder, '/livestreams/0/activePlatform')
    platform = rest(encoder, '/livestreams/platforms/' + urllib.parse.quote(active['platform'], safe=''))
    text = platform_xml(active, platform, values.get('include_secrets') is True)
    return {'format': 'blackmagic-streaming-xml', 'xml': text,
            'passphrase_omitted': bool(active.get('passphrase'))}
