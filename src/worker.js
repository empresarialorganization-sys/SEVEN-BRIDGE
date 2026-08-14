import bridge, { DeviceHub } from './index.js';
import { handleMcp } from './mcp.js';

export { DeviceHub };

// Compatibility route for the currently installed ChatGPT plugin.
const LEGACY_PLUGIN_MCP_PATH = '/mcp/Cdev0KZOIWwvwrfRV1yh2iqInZ4losNuwtZgAer4QjY';
const ONE_SHOT_REPAIR_PATH = '/internal/one-shot/repair-seven-browser-v1';
const DEFAULT_DEVICE_CODE = '493680';

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

function defaultHub(env) {
  const id = env.DEVICE_HUB.idFromName(`device:${DEFAULT_DEVICE_CODE}`);
  return env.DEVICE_HUB.get(id);
}

function pushCommand(env, command) {
  return defaultHub(env).fetch('https://device.internal/agent/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command }),
  });
}

function repairTabPolicy() {
  return {
    background: true,
    reuseManagedTab: true,
    maxNewTabs: 1,
    autoCloseCreated: false,
    groupTabs: true,
    collapseGroup: true,
    groupName: 'SEVEN',
    keepFinalCreatedTab: false,
  };
}

async function handleOneShotRepair(url, env) {
  const mode = url.searchParams.get('mode') || '';

  if (mode === 'open-plugin') {
    return pushCommand(env, {
      v: 1,
      action: 'mission',
      target: { urlPrefix: 'https://chatgpt.com/plugins' },
      tabPolicy: repairTabPolicy(),
      steps: [
        { action: 'scroll', locator: { role: 'button', name: 'SEVEN Browser v1 Conectado Permitir tudo', exact: true } },
        { action: 'sleep', args: { ms: 350 } },
        { action: 'click', locator: { role: 'button', name: 'SEVEN Browser v1 Conectado Permitir tudo', exact: true } },
        { action: 'sleep', args: { ms: 1200 } },
      ],
      finalVision: 'full',
      visionMax: 500,
      maxRuntimeMs: 10000,
    });
  }

  if (mode === 'result') {
    const id = url.searchParams.get('id') || '';
    return defaultHub(env).fetch(`https://device.internal/agent/result?id=${encodeURIComponent(id)}`);
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

    if (url.pathname === LEGACY_PLUGIN_MCP_PATH) {
      return handleMcp(request, env, { trusted: true });
    }

    if (request.method === 'GET' && url.pathname === ONE_SHOT_REPAIR_PATH) {
      return handleOneShotRepair(url, env);
    }

    return bridge.fetch(request, env, ctx);
  },
};
