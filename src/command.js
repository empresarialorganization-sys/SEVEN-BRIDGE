function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeLiveCommand(input) {
  let command = input;

  // Accept one stale wrapper layer from older MCP clients/configurations.
  for (let i = 0; i < 2; i += 1) {
    if (!isObject(command)) break;
    if (command.action || command.type) break;
    if (isObject(command.command)) {
      command = command.command;
      continue;
    }
    if (isObject(command.payload)) {
      command = command.payload;
      continue;
    }
    break;
  }

  if (!isObject(command)) throw new Error('invalid_live_command');

  const action = String(command.action || command.type || '').trim();
  if (!action) throw new Error('invalid_live_command_action');

  if (command.v !== undefined && Number(command.v) !== 1) {
    throw new Error('unsupported_live_command_version');
  }

  const normalized = { ...command, v: 1, action };
  if (!command.action && command.type === action) delete normalized.type;
  return normalized;
}
