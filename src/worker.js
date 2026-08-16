import bridge, { DeviceHub } from './index.js';
import { handleMcp } from './mcp.js';
import { classifyMcpPath } from './plugin-routes.js';

export { DeviceHub };

const INSTALLED_LEGACY_DEVICE_CODE = '493680';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const routeKind = classifyMcpPath(url.pathname);

    // Canonical SevenEx endpoint: account OAuth -> Core binding -> exact DeviceHub.
    if (routeKind === 'service') {
      return handleMcp(request, env);
    }

    // Temporary compatibility only for the already installed app. Never use this
    // device code in the canonical /mcp flow. Remove after SevenEx passes E2E.
    if (routeKind === 'installed-compatibility') {
      return handleMcp(request, env, {
        trusted: true,
        legacyDeviceCode: INSTALLED_LEGACY_DEVICE_CODE,
      });
    }

    return bridge.fetch(request, env, ctx);
  },
};
