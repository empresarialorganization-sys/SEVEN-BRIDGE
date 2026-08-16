const MIN_SERVER_SECRET_LENGTH = 32;

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function digest(value) {
  return new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value ?? ''))),
  );
}

export async function sha256Hex(value) {
  return bytesToHex(await digest(value));
}

export async function hmacSha256Hex(secret, value) {
  const key = String(secret || '');
  if (key.length < MIN_SERVER_SECRET_LENGTH) return null;

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    new TextEncoder().encode(String(value ?? '')),
  );
  return bytesToHex(new Uint8Array(signature));
}

export async function timingSafeEqual(left, right) {
  const [leftHash, rightHash] = await Promise.all([digest(left), digest(right)]);
  if (typeof crypto.subtle.timingSafeEqual === 'function') {
    return crypto.subtle.timingSafeEqual(leftHash, rightHash);
  }

  // Node's Web Crypto may not expose timingSafeEqual yet. Both inputs have
  // already been reduced to the same fixed length before this fallback.
  let diff = 0;
  for (let index = 0; index < leftHash.length; index += 1) {
    diff |= leftHash[index] ^ rightHash[index];
  }
  return diff === 0;
}

export async function isAgentRequest(request, env) {
  const configured = String(env.SEVEN_AGENT_KEY || '');
  if (configured.length < MIN_SERVER_SECRET_LENGTH) return false;

  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return false;
  return timingSafeEqual(authorization.slice(7), configured);
}
