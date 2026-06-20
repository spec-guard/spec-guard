'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('node:readline/promises');

const { parseArgs, homeDir, globalManifestPath, isSpecGuardRepo } = require('./_shared');
const config = require('../core/config');
const agents = require('../core/agents');
const manifest = require('../core/manifest');
const installer = require('../core/installer');
const topology = require('../core/topology');
const setup = require('./setup');

// Ask a single question on a TTY; return `def` unchanged when non-interactive (CI/piped).
async function ask(query, def) {
  if (!process.stdin.isTTY) return def;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(query)).trim();
    return answer || def;
  } finally {
    rl.close();
  }
}

// Resolve the agent list: explicit --agent wins; otherwise prompt on a TTY; else default.
async function resolveAgents(flags) {
  if (flags.agent) return agents.parseAgentList(flags.agent);
  if (!process.stdin.isTTY) return ['claude-code'];
  const known = agents.listAgents().join(', ');
  const answer = await ask(
    `Which agents to set up? [claude-code]\n  (comma-separated from: ${known}; or "all"): `,
    'claude-code'
  );
  return agents.parseAgentList(answer);
}

function reportDiverged(summary) {
  const diverged = [];
  for (const s of summary) {
    for (const a of s.acts) {
      if (a && (a.action === 'diverged' || a.action === 'block-diverged')) diverged.push(a);
    }
  }
  if (!diverged.length) return;
  process.stdout.write('\nKept on disk (these differ from what spec-guard last wrote, so they were NOT overwritten):\n');
  let anySidecar = false;
  for (const a of diverged) {
    if (a.action === 'diverged') {
      process.stdout.write(`  ${a.absPath}\n    new version saved beside it: ${a.sidecar}\n`);
      anySidecar = true;
    } else {
      process.stdout.write(`  ${a.absPath}  (managed block had local edits; the block was refreshed in place)\n`);
    }
  }
  if (anySidecar) {
    process.stdout.write(
      '\n  These are spec-guard-owned files — a difference is usually an older install or a stray edit,\n' +
        '  not something you authored. To take the new version, replace each file with its\n' +
        '  `.spec-guard-update` sidecar, or just re-render cleanly with `specguard update --force`\n' +
        '  (then delete any leftover `.spec-guard-update` files).\n'
    );
  }
}

// First-run convenience: wire this machine's session hooks (the `setup` step) without a second
// command. Honors --with-global / --no-global; otherwise offers it interactively on a TTY.
async function maybeWireMachine(flags, home, agentList) {
  const needGlobal = agentList.some((id) => id === 'claude-code' || id === 'codex');
  if (!needGlobal) return;
  const globalM = manifest.load(globalManifestPath(home));
  if (Object.keys(globalM.files || {}).length > 0) {
    // Already wired on this machine — say so instead of skipping silently.
    process.stdout.write("  machine hooks already wired (run 'specguard setup' to refresh them).\n");
    return;
  }

  let doIt;
  if (flags['with-global']) doIt = true;
  else if (flags['no-global']) doIt = false;
  else if (process.stdin.isTTY) {
    doIt = (await ask("Wire this machine's session hooks now (SessionStart/Stop + statusline)? [Y/n]: ", 'y'))
      .toLowerCase()
      .startsWith('y');
  } else {
    doIt = false; // non-interactive (CI/piped): never mutate machine config silently
  }

  if (!doIt) {
    process.stdout.write("\nNote: run 'specguard setup' to wire the session hooks (SessionStart/Stop) for Claude Code / Codex.\n");
    return;
  }
  const { wired, missing } = setup.wireMachine(home, { force: !!flags.force });
  process.stdout.write('\nmachine setup:\n' + wired.join('\n') + '\n');
  if (missing.length) process.stderr.write('WARNING: hook files missing after setup:\n  ' + missing.join('\n  ') + '\n');
}

async function run(args) {
  const { flags, positionals } = parseArgs(args);
  const repoRoot = path.resolve(positionals[0] || '.');
  const home = homeDir(flags);
  const alreadyInit = fs.existsSync(path.join(repoRoot, '.spec-guard', 'config.json'));

  let agentList;
  try {
    agentList = await resolveAgents(flags);
  } catch (e) {
    process.stderr.write(e.message + '\n');
    return 1;
  }

  const specDir = (typeof flags['spec-dir'] === 'string' && flags['spec-dir']) || 'docs/specs';
  const plansDir = (typeof flags['plans-dir'] === 'string' && flags['plans-dir']) || 'docs/plans';
  const privateDir = (typeof flags['private-dir'] === 'string' && flags['private-dir']) || '.private';
  const force = !!flags.force;

  const settings = { specDir, plansDir, privateDir, agents: agentList };

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

  process.stdout.write(`specguard: installed into ${repoRoot}\n`);
  process.stdout.write(`  spec dir: ${specDir}   plans dir: ${plansDir}\n`);
  process.stdout.write(`  agents: ${agentList.join(', ') || '(none)'}${skipRules ? '  (self-dogfood: rules-block skipped)' : ''}\n`);
  if (alreadyInit) {
    process.stdout.write("  (already initialized — `specguard update` is the lighter re-render for upgrades)\n");
  }

  await maybeWireMachine(flags, home, agentList);

  reportDiverged(summary);
  return 0;
}

module.exports = { run };
