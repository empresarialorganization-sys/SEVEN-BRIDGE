import { normalizeLiveCommand } from './command.js';
import { enforceIslandRules } from './policy.js';

const TEMP_DEVICE_CODE = '493680';
const BOOTSTRAP_DEADLINE_MS = Date.parse('2026-08-17T04:30:00Z');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_ACTIONS = new Set(['vision', 'visionDiff', 'mission', 'sequence']);
const MAX_BODY_BYTES = 64 * 1024;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
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
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function decodeBase64Url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function verifyControlToken(env, token) {
  const [encoded, signature, extra] = String(token || '').split('.');
  if (!encoded || !signature || extra !== undefined) return null;
  let payload;
  try { payload = JSON.parse(decodeBase64Url(encoded)); } catch { return null; }
  if (payload?.v !== 1 || !Number.isFinite(payload?.exp) || payload.exp <= Date.now()) return null;
  if (typeof payload?.nonce !== 'string' || payload.nonce.length < 20) return null;
  const expected = await hmacHex(String(env.SEVEN_AGENT_KEY || ''), `bootstrap:${encoded}`);
  return constantTimeEqual(signature, expected) ? payload : null;
}

function hub(env) {
  return env.DEVICE_HUB.get(env.DEVICE_HUB.idFromName(`device:${TEMP_DEVICE_CODE}`));
}

async function responseJson(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return { ok: false, error: 'invalid_bridge_response' }; }
}

function controlHtml() {
  const nonceBytes = crypto.getRandomValues(new Uint8Array(18));
  let nonceBinary = '';
  for (const byte of nonceBytes) nonceBinary += String.fromCharCode(byte);
  const nonce = btoa(nonceBinary).replace(/[^a-zA-Z0-9]/g, '');
  const body = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SEVEN TEMP CONTROL</title></head><body><main><h1>SEVEN TEMP CONTROL</h1><pre id="state">RUNNING</pre></main><script nonce="${nonce}">(() => { const out=document.getElementById('state'); const encoded=(location.hash||'').slice(1); history.replaceState(null,'',location.pathname); if(!encoded){out.textContent='CONTROL_MISSING';return;} let payload; try { const n=encoded.replace(/-/g,'+').replace(/_/g,'/'); const p=n+'='.repeat((4-(n.length%4))%4); payload=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(p),c=>c.charCodeAt(0)))); } catch { out.textContent='CONTROL_INVALID'; return; } fetch('/bootstrap/execute',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),credentials:'omit'}).then(async r=>({ok:r.ok,status:r.status,body:await r.json().catch(()=>null)})).then(({ok,status,body})=>{out.textContent=JSON.stringify({ok,status,body}); document.title='SEVEN TEMP RESULT';}).catch(()=>{out.textContent='CONTROL_FAILED';}); })();</script></body></html>`;
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

async function execute(request, env) {
  const url = new URL(request.url);
  if (request.headers.get('origin') !== url.origin) {
    return json({ ok: false, error: 'bootstrap_origin_invalid' }, 403);
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return json({ ok: false, error: 'bootstrap_body_too_large' }, 413);
  }

  let body;
  try { body = JSON.parse(raw || '{}'); } catch { return json({ ok: false, error: 'bootstrap_body_invalid' }, 400); }
  const token = String(body?.token || '');
  if (!(await verifyControlToken(env, token))) return json({ ok: false, error: 'bootstrap_token_invalid' }, 403);

  const op = String(body?.op || '');
  if (op === 'status') {
    const response = await hub(env).fetch('https://device.internal/agent/status');
    return json(await responseJson(response), response.status);
  }

  if (op === 'command') {
    let command;
    try { command = enforceIslandRules(normalizeLiveCommand(body?.command)); }
    catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : 'bootstrap_command_invalid' }, 400); }
    if (!ALLOWED_ACTIONS.has(command.action)) return json({ ok: false, error: 'bootstrap_action_not_allowed' }, 400);
    const response = await hub(env).fetch('https://device.internal/agent/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command }),
    });
    return json(await responseJson(response), response.status);
  }

  if (op === 'result') {
    const id = String(body?.id || '');
    if (!UUID_RE.test(id)) return json({ ok: false, error: 'invalid_command_id' }, 400);
    const response = await hub(env).fetch(`https://device.internal/agent/result?id=${encodeURIComponent(id)}`);
    return json(await responseJson(response), response.status);
  }

  return json({ ok: false, error: 'bootstrap_operation_not_allowed' }, 400);
}

export async function handleTemporaryCapabilityControl(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== '/bootstrap/control' && url.pathname !== '/bootstrap/execute') return null;
  if (Date.now() >= BOOTSTRAP_DEADLINE_MS) return json({ ok: false, error: 'bootstrap_expired' }, 410);
  if (String(env.SEVEN_AGENT_KEY || '').length < 32) return json({ ok: false, error: 'bootstrap_auth_not_configured' }, 503);
  if (url.pathname === '/bootstrap/control' && request.method === 'GET') return controlHtml();
  if (url.pathname === '/bootstrap/execute' && request.method === 'POST') return execute(request, env);
  return json({ ok: false, error: 'bootstrap_method_not_allowed' }, 405);
}
