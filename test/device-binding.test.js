import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deviceMcpPath,
  normalizeDeviceCode,
  parseDeviceMcpPath,
} from '../src/device-binding.js';
import bridge, { DeviceHub } from '../src/index.js';

const DEVICE_CODE = '493680';
const DEVICE_SECRET = 'opera-user-1-device-secret-that-is-long-enough';
const AGENT_KEY = 'server-agent-key-that-is-at-least-thirty-two-characters';

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  async get(key) {
    return this.values.get(key);
  }

  async put(keyOrEntries, value) {
    if (typeof keyOrEntries === 'object') {
      for (const [key, entry] of Object.entries(keyOrEntries)) this.values.set(key, entry);
      return;
    }
    this.values.set(keyOrEntries, value);
  }

  async delete(key) {
    return this.values.delete(key);
  }

  async list({ prefix } = {}) {
    return new Map(
      [...this.values.entries()].filter(([key]) => !prefix || String(key).startsWith(prefix)),
    );
  }

  async getAlarm() {
    return null;
  }

  async setAlarm() {}
}

function deviceHub(code = DEVICE_CODE) {
  const ctx = {
    id: { toString: () => `durable-object:${code}` },
    storage: new MemoryStorage(),
    getWebSockets: () => [],
  };
  return new DeviceHub(ctx, { SEVEN_AGENT_KEY: AGENT_KEY });
}

function bridgeEnvironment() {
  const hubs = new Map();
  const env = {
    SEVEN_AGENT_KEY: AGENT_KEY,
    DEVICE_HUB: {
      getByName(name) {
        if (!hubs.has(name)) {
          const code = String(name).replace(/^device:/, '');
          const hub = deviceHub(code);
          hubs.set(name, {
            fetch(input, init) {
              return hub.fetch(input instanceof Request ? input : new Request(input, init));
            },
          });
        }
        return hubs.get(name);
      },
    },
  };
  return env;
}

test('device MCP paths require an exact six-digit code and 256-bit token', () => {
  const token = 'a'.repeat(64);
  const path = deviceMcpPath(DEVICE_CODE, token);

  assert.equal(normalizeDeviceCode(DEVICE_CODE), DEVICE_CODE);
  assert.deepEqual(parseDeviceMcpPath(path), { code: DEVICE_CODE, token });
  assert.equal(parseDeviceMcpPath(path.replace(DEVICE_CODE, '111111'))?.code, '111111');
  assert.equal(parseDeviceMcpPath(`${path}0`), null);
  assert.equal(parseDeviceMcpPath('/mcp/device/493680/not-a-secret'), null);
});

test('Durable Object binding is available only for the registered, non-revoked device', async () => {
  const hub = deviceHub();
  const register = await hub.fetch(new Request('https://device.internal/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret: DEVICE_SECRET, meta: { browser: 'opera' } }),
  }));
  assert.equal(register.status, 200);

  const bindingResponse = await hub.fetch(
    new Request('https://device.internal/agent/plugin-binding'),
  );
  const binding = await bindingResponse.json();
  assert.equal(bindingResponse.status, 200);
  assert.match(binding.token, /^[0-9a-f]{64}$/);

  const allowed = await hub.fetch(
    new Request(`https://device.internal/agent/plugin-authorize?token=${binding.token}`),
  );
  assert.equal(allowed.status, 200);

  const changedToken = `${binding.token.slice(0, -1)}${binding.token.endsWith('0') ? '1' : '0'}`;
  const denied = await hub.fetch(
    new Request(`https://device.internal/agent/plugin-authorize?token=${changedToken}`),
  );
  assert.equal(denied.status, 404);

  const otherHub = deviceHub('111111');
  const otherRegister = await otherHub.fetch(new Request('https://device.internal/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret: DEVICE_SECRET, meta: { browser: 'opera' } }),
  }));
  assert.equal(otherRegister.status, 200);
  const deniedOnOtherCode = await otherHub.fetch(
    new Request(`https://device.internal/agent/plugin-authorize?token=${binding.token}`),
  );
  assert.equal(deniedOnOtherCode.status, 404);

  const revoke = await hub.fetch(new Request('https://device.internal/revoke', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret: DEVICE_SECRET }),
  }));
  assert.equal(revoke.status, 200);

  const deniedAfterRevoke = await hub.fetch(
    new Request(`https://device.internal/agent/plugin-authorize?token=${binding.token}`),
  );
  assert.equal(deniedAfterRevoke.status, 404);
});

test('plugin path is issued server-side only and is bound to the requested registered code', async () => {
  const env = bridgeEnvironment();
  const registration = await bridge.fetch(new Request('https://bridge.example/v1/device/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: DEVICE_CODE, secret: DEVICE_SECRET }),
  }), env);
  assert.equal(registration.status, 200);

  const browserRequest = await bridge.fetch(new Request(
    `https://bridge.example/v1/plugin/path?code=${DEVICE_CODE}`,
    {
      headers: {
        authorization: `Bearer ${AGENT_KEY}`,
        origin: 'https://chatgpt.com',
      },
    },
  ), env);
  assert.equal(browserRequest.status, 403);

  const issued = await bridge.fetch(new Request(
    `https://bridge.example/v1/plugin/path?code=${DEVICE_CODE}`,
    { headers: { authorization: `Bearer ${AGENT_KEY}` } },
  ), env);
  const body = await issued.json();
  assert.equal(issued.status, 200);
  assert.equal(body.code, DEVICE_CODE);
  assert.deepEqual(parseDeviceMcpPath(new URL(body.mcpUrl).pathname), {
    code: DEVICE_CODE,
    token: parseDeviceMcpPath(body.mcpPath).token,
  });

  const unavailable = await bridge.fetch(new Request(
    'https://bridge.example/v1/plugin/path?code=111111',
    { headers: { authorization: `Bearer ${AGENT_KEY}` } },
  ), env);
  assert.equal(unavailable.status, 404);
});
