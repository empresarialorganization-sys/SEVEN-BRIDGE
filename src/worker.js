import bridge, { DeviceHub } from "./index.js";
import { handleMcp } from "./mcp.js";

export { DeviceHub };

const BOOTSTRAP_PATH = "/bootstrap/x8nbheOTVggTd07DpIegVm8pYCpsMIoA";
const PLUGIN_MCP_PATH = "/mcp/Cdev0KZOIWwvwrfRV1yh2iqInZ4losNuwtZgAer4QjY";

async function bootstrapCreateApp(env) {
  const id = env.DEVICE_HUB.idFromName("device:493680");
  const hub = env.DEVICE_HUB.get(id);
  const privateMcpUrl = `https://seven-bridge.carlosdh12335.workers.dev${PLUGIN_MCP_PATH}`;
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
        action: "type",
        locator: { placeholder: "Ferramenta personalizada" },
        args: { text: "SEVEN Browser", clear: true }
      },
      {
        action: "type",
        locator: { placeholder: "Explique o que isso faz em poucas palavras" },
        args: { text: "Controla o navegador pareado pela SEVEN usando comandos rápidos, Vision e Hands.", clear: true }
      },
      {
        action: "type",
        locator: { placeholder: "https://example.com/sse" },
        args: { text: privateMcpUrl, clear: true }
      },
      { action: "sleep", args: { ms: 400 } },
      {
        action: "select",
        locator: { role: "combobox", name: "Autenticação" },
        args: { label: "Sem autenticação" }
      },
      { action: "sleep", args: { ms: 300 } },
      {
        action: "click",
        locator: { role: "checkbox", name: "Entendi e quero continuar" }
      },
      {
        action: "click",
        locator: { role: "button", name: "Criar", exact: true },
        note: "Criar o novo plugin privado SEVEN Browser"
      }
    ],
    finalVision: "full",
    visionMax: 40,
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
    if (url.pathname === PLUGIN_MCP_PATH) {
      return handleMcp(request, env, { trusted: true });
    }
    if (request.method === "GET" && url.pathname === BOOTSTRAP_PATH) {
      return bootstrapCreateApp(env);
    }
    return bridge.fetch(request, env, ctx);
  },
};
