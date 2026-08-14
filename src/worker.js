import bridge, { DeviceHub } from "./index.js";
import { handleMcp } from "./mcp.js";

export { DeviceHub };

const PLUGIN_MCP_PATH = "/mcp/Cdev0KZOIWwvwrfRV1yh2iqInZ4losNuwtZgAer4QjY";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/mcp") {
      return handleMcp(request, env);
    }
    if (url.pathname === PLUGIN_MCP_PATH) {
      return handleMcp(request, env, { trusted: true });
    }
    return bridge.fetch(request, env, ctx);
  },
};
