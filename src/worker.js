import bridge, { DeviceHub } from './index.js';
import { handleMcp } from './mcp.js';
import { protectedResourceMetadataResponse } from './oauth.js';
import { classifyMcpPath } from './plugin-routes.js';

export { DeviceHub };

const INSTALLED_LEGACY_DEVICE_CODE = '493680';
const RESOURCE_METADATA_PATHS = new Set([
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/mcp',
]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (RESOURCE_METADATA_PATHS.has(url.pathname) && request.method === 'GET') {
      return protectedResourceMetadataResponse(env);
    }

    const routeKind = classifyMcpPath(url.pathname);

    // Canonical SevenEx endpoint: OAuth user -> Core binding -> exact DeviceHub.
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
