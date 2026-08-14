import { McpServer, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { z } from "zod";

const CODE_RE = /^\d{6}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;

const STRICT_TAB_POLICY = Object.freeze({
  background: true,
  reuseManagedTab: true,
  maxNewTabs: 3,
  autoCloseCreated: true,
  groupTabs: true,
  collapseGroup: true,
  groupName: "SEVEN",
  keepFinalCreatedTab: false,
});

function hubFor(env, code) {
  const id = env.DEVICE_HUB.idFromName(`device:${code}`);
  return env.DEVICE_HUB.get(id);
}

function constantTimeEqual(a, b) {
  a = String(a || "");
  b = String(b || "");
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authorized(request, env) {
  const configured = String(env.SEVEN_AGENT_KEY || "");
  if (configured.length < 32) return false;
  const auth = request.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") && constantTimeEqual(auth.slice(7), configured);
}

async function responseJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: "invalid_bridge_response", status: response.status };
  }
}

function textResult(data, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    ...(isError ? { isError: true } : {}),
  };
}

function sanitizeSteps(steps) {
  if (!Array.isArray(steps)) return steps;
  return steps.map((raw) => {
    const step = raw && typeof raw === "object" ? { ...raw } : raw;
    if (!step || typeof step !== "object") return step;

    const action = String(step.action || "");
    if (action === "activate") {
      throw new Error("tab_activation_blocked_by_island_policy");
    }

    if (action === "open" || action === "navigate") {
      step.args = { ...(step.args || {}), active: false };
    }

    if (action === "if") {
      step.then = sanitizeSteps(step.then);
      step.else = sanitizeSteps(step.else);
    }

    return step;
  });
}

export function enforceIslandRules(command) {
  const safe = JSON.parse(JSON.stringify(command || {}));

  if (String(safe.action || "") === "activate") {
    throw new Error("tab_activation_blocked_by_island_policy");
  }

  if (safe.action === "mission" || safe.action === "sequence") {
    safe.tabPolicy = { ...STRICT_TAB_POLICY };
    safe.steps = sanitizeSteps(safe.steps);
  }

  return safe;
}

function createServer(env) {
  const server = new McpServer(
    { name: "SEVEN Browser", version: "1.0.1" },
    {
      instructions:
        "SEVEN controls the user's paired browser through permanent 6-digit device codes. Keep every call short. seven_status checks connection. seven_command queues one browser command and returns a commandId immediately. seven_result checks that command without waiting or polling internally. Never loop or wait inside a tool call. Tab-island rules are mandatory: automation-created tabs stay in the background, reuse SEVEN-managed tabs, are grouped into a collapsed SEVEN island, never activate in front of the user, and only SEVEN-created temporary tabs are auto-closed.",
    },
  );

  server.registerTool(
    "seven_status",
    {
      title: "SEVEN device status",
      description: "Check whether a SEVEN browser device is connected. Returns immediately.",
      inputSchema: z.object({
        code: z.string().regex(CODE_RE).describe("Permanent 6-digit SEVEN device code."),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ code }) => {
      const response = await hubFor(env, code).fetch("https://device.internal/agent/status");
      const data = await responseJson(response);
      return textResult(data, !response.ok);
    },
  );

  server.registerTool(
    "seven_command",
    {
      title: "Send SEVEN browser command",
      description:
        "Queue exactly one command for the paired SEVEN browser and return a commandId immediately. Never wait for browser completion inside this tool. Use seven_result separately. Tab-island rules are enforced server-side: new work tabs stay backgrounded, grouped/collapsed under SEVEN, reused where possible, and activation is blocked.",
      inputSchema: z.object({
        code: z.string().regex(CODE_RE).describe("Permanent 6-digit SEVEN device code."),
        command: z.record(z.string(), z.unknown()).describe("SEVEN extension command envelope."),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ code, command }) => {
      let safeCommand;
      try {
        safeCommand = enforceIslandRules(command);
      } catch (error) {
        return textResult(
          { ok: false, error: error instanceof Error ? error.message : "island_policy_error" },
          true,
        );
      }

      const response = await hubFor(env, code).fetch("https://device.internal/agent/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: safeCommand }),
      });
      const data = await responseJson(response);
      return textResult(data, !response.ok);
    },
  );

  server.registerTool(
    "seven_result",
    {
      title: "Read SEVEN command result",
      description:
        "Check the current result of a previously queued SEVEN browser command. Returns pending or completed immediately; never waits or polls internally.",
      inputSchema: z.object({
        code: z.string().regex(CODE_RE).describe("Permanent 6-digit SEVEN device code."),
        commandId: z.string().regex(UUID_RE).describe("commandId returned by seven_command."),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ code, commandId }) => {
      const response = await hubFor(env, code).fetch(
        `https://device.internal/agent/result?id=${encodeURIComponent(commandId)}`,
      );
      const data = await responseJson(response);
      return textResult(data, !response.ok);
    },
  );

  return server;
}

export async function handleMcp(request, env, options = {}) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "https://chatgpt.com",
        "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
        "access-control-allow-headers":
          "content-type,authorization,mcp-session-id,mcp-protocol-version,last-event-id,accept",
        "access-control-expose-headers": "mcp-session-id,mcp-protocol-version",
        "access-control-max-age": "86400",
      },
    });
  }

  if (options.trusted !== true && !authorized(request, env)) {
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null },
      {
        status: 401,
        headers: {
          "cache-control": "no-store",
          "www-authenticate": "Bearer",
        },
      },
    );
  }

  const server = createServer(env);
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  await server.connect(transport);
  const response = await transport.handleRequest(request);

  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.set("access-control-allow-origin", "https://chatgpt.com");
  headers.set("access-control-expose-headers", "mcp-session-id,mcp-protocol-version");
  return new Response(response.body, { status: response.status, headers });
}
