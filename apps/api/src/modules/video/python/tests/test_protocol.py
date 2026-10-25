import socket
import threading
import unittest
from controller import encoder_request


class ProtocolTests(unittest.TestCase):
    def request(self, action=None, reject=False, fragment=False):
        listener = socket.socket()
        listener.bind(('127.0.0.1', 0))
        listener.listen()
        port = listener.getsockname()[1]
        commands = []
        def device():
            with listener:
                conn, _ = listener.accept()
                with conn:
                    conn.settimeout(2)
                    payload = b'PROTOCOL PREAMBLE:\r\nVersion: 1.2\r\n\r\nSTREAM STATE:\r\nStatus: Idle\r\n\r\nEND PRELUDE:\r\n\r\n'
                    if fragment:
                        for byte in payload:
                            conn.sendall(bytes([byte]))
                    else:
                        conn.sendall(payload)
                    command = b''
                    while not command.endswith(b'\n\n'):
                        command += conn.recv(1024)
                    commands.append(command)
                    conn.sendall(b'NACK\n\n' if reject else b'ACK\n\nSTREAM STATE:\nStatus: Streaming\nDuration: 00:00:01:00\n\n')
        thread = threading.Thread(target=device)
        thread.start()
        try:
            result = encoder_request({'ip': '127.0.0.1', 'port': port}, 2, action)
        finally:
            thread.join(3)
        return result, commands[0]

    def test_status_and_fragmented_prelude(self):
        result, command = self.request(fragment=True)
        self.assertEqual(command, b'STREAM STATE:\n\n')
        self.assertEqual(result['Status'], 'Streaming')

    def test_start_and_stop_acceptance(self):
        for action in ['Start', 'Stop']:
            result, command = self.request(action)
            self.assertEqual(command, f'STREAM STATE:\nAction: {action}\n\n'.encode())
            self.assertIn('accepted', result['command'])
            self.assertNotIn('Status', result)

    def test_rejected_command(self):
        with self.assertRaisesRegex(ValueError, 'rejected'):
            self.request('Start', reject=True)


if __name__ == '__main__':
    unittest.main()
