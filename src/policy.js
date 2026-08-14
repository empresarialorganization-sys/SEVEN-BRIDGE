const DIRECT_MUTATING_ACTIONS = new Set([
  'click',
  'type',
  'press',
  'scroll',
  'hover',
  'select',
]);

export const STRICT_TAB_POLICY = Object.freeze({
  background: true,
  reuseManagedTab: true,
  maxNewTabs: 3,
  autoCloseCreated: true,
  groupTabs: true,
  collapseGroup: true,
  groupName: 'SEVEN',
  keepFinalCreatedTab: false,
});

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function sanitizeStep(raw) {
  const step = raw && typeof raw === 'object' ? { ...raw } : raw;
  if (!step || typeof step !== 'object') return step;

  const action = String(step.action || '');
  if (action === 'activate') {
    throw new Error('tab_activation_blocked_by_island_policy');
  }

  if (action === 'open' || action === 'navigate') {
    step.args = { ...(step.args || {}), active: false };
  }

  if (Array.isArray(step.steps)) step.steps = sanitizeSteps(step.steps);
  if (Array.isArray(step.then)) step.then = sanitizeSteps(step.then);
  if (Array.isArray(step.else)) step.else = sanitizeSteps(step.else);

  return step;
}

export function sanitizeSteps(steps) {
  if (!Array.isArray(steps)) return steps;
  return steps.map(sanitizeStep);
}

export function enforceIslandRules(command) {
  const safe = clone(command);
  const action = String(safe.action || '');

  if (action === 'activate') {
    throw new Error('tab_activation_blocked_by_island_policy');
  }

  if (action === 'open' || action === 'navigate') {
    safe.args = { ...(safe.args || {}), active: false };
  }

  if (DIRECT_MUTATING_ACTIONS.has(action)) {
    throw new Error('use_mission_for_isolated_browser_actions');
  }

  if (action === 'mission' || action === 'sequence') {
    safe.tabPolicy = { ...STRICT_TAB_POLICY };
    safe.steps = sanitizeSteps(safe.steps);
  }

  if (safe.target && typeof safe.target === 'object' && safe.target.active === true) {
    safe.target = { ...safe.target, active: false };
  }

  return safe;
}
