"""Local livestream controller. Python 3.10+, standard library only."""
import concurrent.futures
import copy
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import threading
import time
import urllib.request
from unifi_monitor import poll_unifi, safe_error
from encoder_settings import read_settings, apply_settings, read_preset, apply_preset, export_settings, read_stream_summary

from streaming_xml import plan_import, preview_import, apply_import
from shelly_monitor import read_relay
from preset_management import delete_preset
from videohub import mutate as videohub_mutate, request as videohub_request
import routing_presets
from routing_history import RoutingHistory, EXTERNAL

DEVICE_ADDRESS_OVERRIDES = {}
DEVICE_ADDRESS_OVERRIDES_LOCK = threading.Lock()

def set_device_address_overrides(department_id, addresses):
    if not isinstance(addresses, list) or len(addresses) > 500:
        raise ValueError('Invalid device address settings')
    normalized = []
    seen = set()
    for item in addresses:
        if not isinstance(item, dict):
            raise ValueError('Invalid device address setting')
        site_id = item.get('siteId')
        target_type = item.get('targetType')
        target_id = item.get('targetId', '')
        address = item.get('ip')
        if (not isinstance(site_id, str) or not site_id or len(site_id) > 80 or
                target_type not in ('router', 'encoder', 'device') or
                not isinstance(target_id, str) or len(target_id) > 80 or
                not isinstance(address, str) or len(address) > 45):
            raise ValueError('Invalid device address setting')
        if address:
            try:
                ipaddress.ip_address(address)
            except ValueError:
                raise ValueError('Enter a valid IP address') from None
        key = (site_id, target_type, target_id)
        if key in seen:
            raise ValueError('Duplicate device address setting')
        seen.add(key)
        normalized.append({'siteId': site_id, 'targetType': target_type, 'targetId': target_id, 'ip': address})
    with DEVICE_ADDRESS_OVERRIDES_LOCK:
        DEVICE_ADDRESS_OVERRIDES[department_id] = normalized

def apply_device_address_overrides(config):
    with DEVICE_ADDRESS_OVERRIDES_LOCK:
        overrides = copy.deepcopy(DEVICE_ADDRESS_OVERRIDES)
    for site in config.get('sites', []):
        department_id = site.get('department_id')
        if department_id not in overrides:
            continue
        for item in overrides[department_id]:
            if item['siteId'] != site.get('id'):
                continue
            if item['targetType'] == 'router' and not item['targetId']:
                site['router_ip'] = item['ip']
                continue
            collection = 'encoders' if item['targetType'] == 'encoder' else 'devices'
            target = next((entry for entry in site.get(collection, []) if entry.get('id') == item['targetId']), None)
            if target:
                target['ip'] = item['ip']

