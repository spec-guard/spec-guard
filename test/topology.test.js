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

test('wall lint flags .claude hyperlinks at any depth, ignores prose', () => {
  const d = tmp();
  const docs = path.join(d, 'docs');
  fs.mkdirSync(path.join(docs, 'reference', 'decisions'), { recursive: true });
  fs.writeFileSync(path.join(docs, 'ok.md'), 'IP lives in `.claude/docs/` (prose mention, fine).\n');
  fs.writeFileSync(path.join(docs, 'bad1.md'), 'See [the notes](.claude/docs/x.md).\n');
  fs.writeFileSync(path.join(docs, 'reference', 'decisions', 'bad2.md'), 'See [notes](../../.claude/docs/y.md).\n');
  const v = lint.lintRepo(d);
  assert.strictEqual(v.length, 2);
  assert.ok(v.every((x) => /bad[12]\.md$/.test(x.file)));
  fs.rmSync(d, { recursive: true, force: true });
});

test('graphify.available is false without a graph (fallback-safe)', () => {
  const d = tmp();
  assert.strictEqual(graphify.available(d), false);
  assert.strictEqual(graphify.query(d, 'anything'), null);
  fs.rmSync(d, { recursive: true, force: true });
});
