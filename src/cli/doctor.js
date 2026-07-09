'use strict';

const fs = require('fs');
const path = require('path');

const { parseArgs, homeDir, globalManifestPath } = require('./_shared');
const config = require('../core/config');
const agents = require('../core/agents');
const manifest = require('../core/manifest');
const jsonmerge = require('../core/jsonmerge');
const topology = require('../core/topology');
const lint = require('../core/lint');
const graphify = require('../core/graphify');
const render = require('../core/render');
const rulesblock = require('../core/rulesblock');
const manifestCore = require('../core/manifest');
const pkg = require('../../package.json');

// Machine-check mode (post-upgrade gate): no project tree required. Validates that the binary
// loads, a global install is recorded, and every recorded global hook is wired to the current
// command + bundle.
function machineCheck(home) {
  if (typeof pkg.version !== 'string' || !pkg.version) return { ok: false, why: 'version missing' };
  const m = manifest.load(globalManifestPath(home));
  const keys = Object.keys(m.files || {});
  if (!keys.some((k) => /hookbundle/.test(k))) {
    return { ok: false, why: 'no global install recorded (run: specguard setup)' };
  }
  for (const id of ['claude-code', 'codex']) {
    if (!keys.some((k) => k.startsWith(`global:${id}:hooks`))) continue;
    const agent = agents.get(id);
    const hs = hookStatus(agent, { repoRoot: null, homeDir: home });
    if (!hs.ok) return { ok: false, why: `${id}: ${hs.text}` };
  }
  return { ok: true };
}

