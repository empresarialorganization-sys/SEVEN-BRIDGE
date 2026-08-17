import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyMcpPath } from '../src/plugin-routes.js';

test('stable SevenEx MCP URL is canonical', () => {
  assert.equal(classifyMcpPath('/mcp'), 'service');
});

test('noncanonical MCP and temporary paths are rejected', () => {
  assert.equal(classifyMcpPath('/mcp/legacy-obsolete'), null);
  assert.equal(classifyMcpPath('/mcp/plugin/anything'), null);
  assert.equal(classifyMcpPath('/internal/one-shot/repair-sevenex'), null);
  assert.equal(classifyMcpPath('/internal/new-chat-test'), null);
  assert.equal(classifyMcpPath('/bootstrap/control'), null);
});