def load_config():
    config = json.loads(Path(os.environ['STREAMING_CONFIG_FILE']).read_text(encoding='utf-8-sig'))
    for site in config.get('sites', []):
        if site.get('department_id') == '$SMART_CHURCH_DEPARTMENT_ID':
            site['department_id'] = os.environ.get('SMART_CHURCH_DEPARTMENT_ID', '00000000-0000-4000-8000-000000000001')
    apply_device_address_overrides(config)
    site_order = {'gfc-steffisburg': 0, 'main': 1, 'sonnenhof': 2}
    config.get('sites', []).sort(key=lambda site: (site_order.get(site.get('id'), len(site_order)), (site.get('name') or '').casefold()))
    for key, default, minimum, maximum in [('poll_interval_seconds', 5, 1, 300), ('timeout_seconds', 2, .2, 30)]:
        value = config.setdefault(key, default)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not minimum <= value <= maximum:
            raise ValueError(f'{key} must be between {minimum} and {maximum}')
    preset_config = config.setdefault('routing_presets', {})
    history_config = config.setdefault('routing_history', {})
    if not isinstance(history_config, dict):
        raise ValueError('routing_history must be an object')
    window = history_config.setdefault('merge_window_minutes', 5)
    if isinstance(window, bool) or not isinstance(window, (int, float)) or not 0 <= window <= 1440:
        raise ValueError('routing_history.merge_window_minutes must be between 0 and 1440')
    if not isinstance(preset_config, dict):
        raise ValueError('routing_presets must be an object')
    preset_limit = preset_config.setdefault('max_presets', 20)
    if isinstance(preset_limit, bool) or not isinstance(preset_limit, int) or preset_limit < 1:
        raise ValueError('routing_presets.max_presets must be a positive integer')
    ids = set()
    for site in config['sites']:
        if not site.get('id') or site['id'] in ids:
            raise ValueError('Site IDs must be unique and nonempty')
        ids.add(site['id'])
        department_id = site.get('department_id')
        if department_id is not None:
            if not isinstance(department_id, str) or not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', department_id, re.I):
                raise ValueError('Each department_id must be a valid location UUID')
        site.setdefault('router_ip', '')
        enc_ids = set()
        for encoder in site['encoders']:
            if not encoder.get('id') or encoder['id'] in enc_ids:
                raise ValueError('Encoder IDs must be unique within a site')
            enc_ids.add(encoder['id'])
            encoder.setdefault('ip', '')
            port = encoder.setdefault('port', 9977)
            if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
                raise ValueError('Encoder port must be an integer from 1 to 65535')
        device_ids = set()
        for device in site.setdefault('devices', []):
            if not device.get('id') or device['id'] in device_ids:
                raise ValueError('Device IDs must be unique within a site')
            device_ids.add(device['id'])
            device.setdefault('ip', '')
            if device.get('type') == 'videohub':
                device.setdefault('port', 9990)
            if device.get('type') == 'webpresenter':
                device.setdefault('port', 9977)
            if device.get('type') == 'streamingbridge':
                port = device.setdefault('port', 1935)
                if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
                    raise ValueError('Streaming Bridge port must be an integer from 1 to 65535')
                status_port = device.setdefault('status_port', 9977)
                if isinstance(status_port, bool) or not isinstance(status_port, int) or not 1 <= status_port <= 65535:
                    raise ValueError('Streaming Bridge status_port must be an integer from 1 to 65535')
        for address in [site['router_ip']] + [e['ip'] for e in site['encoders']] + [d['ip'] for d in site['devices']]:
            if not isinstance(address, str) or (address and (address.startswith('-') or any(c.isspace() for c in address))):
                raise ValueError('Addresses must be IP addresses or hostnames without whitespace')
    return config


