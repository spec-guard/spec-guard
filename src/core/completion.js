'use strict';

// Shell-completion script generation for `specguard`. Zero-dependency: we emit a self-contained
// script per shell from ONE metadata table, so it always reflects the current command surface and
// costs nothing at completion time (no per-Tab subprocess). Supports bash, zsh, fish and
// PowerShell — covering macOS (zsh/bash), Linux (bash/zsh/fish) and Windows (PowerShell).
//
// Lines are built from single-quoted JS strings on purpose: shell `${...}` / `$var` stay literal
// (no JS template interpolation).

const SHELLS = ['bash', 'zsh', 'fish', 'powershell'];

// Top-level commands (keep in sync with src/cli/index.js COMMANDS).
const COMMANDS = ['init', 'setup', 'uninstall', 'doctor', 'commit', 'migrate', 'self', 'status', 'on', 'off', 'toggle', 'completion', 'help'];

// Per-command option flags.
const FLAGS = {
  init: ['--agent', '--with-global', '--no-global', '--scaffold', '--spec-dir', '--plans-dir', '--private-dir', '--scope', '--force'],
  setup: ['--force'],
  uninstall: ['--agent', '--global', '--purge', '--dry-run'],
  doctor: ['--quiet'],
  commit: ['--all', '--scope', '--graphify', '--add', '--message', '--message-file', '--force'],
  migrate: ['--apply', '--private-dir'],
  self: ['--dry-run', '--tag', '--force'],
};

// Sub-command / value words.
const AGENTS = ['all', 'none', 'claude-code', 'codex', 'github-copilot', 'opencode', 'gemini'];
const SELF_SUB = ['check', 'upgrade', 'rollback'];
const TOGGLE_SUB = ['on', 'off', 'toggle', 'status'];

function genBash() {
  const arms = Object.entries(FLAGS).map(([c, fl]) => '    ' + c + ') flags="' + fl.join(' ') + '" ;;');
  return [
    '# specguard bash completion. Install: eval "$(specguard completion bash)"  (add to ~/.bashrc)',
    '_specguard() {',
    '  local cur prev sub flags',
    '  COMPREPLY=()',
    '  cur="${COMP_WORDS[COMP_CWORD]}"',
    '  prev="${COMP_WORDS[COMP_CWORD-1]}"',
    '  if [ "$COMP_CWORD" -eq 1 ]; then',
    '    COMPREPLY=( $(compgen -W "' + COMMANDS.join(' ') + '" -- "$cur") ); return',
    '  fi',
    '  sub="${COMP_WORDS[1]}"',
    '  case "$prev" in',
    '    --agent) COMPREPLY=( $(compgen -W "' + AGENTS.join(' ') + '" -- "$cur") ); return ;;',
    '    completion) COMPREPLY=( $(compgen -W "' + SHELLS.join(' ') + '" -- "$cur") ); return ;;',
    '  esac',
    '  if [ "$COMP_CWORD" -eq 2 ]; then',
    '    case "$sub" in',
    '      self) COMPREPLY=( $(compgen -W "' + SELF_SUB.join(' ') + '" -- "$cur") ); return ;;',
    '      toggle) COMPREPLY=( $(compgen -W "' + TOGGLE_SUB.join(' ') + '" -- "$cur") ); return ;;',
    '    esac',
    '  fi',
    '  flags=""',
    '  case "$sub" in',
    arms.join('\n'),
    '  esac',
    '  if [[ "$cur" == -* ]]; then',
    '    COMPREPLY=( $(compgen -W "$flags" -- "$cur") )',
    '  else',
    '    COMPREPLY=( $(compgen -f -- "$cur") )',
    '  fi',
    '}',
    'complete -F _specguard specguard',
    '',
  ].join('\n');
}

