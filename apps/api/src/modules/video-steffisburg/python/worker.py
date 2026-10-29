"""Private JSON-lines worker. No HTTP listener and no browser-accessible config."""
import concurrent.futures
import json
import os
import re
import sys
import threading
import time
from controller import Controller, load_config, set_device_address_overrides

controller = Controller()
output_lock = threading.Lock()
cooldowns = {}
command_lock = threading.Lock()
capacity = threading.BoundedSemaphore(8)

def publish(message):
    with output_lock:
        print(json.dumps(message, ensure_ascii=True), flush=True)

def public_status(department_id):
    # Never expose arbitrary server configuration or credentials in polling data.
    with controller.lock:
        result = json.loads(json.dumps(controller.snapshot))
        config = controller.config
        allowed_sites = {site['id'] for site in config['sites'] if site.get('department_id') == department_id}
        result.update(restart_cycles={key: value for key, value in controller.restart_cycles.items() if key in allowed_sites},
                      videohubs={key: value for key, value in controller.videohub_states.items() if key.split('|', 1)[0] in allowed_sites})
        result['error'] = None
    site_fields = {'id', 'name', 'router_ip', 'router_model', 'router_status'}
    fields = {'id', 'name', 'ip', 'port', 'type', 'model', 'destination_site', 'destination_name',
              'usage', 'usage_note', 'ping', 'state', 'control', 'error', 'streaming_settings',
              'power', 'power_checked_at', 'power_error', 'state_checked_at',
              'receiver_status', 'receiver_checked_at', 'status_port', 'stream_state', 'stream_checked_at'}
    result['sites'] = [dict({key: value for key, value in site.items() if key in site_fields},
        encoders=[{key: value for key, value in encoder.items() if key in fields} for encoder in site['encoders']],
        devices=[{key: value for key, value in device.items() if key in fields} for device in site['devices']])
        for site in result.get('sites', []) if site.get('department_id') == department_id]
    return result

def resolve_site(config, department_id, data, target_key=None):
    allowed = [site for site in config['sites'] if site.get('department_id') == department_id]
    requested = data.get('site_id')
    if requested:
        site = next((site for site in allowed if site['id'] == requested), None)
        if not site:
            raise ValueError('Video equipment is not configured for this location')
        if target_key:
            target_id = data.get(target_key)
            collection = 'encoders' if target_key == 'encoder' else 'devices'
            if not any(item['id'] == target_id for item in site.get(collection, [])):
                raise ValueError('Selected equipment does not belong to this site')
        return site
    if target_key:
        target_id = data.get(target_key)
        collection = 'encoders' if target_key == 'encoder' else 'devices'
        matches = [site for site in allowed if any(item['id'] == target_id for item in site.get(collection, []))]
        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:
            raise ValueError('Select the site for this equipment')
    if len(allowed) == 1:
        return allowed[0]
    if not allowed:
        raise ValueError('Video equipment is not configured for this location')
    raise ValueError('Select a site for this video operation')

def dispatch(method, data):
    department_id = data.get('department_id')
    if not isinstance(department_id, str) or not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', department_id, re.I):
        raise ValueError('Choose a configured location')
    if method == 'set-device-addresses':
        set_device_address_overrides(department_id, data.get('addresses'))
        return {'updated': True}
    config = load_config()
    if method == 'status':
        return public_status(department_id)
    target_key = 'encoder' if method in ('command', 'encoder-settings') else 'device' if method in ('videohub-route', 'videohub-presets', 'videohub-history') else None
    site = resolve_site(config, department_id, data, target_key)
    data['site'] = site['id']
    if method == 'command':
        if data.get('action') not in ('Start', 'Stop'):
            raise ValueError('Invalid action')
        key = (data.get('site'), data.get('encoder'))
        with command_lock:
            if cooldowns.get(key, 0) > time.monotonic():
                raise ValueError('Command pending or cooling down; check device status before retrying')
            cooldowns[key] = float('inf')
        try:
            return controller.command(data['site'], data['encoder'], data['action'])
        finally:
            with command_lock:
                cooldowns[key] = time.monotonic() + 5
    if method == 'restart-site':
        return controller.restart_site(data['site'], data.get('confirmed'))
    if method == 'encoder-settings':
        return controller.settings(data)
    if method == 'videohub-route':
        return controller.route_videohub(data)
    if method == 'videohub-presets':
        return controller.videohub_presets(data)
    if method == 'videohub-history':
        return controller.videohub_history(data)
    raise ValueError('Unsupported video operation')

def handle(message):
    try:
        result = dispatch(message['method'], message.get('data', {}))
        publish({'id': message['id'], 'result': result})
    except (ValueError, KeyError, OSError, TypeError) as error:
        publish({'id': message.get('id'), 'error': str(error)})
    except Exception:
        publish({'id': message.get('id'), 'error': 'Video operation failed; check device status before retrying.'})
    finally:
        capacity.release()

if __name__ == '__main__':
    for target in [controller.poll, controller.poll_encoder_states, controller.poll_vpn, controller.poll_videohubs]:
        threading.Thread(target=target, daemon=True).start()
    publish({'type': 'ready'})
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=8)
    for line in sys.stdin:
        if len(line) > 1_000_000:
            break
        try:
            message = json.loads(line)
            if not capacity.acquire(blocking=False):
                publish({'id': message.get('id'), 'error': 'Video worker busy. No command was sent.'})
            else:
                pool.submit(handle, message)
        except (ValueError, TypeError):
            break
    # Parent IPC closure must terminate monitoring, including thread pools.
    os._exit(0)
