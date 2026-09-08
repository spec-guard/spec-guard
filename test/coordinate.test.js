'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const coordinate = require('../src/cli/coordinate.js');
const cli = require('../src/cli/index.js');

// A repo nested one level inside its own tmp dir, so the worktree-root sibling convention
// (`../.spec-guard-worktrees`, resolved against the repo root) lands INSIDE `base` too — one
// `rmSync(base)` cleans up the repo and every worktree it spawned, with no cross-test collision.
function gitRepo() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-coord-'));
  const d = path.join(base, 'repo');
  fs.mkdirSync(d, { recursive: true });
  const g = (args) => spawnSync('git', ['-C', d].concat(args), { encoding: 'utf8' });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.name', 'Test']);
  g(['config', 'user.email', 'test@example.com']);
  return { base, d, g };
}

function writeLanes(d, lanes) {
  const f = path.join(d, 'lanes.json');
  fs.writeFileSync(f, JSON.stringify(lanes));
  return f;
}

function capture(fn) {
  let out = '';
  const o = process.stdout.write, e = process.stderr.write;
  process.stdout.write = (c) => { out += c; return true; };
  process.stderr.write = () => true;
  try { return { code: fn(), out }; } finally { process.stdout.write = o; process.stderr.write = e; }
}

// Same as capture(), but for a call whose result is a Promise (cmdWatch, and anything dispatched
// through cli.main) — stdout must stay captured across the whole async wait, not just the
// synchronous part of the call.
async function captureAsync(fn) {
  let out = '';
  const o = process.stdout.write, e = process.stderr.write;
  process.stdout.write = (c) => { out += c; return true; };
  process.stderr.write = () => true;
  try { const code = await fn(); return { code, out }; } finally { process.stdout.write = o; process.stderr.write = e; }
}

function laneFile(d, runId, laneId) {
  return path.join(d, '.spec-guard', 'coordination', runId, 'lanes', `${laneId}.json`);
}
function readLane(d, runId, laneId) {
  return JSON.parse(fs.readFileSync(laneFile(d, runId, laneId), 'utf8'));
}

// ------------------------------------------------------------------------------------------
// plan
// ------------------------------------------------------------------------------------------

test('plan refuses lanes whose declared paths resolve to the same tracked file', () => {
  const { base, d, g } = gitRepo();
  fs.mkdirSync(path.join(d, 'src'), { recursive: true });
  fs.writeFileSync(path.join(d, 'src', 'shared.js'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'init']);

  const lanesFile = writeLanes(d, [
    { id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['src/shared.js'] },
    { id: 'lane-b', kind: 'adhoc', description: 'b', declaredPaths: ['src/*.js'] },
  ]);

  const { code, out } = capture(() => coordinate.run(['plan', '--root', d, '--file', lanesFile]));
  assert.strictEqual(code, 1);
  assert.match(out, /REFUSED/);
  assert.match(out, /shared\.js/);
  assert.ok(!fs.existsSync(path.join(d, '.spec-guard', 'coordination')), 'plan must write nothing on conflict');
  fs.rmSync(base, { recursive: true, force: true });
});

test('plan refuses two lanes pointing at the same spec', () => {
  const { base, d, g } = gitRepo();
  fs.writeFileSync(path.join(d, 'a.txt'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'init']);

  const lanesFile = writeLanes(d, [
    { id: 'lane-a', kind: 'spec-ref', specPath: 'docs/specs/0012-x.md', declaredPaths: ['src/a/**'] },
    { id: 'lane-b', kind: 'spec-ref', specPath: 'docs/specs/0012-x.md', declaredPaths: ['src/b/**'] },
  ]);

  const { code, out } = capture(() => coordinate.run(['plan', '--root', d, '--file', lanesFile]));
  assert.strictEqual(code, 1);
  assert.match(out, /same spec/i);
  fs.rmSync(base, { recursive: true, force: true });
});

test('plan with no overlap writes run.json and one lane file per lane, all pending', () => {
  const { base, d, g } = gitRepo();
  fs.writeFileSync(path.join(d, 'a.txt'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'init']);

  const lanesFile = writeLanes(d, [
    { id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['src/a/**'] },
    { id: 'lane-b', kind: 'adhoc', description: 'b', declaredPaths: ['src/b/**'] },
  ]);

  const { code, out } = capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'test-run', '--file', lanesFile]));
  assert.strictEqual(code, 0);
  assert.match(out, /created run "test-run"/);

  const runDoc = JSON.parse(fs.readFileSync(path.join(d, '.spec-guard', 'coordination', 'test-run', 'run.json'), 'utf8'));
  assert.deepStrictEqual(runDoc.laneIds.slice().sort(), ['lane-a', 'lane-b']);
  assert.strictEqual(readLane(d, 'test-run', 'lane-a').status, 'pending');
  assert.strictEqual(readLane(d, 'test-run', 'lane-b').status, 'pending');
  fs.rmSync(base, { recursive: true, force: true });
});

