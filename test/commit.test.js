'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const commit = require('../src/cli/commit.js');

function gitRepo() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-commit-'));
  const g = (args) => spawnSync('git', ['-C', d].concat(args), { encoding: 'utf8' });
  g(['init', '-q']);
  g(['config', 'user.name', 'Test']);
  g(['config', 'user.email', 'test@example.com']);
  return { d, g };
}

function silent(fn) {
  const o = process.stdout.write, e = process.stderr.write;
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  try { return fn(); } finally { process.stdout.write = o; process.stderr.write = e; }
}

test('cleanMessage strips AI attribution', () => {
  const msg = 'feat: x\n\nbody\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n🤖 Generated with Claude Code';
  const c = commit.cleanMessage(msg);
  assert.doesNotMatch(c, /Co-Authored-By/);
  assert.doesNotMatch(c, /Generated with/);
  assert.match(c, /feat: x/);
});

test('CONVENTIONAL accepts valid and rejects invalid', () => {
  assert.ok(commit.CONVENTIONAL.test('feat(api): add endpoint'));
  assert.ok(commit.CONVENTIONAL.test('fix!: breaking'));
  assert.ok(!commit.CONVENTIONAL.test('updated stuff'));
});

test('single-repo commit lands and strips attribution', () => {
  const { d, g } = gitRepo();
  fs.writeFileSync(path.join(d, 'a.txt'), 'hello\n');
  const code = silent(() => commit.run([d, '--add', '--message', 'feat: add a\n\nCo-Authored-By: Claude <noreply@anthropic.com>']));
  assert.strictEqual(code, 0);
  const log = g(['log', '--format=%B', '-1']).stdout;
  assert.match(log, /feat: add a/);
  assert.doesNotMatch(log, /Co-Authored-By/);
  fs.rmSync(d, { recursive: true, force: true });
});

test('non-conventional message is rejected without --force', () => {
  const { d } = gitRepo();
  fs.writeFileSync(path.join(d, 'a.txt'), 'x\n');
  const code = silent(() => commit.run([d, '--add', '--message', 'just stuff']));
  assert.strictEqual(code, 1);
  fs.rmSync(d, { recursive: true, force: true });
});

test('missing --message errors', () => {
  const { d } = gitRepo();
  const code = silent(() => commit.run([d]));
  assert.strictEqual(code, 1);
  fs.rmSync(d, { recursive: true, force: true });
});
