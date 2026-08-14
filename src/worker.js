import bridge, { DeviceHub } from "./index.js";
import { handleMcp } from "./mcp.js";

export { DeviceHub };

const BOOTSTRAP_PATH = "/bootstrap/x8nbheOTVggTd07DpIegVm8pYCpsMIoA";

async function bootstrapCreateApp(env) {
  const id = env.DEVICE_HUB.idFromName("device:493680");
  const hub = env.DEVICE_HUB.get(id);
  const command = {
    v: 1,
    action: "mission",
    tabPolicy: {
      background: false,
      autoCloseCreated: false,
      groupTabs: false,
      keepFinalCreatedTab: true
    },
    steps: [
      {
        action: "open",
        args: { url: "https://chatgpt.com/plugins", active: true },
        loadTimeoutMs: 10000
      },
      {
        action: "wait",
        locator: { role: "button", name: "Criar app", exact: true },
        timeoutMs: 10000
      },
      {
        action: "click",
        locator: { role: "button", name: "Criar app", exact: true },
        note: "Abrir o criador do novo app SEVEN"
      }
    ],
    finalVision: "full",
    visionMax: 30,
    maxRuntimeMs: 20000
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
    if (request.method === "GET" && url.pathname === BOOTSTRAP_PATH) {
      return bootstrapCreateApp(env);
    }
    return bridge.fetch(request, env, ctx);
  },
};
