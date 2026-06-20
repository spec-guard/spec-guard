'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const topology = require('../src/core/topology.js');
const lint = require('../src/core/lint.js');
const graphify = require('../src/core/graphify.js');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-topo-'));
}
function mkgit(dir, name) {
  fs.mkdirSync(path.join(dir, name, '.git'), { recursive: true });
}

test('single-repo detection', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, '.git'), { recursive: true });
  const r = topology.detect(d);
  assert.strictEqual(r.kind, 'single-repo');
  fs.rmSync(d, { recursive: true, force: true });
});

test('multi-git-root (backup monorepo) detection + modules', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, '.git'), { recursive: true });
  mkgit(d, 'service-a');
  mkgit(d, 'service-b');
  const r = topology.detect(d);
  assert.strictEqual(r.kind, 'multi-git-root');
  assert.strictEqual(r.backupMonorepo, true);
  assert.deepStrictEqual(r.modules.sort(), ['service-a', 'service-b']);
  fs.rmSync(d, { recursive: true, force: true });
});

test('.git_backup counts as a module and sets transientGitBackup', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, '.git'), { recursive: true });
  mkgit(d, 'service-a');
  fs.mkdirSync(path.join(d, 'service-b', '.git_backup'), { recursive: true });
  const r = topology.detect(d);
  assert.strictEqual(r.kind, 'multi-git-root');
  assert.strictEqual(r.transientGitBackup, true);
  assert.deepStrictEqual(r.modules.sort(), ['service-a', 'service-b']);
  fs.rmSync(d, { recursive: true, force: true });
});

test('deliverable-subrepo: own .git inside an ancestor git repo', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, '.git'), { recursive: true });
  const sub = path.join(d, 'service-a');
  fs.mkdirSync(path.join(sub, '.git'), { recursive: true });
  const r = topology.detect(sub);
  assert.strictEqual(r.kind, 'deliverable-subrepo');
  fs.rmSync(d, { recursive: true, force: true });
});

test('already-initialized when .spec-guard/config.json exists', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, '.spec-guard'), { recursive: true });
  fs.writeFileSync(path.join(d, '.spec-guard', 'config.json'), '{}');
  assert.strictEqual(topology.detect(d).kind, 'already-initialized');
  assert.strictEqual(topology.detect(d, { reinit: true }).kind !== 'already-initialized', true);
  fs.rmSync(d, { recursive: true, force: true });
});

test('wall lint flags hyperlinks into ipDir + agent dirs at any depth, ignores prose', () => {
  const d = tmp();
  const docs = path.join(d, 'docs');
  fs.mkdirSync(path.join(docs, 'reference', 'decisions'), { recursive: true });
  fs.writeFileSync(path.join(docs, 'ok.md'), 'IP lives in `.private/` and `.claude/` (prose, fine).\n');
  fs.writeFileSync(path.join(docs, 'bad1.md'), 'See [notes](.private/docs/x.md) and [skill](.claude/skills/y.md).\n');
  fs.writeFileSync(path.join(docs, 'reference', 'decisions', 'bad2.md'), 'See [notes](../../.private/docs/y.md).\n');
  fs.writeFileSync(path.join(docs, 'bad3.md'), 'See [gem](../.gemini/extensions/z.md).\n');
  const v = lint.lintRepo(d); // default ipDir .private
  // bad1 (2 lines? one line, matches first) + bad2 + bad3 = 3 files flagged
  const files = new Set(v.map((x) => path.basename(x.file)));
  assert.ok(files.has('bad1.md') && files.has('bad2.md') && files.has('bad3.md'));
  assert.ok(!files.has('ok.md'));
  // custom ipDir
  fs.writeFileSync(path.join(docs, 'bad4.md'), 'See [x](.ip/secret.md).\n');
  const v2 = lint.lintRepo(d, { ipDir: '.ip' });
  assert.ok(new Set(v2.map((x) => path.basename(x.file))).has('bad4.md'));
  fs.rmSync(d, { recursive: true, force: true });
});

test('config resolves ipDir (default .private, overridable)', () => {
  const config = require('../src/core/config.js');
  const d = tmp();
  assert.strictEqual(config.resolveRepoSettings(d).ipDir, '.private');
  fs.mkdirSync(path.join(d, '.spec-guard'), { recursive: true });
  fs.writeFileSync(path.join(d, '.spec-guard', 'config.json'), JSON.stringify({ ipDir: '.internal' }));
  assert.strictEqual(config.resolveRepoSettings(d).ipDir, '.internal');
  fs.rmSync(d, { recursive: true, force: true });
});

test('graphify.available is false without a graph (fallback-safe)', () => {
  const d = tmp();
  assert.strictEqual(graphify.available(d), false);
  assert.strictEqual(graphify.query(d, 'anything'), null);
  fs.rmSync(d, { recursive: true, force: true });
});
