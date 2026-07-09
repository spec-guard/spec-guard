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

test('-m short flag is accepted (parity with --message)', () => {
  const { d, g } = gitRepo();
  fs.writeFileSync(path.join(d, 'a.txt'), 'hi\n');
  const code = silent(() => commit.run([d, '--add', '-m', 'feat: via short flag']));
  assert.strictEqual(code, 0, '-m should be parsed as the message');
  assert.match(g(['log', '--format=%B', '-1']).stdout, /feat: via short flag/);
  fs.rmSync(d, { recursive: true, force: true });
});

function capture(fn) {
  let out = '';
  const o = process.stdout.write, e = process.stderr.write;
  process.stdout.write = (c) => { out += c; return true; };
  process.stderr.write = () => true;
  try { return { code: fn(), out }; } finally { process.stdout.write = o; process.stderr.write = e; }
}

test('attribution note fires only when attribution was actually present', () => {
  const { d } = gitRepo();
  // Clean message with extra blank lines (no attribution): note must NOT appear, even though
  // cleanMessage collapses the blank lines.
  fs.writeFileSync(path.join(d, 'a.txt'), 'x\n');
  const clean = capture(() => commit.run([d, '--add', '-m', 'feat: clean\n\n\nbody']));
  assert.strictEqual(clean.code, 0);
  assert.doesNotMatch(clean.out, /stripped AI-attribution/);

  // Real attribution: note MUST appear.
  fs.writeFileSync(path.join(d, 'b.txt'), 'y\n');
  const dirty = capture(() => commit.run([d, '--add', '-m', 'feat: dirty\n\nCo-Authored-By: Claude <noreply@anthropic.com>']));
  assert.strictEqual(dirty.code, 0);
  assert.match(dirty.out, /stripped AI-attribution/);
  fs.rmSync(d, { recursive: true, force: true });
});

test('--graphify is fallback-safe when no graph is present (still commits)', () => {
  const { d, g } = gitRepo();
  fs.writeFileSync(path.join(d, 'a.txt'), 'x\n');
  const { code, out } = capture(() => commit.run([d, '--add', '--graphify', '-m', 'feat: x']));
  assert.strictEqual(code, 0);
  assert.match(out, /graphify: not present \(skipped\)/);
  assert.match(g(['log', '--format=%B', '-1']).stdout, /feat: x/);
  fs.rmSync(d, { recursive: true, force: true });
});

test('--graphify refreshes the graph BEFORE the commit (refresh is in the commit)', () => {
  const { d, g } = gitRepo();
  // A pre-existing graph makes graphify "available"; a fake `graphify` on PATH refreshes it.
  fs.mkdirSync(path.join(d, 'graphify-out'), { recursive: true });
  fs.writeFileSync(path.join(d, 'graphify-out/graph.json'), '{"updated":false}\n');
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-fakebin-'));
  fs.writeFileSync(path.join(bin, 'graphify'),
    '#!/bin/sh\nif [ "$1" = "update" ]; then echo \'{"updated":true}\' > graphify-out/graph.json; fi\nexit 0\n');
  fs.chmodSync(path.join(bin, 'graphify'), 0o755);

  fs.writeFileSync(path.join(d, 'a.txt'), 'x\n');
  const oldPath = process.env.PATH;
  process.env.PATH = bin + path.delimiter + oldPath;
  let code;
  try { ({ code } = capture(() => commit.run([d, '--add', '--graphify', '-m', 'feat: x']))); }
  finally { process.env.PATH = oldPath; }

  assert.strictEqual(code, 0);
  // The graph the fake rewrote must be part of HEAD — proving it was refreshed before the commit.
  assert.match(g(['show', 'HEAD:graphify-out/graph.json']).stdout, /"updated":true/);
  fs.rmSync(d, { recursive: true, force: true });
  fs.rmSync(bin, { recursive: true, force: true });
});

