'use strict';

// Reverse of `init` (per-repo) and `install --global` (machine). Symmetric with the installer:
// it recomputes every owned path from the agent matrix and removes it, strips the managed
// rules-block in place (never deleting the user's rules file), and unwires the lifecycle hooks
// by logical identity (co-tenant hooks are never touched). `--dry-run` prints the plan and
// changes nothing; `--purge` (global) also forgets preferences (XDG config + the on/off flag).

const fs = require('fs');
const path = require('path');

const { parseArgs, homeDir, globalManifestPath } = require('./_shared');
const config = require('../core/config');
const agents = require('../core/agents');
const render = require('../core/render');
const rulesblock = require('../core/rulesblock');
const jsonmerge = require('../core/jsonmerge');

function rmFile(absPath, plan, dry) {
  if (!fs.existsSync(absPath)) return;
  plan.push(`remove file  ${absPath}`);
  if (!dry) fs.rmSync(absPath, { force: true });
}

function rmDir(absPath, plan, dry) {
  if (!fs.existsSync(absPath)) return;
  plan.push(`remove dir   ${absPath}`);
  if (!dry) fs.rmSync(absPath, { recursive: true, force: true });
}

// Remove a directory only if it exists and is empty (tidy up shared parents we no longer fill).
function rmDirIfEmpty(absPath, plan, dry) {
  try {
    if (dry) {
      // In dry mode the children may still be present; report intent only if it WOULD be empty
      // after the planned deletions. Best-effort: report if currently empty.
      if (fs.existsSync(absPath) && fs.readdirSync(absPath).length === 0) plan.push(`rmdir empty  ${absPath}`);
      return;
    }
    if (fs.existsSync(absPath) && fs.readdirSync(absPath).length === 0) {
      fs.rmdirSync(absPath);
      plan.push(`rmdir empty  ${absPath}`);
    }
  } catch (e) { /* non-empty or gone — leave it */ }
}

function stripRulesBlock(absPath, plan, dry) {
  if (!fs.existsSync(absPath)) return;
  const content = fs.readFileSync(absPath, 'utf8');
  if (!rulesblock.hasBlock(content)) return;
  plan.push(`strip block  ${absPath}`);
  if (dry) return;
  const next = rulesblock.remove(content);
  if (next === '') fs.rmSync(absPath, { force: true }); // file was only our block
  else fs.writeFileSync(absPath, next);
}

// ---- per-repo ----------------------------------------------------------------

function uninstallRepoAgent(agent, ctx, vars, plan, dry) {
  // Track the per-agent root (e.g. .claude) so we can tidy it if it ends up empty.
  let agentRoot = null;

  // Skill tree (repo-scoped only; codex's skill is home-scoped and handled by --global).
  if (agent.skill && agent.skill.scope === 'repo') {
    const skillDir = agents.resolveSkillDir(agent, ctx);
    agentRoot = path.dirname(path.dirname(skillDir)); // .../.claude
    rmDir(skillDir, plan, dry);
    rmDirIfEmpty(path.dirname(skillDir), plan, dry); // e.g. .claude/skills
  }

  // Gemini extension is a self-contained dir (skill + commands + hooks + manifest).
  if (agent.extension) {
    rmDir(path.join(ctx.repoRoot, agent.extensionDir), plan, dry);
    rmDirIfEmpty(path.join(ctx.repoRoot, path.dirname(agent.extensionDir)), plan, dry); // .gemini/extensions
    rmDirIfEmpty(path.join(ctx.repoRoot, '.gemini'), plan, dry);
  } else if (agent.commands) {
    // Command files (phase commands + the bare-/spec umbrella at the namespace root).
    const dir = agents.resolveCommandsDir(agent, ctx);
    for (const tpl of render.listCommandTemplates()) {
      const out = render.renderCommand(tpl, agent.commands.format, vars);
      const destDir = out.umbrella && agent.commands.namespaced ? path.dirname(dir) : dir;
      rmFile(path.join(destDir, out.filename), plan, dry);
    }
    if (agent.commands.namespaced) rmDirIfEmpty(dir, plan, dry); // .claude/commands/spec
    rmDirIfEmpty(path.dirname(dir), plan, dry); // .claude/commands
  }

  // Managed rules-block (strip in place; never delete a user-authored rules file outright).
  stripRulesBlock(agents.resolveRulesFile(agent, ctx), plan, dry);

  // Tidy the per-agent root if we emptied it (never removes a dir with user content).
  if (agentRoot) rmDirIfEmpty(agentRoot, plan, dry);
}

