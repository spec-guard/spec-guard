'use strict';

const fs = require('fs');
const path = require('path');

const pkg = require('../../package.json');
const { closest } = require('./_shared');

// The single source of truth for the command surface. Each entry carries the one-line `summary`
// (top-level help), an optional `usage:` string, the positional `subcommands`, the notable
// `flags`, and optional `examples` lines. The dispatcher renders per-command help from this table
// (so `specguard <cmd> --help` is uniform), and each command module reuses the same `usage` string.
const COMMANDS = {
  init: {
    summary: 'Install spec-guard into a repo (per-agent skill, commands, hooks, rules-block).',
    usage: 'specguard init [path] [--agent <list>] [--scaffold] [--spec-dir <d>] [--plans-dir <d>] [--private-dir <d>] [--scope all] [--with-global|--no-global] [--force]',
    flags: [
      '--agent <list>     comma-separated agents (or "all"); prompts on a TTY otherwise',
      '--scaffold         create starter docs (specs/plans dirs)',
      '--spec-dir <d>     spec directory (default: docs/specs)',
      '--plans-dir <d>    plans directory (default: docs/plans)',
      '--private-dir <d>  IP/private directory (default: .private)',
      '--scope all        treat a multi-git workspace as a backup monorepo',
      '--with-global      also wire this machine now (--no-global to skip)',
      '--force            re-render even user-diverged files',
    ],
  },
  update: {
    summary: 'Re-render owned files idempotently (manifest-guarded; never touches user specs).',
    usage: 'specguard update [path] [--force]',
    flags: ['--force            re-render even user-diverged files'],
  },
  self: {
    summary: 'Update the CLI itself: self check | upgrade | rollback.',
    usage: 'specguard self check|upgrade|rollback [--dry-run] [--tag vX.Y.Z] [--force]',
    subcommands: ['check', 'upgrade', 'rollback'],
    flags: [
      '--dry-run          show what would happen without installing',
      '--tag vX.Y.Z       target a specific version (default: latest)',
      '--force            reinstall even when already on the latest version',
    ],
  },
  status: { summary: 'Show resolved config and install state.', usage: 'specguard status [path]' },
  doctor: {
    summary: 'Diagnose install health, repo topology, and the IP/deliverable wall.',
    usage: 'specguard doctor [path] [--quiet]',
    flags: ['--quiet            machine check only; exit 0/1 (used as a post-upgrade gate)'],
  },
  toggle: {
    summary: 'Governance switch: on | off | toggle.',
    usage: 'specguard toggle on|off|toggle|status',
    subcommands: ['on', 'off', 'toggle', 'status'],
  },
  on: { summary: 'Enable spec-guard (persists across sessions).', usage: 'specguard on' },
  off: { summary: 'Disable spec-guard (persists across sessions).', usage: 'specguard off' },
  setup: {
    summary: "Wire this machine's agent session hooks + statusline (the machine-scoped counterpart to init).",
    usage: 'specguard setup [--force]',
    flags: ['--force            rewrite managed machine files even if content matches'],
  },
  completion: {
    summary: 'Print a shell-completion script: completion <bash|zsh|fish|powershell>.',
    usage: 'specguard completion <bash|zsh|fish|powershell>',
    subcommands: ['bash', 'zsh', 'fish', 'powershell'],
    examples: [
      'bash:        eval "$(specguard completion bash)"            # add to ~/.bashrc',
      'zsh:         eval "$(specguard completion zsh)"             # add to ~/.zshrc',
      'fish:        specguard completion fish > ~/.config/fish/completions/specguard.fish',
      'powershell:  specguard completion powershell | Out-String | Invoke-Expression   # add to $PROFILE',
    ],
  },
  uninstall: {
    summary: 'Remove spec-guard from a repo, or --global from this machine (--purge, --dry-run).',
    usage: 'specguard uninstall [path] [--agent <list>] [--global] [--purge] [--dry-run]',
    flags: [
      '--agent <list>     remove only these agents (default: all recorded; keeps .spec-guard)',
      '--global           remove this machine\'s wired hooks/statusline/global skill',
      '--purge            also delete config + manifest (not just owned files)',
      '--dry-run          show what would be removed without removing it',
    ],
  },
  migrate: {
    summary: 'Transitional: upgrade an old-model repo (.claude IP, docs/superpowers) to the current layout. Dry-run unless --apply.',
    usage: 'specguard migrate [path] [--private-dir <d>] [--apply]',
    flags: [
      '--private-dir <d>  IP/private destination for moved .claude docs (default: .private)',
      '--apply            execute the migration (default is a dry-run preview)',
    ],
  },
  commit: {
    summary: 'Commit the loop result: validate Conventional Commit (no AI attribution), current repo or --all/--scope across the backup monorepo.',
    usage: 'specguard commit [-m "type: subject"] [--message-file <f>] [--add] [--all|--scope <a,b>] [--graphify] [--force]',
    flags: [
      '-m, --message <s>  the Conventional Commit message',
      '--message-file <f> read the commit message from a file (when -m is absent)',
      '--add              stage all changes before committing',
      '--all              commit across every module of a backup monorepo',
      '--scope <a,b>      commit only the named modules (comma-separated)',
      '--graphify         refresh graphify-out/ before committing',
      '--force            commit even if validation is non-fatal',
    ],
  },
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
    const subs = meta.subcommands ? `  (${meta.subcommands.join('|')})` : '';
    lines.push(`  ${name.padEnd(11)}${meta.summary}${subs}`);
  }
  lines.push(
    '',
    'Flags:',
    '  -v, --version   Print version',
    '  -h, --help      Print this help (use `specguard <command> --help` for per-command help)',
    ''
  );
  process.stdout.write(lines.join('\n'));
}

// Render the detailed per-command help block from the metadata table.
function helpFor(name) {
  const meta = COMMANDS[name] || {};
  const lines = [`specguard ${name} — ${meta.summary || ''}`.trimEnd(), ''];
  if (meta.usage) lines.push(`usage: ${meta.usage}`, '');
  if (meta.subcommands) lines.push('Subcommands:', '  ' + meta.subcommands.join(', '), '');
  if (meta.flags && meta.flags.length) lines.push('Flags:', ...meta.flags.map((f) => `  ${f}`), '');
  if (meta.examples && meta.examples.length) lines.push('Examples:', ...meta.examples.map((e) => `  ${e}`), '');
  return lines.join('\n').replace(/\n+$/, '\n');
}

function wantsHelp(args) {
  return args.some((a) => a === '-h' || a === '--help');
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
    const suggestion = closest(first, Object.keys(COMMANDS));
    const hint = suggestion ? ` Did you mean '${suggestion}'?` : '';
    process.stderr.write(`specguard: unknown command '${first}'.${hint} Run 'specguard --help'.\n`);
    return 1;
  }

  // Per-command help is handled centrally, before dispatch, so `specguard <cmd> --help` is uniform
  // across every command (most modules don't handle it themselves).
  if (wantsHelp(rest)) {
    process.stdout.write(helpFor(first));
    return 0;
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

module.exports = { main, COMMANDS, helpFor };
