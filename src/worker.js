import bridge, { DeviceHub } from './index.js';
import { handleMcp } from './mcp.js';
import { protectedResourceMetadataResponse } from './oauth.js';
import { classifyMcpPath } from './plugin-routes.js';

export { DeviceHub };

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

    if (classifyMcpPath(url.pathname) === 'service') {
      return handleMcp(request, env);
    }

    return bridge.fetch(request, env, ctx);
  },
};
