import bridge, { DeviceHub } from './index.js';
import { parseDeviceMcpPath } from './device-binding.js';
import { DEFAULT_DEVICE_CODE, handleMcp } from './mcp.js';

export { DeviceHub };

// Compatibility route for the currently installed ChatGPT plugin.
const LEGACY_PLUGIN_MCP_PATH = '/mcp/Cdev0KZOIWwvwrfRV1yh2iqInZ4losNuwtZgAer4QjY';
const INSTALLED_PLUGIN_MCP_PATH = '/mcp/plugin/c34f53c6e21af2f4182cb633867c7031bd51b1e9415872ac';

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
      return handleMcp(request, env, { deviceCode: DEFAULT_DEVICE_CODE });
    }

    const deviceBinding = parseDeviceMcpPath(url.pathname);
    if (deviceBinding) {
      const authorization = await env.DEVICE_HUB
        .getByName(`device:${deviceBinding.code}`)
        .fetch(
          `https://device.internal/agent/plugin-authorize?token=${encodeURIComponent(deviceBinding.token)}`,
        );
      if (!authorization.ok) {
        return Response.json({ ok: false, error: 'not_found' }, {
          status: 404,
          headers: { 'cache-control': 'no-store' },
        });
      }
      return handleMcp(request, env, { trusted: true, deviceCode: deviceBinding.code });
    }

    const privatePath = await privatePluginPath(env);
    if (privatePath && url.pathname === privatePath) {
      return handleMcp(request, env, { trusted: true, deviceCode: DEFAULT_DEVICE_CODE });
    }

    // Temporary User #1 compatibility. These routes are removed immediately
    // after the installed connector is migrated to its device-bound URL.
    if (url.pathname === LEGACY_PLUGIN_MCP_PATH || url.pathname === INSTALLED_PLUGIN_MCP_PATH) {
      return handleMcp(request, env, { trusted: true, deviceCode: DEFAULT_DEVICE_CODE });
    }

    return bridge.fetch(request, env, ctx);
  },
};
