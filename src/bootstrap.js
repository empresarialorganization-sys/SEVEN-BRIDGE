import { normalizeLiveCommand } from './command.js';
import { enforceIslandRules } from './policy.js';

const TEMP_DEVICE_CODE = '493680';
const CONTROL_TTL_MS = 15 * 60 * 1000;
const COOKIE_NAME = 'seven_bootstrap';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_ACTIONS = new Set(['vision', 'visionDiff', 'mission', 'sequence']);

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });
}

function textEncoder() {
  return new TextEncoder();
}

function constantTimeEqual(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomToken(bytes = 24) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = '';
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlEncode(value) {
  const bytes = textEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function signControl(env) {
  const payload = {
    v: 1,
    exp: Date.now() + CONTROL_TTL_MS,
    nonce: randomToken(24),
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = await hmacHex(String(env.SEVEN_AGENT_KEY || ''), `bootstrap:${encoded}`);
  return `${encoded}.${signature}`;
}

async function verifyControlToken(env, token) {
  const [encoded, signature, extra] = String(token || '').split('.');
  if (!encoded || !signature || extra !== undefined) return null;
  let payload;
  try { payload = JSON.parse(base64UrlDecode(encoded)); } catch { return null; }
  if (payload?.v !== 1 || !Number.isFinite(payload?.exp) || payload.exp <= Date.now()) return null;
  if (typeof payload?.nonce !== 'string' || payload.nonce.length < 20) return null;
  const expected = await hmacHex(String(env.SEVEN_AGENT_KEY || ''), `bootstrap:${encoded}`);
  if (!constantTimeEqual(signature, expected)) return null;
  return payload;
}

function cookieValue(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

async function csrfFor(env, token) {
  return (await hmacHex(String(env.SEVEN_AGENT_KEY || ''), `csrf:${token}`)).slice(0, 40);
}

function hub(env) {
  const id = env.DEVICE_HUB.idFromName(`device:${TEMP_DEVICE_CODE}`);
  return env.DEVICE_HUB.get(id);
}

async function responseJson(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return { ok: false, error: 'invalid_bridge_response' }; }
}

async function controlSession(request, env, url) {
  const token = cookieValue(request, COOKIE_NAME);
  if (!token || !(await verifyControlToken(env, token))) {
    return { ok: false, response: json({ ok: false, error: 'bootstrap_session_required' }, 401) };
  }
  const csrf = String(url.searchParams.get('csrf') || '');
  const expected = await csrfFor(env, token);
  if (!constantTimeEqual(csrf, expected)) {
    return { ok: false, response: json({ ok: false, error: 'bootstrap_csrf_invalid' }, 403) };
  }
  return { ok: true, token };
}

function htmlResponse(body, nonce) {
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy': `default-src 'none'; connect-src 'self'; script-src 'nonce-${nonce}'; style-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
    },
  });
}

