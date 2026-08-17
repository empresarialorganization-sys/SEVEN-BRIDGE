// SevenEx uses a single stable MCP endpoint.

export function classifyMcpPath(pathname) {
  if (pathname === '/mcp') return 'service';
  return null;
}
