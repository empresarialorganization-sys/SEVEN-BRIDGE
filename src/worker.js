import bridge, { DeviceHub } from './index.js';
import { handleMcp } from './mcp.js';
import { classifyMcpPath } from './plugin-routes.js';

export { DeviceHub };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const routeKind = classifyMcpPath(url.pathname);

    // Canonical SevenEx MCP endpoint. Authentication is handled by mcp.js.
    // Its URL is stable and never derived from SEVEN_AGENT_KEY.
    if (routeKind === 'service') {
      return handleMcp(request, env);
    }

    // Transitional route for the app currently installed in ChatGPT.
    // Remove it immediately after SevenEx is repointed to /mcp and validated.
    if (routeKind === 'installed-compatibility') {
      return handleMcp(request, env, { trusted: true });
    }

    return bridge.fetch(request, env, ctx);
  },
};
