"""Blackmagic Videohub TCP protocol: labeled video matrix and single crosspoint changes."""
import socket
import time


class Wire:
    def __init__(self, sock):
        self.sock = sock
        self.buffer = b''

    def block(self, deadline):
        while True:
            normalized = self.buffer.replace(b'\r\n', b'\n').lstrip(b'\n')
            if b'\n\n' in normalized:
                raw, self.buffer = normalized.split(b'\n\n', 1)
                lines = raw.decode('utf-8', errors='replace').splitlines()
                return lines[0].rstrip(':'), lines[1:]
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError('Videohub response timed out')
            self.sock.settimeout(remaining)
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError('Videohub closed the connection')
            self.buffer += chunk
            if len(self.buffer) > 2_000_000:
                raise ValueError('Videohub response too large')


def update(state, header, lines):
    if header == 'VIDEOHUB DEVICE':
        fields = dict(line.split(': ', 1) for line in lines if ': ' in line)
        if fields.get('Device present') != 'true':
            raise ValueError('Videohub device is not available')
        state['model'] = fields.get('Model name', 'Videohub')
        state['input_count'] = int(fields.get('Video inputs', 0))
        state['output_count'] = int(fields.get('Video outputs', 0))
        if not 1 <= state['input_count'] <= 512 or not 1 <= state['output_count'] <= 512:
            raise ValueError('Unsupported Videohub matrix size')
    sections = {'INPUT LABELS': 'inputs', 'OUTPUT LABELS': 'outputs',
                'VIDEO OUTPUT LOCKS': 'locks', 'VIDEO OUTPUT ROUTING': 'routes'}
    if header in sections:
        target = state.setdefault(sections[header], {})
        for line in lines:
            index, value = line.split(' ', 1)
            target[int(index)] = int(value) if header == 'VIDEO OUTPUT ROUTING' else value


def complete(state):
    n, m = state.get('input_count', 0), state.get('output_count', 0)
    return (n > 0 and m > 0 and all(i in state.get('inputs', {}) for i in range(n))
            and all(o in state.get('outputs', {}) and o in state.get('routes', {})
                    and o in state.get('locks', {}) and 0 <= state['routes'][o] < n for o in range(m)))


def public(state):
    n, m = state['input_count'], state['output_count']
    return {'connected': True, 'checked_at': time.time(), 'model': state['model'],
            'inputs': [state['inputs'][i] for i in range(n)],
            'outputs': [state['outputs'][o] for o in range(m)],
            'routes': [state['routes'][o] for o in range(m)],
            'locks': [state['locks'][o] for o in range(m)]}


def mutate(device, timeout=3, field=None, index=None, value=None, expected=None, observe=None):
    sections = {'inputs': 'INPUT LABELS', 'outputs': 'OUTPUT LABELS', 'locks': 'VIDEO OUTPUT LOCKS'}
    if field not in sections or isinstance(index, bool) or not isinstance(index, int) or index < 0:
        raise ValueError('Select a valid input or output')
    if field == 'locks':
        if not isinstance(value, bool) or expected not in ('U', 'L', 'O'):
            raise ValueError('Select a valid output lock state')
        command_value = 'L' if value else 'U'
    else:
        if (not isinstance(value, str) or not value or value != value.strip() or len(value) > 64
                or any(ord(char) < 32 or ord(char) == 127 for char in value)
                or not isinstance(expected, str)):
            raise ValueError('Enter a name with 1 to 64 printable characters')
        command_value = value
    with socket.create_connection((device['ip'], device.get('port', 9990)), timeout) as sock:
        wire, state = Wire(sock), {}
        deadline = time.monotonic() + timeout
        while not complete(state):
            header, lines = wire.block(deadline)
            update(state, header, lines)
        if observe:
            observe(public(state))
        collection = state[field]
        if index not in collection:
            raise ValueError('Input or output is outside the Videohub matrix')
        if collection[index] != expected:
            raise ValueError('This name or lock state changed elsewhere. Refresh and review it before retrying')
        current_is_locked = field == 'locks' and collection[index] != 'U'
        unchanged = current_is_locked == value if field == 'locks' else collection[index] == value
        if unchanged:
            return public(state)

        section = sections[field]
        command = f'{section}:\n{index} {command_value}\n\n'.encode('utf-8')
        sock.sendall(command)
        acknowledged = False
        deadline = time.monotonic() + timeout
        while not acknowledged:
            header, lines = wire.block(deadline)
            if header in ('NAK', 'NACK'):
                raise ValueError('Videohub rejected the requested change')
            if header == 'ACK':
                acknowledged = True
            else:
                update(state, header, lines)
        sock.sendall(f'{section}:\n\n'.encode('ascii'))
        deadline = time.monotonic() + timeout
        while True:
            header, lines = wire.block(deadline)
            update(state, header, lines)
            if header == section and index in state.get(field, {}):
                actual = state[field][index]
                if field == 'locks':
                    verified = (actual != 'U') == value
                else:
                    verified = actual == value
                if not verified:
                    raise ValueError('Videohub reported a different value; refresh and review the device')
                return public(state)


