// SevenEx uses the stable /mcp service endpoint for the current architecture.
// This single compatibility route exists only for the currently installed app
// until SevenEx is repointed and validated; it must not be copied for new users.

export const INSTALLED_PLUGIN_MCP_PATH = '/mcp/plugin/c34f53c6e21af2f4182cb633867c7031bd51b1e9415872ac';

export function classifyMcpPath(pathname) {
  if (pathname === '/mcp') return 'service';
  if (pathname === INSTALLED_PLUGIN_MCP_PATH) return 'installed-compatibility';
  return null;
}
