import { BRIDGE_VERSION } from './version.js';

const CODE_RE = /^\d{6}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_WS_MESSAGE = 64 * 1024;
const MAX_HTTP_BODY = 64 * 1024;
const COMMAND_TTL_MS = 10 * 60 * 1000;
const RESULT_TTL_MS = 24 * 60 * 60 * 1000;

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extra,
    },
  });
}

function safeOrigin(origin) {
  if (!origin) return true;
  return (
    origin === 'https://chatgpt.com' ||
    origin === 'https://chat.openai.com' ||
    /^chrome-extension:\/\/[a-z0-9_-]+$/i.test(origin) ||
    /^opera-extension:\/\/[a-z0-9_-]+$/i.test(origin)
  );
}

function cors(request) {
  const origin = request.headers.get('origin');
  if (!safeOrigin(origin)) return null;
  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
    'access-control-max-age': '86400',
    'cache-control': 'no-store',
    vary: 'Origin',
  };
}

async function bodyJson(request) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_HTTP_BODY) {
    throw new Error('body_too_large');
  }
  try {
    return JSON.parse(raw || '{}');
  } catch {
    throw new Error('invalid_json');
  }
}

function normalizeCode(value) {
  const code = String(value || '').trim();
  return CODE_RE.test(code) ? code : null;
}

function normalizeSecret(value) {
  const secret = String(value || '');
  return secret.length >= 32 && secret.length <= 256 ? secret : null;
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isAgent(request, env) {
  const configured = String(env.SEVEN_AGENT_KEY || '');
  if (configured.length < 32) return false;
  const auth = request.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) return false;
  return constantTimeEqual(auth.slice(7), configured);
}

function hubFor(env, code) {
  const id = env.DEVICE_HUB.idFromName(`device:${code}`);
  return env.DEVICE_HUB.get(id);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = cors(request);
    if (!corsHeaders) return json({ ok: false, error: 'origin_not_allowed' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

    try {
      if (url.pathname === '/' || url.pathname === '/health') {
        return json({ ok: true, service: 'seven-bridge', version: BRIDGE_VERSION }, 200, corsHeaders);
      }

      if (url.pathname === '/v1/device/register' && request.method === 'POST') {
        const data = await bodyJson(request);
        const code = normalizeCode(data.code);
        const secret = normalizeSecret(data.secret);
        if (!code) return json({ ok: false, error: 'invalid_code' }, 400, corsHeaders);
        if (!secret) return json({ ok: false, error: 'invalid_secret' }, 400, corsHeaders);
        return hubFor(env, code).fetch('https://device.internal/register', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ secret, meta: data.meta || {} }),
        });
      }

      if (url.pathname === '/v1/device/connect' && request.method === 'GET') {
        if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
          return json({ ok: false, error: 'websocket_required' }, 426, corsHeaders);
        }
        const code = normalizeCode(url.searchParams.get('code'));
        const secret = normalizeSecret(url.searchParams.get('secret'));
        if (!code || !secret) return json({ ok: false, error: 'invalid_credentials' }, 400, corsHeaders);
        const headers = new Headers(request.headers);
        return hubFor(env, code).fetch(`https://device.internal/connect?secret=${encodeURIComponent(secret)}`, {
          method: 'GET',
          headers,
        });
      }

      if (url.pathname === '/v1/device/revoke' && request.method === 'POST') {
        const data = await bodyJson(request);
        const code = normalizeCode(data.code);
        const secret = normalizeSecret(data.secret);
        if (!code || !secret) return json({ ok: false, error: 'invalid_credentials' }, 400, corsHeaders);
        return hubFor(env, code).fetch('https://device.internal/revoke', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ secret }),
        });
      }

      if (url.pathname === '/v1/status' && request.method === 'GET') {
        if (!isAgent(request, env)) return json({ ok: false, error: 'unauthorized' }, 401, corsHeaders);
        const code = normalizeCode(url.searchParams.get('code'));
        if (!code) return json({ ok: false, error: 'invalid_code' }, 400, corsHeaders);
        return hubFor(env, code).fetch('https://device.internal/agent/status');
      }

      if (url.pathname === '/v1/push' && request.method === 'POST') {
        if (!isAgent(request, env)) return json({ ok: false, error: 'unauthorized' }, 401, corsHeaders);
        const data = await bodyJson(request);
        const code = normalizeCode(data.code);
        if (!code || !data.command || typeof data.command !== 'object') {
          return json({ ok: false, error: 'invalid_command' }, 400, corsHeaders);
        }
        return hubFor(env, code).fetch('https://device.internal/agent/push', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ command: data.command }),
        });
      }

      if (url.pathname === '/v1/result' && request.method === 'GET') {
        if (!isAgent(request, env)) return json({ ok: false, error: 'unauthorized' }, 401, corsHeaders);
        const code = normalizeCode(url.searchParams.get('code'));
        const id = String(url.searchParams.get('id') || '');
        if (!code || !UUID_RE.test(id)) {
          return json({ ok: false, error: 'invalid_request' }, 400, corsHeaders);
        }
        return hubFor(env, code).fetch(`https://device.internal/agent/result?id=${encodeURIComponent(id)}`);
      }

      return json({ ok: false, error: 'not_found' }, 404, corsHeaders);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'internal_error';
      if (message === 'body_too_large') return json({ ok: false, error: message }, 413, corsHeaders);
      if (message === 'invalid_json') return json({ ok: false, error: message }, 400, corsHeaders);
      return json({ ok: false, error: 'internal_error' }, 500, corsHeaders);
    }
  },
};