function runRepo(flags, positionals) {
  const start = path.resolve(positionals[0] || '.');
  const home = homeDir(flags);
  const dry = !!flags['dry-run'];

  const repoRoot = config.findRepoRoot(start) || start;
  const settings = config.resolveRepoSettings(start);
  let agentList = settings.agents && settings.agents.length ? settings.agents : ['claude-code'];
  if (flags.agent) {
    try { agentList = agents.parseAgentList(flags.agent); }
    catch (e) { process.stderr.write(e.message + '\n'); return 1; }
  }

  const vars = { specDir: settings.specDir, plansDir: settings.plansDir, privateDir: settings.privateDir };
  const ctx = { repoRoot, homeDir: home };
  const plan = [];

  for (const id of agentList) {
    let agent;
    try { agent = agents.get(id); } catch (e) { continue; }
    uninstallRepoAgent(agent, ctx, vars, plan, dry);
  }

  // Drop the repo control dir (config + manifest) unless scoping to a subset of agents.
  if (!flags.agent) rmDir(path.join(repoRoot, '.spec-guard'), plan, dry);

  process.stdout.write(`spec-guard: uninstall ${dry ? '(dry-run) ' : ''}from ${repoRoot}\n`);
  process.stdout.write(plan.length ? '  ' + plan.join('\n  ') + '\n' : '  nothing to remove (not installed?)\n');
  if (!dry) {
    process.stdout.write('  done. Your docs/, specs, plans, and .private/ were left untouched.\n');
    process.stdout.write("  (global hooks remain — run 'spec-guard uninstall --global' to unwire this machine.)\n");
  }
  return 0;
}

// ---- global ------------------------------------------------------------------

function unwireHooks(configPath, plan, dry) {
  if (!fs.existsSync(configPath)) return;
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (e) { return; }
  const removed =
    jsonmerge.removeHookCommand(cfg, 'SessionStart') + jsonmerge.removeHookCommand(cfg, 'Stop');
  // Drop our statusLine if it points at the spec-guard combined script.
  let slCleared = false;
  if (cfg.statusLine && typeof cfg.statusLine.command === 'string' &&
      /statusline-combined|spec-guard/.test(cfg.statusLine.command)) {
    delete cfg.statusLine;
    slCleared = true;
  }
  if (removed || slCleared) {
    plan.push(`unwire hooks ${configPath} (${removed} entr${removed === 1 ? 'y' : 'ies'}${slCleared ? ' + statusLine' : ''})`);
    if (!dry) {
      if (Object.keys(cfg.hooks || {}).length === 0) delete cfg.hooks;
      fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n');
    }
  }
}

function runGlobal(flags) {
  const home = homeDir(flags);
  const dry = !!flags['dry-run'];
  const purge = !!flags.purge;
  const plan = [];

  for (const id of ['claude-code', 'codex']) {
    const agent = agents.get(id);
    const ctx = { repoRoot: null, homeDir: home };
    const globalSkillDir = path.join(home, agent.globalSkillDir || agent.skill.dir);
    const agentRoot = path.dirname(path.dirname(globalSkillDir)); // .../.claude (or .codex)

    rmDir(globalSkillDir, plan, dry);
    rmDirIfEmpty(path.dirname(globalSkillDir), plan, dry); // .../skills
    rmDir(path.join(agentRoot, 'hooks', 'spec-guard'), plan, dry);
    if (id === 'claude-code') rmFile(path.join(agentRoot, 'hooks', 'statusline-combined.sh'), plan, dry);
    rmDirIfEmpty(path.join(agentRoot, 'hooks'), plan, dry);

    unwireHooks(agents.resolveHooksConfigPath(agent, ctx), plan, dry);
  }

  // The machine-level manifest of owned global files.
  rmFile(globalManifestPath(home), plan, dry);
  rmDirIfEmpty(path.dirname(globalManifestPath(home)), plan, dry);

  if (purge) {
    // Forget preferences: the on/off flag and the XDG config dir.
    rmFile(path.join(home, '.claude', '.spec-guard-active'), plan, dry);
    rmDir(path.join(home, '.config', 'spec-guard'), plan, dry);
  }

  process.stdout.write(`spec-guard: global uninstall ${dry ? '(dry-run) ' : ''}(${home})\n`);
  process.stdout.write(plan.length ? '  ' + plan.join('\n  ') + '\n' : '  nothing wired (already clean)\n');
  if (!dry && !purge) {
    process.stdout.write("  preferences kept (on/off state). Re-run with --purge to also forget those.\n");
  }
  return 0;
}

function run(args) {
  const { flags, positionals } = parseArgs(args);
  return flags.global ? runGlobal(flags) : runRepo(flags, positionals);
}

module.exports = { run, runRepo, runGlobal };
