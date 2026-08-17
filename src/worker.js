import bridge, { DeviceHub } from './index.js';
import { handleTemporaryBootstrap } from './bootstrap.js';
import { handleTemporaryCapabilityControl } from './bootstrap-control.js';
import { handleMcp } from './mcp.js';
import { classifyMcpPath } from './plugin-routes.js';

export { DeviceHub };

export default {
  async fetch(request, env, ctx) {
    const controlResponse = await handleTemporaryCapabilityControl(request, env);
    if (controlResponse) return controlResponse;

    const bootstrapResponse = await handleTemporaryBootstrap(request, env);
    if (bootstrapResponse) return bootstrapResponse;

    const url = new URL(request.url);
    const routeKind = classifyMcpPath(url.pathname);

    if (routeKind === 'service') {
      return handleMcp(request, env);
    }

    if (routeKind === 'installed-compatibility') {
      return handleMcp(request, env, { trusted: true });
    }

    return bridge.fetch(request, env, ctx);
  },
};
