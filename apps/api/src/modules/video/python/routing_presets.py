"""Named Videohub routing snapshots, stored locally and exported as JSON or BMD protocol text."""
import hashlib
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import threading
import time
import uuid

ROOT = Path(os.environ['STREAMING_STATE_DIR']) / 'routing-presets'
LOCK = threading.RLock()
FORMAT = 'gfc-videohub-routing'
MAX_BYTES = 262144
MAX_PRESETS = 20


def name(value):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > 80 or any(ord(c) < 32 for c in value):
        raise ValueError('Enter a preset name of 1 to 80 characters')
    return value.strip()


def validate(preset):
    if not isinstance(preset, dict) or preset.get('format') != FORMAT or preset.get('version') != 1:
        raise ValueError('Unsupported routing preset format')
    preset['name'] = name(preset.get('name'))
    for key in ('input_count', 'output_count'):
        if isinstance(preset.get(key), bool) or not isinstance(preset.get(key), int) or not 1 <= preset[key] <= 512:
            raise ValueError('Invalid routing preset dimensions')
    routes = preset.get('routes')
    if (not isinstance(routes, list) or len(routes) != preset['output_count']
            or any(isinstance(i, bool) or not isinstance(i, int) or not 0 <= i < preset['input_count'] for i in routes)):
        raise ValueError('Invalid routing preset crosspoints')
    for key, count in [('inputs', preset['input_count']), ('outputs', preset['output_count'])]:
        labels = preset.get(key)
        if not isinstance(labels, list) or len(labels) != count or any(not isinstance(s, str) or len(s) > 512 for s in labels):
            raise ValueError('Invalid routing preset labels')
    return preset


def snapshot(name_, state):
    if not state.get('connected'):
        raise ValueError('Connect to the Videohub before saving a preset')
    return validate({'format': FORMAT, 'version': 1, 'name': name(name_), 'saved_at': time.time(),
                     'model': str(state.get('model', 'Videohub'))[:256],
                     'input_count': len(state['inputs']), 'output_count': len(state['outputs']),
                     'inputs': list(state['inputs']), 'outputs': list(state['outputs']), 'routes': list(state['routes'])})


def path_for(id_):
    if not isinstance(id_, str) or not re.fullmatch(r'[a-f0-9]{32}', id_):
        raise ValueError('Invalid preset identifier')
    folder = ROOT.resolve()
    path = folder / (id_ + '.json')
    if path.is_symlink() or path.resolve().parent != folder:
        raise ValueError('Invalid preset path')
    return path


def read(site, device, id_):
    with LOCK:
        path = path_for(id_)
        if not path.exists() or path.stat().st_size > MAX_BYTES:
            raise ValueError('Routing preset was not found or is too large')
        raw = path.read_bytes()
        try:
            preset = validate(json.loads(raw))
        except (ValueError, UnicodeError, TypeError):
            raise ValueError('Routing preset file is invalid') from None
        if preset.get('site') != site or preset.get('device') != device:
            raise ValueError('Routing preset belongs to a different Videohub')
        return preset, hashlib.sha256(raw).hexdigest()


def list_presets(site, device):
    result = []
    with LOCK:
        if not ROOT.exists():
            return result
        for path in ROOT.glob('*.json'):
            try:
                preset, revision = read(site, device, path.stem)
                result.append({'id': path.stem, 'name': preset['name'], 'saved_at': preset['saved_at'],
                               'input_count': preset['input_count'], 'output_count': preset['output_count'], 'revision': revision})
            except (OSError, ValueError, KeyError, TypeError):
                continue
    return sorted(result, key=lambda p: p['name'].casefold())


def storage_status(limit=MAX_PRESETS):
    with LOCK:
        count = sum(1 for path in ROOT.glob('*.json')
                    if re.fullmatch(r'[a-f0-9]{32}', path.stem) and path.is_file() and not path.is_symlink()) if ROOT.exists() else 0
        return {'stored_count': count, 'limit': limit}


def catalog(site, device, limit=MAX_PRESETS):
    with LOCK:
        return dict(storage_status(limit), presets=list_presets(site, device))