function genZsh() {
  const arms = Object.entries(FLAGS).map(([c, fl]) =>
    fl.length ? '      ' + c + ') compadd -- ' + fl.join(' ') + ' ;;' : '      ' + c + ') ;;');
  return [
    '#compdef specguard',
    '# specguard zsh completion. Install: eval "$(specguard completion zsh)"  (add to ~/.zshrc)',
    '_specguard() {',
    '  local -a commands; commands=(' + COMMANDS.join(' ') + ')',
    '  if (( CURRENT == 2 )); then _describe "command" commands; return; fi',
    '  local sub=${words[2]}',
    '  case "${words[CURRENT-1]}" in',
    '    --agent) compadd ' + AGENTS.join(' ') + '; return ;;',
    '    completion) compadd ' + SHELLS.join(' ') + '; return ;;',
    '  esac',
    '  if (( CURRENT == 3 )); then',
    '    case "$sub" in',
    '      self) compadd ' + SELF_SUB.join(' ') + '; return ;;',
    '      toggle) compadd ' + TOGGLE_SUB.join(' ') + '; return ;;',
    '    esac',
    '  fi',
    '  case "$sub" in',
    arms.join('\n'),
    '  esac',
    '  _files',
    '}',
    'compdef _specguard specguard',
    '',
  ].join('\n');
}

function genFish() {
  const lines = [
    '# specguard fish completion.',
    '# Install: specguard completion fish > ~/.config/fish/completions/specguard.fish',
    'complete -c specguard -f',
  ];
  for (const c of COMMANDS) lines.push("complete -c specguard -n __fish_use_subcommand -a '" + c + "'");
  lines.push("complete -c specguard -n '__fish_seen_subcommand_from init uninstall' -l agent -a '" + AGENTS.join(' ') + "'");
  lines.push("complete -c specguard -n '__fish_seen_subcommand_from self' -a '" + SELF_SUB.join(' ') + "'");
  lines.push("complete -c specguard -n '__fish_seen_subcommand_from toggle' -a '" + TOGGLE_SUB.join(' ') + "'");
  lines.push("complete -c specguard -n '__fish_seen_subcommand_from completion' -a '" + SHELLS.join(' ') + "'");
  for (const [c, fl] of Object.entries(FLAGS)) {
    for (const f of fl) {
      if (f.startsWith('--')) lines.push("complete -c specguard -n '__fish_seen_subcommand_from " + c + "' -l " + f.slice(2));
    }
  }
  lines.push('');
  return lines.join('\n');
}

function genPowershell() {
  const q = (arr) => arr.map((s) => "'" + s + "'").join(',');
  const flagMap = Object.entries(FLAGS).map(([c, fl]) => "'" + c + "' = @(" + q(fl) + ')').join('; ');
  return [
    '# specguard PowerShell completion.',
    '# Install: specguard completion powershell | Out-String | Invoke-Expression   (add to $PROFILE)',
    'Register-ArgumentCompleter -Native -CommandName specguard -ScriptBlock {',
    '  param($wordToComplete, $commandAst, $cursorPosition)',
    '  $tokens = @($commandAst.CommandElements | ForEach-Object { $_.ToString() })',
    '  $cmds = @(' + q(COMMANDS) + ')',
    '  if ($tokens.Count -le 1) {',
    '    $cands = $cmds',
    '  } else {',
    '    $sub = $tokens[1]',
    '    $prev = $tokens[-1]',
    '    $flagMap = @{' + flagMap + '}',
    '    $valueMap = @{ "--agent" = @(' + q(AGENTS) + '); "self" = @(' + q(SELF_SUB) + '); "toggle" = @(' + q(TOGGLE_SUB) + '); "completion" = @(' + q(SHELLS) + ') }',
    '    if ($valueMap.ContainsKey($prev)) { $cands = $valueMap[$prev] }',
    '    elseif ($valueMap.ContainsKey($sub) -and $tokens.Count -le 2) { $cands = $valueMap[$sub] }',
    '    elseif ($flagMap.ContainsKey($sub)) { $cands = $flagMap[$sub] }',
    '    else { $cands = @() }',
    '  }',
    '  $cands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {',
    '    [System.Management.Automation.CompletionResult]::new($_, $_, "ParameterValue", $_)',
    '  }',
    '}',
    '',
  ].join('\n');
}

function generate(shell) {
  switch (shell) {
    case 'bash': return genBash();
    case 'zsh': return genZsh();
    case 'fish': return genFish();
    case 'powershell': return genPowershell();
    default: throw new Error('unknown shell: ' + shell);
  }
}

module.exports = { SHELLS, COMMANDS, FLAGS, AGENTS, SELF_SUB, TOGGLE_SUB, generate };
