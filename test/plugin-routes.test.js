import test from 'node:test';
import assert from 'node:assert/strict';

import {
  INSTALLED_PLUGIN_MCP_PATH,
  LEGACY_PLUGIN_MCP_PATH,
  classifyMcpPath,
} from '../src/plugin-routes.js';

test('service MCP URL is stable and independent from service secrets', () => {
  assert.equal(classifyMcpPath('/mcp'), 'service');
  assert.equal(classifyMcpPath('/mcp'), 'service');
});

test('currently installed SEVEN Browser v1 remains compatible', () => {
  assert.equal(classifyMcpPath(INSTALLED_PLUGIN_MCP_PATH), 'installed-compatibility');
  assert.equal(classifyMcpPath(LEGACY_PLUGIN_MCP_PATH), 'installed-compatibility');
});

test('derived or temporary MCP paths are not accepted', () => {
  assert.equal(classifyMcpPath('/mcp/plugin/derived-from-a-rotated-agent-key'), null);
  assert.equal(classifyMcpPath('/internal/one-shot/repair-seven-browser-v1'), null);
  assert.equal(classifyMcpPath('/internal/new-chat-test'), null);
});
