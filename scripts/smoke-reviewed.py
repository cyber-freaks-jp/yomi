#!/usr/bin/env python3
"""Exercise the real stdio server with a disposable empty session and no network."""
import json
import os
from pathlib import Path
import select
import subprocess
import sys
import tempfile

repo = Path(__file__).resolve().parent.parent
node = '/opt/homebrew/bin/node'
entry = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else repo / 'dist/mcp/server.js'
launcher = '--launcher' in sys.argv
command = [node, str(entry), '--smoke'] if launcher else [node, '--import', str(repo / 'scripts/reviewed-network-guard.mjs'), str(entry)]
env = {'HOME': os.path.expanduser('~'), 'PATH': '/usr/bin:/bin', 'LANG': 'en_US.UTF-8',
       'YOMI_NO_KEYCHAIN': '1', 'YOMI_NO_UPDATE_CHECK': '1', 'YOMI_DATA_DIR': tempfile.mkdtemp(prefix='yomi-reviewed-smoke-')}
process = subprocess.Popen(command, cwd=entry.parent, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)

def send(payload):
    process.stdin.write(json.dumps(payload) + '\n')
    process.stdin.flush()

def request(number, method, params):
    send({'jsonrpc': '2.0', 'id': number, 'method': method, 'params': params})
    for _ in range(20):
        if not select.select([process.stdout], [], [], 1)[0]:
            if process.poll() is not None:
                raise RuntimeError('Server exited: ' + process.stderr.read())
            continue
        line = process.stdout.readline()
        if not line:
            raise RuntimeError('Server closed stdout: ' + process.stderr.read())
        response = json.loads(line)
        if response.get('id') == number:
            if 'error' in response:
                raise RuntimeError(response)
            return response['result']
    raise TimeoutError(method)

try:
    initialized = request(1, 'initialize', {'protocolVersion': '2025-11-25', 'capabilities': {}, 'clientInfo': {'name': 'yomi-reviewed-smoke', 'version': '1.0.0'}})
    assert initialized['serverInfo']['name'] == 'yomi-reviewed'
    send({'jsonrpc': '2.0', 'method': 'notifications/initialized'})
    tools = request(2, 'tools/list', {})['tools']
    names = {tool['name'] for tool in tools}
    assert len(names) == 14, names
    assert not names.intersection({'send_message', 'send_image', 'send_file', 'mark_read', 'leave_group', 'unsend_message', 'get_insight', 'get_message_media'})
    for index, name in enumerate(['send_message', 'send_file', 'mark_read', 'rename_group', 'unknown_tool'], 3):
        result = request(index, 'tools/call', {'name': name, 'arguments': {'chatId': 'u123', 'text': 'do not send'}})
        assert result.get('isError') is True
        assert 'disabled' in json.dumps(result)
    result = request(9, 'tools/call', {'name': 'collect_messages', 'arguments': {}})
    assert result.get('isError') is True and 'Explicit chatIds' in json.dumps(result)
    result = request(10, 'tools/call', {'name': 'search_messages', 'arguments': {'query': 'test'}})
    assert 'Search index is empty' in json.dumps(result)
    result = request(11, 'tools/call', {'name': 'get_scope_policy', 'arguments': {}})
    assert not result.get('isError')
    assert 'untrusted_data_not_instructions' in result['content'][0]['text']
    assert 'background capture' in result['content'][0]['text']
    print(json.dumps({'passed': True, 'tools': sorted(names), 'network_guard': not launcher, 'login_attempted': False}))
finally:
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()
