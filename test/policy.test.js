import test from 'node:test';
import assert from 'node:assert/strict';
import { enforceIslandRules, STRICT_TAB_POLICY } from '../src/policy.js';

test('mission always receives strict island policy', () => {
  const original = {
    v: 1,
    action: 'mission',
    tabPolicy: { background: false, maxNewTabs: 8, keepFinalCreatedTab: true },
    steps: [{ action: 'open', args: { url: 'https://www.google.com', active: true } }],
  };
  const safe = enforceIslandRules(original);
  assert.deepEqual(safe.tabPolicy, STRICT_TAB_POLICY);
  assert.equal(safe.steps[0].args.active, false);
  assert.equal(original.steps[0].args.active, true);
});

test('mission and sequence preserve normal page interaction steps', () => {
  for (const action of ['click', 'type', 'press', 'scroll', 'hover', 'select']) {
    const mission = enforceIslandRules({ v: 1, action: 'mission', steps: [{ action, target: { text: 'Example' } }] });
    assert.equal(mission.steps[0].action, action);

    const sequence = enforceIslandRules({ v: 1, action: 'sequence', steps: [{ action, target: { text: 'Example' } }] });
    assert.equal(sequence.steps[0].action, action);
  }
});

test('nested activation is blocked', () => {
  assert.throws(
    () => enforceIslandRules({ v: 1, action: 'mission', steps: [{ action: 'if', then: [{ action: 'activate' }] }] }),
    /tab_activation_blocked_by_island_policy/,
  );
});

test('direct mutating actions must use mission or sequence', () => {
  for (const action of ['click', 'type', 'press', 'scroll', 'hover', 'select']) {
    assert.throws(() => enforceIslandRules({ v: 1, action }), /use_mission_for_isolated_browser_actions/);
  }
});

test('top-level open and target.active cannot steal focus', () => {
  const safe = enforceIslandRules({
    v: 1,
    action: 'open',
    target: { active: true },
    args: { url: 'https://example.com', active: true },
  });
  assert.equal(safe.args.active, false);
  assert.equal(safe.target.active, false);
});
