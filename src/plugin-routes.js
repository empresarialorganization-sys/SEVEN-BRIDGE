// These compatibility routes are intentionally independent from SEVEN_AGENT_KEY.
// They keep the currently installed SEVEN Browser v1 working while account-scoped
// authentication is introduced for additional users. Do not derive MCP URLs from
// service secrets and do not treat these paths as user passwords.

export const LEGACY_PLUGIN_MCP_PATH = '/mcp/Cdev0KZOIWwvwrfRV1yh2iqInZ4losNuwtZgAer4QjY';
export const INSTALLED_PLUGIN_MCP_PATH = '/mcp/plugin/c34f53c6e21af2f4182cb633867c7031bd51b1e9415872ac';

const COMPATIBILITY_PATHS = new Set([
  LEGACY_PLUGIN_MCP_PATH,
  INSTALLED_PLUGIN_MCP_PATH,
]);

export function classifyMcpPath(pathname) {
  if (pathname === '/mcp') return 'service';
  if (COMPATIBILITY_PATHS.has(pathname)) return 'installed-compatibility';
  return null;
}
