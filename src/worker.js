import bridge, { DeviceHub } from './index.js';
import { handleMcp } from './mcp.js';

export { DeviceHub };

// Compatibility route for the currently installed ChatGPT plugin.
// Keep it only until the plugin is migrated to the derived private route below.
const LEGACY_PLUGIN_MCP_PATH = '/mcp/Cdev0KZOIWwvwrfRV1yh2iqInZ4losNuwtZgAer4QjY';

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

    return bridge.fetch(request, env, ctx);
  },
};
