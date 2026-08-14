const CODE_RE = /^\d{6}$/;
const MAX_WS_MESSAGE = 64 * 1024;
const MAX_HTTP_BODY = 64 * 1024;

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extra,
    },
  });
}

function safeOrigin(origin) {
  if (!origin) return true;
  return (
    origin === "https://chatgpt.com" ||
    origin === "https://chat.openai.com" ||
    /^chrome-extension:\/\/[a-z0-9_-]+$/i.test(origin) ||
    /^opera-extension:\/\/[a-z0-9_-]+$/i.test(origin)
  );
}

function cors(request) {
  const origin = request.headers.get("origin");
  if (!safeOrigin(origin)) return null;
  return {
    "access-control-allow-origin": origin || "*",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-max-age": "86400",
    "cache-control": "no-store",
    vary: "Origin",
  };
}

async function bodyJson(request) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_HTTP_BODY) {
    throw new Error("body_too_large");
  }
  return JSON.parse(raw || "{}");
}

function normalizeCode(value) {
  const code = String(value || "").trim();
  return CODE_RE.test(code) ? code : null;
}

function normalizeSecret(value) {
  const secret = String(value || "");
  return secret.length >= 32 && secret.length <= 256 ? secret : null;
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a, b) {
  a = String(a || "");
  b = String(b || "");
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isAgent(request, env) {
  const configured = String(env.SEVEN_AGENT_KEY || "");
  if (configured.length < 32) return false;
  const auth = request.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return false;
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
    if (!corsHeaders) return json({ ok: false, error: "origin_not_allowed" }, 403);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

    try {
      if (url.pathname === "/" || url.pathname === "/health") {
        return json({ ok: true, service: "seven-bridge", version: "1.0.0-test" }, 200, corsHeaders);
      }

      if (url.pathname === "/v1/device/register" && request.method === "POST") {
        const data = await bodyJson(request);
        const code = normalizeCode(data.code);
        const secret = normalizeSecret(data.secret);
        if (!code) return json({ ok: false, error: "invalid_code" }, 400, corsHeaders);
        if (!secret) return json({ ok: false, error: "invalid_secret" }, 400, corsHeaders);
        const hub = hubFor(env, code);
        return hub.fetch("https://device.internal/register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ secret, meta: data.meta || {} }),
        });
      }

      if (url.pathname === "/v1/device/connect") {
        if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
          return json({ ok: false, error: "websocket_required" }, 426, corsHeaders);
        }
        const code = normalizeCode(url.searchParams.get("code"));
        const secret = normalizeSecret(url.searchParams.get("secret"));
        if (!code || !secret) return json({ ok: false, error: "invalid_credentials" }, 400, corsHeaders);
        const hub = hubFor(env, code);
        const headers = new Headers(request.headers);
        return hub.fetch(`https://device.internal/connect?secret=${encodeURIComponent(secret)}`, {
          method: "GET",
          headers,
        });
      }

      if (url.pathname === "/v1/device/revoke" && request.method === "POST") {
        const data = await bodyJson(request);
        const code = normalizeCode(data.code);
        const secret = normalizeSecret(data.secret);
        if (!code || !secret) return json({ ok: false, error: "invalid_credentials" }, 400, corsHeaders);
        return hubFor(env, code).fetch("https://device.internal/revoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ secret }),
        });
      }

      if (url.pathname === "/v1/status" && request.method === "GET") {
        if (!isAgent(request, env)) return json({ ok: false, error: "unauthorized" }, 401, corsHeaders);
        const code = normalizeCode(url.searchParams.get("code"));
        if (!code) return json({ ok: false, error: "invalid_code" }, 400, corsHeaders);
        return hubFor(env, code).fetch("https://device.internal/agent/status");
      }

      if (url.pathname === "/v1/push" && request.method === "POST") {
        if (!isAgent(request, env)) return json({ ok: false, error: "unauthorized" }, 401, corsHeaders);
        const data = await bodyJson(request);
        const code = normalizeCode(data.code);
        if (!code || !data.command || typeof data.command !== "object") {
          return json({ ok: false, error: "invalid_command" }, 400, corsHeaders);
        }
        return hubFor(env, code).fetch("https://device.internal/agent/push", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ command: data.command }),
        });
      }

      if (url.pathname === "/v1/result" && request.method === "GET") {
        if (!isAgent(request, env)) return json({ ok: false, error: "unauthorized" }, 401, corsHeaders);
        const code = normalizeCode(url.searchParams.get("code"));
        const id = String(url.searchParams.get("id") || "");
        if (!code || !/^[0-9a-f-]{36}$/i.test(id)) {
          return json({ ok: false, error: "invalid_request" }, 400, corsHeaders);
        }
        return hubFor(env, code).fetch(`https://device.internal/agent/result?id=${encodeURIComponent(id)}`);
      }

      return json({ ok: false, error: "not_found" }, 404, corsHeaders);
    } catch (error) {
      const message = error instanceof Error ? error.message : "internal_error";
      return json({ ok: false, error: message === "body_too_large" ? message : "internal_error" }, message === "body_too_large" ? 413 : 500, corsHeaders);
    }
  },
};

export class DeviceHub {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async validSecret(secret) {
    const expected = await this.ctx.storage.get("secretHash");
    if (!expected) return false;
    return constantTimeEqual(await sha256(secret), expected);
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/register" && request.method === "POST") {
      const data = await bodyJson(request);
      const secret = normalizeSecret(data.secret);
      if (!secret) return json({ ok: false, error: "invalid_secret" }, 400);

