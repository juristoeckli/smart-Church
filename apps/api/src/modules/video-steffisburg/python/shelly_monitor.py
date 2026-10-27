"""Read-only monitoring of Shelly Pro relay 0."""
import json
import time
import urllib.error
import urllib.request


def read_relay(device, timeout):
    result = {'power': 'unknown', 'power_checked_at': None, 'power_error': None}
    if not device.get('ip'):
        result['power_error'] = 'Shelly address is not configured'
        return result
    request = urllib.request.Request('http://' + device['ip'] + '/rpc/Switch.GetStatus?id=0',
                                     headers={'Accept': 'application/json'}, method='GET')
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(request, timeout=timeout) as response:
            status = json.loads(response.read(65536))
        if not isinstance(status, dict) or status.get('id') != 0 or type(status.get('output')) is not bool:
            raise ValueError('Invalid relay status')
        result['power'] = 'on' if status['output'] else 'off'
    except urllib.error.HTTPError as exc:
        result['power_error'] = ('Shelly authentication required' if exc.code in (401, 403)
                                 else 'Shelly status HTTP ' + str(exc.code))
    except (OSError, ValueError):
        result['power_error'] = 'Shelly relay status unavailable'
    result['power_checked_at'] = time.time()
    return result