test('plan writes a self-contained .gitignore under .spec-guard/coordination/ on first use, without touching the repo root .gitignore', () => {
  const { base, d, g } = gitRepo();
  fs.writeFileSync(path.join(d, 'a.txt'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'init']);
  assert.ok(!fs.existsSync(path.join(d, '.gitignore')), 'sanity: no root .gitignore before coordinate ever ran');

  const lanesFile = writeLanes(d, [{ id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['src/a/**'] }]);
  capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r15', '--file', lanesFile]));

  const gi = fs.readFileSync(path.join(d, '.spec-guard', 'coordination', '.gitignore'), 'utf8');
  assert.match(gi, /^\*$/m, 'must ignore everything under coordination/ by default');
  assert.ok(!fs.existsSync(path.join(d, '.gitignore')), 'must never create/touch the repo root .gitignore');

  const status = spawnSync('git', ['-C', d, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' }).stdout;
  assert.ok(!status.includes('.spec-guard/coordination/r15/run.json'), 'the ledger itself must be invisible to git status once ignored');
  fs.rmSync(base, { recursive: true, force: true });
});

test('plan refuses an ad-hoc lane with no declaredPaths hint', () => {
  const { base, d, g } = gitRepo();
  fs.writeFileSync(path.join(d, 'a.txt'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'init']);
  const lanesFile = writeLanes(d, [{ id: 'lane-a', kind: 'adhoc', description: 'a' }]);
  const { code } = capture(() => coordinate.run(['plan', '--root', d, '--file', lanesFile]));
  assert.strictEqual(code, 1);
  fs.rmSync(base, { recursive: true, force: true });
});

// ------------------------------------------------------------------------------------------
// start
// ------------------------------------------------------------------------------------------

test('start creates one worktree per lane, always a sibling of the repo root, never inside it', () => {
  const { base, d, g } = gitRepo();
  fs.writeFileSync(path.join(d, 'a.txt'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'init']);

  const lanesFile = writeLanes(d, [{ id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['src/a/**'] }]);
  capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r1', '--file', lanesFile]));

  const { code } = capture(() => coordinate.run(['start', '--root', d, '--run', 'r1']));
  assert.strictEqual(code, 0);

  const lane = readLane(d, 'r1', 'lane-a');
  assert.strictEqual(lane.status, 'running');
  assert.strictEqual(lane.worktrees.length, 1);
  const wtPath = lane.worktrees[0].path;
  assert.ok(fs.existsSync(wtPath));
  const rel = path.relative(d, wtPath);
  assert.ok(rel.startsWith('..'), `worktree path must be outside the repo root; got relative path "${rel}"`);
  fs.rmSync(base, { recursive: true, force: true });
});

// ------------------------------------------------------------------------------------------
// report / status / answer
// ------------------------------------------------------------------------------------------

test('report updates lane status and writes a hitl question file when blocked', () => {
  const { base, d, g } = gitRepo();
  fs.writeFileSync(path.join(d, 'a.txt'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'init']);
  const lanesFile = writeLanes(d, [{ id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['src/a/**'] }]);
  capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r2', '--file', lanesFile]));

  const { code } = capture(() => coordinate.run([
    'report', '--root', d, '--run', 'r2', '--lane', 'lane-a',
    '--status', 'blocked', '--question', 'need a decision', '--urgency', 'high',
  ]));
  assert.strictEqual(code, 0);

  const lane = readLane(d, 'r2', 'lane-a');
  assert.strictEqual(lane.status, 'blocked');
  assert.strictEqual(lane.blockedQuestion.question, 'need a decision');
  assert.strictEqual(lane.blockedQuestion.urgency, 'high');

  const q = JSON.parse(fs.readFileSync(path.join(d, '.spec-guard', 'coordination', 'r2', 'hitl', 'lane-a.question.json'), 'utf8'));
  assert.strictEqual(q.question, 'need a decision');
  fs.rmSync(base, { recursive: true, force: true });
});

test('status aggregates open blockers, most urgent first', () => {
  const { base, d, g } = gitRepo();
  fs.writeFileSync(path.join(d, 'a.txt'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'init']);
  const lanesFile = writeLanes(d, [
    { id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['src/a/**'] },
    { id: 'lane-b', kind: 'adhoc', description: 'b', declaredPaths: ['src/b/**'] },
  ]);
  capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r2b', '--file', lanesFile]));
  capture(() => coordinate.run(['report', '--root', d, '--run', 'r2b', '--lane', 'lane-a', '--status', 'blocked', '--question', 'low prio', '--urgency', 'low']));
  capture(() => coordinate.run(['report', '--root', d, '--run', 'r2b', '--lane', 'lane-b', '--status', 'blocked', '--question', 'high prio', '--urgency', 'high']));

  const { code, out } = capture(() => coordinate.run(['status', '--root', d, '--run', 'r2b', '--json']));
  assert.strictEqual(code, 0);
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.blocked.length, 2);
  assert.strictEqual(parsed.blocked[0].id, 'lane-b', 'high urgency must be listed first');
  fs.rmSync(base, { recursive: true, force: true });
});

test('answer writes the response and resumes the lane to its pre-block status', () => {
  const { base, d, g } = gitRepo();
  fs.writeFileSync(path.join(d, 'a.txt'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'init']);
  const lanesFile = writeLanes(d, [{ id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['src/a/**'] }]);
  capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r3', '--file', lanesFile]));
  capture(() => coordinate.run(['report', '--root', d, '--run', 'r3', '--lane', 'lane-a', '--status', 'running']));
  capture(() => coordinate.run(['report', '--root', d, '--run', 'r3', '--lane', 'lane-a', '--status', 'blocked', '--question', 'pick an approach']));

  const { code } = capture(() => coordinate.run(['answer', '--root', d, '--run', 'r3', '--lane', 'lane-a', '--text', 'use approach B']));
  assert.strictEqual(code, 0);

  const lane = readLane(d, 'r3', 'lane-a');
  assert.strictEqual(lane.status, 'running', 'must resume to the status the lane had before it blocked');
  assert.strictEqual(lane.answer.text, 'use approach B');
  assert.strictEqual(lane.blockedQuestion, null);

  const ans = JSON.parse(fs.readFileSync(path.join(d, '.spec-guard', 'coordination', 'r3', 'hitl', 'lane-a.answer.json'), 'utf8'));
  assert.strictEqual(ans.text, 'use approach B');
  fs.rmSync(base, { recursive: true, force: true });
});

test('report refuses to update a lane that is already terminal (merged/failed/aborted)', () => {
  const { base, d, g } = gitRepo();
  fs.writeFileSync(path.join(d, 'a.txt'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'init']);
  const lanesFile = writeLanes(d, [{ id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['src/a/**'] }]);
  capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r3b', '--file', lanesFile]));
  capture(() => coordinate.run(['report', '--root', d, '--run', 'r3b', '--lane', 'lane-a', '--status', 'failed']));
  assert.strictEqual(readLane(d, 'r3b', 'lane-a').status, 'failed');

  const { code } = capture(() => coordinate.run(['report', '--root', d, '--run', 'r3b', '--lane', 'lane-a', '--status', 'running']));
  assert.strictEqual(code, 1, 'a finished lane must never be reopened by report');
  assert.strictEqual(readLane(d, 'r3b', 'lane-a').status, 'failed', 'status must be untouched');

  const declaredPathsAttempt = capture(() => coordinate.run(['report', '--root', d, '--run', 'r3b', '--lane', 'lane-a', '--declared-paths', 'src/other/**']));
  assert.strictEqual(declaredPathsAttempt.code, 1, 'declaredPaths must also be immutable once terminal — this is what status --refresh depends on to never reopen a shipped lane');
  fs.rmSync(base, { recursive: true, force: true });
});

// ------------------------------------------------------------------------------------------
// merge
// ------------------------------------------------------------------------------------------

function commitInWorktree(wtPath, file, message) {
  fs.writeFileSync(path.join(wtPath, file), 'content\n');
  spawnSync('git', ['-C', wtPath, 'add', '-A'], { encoding: 'utf8' });
  spawnSync('git', ['-C', wtPath, 'commit', '-q', '-m', message], { encoding: 'utf8' });
}

test('merge reverts the merge (git reset --hard) and blocks the lane when the test gate fails', () => {
  const { base, d, g } = gitRepo();
  fs.writeFileSync(path.join(d, 'a.txt'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'init']);
  const preMergeSha = g(['rev-parse', 'HEAD']).stdout.trim();

  const lanesFile = writeLanes(d, [{ id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['feature.txt'] }]);
  capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r4', '--file', lanesFile]));
  capture(() => coordinate.run(['start', '--root', d, '--run', 'r4']));
  const wtPath = readLane(d, 'r4', 'lane-a').worktrees[0].path;
  commitInWorktree(wtPath, 'feature.txt', 'feat: add feature');
  capture(() => coordinate.run(['report', '--root', d, '--run', 'r4', '--lane', 'lane-a', '--status', 'verified']));

  const { code, out } = capture(() => coordinate.run(['merge', '--root', d, '--run', 'r4', '--test-cmd', 'exit 1']));
  assert.strictEqual(code, 0, 'a blocked lane is a lane-level outcome, not a whole-command failure');
  assert.match(out, /BLOCKED/);

  const lane = readLane(d, 'r4', 'lane-a');
  assert.strictEqual(lane.status, 'blocked');
  assert.match(lane.blockedQuestion.question, /test gate failed/);

  const postSha = g(['rev-parse', 'HEAD']).stdout.trim();
  assert.strictEqual(postSha, preMergeSha, 'base HEAD must be reverted to the pre-merge sha');
  assert.ok(!fs.existsSync(path.join(d, 'feature.txt')), 'the file introduced by the reverted merge must be gone');
  fs.rmSync(base, { recursive: true, force: true });
});

test('merge writes a generic commit message — never git\'s default, which would leak the internal branch name', () => {
  const { base, d, g } = gitRepo();
  fs.writeFileSync(path.join(d, 'a.txt'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'init']);

  const lanesFile = writeLanes(d, [{ id: 'my-feature', kind: 'adhoc', description: 'a', declaredPaths: ['feature.txt'] }]);
  capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r28', '--file', lanesFile]));
  capture(() => coordinate.run(['start', '--root', d, '--run', 'r28']));
  const wt = readLane(d, 'r28', 'my-feature').worktrees[0];
  commitInWorktree(wt.path, 'feature.txt', 'feat: add feature');
  capture(() => coordinate.run(['report', '--root', d, '--run', 'r28', '--lane', 'my-feature', '--status', 'verified']));

  capture(() => coordinate.run(['merge', '--root', d, '--run', 'r28', '--test-cmd', 'true']));

  const msg = g(['log', '-1', '--format=%B']).stdout;
  assert.strictEqual(msg.trim(), 'Merge: my-feature');
  assert.doesNotMatch(msg, /spec-guard/i, 'must never leak the tool name into a commit a user might publish');
  assert.doesNotMatch(msg, new RegExp(wt.branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'must never leak the internal branch name (git\'s --no-edit default does exactly this)');
  fs.rmSync(base, { recursive: true, force: true });
});

test('merge with no resolvable test command fails closed and refuses to merge', () => {
  const { base, d, g } = gitRepo();
  fs.writeFileSync(path.join(d, 'a.txt'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'init']);
  const preMergeSha = g(['rev-parse', 'HEAD']).stdout.trim();

  const lanesFile = writeLanes(d, [{ id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['feature.txt'] }]);
  capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r5', '--file', lanesFile]));
  capture(() => coordinate.run(['start', '--root', d, '--run', 'r5']));
  const wtPath = readLane(d, 'r5', 'lane-a').worktrees[0].path;
  commitInWorktree(wtPath, 'feature.txt', 'feat: x');
  capture(() => coordinate.run(['report', '--root', d, '--run', 'r5', '--lane', 'lane-a', '--status', 'verified']));

  // No --test-cmd, no coordination.testCommand configured, and no package.json in the repo.
  const { code } = capture(() => coordinate.run(['merge', '--root', d, '--run', 'r5']));
  assert.strictEqual(code, 1, 'must fail closed instead of silently skipping the test gate');

  const lane = readLane(d, 'r5', 'lane-a');
  assert.strictEqual(lane.status, 'verified', 'lane must be untouched, not silently marked merged');
  const postSha = g(['rev-parse', 'HEAD']).stdout.trim();
  assert.strictEqual(postSha, preMergeSha, 'the merge attempted for gate resolution must have been reverted');
  fs.rmSync(base, { recursive: true, force: true });
});

test('merge respects dependsOn — a dependent lane waits until its dependency has merged', () => {
  const { base, d, g } = gitRepo();
  fs.writeFileSync(path.join(d, 'a.txt'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'init']);

  const lanesFile = writeLanes(d, [
    { id: 'lane-base', kind: 'adhoc', description: 'base', declaredPaths: ['base.txt'] },
    { id: 'lane-dep', kind: 'adhoc', description: 'dep', declaredPaths: ['dep.txt'], dependsOn: ['lane-base'] },
  ]);
  capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r6', '--file', lanesFile]));
  capture(() => coordinate.run(['start', '--root', d, '--run', 'r6']));

  for (const [id, file] of [['lane-base', 'base.txt'], ['lane-dep', 'dep.txt']]) {
    const wtPath = readLane(d, 'r6', id).worktrees[0].path;
    commitInWorktree(wtPath, file, `feat: ${id}`);
    capture(() => coordinate.run(['report', '--root', d, '--run', 'r6', '--lane', id, '--status', 'verified']));
  }

  // Merging only lane-dep first must be skipped: its dependency hasn't merged yet.
  const { out } = capture(() => coordinate.run(['merge', '--root', d, '--run', 'r6', '--lane', 'lane-dep', '--test-cmd', 'true']));
  assert.match(out, /SKIPPED.*waiting on dependsOn/i);
  assert.strictEqual(readLane(d, 'r6', 'lane-dep').status, 'verified', 'must not merge ahead of its dependency');

  // A full merge pass merges the dependency first, then the dependent lane in the same pass.
  capture(() => coordinate.run(['merge', '--root', d, '--run', 'r6', '--test-cmd', 'true']));
  assert.strictEqual(readLane(d, 'r6', 'lane-base').status, 'merged');
  assert.strictEqual(readLane(d, 'r6', 'lane-dep').status, 'merged');
  fs.rmSync(base, { recursive: true, force: true });
});

// ------------------------------------------------------------------------------------------
// resolve-merge / finish / list
// ------------------------------------------------------------------------------------------

test('resolve-merge retry returns a blocked lane to verified; abort marks it aborted and removes its worktree', () => {
  const { base, d, g } = gitRepo();
  fs.writeFileSync(path.join(d, 'a.txt'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'init']);
  const lanesFile = writeLanes(d, [{ id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['feature.txt'] }]);
  capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r7', '--file', lanesFile]));
  capture(() => coordinate.run(['start', '--root', d, '--run', 'r7']));
  const wtPath = readLane(d, 'r7', 'lane-a').worktrees[0].path;
  commitInWorktree(wtPath, 'feature.txt', 'feat: x');
  capture(() => coordinate.run(['report', '--root', d, '--run', 'r7', '--lane', 'lane-a', '--status', 'verified']));
  capture(() => coordinate.run(['merge', '--root', d, '--run', 'r7', '--test-cmd', 'exit 1']));
  assert.strictEqual(readLane(d, 'r7', 'lane-a').status, 'blocked');

  const retry = capture(() => coordinate.run(['resolve-merge', '--root', d, '--run', 'r7', '--lane', 'lane-a', '--action', 'retry']));
  assert.strictEqual(retry.code, 0);
  assert.strictEqual(readLane(d, 'r7', 'lane-a').status, 'verified');

  // Block it again, then abort this time.
  capture(() => coordinate.run(['merge', '--root', d, '--run', 'r7', '--test-cmd', 'exit 1']));
  assert.strictEqual(readLane(d, 'r7', 'lane-a').status, 'blocked');
  const wtPathBefore = readLane(d, 'r7', 'lane-a').worktrees[0].path;
  const abort = capture(() => coordinate.run(['resolve-merge', '--root', d, '--run', 'r7', '--lane', 'lane-a', '--action', 'abort']));
  assert.strictEqual(abort.code, 0);
  assert.strictEqual(readLane(d, 'r7', 'lane-a').status, 'aborted');
  assert.ok(!fs.existsSync(wtPathBefore), 'abort must remove the worktree');
  fs.rmSync(base, { recursive: true, force: true });
});

test('resolve-merge abort reverts a module that already merged successfully before a LATER module in the same lane blocked', () => {
  const { base, d } = gitRepoWithModules(['module-a', 'module-b']);

  const lanesFile = writeLanes(d, [{ id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['module-a/feature.txt', 'module-b/feature.txt'] }]);
  capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r18', '--file', lanesFile]));
  capture(() => coordinate.run(['start', '--root', d, '--run', 'r18']));

  const lane = readLane(d, 'r18', 'lane-a');
  const wtA = lane.worktrees.find((w) => w.module === 'module-a');
  const wtB = lane.worktrees.find((w) => w.module === 'module-b');
  commitInWorktree(wtA.path, 'feature.txt', 'feat: a');
  commitInWorktree(wtB.path, 'feature.txt', 'feat: b');
  capture(() => coordinate.run(['report', '--root', d, '--run', 'r18', '--lane', 'lane-a', '--status', 'verified']));

  const preShaB = spawnSync('git', ['-C', path.join(d, 'module-b'), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  // module-a's test gate passes, module-b's fails — module-a lands, THEN the lane blocks on module-b.
  const testCmd = process.platform === 'win32'
    ? 'if "%INIT_CWD%"=="" exit 0'
    : '[ "$(basename "$PWD")" = "module-a" ] && exit 0 || exit 1';
  capture(() => coordinate.run(['merge', '--root', d, '--run', 'r18', '--test-cmd', testCmd]));
  assert.strictEqual(readLane(d, 'r18', 'lane-a').status, 'blocked');
  assert.ok(fs.existsSync(path.join(d, 'module-a', 'feature.txt')), 'sanity: module-a really did land before the lane blocked on module-b');

  const { code } = capture(() => coordinate.run(['resolve-merge', '--root', d, '--run', 'r18', '--lane', 'lane-a', '--action', 'abort']));
  assert.strictEqual(code, 0);
  assert.strictEqual(readLane(d, 'r18', 'lane-a').status, 'aborted');
  assert.ok(!fs.existsSync(path.join(d, 'module-a', 'feature.txt')), 'abort must revert the module that already merged, not just remove worktrees and stop halfway');
  const headB = spawnSync('git', ['-C', path.join(d, 'module-b'), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  assert.strictEqual(headB, preShaB, 'module-b, which never landed, must be untouched');
  fs.rmSync(base, { recursive: true, force: true });
});

test('resolve-merge abort refuses to auto-revert a module if something else has landed there since (never a blind reset --hard)', () => {
  // Two modules so the repo is genuinely `multi-git-root` (needs >=2) and the merge actually
  // targets module-a's own git root, not the outer root — otherwise the "unrelated later commit"
  // written into module-a below would land somewhere the merge never touched.
  const { base, d } = gitRepoWithModules(['module-a', 'module-b']);

  const lanesFile = writeLanes(d, [{ id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['module-a/feature.txt'] }]);
  capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r19', '--file', lanesFile]));
  capture(() => coordinate.run(['start', '--root', d, '--run', 'r19']));
  const wtA = readLane(d, 'r19', 'lane-a').worktrees[0];
  commitInWorktree(wtA.path, 'feature.txt', 'feat: a');
  capture(() => coordinate.run(['report', '--root', d, '--run', 'r19', '--lane', 'lane-a', '--status', 'verified']));

  capture(() => coordinate.run(['merge', '--root', d, '--run', 'r19', '--test-cmd', 'true']));
  const laneAPath = path.join(d, '.spec-guard', 'coordination', 'r19', 'lanes', 'lane-a.json');
  assert.strictEqual(JSON.parse(fs.readFileSync(laneAPath, 'utf8')).status, 'merged', 'sanity: it actually merged');

  // Something ELSE lands on module-a AFTER lane-a's merge (e.g. another lane's merge, or an
  // unrelated commit) — HEAD has moved past the postSha recorded for lane-a's merge attempt.
  fs.writeFileSync(path.join(d, 'module-a', 'other.txt'), 'unrelated later commit\n');
  spawnSync('git', ['-C', path.join(d, 'module-a'), 'add', '-A']);
  spawnSync('git', ['-C', path.join(d, 'module-a'), 'commit', '-q', '-m', 'unrelated later work']);

  // Force lane-a back to blocked (in reality this would be a second worktree of the same lane
  // failing, or a human re-opening it) so `resolve-merge --action abort` has something to act on.
  const laneA = JSON.parse(fs.readFileSync(laneAPath, 'utf8'));
  laneA.status = 'blocked';
  laneA.blockedQuestion = { question: 'contrived for this test', urgency: 'high', blockedAt: new Date().toISOString(), resumeStatus: 'verified' };
  fs.writeFileSync(laneAPath, JSON.stringify(laneA));

  const { code, out } = capture(() => coordinate.run(['resolve-merge', '--root', d, '--run', 'r19', '--lane', 'lane-a', '--action', 'abort']));
  assert.strictEqual(code, 1, 'must signal that manual attention is needed instead of silently succeeding');
  assert.match(out, /NOT auto-reverted/);
  assert.ok(fs.existsSync(path.join(d, 'module-a', 'other.txt')), 'the unrelated later commit must never be destroyed by an automatic revert');
  assert.strictEqual(readLane(d, 'r19', 'lane-a').status, 'blocked', 'must NOT be marked aborted while module-a is still actually merged — that would misreport a partial abort as complete, and (being terminal) freeze the lie permanently');

  // A human who has handled module-a manually can force the lane closed anyway.
  const forced = capture(() => coordinate.run(['resolve-merge', '--root', d, '--run', 'r19', '--lane', 'lane-a', '--action', 'abort', '--force']));
  assert.strictEqual(forced.code, 0);
  assert.strictEqual(readLane(d, 'r19', 'lane-a').status, 'aborted', '--force finalizes it once the human has taken responsibility for the unrevertable module');
  fs.rmSync(base, { recursive: true, force: true });
});

test('resolve-merge abort never marks a module reverted if the revert command itself silently failed', () => {
  const { base, d } = gitRepoWithModules(['module-a', 'module-b']);
  const lanesFile = writeLanes(d, [{ id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['module-a/feature.txt'] }]);
  capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r23', '--file', lanesFile]));
  capture(() => coordinate.run(['start', '--root', d, '--run', 'r23']));
  const wtA = readLane(d, 'r23', 'lane-a').worktrees[0];
  commitInWorktree(wtA.path, 'feature.txt', 'feat: a');
  capture(() => coordinate.run(['report', '--root', d, '--run', 'r23', '--lane', 'lane-a', '--status', 'verified']));
  capture(() => coordinate.run(['merge', '--root', d, '--run', 'r23', '--test-cmd', 'true']));
  const laneAPath = path.join(d, '.spec-guard', 'coordination', 'r23', 'lanes', 'lane-a.json');
  assert.strictEqual(JSON.parse(fs.readFileSync(laneAPath, 'utf8')).status, 'merged');

  // Corrupt the recorded preSha to an unreachable sha, simulating `git reset --hard` failing for
  // any reason (locked index, unreachable object, disk error) — HEAD must NOT actually move.
  const laneA = JSON.parse(fs.readFileSync(laneAPath, 'utf8'));
  const headBefore = spawnSync('git', ['-C', path.join(d, 'module-a'), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  laneA.mergeAttempts[0].preSha = '0000000000000000000000000000000000000000';
  laneA.status = 'blocked';
  laneA.blockedQuestion = { question: 'contrived', urgency: 'high', blockedAt: new Date().toISOString(), resumeStatus: 'verified' };
  fs.writeFileSync(laneAPath, JSON.stringify(laneA));

  const { code, out } = capture(() => coordinate.run(['resolve-merge', '--root', d, '--run', 'r23', '--lane', 'lane-a', '--action', 'abort']));
  assert.strictEqual(code, 1, 'a failed revert must never be treated as a successful one');
  assert.match(out, /reverting it failed|NOT auto-reverted/);
  assert.strictEqual(readLane(d, 'r23', 'lane-a').status, 'blocked', 'must stay blocked, not silently become aborted');
  assert.ok(!JSON.parse(fs.readFileSync(laneAPath, 'utf8')).mergeAttempts[0].reverted, 'must not be marked reverted when the reset never actually happened');
  const headAfter = spawnSync('git', ['-C', path.join(d, 'module-a'), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  assert.strictEqual(headAfter, headBefore, 'HEAD must be untouched by a reset that failed');
  fs.rmSync(base, { recursive: true, force: true });
});

test('merge skips a worktree already merged in a prior attempt, instead of re-processing it and duplicating mergeAttempts', () => {
  const { base, d } = gitRepoWithModules(['module-a', 'module-b']);
  const lanesFile = writeLanes(d, [{ id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['module-a/feature.txt', 'module-b/feature.txt'] }]);
  capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r24', '--file', lanesFile]));
  capture(() => coordinate.run(['start', '--root', d, '--run', 'r24']));
  const lane = readLane(d, 'r24', 'lane-a');
  const wtA = lane.worktrees.find((w) => w.module === 'module-a');
  const wtB = lane.worktrees.find((w) => w.module === 'module-b');
  commitInWorktree(wtA.path, 'feature.txt', 'feat: a');
  commitInWorktree(wtB.path, 'feature.txt', 'feat: b');
  capture(() => coordinate.run(['report', '--root', d, '--run', 'r24', '--lane', 'lane-a', '--status', 'verified']));

  // module-a's test passes, module-b's fails — lane blocks after module-a already landed.
  const testCmd = process.platform === 'win32'
    ? 'exit /b 1'
    : '[ "$(basename "$PWD")" = "module-a" ] && exit 0 || exit 1';
  capture(() => coordinate.run(['merge', '--root', d, '--run', 'r24', '--test-cmd', testCmd]));
  assert.strictEqual(readLane(d, 'r24', 'lane-a').status, 'blocked');
  assert.strictEqual(readLane(d, 'r24', 'lane-a').mergeAttempts.filter((a) => a.module === 'module-a').length, 1);

  capture(() => coordinate.run(['resolve-merge', '--root', d, '--run', 'r24', '--lane', 'lane-a', '--action', 'retry']));
  const { out } = capture(() => coordinate.run(['merge', '--root', d, '--run', 'r24', '--test-cmd', testCmd]));
  assert.match(out, /module-a: SKIPPED \(already merged in a prior attempt\)/);
  assert.strictEqual(readLane(d, 'r24', 'lane-a').mergeAttempts.filter((a) => a.module === 'module-a').length, 1, 'must not push a duplicate mergeAttempts entry for a module that already landed');
  fs.rmSync(base, { recursive: true, force: true });
});

test('merge does NOT skip an already-merged worktree if it gained new commits since — the skip must never silently drop work', () => {
  const { base, d } = gitRepoWithModules(['module-a', 'module-b']);
  const lanesFile = writeLanes(d, [{ id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['module-a/feature.txt', 'module-b/feature.txt'] }]);
  capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r25', '--file', lanesFile]));
  capture(() => coordinate.run(['start', '--root', d, '--run', 'r25']));
  const lane = readLane(d, 'r25', 'lane-a');
  const wtA = lane.worktrees.find((w) => w.module === 'module-a');
  const wtB = lane.worktrees.find((w) => w.module === 'module-b');
  commitInWorktree(wtA.path, 'feature.txt', 'feat: a');
  commitInWorktree(wtB.path, 'feature.txt', 'feat: b');
  capture(() => coordinate.run(['report', '--root', d, '--run', 'r25', '--lane', 'lane-a', '--status', 'verified']));

  const testCmd = process.platform === 'win32'
    ? 'exit /b 1'
    : '[ "$(basename "$PWD")" = "module-a" ] && exit 0 || exit 1';
  capture(() => coordinate.run(['merge', '--root', d, '--run', 'r25', '--test-cmd', testCmd]));
  assert.strictEqual(readLane(d, 'r25', 'lane-a').status, 'blocked');
  assert.ok(!fs.existsSync(path.join(d, 'module-a', 'extra.txt')), 'sanity: not there yet');

  // While the lane is still blocked on module-b, a human commits MORE work into module-a's
  // worktree — it hasn't been removed yet because the lane as a whole hasn't succeeded.
  commitInWorktree(wtA.path, 'extra.txt', 'feat: a, part 2');

  capture(() => coordinate.run(['resolve-merge', '--root', d, '--run', 'r25', '--lane', 'lane-a', '--action', 'retry']));
  const testCmdBothPass = 'true';
  const { out } = capture(() => coordinate.run(['merge', '--root', d, '--run', 'r25', '--test-cmd', testCmdBothPass]));
  assert.doesNotMatch(out, /module-a: SKIPPED/, 'a worktree whose branch moved on must be re-merged, never silently skipped');
  assert.strictEqual(readLane(d, 'r25', 'lane-a').status, 'merged');
  assert.ok(fs.existsSync(path.join(d, 'module-a', 'extra.txt')), 'the extra commit made while blocked must actually land — this is exactly the work a blind skip would silently drop');
  fs.rmSync(base, { recursive: true, force: true });
});

test('resolve-merge abort reverts a WHOLE chain of stacked merges for one module atomically, not just the newest layer', () => {
  // A module can carry more than one 'merged' mergeAttempts entry when a worktree is re-merged
  // after gaining new commits (the frontSha fix). Abort must revert the entire chain in one shot,
  // never just the latest layer while leaving an older one still actually merged.
  const { base, d } = gitRepoWithModules(['module-a', 'module-b']);
  const lanesFile = writeLanes(d, [{ id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['module-a/feature.txt', 'module-b/feature.txt'] }]);
  capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r26', '--file', lanesFile]));
  capture(() => coordinate.run(['start', '--root', d, '--run', 'r26']));
  const lane = readLane(d, 'r26', 'lane-a');
  const wtA = lane.worktrees.find((w) => w.module === 'module-a');
  const wtB = lane.worktrees.find((w) => w.module === 'module-b');
  commitInWorktree(wtA.path, 'feature.txt', 'feat: a1');
  commitInWorktree(wtB.path, 'feature.txt', 'feat: b');
  capture(() => coordinate.run(['report', '--root', d, '--run', 'r26', '--lane', 'lane-a', '--status', 'verified']));

  // module-a always passes, module-b always fails — the lane blocks on module-b every time,
  // giving module-a two full merge cycles (two stacked mergeAttempts entries).
  const testCmd = process.platform === 'win32'
    ? 'exit /b 1'
    : '[ "$(basename "$PWD")" = "module-a" ] && exit 0 || exit 1';
  capture(() => coordinate.run(['merge', '--root', d, '--run', 'r26', '--test-cmd', testCmd]));
  assert.strictEqual(readLane(d, 'r26', 'lane-a').status, 'blocked');
  commitInWorktree(wtA.path, 'extra.txt', 'feat: a2');
  capture(() => coordinate.run(['resolve-merge', '--root', d, '--run', 'r26', '--lane', 'lane-a', '--action', 'retry']));
  capture(() => coordinate.run(['merge', '--root', d, '--run', 'r26', '--test-cmd', testCmd]));
  assert.strictEqual(readLane(d, 'r26', 'lane-a').status, 'blocked');
  assert.strictEqual(readLane(d, 'r26', 'lane-a').mergeAttempts.filter((a) => a.module === 'module-a' && a.result === 'merged').length, 2, 'sanity: module-a really has two stacked merge attempts');
  assert.ok(fs.existsSync(path.join(d, 'module-a', 'feature.txt')) && fs.existsSync(path.join(d, 'module-a', 'extra.txt')), 'sanity: both layers actually landed');

  const { code } = capture(() => coordinate.run(['resolve-merge', '--root', d, '--run', 'r26', '--lane', 'lane-a', '--action', 'abort', '--force']));
  assert.strictEqual(code, 0);
  assert.strictEqual(readLane(d, 'r26', 'lane-a').status, 'aborted');
  assert.ok(!fs.existsSync(path.join(d, 'module-a', 'feature.txt')), 'the OLDER layer must also be reverted, not left behind while only the newest is undone');
  assert.ok(!fs.existsSync(path.join(d, 'module-a', 'extra.txt')), 'the newer layer must be reverted too');
  assert.ok(readLane(d, 'r26', 'lane-a').mergeAttempts.filter((a) => a.module === 'module-a').every((a) => a.reverted), 'every entry in the chain must be marked reverted together, never partially');
  fs.rmSync(base, { recursive: true, force: true });
});

test('merge skips a module after 2+ stacked merge attempts once nothing has changed since the LATEST one', () => {
  // Regression: the skip-check must compare against the most recent mergeAttempts entry for a
  // module, not the oldest — otherwise, once a module has 2+ stacked attempts, frontSha compares
  // against a stale entry forever and the module gets pointlessly re-merged (and re-tested) on
  // every single `coordinate merge` call, growing mergeAttempts without bound.
  const { base, d } = gitRepoWithModules(['module-a', 'module-b']);
  const lanesFile = writeLanes(d, [{ id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['module-a/feature.txt', 'module-b/feature.txt'] }]);
  capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r27', '--file', lanesFile]));
  capture(() => coordinate.run(['start', '--root', d, '--run', 'r27']));
  const lane = readLane(d, 'r27', 'lane-a');
  const wtA = lane.worktrees.find((w) => w.module === 'module-a');
  const wtB = lane.worktrees.find((w) => w.module === 'module-b');
  commitInWorktree(wtA.path, 'feature.txt', 'feat: a1');
  commitInWorktree(wtB.path, 'feature.txt', 'feat: b');
  capture(() => coordinate.run(['report', '--root', d, '--run', 'r27', '--lane', 'lane-a', '--status', 'verified']));

  const testCmd = process.platform === 'win32'
    ? 'exit /b 1'
    : '[ "$(basename "$PWD")" = "module-a" ] && exit 0 || exit 1';
  capture(() => coordinate.run(['merge', '--root', d, '--run', 'r27', '--test-cmd', testCmd]));
  commitInWorktree(wtA.path, 'extra.txt', 'feat: a2');
  capture(() => coordinate.run(['resolve-merge', '--root', d, '--run', 'r27', '--lane', 'lane-a', '--action', 'retry']));
  capture(() => coordinate.run(['merge', '--root', d, '--run', 'r27', '--test-cmd', testCmd]));
  assert.strictEqual(readLane(d, 'r27', 'lane-a').mergeAttempts.filter((a) => a.module === 'module-a').length, 2, 'sanity: two stacked attempts so far');

  // Third call, nothing new committed to module-a's worktree since the last (2nd) merge.
  capture(() => coordinate.run(['resolve-merge', '--root', d, '--run', 'r27', '--lane', 'lane-a', '--action', 'retry']));
  const { out } = capture(() => coordinate.run(['merge', '--root', d, '--run', 'r27', '--test-cmd', testCmd]));
  assert.match(out, /module-a: SKIPPED \(already merged in a prior attempt\)/, 'must skip once nothing changed since the most recent attempt, even with an older stale attempt earlier in the array');
  assert.strictEqual(readLane(d, 'r27', 'lane-a').mergeAttempts.filter((a) => a.module === 'module-a').length, 2, 'must not grow mergeAttempts on a no-op call');
  fs.rmSync(base, { recursive: true, force: true });
});

test('finish refuses when lanes are not terminal, unless --force; list reports run status', () => {
  const { base, d, g } = gitRepo();
  fs.writeFileSync(path.join(d, 'a.txt'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'init']);
  const lanesFile = writeLanes(d, [{ id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['src/a/**'] }]);
  capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r8', '--file', lanesFile]));

  const refused = capture(() => coordinate.run(['finish', '--root', d, '--run', 'r8']));
  assert.strictEqual(refused.code, 1);

  const forced = capture(() => coordinate.run(['finish', '--root', d, '--run', 'r8', '--force']));
  assert.strictEqual(forced.code, 0);

  const { out } = capture(() => coordinate.run(['list', '--root', d]));
  assert.match(out, /r8/);
  assert.match(out, /completed/);
  fs.rmSync(base, { recursive: true, force: true });
});

test('finish --purge-worktrees never removes a worktree for a lane that is not terminal', () => {
  const { base, d, g } = gitRepo();
  fs.writeFileSync(path.join(d, 'a.txt'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'init']);
  const lanesFile = writeLanes(d, [{ id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['src/a/**'] }]);
  capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r9', '--file', lanesFile]));
  capture(() => coordinate.run(['start', '--root', d, '--run', 'r9']));
  const wtPath = readLane(d, 'r9', 'lane-a').worktrees[0].path;
  assert.ok(fs.existsSync(wtPath), 'sanity: worktree exists before finish');

  const { code } = capture(() => coordinate.run(['finish', '--root', d, '--run', 'r9', '--force', '--purge-worktrees']));
  assert.strictEqual(code, 0);
  assert.ok(fs.existsSync(wtPath), 'a running (non-terminal) lane\'s worktree must survive --purge-worktrees, even with --force');
  assert.strictEqual(readLane(d, 'r9', 'lane-a').status, 'running', 'purge must not silently change lane status either');
  fs.rmSync(base, { recursive: true, force: true });
});

test('finish surfaces a force-aborted lane that still has a module actually merged and never reverted', () => {
  const { base, d } = gitRepoWithModules(['module-a', 'module-b']);
  const lanesFile = writeLanes(d, [{ id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['module-a/feature.txt'] }]);
  capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r28', '--file', lanesFile]));
  capture(() => coordinate.run(['start', '--root', d, '--run', 'r28']));
  const wtA = readLane(d, 'r28', 'lane-a').worktrees[0];
  commitInWorktree(wtA.path, 'feature.txt', 'feat: a');
  capture(() => coordinate.run(['report', '--root', d, '--run', 'r28', '--lane', 'lane-a', '--status', 'verified']));
  capture(() => coordinate.run(['merge', '--root', d, '--run', 'r28', '--test-cmd', 'true']));
  assert.strictEqual(readLane(d, 'r28', 'lane-a').status, 'merged');

  // Something else lands on module-a after the merge, then the lane is forced back to blocked
  // (contrived, same technique as the earlier "refuses to auto-revert" test) so abort can't
  // safely revert it, and the human overrides with --force anyway.
  fs.writeFileSync(path.join(d, 'module-a', 'other.txt'), 'unrelated later commit\n');
  spawnSync('git', ['-C', path.join(d, 'module-a'), 'add', '-A']);
  spawnSync('git', ['-C', path.join(d, 'module-a'), 'commit', '-q', '-m', 'unrelated later work']);
  const laneAPath = path.join(d, '.spec-guard', 'coordination', 'r28', 'lanes', 'lane-a.json');
  const laneA = JSON.parse(fs.readFileSync(laneAPath, 'utf8'));
  laneA.status = 'blocked';
  laneA.blockedQuestion = { question: 'contrived', urgency: 'high', blockedAt: new Date().toISOString(), resumeStatus: 'verified' };
  fs.writeFileSync(laneAPath, JSON.stringify(laneA));
  capture(() => coordinate.run(['resolve-merge', '--root', d, '--run', 'r28', '--lane', 'lane-a', '--action', 'abort', '--force']));
  assert.strictEqual(readLane(d, 'r28', 'lane-a').status, 'aborted');
  assert.ok(fs.existsSync(path.join(d, 'module-a', 'feature.txt')), 'sanity: module-a really is still merged');

  const { out } = capture(() => coordinate.run(['finish', '--root', d, '--run', 'r28']));
  assert.match(out, /Content still merged and never reverted/, 'the audit must surface this, not claim a clean close');
  assert.match(out, /lane-a\/module-a/);
  assert.doesNotMatch(out, /Nothing left unaccounted for/, 'must not print the clean-close line when something actually is unaccounted for');
  fs.rmSync(base, { recursive: true, force: true });
});

test('finish surfaces stale merged content on a lane pushed straight to failed, bypassing resolve-merge entirely', () => {
  const { base, d } = gitRepoWithModules(['module-a', 'module-b']);
  const lanesFile = writeLanes(d, [{ id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['module-a/feature.txt', 'module-b/feature.txt'] }]);
  capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r33', '--file', lanesFile]));
  capture(() => coordinate.run(['start', '--root', d, '--run', 'r33']));
  const lane = readLane(d, 'r33', 'lane-a');
  const wtA = lane.worktrees.find((w) => w.module === 'module-a');
  const wtB = lane.worktrees.find((w) => w.module === 'module-b');
  commitInWorktree(wtA.path, 'feature.txt', 'feat: a');
  commitInWorktree(wtB.path, 'feature.txt', 'feat: b');
  capture(() => coordinate.run(['report', '--root', d, '--run', 'r33', '--lane', 'lane-a', '--status', 'verified']));
  const testCmd = process.platform === 'win32'
    ? 'exit /b 1'
    : '[ "$(basename "$PWD")" = "module-a" ] && exit 0 || exit 1';
  capture(() => coordinate.run(['merge', '--root', d, '--run', 'r33', '--test-cmd', testCmd]));
  assert.strictEqual(readLane(d, 'r33', 'lane-a').status, 'blocked');
  assert.ok(fs.existsSync(path.join(d, 'module-a', 'feature.txt')), 'sanity: module-a really landed');

  // Someone gives up on module-b and reports the lane straight to `failed` — a terminal status —
  // WITHOUT ever going through `resolve-merge`, so module-a's merge is never reverted or flagged.
  capture(() => coordinate.run(['report', '--root', d, '--run', 'r33', '--lane', 'lane-a', '--status', 'failed']));
  assert.strictEqual(readLane(d, 'r33', 'lane-a').status, 'failed');

  const { out } = capture(() => coordinate.run(['finish', '--root', d, '--run', 'r33']));
  assert.match(out, /Content still merged and never reverted/, 'a failed lane can still have a genuinely-merged, never-reverted module — finish must say so');
  assert.match(out, /lane-a\/module-a/);
  assert.doesNotMatch(out, /Nothing left unaccounted for/);
  fs.rmSync(base, { recursive: true, force: true });
});

test('finish surfaces stale merged content on a lane left blocked and force-finished, without ever going through resolve-merge', () => {
  const { base, d } = gitRepoWithModules(['module-a', 'module-b']);
  const lanesFile = writeLanes(d, [{ id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['module-a/feature.txt', 'module-b/feature.txt'] }]);
  capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r34', '--file', lanesFile]));
  capture(() => coordinate.run(['start', '--root', d, '--run', 'r34']));
  const lane = readLane(d, 'r34', 'lane-a');
  const wtA = lane.worktrees.find((w) => w.module === 'module-a');
  const wtB = lane.worktrees.find((w) => w.module === 'module-b');
  commitInWorktree(wtA.path, 'feature.txt', 'feat: a');
  commitInWorktree(wtB.path, 'feature.txt', 'feat: b');
  capture(() => coordinate.run(['report', '--root', d, '--run', 'r34', '--lane', 'lane-a', '--status', 'verified']));
  const testCmd = process.platform === 'win32'
    ? 'exit /b 1'
    : '[ "$(basename "$PWD")" = "module-a" ] && exit 0 || exit 1';
  capture(() => coordinate.run(['merge', '--root', d, '--run', 'r34', '--test-cmd', testCmd]));
  assert.strictEqual(readLane(d, 'r34', 'lane-a').status, 'blocked');

  // Never resolved — finished with --force while still blocked (a human giving up mid-run).
  const { out } = capture(() => coordinate.run(['finish', '--root', d, '--run', 'r34', '--force']));
  assert.match(out, /Still blocked/);
  assert.match(out, /Content still merged and never reverted/, 'a lane force-finished while blocked can also carry a genuinely-merged module — finish must say so, not just "still blocked"');
  assert.match(out, /lane-a\/module-a/);
  assert.doesNotMatch(out, /Nothing left unaccounted for/);
  fs.rmSync(base, { recursive: true, force: true });
});

// ------------------------------------------------------------------------------------------
// watch / list
// ------------------------------------------------------------------------------------------

test('watch resolves immediately once every lane is already terminal, without waiting on the poll interval', async () => {
  const { base, d, g } = gitRepo();
  fs.writeFileSync(path.join(d, 'a.txt'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'init']);
  const lanesFile = writeLanes(d, [{ id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['src/a/**'] }]);
  capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r29', '--file', lanesFile]));
  capture(() => coordinate.run(['report', '--root', d, '--run', 'r29', '--lane', 'lane-a', '--status', 'failed']));

  const start = Date.now();
  const { out, code } = await captureAsync(() => coordinate.run(['watch', '--root', d, '--run', 'r29', '--interval', '999']));
  assert.strictEqual(code, 0);
  assert.match(out, /reached a terminal state for every lane/);
  assert.ok(Date.now() - start < 2000, 'must not wait out the (huge) poll interval when already terminal on the first tick');
  fs.rmSync(base, { recursive: true, force: true });
});

test('watch stops after --max-ticks without hanging when a lane never reaches terminal', async () => {
  const { base, d, g } = gitRepo();
  fs.writeFileSync(path.join(d, 'a.txt'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'init']);
  const lanesFile = writeLanes(d, [{ id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['src/a/**'] }]);
  capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r30', '--file', lanesFile]));

  const { out, code } = await captureAsync(() => coordinate.run(['watch', '--root', d, '--run', 'r30', '--interval', '999', '--max-ticks', '1']));
  assert.strictEqual(code, 0);
  assert.match(out, /stopped after --max-ticks=1/);
  fs.rmSync(base, { recursive: true, force: true });
});

test('list --active excludes completed/aborted runs and includes runs still in progress', () => {
  const { base, d, g } = gitRepo();
  fs.writeFileSync(path.join(d, 'a.txt'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'init']);
  capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r31-active', '--file', writeLanes(d, [{ id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['src/a/**'] }])]));
  capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r31-done', '--file', writeLanes(d, [{ id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['src/b/**'] }])]));
  capture(() => coordinate.run(['finish', '--root', d, '--run', 'r31-done', '--force']));

  const { out } = capture(() => coordinate.run(['list', '--root', d, '--active']));
  assert.match(out, /r31-active/);
  assert.doesNotMatch(out, /r31-done/, 'a completed run must not appear under --active');
  fs.rmSync(base, { recursive: true, force: true });
});

test('the real CLI dispatcher (specguard coordinate ...) wires up correctly, including awaiting watch\'s Promise', async () => {
  const { base, d, g } = gitRepo();
  fs.writeFileSync(path.join(d, 'a.txt'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'init']);
  const lanesFile = writeLanes(d, [{ id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['src/a/**'] }]);

  const planResult = await captureAsync(() => cli.main(['coordinate', 'plan', '--root', d, '--run-id', 'r32', '--file', lanesFile]));
  assert.strictEqual(planResult.code, 0);
  assert.match(planResult.out, /created run "r32"/);

  capture(() => coordinate.run(['report', '--root', d, '--run', 'r32', '--lane', 'lane-a', '--status', 'merged']));
  const watchResult = await captureAsync(() => cli.main(['coordinate', 'watch', '--root', d, '--run', 'r32', '--interval', '999']));
  assert.strictEqual(watchResult.code, 0, 'main() must actually await the Promise cmdWatch returns, not treat it as already-resolved');
  assert.match(watchResult.out, /reached a terminal state/);
  fs.rmSync(base, { recursive: true, force: true });
});

// ------------------------------------------------------------------------------------------
// path safety
// ------------------------------------------------------------------------------------------

test('plan rejects a path-traversal --run-id and a path-traversal lane id', () => {
  const { base, d, g } = gitRepo();
  fs.writeFileSync(path.join(d, 'a.txt'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'init']);

  const lanesFile = writeLanes(d, [{ id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['src/a/**'] }]);
  const badRunId = capture(() => coordinate.run(['plan', '--root', d, '--run-id', '../../../tmp/escaped', '--file', lanesFile]));
  assert.strictEqual(badRunId.code, 1);
  assert.ok(!fs.existsSync(path.join(d, '..', '..', '..', 'tmp', 'escaped')), 'must not have written outside .spec-guard/coordination');

  const badLaneFile = writeLanes(d, [{ id: '../escaped-lane', kind: 'adhoc', description: 'a', declaredPaths: ['src/a/**'] }]);
  const badLaneId = capture(() => coordinate.run(['plan', '--root', d, '--file', badLaneFile]));
  assert.strictEqual(badLaneId.code, 1);
  fs.rmSync(base, { recursive: true, force: true });
});

test('report, status, answer, merge, resolve-merge and finish all reject a path-traversal --run/--lane', () => {
  const { base, d, g } = gitRepo();
  fs.writeFileSync(path.join(d, 'a.txt'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'init']);
  const evil = '../evil';
  assert.strictEqual(capture(() => coordinate.run(['report', '--root', d, '--run', evil, '--lane', 'x', '--status', 'running'])).code, 1);
  assert.strictEqual(capture(() => coordinate.run(['status', '--root', d, '--run', evil])).code, 1);
  assert.strictEqual(capture(() => coordinate.run(['answer', '--root', d, '--run', evil, '--lane', 'x', '--text', 'y'])).code, 1);
  assert.strictEqual(capture(() => coordinate.run(['merge', '--root', d, '--run', evil])).code, 1);
  assert.strictEqual(capture(() => coordinate.run(['resolve-merge', '--root', d, '--run', evil, '--lane', 'x', '--action', 'retry'])).code, 1);
  assert.strictEqual(capture(() => coordinate.run(['finish', '--root', d, '--run', evil])).code, 1);
  fs.rmSync(base, { recursive: true, force: true });
});

test('start refuses when a misconfigured worktreeRoot would resolve inside the repo', () => {
  const { base, d, g } = gitRepo();
  fs.mkdirSync(path.join(d, '.spec-guard'), { recursive: true });
  fs.writeFileSync(path.join(d, '.spec-guard', 'config.json'), JSON.stringify({ coordination: { worktreeRoot: '.' } }));
  fs.writeFileSync(path.join(d, 'a.txt'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'init']);

  const lanesFile = writeLanes(d, [{ id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['src/a/**'] }]);
  capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r10', '--file', lanesFile]));
  const { out } = capture(() => coordinate.run(['start', '--root', d, '--run', 'r10']));
  assert.match(out, /REFUSED/);
  assert.strictEqual(readLane(d, 'r10', 'lane-a').status, 'failed', 'no worktree created means the lane cannot be running');
  fs.rmSync(base, { recursive: true, force: true });
});

// ------------------------------------------------------------------------------------------
// status --refresh (scope drift)
// ------------------------------------------------------------------------------------------

test('status --refresh resumes a scope-drift-blocked lane to its REAL prior status (verified), not a hardcoded "running"', () => {
  const { base, d, g } = gitRepo();
  fs.mkdirSync(path.join(d, 'src'), { recursive: true });
  fs.writeFileSync(path.join(d, 'src', 'shared.js'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'init']);

  // lane-a and lane-b start with non-overlapping declaredPaths (so `plan` accepts them), but
  // lane-a's declaration is widened after the fact (simulating scope drift discovered mid-flight)
  // to actually collide with lane-b's tracked file.
  const lanesFile = writeLanes(d, [
    { id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['src/only-a.js'] },
    { id: 'lane-b', kind: 'adhoc', description: 'b', declaredPaths: ['src/shared.js'] },
  ]);
  capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r11', '--file', lanesFile]));
  capture(() => coordinate.run(['report', '--root', d, '--run', 'r11', '--lane', 'lane-a', '--status', 'verified']));
  capture(() => coordinate.run(['report', '--root', d, '--run', 'r11', '--lane', 'lane-a', '--declared-paths', 'src/shared.js']));
  assert.strictEqual(readLane(d, 'r11', 'lane-a').status, 'verified', 'sanity: still verified before refresh');

  capture(() => coordinate.run(['status', '--root', d, '--run', 'r11', '--refresh']));
  assert.strictEqual(readLane(d, 'r11', 'lane-a').status, 'blocked', 'refresh must catch the now-overlapping declaredPaths');

  const { code } = capture(() => coordinate.run(['answer', '--root', d, '--run', 'r11', '--lane', 'lane-a', '--text', 'resolved, keep going']));
  assert.strictEqual(code, 0);
  assert.strictEqual(readLane(d, 'r11', 'lane-a').status, 'verified', 'must resume to the REAL prior status, not fall back to "running" and silently drop out of the merge queue');
  fs.rmSync(base, { recursive: true, force: true });
});

test('refreshCollisions defers to disk instead of clobbering a status a concurrent report already wrote (optimistic concurrency guard)', () => {
  const { base, d, g } = gitRepo();
  fs.mkdirSync(path.join(d, 'src'), { recursive: true });
  fs.writeFileSync(path.join(d, 'src', 'shared.js'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'init']);

  const lanesFile = writeLanes(d, [
    { id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['src/only-a.js'] },
    { id: 'lane-b', kind: 'adhoc', description: 'b', declaredPaths: ['src/shared.js'] },
  ]);
  capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r20', '--file', lanesFile]));
  capture(() => coordinate.run(['report', '--root', d, '--run', 'r20', '--lane', 'lane-a', '--status', 'verified']));
  capture(() => coordinate.run(['report', '--root', d, '--run', 'r20', '--lane', 'lane-a', '--declared-paths', 'src/shared.js']));

  // A stale in-memory snapshot, as `status --refresh` would have taken before writing back.
  const lanes = [
    JSON.parse(fs.readFileSync(path.join(d, '.spec-guard', 'coordination', 'r20', 'lanes', 'lane-a.json'), 'utf8')),
    JSON.parse(fs.readFileSync(path.join(d, '.spec-guard', 'coordination', 'r20', 'lanes', 'lane-b.json'), 'utf8')),
  ];
  assert.strictEqual(lanes[0].status, 'verified');

  // Simulate a concurrent `coordinate report` landing a NEWER status on disk in the window
  // between that snapshot and refreshCollisions writing its own update.
  const laneAPath = path.join(d, '.spec-guard', 'coordination', 'r20', 'lanes', 'lane-a.json');
  const onDisk = JSON.parse(fs.readFileSync(laneAPath, 'utf8'));
  onDisk.status = 'running';
  fs.writeFileSync(laneAPath, JSON.stringify(onDisk));

  const rd = path.join(d, '.spec-guard', 'coordination', 'r20');
  coordinate.refreshCollisions(rd, d, lanes);

  const final = JSON.parse(fs.readFileSync(laneAPath, 'utf8'));
  assert.strictEqual(final.status, 'running', 'must defer to the newer on-disk status instead of clobbering it with a stale blocked transition');
  fs.rmSync(base, { recursive: true, force: true });
});

test('refreshCollisions never reopens a lane that is already terminal (second line of defense behind report\'s own guard)', () => {
  const { base, d, g } = gitRepo();
  fs.mkdirSync(path.join(d, 'src'), { recursive: true });
  fs.writeFileSync(path.join(d, 'src', 'shared.js'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'init']);

  // Non-overlapping at plan time; lane-a's declaredPaths only widen to collide AFTER it already
  // shipped — exactly what `report`'s own terminal-lane guard is supposed to prevent through the
  // normal CLI path. Bypass that guard here (direct ledger write, simulating some other bug or a
  // stale process) specifically to prove `refreshCollisions` itself is a real second line of
  // defense, not just decoration.
  const lanesFile = writeLanes(d, [
    { id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['src/only-a.js'] },
    { id: 'lane-b', kind: 'adhoc', description: 'b', declaredPaths: ['src/shared.js'] },
  ]);
  capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r21', '--file', lanesFile]));
  const laneAPath = path.join(d, '.spec-guard', 'coordination', 'r21', 'lanes', 'lane-a.json');
  const laneA = JSON.parse(fs.readFileSync(laneAPath, 'utf8'));
  laneA.status = 'merged';
  laneA.declaredPaths = ['src/shared.js'];
  fs.writeFileSync(laneAPath, JSON.stringify(laneA));
  const laneB = JSON.parse(fs.readFileSync(path.join(d, '.spec-guard', 'coordination', 'r21', 'lanes', 'lane-b.json'), 'utf8'));

  const rd = path.join(d, '.spec-guard', 'coordination', 'r21');
  coordinate.refreshCollisions(rd, d, [laneA, laneB]);

  const final = JSON.parse(fs.readFileSync(laneAPath, 'utf8'));
  assert.strictEqual(final.status, 'merged', 'a terminal lane must never be flipped to blocked by a refresh, no matter what its declaredPaths say');
  fs.rmSync(base, { recursive: true, force: true });
});

// ------------------------------------------------------------------------------------------
// multi-git-root (backup monorepo) collision detection
// ------------------------------------------------------------------------------------------

function gitRepoWithModules(moduleNames) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-coord-multi-'));
  const d = path.join(base, 'repo');
  fs.mkdirSync(d, { recursive: true });
  const g = (args, cwd) => spawnSync('git', ['-C', cwd || d].concat(args), { encoding: 'utf8' });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.name', 'Test']);
  g(['config', 'user.email', 'test@example.com']);
  fs.writeFileSync(path.join(d, 'root.txt'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'init root']);
  for (const m of moduleNames) {
    const mDir = path.join(d, m);
    fs.mkdirSync(path.join(mDir, 'src'), { recursive: true });
    g(['init', '-q', '-b', 'main'], mDir);
    g(['config', 'user.name', 'Test'], mDir);
    g(['config', 'user.email', 'test@example.com'], mDir);
    fs.writeFileSync(path.join(mDir, 'src', 'shared.js'), 'x\n');
    g(['add', '-A'], mDir); g(['commit', '-q', '-m', 'init module'], mDir);
  }
  return { base, d, g };
}

test('plan/start still detect a multi-git-root backup monorepo correctly AFTER `specguard init` has run (.spec-guard/config.json present)', () => {
  // Regression: `topology.detect(root)` with no options returns kind:'already-initialized' (not
  // the real structural kind) for ANY repo that already has `.spec-guard/config.json` — which is
  // the normal state after `specguard init`, and exactly the state most real `coordinate` usage
  // runs in. Without correctly asking for the real structural topology here, a genuinely
  // multi-git-root repo that has been initialized would silently fall back to single-repo
  // behavior: one worktree at the root (missing the module directories entirely) and file-overlap
  // detection blind to anything inside a module.
  const { base, d } = gitRepoWithModules(['module-a', 'module-b']);
  fs.mkdirSync(path.join(d, '.spec-guard'), { recursive: true });
  fs.writeFileSync(path.join(d, '.spec-guard', 'config.json'), JSON.stringify({ backupMonorepo: true, modules: ['module-a', 'module-b'] }));

  const overlapLanes = writeLanes(d, [
    { id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['module-a/src/shared.js'] },
    { id: 'lane-b', kind: 'adhoc', description: 'b', declaredPaths: ['module-a/src/*.js'] },
  ]);
  const overlap = capture(() => coordinate.run(['plan', '--root', d, '--file', overlapLanes]));
  assert.strictEqual(overlap.code, 1, 'overlap inside a module must still be caught post-init, not silently miss it');
  assert.match(overlap.out, /shared\.js/);

  const okLanes = writeLanes(d, [{ id: 'lane-c', kind: 'adhoc', description: 'c', declaredPaths: ['module-a/feature.txt'] }]);
  capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r35', '--file', okLanes]));
  const { code } = capture(() => coordinate.run(['start', '--root', d, '--run', 'r35']));
  assert.strictEqual(code, 0);
  const lane = readLane(d, 'r35', 'lane-c');
  assert.strictEqual(lane.worktrees.length, 1);
  assert.strictEqual(lane.worktrees[0].module, 'module-a', 'must create a per-module worktree, not fall back to a single root worktree that never contains module-a at all');
  assert.ok(fs.existsSync(path.join(lane.worktrees[0].path, 'src', 'shared.js')), 'the module-a worktree must actually contain module-a\'s own tracked content');
  fs.rmSync(base, { recursive: true, force: true });
});

test('plan detects file overlap INSIDE a module of a multi-git-root backup monorepo, not just at the root', () => {
  const { base, d } = gitRepoWithModules(['module-a', 'module-b']);

  const lanesFile = writeLanes(d, [
    { id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['module-a/src/shared.js'] },
    { id: 'lane-b', kind: 'adhoc', description: 'b', declaredPaths: ['module-a/src/*.js'] },
  ]);
  const { code, out } = capture(() => coordinate.run(['plan', '--root', d, '--file', lanesFile]));
  assert.strictEqual(code, 1, 'a file tracked inside a nested module repo must still be seen by the overlap check');
  assert.match(out, /REFUSED/);
  assert.match(out, /shared\.js/);
  fs.rmSync(base, { recursive: true, force: true });
});

test('plan accepts non-overlapping lanes touching different modules of a multi-git-root backup monorepo', () => {
  const { base, d } = gitRepoWithModules(['module-a', 'module-b']);

  const lanesFile = writeLanes(d, [
    { id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['module-a/src/shared.js'] },
    { id: 'lane-b', kind: 'adhoc', description: 'b', declaredPaths: ['module-b/src/shared.js'] },
  ]);
  const { code } = capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r12', '--file', lanesFile]));
  assert.strictEqual(code, 0);
  fs.rmSync(base, { recursive: true, force: true });
});

test('merge preserves the report of a lane already merged in THIS SAME invocation before a later lane fails closed', () => {
  const { base, d } = gitRepoWithModules(['module-a', 'module-b']);
  // Only module-a resolves a test command (via its own package.json); module-b has none, and
  // neither --test-cmd nor coordination.testCommand is set — so within ONE `coordinate merge`
  // call, lane-a (module-a) must succeed while lane-b (module-b) fails closed right after it.
  fs.writeFileSync(path.join(d, 'module-a', 'package.json'), JSON.stringify({ scripts: { test: 'true' } }));
  spawnSync('git', ['-C', path.join(d, 'module-a'), 'add', '-A']);
  spawnSync('git', ['-C', path.join(d, 'module-a'), 'commit', '-q', '-m', 'add package.json']);

  const lanesFile = writeLanes(d, [
    { id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['module-a/feature.txt'] },
    { id: 'lane-b', kind: 'adhoc', description: 'b', declaredPaths: ['module-b/feature.txt'] },
  ]);
  capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r22', '--file', lanesFile]));
  capture(() => coordinate.run(['start', '--root', d, '--run', 'r22']));
  const laneA = readLane(d, 'r22', 'lane-a'), laneB = readLane(d, 'r22', 'lane-b');
  commitInWorktree(laneA.worktrees[0].path, 'feature.txt', 'feat: a');
  commitInWorktree(laneB.worktrees[0].path, 'feature.txt', 'feat: b');
  capture(() => coordinate.run(['report', '--root', d, '--run', 'r22', '--lane', 'lane-a', '--status', 'verified']));
  capture(() => coordinate.run(['report', '--root', d, '--run', 'r22', '--lane', 'lane-b', '--status', 'verified']));

  const { code, out } = capture(() => coordinate.run(['merge', '--root', d, '--run', 'r22']));
  assert.strictEqual(code, 1, 'must fail closed once it reaches module-b (no resolvable test command there)');
  assert.match(out, /lane-a.*merged \+ tests OK/s, 'lane-a, already merged earlier in THIS invocation, must still be reported — not silently dropped by the fail-closed return');
  assert.strictEqual(readLane(d, 'r22', 'lane-a').status, 'merged', 'lane-a must stay merged, not rolled back because a later lane failed closed');
  fs.rmSync(base, { recursive: true, force: true });
});

// ------------------------------------------------------------------------------------------
// merge: dirty-base handling
// ------------------------------------------------------------------------------------------

test('merge blocks on an uncommitted TRACKED change in the base repo, but an unrelated untracked scratch file does not block it', () => {
  const { base, d, g } = gitRepo();
  fs.writeFileSync(path.join(d, 'a.txt'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'init']);

  const lanesFile = writeLanes(d, [{ id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['feature.txt'] }]);
  capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r13', '--file', lanesFile]));
  capture(() => coordinate.run(['start', '--root', d, '--run', 'r13']));
  const wtPath = readLane(d, 'r13', 'lane-a').worktrees[0].path;
  commitInWorktree(wtPath, 'feature.txt', 'feat: x');
  capture(() => coordinate.run(['report', '--root', d, '--run', 'r13', '--lane', 'lane-a', '--status', 'verified']));

  // An unrelated untracked scratch file (e.g. the CLI's own --file input) must NOT block merge.
  fs.writeFileSync(path.join(d, 'unrelated-scratch.txt'), 'not tracked, not ours\n');
  // A genuine uncommitted TRACKED edit must block it.
  fs.writeFileSync(path.join(d, 'a.txt'), 'modified but not committed\n');

  const { code, out } = capture(() => coordinate.run(['merge', '--root', d, '--run', 'r13', '--test-cmd', 'true']));
  assert.strictEqual(code, 0, 'a blocked lane is a lane-level outcome, not a whole-command failure');
  assert.match(out, /BLOCKED/);
  assert.match(readLane(d, 'r13', 'lane-a').blockedQuestion.question, /tracked files/);
  assert.ok(fs.existsSync(path.join(d, 'unrelated-scratch.txt')), 'the untracked scratch file must be left alone');
  fs.rmSync(base, { recursive: true, force: true });
});

test('merge cleans up ONLY the untracked artifact the failing test command itself created, after reverting', () => {
  const { base, d, g } = gitRepo();
  fs.writeFileSync(path.join(d, 'a.txt'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'init']);

  const lanesFile = writeLanes(d, [{ id: 'lane-a', kind: 'adhoc', description: 'a', declaredPaths: ['feature.txt'] }]);
  capture(() => coordinate.run(['plan', '--root', d, '--run-id', 'r14', '--file', lanesFile]));
  capture(() => coordinate.run(['start', '--root', d, '--run', 'r14']));
  const wtPath = readLane(d, 'r14', 'lane-a').worktrees[0].path;
  commitInWorktree(wtPath, 'feature.txt', 'feat: x');
  capture(() => coordinate.run(['report', '--root', d, '--run', 'r14', '--lane', 'lane-a', '--status', 'verified']));

  // A pre-existing untracked file (not created by the test command) must survive.
  fs.writeFileSync(path.join(d, 'pre-existing.txt'), 'was already here\n');

  const testCmd = process.platform === 'win32'
    ? 'echo x > build-artifact.tmp && exit 1'
    : 'touch build-artifact.tmp && exit 1';
  capture(() => coordinate.run(['merge', '--root', d, '--run', 'r14', '--test-cmd', testCmd]));

  assert.strictEqual(readLane(d, 'r14', 'lane-a').status, 'blocked');
  assert.ok(!fs.existsSync(path.join(d, 'build-artifact.tmp')), 'the artifact the failing test itself created must be cleaned up');
  assert.ok(fs.existsSync(path.join(d, 'pre-existing.txt')), 'a file that was already there before this merge attempt must survive');
  fs.rmSync(base, { recursive: true, force: true });
});

// ------------------------------------------------------------------------------------------
// pure helpers
// ------------------------------------------------------------------------------------------

test('globToRegExp: ** matches across directories, * matches within a segment', () => {
  const re1 = coordinate.globToRegExp('src/billing/**');
  assert.ok(re1.test('src/billing/x/y.js'));
  assert.ok(!re1.test('src/other/x.js'));

  const re2 = coordinate.globToRegExp('docs/specs/0012-*.md');
  assert.ok(re2.test('docs/specs/0012-billing-events.md'));
  assert.ok(!re2.test('docs/specs/0013-other.md'));
});

test('resolveTestCommand priority: explicit flag > configured default > package.json script > null', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-coord-testcmd-'));
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));
  assert.strictEqual(coordinate.resolveTestCommand(d, 'explicit-cmd', 'configured-cmd'), 'explicit-cmd');
  assert.strictEqual(coordinate.resolveTestCommand(d, null, 'configured-cmd'), 'configured-cmd');
  assert.strictEqual(coordinate.resolveTestCommand(d, null, null), 'npm test');
  fs.rmSync(d, { recursive: true, force: true });

  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-coord-testcmd-empty-'));
  assert.strictEqual(coordinate.resolveTestCommand(empty, null, null), null);
  fs.rmSync(empty, { recursive: true, force: true });
});

test('topoSortLanes orders dependencies before dependents and detects cycles', () => {
  const order = coordinate.topoSortLanes([
    { id: 'b', dependsOn: ['a'] },
    { id: 'a', dependsOn: [] },
    { id: 'c', dependsOn: ['b'] },
  ]);
  assert.deepStrictEqual(order, ['a', 'b', 'c']);

  assert.throws(() => coordinate.topoSortLanes([
    { id: 'x', dependsOn: ['y'] },
    { id: 'y', dependsOn: ['x'] },
  ]), /cycle/);
});