export class DeviceHub {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async validSecret(secret) {
    const expected = await this.ctx.storage.get('secretHash');
    if (!expected) return false;
    return constantTimeEqual(await sha256(secret), expected);
  }

  async scheduleCleanup(at = Date.now() + RESULT_TTL_MS) {
    const current = await this.ctx.storage.getAlarm();
    if (!current || current > at) await this.ctx.storage.setAlarm(at);
  }

  async expireCommand(id, reason = 'command_expired') {
    const now = Date.now();
    await this.ctx.storage.delete(`cmd:${id}`);
    await this.ctx.storage.put(`res:${id}`, {
      payload: { ok: false, error: reason },
      completedAt: now,
      expiresAt: now + RESULT_TTL_MS,
    });
    await this.scheduleCleanup(now + RESULT_TTL_MS);
  }

  async cleanupExpired(now = Date.now()) {
    const commands = await this.ctx.storage.list({ prefix: 'cmd:' });
    for (const [key, record] of commands.entries()) {
      const id = key.slice(4);
      const expiresAt = Number(record?.expiresAt || 0);
      if (!expiresAt || expiresAt <= now) await this.expireCommand(id);
    }

    const results = await this.ctx.storage.list({ prefix: 'res:' });
    for (const [key, result] of results.entries()) {
      const expiresAt = Number(result?.expiresAt || 0);
      if (expiresAt && expiresAt <= now) await this.ctx.storage.delete(key);
    }
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/register' && request.method === 'POST') {
      const data = await bodyJson(request);
      const secret = normalizeSecret(data.secret);
      if (!secret) return json({ ok: false, error: 'invalid_secret' }, 400);

      const incomingHash = await sha256(secret);
      const currentHash = await this.ctx.storage.get('secretHash');
      const revoked = Boolean(await this.ctx.storage.get('revoked'));
      if (currentHash && revoked) return json({ ok: false, error: 'revoked' }, 403);
      if (currentHash && !constantTimeEqual(currentHash, incomingHash)) {
        return json({ ok: false, error: 'code_in_use' }, 409);
      }

      const now = Date.now();
      await this.ctx.storage.put({
        secretHash: incomingHash,
        meta: data.meta || {},
        createdAt: (await this.ctx.storage.get('createdAt')) || now,
        lastSeenAt: now,
        revoked: false,
      });
      return json({ ok: true, registered: true });
    }

    if (url.pathname === '/connect' && request.method === 'GET') {
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
        return json({ ok: false, error: 'websocket_required' }, 426);
      }
      const secret = normalizeSecret(url.searchParams.get('secret'));
      if (!secret || !(await this.validSecret(secret))) {
        return json({ ok: false, error: 'unauthorized' }, 401);
      }
      if (await this.ctx.storage.get('revoked')) return json({ ok: false, error: 'revoked' }, 403);

      for (const existing of this.ctx.getWebSockets('device')) {
        try { existing.close(4000, 'replaced_by_new_connection'); } catch {}
      }

      await this.cleanupExpired();

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.ctx.acceptWebSocket(server, ['device']);
      server.serializeAttachment({ role: 'device', connectedAt: Date.now() });
      await this.ctx.storage.put('lastSeenAt', Date.now());

      server.send(JSON.stringify({ type: 'connected', bridgeVersion: BRIDGE_VERSION }));
      await this.deliverPending(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/revoke' && request.method === 'POST') {
      const data = await bodyJson(request);
      const secret = normalizeSecret(data.secret);
      if (!secret || !(await this.validSecret(secret))) return json({ ok: false, error: 'unauthorized' }, 401);
      await this.ctx.storage.put('revoked', true);
      for (const ws of this.ctx.getWebSockets('device')) {
        try { ws.close(4001, 'device_revoked'); } catch {}
      }
      return json({ ok: true, revoked: true });
    }

    if (url.pathname === '/agent/status') {
      await this.cleanupExpired();
      const sockets = this.ctx.getWebSockets('device');
      const lastSeenAt = (await this.ctx.storage.get('lastSeenAt')) || null;
      const meta = (await this.ctx.storage.get('meta')) || {};
      const revoked = Boolean(await this.ctx.storage.get('revoked'));
      return json({ ok: true, connected: !revoked && sockets.length > 0, connections: sockets.length, lastSeenAt, meta, revoked });
    }

