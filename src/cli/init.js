'use strict';

const fs = require('fs');
const path = require('path');

const { parseArgs, homeDir, globalManifestPath, isSpecGuardRepo } = require('./_shared');
const config = require('../core/config');
const agents = require('../core/agents');
const manifest = require('../core/manifest');
const installer = require('../core/installer');
const topology = require('../core/topology');

function reportDiverged(summary) {
  const diverged = [];
  for (const s of summary) {
    for (const a of s.acts) {
      if (a && (a.action === 'diverged' || a.action === 'block-diverged')) diverged.push(a);
    }
  }
  if (!diverged.length) return;
  process.stdout.write('\nUser-edited files were NOT overwritten:\n');
  for (const a of diverged) {
    if (a.action === 'diverged') process.stdout.write(`  ${a.absPath}\n    -> new version written to ${a.sidecar}\n`);
    else process.stdout.write(`  ${a.absPath} (managed block had local edits; block refreshed in place)\n`);
  }
}

function run(args) {
  const { flags, positionals } = parseArgs(args);
  const repoRoot = path.resolve(positionals[0] || '.');
  const home = homeDir(flags);

  let agentList;
  try {
    agentList = flags.agent ? agents.parseAgentList(flags.agent) : ['claude-code'];
  } catch (e) {
    process.stderr.write(e.message + '\n');
    return 1;
  }

  const specDir = (typeof flags['spec-dir'] === 'string' && flags['spec-dir']) || 'docs/specs';
  const plansDir = (typeof flags['plans-dir'] === 'string' && flags['plans-dir']) || 'docs/plans';
  const force = !!flags.force;

  const settings = { specDir, plansDir, agents: agentList };

  // Topology: record backup-monorepo + module list so the rules/ripple logic is repo-aware.
  const t = topology.detect(repoRoot, { reinit: true });
  if (t.kind === 'multi-git-root' || flags.scope === 'all') {
    settings.backupMonorepo = true;
    settings.modules = t.modules;
  }
  if (t.kind === 'deliverable-subrepo') {
    process.stdout.write(
      'Note: this looks like a deliverable sub-repo inside a backup monorepo. Multi-repo management\n' +
        'is best run from the root; installing local-only here.\n'
    );
  }

  const vars = installer.renderVars(settings);
  const ctx = { repoRoot, homeDir: home };
  const skipRules = isSpecGuardRepo(repoRoot);

  if (flags.scaffold) {
    const created = installer.scaffoldProject(repoRoot, vars);
    if (created.length) process.stdout.write(`scaffolded ${created.length} doc file(s): ${created.join(', ')}\n`);
  }

  config.writeRepoConfig(repoRoot, settings);
  const repoManifestPath = path.join(repoRoot, '.spec-guard', 'manifest.json');
  const m = manifest.load(repoManifestPath);

  const summary = installer.applyAgents(ctx, agentList, vars, m, { skipRules, force });

  manifest.save(repoManifestPath, m);

  process.stdout.write(`spec-guard: installed into ${repoRoot}\n`);
  process.stdout.write(`  spec dir: ${specDir}   plans dir: ${plansDir}\n`);
  process.stdout.write(`  agents: ${agentList.join(', ')}${skipRules ? '  (self-dogfood: rules-block skipped)' : ''}\n`);

  const needGlobal = agentList.some((id) => id === 'claude-code' || id === 'codex');
  const globalM = manifest.load(globalManifestPath(home));
  const hasGlobal = Object.keys(globalM.files || {}).length > 0;
  if (needGlobal && !hasGlobal) {
    process.stdout.write(
      "\nNote: run 'spec-guard install --global' to wire the session hooks (SessionStart/Stop) for Claude Code / Codex.\n"
    );
  }

  reportDiverged(summary);
  return 0;
}

module.exports = { run };
