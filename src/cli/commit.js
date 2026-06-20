'use strict';

// `spec-guard commit` — the deterministic terminal step of the loop. It does NOT invent the
// message (that's an LLM/skill job via /spec:commit); it validates + cleans a provided message,
// then commits the current repo, or — with --all/--scope — each impacted deliverable repo in
// order followed by the backup root (topology-aware). Enforces Conventional Commits and strips
// any AI attribution. Optional --graphify re-syncs the knowledge graph per impacted module.
//
//   spec-guard commit --message "feat: ..."            # current repo (staged changes)
//   spec-guard commit --add --message "fix: ..."       # stage all first, then commit
//   spec-guard commit --all --message "chore: ..."     # every impacted deliverable repo + root
//   spec-guard commit --scope public-api,docs -m "..." # specific modules
//   spec-guard commit --all -m "..." --graphify        # + per-module graphify extract/merge

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { parseArgs } = require('./_shared');
const config = require('../core/config');
const graphify = require('../core/graphify');

const CONVENTIONAL = /^(feat|fix|chore|docs|refactor|test|perf|build|ci|style|revert)(\([^)]+\))?!?: .+/;

// Lines that smell like AI attribution — never allowed in a deliverable commit.
const ATTRIBUTION = [
  /Co-Authored-By:.*(claude|anthropic|ai|copilot|gpt|gemini|noreply@)/i,
  /Generated with.*(claude|ai|copilot)/i,
  /Claude-Session:/i,
  /🤖 Generated with/i, // 🤖
  /Co-authored-by: Claude/i,
];

function cleanMessage(msg) {
  const kept = msg
    .split('\n')
    .filter((line) => !ATTRIBUTION.some((re) => re.test(line)))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+$/, '');
  return kept;
}

function git(repoDir, args, opts) {
  return spawnSync('git', ['-C', repoDir].concat(args), Object.assign({ encoding: 'utf8' }, opts || {}));
}

function hasStagedChanges(repoDir) {
  return git(repoDir, ['diff', '--cached', '--quiet']).status !== 0;
}

function hasAnyChanges(repoDir) {
  const r = git(repoDir, ['status', '--porcelain']);
  return r.status === 0 && r.stdout.trim().length > 0;
}

// Commit one repo. Returns 'committed' | 'nothing' | 'error'.
function commitRepo(repoDir, message, { add }) {
  if (add) git(repoDir, ['add', '-A']);
  if (!hasStagedChanges(repoDir)) return 'nothing';
  const r = git(repoDir, ['commit', '-m', message]);
  return r.status === 0 ? 'committed' : 'error';
}

function runGraphify(root, modules) {
  // Curated-safe: per-impacted-module extract + merge into the root graph. Best-effort.
  if (!graphify.available(root)) return '  graphify: not present (skipped)';
  const out = [];
  for (const m of modules) {
    const r = spawnSync('graphify', ['extract', `./${m}/`], { cwd: root, encoding: 'utf8' });
    out.push(`    extract ${m}: ${r.status === 0 ? 'ok' : 'failed'}`);
  }
  const merge = spawnSync('graphify', ['merge-graphs'].concat(modules.map((m) => `${m}/graphify-out/graph.json`)).concat(['--out', 'graphify-out/graph.json']), { cwd: root, encoding: 'utf8' });
  out.push(`    merge -> root graph: ${merge.status === 0 ? 'ok' : 'failed (review; curated build is sensitive)'}`);
  return '  graphify (curated re-merge):\n' + out.join('\n');
}

function run(args) {
  const { flags, positionals } = parseArgs(args);
  const root = path.resolve(positionals[0] || '.');
  const message = (typeof flags.message === 'string' && flags.message) ||
    (typeof flags.m === 'string' && flags.m) ||
    (flags['message-file'] && fs.existsSync(flags['message-file']) ? fs.readFileSync(flags['message-file'], 'utf8') : null);

  if (!message) {
    process.stderr.write('spec-guard commit: provide --message "type: subject" (the message is authored by you / the agent, not generated here).\n');
    return 1;
  }

  const clean = cleanMessage(message);
  if (!CONVENTIONAL.test(clean.split('\n')[0])) {
    process.stderr.write(`spec-guard commit: message is not a Conventional Commit (expected "feat|fix|chore|...: subject").\n  got: ${clean.split('\n')[0]}\n`);
    if (!flags.force) return 1;
  }
  if (clean !== message.replace(/\s+$/, '')) {
    process.stdout.write('note: stripped AI-attribution line(s) from the message (deliverable commits carry no AI attribution).\n');
  }

  const settings = config.resolveRepoSettings(root);
  const out = [];

  // Single-repo mode.
  if (!flags.all && !flags.scope) {
    const res = commitRepo(root, clean, { add: !!flags.add });
    process.stdout.write(res === 'committed' ? `committed (${path.basename(root)})\n` : res === 'nothing' ? 'nothing staged to commit (use --add to stage all)\n' : 'commit failed\n');
    return res === 'error' ? 1 : 0;
  }

  // Multi-repo mode: impacted deliverable modules in config order, then the backup root.
  let modules = settings.modules || [];
  if (typeof flags.scope === 'string' && flags.scope !== 'all' && flags.scope !== true) {
    const want = new Set(flags.scope.split(',').map((s) => s.trim()));
    modules = modules.filter((m) => want.has(m));
  }
  const impacted = [];
  for (const m of modules) {
    const dir = path.join(root, m);
    if (fs.existsSync(path.join(dir, '.git')) && hasAnyChanges(dir)) {
      const res = commitRepo(dir, clean, { add: true });
      out.push(`  ${m}: ${res}`);
      if (res === 'committed') impacted.push(m);
    }
  }
  // Backup root last (captures everything, incl. IP).
  const rootRes = commitRepo(root, clean, { add: true });
  out.push(`  <root backup>: ${rootRes}`);

  process.stdout.write(`spec-guard commit --all (lang=${settings.commitLanguage})\n` + out.join('\n') + '\n');
  process.stdout.write(`  impacted modules: ${impacted.length ? impacted.join(', ') : 'none'}\n`);

  if (flags.graphify && impacted.length) {
    process.stdout.write(runGraphify(root, impacted) + '\n');
  }
  return 0;
}

module.exports = { run, cleanMessage, CONVENTIONAL };
