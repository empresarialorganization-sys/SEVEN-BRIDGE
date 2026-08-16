const CODE_RE = /^\d{6}$/;
const TOKEN_RE = /^[0-9a-f]{64}$/;
const DEVICE_MCP_PREFIX = '/mcp/device';

export function normalizeDeviceCode(value) {
  const code = String(value || '').trim();
  return CODE_RE.test(code) ? code : null;
}

export function normalizeDeviceBindingToken(value) {
  const token = String(value || '').trim().toLowerCase();
  return TOKEN_RE.test(token) ? token : null;
}

export function deviceMcpPath(codeValue, tokenValue) {
  const code = normalizeDeviceCode(codeValue);
  const token = normalizeDeviceBindingToken(tokenValue);
  return code && token ? `${DEVICE_MCP_PREFIX}/${code}/${token}` : null;
}

export function parseDeviceMcpPath(pathname) {
  const parts = String(pathname || '').split('/');
  if (parts.length !== 5 || parts[1] !== 'mcp' || parts[2] !== 'device') return null;

  const code = normalizeDeviceCode(parts[3]);
  const token = normalizeDeviceBindingToken(parts[4]);
  return code && token ? { code, token } : null;
}
