export const SEVENEX_PROTOCOL_VERSION = 1;
export const SEVENEX_MIN_OPERATOR_VERSION = '1.1.0';
export const SEVENEX_REQUIRED_CAPABILITIES = ['vision', 'visionDiff', 'mission', 'collectImages'];

function parts(value) {
  return String(value || '0.0.0').split('.').slice(0, 3).map((item) => Number.parseInt(item.replace(/\D.*$/, ''), 10) || 0);
}

export function compareVersions(leftValue, rightValue) {
  const left = parts(leftValue);
  const right = parts(rightValue);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return 1;
    if (left[index] < right[index]) return -1;
  }
  return 0;
}

export function operatorCompatibility(meta) {
  const source = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};
  const operator = source.operator && typeof source.operator === 'object' && !Array.isArray(source.operator)
    ? source.operator
    : {};
  const version = typeof operator.version === 'string' ? operator.version : '';
  const protocolVersion = Number(operator.protocolVersion || 0);
  const capabilities = Array.isArray(operator.capabilities)
    ? operator.capabilities.filter((item) => typeof item === 'string')
    : [];
  const protocolOk = protocolVersion === SEVENEX_PROTOCOL_VERSION;
  const versionOk = Boolean(version) && compareVersions(version, SEVENEX_MIN_OPERATOR_VERSION) >= 0;
  const capabilitiesOk = SEVENEX_REQUIRED_CAPABILITIES.every((item) => capabilities.includes(item));
  return {
    ok: protocolOk && versionOk && capabilitiesOk,
    updateRequired: !protocolOk || !versionOk || !capabilitiesOk,
    operatorVersion: version || null,
    operatorProtocolVersion: protocolVersion || null,
    operatorCapabilities: capabilities,
    requiredProtocolVersion: SEVENEX_PROTOCOL_VERSION,
    minimumOperatorVersion: SEVENEX_MIN_OPERATOR_VERSION,
    requiredCapabilities: [...SEVENEX_REQUIRED_CAPABILITIES],
  };
}

export function publicDeviceStatus(status, compatibility = null) {
  const data = status && typeof status === 'object' && !Array.isArray(status) ? status : {};
  const meta = data.meta && typeof data.meta === 'object' && !Array.isArray(data.meta) ? data.meta : {};
  return {
    ok: true,
    connected: data.connected === true,
    lastSeenAt: data.lastSeenAt || null,
    browser: typeof meta.browserKind === 'string' ? meta.browserKind : null,
    browserVersion: typeof meta.browserVersion === 'string' ? meta.browserVersion : null,
    compatibility,
  };
}
