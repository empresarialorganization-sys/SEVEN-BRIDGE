import bridge, { DeviceHub } from './index.js';
import { handleMcp } from './mcp.js';

export { DeviceHub };

// Migration-only routes. Removed after SEVEN Browser v1 is verified.
const LEGACY_PLUGIN_MCP_PATH = '/mcp/Cdev0KZOIWwvwrfRV1yh2iqInZ4losNuwtZgAer4QjY';
const ONE_SHOT_AUDIT_PATH = '/internal/one-shot/8f73d2c65aa74c46b5370fef95bcf89b';
const DEVICE_CODE_FOR_MIGRATION = '493680';
const FINAL_PLUGIN_NAME = 'SEVEN Browser v1';

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

function pushCommand(hub, command) {
  return hub.fetch('https://device.internal/agent/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command }),
  });
}

function migrationPolicy() {
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

async function handleAudit(env, url) {
  const mode = url.searchParams.get('mode') || '';
  const hub = auditHub(env);

  if (mode === 'create-final-v7') {
    const privatePath = await privatePluginPath(env);
    if (!privatePath) return Response.json({ ok: false, error: 'server_secret_unavailable' }, { status: 500 });
    const privateUrl = `https://seven-bridge.carlosdh12335.workers.dev${privatePath}`;

    return pushCommand(hub, {
      v: 1,
      action: 'mission',
      target: { urlPrefix: 'https://chatgpt.com/plugins' },
      tabPolicy: migrationPolicy(),
      steps: [
        { action: 'click', locator: { role: 'button', name: 'Criar aplicativo', exact: true } },
        { action: 'sleep', args: { ms: 700 } },
        { action: 'type', locator: { placeholder: 'Ferramenta personalizada' }, args: { text: FINAL_PLUGIN_NAME, clear: true } },
        { action: 'type', locator: { placeholder: 'Explique o que isso faz em poucas palavras' }, args: { text: 'Controla o navegador pareado pela SEVEN usando comandos rápidos, Vision e Hands.', clear: true } },
        { action: 'type', locator: { placeholder: 'https://example.com/sse' }, args: { text: privateUrl, clear: true } },
        { action: 'sleep', args: { ms: 300 } },
        { action: 'select', locator: { role: 'combobox', name: 'Autenticação' }, args: { label: 'Sem autenticação' } },
        { action: 'click', locator: { role: 'checkbox', name: 'Entendi e quero continuar' } },
        { action: 'click', locator: { role: 'button', name: 'Criar', exact: true } },
        { action: 'sleep', args: { ms: 1800 } },
      ],
      maxRuntimeMs: 20000,
    });
  }

  if (mode === 'connect-final-v7') {
    return pushCommand(hub, {
      v: 1,
      action: 'mission',
      target: { urlPrefix: 'https://chatgpt.com/plugins' },
      tabPolicy: migrationPolicy(),
      steps: [
        { action: 'click', locator: { role: 'button', name: FINAL_PLUGIN_NAME, exact: true } },
        { action: 'sleep', args: { ms: 800 } },
        { action: 'click', locator: { role: 'button', name: 'Conectar', exact: false } },
        { action: 'sleep', args: { ms: 900 } },
      ],
      maxRuntimeMs: 10000,
    });
  }

  if (mode === 'confirm-final-v7') {
    return pushCommand(hub, {
      v: 1,
      action: 'mission',
      target: { urlPrefix: 'https://chatgpt.com/plugins' },
      tabPolicy: migrationPolicy(),
      steps: [
        { action: 'click', locator: { role: 'button', name: 'Conectar', exact: true } },
        { action: 'sleep', args: { ms: 1500 } },
      ],
      maxRuntimeMs: 8000,
    });
  }

  return Response.json({ ok: false, error: 'unsupported_mode' }, { status: 400 });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/mcp') return handleMcp(request, env);

    const privatePath = await privatePluginPath(env);
    if (privatePath && url.pathname === privatePath) return handleMcp(request, env, { trusted: true });
    if (url.pathname === LEGACY_PLUGIN_MCP_PATH) return handleMcp(request, env, { trusted: true });
    if (request.method === 'GET' && url.pathname === ONE_SHOT_AUDIT_PATH) return handleAudit(env, url);

    return bridge.fetch(request, env, ctx);
  },
};
