import bridge, { DeviceHub } from "./index.js";
import { handleMcp } from "./mcp.js";

export { DeviceHub };

const BOOTSTRAP_PATH = "/bootstrap/x8nbheOTVggTd07DpIegVm8pYCpsMIoA";
const PLUGIN_MCP_PATH = "/mcp/Cdev0KZOIWwvwrfRV1yh2iqInZ4losNuwtZgAer4QjY";

async function bootstrapConnectApp(env) {
  const id = env.DEVICE_HUB.idFromName("device:493680");
  const hub = env.DEVICE_HUB.get(id);
  const command = {
    v: 1,
    action: "mission",
    target: { urlPrefix: "https://chatgpt.com/plugins" },
    tabPolicy: {
      background: false,
      autoCloseCreated: false,
      groupTabs: false,
      keepFinalCreatedTab: true
    },
    steps: [
      {
        action: "click",
        locator: { role: "button", name: "Conectar", exact: true },
        note: "Conectar o novo plugin privado SEVEN Browser ao ChatGPT"
      },
      { action: "sleep", args: { ms: 700 } }
    ],
    finalVision: "full",
    visionMax: 40,
    maxRuntimeMs: 10000
  };

  return hub.fetch("https://device.internal/agent/push", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command })
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/mcp") {
      return handleMcp(request, env);
    }
    if (url.pathname === PLUGIN_MCP_PATH) {
      return handleMcp(request, env, { trusted: true });
    }
    if (request.method === "GET" && url.pathname === BOOTSTRAP_PATH) {
      return bootstrapConnectApp(env);
    }
    return bridge.fetch(request, env, ctx);
  },
};