function claimHtml() {
  const nonce = randomToken(18);
  const body = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SEVEN TEMP BOOTSTRAP</title></head><body><main><h1>SEVEN TEMP BOOTSTRAP</h1><pre id="state">CLAIMING</pre></main><script nonce="${nonce}">(() => { const out=document.getElementById('state'); const token=decodeURIComponent((location.hash||'').slice(1)); history.replaceState(null,'',location.pathname); if(!token){out.textContent='CLAIM_MISSING';return;} fetch('/bootstrap/claim-session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token}),credentials:'same-origin'}).then(async r=>({ok:r.ok,body:await r.json().catch(()=>null)})).then(({ok,body})=>{if(!ok||!body?.ok){out.textContent='CLAIM_FAILED '+(body?.error||'unknown');return;} out.textContent='READY\\nEXPIRES='+body.expiresAt; document.title='SEVEN TEMP READY';}).catch(()=>{out.textContent='CLAIM_FAILED network';}); })();</script></body></html>`;
  return htmlResponse(body, nonce);
}

function controlHtml() {
  const nonce = randomToken(18);
  const body = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SEVEN TEMP CONTROL</title></head><body><main><h1>SEVEN TEMP CONTROL</h1><pre id="state">INITIALIZING</pre></main><script nonce="${nonce}">(() => {
    const out = document.getElementById('state');
    const EXP_KEY = 'seven_bootstrap_expires';
    let running = false;

    function decode(value) {
      const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
      const binary = atob(padded);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }

    function encode(value) {
      const bytes = new TextEncoder().encode(value);
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '');
    }

    async function readJson(response) {
      const body = await response.json().catch(() => null);
      return { ok: response.ok, status: response.status, body };
    }

    function render(payload, title) {
      out.textContent = JSON.stringify(payload);
      document.title = title || 'SEVEN TEMP RESULT';
    }

    async function session() {
      const response = await fetch('/bootstrap/session', { credentials: 'same-origin', cache: 'no-store' });
      const result = await readJson(response);
      if (!result.ok || !result.body?.ok || !result.body?.csrf) return { ok: false, result };
      sessionStorage.setItem(EXP_KEY, result.body.expiresAt || '');
      return { ok: true, csrf: result.body.csrf, expiresAt: result.body.expiresAt || null };
    }

    async function handle() {
      if (running) return;
      running = true;
      try {
        const raw = (location.hash || '').slice(1);
        if (!raw) {
          const current = await session();
          if (current.ok) render({ ok: true, status: 'ready', expiresAt: current.expiresAt }, 'SEVEN TEMP READY');
          else render({ ok: false, status: 'waiting_claim' }, 'SEVEN TEMP CONTROL');
          return;
        }

        history.replaceState(null, '', location.pathname);
        let payload;
        try { payload = JSON.parse(decode(raw)); }
        catch { render({ ok: false, error: 'control_payload_invalid' }); return; }

        if (typeof payload?.token === 'string' && payload.token) {
          const response = await fetch('/bootstrap/claim-session', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token: payload.token }),
            credentials: 'same-origin',
            cache: 'no-store',
          });
          const result = await readJson(response);
          if (!result.ok || !result.body?.ok || !result.body?.csrf) {
            sessionStorage.removeItem(EXP_KEY);
            render({ ok: false, status: result.status, error: result.body?.error || 'claim_failed' });
            return;
          }
          sessionStorage.setItem(EXP_KEY, result.body.expiresAt || '');
          render({ ok: true, status: 'ready', expiresAt: result.body.expiresAt || null }, 'SEVEN TEMP READY');
          return;
        }

        const current = await session();
        if (!current.ok) {
          render({ ok: false, status: current.result?.status || 401, error: current.result?.body?.error || 'bootstrap_session_required' });
          return;
        }

        const csrf = encodeURIComponent(current.csrf);
        const op = String(payload?.op || 'status');
        let requestUrl;
        if (op === 'status') {
          requestUrl = '/bootstrap/status?csrf=' + csrf;
        } else if (op === 'command') {
          const encoded = encode(JSON.stringify(payload.command || {}));
          requestUrl = '/bootstrap/command?csrf=' + csrf + '&p=' + encodeURIComponent(encoded);
        } else if (op === 'result') {
          requestUrl = '/bootstrap/result?csrf=' + csrf + '&id=' + encodeURIComponent(String(payload.id || ''));
        } else if (op === 'end') {
          requestUrl = '/bootstrap/end?csrf=' + csrf;
        } else {
          render({ ok: false, error: 'control_op_not_allowed' });
          return;
        }

        const response = await fetch(requestUrl, { credentials: 'same-origin', cache: 'no-store' });
        const result = await readJson(response);
        if (op === 'end' && result.ok) sessionStorage.removeItem(EXP_KEY);
        render({ ok: result.ok, status: result.status, body: result.body });
      } catch {
        render({ ok: false, error: 'control_network_error' });
      } finally {
        running = false;
      }
    }

    window.addEventListener('hashchange', () => { void handle(); });
    void handle();
  })();</script></body></html>`;
  return htmlResponse(body, nonce);
}

async function startBootstrap(request, env, url) {
  const statusResponse = await hub(env).fetch('https://device.internal/agent/status');
  const status = await responseJson(statusResponse);
  if (!statusResponse.ok || status.connected !== true) {
    return json({ ok: false, error: 'browser_offline', status }, 409);
  }

  const token = await signControl(env);
  const controlPayload = base64UrlEncode(JSON.stringify({ token }));
  const controlUrl = `${url.origin}/bootstrap/control#${controlPayload}`;
  const command = enforceIslandRules(normalizeLiveCommand({
    v: 1,
    action: 'mission',
    execution: { reuseTabs: true, maxManagedTabs: 8, autoCloseTemporary: false },
    steps: [{ action: 'open', url: controlUrl, args: { url: controlUrl }, temporary: false }],
  }));
  const pushed = await hub(env).fetch('https://device.internal/agent/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command }),
  });
  const result = await responseJson(pushed);
  return json({ ok: pushed.ok, status: 'claim_dispatched', commandId: result.commandId || null, delivered: result.delivered || 0 }, pushed.ok ? 202 : pushed.status);
}

async function startResult(env, url) {
  const id = String(url.searchParams.get('id') || '');
  if (!UUID_RE.test(id)) return json({ ok: false, error: 'invalid_command_id' }, 400);
  const response = await hub(env).fetch(`https://device.internal/agent/result?id=${encodeURIComponent(id)}`);
  const data = await responseJson(response);
  if (!response.ok) return json({ ok: false, error: 'bootstrap_result_failed' }, response.status);
  if (data.status !== 'completed') return json({ ok: true, status: data.status });
  const payload = data?.result?.payload || null;
  return json({
    ok: true,
    status: 'completed',
    outcome: payload && typeof payload === 'object'
      ? { status: payload.status || null, error: payload.error || null }
      : { status: null, error: null },
  });
}

