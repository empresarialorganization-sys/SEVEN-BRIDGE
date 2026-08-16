import { McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { hubForDevice, resolveSevenExBinding, verifyHubBinding } from './binding.js';
import { normalizeLiveCommand } from './command.js';
import { operatorCompatibility, publicDeviceStatus } from './contract.js';
import { authenticateSevenExRequest, oauthErrorResponse } from './oauth.js';
import { enforceIslandRules } from './policy.js';
import { MCP_VERSION } from './version.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function serviceErrorResponse(error, status = 503) {
  return Response.json(
    { jsonrpc: '2.0', error: { code: -32001, message: error }, id: null },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

async function currentStatus(hub) {
  const response = await hub.fetch('https://device.internal/agent/status');
  const data = await responseJson(response);
  return { response, data };
}

function createServer(hub, { legacy = false } = {}) {
  const server = new McpServer(
    { name: 'SevenEx', version: MCP_VERSION },
    {
      instructions:
        'SevenEx is a thin browser transport with exactly three tools: status, command and result. Account, workspace and browser selection are resolved server-side. Never ask for or accept a device code in tool input. seven_command queues one command and returns immediately; seven_result reads it without internal polling. Browser mutations must use mission or sequence so Bridge policy remains enforceable.',
    },
  );

  server.registerTool(
    'seven_status',
    {
      title: 'SevenEx status',
      description: 'Check the signed-in user’s explicitly selected SevenEx browser.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const { response, data } = await currentStatus(hub);
      if (!response.ok || data?.ok !== true) return textResult({ ok: false, error: 'device_status_failed' }, true);
      const compatibility = legacy ? null : operatorCompatibility(data.meta);
      return textResult(publicDeviceStatus(data, compatibility));
    },
  );

  server.registerTool(
    'seven_command',
    {
      title: 'SevenEx command',
      description:
        'Queue exactly one browser command for the signed-in user’s selected browser and return commandId immediately. Use seven_result separately.',
      inputSchema: z.object({ command: z.record(z.string(), z.unknown()).describe('SEVEN browser command envelope with an action.') }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ command }) => {
      const { response: statusResponse, data: status } = await currentStatus(hub);
      if (!statusResponse.ok || status?.ok !== true) return textResult({ ok: false, error: 'device_status_failed' }, true);
      if (status.connected !== true) return textResult({ ok: false, error: 'extension_offline' }, true);
      if (!legacy) {
        const compatibility = operatorCompatibility(status.meta);
        if (!compatibility.ok) return textResult({ ok: false, error: 'operator_update_required', compatibility }, true);
      }

      let safeCommand;
      try {
        safeCommand = enforceIslandRules(normalizeLiveCommand(command));
      } catch (error) {
        return textResult({ ok: false, error: error instanceof Error ? error.message : 'island_policy_error' }, true);
      }

      const response = await hub.fetch('https://device.internal/agent/push', {
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
      title: 'SevenEx result',
      description: 'Read one queued SevenEx command result without waiting or internal polling.',
      inputSchema: z.object({ commandId: z.string().regex(UUID_RE).describe('commandId returned by seven_command.') }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ commandId }) => {
      const response = await hub.fetch(`https://device.internal/agent/result?id=${encodeURIComponent(commandId)}`);
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
        'access-control-allow-headers': 'content-type,authorization,mcp-session-id,mcp-protocol-version,last-event-id,accept',
        'access-control-expose-headers': 'mcp-session-id,mcp-protocol-version',
        'access-control-max-age': '86400',
      },
    });
  }

  let hub;
  let legacy = false;
  if (options.trusted === true && /^\d{6}$/.test(String(options.legacyDeviceCode || ''))) {
    legacy = true;
    hub = hubForDevice(env, String(options.legacyDeviceCode));
  } else {
    const identity = await authenticateSevenExRequest(request, env);
    if (!identity.ok) return oauthErrorResponse(identity.error, identity.status, env);

    const binding = await resolveSevenExBinding(identity, env);
    if (!binding.ok) {
      if (binding.status === 401) return oauthErrorResponse(binding.error, binding.status, env);
      return serviceErrorResponse(binding.error, binding.status);
    }

    hub = hubForDevice(env, binding.deviceCode);
    const verified = await verifyHubBinding(hub, binding);
    if (!verified.ok) return serviceErrorResponse(verified.error, verified.status);
  }

  const server = createServer(hub, { legacy });
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  const response = await transport.handleRequest(request);

  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store');
  headers.set('access-control-allow-origin', 'https://chatgpt.com');
  headers.set('access-control-expose-headers', 'mcp-session-id,mcp-protocol-version');
  return new Response(response.body, { status: response.status, headers });
}
