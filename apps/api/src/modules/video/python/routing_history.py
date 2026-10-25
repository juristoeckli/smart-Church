"""Bounded, private routing observations; timestamps are observation times."""
import copy
import json
import os
from pathlib import Path
import threading
import time
import uuid

EXTERNAL = 'Video Hub Controll / API'


class RoutingHistory:
    def __init__(self, root, merge_window_seconds=300):
        self.merge_window_seconds = merge_window_seconds
        self.path = Path(root) / 'routing-history.json'
        self.lock = threading.Lock()
        try:
            self.events = json.loads(self.path.read_text(encoding='utf-8'))
            if not isinstance(self.events, list):
                raise ValueError('Invalid routing history')
        except FileNotFoundError:
            self.events = []
        self.current = {}

    def observe(self, key, state, actor=EXTERNAL, targets=()):
        with self.lock:
            if not state.get('connected'):
                self.current.pop(key, None)
                return
            previous = self.current.get(key)
            fields = ('inputs', 'outputs', 'routes', 'locks')
            if previous and all(previous.get(k) == state.get(k) for k in fields):
                return
            changes = []
            details = []
            now = time.time()
            if previous:
                for field in ('inputs', 'outputs', 'locks'):
                    for index, value in enumerate(state[field]):
                        old = previous[field][index] if index < len(previous[field]) else None
                        if old != value:
                            details.append({'field': field, 'index': index, 'before': old,
                                            'after': value, 'user': actor, 'time': now})
                for output, value in enumerate(state['routes']):
                    old = previous['routes'][output] if output < len(previous['routes']) else None
                    if old != value:
                        changes.append({'output': output, 'before': old, 'after': value,
                                        'time': now,
                                        'user': actor if output in targets else EXTERNAL})
            event = {'id': uuid.uuid4().hex, 'key': key, 'time': now, 'started_at': now,
                     'user': actor if (changes or details) and all(item['user'] == actor for item in changes + details) else EXTERNAL,
                     'kind': 'change' if previous else 'baseline', 'changes': changes, 'details': details,
                     'state': copy.deepcopy(state)}
            events = copy.deepcopy([e for e in self.events if e['time'] >= now - 30 * 86400])
            last = next((e for e in reversed(events) if e['key'] == key), None)
            def single_user(e):
                return all(c['user'] == e['user'] for c in e['changes'] + e.get('details', []))
            if (self.merge_window_seconds > 0 and last and event['kind'] == last['kind'] == 'change'
                    and event['user'] == last['user'] and single_user(event) and single_user(last)
                    and 0 <= now - last.get('started_at', last['time']) <= self.merge_window_seconds):
                last['started_at'] = last.get('started_at', last['time'])
                last['time'] = now
                last['changes'].extend(changes)
                last.setdefault('details', []).extend(details)
                last['state'] = event['state']
                events.remove(last)
                events.append(last)
            else:
                events.append(event)
            events = events[-2000:]
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.path.with_suffix('.tmp')
            temporary.write_text(json.dumps(events, ensure_ascii=True), encoding='utf-8')
            os.replace(temporary, self.path)
            self.events = events
            self.current[key] = copy.deepcopy(state)

    def read(self, key):
        with self.lock:
            return {'events': copy.deepcopy([e for e in self.events if e['key'] == key
                                            and e['time'] >= time.time() - 30 * 86400]),
                    'retention_days': 30, 'limit': 2000,
                    'merge_window_minutes': self.merge_window_seconds / 60}
