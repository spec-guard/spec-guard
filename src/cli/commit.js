'use strict';

// `specguard commit` — the deterministic terminal step of the loop. It does NOT invent the
// message (that's an LLM/skill job via /spec:commit); it validates + cleans a provided message,
// then commits the current repo, or — with --all/--scope — each impacted deliverable repo in
// order followed by the backup root (topology-aware). Enforces Conventional Commits and strips
// any AI attribution. Optional --graphify re-syncs the knowledge graph (structural/incremental)
// per impacted module + the root merge, BEFORE committing, so the refreshed graph lands in the same
// commit. The deep SEMANTIC pass is the agent's job (run `/graphify --mode deep` via the /spec:commit
// workflow, or set GEMINI_API_KEY for a headless semantic pass).
//
//   specguard commit --message "feat: ..."            # current repo (staged changes)
//   specguard commit --add --message "fix: ..."       # stage all first, then commit
//   specguard commit --all --message "chore: ..."     # every impacted deliverable repo + root
//   specguard commit --scope public-api,docs -m "..." # specific modules
//   specguard commit --all --graphify -m "..."        # refresh module graphs + root merge, then commit

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

// Stage a repo's refreshed graph dir so it commits atomically with the code.
function stageGraph(repoDir) {
  spawnSync('git', ['-C', repoDir, 'add', 'graphify-out'], { encoding: 'utf8' });
}

// Refresh the root repo's own graph (single-repo case). Incremental + structural; the deep
// SEMANTIC pass is the agent's job via `/graphify --mode deep` (or needs GEMINI_API_KEY headless).
function syncRootGraph(root) {
  if (!graphify.available(root)) return '  graphify: not present (skipped)';
  const r = spawnSync('graphify', ['update'], { cwd: root, encoding: 'utf8', timeout: 120000 });
  stageGraph(root);
  return `  graphify update (root): ${r.status === 0 ? 'ok' : 'failed (review)'}`;
}

// Backup-monorepo case: refresh each impacted module's graph, then re-merge the freshly-updated
// module graphs into the curated root graph. Runs BEFORE the commits so every graph lands in the
// same commit as its code. Structural/incremental + curated-safe (no naive full rebuild); the deep
// semantic pass is the agent's job. Best-effort + fallback-safe.
function syncModuleGraphs(root, modules) {
  if (!graphify.available(root)) return '  graphify: not present (skipped)';
  const out = [];
  for (const m of modules) {
    const dir = path.join(root, m);
    let r;
    if (graphify.available(dir)) {
      r = spawnSync('graphify', ['update'], { cwd: dir, encoding: 'utf8', timeout: 120000 });
      out.push(`    update ${m}: ${r.status === 0 ? 'ok' : 'failed'}`);
    } else {
      r = spawnSync('graphify', ['extract', `./${m}/`], { cwd: root, encoding: 'utf8', timeout: 120000 });
      out.push(`    extract ${m} (first build): ${r.status === 0 ? 'ok' : 'failed'}`);
    }
    stageGraph(dir);
  }
  if (modules.length) {
    const merge = spawnSync('graphify', ['merge-graphs'].concat(modules.map((m) => `${m}/graphify-out/graph.json`)).concat(['--out', 'graphify-out/graph.json']), { cwd: root, encoding: 'utf8', timeout: 120000 });
    out.push(`    merge -> root graph: ${merge.status === 0 ? 'ok' : 'failed (review; curated build is sensitive)'}`);
  }
  stageGraph(root);
  return '  graphify (pre-commit structural re-sync; run /graphify --mode deep in-agent for semantic):\n' + out.join('\n');
}

function run(args) {
  const { flags, positionals } = parseArgs(args);
  const root = path.resolve(positionals[0] || '.');
  const message = (typeof flags.message === 'string' && flags.message) ||
    (typeof flags.m === 'string' && flags.m) ||
    (flags['message-file'] && fs.existsSync(flags['message-file']) ? fs.readFileSync(flags['message-file'], 'utf8') : null);

  if (!message) {
    process.stderr.write('specguard commit: provide --message "type: subject" (the message is authored by you / the agent, not generated here).\n');
    return 1;
  }

  const clean = cleanMessage(message);
  if (!CONVENTIONAL.test(clean.split('\n')[0])) {
    process.stderr.write(`specguard commit: message is not a Conventional Commit (expected "feat|fix|chore|...: subject").\n  got: ${clean.split('\n')[0]}\n`);
    if (!flags.force) return 1;
  }
  // Only claim we stripped attribution when an attribution line was actually present — `cleanMessage`
  // also collapses blank lines, so a plain whitespace diff would falsely accuse a clean message.
  const strippedAttribution = message.split('\n').some((line) => ATTRIBUTION.some((re) => re.test(line)));
  if (strippedAttribution) {
    process.stdout.write('note: stripped AI-attribution line(s) from the message (deliverable commits carry no AI attribution).\n');
  }

  const settings = config.resolveRepoSettings(root);
  const out = [];

  // Single-repo mode.
  if (!flags.all && !flags.scope) {
    // Graph sync BEFORE the commit so the refreshed graph is part of it.
    if (flags.graphify) process.stdout.write(syncRootGraph(root) + '\n');
    const res = commitRepo(root, clean, { add: !!flags.add });
    if (res === 'committed') process.stdout.write(`specguard: committed (${path.basename(root)})\n`);
    else if (res === 'nothing') process.stdout.write('specguard: nothing staged to commit (use --add to stage all)\n');
    else process.stderr.write('specguard commit: commit failed\n');
    return res === 'error' ? 1 : 0;
  }

  // Multi-repo mode: impacted deliverable modules in config order, then the backup root.
  let modules = settings.modules || [];
  if (typeof flags.scope === 'string' && flags.scope !== 'all' && flags.scope !== true) {
    const want = new Set(flags.scope.split(',').map((s) => s.trim()));
    modules = modules.filter((m) => want.has(m));
  }
  // Determine impacted modules (changed) up front so the graph refresh runs BEFORE any commit.
  const changed = modules.filter((m) => {
    const dir = path.join(root, m);
    return fs.existsSync(path.join(dir, '.git')) && hasAnyChanges(dir);
  });

  if (flags.graphify) process.stdout.write(syncModuleGraphs(root, changed) + '\n');

  const impacted = [];
  for (const m of changed) {
    const res = commitRepo(path.join(root, m), clean, { add: true });
    out.push(`  ${m}: ${res}`);
    if (res === 'committed') impacted.push(m);
  }
  // Backup root last (captures everything, incl. IP + the re-merged root graph).
  const rootRes = commitRepo(root, clean, { add: true });
  out.push(`  <root backup>: ${rootRes}`);

  process.stdout.write(`specguard commit --all (lang=${settings.commitLanguage})\n` + out.join('\n') + '\n');
  process.stdout.write(`  impacted modules: ${impacted.length ? impacted.join(', ') : 'none'}\n`);
  return 0;
}

module.exports = { run, cleanMessage, CONVENTIONAL };
