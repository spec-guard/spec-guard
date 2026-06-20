'use strict';

// `specguard setup` — wire THIS MACHINE's agent session hooks (SessionStart/Stop) + statusline.
// This is the machine-scoped counterpart to per-repo `init`; `uninstall --global` reverses it.
// It is idempotent (manifest-guarded) and never touches co-tenant hook entries.
//
// `wireMachine()` is also called by `init --with-global` so first-run onboarding is one command.

const fs = require('fs');
const path = require('path');

const { parseArgs, homeDir, globalManifestPath } = require('./_shared');
const agents = require('../core/agents');
const manifest = require('../core/manifest');
const installer = require('../core/installer');
const jsonmerge = require('../core/jsonmerge');

// Wire a Claude/Codex-style hooks config file. Returns the list of actions.
function wireHooks(configPath, activatePath, syncCheckPath) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (e) {}
  const a = jsonmerge.upsertHookCommand(cfg, 'SessionStart', {
    command: `node "${activatePath}"`,
    timeout: 5,
    statusMessage: 'Loading spec-guard governance...',
  });
  const b = jsonmerge.upsertHookCommand(a.config, 'Stop', { command: `bash "${syncCheckPath}"`, timeout: 5 });
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(b.config, null, 2) + '\n');
  return { SessionStart: a.action, Stop: b.action };
}

function setStatusLine(settingsPath, statuslinePath) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch (e) {}
  const current = cfg.statusLine && cfg.statusLine.command;
  const desired = `bash "${statuslinePath}"`;
  if (current === desired) return 'unchanged'; // already ours — don't rewrite (idempotent re-runs)
  if (!current || /statusline-combined|spec-guard/.test(current)) {
    cfg.statusLine = { type: 'command', command: desired };
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(cfg, null, 2) + '\n');
    return 'set';
  }
  return 'left-user-statusline';
}

// An action verb counts as a real change unless it's one of these no-ops.
const NOOP_ACTIONS = new Set(['noop', 'unchanged', 'block-unchanged', 'left-user-statusline']);
const isChange = (a) => !!a && !NOOP_ACTIONS.has(a);

// Wire the machine for the hook-bearing agents (claude-code, codex). Returns
// { wired: string[], missing: string[], changed: boolean } — `wired` are human-readable summary
// lines; `changed` is false when every file/hook was already current (lets callers say "nothing
// changed" instead of re-printing the full report).
function wireMachine(home, opts) {
  const force = !!(opts && opts.force);
  const vars = installer.renderVars({}); // global fallback skill uses defaults
  const m = manifest.load(globalManifestPath(home));
  const wired = [];
  const verifyPaths = [];
  const allActions = [];

  for (const id of ['claude-code', 'codex']) {
    const agent = agents.get(id);
    const ctx = { repoRoot: null, homeDir: home };
    const globalSkillDir = path.join(home, agent.globalSkillDir || agent.skill.dir);
    const skillActs = installer.installSkillTree(globalSkillDir, id, vars, m, `global:${id}:skill`, force);

    const agentRoot = path.dirname(path.dirname(globalSkillDir)); // .../.claude
    const hooksDir = path.join(agentRoot, 'hooks', 'spec-guard');
    const hookActs = installer.copyHookBundle(hooksDir, m, `global:${id}:hooks`, force);
    const activatePath = path.join(hooksDir, 'activate.js');
    const syncCheckPath = path.join(hooksDir, 'sync-check.sh');
    verifyPaths.push(activatePath, syncCheckPath);

    const actions = wireHooks(agents.resolveHooksConfigPath(agent, ctx), activatePath, syncCheckPath);
    for (const a of [].concat(skillActs || [], hookActs || [])) allActions.push(a && a.action);
    allActions.push(actions.SessionStart, actions.Stop);

    let statusInfo = '';
    if (id === 'claude-code') {
      const statuslinePath = path.join(agentRoot, 'hooks', 'statusline-combined.sh');
      const sl = manifest.writeManaged({
        absPath: statuslinePath,
        content: installer.statuslineCombinedContent(),
        manifest: m,
        key: 'global:claude-code:statusline-combined',
        force,
      });
      try { fs.chmodSync(statuslinePath, 0o755); } catch (e) {}
      const slSet = setStatusLine(path.join(agentRoot, 'settings.json'), statuslinePath);
      allActions.push(sl.action, slSet);
      verifyPaths.push(statuslinePath);
      statusInfo = `, statusline ${sl.action}`;
    }
    wired.push(`  ${id}: SessionStart ${actions.SessionStart}, Stop ${actions.Stop}${statusInfo}`);
  }

  manifest.save(globalManifestPath(home), m);
  const missing = verifyPaths.filter((p) => !fs.existsSync(p));
  const changed = allActions.some(isChange);
  return { wired, missing, changed };
}

function run(args) {
  const { flags } = parseArgs(args);
  const home = homeDir(flags);
  const force = !!flags.force;
  const { wired, missing, changed } = wireMachine(home, { force });

  if (missing.length) {
    process.stdout.write('specguard: machine setup (Claude Code + Codex session hooks)\n' + wired.join('\n') + '\n');
    process.stderr.write('\nWARNING: expected hook files missing after setup:\n  ' + missing.join('\n  ') + '\n');
    return 1;
  }

  // Idempotent re-run with nothing to do: say so plainly instead of re-printing the full report
  // (and skip the loose-files cleanup note, which is only relevant when something was just wired).
  if (!changed && !force) {
    process.stdout.write('specguard: machine already set up (nothing changed)\n');
    return 0;
  }

  process.stdout.write('specguard: machine setup (Claude Code + Codex session hooks)\n' + wired.join('\n') + '\n');
  process.stdout.write(
    "\nVerified: hook scripts exist. If you previously had loose ~/.claude/hooks/spec-guard-*.{js,sh}\n" +
      'from a hand-wired install, you may delete them now (the merge re-pointed settings to the packaged paths).\n'
  );
  return 0;
}

module.exports = { run, wireMachine };