    if (url.pathname === '/agent/push' && request.method === 'POST') {
      if (await this.ctx.storage.get('revoked')) return json({ ok: false, error: 'revoked' }, 403);
      const data = await bodyJson(request);
      if (!data.command || typeof data.command !== 'object') return json({ ok: false, error: 'invalid_command' }, 400);

      await this.cleanupExpired();
      const now = Date.now();
      const id = crypto.randomUUID();
      const record = { id, command: data.command, createdAt: now, expiresAt: now + COMMAND_TTL_MS, status: 'pending' };
      await this.ctx.storage.put(`cmd:${id}`, record);
      await this.scheduleCleanup(record.expiresAt);
      const delivered = this.sendCommand(record);
      return json({ ok: true, commandId: id, delivered });
    }

    if (url.pathname === '/agent/result') {
      const id = String(url.searchParams.get('id') || '');
      if (!UUID_RE.test(id)) return json({ ok: false, error: 'invalid_id' }, 400);

      const result = await this.ctx.storage.get(`res:${id}`);
      if (result) {
        if (Number(result.expiresAt || 0) && Number(result.expiresAt) <= Date.now()) {
          await this.ctx.storage.delete(`res:${id}`);
          return json({ ok: true, status: 'expired' });
        }
        return json({ ok: true, status: 'completed', result });
      }

      const command = await this.ctx.storage.get(`cmd:${id}`);
      if (command && Number(command.expiresAt || 0) <= Date.now()) {
        await this.expireCommand(id);
        const expired = await this.ctx.storage.get(`res:${id}`);
        return json({ ok: true, status: 'completed', result: expired });
      }
      return json({ ok: true, status: command ? 'pending' : 'expired' });
    }

    return json({ ok: false, error: 'not_found' }, 404);
  }

  sendCommand(record, socket = null) {
    if (!record || Number(record.expiresAt || 0) <= Date.now()) return 0;
    const message = JSON.stringify({ type: 'command', id: record.id, command: record.command });
    let delivered = 0;
    const sockets = socket ? [socket] : this.ctx.getWebSockets('device');
    for (const ws of sockets) {
      try { ws.send(message); delivered++; } catch {}
    }
    return delivered;
  }

  async deliverPending(socket) {
    const now = Date.now();
    const pending = await this.ctx.storage.list({ prefix: 'cmd:' });
    for (const [key, record] of pending.entries()) {
      const id = key.slice(4);
      if (!record || Number(record.expiresAt || 0) <= now) {
        await this.expireCommand(id);
        continue;
      }
      if (record.status === 'pending') this.sendCommand(record, socket);
    }
  }

  async webSocketMessage(ws, message) {
    try {
      const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
      if (new TextEncoder().encode(text).byteLength > MAX_WS_MESSAGE) {
        ws.close(1009, 'message_too_large');
        return;
      }
      const data = JSON.parse(text);
      await this.ctx.storage.put('lastSeenAt', Date.now());

      if (data?.type === 'heartbeat') {
        ws.send(JSON.stringify({ type: 'heartbeat_ack', at: Date.now() }));
        return;
      }

      if (data?.type === 'result' && UUID_RE.test(String(data.id || ''))) {
        const id = String(data.id);
        const command = await this.ctx.storage.get(`cmd:${id}`);
        if (!command) {
          ws.send(JSON.stringify({ type: 'result_ack', id, ignored: true }));
          return;
        }
        if (Number(command.expiresAt || 0) <= Date.now()) {
          await this.expireCommand(id);
          ws.send(JSON.stringify({ type: 'result_ack', id, expired: true }));
          return;
        }

        const now = Date.now();
        const result = { payload: data.payload ?? null, completedAt: now, expiresAt: now + RESULT_TTL_MS };
        await this.ctx.storage.put(`res:${id}`, result);
        await this.ctx.storage.delete(`cmd:${id}`);
        await this.scheduleCleanup(result.expiresAt);
        ws.send(JSON.stringify({ type: 'result_ack', id }));
        return;
      }

      if (data?.type === 'hello') {
        ws.send(JSON.stringify({ type: 'hello_ack', at: Date.now() }));
      }
    } catch {
      try { ws.send(JSON.stringify({ type: 'error', error: 'invalid_message' })); } catch {}
    }
  }

  async webSocketClose() {}
  async webSocketError() {}

  async alarm() {
    await this.cleanupExpired();
    let nextAt = null;
    for (const record of (await this.ctx.storage.list({ prefix: 'cmd:' })).values()) {
      const expiresAt = Number(record?.expiresAt || 0);
      if (expiresAt && (!nextAt || expiresAt < nextAt)) nextAt = expiresAt;
    }
    for (const result of (await this.ctx.storage.list({ prefix: 'res:' })).values()) {
      const expiresAt = Number(result?.expiresAt || 0);
      if (expiresAt && (!nextAt || expiresAt < nextAt)) nextAt = expiresAt;
    }
    if (nextAt) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, nextAt));
  }
}
