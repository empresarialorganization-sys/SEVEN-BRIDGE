import bridge, { DeviceHub } from "./index.js";
import { handleMcp, enforceIslandRules } from "./mcp.js";

export { DeviceHub };

const PLUGIN_MCP_PATH = "/mcp/Cdev0KZOIWwvwrfRV1yh2iqInZ4losNuwtZgAer4QjY";
const TEST_PATH = "/test/r21r9WNzlGHrcrqm8xhXAvx6s3ix24Qf";

function hubFor(env, code) {
  const id = env.DEVICE_HUB.idFromName(`device:${code}`);
  return env.DEVICE_HUB.get(id);
}

async function runHiddenGoogleTest(env) {
  const command = enforceIslandRules({
    v: 1,
    action: "mission",
    tabPolicy: {
      background: false,
      autoCloseCreated: false,
      groupTabs: false,
      collapseGroup: false,
      keepFinalCreatedTab: true,
      maxNewTabs: 8,
    },
    steps: [
      {
        action: "open",
        args: {
          url: "https://www.google.com/",
          active: true,
          loadTimeoutMs: 8000,
        },
      },
      {
        action: "type",
        locator: { selector: "textarea[name='q'],input[name='q']" },
        args: { text: "SEVEN modo fantasma funcionando", clear: true },
        timeoutMs: 7000,
      },
    ],
    finalVision: "full",
    visionMax: 12,
    maxRuntimeMs: 20000,
  });

  return hubFor(env, "493680").fetch("https://device.internal/agent/push", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command }),
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
    if (request.method === "GET" && url.pathname === TEST_PATH) {
      return runHiddenGoogleTest(env);
    }
    if (request.method === "GET" && url.pathname === `${TEST_PATH}/result`) {
      const id = String(url.searchParams.get("id") || "");
      return hubFor(env, "493680").fetch(
        `https://device.internal/agent/result?id=${encodeURIComponent(id)}`,
      );
    }
    return bridge.fetch(request, env, ctx);
  },
};
