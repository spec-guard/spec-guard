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
  if (!current || /statusline-combined|spec-guard/.test(current)) {
    cfg.statusLine = { type: 'command', command: `bash "${statuslinePath}"` };
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(cfg, null, 2) + '\n');
    return 'set';
  }
  return 'left-user-statusline';
}

// Wire the machine for the hook-bearing agents (claude-code, codex). Returns
// { wired: string[], missing: string[] } — `wired` are human-readable summary lines.
function wireMachine(home, opts) {
  const force = !!(opts && opts.force);
  const vars = installer.renderVars({}); // global fallback skill uses defaults
  const m = manifest.load(globalManifestPath(home));
  const wired = [];
  const verifyPaths = [];

  for (const id of ['claude-code', 'codex']) {
    const agent = agents.get(id);
    const ctx = { repoRoot: null, homeDir: home };
    const globalSkillDir = path.join(home, agent.globalSkillDir || agent.skill.dir);
    installer.installSkillTree(globalSkillDir, id, vars, m, `global:${id}:skill`, force);

    const agentRoot = path.dirname(path.dirname(globalSkillDir)); // .../.claude
    const hooksDir = path.join(agentRoot, 'hooks', 'spec-guard');
    installer.copyHookBundle(hooksDir, m, `global:${id}:hooks`, force);
    const activatePath = path.join(hooksDir, 'activate.js');
    const syncCheckPath = path.join(hooksDir, 'sync-check.sh');
    verifyPaths.push(activatePath, syncCheckPath);

    const actions = wireHooks(agents.resolveHooksConfigPath(agent, ctx), activatePath, syncCheckPath);

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
      setStatusLine(path.join(agentRoot, 'settings.json'), statuslinePath);
      verifyPaths.push(statuslinePath);
      statusInfo = `, statusline ${sl.action}`;
    }
    wired.push(`  ${id}: SessionStart ${actions.SessionStart}, Stop ${actions.Stop}${statusInfo}`);
  }

  manifest.save(globalManifestPath(home), m);
  const missing = verifyPaths.filter((p) => !fs.existsSync(p));
  return { wired, missing };
}

function run(args) {
  const { flags } = parseArgs(args);
  const home = homeDir(flags);
  const { wired, missing } = wireMachine(home, { force: !!flags.force });

  process.stdout.write('specguard: machine setup (Claude Code + Codex session hooks)\n' + wired.join('\n') + '\n');

  if (missing.length) {
    process.stderr.write('\nWARNING: expected hook files missing after setup:\n  ' + missing.join('\n  ') + '\n');
    return 1;
  }
  process.stdout.write(
    "\nVerified: hook scripts exist. If you previously had loose ~/.claude/hooks/spec-guard-*.{js,sh}\n" +
      'from a hand-wired install, you may delete them now (the merge re-pointed settings to the packaged paths).\n'
  );
  return 0;
}

module.exports = { run, wireMachine };
