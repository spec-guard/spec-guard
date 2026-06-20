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