def save(site, device, preset, replace_id=None, revision=None, limit=MAX_PRESETS):
    preset = validate(dict(preset))
    with LOCK:
        if replace_id is not None:
            raise ValueError('Replacing routing presets is disabled. Delete the old preset or choose a new name')
        entries = list_presets(site, device)
        if any(p['name'].casefold() == preset['name'].casefold() for p in entries):
            raise ValueError('A routing preset with this name already exists. Choose a new name or delete it first')
        if storage_status(limit)['stored_count'] >= limit:
            raise ValueError('Routing preset limit reached (' + str(limit) + '). Delete a preset before saving another, or export current routing')
        id_ = uuid.uuid4().hex
        saved_at = time.time()
        preset.update(site=site, device=device, saved_at=saved_at,
                      saved_at_utc=datetime.fromtimestamp(saved_at, timezone.utc).isoformat())
        raw = (json.dumps(preset, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
        if len(raw) > MAX_BYTES:
            raise ValueError('Routing preset is too large')
        ROOT.mkdir(parents=True, exist_ok=True)
        destination = path_for(id_)
        if destination.exists():
            raise ValueError('Preset identifier already exists; no file was replaced')
        temporary = ROOT / ('.' + uuid.uuid4().hex + '.tmp')
        try:
            with temporary.open('xb') as stream:
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            os.rename(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)
        return dict(catalog(site, device, limit), id=id_, name=preset['name'])


def delete(site, device, id_, revision, confirmed, limit=MAX_PRESETS):
    if confirmed is not True:
        raise ValueError('Confirm deletion of the saved routing preset')
    with LOCK:
        preset, actual_revision = read(site, device, id_)
        if actual_revision != revision:
            raise ValueError('Preset file changed; refresh the presets before deleting it')
        path_for(id_).unlink()
        return dict(catalog(site, device, limit), message='Saved routing preset deleted. Current routing is unchanged.')


def export(preset, format_):
    if format_ == 'bmd-text':
        content = 'VIDEO OUTPUT ROUTING:\n' + ''.join(f'{o} {i}\n' for o, i in enumerate(preset['routes'])) + '\n'
        return {'content': content, 'extension': '.txt', 'content_type': 'text/plain;charset=utf-8'}
    if format_ == 'json':
        clean = {k: v for k, v in preset.items() if k not in ('site', 'device')}
        return {'content': json.dumps(clean, ensure_ascii=False, indent=2) + '\n', 'extension': '.json',
                'content_type': 'application/json;charset=utf-8'}
    raise ValueError('Select a valid preset export format')


def import_file(text, name_, device):
    if not isinstance(text, str) or len(text.encode('utf-8')) > MAX_BYTES:
        raise ValueError('Choose a routing preset file of 256 KB or smaller')
    text = text.lstrip('\ufeff').strip()
    if text.startswith('{'):
        try:
            preset = validate(json.loads(text))
        except (ValueError, TypeError, KeyError):
            raise ValueError('Invalid routing preset JSON') from None
        preset['name'] = name(name_ or preset['name'])
    else:
        # Only parse integer crosspoints. Never execute imported text as commands.
        lines = text.splitlines()
        if not lines or lines[0].strip() != 'VIDEO OUTPUT ROUTING:':
            raise ValueError('Use an application JSON preset or Blackmagic VIDEO OUTPUT ROUTING text file')
        routes = {}
        for line in lines[1:]:
            if not line.strip():
                continue
            match = re.fullmatch(r'\s*(\d+)\s+(\d+)\s*', line)
            if not match or int(match[1]) in routes:
                raise ValueError('Invalid or duplicate routing preset crosspoint')
            routes[int(match[1])] = int(match[2])
        n, m = device.get('inputs', 40), device.get('outputs', 40)
        if set(routes) != set(range(m)):
            raise ValueError('The routing text must contain every output exactly once')
        preset = snapshot(name_, {'connected': True, 'model': device.get('name', 'Videohub'),
                                 'inputs': ['Input ' + str(i+1) for i in range(n)],
                                 'outputs': ['Output ' + str(o+1) for o in range(m)],
                                 'routes': [routes[o] for o in range(m)]})
    if preset['input_count'] != device.get('inputs', 40) or preset['output_count'] != device.get('outputs', 40):
        raise ValueError('Preset dimensions do not match this Videohub')
    return preset


def preview(preset, state):
    if not state.get('connected') or len(state['inputs']) != preset['input_count'] or len(state['outputs']) != preset['output_count']:
        raise ValueError('Preset dimensions do not match the connected Videohub')
    changes = [{'output': o, 'output_label': state['outputs'][o], 'from_input': state['routes'][o],
                'from_label': state['inputs'][state['routes'][o]], 'to_input': i, 'to_label': state['inputs'][i],
                'locked': state['locks'][o] != 'U'} for o, i in enumerate(preset['routes']) if state['routes'][o] != i]
    return {'changes': changes, 'expected_routes': state['routes'], 'state': state}
