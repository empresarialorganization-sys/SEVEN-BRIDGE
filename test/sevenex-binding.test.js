import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { resolveSevenExBinding, verifyHubBinding } from '../src/binding.js';
import { operatorCompatibility } from '../src/contract.js';

test('SevenEx requires an authenticated account before resolving a browser', async () => {
  const request = new Request('https://bridge.example/mcp');
  const result = await resolveSevenExBinding(request, {}, async () => {
    throw new Error('fetch must not run');
  });
  assert.deepEqual(result, { ok: false, status: 401, error: 'account_unauthorized' });
});

test('SevenEx forwards account bearer to Core and accepts only a valid binding', async () => {
  const request = new Request('https://bridge.example/mcp', { headers: { authorization: 'Bearer user-token' } });
  const result = await resolveSevenExBinding(request, { SEVEN_CORE_URL: 'https://core.example/' }, async (url, init) => {
    assert.equal(url, 'https://core.example/api/v1/sevenex/binding');
    assert.equal(init.headers.authorization, 'Bearer user-token');
    return Response.json({ ok: true, userId: 'u1', workspaceId: 'w1', sessionId: 's1', deviceCode: '123456' });
  });
  assert.equal(result.ok, true);
  assert.equal(result.sessionId, 's1');
  assert.equal(result.deviceCode, '123456');
});

test('SevenEx rejects a DeviceHub that belongs to another session', async () => {
  const hub = {
    fetch: async () => Response.json({ ok: true, connected: true, meta: { sessionId: 'other-session' } }),
  };
  const result = await verifyHubBinding(hub, { sessionId: 'expected-session' });
  assert.deepEqual(result, { ok: false, status: 403, error: 'device_binding_mismatch' });
});

test('SevenEx accepts only the current Operator contract', () => {
  const compatible = operatorCompatibility({
    operator: {
      version: '1.1.0',
      protocolVersion: 1,
      capabilities: ['vision', 'visionDiff', 'mission', 'collectImages'],
    },
  });
  assert.equal(compatible.ok, true);

  const stale = operatorCompatibility({
    operator: { version: '0.10.6', protocolVersion: 1, capabilities: ['vision', 'visionDiff', 'mission', 'collectImages'] },
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.updateRequired, true);
});

test('canonical MCP has no hardcoded default device or device-code tool input', async () => {
  const source = await readFile(new URL('../src/mcp.js', import.meta.url), 'utf8');
  assert.equal(source.includes('DEFAULT_DEVICE_CODE'), false);
  assert.equal(source.includes('deviceCode:'), false);
  assert.match(source, /seven_status/);
  assert.match(source, /seven_command/);
  assert.match(source, /seven_result/);
});
