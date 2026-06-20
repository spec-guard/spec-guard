'use strict';

const path = require('path');

const { parseArgs, homeDir, globalManifestPath } = require('./_shared');
const config = require('../core/config');
const manifest = require('../core/manifest');

function run(args) {
  const { positionals, flags } = parseArgs(args);
  const start = path.resolve(positionals[0] || '.');
  const home = homeDir(flags);

  const lines = [];
  lines.push(`specguard: ${config.getDefaultMode()}`);

  const repoRoot = config.findRepoRoot(start);
  if (repoRoot) {
    const s = config.resolveRepoSettings(start);
    lines.push(`repo: ${repoRoot}`);
    lines.push(`  spec dir: ${s.specDir}   plans dir: ${s.plansDir}`);
    lines.push(`  agents: ${s.agents.length ? s.agents.join(', ') : '(none recorded)'}`);
    if (s.backupMonorepo) lines.push('  backup-monorepo: yes');
  } else {
    lines.push(`repo: (no .spec-guard/config.json found above ${start})`);
  }

  const globalM = manifest.load(globalManifestPath(home));
  const globalCount = Object.keys(globalM.files || {}).length;
  lines.push(`global install: ${globalCount ? `${globalCount} owned files` : 'not installed (run: specguard setup)'}`);

  process.stdout.write(lines.join('\n') + '\n');
  return 0;
}

module.exports = { run };
