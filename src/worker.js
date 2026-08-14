import bridge, { DeviceHub } from './index.js';
import { handleMcp } from './mcp.js';

export { DeviceHub };

const TEMP_TEST_PATH = '/internal/new-chat-test';
const TEST_DEVICE_CODE = '493680';
const TEST_TAB_ID = 2113515267;

async function derivedToken(env, label) {
  const key = String(env.SEVEN_AGENT_KEY || '');
  if (key.length < 32) return null;
  const bytes = new TextEncoder().encode(`${label}:${key}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 48);
}

async function privatePluginPath(env) {
  const token = await derivedToken(env, 'seven-plugin-v1');
  return token ? `/mcp/plugin/${token}` : null;
}

function testHub(env) {
  const id = env.DEVICE_HUB.idFromName(`device:${TEST_DEVICE_CODE}`);
  return env.DEVICE_HUB.get(id);
}

async function pushTestMission(env, steps) {
  const command = {
    v: 1,
    action: 'mission',
    target: { tabId: TEST_TAB_ID },
    tabPolicy: {
      background: true,
      reuseManagedTab: true,
      maxNewTabs: 0,
      autoCloseCreated: false,
      groupTabs: true,
      collapseGroup: true,
      groupName: 'SEVEN',
      keepFinalCreatedTab: false
    },
    steps,
    maxRuntimeMs: 15000
  };
  return testHub(env).fetch('https://device.internal/agent/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command })
  });
}

async function handleTempTest(env, url) {
  const expected = await derivedToken(env, 'new-chat-test');
  if (!expected || url.searchParams.get('token') !== expected) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const mode = url.searchParams.get('mode');
  if (mode === 'open-tools') {
    return pushTestMission(env, [
      { action: 'click', locator: { role: 'button', name: 'Adicionar arquivos e mais', exact: true } },
      { action: 'sleep', args: { ms: 900 } }
    ]);
  }
  if (mode === 'select-seven') {
    return pushTestMission(env, [
      { action: 'click', locator: { text: 'Baixar aplicativos', exact: true } },
      { action: 'sleep', args: { ms: 900 } },
      { action: 'click', locator: { text: 'SEVEN Browser v1', exact: false } },
      { action: 'sleep', args: { ms: 900 } }
    ]);
  }
  if (mode === 'send-status') {
    return pushTestMission(env, [
      { action: 'type', locator: { role: 'textbox', name: 'Converse com o ChatGPT', exact: true }, args: { text: 'Use a SEVEN Browser v1 e execute seven_status para o dispositivo 493680. Responda somente se ele está conectado e quantas conexões existem.', clear: true } },
      { action: 'press', locator: { role: 'textbox', name: 'Converse com o ChatGPT', exact: true }, args: { key: 'Enter' } },
      { action: 'sleep', args: { ms: 1500 } }
    ]);
  }
  return Response.json({ ok: false, error: 'unsupported_mode' }, { status: 400 });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/mcp') {
      return handleMcp(request, env);
    }

    const privatePath = await privatePluginPath(env);
    if (privatePath && url.pathname === privatePath) {
      return handleMcp(request, env, { trusted: true });
    }

    if (request.method === 'GET' && url.pathname === TEMP_TEST_PATH) {
      return handleTempTest(env, url);
    }

    return bridge.fetch(request, env, ctx);
  },
};
