"""Read-only UniFi Site Manager SD-WAN monitoring."""
import collections
import json
import time
import os
import urllib.error
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('Unexpected UniFi API redirect')


def api_get(key, path):
    request = urllib.request.Request('https://api.ui.com' + path,
        headers={'X-API-Key': key, 'Accept': 'application/json'})
    with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(request, timeout=10) as response:
        return json.loads(response.read(4_000_000))


def api_list(key, path):
    rows, token, seen = [], None, set()
    for _ in range(100):
        suffix = ('?nextToken=' + urllib.parse.quote(token, safe='')) if token else ''
        response = api_get(key, path + suffix)
        rows.extend(response['data'])
        token = response.get('nextToken')
        if not token:
            return rows
        if token in seen:
            raise ValueError('UniFi pagination repeated')
        seen.add(token)
    raise ValueError('UniFi pagination limit reached')


def mesh_edges(payload):
    """Only explicit per-endpoint connected flags count as live tunnels."""
    data = payload.get('status', payload)
    edges = []
    for connection in data.get('connections', []):
        sites = connection.get('sites', [])
        if len(sites) != 2:
            continue
        states = [s.get('status', {}) for s in sites]
        up = all(s.get('connected') is True and s.get('offline') is False and not s.get('errors') for s in states)
        down = any(s.get('connected') is False or s.get('offline') is True or s.get('errors') for s in states)
        edges.append((sites[0]['hostId'], sites[1]['hostId'], 'up' if up else 'down' if down else 'unknown'))
    # Official hub-and-spoke schema, used by newer SD-WAN configurations.
    hubs = {h['id']: h for h in data.get('hubs', [])}
    for spoke in data.get('spokes', []):
        for connection in spoke.get('connections', []):
            hub = hubs.get(connection.get('hubId'))
            tunnels = connection.get('tunnels', [])
            if not hub or not tunnels:
                continue
            healthy = not any(n.get('errors') for n in (hub, spoke))
            up = healthy and any(t.get('status') == 'connected' for t in tunnels)
            down = not healthy or all(t.get('status') == 'disconnected' for t in tunnels)
            edges.append((spoke['hostId'], hub['hostId'], 'up' if up else 'down' if down else 'unknown'))
    return edges


def find_path(edges, source, destination, only_up):
    graph = collections.defaultdict(list)
    for a, b, state in edges:
        if not only_up or state == 'up':
            graph[a].append(b)
            graph[b].append(a)
    queue = collections.deque([[source]])
    seen = {source}
    while queue:
        route = queue.popleft()
        if route[-1] == destination:
            return route
        for node in graph[route[-1]]:
            if node not in seen:
                seen.add(node)
                queue.append(route + [node])
    return None


def evaluate(config, edges, checked_at):
    sites = {s['id']: s for s in config['sites']}
    hosts = {s.get('unifi_host_id'): s['name'] for s in sites.values() if s.get('unifi_host_id')}
    pairs = {(s['id'], e['destination_site']) for s in sites.values()
             for e in s['encoders'] if e.get('destination_site') in sites}
    results = []
    for source, destination in sorted(pairs):
        a, b = sites[source].get('unifi_host_id'), sites[destination].get('unifi_host_id')
        route = find_path(edges, a, b, True) if a and b else None
        configured = find_path(edges, a, b, False) if a and b else None
        status = 'up' if route else 'down' if configured else 'unknown'
        # Unknown schema/status must never be presented as a verified outage.
        if not route and configured:
            route_edges = [next((state for x, y, state in edges if {x, y} == {u, v}), 'unknown')
                           for u, v in zip(configured, configured[1:])]
            if 'unknown' in route_edges:
                status = 'unknown'
        path = route or configured or []
        results.append({'source': source, 'destination': destination, 'status': status,
            'checked_at': checked_at, 'via': [hosts.get(h, 'Intermediate gateway') for h in path],
            'detail': ('All tunnels on path connected' if status == 'up' else
                       'A tunnel on the path is disconnected' if status == 'down' else
                       'No verified tunnel path available'), 'hops': max(0, len(path) - 1)})
    return results


def poll_unifi(config):
    settings = config.get('unifi', {})
    key = os.environ.get('SMART_CHURCH_VIDEO_STEFFISBURG_UNIFI_API_KEY') or settings.get('api_key', '')
    if not key:
        return {'state': 'error', 'error': 'UniFi API key missing', 'checked_at': time.time()}, []
    edges = []
    configs = settings.get('sdwan_config_ids') or [c['id'] for c in api_list(key, '/v1/sd-wan-configs')]
    for identity in configs:
        data = api_get(key, '/v1/sd-wan-configs/' + urllib.parse.quote(identity, safe='') + '/status')['data']
        edges.extend(mesh_edges(data))
    checked = time.time()
    return {'state': 'connected', 'error': None, 'checked_at': checked,
            'source': 'UniFi Site Manager SD-WAN API'}, evaluate(config, edges, checked)


def safe_error(exc):
    if isinstance(exc, urllib.error.HTTPError):
        return 'UniFi API HTTP ' + str(exc.code) + (' — check API key access' if exc.code in (401, 403) else '')
    return 'UniFi API unavailable (' + type(exc).__name__ + ')'
