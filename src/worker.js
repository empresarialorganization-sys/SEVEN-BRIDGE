import bridge, { DeviceHub } from './index.js';
import { handleMcp } from './mcp.js';

export { DeviceHub };

// Migration-only legacy route. Remove after the installed ChatGPT plugin is moved
// to the derived private route below.
const LEGACY_PLUGIN_MCP_PATH = '/mcp/Cdev0KZOIWwvwrfRV1yh2iqInZ4losNuwtZgAer4QjY';
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

async function auditBootstrapPath(env) {
  const token = await derivedToken(env, 'seven-audit-bootstrap-v1');
  return token ? `/internal/audit/${token}` : null;
}

async function pushAuditCommand(env, mode) {
  if (mode !== 'menu') {
    return Response.json({ ok: false, error: 'unsupported_mode' }, { status: 400 });
  }

  const id = env.DEVICE_HUB.idFromName(`device:${DEVICE_CODE_FOR_MIGRATION}`);
  const hub = env.DEVICE_HUB.get(id);
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
        note: 'Open plugin actions menu for secure endpoint migration',
      },
      { action: 'sleep', args: { ms: 700 } },
    ],
    finalVision: 'full',
    visionMax: 40,
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

    if (url.pathname === '/mcp') {
      return handleMcp(request, env);
    }

    const privatePath = await privatePluginPath(env);
    if (privatePath && url.pathname === privatePath) {
      return handleMcp(request, env, { trusted: true });
    }

    // Temporary compatibility during the endpoint migration only.
    if (url.pathname === LEGACY_PLUGIN_MCP_PATH) {
      return handleMcp(request, env, { trusted: true });
    }

    const bootstrapPath = await auditBootstrapPath(env);
    if (request.method === 'GET' && bootstrapPath && url.pathname === bootstrapPath) {
      return pushAuditCommand(env, url.searchParams.get('mode') || 'menu');
    }

    return bridge.fetch(request, env, ctx);
  },
};