test('--all --graphify first-build extracts from inside each module and merges produced graphs only', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-backup-'));
  const rootGit = (args) => spawnSync('git', ['-C', root].concat(args), { encoding: 'utf8' });
  rootGit(['init', '-q']);
  rootGit(['config', 'user.name', 'Test']);
  rootGit(['config', 'user.email', 'test@example.com']);
  fs.mkdirSync(path.join(root, '.spec-guard'), { recursive: true });
  fs.writeFileSync(path.join(root, '.spec-guard/config.json'), JSON.stringify({ modules: ['service-a', 'service-b'] }, null, 2) + '\n');
  fs.mkdirSync(path.join(root, 'graphify-out'), { recursive: true });
  fs.writeFileSync(path.join(root, 'graphify-out/graph.json'), '{"root":true}\n');

  for (const m of ['service-a', 'service-b']) {
    const dir = path.join(root, m);
    fs.mkdirSync(dir, { recursive: true });
    const g = (args) => spawnSync('git', ['-C', dir].concat(args), { encoding: 'utf8' });
    g(['init', '-q']);
    g(['config', 'user.name', 'Test']);
    g(['config', 'user.email', 'test@example.com']);
    fs.writeFileSync(path.join(dir, 'file.txt'), 'initial\n');
    g(['add', '-A']);
    g(['commit', '-m', 'feat: initial']);
    fs.writeFileSync(path.join(dir, 'file.txt'), 'changed\n');
  }

  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-fakebin-'));
  const log = path.join(root, 'graphify.log');
  fs.writeFileSync(path.join(bin, 'graphify'), [
    '#!/bin/sh',
    `printf '%s|%s\\n' "$PWD" "$*" >> "${log}"`,
    'if [ "$1" = "extract" ]; then',
    '  mkdir -p graphify-out',
    '  if [ "$(basename "$PWD")" = "service-b" ]; then exit 2; fi',
    '  printf \'{"module":"%s"}\\n\' "$(basename "$PWD")" > graphify-out/graph.json',
    '  exit 0',
    'fi',
    'if [ "$1" = "merge-graphs" ]; then',
    '  printf \'%s\\n\' "$*" > graphify-out/graph.json',
    '  exit 0',
    'fi',
    'exit 0',
    '',
  ].join('\n'));
  fs.chmodSync(path.join(bin, 'graphify'), 0o755);

  const oldPath = process.env.PATH;
  process.env.PATH = bin + path.delimiter + oldPath;
  let code;
  try { ({ code } = capture(() => commit.run([root, '--all', '--graphify', '-m', 'feat: x']))); }
  finally { process.env.PATH = oldPath; }

  assert.strictEqual(code, 0);
  const calls = fs.readFileSync(log, 'utf8');
  assert.match(calls, new RegExp(`${path.join(root, 'service-a').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\|extract \\.`));
  assert.match(calls, new RegExp(`${path.join(root, 'service-b').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\|extract \\.`));
  assert.match(calls, /\|merge-graphs service-a\/graphify-out\/graph\.json --out graphify-out\/graph\.json/);
  assert.doesNotMatch(calls, /merge-graphs .*service-b\/graphify-out\/graph\.json/);

  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(bin, { recursive: true, force: true });
});

test('--all --graphify root merge keeps unchanged module graphs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-backup-'));
  const rootGit = (args) => spawnSync('git', ['-C', root].concat(args), { encoding: 'utf8' });
  rootGit(['init', '-q']);
  rootGit(['config', 'user.name', 'Test']);
  rootGit(['config', 'user.email', 'test@example.com']);
  fs.mkdirSync(path.join(root, '.spec-guard'), { recursive: true });
  fs.writeFileSync(path.join(root, '.spec-guard/config.json'), JSON.stringify({ modules: ['service-a', 'service-b'] }, null, 2) + '\n');
  fs.mkdirSync(path.join(root, 'graphify-out'), { recursive: true });
  fs.writeFileSync(path.join(root, 'graphify-out/graph.json'), '{"root":true}\n');

  for (const m of ['service-a', 'service-b']) {
    const dir = path.join(root, m);
    fs.mkdirSync(path.join(dir, 'graphify-out'), { recursive: true });
    const g = (args) => spawnSync('git', ['-C', dir].concat(args), { encoding: 'utf8' });
    g(['init', '-q']);
    g(['config', 'user.name', 'Test']);
    g(['config', 'user.email', 'test@example.com']);
    fs.writeFileSync(path.join(dir, 'graphify-out/graph.json'), `{"module":"${m}"}\n`);
    fs.writeFileSync(path.join(dir, 'file.txt'), 'initial\n');
    g(['add', '-A']);
    g(['commit', '-m', 'feat: initial']);
  }
  fs.writeFileSync(path.join(root, 'service-a', 'file.txt'), 'changed\n');

  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-fakebin-'));
  const log = path.join(root, 'graphify.log');
  fs.writeFileSync(path.join(bin, 'graphify'), [
    '#!/bin/sh',
    `printf '%s|%s\\n' "$PWD" "$*" >> "${log}"`,
    'if [ "$1" = "update" ]; then exit 0; fi',
    'if [ "$1" = "merge-graphs" ]; then printf \'%s\\n\' "$*" > graphify-out/graph.json; exit 0; fi',
    'exit 0',
    '',
  ].join('\n'));
  fs.chmodSync(path.join(bin, 'graphify'), 0o755);

  const oldPath = process.env.PATH;
  process.env.PATH = bin + path.delimiter + oldPath;
  let code;
  try { ({ code } = capture(() => commit.run([root, '--all', '--graphify', '-m', 'feat: x']))); }
  finally { process.env.PATH = oldPath; }

  assert.strictEqual(code, 0);
  const calls = fs.readFileSync(log, 'utf8');
  assert.match(calls, new RegExp(`${path.join(root, 'service-a').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\|update`));
  assert.doesNotMatch(calls, new RegExp(`${path.join(root, 'service-b').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\|update`));
  assert.match(calls, /\|merge-graphs service-a\/graphify-out\/graph\.json service-b\/graphify-out\/graph\.json --out graphify-out\/graph\.json/);

  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(bin, { recursive: true, force: true });
});

test('missing --message errors', () => {
  const { d } = gitRepo();
  const code = silent(() => commit.run([d]));
  assert.strictEqual(code, 1);
  fs.rmSync(d, { recursive: true, force: true });
});
