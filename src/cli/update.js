'use strict';

const path = require('path');

const { parseArgs, homeDir, isSpecGuardRepo } = require('./_shared');
const config = require('../core/config');
const agents = require('../core/agents');
const manifest = require('../core/manifest');
const installer = require('../core/installer');

// Re-render owned files idempotently from the saved repo config. Manifest-guarded:
// user-edited files are protected (sidecar) and never clobbered.
function run(args) {
  const { flags, positionals } = parseArgs(args);
  const start = path.resolve(positionals[0] || '.');
  const home = homeDir(flags);
  const force = !!flags.force;

  const repoRoot = config.findRepoRoot(start);
  if (!repoRoot) {
    process.stderr.write("specguard: no .spec-guard/config.json found. Run 'specguard init' first.\n");
    return 1;
  }

  const settings = config.resolveRepoSettings(start);
  const agentList = settings.agents && settings.agents.length ? settings.agents : ['claude-code'];
  let validated;
  try {
    validated = agents.parseAgentList(agentList.join(','));
  } catch (e) {
    process.stderr.write(e.message + '\n');
    return 1;
  }

  const vars = installer.renderVars(settings);
  const ctx = { repoRoot, homeDir: home };
  const skipRules = isSpecGuardRepo(repoRoot);
  const repoManifestPath = path.join(repoRoot, '.spec-guard', 'manifest.json');
  const m = manifest.load(repoManifestPath);

  const summary = installer.applyAgents(ctx, validated, vars, m, { skipRules, force });
  manifest.save(repoManifestPath, m);

  const counts = {};
  let diverged = 0;
  for (const s of summary) {
    for (const a of s.acts) {
      counts[a.action] = (counts[a.action] || 0) + 1;
      if (a.action === 'diverged' || a.action === 'block-diverged') {
        diverged++;
        if (a.sidecar) process.stdout.write(`  protected (user-edited): ${a.absPath}\n    new version -> ${a.sidecar}\n`);
      }
    }
  }
  process.stdout.write(`specguard: update complete (${validated.join(', ')})\n`);
  process.stdout.write('  ' + Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join('  ') + '\n');
  if (diverged) process.stdout.write(`  ${diverged} user-edited file(s) protected — review the .spec-guard-update sidecars.\n`);
  return 0;
}

module.exports = { run };