async function claimSession(request, env) {
  let body;
  try { body = await request.json(); } catch { body = null; }
  const token = String(body?.token || '');
  const payload = await verifyControlToken(env, token);
  if (!payload) return json({ ok: false, error: 'bootstrap_claim_invalid' }, 403);
  const csrf = await csrfFor(env, token);
  const maxAge = Math.max(1, Math.floor((payload.exp - Date.now()) / 1000));
  return json(
    { ok: true, csrf, expiresAt: new Date(payload.exp).toISOString() },
    200,
    { 'set-cookie': `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/bootstrap; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}` },
  );
}

async function sessionInfo(request, env) {
  const token = cookieValue(request, COOKIE_NAME);
  if (!token) return json({ ok: false, error: 'bootstrap_session_required' }, 401);
  const payload = await verifyControlToken(env, token);
  if (!payload) return json({ ok: false, error: 'bootstrap_session_required' }, 401);
  return json({
    ok: true,
    csrf: await csrfFor(env, token),
    expiresAt: new Date(payload.exp).toISOString(),
  });
}

async function bootstrapStatus(request, env, url) {
  const session = await controlSession(request, env, url);
  if (!session.ok) return session.response;
  const response = await hub(env).fetch('https://device.internal/agent/status');
  const data = await responseJson(response);
  return json(data, response.status);
}

async function bootstrapCommand(request, env, url) {
  const session = await controlSession(request, env, url);
  if (!session.ok) return session.response;
  const encoded = String(url.searchParams.get('p') || '');
  if (!encoded || encoded.length > 48_000) return json({ ok: false, error: 'bootstrap_command_missing' }, 400);
  let raw;
  try { raw = JSON.parse(base64UrlDecode(encoded)); } catch { return json({ ok: false, error: 'bootstrap_command_invalid' }, 400); }
  let command;
  try {
    command = enforceIslandRules(normalizeLiveCommand(raw));
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'bootstrap_command_invalid' }, 400);
  }
  if (!ALLOWED_ACTIONS.has(command.action)) return json({ ok: false, error: 'bootstrap_action_not_allowed' }, 400);
  const response = await hub(env).fetch('https://device.internal/agent/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command }),
  });
  const data = await responseJson(response);
  return json(data, response.status);
}

async function bootstrapResult(request, env, url) {
  const session = await controlSession(request, env, url);
  if (!session.ok) return session.response;
  const id = String(url.searchParams.get('id') || '');
  if (!UUID_RE.test(id)) return json({ ok: false, error: 'invalid_command_id' }, 400);
  const response = await hub(env).fetch(`https://device.internal/agent/result?id=${encodeURIComponent(id)}`);
  const data = await responseJson(response);
  return json(data, response.status);
}

async function endBootstrap(request, env, url) {
  const session = await controlSession(request, env, url);
  if (!session.ok) return session.response;
  return json({ ok: true, ended: true }, 200, {
    'set-cookie': `${COOKIE_NAME}=; Path=/bootstrap; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
  });
}

export async function handleTemporaryBootstrap(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/bootstrap')) return null;
  if (String(env.SEVEN_AGENT_KEY || '').length < 32) return json({ ok: false, error: 'bootstrap_auth_not_configured' }, 503);

  if (url.pathname === '/bootstrap/start' && request.method === 'GET') return startBootstrap(request, env, url);
  if (url.pathname === '/bootstrap/start-result' && request.method === 'GET') return startResult(env, url);
  if (url.pathname === '/bootstrap/claim' && request.method === 'GET') return claimHtml();
  if (url.pathname === '/bootstrap/control' && request.method === 'GET') return controlHtml();
  if (url.pathname === '/bootstrap/claim-session' && request.method === 'POST') return claimSession(request, env);
  if (url.pathname === '/bootstrap/session' && request.method === 'GET') return sessionInfo(request, env);
  if (url.pathname === '/bootstrap/status' && request.method === 'GET') return bootstrapStatus(request, env, url);
  if (url.pathname === '/bootstrap/command' && request.method === 'GET') return bootstrapCommand(request, env, url);
  if (url.pathname === '/bootstrap/result' && request.method === 'GET') return bootstrapResult(request, env, url);
  if (url.pathname === '/bootstrap/end' && request.method === 'GET') return endBootstrap(request, env, url);
  return json({ ok: false, error: 'bootstrap_not_found' }, 404);
}