function doubleInjectionReport(home) {
  const out = [];
  const targets = [
    ['claude-code settings.json', path.join(home, '.claude', 'settings.json')],
    ['codex hooks.json', path.join(home, '.codex', 'hooks.json')],
  ];
  for (const [label, p] of targets) {
    let cfg;
    try { cfg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { continue; }
    for (const ev of ['SessionStart', 'Stop']) {
      const n = jsonmerge.countOwned(cfg, ev);
      if (n > 1) out.push(`  WARNING: ${label} ${ev} has ${n} spec-guard entries (double-injection)`);
      else if (n === 1) out.push(`  ok: ${label} ${ev} has 1 spec-guard entry`);
    }
  }
  return out;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

function hasRulesBlock(file) {
  try { return rulesblock.hasBlock(fs.readFileSync(file, 'utf8')); } catch (e) { return false; }
}

function commandFilesPresent(agent, ctx) {
  if (!agent.commands) return true;
  const dir = agents.resolveCommandsDir(agent, ctx);
  return render.listCommandTemplates().every((tpl) => {
    const out = render.renderCommand(tpl, agent.commands.format, {});
    const destDir = out.umbrella && agent.commands.namespaced ? path.dirname(dir) : dir;
    return fs.existsSync(path.join(destDir, out.filename));
  });
}

function ownedHookEntries(config, eventName) {
  if (!config || !config.hooks || !Array.isArray(config.hooks[eventName])) return [];
  const out = [];
  for (const group of config.hooks[eventName]) {
    if (!group || !Array.isArray(group.hooks)) continue;
    for (const entry of group.hooks) {
      if (jsonmerge.defaultPredicate(entry)) out.push(entry);
    }
  }
  return out;
}

function expectedHookSpec(agent, ctx) {
  if (!agent.hooks || !agent.hooks.events || agent.hooks.events.length === 0) return null;

  if (agent.hooks.kind === 'gemini-extension') {
    const hooksDir = path.join(ctx.repoRoot, agent.extensionDir, 'hooks', 'spec-guard');
    const activate = path.join(hooksDir, 'activate.js');
    const configFile = path.join(hooksDir, 'config.js');
    const syncCheck = path.join(hooksDir, 'sync-check.sh');
    const statusline = path.join(hooksDir, 'statusline.sh');
    return {
      commands: {
        SessionStart: `node "${activate}"`,
        Stop: `bash "${syncCheck}"`,
      },
      files: [
        [activate, path.join(render.PKG_ROOT, 'src', 'hooks', 'activate.js')],
        [configFile, path.join(render.PKG_ROOT, 'src', 'core', 'config.js')],
        [syncCheck, path.join(render.PKG_ROOT, 'src', 'hooks', 'sync-check.sh')],
        [statusline, path.join(render.PKG_ROOT, 'src', 'hooks', 'statusline.sh')],
      ],
    };
  }

  if (agent.hooks.kind === 'claude-settings' || agent.hooks.kind === 'codex-hooks') {
    const globalSkillDir = path.join(ctx.homeDir, agent.globalSkillDir || agent.skill.dir);
    const agentRoot = path.dirname(path.dirname(globalSkillDir));
    const hooksDir = path.join(agentRoot, 'hooks', 'spec-guard');
    const activate = path.join(hooksDir, 'activate.js');
    const configFile = path.join(hooksDir, 'config.js');
    const syncCheck = path.join(hooksDir, 'sync-check.sh');
    const statusline = path.join(hooksDir, 'statusline.sh');
    const stopCommand = agent.id === 'codex'
      ? `SPEC_GUARD_HOOK_FORMAT=codex-silent bash "${syncCheck}"`
      : `bash "${syncCheck}"`;
    return {
      commands: {
        SessionStart: `node "${activate}"`,
        Stop: stopCommand,
      },
      files: [
        [activate, path.join(render.PKG_ROOT, 'src', 'hooks', 'activate.js')],
        [configFile, path.join(render.PKG_ROOT, 'src', 'core', 'config.js')],
        [syncCheck, path.join(render.PKG_ROOT, 'src', 'hooks', 'sync-check.sh')],
        [statusline, path.join(render.PKG_ROOT, 'src', 'hooks', 'statusline.sh')],
      ],
    };
  }

  return { commands: {}, files: [] };
}

function bundleDiff(files) {
  const missing = [];
  const stale = [];
  for (const [installed, source] of files) {
    let installedContent, sourceContent;
    try { installedContent = fs.readFileSync(installed, 'utf8'); }
    catch (e) { missing.push(installed); continue; }
    try { sourceContent = fs.readFileSync(source, 'utf8'); }
    catch (e) { continue; }
    if (manifestCore.hash(installedContent) !== manifestCore.hash(sourceContent)) stale.push(installed);
  }
  return { missing, stale };
}

function repairHint(agent, issue) {
  if (agent.hooks && agent.hooks.kind === 'gemini-extension') {
    return issue === 'stale-bundle'
      ? 'run: specguard init <repo> --agent gemini --force'
      : 'run: specguard init <repo> --agent gemini';
  }
  if (issue === 'stale-bundle') return 'run: specguard setup --force';
  return 'run: specguard setup';
}

function hookStatus(agent, ctx) {
  if (!agent.hooks || !agent.hooks.events || agent.hooks.events.length === 0) {
    return { ok: true, text: 'no lifecycle hook expected' };
  }

  const hooksPath = agents.resolveHooksConfigPath(agent, ctx);
  const cfg = hooksPath ? readJson(hooksPath) : null;
  if (!cfg) return { ok: false, text: `hooks missing (${agent.hooks.configPath})` };

  const missing = agent.hooks.events.filter((ev) => ownedHookEntries(cfg, ev).length !== 1);
  if (missing.length) return { ok: false, text: `hooks incomplete (${missing.join(', ')})` };

  const expected = expectedHookSpec(agent, ctx);
  if (expected) {
    const stale = agent.hooks.events.filter((ev) => {
      const entry = ownedHookEntries(cfg, ev)[0];
      return expected.commands[ev] && entry.command !== expected.commands[ev];
    });
    if (stale.length) return { ok: false, text: `hooks stale (${stale.join(', ')}; ${repairHint(agent)})` };

    const bundle = bundleDiff(expected.files || []);
    if (bundle.missing.length) return { ok: false, text: `hook bundle missing (${repairHint(agent, 'missing-bundle')})` };
    if (bundle.stale.length) return { ok: false, text: `hook bundle stale (${repairHint(agent, 'stale-bundle')})` };
  }

  return { ok: true, text: 'hooks wired' };
}

function agentHealthLines(repoRoot, home, settings) {
  const ids = Array.isArray(settings.agents) ? settings.agents : [];
  if (!repoRoot || ids.length === 0) return [];

  const ctx = { repoRoot, homeDir: home };
  const lines = ['agent health:'];
  for (const id of ids) {
    let agent;
    try { agent = agents.get(id); } catch (e) { lines.push(`  ${id}: warning (unknown agent in config)`); continue; }

    const problems = [];
    if (!fs.existsSync(path.join(agents.resolveSkillDir(agent, ctx), 'SKILL.md'))) problems.push('skill missing');
    if (!hasRulesBlock(agents.resolveRulesFile(agent, ctx))) problems.push(`rules block missing (${agent.rulesFile})`);
    if (!commandFilesPresent(agent, ctx)) problems.push('commands missing');

    const hs = hookStatus(agent, ctx);
    if (!hs.ok) problems.push(hs.text);

    const cap = agent.capabilities || {};
    const support = cap.support || 'unknown';
    const scope = agent.skill && agent.skill.scope === 'home' ? 'home-scoped skill' : 'repo-scoped skill';
    if (problems.length) lines.push(`  ${id}: warning (${support}; ${scope}) — ${problems.join('; ')}`);
    else lines.push(`  ${id}: ok (${support}; ${scope}; ${hs.text})`);
  }
  return lines;
}

function run(args) {
  const { flags, positionals } = parseArgs(args);
  const home = homeDir(flags);

  if (flags.quiet) {
    const r = machineCheck(home);
    return r.ok ? 0 : 1;
  }

  const start = path.resolve(positionals[0] || '.');
  const lines = [`specguard doctor (v${pkg.version})`];
  lines.push(`mode: ${config.getDefaultMode()}`);

  const repoRoot = config.findRepoRoot(start);
  if (repoRoot) {
    const s = config.resolveRepoSettings(start);
    lines.push(`repo: ${repoRoot}  (spec=${s.specDir} plans=${s.plansDir} agents=${s.agents.join(',') || 'none'})`);
    lines.push(...agentHealthLines(repoRoot, home, s));
  } else {
    lines.push(`repo: none found above ${start}`);
  }

  const globalM = manifest.load(globalManifestPath(home));
  lines.push(`global install: ${Object.keys(globalM.files || {}).length ? 'present' : 'absent (run: specguard setup)'}`);

  lines.push('hook entries:');
  const di = doubleInjectionReport(home);
  lines.push(...(di.length ? di : ['  (no agent hook configs found)']));

  // Topology
  const topoRoot = repoRoot || start;
  const t = topology.detect(topoRoot, { reinit: true });
  lines.push(`topology: ${t.kind}` + (t.modules.length ? ` (${t.modules.length} module repos)` : ''));
  if (t.backupMonorepo) lines.push('  backup-monorepo: yes' + (t.transientGitBackup ? ' (a module .git is currently .git_backup)' : ''));

  // IP/deliverable wall
  const privateDir = (repoRoot ? config.resolveRepoSettings(start).privateDir : null) || '.private';
  const violations = lint.lintRepo(topoRoot, { privateDir });
  if (violations.length) {
    lines.push(`wall: ${violations.length} violation(s) — docs/ files linking into ${privateDir}/ or an agent dir:`);
    for (const v of violations.slice(0, 20)) lines.push(`  ${path.relative(topoRoot, v.file)}:${v.line}  ${v.text}`);
  } else {
    lines.push(`wall: clean (no docs/ -> ${privateDir}/ or agent-dir hyperlinks)`);
  }

  // Scaffolded convention docs left as unfilled placeholders (warn-only; never changes exit code).
  const placeholders = lint.findScaffoldPlaceholders(topoRoot);
  if (placeholders.length) {
    lines.push(`scaffold: ${placeholders.length} convention doc(s) still hold the placeholder — fill them or replace with a 1-line pointer:`);
    for (const f of placeholders.slice(0, 20)) lines.push(`  ${path.relative(topoRoot, f)}`);
  } else {
    lines.push('scaffold: clean (no unfilled convention-doc placeholders)');
  }

  lines.push(`graphify: ${graphify.available(topoRoot) ? 'available (ORIENT/VERIFY can use it)' : 'not present (grep/read fallback)'}`);

  process.stdout.write(lines.join('\n') + '\n');
  return violations.length ? 2 : 0;
}

module.exports = { run, machineCheck };
