import bridge, { DeviceHub } from "./index.js";
import { handleMcp } from "./mcp.js";

export { DeviceHub };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/mcp") {
      return handleMcp(request, env);
    }
    return bridge.fetch(request, env, ctx);
  },
};
