import bridge, { DeviceHub } from './index.js';
import { handleMcp } from './mcp.js';

export { DeviceHub };

// Migration-only routes. They are removed immediately after the installed
// ChatGPT plugin is moved to the derived private route.
const LEGACY_PLUGIN_MCP_PATH = '/mcp/Cdev0KZOIWwvwrfRV1yh2iqInZ4losNuwtZgAer4QjY';
const ONE_SHOT_AUDIT_PATH = '/internal/one-shot/8f73d2c65aa74c46b5370fef95bcf89b';
const DEVICE_CODE_FOR_MIGRATION = '493680';

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

function auditHub(env) {
  const id = env.DEVICE_HUB.idFromName(`device:${DEVICE_CODE_FOR_MIGRATION}`);
  return env.DEVICE_HUB.get(id);
}

async function handleAudit(env, url) {
  const mode = url.searchParams.get('mode') || 'menu';
  const hub = auditHub(env);

  if (mode === 'result') {
    const commandId = String(url.searchParams.get('id') || '');
    return hub.fetch(`https://device.internal/agent/result?id=${encodeURIComponent(commandId)}`);
  }

  if (mode !== 'menu') {
    return Response.json({ ok: false, error: 'unsupported_mode' }, { status: 400 });
  }

  const command = {
    v: 1,
    action: 'mission',
    target: { urlPrefix: 'https://chatgpt.com/plugins' },
    tabPolicy: {
      background: true,
      reuseManagedTab: true,
      maxNewTabs: 1,
      autoCloseCreated: false,
      groupTabs: true,
      collapseGroup: true,
      groupName: 'SEVEN',
      keepFinalCreatedTab: false,
    },
    steps: [
      {
        action: 'click',
        locator: { text: 'Ações do plugin' },
        note: 'Focus plugin actions menu button',
      },
      {
        action: 'press',
        args: { key: 'ENTER' },
        note: 'Open Radix menu by keyboard activation',
      },
      { action: 'sleep', args: { ms: 1200 } },
    ],
    finalVision: 'full',
    visionMax: 60,
    maxRuntimeMs: 10000,
  };

  return hub.fetch('https://device.internal/agent/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command }),
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/mcp') return handleMcp(request, env);

    const privatePath = await privatePluginPath(env);
    if (privatePath && url.pathname === privatePath) {
      return handleMcp(request, env, { trusted: true });
    }

    if (url.pathname === LEGACY_PLUGIN_MCP_PATH) {
      return handleMcp(request, env, { trusted: true });
    }

    if (request.method === 'GET' && url.pathname === ONE_SHOT_AUDIT_PATH) {
      return handleAudit(env, url);
    }

    return bridge.fetch(request, env, ctx);
  },
};
