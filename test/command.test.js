import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLiveCommand } from '../src/command.js';

test('fills protocol v1 for commands that only provide action', () => {
  assert.deepEqual(normalizeLiveCommand({ action: 'vision', args: { max: 20 } }), {
    v: 1,
    action: 'vision',
    args: { max: 20 },
  });
});

test('accepts type as a legacy action alias', () => {
  assert.deepEqual(normalizeLiveCommand({ type: 'visionDiff' }), { v: 1, action: 'visionDiff' });
});

test('unwraps stale command and payload wrappers', () => {
  assert.deepEqual(normalizeLiveCommand({ command: { action: 'read' } }), { v: 1, action: 'read' });
  assert.deepEqual(normalizeLiveCommand({ payload: { v: 1, action: 'vision' } }), { v: 1, action: 'vision' });
});

test('preserves valid protocol v1 commands', () => {
  const command = { v: 1, action: 'mission', steps: [{ action: 'sleep', args: { ms: 50 } }] };
  assert.deepEqual(normalizeLiveCommand(command), command);
});

test('rejects missing actions and unsupported protocol versions', () => {
  assert.throws(() => normalizeLiveCommand({ v: 1 }), /invalid_live_command_action/);
  assert.throws(() => normalizeLiveCommand({ v: 2, action: 'vision' }), /unsupported_live_command_version/);
});
