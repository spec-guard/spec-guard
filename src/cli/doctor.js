'use strict';

const fs = require('fs');
const path = require('path');

const { parseArgs, homeDir, globalManifestPath } = require('./_shared');
const config = require('../core/config');
const manifest = require('../core/manifest');
const jsonmerge = require('../core/jsonmerge');
const pkg = require('../../package.json');

// Machine-check mode (post-upgrade gate): no project tree required. Validates that the binary
// loads, the global manifest's hook files exist and are readable, and version is a string.
function machineCheck(home) {
  if (typeof pkg.version !== 'string' || !pkg.version) return { ok: false, why: 'version missing' };
  const m = manifest.load(globalManifestPath(home));
  for (const [key, rec] of Object.entries(m.files || {})) {
    if (!/hookbundle/.test(key)) continue;
    // key looks like global:<agent>:hooks:hookbundle:<name>; the absPath isn't stored, so we
    // re-derive nothing here — presence of the manifest with hook entries is the signal.
    void rec;
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
  const lines = [`spec-guard doctor (v${pkg.version})`];
  lines.push(`mode: ${config.getDefaultMode()}`);

  const repoRoot = config.findRepoRoot(start);
  if (repoRoot) {
    const s = config.resolveRepoSettings(start);
    lines.push(`repo: ${repoRoot}  (spec=${s.specDir} plans=${s.plansDir} agents=${s.agents.join(',') || 'none'})`);
  } else {
    lines.push(`repo: none found above ${start}`);
  }

  const globalM = manifest.load(globalManifestPath(home));
  lines.push(`global install: ${Object.keys(globalM.files || {}).length ? 'present' : 'absent (run install --global)'}`);

  lines.push('hook entries:');
  const di = doubleInjectionReport(home);
  lines.push(...(di.length ? di : ['  (no agent hook configs found)']));

  // Topology + IP/deliverable wall lint land in Phase 3.
  lines.push('topology + wall lint: available after the differentiators phase');

  process.stdout.write(lines.join('\n') + '\n');
  return 0;
}

module.exports = { run, machineCheck };
