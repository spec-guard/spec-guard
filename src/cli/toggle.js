'use strict';

const config = require('../core/config');

// `specguard on | off | toggle` (also reachable as `specguard toggle on|off`).
function run(args) {
  let arg = (args[0] || 'toggle').toLowerCase();
  const current = config.getDefaultMode();

  let next;
  if (arg === 'on' || arg === 'off') {
    next = arg;
  } else if (arg === 'toggle') {
    next = current === 'on' ? 'off' : 'on';
  } else if (arg === 'status') {
    process.stdout.write(current + '\n');
    return 0;
  } else {
    process.stderr.write('usage: specguard toggle on|off|toggle|status\n');
    return 1;
  }

  config.setDefaultMode(next);
  const flagPath = config.getFlagPath();
  if (next === 'on') config.safeWriteFlag(flagPath, 'on');
  else config.removeFlag(flagPath);

  process.stdout.write('specguard: ' + next + '\n');
  return 0;
}

module.exports = { run };
