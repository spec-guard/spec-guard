'use strict';

const fs = require('fs');
const path = require('path');

const pkg = require('../../package.json');

// Commands are wired in as they land. Phase 0 ships the dispatcher + version/help;
// Phase 2 fills in the command modules under src/cli/.
const COMMANDS = {
  init: { summary: 'Install spec-guard into a repo (per-agent skill, commands, hooks, rules-block).' },
  update: { summary: 'Re-render owned files idempotently (manifest-guarded; never touches user specs).' },
  self: { summary: 'Update the CLI itself: self check | upgrade | rollback.' },
  status: { summary: 'Show resolved config and install state.' },
  doctor: { summary: 'Diagnose install health, repo topology, and the IP/deliverable wall.' },
  toggle: { summary: 'Governance switch: on | off | toggle.' },
  on: { summary: 'Enable spec-guard (persists across sessions).' },
  off: { summary: 'Disable spec-guard (persists across sessions).' },
  setup: { summary: "Wire this machine's agent session hooks + statusline (the machine-scoped counterpart to init)." },
  completion: { summary: 'Print a shell-completion script: completion <bash|zsh|fish|powershell>.' },
  uninstall: { summary: 'Remove spec-guard from a repo, or --global from this machine (--purge, --dry-run).' },
  migrate: { summary: 'Transitional: upgrade an old-model repo (.claude IP, docs/superpowers) to the current layout. Dry-run unless --apply.' },
  commit: { summary: 'Commit the loop result: validate Conventional Commit (no AI attribution), current repo or --all/--scope across the backup monorepo.' },
};

// Aliases that route to another command module with a fixed leading arg.
const ALIASES = { on: ['toggle', 'on'], off: ['toggle', 'off'] };

function loadCommand(name) {
  const file = path.join(__dirname, `${name}.js`);
  if (fs.existsSync(file)) return require(file);
  return null;
}

function printVersion() {
  process.stdout.write(`${pkg.version}\n`);
}

function printHelp() {
  const lines = [
    `specguard ${pkg.version} — ${pkg.description}`,
    '',
    'Usage: specguard <command> [options]',
    '',
    'Commands:',
  ];
  for (const [name, meta] of Object.entries(COMMANDS)) {
    lines.push(`  ${name.padEnd(10)} ${meta.summary}`);
  }
  lines.push('', 'Flags:', '  -v, --version   Print version', '  -h, --help      Print this help', '');
  process.stdout.write(lines.join('\n'));
}

async function main(argv) {
  const [first, ...rest] = argv;

  if (!first || first === '-h' || first === '--help' || first === 'help') {
    printHelp();
    return 0;
  }
  if (first === '-v' || first === '--version' || first === 'version') {
    printVersion();
    return 0;
  }

  if (!Object.prototype.hasOwnProperty.call(COMMANDS, first)) {
    process.stderr.write(`specguard: unknown command '${first}'. Run 'specguard --help'.\n`);
    return 1;
  }

  // Resolve aliases (e.g. `on` -> `toggle on`).
  let name = first;
  let cmdArgs = rest;
  if (Object.prototype.hasOwnProperty.call(ALIASES, first)) {
    const [target, ...prefix] = ALIASES[first];
    name = target;
    cmdArgs = prefix.concat(rest);
  }

  const cmd = loadCommand(name);
  if (!cmd || typeof cmd.run !== 'function') {
    process.stderr.write(`specguard: '${name}' is planned but not implemented yet.\n`);
    return 0;
  }
  return (await cmd.run(cmdArgs)) || 0;
}

module.exports = { main, COMMANDS };
