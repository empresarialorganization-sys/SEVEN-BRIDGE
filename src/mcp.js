import { McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { enforceIslandRules } from './policy.js';
import { MCP_VERSION } from './version.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_DEVICE_CODE = '493680';

function defaultHub(env) {
  const id = env.DEVICE_HUB.idFromName(`device:${DEFAULT_DEVICE_CODE}`);
  return env.DEVICE_HUB.get(id);
}

function constantTimeEqual(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authorized(request, env) {
  const configured = String(env.SEVEN_AGENT_KEY || '');
  if (configured.length < 32) return false;
  const auth = request.headers.get('authorization') || '';
  return auth.startsWith('Bearer ') && constantTimeEqual(auth.slice(7), configured);
}

async function responseJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: 'invalid_bridge_response', status: response.status };
  }
}

function textResult(data, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    ...(isError ? { isError: true } : {}),
  };
}

function createServer(env) {
  const server = new McpServer(
    { name: 'SEVEN Browser v1', version: MCP_VERSION },
    {
      instructions:
        'This private SEVEN Browser v1 plugin is permanently bound to the user\'s default browser device. Never ask the user for a device code and never mention pairing unless the device is actually disconnected. seven_status checks the default browser connection. seven_command queues one browser command and returns a commandId immediately. seven_result checks that command without waiting or polling internally. Never loop or wait inside a tool call. For actions that change a page, use mission or sequence so the server can enforce SEVEN island rules. Automation-created tabs stay in the background, reuse SEVEN-managed tabs, are grouped into a collapsed SEVEN island, never activate in front of the user, and only SEVEN-created temporary tabs are auto-closed.',
    },
  );

  server.registerTool(
    'seven_status',
    {
      title: 'SEVEN browser status',
      description: 'Check whether the user\'s default SEVEN browser is connected. No device code is required.',
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const response = await defaultHub(env).fetch('https://device.internal/agent/status');
      const data = await responseJson(response);
      return textResult(data, !response.ok);
    },
  );

  server.registerTool(
    'seven_command',
    {
      title: 'Send SEVEN browser command',
      description:
        'Queue exactly one command for the user\'s default SEVEN browser and return a commandId immediately. No device code is required. Never wait for browser completion inside this tool. Use seven_result separately. For click/type/press/scroll/hover/select, send a mission or sequence; direct mutating actions are rejected so the island policy cannot be bypassed.',
      inputSchema: z.object({
        command: z.record(z.string(), z.unknown()).describe('SEVEN extension command envelope.'),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ command }) => {
      let safeCommand;
      try {
        safeCommand = enforceIslandRules(command);
      } catch (error) {
        return textResult(
          { ok: false, error: error instanceof Error ? error.message : 'island_policy_error' },
          true,
        );
      }

      const response = await defaultHub(env).fetch('https://device.internal/agent/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command: safeCommand }),
      });
      const data = await responseJson(response);
      return textResult(data, !response.ok);
    },
  );

  server.registerTool(
    'seven_result',
    {
      title: 'Read SEVEN command result',
      description:
        'Check the current result of a previously queued SEVEN browser command on the default device. Returns pending, completed, or expired immediately; never waits or polls internally. No device code is required.',
      inputSchema: z.object({
        commandId: z.string().regex(UUID_RE).describe('commandId returned by seven_command.'),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ commandId }) => {
      const response = await defaultHub(env).fetch(
        `https://device.internal/agent/result?id=${encodeURIComponent(commandId)}`,
      );
      const data = await responseJson(response);
      return textResult(data, !response.ok);
    },
  );

  return server;
}

export async function handleMcp(request, env, options = {}) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': 'https://chatgpt.com',
        'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
        'access-control-allow-headers':
          'content-type,authorization,mcp-session-id,mcp-protocol-version,last-event-id,accept',
        'access-control-expose-headers': 'mcp-session-id,mcp-protocol-version',
        'access-control-max-age': '86400',
      },
    });
  }

  if (options.trusted !== true && !authorized(request, env)) {
    return Response.json(
      { jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null },
      {
        status: 401,
        headers: {
          'cache-control': 'no-store',
          'www-authenticate': 'Bearer',
        },
      },
    );
  }

  const server = createServer(env);
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  const response = await transport.handleRequest(request);

  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store');
  headers.set('access-control-allow-origin', 'https://chatgpt.com');
  headers.set('access-control-expose-headers', 'mcp-session-id,mcp-protocol-version');
  return new Response(response.body, { status: response.status, headers });
}