def ping(host, timeout):
    if not host:
        return 'Not configured'
    args = ['ping', '-n', '1', '-w', str(int(timeout * 1000)), host] if os.name == 'nt' else ['ping', '-c', '1', '-W', str(max(1, int(timeout))), host]
    try:
        result = subprocess.run(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            timeout=timeout + 1, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        return 'Reachable' if result.returncode == 0 else 'No ping reply'
    except (OSError, subprocess.TimeoutExpired):
        return 'No ping reply'


def tcp_listener(host, port, timeout):
    """Check whether the configured Streaming Bridge input port accepts TCP."""
    if not host:
        return 'Not configured'
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return 'Listening'
    except ConnectionRefusedError:
        return 'Connection refused'
    except (OSError, socket.timeout):
        return 'No response'


class Protocol:
    def __init__(self, sock, timeout):
        self.sock, self.timeout, self.buffer = sock, timeout, b''

    def block(self, deadline):
        while True:
            # Normalize CRLF only after complete lines have arrived.
            normalized = self.buffer.replace(b'\r\n', b'\n')
            if b'\n\n' in normalized:
                raw, self.buffer = normalized.split(b'\n\n', 1)
                lines = raw.decode('utf-8', errors='replace').splitlines()
                fields = dict(line.split(':', 1) for line in lines[1:] if ':' in line)
                return lines[0].rstrip(':'), {k.strip(): v.strip() for k, v in fields.items()}
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError('Encoder response timed out')
            self.sock.settimeout(remaining)
            chunk = self.sock.recv(16384)
            if not chunk:
                raise ConnectionError('Encoder closed the connection')
            self.buffer += chunk
            if len(self.buffer) > 2_000_000:
                raise ValueError('Encoder response too large')


def encoder_request(encoder, timeout, action=None):
    with socket.create_connection((encoder['ip'], encoder['port']), timeout) as sock:
        protocol = Protocol(sock, timeout)
        deadline = time.monotonic() + timeout
        state = {}
        while True:
            header, fields = protocol.block(deadline)
            if header == 'STREAM STATE':
                state.update(fields)
            if header == 'END PRELUDE':
                break
        command = f'STREAM STATE:\nAction: {action}\n\n' if action else 'STREAM STATE:\n\n'
        sock.sendall(command.encode('ascii'))
        deadline = time.monotonic() + timeout
        acknowledged = False
        while True:
            header, fields = protocol.block(deadline)
            if header == 'NACK':
                raise ValueError('Encoder rejected the command')
            if header == 'ACK':
                acknowledged = True
                if action:
                    # ACK is acceptance, not proof that the stream is live.
                    return {'command': f'{action} accepted; waiting for device status'}
            if header == 'STREAM STATE':
                state.update(fields)
                if acknowledged:
                    return state


class Controller:
    def __init__(self):
        self.config = load_config()
        self.snapshot = {'sites': [], 'error': None, 'updated': None}
        self.lock = threading.Lock()
        self.command_locks = {}
        self.live_encoder_states = {}
        self.videohub_states = {}
        self.routing_history = RoutingHistory(os.environ.get('STREAMING_STATE_DIR') or str(Path(os.environ['STREAMING_CONFIG_FILE']).parent),
                                             self.config.get('routing_history', {}).get('merge_window_minutes', 5) * 60)
        self.live_pool = concurrent.futures.ThreadPoolExecutor(max_workers=8)
        self.restart_until = {}
        self.restart_cycles = {}
        self.vpn_status = {'state': 'starting', 'error': None}
        self.vpn_tunnels = []
        self.pool = concurrent.futures.ThreadPoolExecutor(max_workers=24)

    def device_lock(self, encoder):
        with self.lock:
            return self.command_locks.setdefault((encoder['ip'], encoder['port']), threading.Lock())

    def poll_videohubs(self):
        while True:
            try:
                config = load_config()
                for site in config['sites']:
                    for device in site['devices']:
                        if device.get('type') != 'videohub' or not device['ip']:
                            continue
                        key = site['id'] + '|' + device['id']
                        with self.device_lock(device):
                            try:
                                state = videohub_request(device, config['timeout_seconds'])
                                self.routing_history.observe(key, state)
                            except (OSError, ValueError) as exc:
                                state = {'connected': False, 'checked_at': time.time(), 'error': str(exc)}
                                self.routing_history.observe(key, state)
                            with self.lock:
                                self.videohub_states[key] = state
            except (OSError, ValueError, KeyError):
                pass
            time.sleep(2)

    def route_videohub(self, data):
        if any(isinstance(data.get(k), bool) or not isinstance(data.get(k), int) for k in ('input', 'output', 'expected_input')):
            raise ValueError('Select a valid input and output')
        config = load_config()
        site = next((s for s in config['sites'] if s['id'] == data.get('site')), None)
        device = next((d for d in site['devices'] if d['id'] == data.get('device') and d.get('type') == 'videohub'), None) if site else None
        if not device or not device['ip']:
            raise ValueError('Videohub is not configured')
        with self.device_lock(device):
            key = site['id'] + '|' + device['id']
            state = videohub_request(device, config['timeout_seconds'], output=data.get('output'),
                                     input_=data.get('input'), expected=data.get('expected_input'),
                                     observe=lambda before: self.routing_history.observe(key, before))
            self.routing_history.observe(key, state, data.get('actor', EXTERNAL), [data['output']])
            with self.lock:
                self.videohub_states[site['id'] + '|' + device['id']] = state
        return {'message': 'Videohub route changed and verified', 'state': state}

    def videohub_history(self, data):
        config = load_config()
        site = next((s for s in config['sites'] if s['id'] == data.get('site')), None)
        if not site or not any(d['id'] == data.get('device') and d.get('type') == 'videohub' for d in site['devices']):
            raise ValueError('Videohub is not configured')
        return self.routing_history.read(site['id'] + '|' + data['device'])

    def videohub_presets(self, data):
        config = load_config()
        site = next((s for s in config['sites'] if s['id'] == data.get('site')), None)
        device = next((d for d in site['devices'] if d['id'] == data.get('device') and d.get('type') == 'videohub'), None) if site else None
        if not device:
            raise ValueError('Videohub is not configured')
        operation = data.get('operation')
        preset_limit = config.get('routing_presets', {}).get('max_presets', 20)
        if operation in ('rename', 'lock'):
            if operation == 'rename':
                kind = data.get('kind')
                if kind not in ('input', 'output'):
                    raise ValueError('Select an input or output')
                field = 'inputs' if kind == 'input' else 'outputs'
                index, value, expected = data.get('index'), data.get('name'), data.get('expected_name')
                message = f'{kind.title()} name changed and verified'
            else:
                field = 'locks'
                index, value, expected = data.get('output'), data.get('locked'), data.get('expected_lock')
                message = 'Output lock changed and verified'
            with self.device_lock(device):
                key = site['id'] + '|' + device['id']
                state = videohub_mutate(device, config['timeout_seconds'], field=field, index=index,
                                        value=value, expected=expected,
                                        observe=lambda before: self.routing_history.observe(key, before))
                self.routing_history.observe(key, state, data.get('actor', EXTERNAL))
                with self.lock:
                    self.videohub_states[key] = state
            return {'message': message, 'state': state}
        if operation == 'list':
            return routing_presets.catalog(site['id'], device['id'], preset_limit)
        if operation == 'delete':
            return routing_presets.delete(site['id'], device['id'], data.get('id'), data.get('revision'), data.get('confirmed'), limit=preset_limit)
        if operation == 'import':
            preset = routing_presets.import_file(data.get('content'), data.get('name'), device)
            return routing_presets.save(site['id'], device['id'], preset, data.get('replace_id'), data.get('revision'), limit=preset_limit)
        if operation in ('save', 'export-current'):
            with self.device_lock(device):
                state = videohub_request(device, config['timeout_seconds'])
            preset = routing_presets.snapshot(data.get('name') if operation == 'save' else 'Routing', state)
            if operation == 'export-current':
                return dict(routing_presets.export(preset, data.get('format')), name=preset['name'])
            return routing_presets.save(site['id'], device['id'], preset, data.get('replace_id'), data.get('revision'), limit=preset_limit)
        preset, revision = routing_presets.read(site['id'], device['id'], data.get('id'))
        if operation == 'export':
            return dict(routing_presets.export(preset, data.get('format')), name=preset['name'])
        if operation == 'preview':
            with self.device_lock(device):
                state = videohub_request(device, config['timeout_seconds'])
            return dict(routing_presets.preview(preset, state), name=preset['name'], revision=revision)
        if operation == 'recall':
            if data.get('confirmed') is not True:
                raise ValueError('Confirm the routing preset recall')
            if revision != data.get('revision'):
                raise ValueError('Preset file changed; review the recall again')
            with self.device_lock(device):
                key = site['id'] + '|' + device['id']
                state = videohub_request(device, config['timeout_seconds'], routes=preset['routes'],
                                         expected_routes=data.get('expected_routes'),
                                         observe=lambda before: self.routing_history.observe(key, before))
                self.routing_history.observe(key, state, data.get('actor', EXTERNAL), range(len(preset['routes'])))
                with self.lock:
                    self.videohub_states[site['id'] + '|' + device['id']] = state
            return {'message': 'Routing preset recalled and verified', 'state': state}
        raise ValueError('Invalid routing preset operation')

    def poll_vpn(self):
        while True:
            delay = 60
            try:
                config = load_config()
                delay = max(5, min(300, float(config.get('unifi', {}).get('poll_interval_seconds', 60))))
                status, tunnels = poll_unifi(config)
                with self.lock:
                    self.vpn_status, self.vpn_tunnels = status, tunnels
            except Exception as exc:
                if getattr(exc, 'code', None) == 429:
                    try:
                        delay = max(delay, min(3600, float(exc.headers.get('Retry-After', 60))))
                    except (ValueError, TypeError):
                        delay = max(delay, 60)
                with self.lock:
                    self.vpn_status = {'state': 'error', 'error': safe_error(exc), 'checked_at': time.time()}
                    self.vpn_tunnels = []
            time.sleep(delay)

    def publish_encoder_state(self, site_id, encoder):
        """Publish TCP status immediately, independently of slow reachability/settings reads."""
        checked = time.time()
        try:
            with self.device_lock(encoder):
                state = encoder_request(encoder, self.config['timeout_seconds'])
            live = {'state': state, 'control': 'Connected', 'state_checked_at': checked}
        except (OSError, ValueError) as exc:
            live = {'state': {}, 'control': 'Unavailable', 'state_checked_at': checked, 'error': str(exc)}
        key = (site_id, encoder['id'], encoder['ip'], encoder['port'])
        with self.lock:
            previous = self.live_encoder_states.get(key, {})
            if previous.get('state_checked_at', 0) > checked:
                return
            self.live_encoder_states[key] = live
            for site in self.snapshot['sites']:
                if site['id'] == site_id:
                    for item in site['encoders']:
                        if (item['id'], item['ip'], item['port']) == key[1:]:
                            item.pop('error', None)
                            item.update(live)

    def poll_encoder_states(self):
        pending = {}
        while True:
            try:
                config = load_config()
                for site in config['sites']:
                    for encoder in site['encoders']:
                        if not encoder['ip']:
                            continue
                        key = (site['id'], encoder['id'], encoder['ip'], encoder['port'])
                        if key not in pending or pending[key].done():
                            pending[key] = self.live_pool.submit(self.publish_encoder_state, site['id'], dict(encoder))
                pending = {key: future for key, future in pending.items() if not future.done()}
            except (OSError, ValueError, KeyError):
                pass
            time.sleep(1)

    def check_encoder(self, encoder, timeout):
        result = dict(encoder)
        result['ping'] = ping(encoder['ip'], timeout)
        result['state'] = {}
        result['control'] = 'Not configured'
        result['streaming_settings'] = {'available': False, 'checked_at': None}
        if encoder['ip']:
            try:
                with self.device_lock(encoder):
                    result['state'] = encoder_request(encoder, timeout)
                result['control'] = 'Connected'
                try:
                    result['streaming_settings'] = read_stream_summary(encoder, timeout)
                except (OSError, ValueError, KeyError, TypeError):
                    result['streaming_settings'] = {'available': False, 'checked_at': time.time(),
                                                    'error': 'Streaming settings unavailable'}
            except (OSError, ValueError) as exc:
                result['control'] = 'Unavailable'
                result['error'] = str(exc)
        return result

    def poll(self):
        while True:
            try:
                config = load_config()
                jobs = []
                for site in config['sites']:
                    router = self.pool.submit(ping, site['router_ip'], config['timeout_seconds'])
                    encoders = [self.pool.submit(self.check_encoder, e, config['timeout_seconds']) for e in site['encoders']]
                    devices = [self.pool.submit(self.check_device, d, config['timeout_seconds']) for d in site['devices']]
                    jobs.append((site, router, encoders, devices))
                sites = [dict(site, router_status=router.result(), encoders=[e.result() for e in encoders], devices=[d.result() for d in devices]) for site, router, encoders, devices in jobs]
                with self.lock:
                    self.config = config
                    for site in sites:
                        for item in site['encoders']:
                            key = (site['id'], item['id'], item['ip'], item['port'])
                            live = self.live_encoder_states.get(key)
                            if live:
                                item.pop('error', None)
                                item.update(live)
                    self.snapshot = {'sites': sites, 'updated': time.time(), 'error': None}
            except Exception as exc:
                with self.lock:
                    self.snapshot['error'] = f'Configuration/monitoring error: {exc}'
            time.sleep(self.config['poll_interval_seconds'])

    def check_device(self, device, timeout):
        if device.get('type') == 'webpresenter':
            return self.check_encoder(device, timeout)
        result = dict(device, ping=ping(device['ip'], timeout))
        if device.get('type') == 'streamingbridge':
            result['receiver_status'] = tcp_listener(device['ip'], device.get('port', 1935), timeout)
            result['receiver_checked_at'] = time.time()
            try:
                raw_state = encoder_request({**device, 'port': device.get('status_port', 9977)}, timeout)
                state_fields = ('Status', 'Video Bitrate', 'Video Mode', 'Audio Bitrate', 'Connected', 'Streaming')
                result['stream_state'] = {field: raw_state[field] for field in state_fields if field in raw_state}
                result['stream_checked_at'] = time.time()
            except (OSError, ValueError):
                result['stream_state'] = {}
                result['stream_checked_at'] = time.time()
        if device.get('id') == 'shelly' or device.get('type') == 'shelly':
            result.update(read_relay(device, timeout))
        return result

    def command(self, site_id, encoder_id, action):
        with self.lock:
            if self.restart_cycles.get(site_id, {}).get('boot_until', 0) > time.time():
                raise ValueError('Site equipment is restarting; wait for booting to finish')
        config = load_config()
        encoder = next((e for s in config['sites'] if s['id'] == site_id for e in s['encoders'] if e['id'] == encoder_id), None)
        if not encoder or not encoder['ip']:
            raise ValueError('Encoder is missing or has no configured address')
        with self.device_lock(encoder):
            return encoder_request(encoder, config['timeout_seconds'], action)

    def restart_site(self, site_id, confirmed):
        if confirmed is not True:
            raise ValueError('Explicit site restart confirmation is required')
        config = load_config()
        site = next((s for s in config['sites'] if s['id'] == site_id), None)
        shelly = next((d for d in site.get('devices', []) if d['id'] == 'shelly'), None) if site else None
        if not shelly or not shelly['ip']:
            raise ValueError('No Shelly configured for this site')
        with self.lock:
            if self.restart_until.get(site_id, 0) > time.monotonic():
                raise ValueError('Restart already requested; wait before retrying')
            self.restart_until[site_id] = time.monotonic() + 60
        # The Shelly itself restores power, even if the controller loses connectivity.
        payload = json.dumps({'id': 0, 'on': False, 'toggle_after': 20}).encode()
        request = urllib.request.Request(f"http://{shelly['ip']}/rpc/Switch.Set", data=payload,
                                         headers={'Content-Type': 'application/json'}, method='POST')
        try:
            with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=config['timeout_seconds']) as response:
                result = json.loads(response.read(65536))
            if not isinstance(result, dict) or 'was_on' not in result or 'error' in result:
                raise ValueError('Shelly did not acknowledge the restart')
        except (OSError, ValueError) as exc:
            raise ValueError('Restart outcome uncertain or rejected. Check site power before retrying. ' + str(exc)) from exc
        started = time.time()
        cycle = {'off_until': started + 20, 'boot_until': started + 50}
        with self.lock:
            self.restart_cycles[site_id] = cycle
        return {'message': f"{site['name']}: power OFF for 20 seconds, followed by 30 seconds booting.", 'cycle': cycle}

    def open_sx_virtual_link(self):
        config = load_config()
        path = Path(config.get('applications', {}).get('sx_virtual_link_path',
                    r'C:\Program Files\silex technology\SX Virtual Link\Connect.exe'))
        if os.name != 'nt' or not path.is_file() or path.name.lower() != 'connect.exe':
            raise ValueError('SX Virtual Link was not found. Check applications.sx_virtual_link_path in config.json.')
        os.startfile(str(path))
        return {'message': 'SX Virtual Link opened on this PC. Select the required DS-700 in the application.'}

    def settings(self, data):
        config = load_config()
        site_id = data.get('site')
        encoder = next((e for s in config['sites'] if s['id'] == site_id for e in s['encoders']
                        if e['id'] == data.get('encoder')), None)
        if not encoder:
            raise ValueError('Encoder not found')
        with self.lock:
            if self.restart_cycles.get(site_id, {}).get('boot_until', 0) > time.time():
                raise ValueError('Site equipment is restarting')
        with self.device_lock(encoder):
            if data.get('operation') == 'read':
                return read_settings(encoder)
            if data.get('operation') == 'xml-preview':
                return preview_import(encoder, data.get('settings', {}))
            if data.get('operation') == 'xml-target':
                return plan_import(encoder, data.get('settings', {}))
            if data.get('operation') == 'apply-xml':
                return apply_import(encoder, data.get('settings', {}))
            if data.get('operation') == 'export':
                return export_settings(encoder, data.get('settings', {}))
            if data.get('operation') == 'read-preset':
                return read_preset(encoder, data.get('settings', {}))
            if data.get('operation') == 'delete-preset':
                return delete_preset(encoder, data.get('settings', {}))
            if data.get('operation') == 'apply-preset':
                return apply_preset(encoder, data.get('settings', {}))
            if data.get('operation') == 'apply':
                return apply_settings(encoder, data.get('settings', {}))
            raise ValueError('Invalid settings operation')
