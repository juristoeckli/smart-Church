"""Delete explicitly confirmed custom preset files, never built-in or active presets."""
import re
import time
import urllib.parse
import xml.etree.ElementTree as ET

from encoder_settings import rest


def _names(raw):
    if not isinstance(raw, bytes) or len(raw) > 2_000_000 or re.search(br'<!\s*(DOCTYPE|ENTITY)\b', raw, re.I):
        raise ValueError('Invalid custom preset XML')
    root = ET.fromstring(raw)
    names = [(s.findtext('name') or '').strip() for s in root.findall('service')]
    if root.tag != 'streaming' or not names or not all(names) or len(names) != len(set(names)):
        raise ValueError('Invalid custom preset XML')
    return names


def preset_deletion_info(encoder, platform):
    unavailable = {'allowed': False, 'reason': 'Custom preset files could not be read; deletion unavailable'}
    try:
        files = rest(encoder, '/livestreams/customPlatforms')
        if not isinstance(files, list) or not all(isinstance(f, str) and f for f in files):
            return unavailable
        matches = []
        for filename in files:
            raw = rest(encoder, '/livestreams/customPlatforms/' + urllib.parse.quote(filename, safe=''),
                       raw_response=True)
            names = _names(raw)
            if platform in names:
                matches.append({'filename': filename, 'services': names})
        if not matches:
            return {'allowed': False, 'reason': 'Built-in presets cannot be deleted'}
        if len(matches) != 1:
            return {'allowed': False, 'reason': 'Preset belongs to more than one custom file; deletion unavailable'}
        info = matches[0]
        active = rest(encoder, '/livestreams/0/activePlatform')
        if active.get('platform') in info['services']:
            return dict(info, allowed=False, reason='Switch to another preset before deleting this file')
        return dict(info, allowed=True, reason='')
    except (OSError, ValueError, TypeError, KeyError, ET.ParseError):
        return unavailable


def delete_preset(encoder, values):
    if values.get('confirmed') is not True:
        raise ValueError('Preset deletion requires confirmation')
    platform = values.get('platform')
    if not isinstance(platform, str) or not platform:
        raise ValueError('Select an encoder preset')
    info = preset_deletion_info(encoder, platform)
    if not info['allowed']:
        raise ValueError(info['reason'])
    expected = values.get('expected_services')
    if (values.get('filename') != info['filename'] or not isinstance(expected, list)
            or not all(isinstance(name, str) for name in expected)
            or len(expected) != len(info['services']) or set(expected) != set(info['services'])):
        raise ValueError('Preset file changed; select it again and review deletion')
    active = rest(encoder, '/livestreams/0/activePlatform')
    if active.get('platform') in info['services']:
        raise ValueError('Switch to another preset before deleting this file')
    if rest(encoder, '/livestreams/0')['status'] != 'Idle':
        raise ValueError('Stop the stream before deleting presets')
    path = '/livestreams/customPlatforms/' + urllib.parse.quote(info['filename'], safe='')
    try:
        rest(encoder, path, 'DELETE')
    except ValueError:
        raise ValueError('Deletion outcome uncertain. Reload presets before trying again.') from None
    # Never repeat a DELETE after a timeout or ambiguous read-back.
    for delay in (0, .25, .75):
        if delay:
            time.sleep(delay)
        try:
            files = rest(encoder, '/livestreams/customPlatforms')
            if isinstance(files, list) and info['filename'] not in files:
                return {'message': 'Custom preset file deleted and verified. Stream remains stopped.'}
        except ValueError:
            pass
    return {'message': 'Encoder accepted deletion; removal is unconfirmed. Reload presets before trying again.',
            'verification': 'unconfirmed'}
