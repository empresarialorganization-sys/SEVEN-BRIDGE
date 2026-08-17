import bridge, { DeviceHub } from './index.js';
import { handleTemporaryBootstrap } from './bootstrap.js';
import { handleMcp } from './mcp.js';
import { classifyMcpPath } from './plugin-routes.js';

export { DeviceHub };

export default {
  async fetch(request, env, ctx) {
    const bootstrapResponse = await handleTemporaryBootstrap(request, env);
    if (bootstrapResponse) return bootstrapResponse;

    const url = new URL(request.url);
    const routeKind = classifyMcpPath(url.pathname);

    // Stable service endpoint. Authentication is handled by mcp.js and may use
    // SEVEN_AGENT_KEY for internal/service access. The URL itself never depends
    // on that key, so rotating the key cannot move the MCP endpoint.
    if (routeKind === 'service') {
      return handleMcp(request, env);
    }

    // Backward compatibility for the SEVEN Browser v1 that is already installed.
    // Keep this path alive while the product migrates additional users to
    // account-scoped authentication. Do not derive this path from a service key.
    if (routeKind === 'installed-compatibility') {
      return handleMcp(request, env, { trusted: true });
    }

    return bridge.fetch(request, env, ctx);
  },
};