def request(device, timeout=3, output=None, input_=None, expected=None, routes=None, expected_routes=None, observe=None):
    if output is not None:
        if any(isinstance(v, bool) or not isinstance(v, int) for v in (output, input_, expected)):
            raise ValueError('Select a valid input and output')
    if routes is not None and (not isinstance(routes, list) or not routes or any(isinstance(v, bool) or not isinstance(v, int) for v in routes)):
        raise ValueError('Invalid routing preset')
    with socket.create_connection((device['ip'], device.get('port', 9990)), timeout) as sock:
        wire, state = Wire(sock), {}
        deadline = time.monotonic() + timeout
        while not complete(state):
            header, lines = wire.block(deadline)
            update(state, header, lines)
        if observe:
            observe(public(state))
        if output is None and routes is None:
            return public(state)
        if routes is not None:
            if len(routes) != state['output_count'] or any(not 0 <= i < state['input_count'] for i in routes):
                raise ValueError('Preset dimensions do not match this Videohub')
            if (not isinstance(expected_routes, list) or len(expected_routes) != state['output_count']
                    or any(isinstance(i, bool) or not isinstance(i, int) for i in expected_routes)
                    or any(state['routes'][o] != i for o, i in enumerate(expected_routes))):
                raise ValueError('Output routes changed elsewhere. Review the preset recall again')
            desired = dict(enumerate(routes))
        else:
            if not 0 <= output < state['output_count'] or not 0 <= input_ < state['input_count']:
                raise ValueError('Input or output is outside the Videohub matrix')
            if state['routes'][output] != expected:
                raise ValueError('Output route changed elsewhere. Review the current matrix before retrying')
            desired = {output: input_}
        changes = {o: i for o, i in desired.items() if state['routes'][o] != i}
        if any(state['locks'][o] != 'U' for o in changes):
            raise ValueError('A targeted Videohub output is locked; routes were not changed')
        if not changes:
            return public(state)
        # One routing block, even for a full-matrix recall. Never retry mutations.
        command = 'VIDEO OUTPUT ROUTING:\n' + ''.join(f'{o} {i}\n' for o, i in changes.items()) + '\n'
        sock.sendall(command.encode('ascii'))
        try:
            acknowledged = False
            deadline = time.monotonic() + timeout
            while not acknowledged:
                header, lines = wire.block(deadline)
                if header in ('NAK', 'NACK'):
                    raise ValueError('Videohub rejected the route change')
                if header == 'ACK':
                    acknowledged = True
                else:
                    update(state, header, lines)
            sock.sendall(b'VIDEO OUTPUT ROUTING:\n\n')
            while True:
                header, lines = wire.block(deadline)
                update(state, header, lines)
                if header == 'VIDEO OUTPUT ROUTING' and len(lines) >= state['output_count']:
                    if any(state['routes'][o] != i for o, i in desired.items()):
                        raise ValueError('Videohub reports a different route; refresh the matrix')
                    return public(state)
        except (OSError, ValueError) as exc:
            raise ValueError('Route change was not confirmed. Check the matrix before retrying. ' + str(exc)) from None