      const incomingHash = await sha256(secret);
      const currentHash = await this.ctx.storage.get("secretHash");
      if (currentHash && !constantTimeEqual(currentHash, incomingHash)) {
        return json({ ok: false, error: "code_in_use" }, 409);
      }

      const now = Date.now();
      await this.ctx.storage.put({
        secretHash: incomingHash,
        meta: data.meta || {},
        createdAt: (await this.ctx.storage.get("createdAt")) || now,
        lastSeenAt: now,
        revoked: false,
      });
      return json({ ok: true, registered: true });
    }

    if (url.pathname === "/connect") {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return json({ ok: false, error: "websocket_required" }, 426);
      }
      const secret = normalizeSecret(url.searchParams.get("secret"));
      if (!secret || !(await this.validSecret(secret))) {
        return json({ ok: false, error: "unauthorized" }, 401);
      }
      if (await this.ctx.storage.get("revoked")) return json({ ok: false, error: "revoked" }, 403);

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.ctx.acceptWebSocket(server, ["device"]);
      server.serializeAttachment({ role: "device", connectedAt: Date.now() });
      await this.ctx.storage.put("lastSeenAt", Date.now());

      server.send(JSON.stringify({ type: "connected", bridgeVersion: "1.0.0-test" }));
      await this.deliverPending(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/revoke" && request.method === "POST") {
      const data = await bodyJson(request);
      const secret = normalizeSecret(data.secret);
      if (!secret || !(await this.validSecret(secret))) return json({ ok: false, error: "unauthorized" }, 401);
      await this.ctx.storage.put("revoked", true);
      for (const ws of this.ctx.getWebSockets("device")) {
        try { ws.close(4001, "device_revoked"); } catch {}
      }
      return json({ ok: true, revoked: true });
    }

    if (url.pathname === "/agent/status") {
      const sockets = this.ctx.getWebSockets("device");
      const lastSeenAt = (await this.ctx.storage.get("lastSeenAt")) || null;
      const meta = (await this.ctx.storage.get("meta")) || {};
      const revoked = Boolean(await this.ctx.storage.get("revoked"));
      return json({
        ok: true,
        connected: !revoked && sockets.length > 0,
        connections: sockets.length,
        lastSeenAt,
        meta,
        revoked,
      });
    }

    if (url.pathname === "/agent/push" && request.method === "POST") {
      if (await this.ctx.storage.get("revoked")) return json({ ok: false, error: "revoked" }, 403);
      const data = await bodyJson(request);
      if (!data.command || typeof data.command !== "object") return json({ ok: false, error: "invalid_command" }, 400);

      const id = crypto.randomUUID();
      const record = { id, command: data.command, createdAt: Date.now(), status: "pending" };
      await this.ctx.storage.put(`cmd:${id}`, record);
      const delivered = this.sendCommand(record);
      return json({ ok: true, commandId: id, delivered });
    }

    if (url.pathname === "/agent/result") {
      const id = String(url.searchParams.get("id") || "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ ok: false, error: "invalid_id" }, 400);
      const result = await this.ctx.storage.get(`res:${id}`);
      if (!result) return json({ ok: true, status: "pending" });
      return json({ ok: true, status: "completed", result });
    }

    return json({ ok: false, error: "not_found" }, 404);
  }

  sendCommand(record, socket = null) {
    const message = JSON.stringify({ type: "command", id: record.id, command: record.command });
    let delivered = 0;
    const sockets = socket ? [socket] : this.ctx.getWebSockets("device");
    for (const ws of sockets) {
      try {
        ws.send(message);
        delivered++;
      } catch {}
    }
    return delivered;
  }

  async deliverPending(socket) {
    const pending = await this.ctx.storage.list({ prefix: "cmd:" });
    for (const record of pending.values()) {
      if (record?.status === "pending") this.sendCommand(record, socket);
    }
  }

  async webSocketMessage(ws, message) {
    try {
      const text = typeof message === "string" ? message : new TextDecoder().decode(message);
      if (new TextEncoder().encode(text).byteLength > MAX_WS_MESSAGE) {
        ws.close(1009, "message_too_large");
        return;
      }
      const data = JSON.parse(text);
      await this.ctx.storage.put("lastSeenAt", Date.now());

      if (data?.type === "heartbeat") {
        ws.send(JSON.stringify({ type: "heartbeat_ack", at: Date.now() }));
        return;
      }

      if (data?.type === "result" && /^[0-9a-f-]{36}$/i.test(String(data.id || ""))) {
        const id = String(data.id);
        const result = { payload: data.payload ?? null, completedAt: Date.now() };
        await this.ctx.storage.put(`res:${id}`, result);
        await this.ctx.storage.delete(`cmd:${id}`);
        ws.send(JSON.stringify({ type: "result_ack", id }));
        return;
      }

      if (data?.type === "hello") {
        ws.send(JSON.stringify({ type: "hello_ack", at: Date.now() }));
      }
    } catch {
      try { ws.send(JSON.stringify({ type: "error", error: "invalid_message" })); } catch {}
    }
  }

  async webSocketClose(ws, code, reason) {
    try { ws.close(code, reason); } catch {}
  }

  async webSocketError() {}
}
