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
const pkg = require('../../package.json');

// Machine-check mode (post-upgrade gate): no project tree required. Validates that the binary
// loads, a global install is recorded, and every recorded hook bundle's activate.js exists on disk.
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
    const agentRoot = path.dirname(path.dirname(path.join(home, agent.globalSkillDir || agent.skill.dir)));
    const activate = path.join(agentRoot, 'hooks', 'spec-guard', 'activate.js');
    if (!fs.existsSync(activate)) return { ok: false, why: `missing hook bundle: ${activate}` };
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

  lines.push(`graphify: ${graphify.available(topoRoot) ? 'available (ORIENT/VERIFY can use it)' : 'not present (grep/read fallback)'}`);

  process.stdout.write(lines.join('\n') + '\n');
  return violations.length ? 2 : 0;
}

module.exports = { run, machineCheck };
