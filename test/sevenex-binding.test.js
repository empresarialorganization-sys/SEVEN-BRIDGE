import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { resolveSevenExBinding, verifyHubBinding } from '../src/binding.js';
import { operatorCompatibility } from '../src/contract.js';
import {
  authenticateSevenExRequest,
  protectedResourceMetadata,
  sevenExResource,
  validateSevenExClaims,
} from '../src/oauth.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SHARED_SECRET = 'test-only-shared-secret-at-least-32-characters-long';

test('SevenEx protected resource metadata points at the canonical MCP resource', () => {
  const env = { SEVEN_PUBLIC_URL: 'https://bridge.example', SEVEN_SUPABASE_AUTH_URL: 'https://auth.example/auth/v1' };
  assert.deepEqual(protectedResourceMetadata(env), {
    resource: 'https://bridge.example/mcp',
    authorization_servers: ['https://auth.example/auth/v1'],
    bearer_methods_supported: ['header'],
  });
});

test('SevenEx requires OAuth subject client and exact audience', async () => {
  const env = { SEVEN_PUBLIC_URL: 'https://bridge.example' };
  assert.equal(validateSevenExClaims({ sub: USER_ID, client_id: 'client-1', aud: sevenExResource(env) }, env).ok, true);
  assert.equal(validateSevenExClaims({ sub: USER_ID, client_id: 'client-1', aud: 'authenticated' }, env).ok, false);
  assert.equal(validateSevenExClaims({ sub: USER_ID, aud: sevenExResource(env) }, env).ok, false);
});

test('SevenEx authenticates the bearer at Bridge without exposing it downstream', async () => {
  const env = { SEVEN_PUBLIC_URL: 'https://bridge.example' };
  const request = new Request('https://bridge.example/mcp', { headers: { authorization: 'Bearer user-oauth-token' } });
  const identity = await authenticateSevenExRequest(request, env, async (token) => {
    assert.equal(token, 'user-oauth-token');
    return { sub: USER_ID, client_id: 'client-1', aud: 'https://bridge.example/mcp' };
  });
  assert.deepEqual(identity, { ok: true, userId: USER_ID, clientId: 'client-1' });
});

test('SevenEx signs an internal Core binding request instead of forwarding OAuth bearer', async () => {
  const env = {
    SEVEN_CORE_URL: 'https://core.example/',
    SEVEN_OPERATOR_SHARED_SECRET: SHARED_SECRET,
  };
  const result = await resolveSevenExBinding(
    { userId: USER_ID, clientId: 'client-1' },
    env,
    async (url, init) => {
      assert.equal(url, 'https://core.example/api/v1/sevenex/binding');
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.authorization, undefined);
      assert.equal(init.headers['x-seven-source'], 'seven-bridge');
      assert.match(init.headers['x-seven-signature'], /^[0-9a-f]{64}$/);
      assert.match(init.headers['x-seven-timestamp'], /^\d+$/);
      assert.deepEqual(JSON.parse(init.body), { userId: USER_ID, clientId: 'client-1' });
      return Response.json({ ok: true, workspaceId: 'w1', sessionId: 's1', deviceCode: '123456' });
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.sessionId, 's1');
  assert.equal(result.deviceCode, '123456');
});

test('SevenEx refuses Core binding when permanent service auth is not configured', async () => {
  const result = await resolveSevenExBinding({ userId: USER_ID, clientId: 'client-1' }, {}, async () => {
    throw new Error('fetch must not run');
  });
  assert.deepEqual(result, { ok: false, status: 503, error: 'core_auth_not_configured' });
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

test('canonical MCP has no hardcoded default device, device-code tool input, or bearer passthrough', async () => {
  const mcp = await readFile(new URL('../src/mcp.js', import.meta.url), 'utf8');
  const binding = await readFile(new URL('../src/binding.js', import.meta.url), 'utf8');
  assert.equal(mcp.includes('DEFAULT_DEVICE_CODE'), false);
  assert.equal(mcp.includes('deviceCode:'), false);
  assert.equal(binding.includes("headers: {\n        authorization"), false);
  assert.match(mcp, /seven_status/);
  assert.match(mcp, /seven_command/);
  assert.match(mcp, /seven_result/);
});
