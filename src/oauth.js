import { createRemoteJWKSet, jwtVerify } from 'jose';

const DEFAULT_BRIDGE_URL = 'https://seven-bridge.carlosdh12335.workers.dev';
const DEFAULT_SUPABASE_AUTH_URL = 'https://duzwnryljrjyxavbjmdv.supabase.co/auth/v1';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let cachedJwksUrl = '';
let cachedJwks = null;

function baseUrl(env) {
  return String(env.SEVEN_PUBLIC_URL || DEFAULT_BRIDGE_URL).trim().replace(/\/+$/, '');
}

function authorizationServer(env) {
  return String(env.SEVEN_SUPABASE_AUTH_URL || DEFAULT_SUPABASE_AUTH_URL).trim().replace(/\/+$/, '');
}

export function sevenExResource(env) {
  return `${baseUrl(env)}/mcp`;
}

export function sevenExResourceMetadataUrl(env) {
  return `${baseUrl(env)}/.well-known/oauth-protected-resource/mcp`;
}

export function protectedResourceMetadata(env) {
  return {
    resource: sevenExResource(env),
    authorization_servers: [authorizationServer(env)],
    bearer_methods_supported: ['header'],
  };
}

export function protectedResourceMetadataResponse(env) {
  return Response.json(protectedResourceMetadata(env), {
    headers: { 'cache-control': 'public, max-age=300' },
  });
}

export function bearerToken(request) {
  const value = request.headers.get('authorization') || '';
  if (!value.startsWith('Bearer ')) return null;
  const token = value.slice(7).trim();
  return token || null;
}

function jwksFor(env) {
  const issuer = authorizationServer(env);
  const url = `${issuer}/.well-known/jwks.json`;
  if (!cachedJwks || cachedJwksUrl !== url) {
    cachedJwksUrl = url;
    cachedJwks = createRemoteJWKSet(new URL(url));
  }
  return cachedJwks;
}

export function validateSevenExClaims(payload, env) {
  const userId = typeof payload?.sub === 'string' ? payload.sub : '';
  const clientId = typeof payload?.client_id === 'string' ? payload.client_id : '';
  const audience = payload?.aud;
  const audiences = Array.isArray(audience) ? audience.map(String) : audience ? [String(audience)] : [];
  if (!UUID_RE.test(userId)) return { ok: false, status: 401, error: 'invalid_token_subject' };
  if (!clientId) return { ok: false, status: 401, error: 'oauth_client_required' };
  if (!audiences.includes(sevenExResource(env))) return { ok: false, status: 401, error: 'invalid_token_audience' };
  return { ok: true, userId, clientId };
}

async function verifySupabaseJwt(token, env) {
  const issuer = authorizationServer(env);
  const result = await jwtVerify(token, jwksFor(env), {
    issuer,
    audience: sevenExResource(env),
  });
  return result.payload;
}

export async function authenticateSevenExRequest(request, env, verifier = verifySupabaseJwt) {
  const token = bearerToken(request);
  if (!token) return { ok: false, status: 401, error: 'account_unauthorized' };
  try {
    const payload = await verifier(token, env);
    return validateSevenExClaims(payload, env);
  } catch {
    return { ok: false, status: 401, error: 'invalid_access_token' };
  }
}

export function oauthErrorResponse(error, status, env) {
  const headers = new Headers({ 'cache-control': 'no-store' });
  if (status === 401) {
    headers.set(
      'www-authenticate',
      `Bearer resource_metadata="${sevenExResourceMetadataUrl(env)}", error="invalid_token"`,
    );
  }
  return Response.json(
    { jsonrpc: '2.0', error: { code: -32001, message: error }, id: null },
    { status, headers },
  );
}
