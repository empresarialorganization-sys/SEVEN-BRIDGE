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
    target: { urlPrefix: "https://chatgpt.com/plugins" },
    steps: [
      {
        action: "click",
        locator: { role: "button", name: "Criar app", exact: true },
        note: "Abrir o criador do novo app SEVEN"
      }
    ],
    finalVision: "full",
    visionMax: 30,
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
    if (request.method === "GET" && url.pathname === BOOTSTRAP_PATH) {
      return bootstrapCreateApp(env);
    }
    return bridge.fetch(request, env, ctx);
  },
};
