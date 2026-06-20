'use strict';

// `specguard completion [shell]` — print a shell-completion script to stdout, so it can be
// eval'd from a shell rc or written to a completions dir. Cross-platform: bash, zsh, fish,
// PowerShell. With no arg it auto-detects from $SHELL (or PowerShell on Windows).

const completion = require('../core/completion');

function detectShell() {
  if (process.platform === 'win32') return 'powershell';
  const sh = (process.env.SHELL || '').split('/').pop();
  return completion.SHELLS.includes(sh) ? sh : null;
}

// Per-command `-h/--help` is handled centrally by the dispatcher (it renders the usage +
// setup examples from the COMMANDS table), so this module only prints a short pointer on error.
function usage(stream) {
  stream.write(
    'usage: specguard completion <bash|zsh|fish|powershell>\n' +
      "  run 'specguard completion --help' for shell setup examples\n"
  );
}

function run(args) {
  const arg = (args[0] || '').toLowerCase();
  const shell = arg || detectShell();
  if (!shell || !completion.SHELLS.includes(shell)) {
    if (arg) process.stderr.write(`specguard completion: unknown shell '${arg}'.\n`);
    else process.stderr.write('specguard completion: could not detect your shell from $SHELL — pass it explicitly.\n');
    usage(process.stderr);
    return 1;
  }
  process.stdout.write(completion.generate(shell));
  return 0;
}

module.exports = { run };
