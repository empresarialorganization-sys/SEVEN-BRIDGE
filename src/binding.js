const DEFAULT_CORE_URL = 'https://seven-cloud-core.vercel.app';
const CORE_BINDING_PATH = '/api/v1/sevenex/binding';
const encoder = new TextEncoder();

function coreUrl(env) {
  return String(env.SEVEN_CORE_URL || DEFAULT_CORE_URL).trim().replace(/\/+$/, '');
}

function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value) {
  return bytesToHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return bytesToHex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

export async function signedCoreHeaders(method, pathWithQuery, body, env, now = Date.now()) {
  const secret = String(env.SEVEN_OPERATOR_SHARED_SECRET || '').trim();
  if (secret.length < 32) throw new Error('core_auth_not_configured');
  const timestamp = String(now);
  const bodyHash = await sha256Hex(body);
  const canonical = `${timestamp}\n${String(method).toUpperCase()}\n${pathWithQuery}\n${bodyHash}`;
  return {
    'content-type': 'application/json',
    accept: 'application/json',
    'x-seven-source': 'seven-bridge',
    'x-seven-timestamp': timestamp,
    'x-seven-signature': await hmacHex(secret, canonical),
  };
}

export async function resolveSevenExBinding(identity, env, fetchImpl = fetch) {
  if (!identity?.userId || !identity?.clientId) {
    return { ok: false, status: 401, error: 'account_unauthorized' };
  }

  const body = JSON.stringify({ userId: identity.userId, clientId: identity.clientId });
  let headers;
  try {
    headers = await signedCoreHeaders('POST', CORE_BINDING_PATH, body, env);
  } catch (error) {
    return {
      ok: false,
      status: 503,
      error: error instanceof Error ? error.message : 'core_auth_not_configured',
    };
  }

  let response;
  try {
    response = await fetchImpl(`${coreUrl(env)}${CORE_BINDING_PATH}`, {
      method: 'POST',
      headers,
      body,
      cache: 'no-store',
    });
  } catch {
    return { ok: false, status: 503, error: 'core_unavailable' };
  }

  let data = null;
  try { data = await response.json(); } catch {}
  if (!response.ok || data?.ok !== true) {
    return {
      ok: false,
      status: response.status === 401 ? 401 : response.status === 403 ? 403 : response.status === 404 ? 404 : response.status === 409 ? 409 : response.status === 503 ? 503 : 502,
      error: typeof data?.error === 'string' ? data.error : 'binding_resolution_failed',
    };
  }

  const sessionId = typeof data.sessionId === 'string' ? data.sessionId : '';
  const deviceCode = typeof data.deviceCode === 'string' ? data.deviceCode : '';
  if (!sessionId || !/^\d{6}$/.test(deviceCode)) {
    return { ok: false, status: 502, error: 'invalid_core_binding' };
  }

  return {
    ok: true,
    userId: identity.userId,
    workspaceId: typeof data.workspaceId === 'string' ? data.workspaceId : null,
    sessionId,
    deviceCode,
  };
}

export function hubForDevice(env, deviceCode) {
  const id = env.DEVICE_HUB.idFromName(`device:${deviceCode}`);
  return env.DEVICE_HUB.get(id);
}

export async function verifyHubBinding(hub, binding) {
  const response = await hub.fetch('https://device.internal/agent/status');
  let data = null;
  try { data = await response.json(); } catch {}
  if (!response.ok || data?.ok !== true) {
    return { ok: false, status: 502, error: 'device_status_failed' };
  }
  const meta = data.meta && typeof data.meta === 'object' && !Array.isArray(data.meta) ? data.meta : {};
  if (String(meta.sessionId || '') !== binding.sessionId) {
    return { ok: false, status: 403, error: 'device_binding_mismatch' };
  }
  return { ok: true, status: data };
}
