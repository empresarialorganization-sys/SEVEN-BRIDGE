import test from 'node:test';
import assert from 'node:assert/strict';

import { INSTALLED_PLUGIN_MCP_PATH, classifyMcpPath } from '../src/plugin-routes.js';

test('stable SevenEx MCP URL is independent from service secrets', () => {
  assert.equal(classifyMcpPath('/mcp'), 'service');
});

test('only the currently installed compatibility route remains during migration', () => {
  assert.equal(classifyMcpPath(INSTALLED_PLUGIN_MCP_PATH), 'installed-compatibility');
});

test('obsolete, derived, and temporary MCP paths are rejected', () => {
  assert.equal(classifyMcpPath('/mcp/legacy-obsolete'), null);
  assert.equal(classifyMcpPath('/mcp/plugin/derived-from-a-rotated-agent-key'), null);
  assert.equal(classifyMcpPath('/internal/one-shot/repair-sevenex'), null);
  assert.equal(classifyMcpPath('/internal/new-chat-test'), null);
});
