const DEFAULT_CORE_URL = 'https://seven-cloud-core.vercel.app';

function coreUrl(env) {
  return String(env.SEVEN_CORE_URL || DEFAULT_CORE_URL).trim().replace(/\/+$/, '');
}

export function bearerHeader(request) {
  const value = request.headers.get('authorization') || '';
  return value.startsWith('Bearer ') && value.slice(7).trim() ? value : null;
}

export async function resolveSevenExBinding(request, env, fetchImpl = fetch) {
  const authorization = bearerHeader(request);
  if (!authorization) return { ok: false, status: 401, error: 'account_unauthorized' };

  let response;
  try {
    response = await fetchImpl(`${coreUrl(env)}/api/v1/sevenex/binding`, {
      method: 'GET',
      headers: {
        authorization,
        accept: 'application/json',
      },
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
      status: response.status === 401 ? 401 : response.status === 403 ? 403 : response.status === 404 ? 404 : response.status === 409 ? 409 : 502,
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
    userId: typeof data.userId === 'string' ? data.userId : null,
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
