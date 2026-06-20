'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const migrate = require('../src/cli/migrate.js');

function oldModelRepo() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-mig-'));
  fs.mkdirSync(path.join(d, 'docs/superpowers/specs'), { recursive: true });
  fs.mkdirSync(path.join(d, 'docs/superpowers/plans'), { recursive: true });
  fs.mkdirSync(path.join(d, '.claude/docs/troubleshootings'), { recursive: true });
  fs.mkdirSync(path.join(d, '.claude/credentials'), { recursive: true });
  fs.mkdirSync(path.join(d, 'mod-a/.claude/docs'), { recursive: true });
  fs.mkdirSync(path.join(d, 'docs/guides'), { recursive: true });
  fs.writeFileSync(path.join(d, 'docs/superpowers/specs/x-design.md'), '# x\n');
  fs.writeFileSync(path.join(d, '.claude/docs/troubleshootings/t.md'), 'tip\n');
  fs.writeFileSync(path.join(d, '.claude/credentials/secrets.local.md'), 'secret\n');
  fs.writeFileSync(path.join(d, 'mod-a/.claude/docs/m.md'), 'mod\n');
  fs.writeFileSync(path.join(d, 'mod-a/.gitignore'), '.claude/\n.codex/\n');
  fs.writeFileSync(path.join(d, 'docs/guides/g.md'), 'See [s](../superpowers/specs/x-design.md) and .claude/docs/troubleshootings/t.md\n');
  return d;
}

function captureStdout(fn) {
  const orig = process.stdout.write;
  let out = '';
  process.stdout.write = (c) => { out += c; return true; };
  try { fn(); } finally { process.stdout.write = orig; }
  return out;
}

test('migrate --dry-run reports a plan and changes nothing', () => {
  const d = oldModelRepo();
  const out = captureStdout(() => migrate.run([d]));
  assert.match(out, /DRY-RUN/);
  assert.match(out, /docs\/superpowers\/specs\s+->\s+docs\/specs/);
  // unchanged on disk
  assert.ok(fs.existsSync(path.join(d, 'docs/superpowers/specs/x-design.md')));
  assert.ok(!fs.existsSync(path.join(d, 'docs/specs/x-design.md')));
  fs.rmSync(d, { recursive: true, force: true });
});

test('migrate --apply moves IP + specs, sweeps refs, updates gitignore, cleans empties', () => {
  const d = oldModelRepo();
  captureStdout(() => migrate.run([d, '--apply']));

  assert.ok(fs.existsSync(path.join(d, 'docs/specs/x-design.md')), 'specs moved');
  assert.ok(fs.existsSync(path.join(d, '.private/docs/troubleshootings/t.md')), 'root IP moved');
  assert.ok(fs.existsSync(path.join(d, '.private/credentials/secrets.local.md')), 'credentials moved');
  assert.ok(fs.existsSync(path.join(d, 'mod-a/.private/docs/m.md')), 'module IP moved');
  assert.ok(!fs.existsSync(path.join(d, 'docs/superpowers')), 'empty superpowers removed');
  assert.ok(!fs.existsSync(path.join(d, '.claude/docs')), 'old .claude/docs removed');

  const guide = fs.readFileSync(path.join(d, 'docs/guides/g.md'), 'utf8');
  assert.match(guide, /\.\.\/specs\//);
  assert.match(guide, /\.private\/docs\//);
  assert.doesNotMatch(guide, /superpowers|\.claude\/docs/);

  const gi = fs.readFileSync(path.join(d, 'mod-a/.gitignore'), 'utf8');
  assert.match(gi, /\.private\//);
  fs.rmSync(d, { recursive: true, force: true });
});

test('migrate honors a custom --private-dir', () => {
  const d = oldModelRepo();
  captureStdout(() => migrate.run([d, '--apply', '--private-dir', '.internal']));
  assert.ok(fs.existsSync(path.join(d, '.internal/docs/troubleshootings/t.md')));
  fs.rmSync(d, { recursive: true, force: true });
});
