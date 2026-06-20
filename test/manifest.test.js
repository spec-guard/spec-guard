'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const manifest = require('../src/core/manifest.js');
const rulesblock = require('../src/core/rulesblock.js');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-test-'));
}

test('rulesblock upsert is idempotent and preserves surrounding content', () => {
  const original = '# My Project\n\nSome existing rules.\n';
  const body = rulesblock.buildBody({ specDir: 'docs/specs', plansDir: 'docs/plans' });
  const once = rulesblock.upsert(original, body);
  assert.match(once, /# My Project/); // user content preserved
  assert.match(once, /spec-guard:start/);
  assert.match(once, /docs\/specs/);
  const twice = rulesblock.upsert(once, body);
  assert.strictEqual(once, twice); // idempotent
  assert.strictEqual((twice.match(/spec-guard:start/g) || []).length, 1); // single block
});

test('writeManaged: created, unchanged, then user-edit -> sidecar (no clobber)', () => {
  const dir = tmp();
  const m = manifest.emptyManifest();
  const file = path.join(dir, 'skill.md');

  let r = manifest.writeManaged({ absPath: file, content: 'v1\n', manifest: m, key: 'skill' });
  assert.strictEqual(r.action, 'created');

  r = manifest.writeManaged({ absPath: file, content: 'v1\n', manifest: m, key: 'skill' });
  assert.strictEqual(r.action, 'unchanged');

  // User edits the installed file out-of-band:
  fs.writeFileSync(file, 'user hand-edit\n');
  r = manifest.writeManaged({ absPath: file, content: 'v2\n', manifest: m, key: 'skill' });
  assert.strictEqual(r.action, 'diverged');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'user hand-edit\n'); // original untouched
  assert.ok(fs.existsSync(file + '.spec-guard-update'));
  assert.strictEqual(fs.readFileSync(file + '.spec-guard-update', 'utf8'), 'v2\n');

  // Accepting the update with --force reconciles the file AND clears the stale sidecar.
  r = manifest.writeManaged({ absPath: file, content: 'v2\n', manifest: m, key: 'skill', force: true });
  assert.strictEqual(r.action, 'updated');
  assert.ok(!fs.existsSync(file + '.spec-guard-update'), 'stale sidecar auto-removed after reconcile');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('writeManaged: a hand-reconciled file (now matching) also clears the sidecar', () => {
  const dir = tmp();
  const m = manifest.emptyManifest();
  const file = path.join(dir, 'skill.md');

  manifest.writeManaged({ absPath: file, content: 'v1\n', manifest: m, key: 'skill' });
  fs.writeFileSync(file, 'edited\n');
  manifest.writeManaged({ absPath: file, content: 'v2\n', manifest: m, key: 'skill' }); // diverged -> sidecar
  assert.ok(fs.existsSync(file + '.spec-guard-update'));

  // User hand-applies v2; next render sees the file already matches -> unchanged + sidecar cleared.
  fs.writeFileSync(file, 'v2\n');
  const r = manifest.writeManaged({ absPath: file, content: 'v2\n', manifest: m, key: 'skill' });
  assert.strictEqual(r.action, 'unchanged');
  assert.ok(!fs.existsSync(file + '.spec-guard-update'), 'sidecar cleared once file matches');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('writeBlockManaged: created then unchanged; surrounding user content preserved', () => {
  const dir = tmp();
  const m = manifest.emptyManifest();
  const file = path.join(dir, 'CLAUDE.md');
  fs.writeFileSync(file, '# Repo rules\n\nuser stuff\n');
  const body = rulesblock.buildBody({ specDir: 'docs/specs', plansDir: 'docs/plans' });

  let r = manifest.writeBlockManaged({ absPath: file, body, manifest: m, key: 'CLAUDE.md' });
  assert.strictEqual(r.action, 'block-created');
  assert.match(fs.readFileSync(file, 'utf8'), /# Repo rules/);

  r = manifest.writeBlockManaged({ absPath: file, body, manifest: m, key: 'CLAUDE.md' });
  assert.strictEqual(r.action, 'block-unchanged');

  fs.rmSync(dir, { recursive: true, force: true });
});
