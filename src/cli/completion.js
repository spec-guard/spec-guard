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

function usage(stream) {
  stream.write(
    'usage: specguard completion <bash|zsh|fish|powershell>\n' +
      '  bash:        eval "$(specguard completion bash)"            # add to ~/.bashrc\n' +
      '  zsh:         eval "$(specguard completion zsh)"             # add to ~/.zshrc\n' +
      '  fish:        specguard completion fish > ~/.config/fish/completions/specguard.fish\n' +
      '  powershell:  specguard completion powershell | Out-String | Invoke-Expression   # add to $PROFILE\n'
  );
}

function run(args) {
  const arg = (args[0] || '').toLowerCase();
  if (arg === '-h' || arg === '--help') {
    usage(process.stdout);
    return 0;
  }
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
