'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'src', 'hooks', 'sync-check.sh');

function sandboxRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-sync-'));
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'app.js'), 'export const x = 1;\n');
  return { repo, cleanup: () => fs.rmSync(repo, { recursive: true, force: true }) };
}

test('sync-check emits human-readable reminder by default', () => {
  const { repo, cleanup } = sandboxRepo();
  try {
    const r = spawnSync('bash', [SCRIPT], { cwd: repo, encoding: 'utf8' });
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, /\[SPEC-GUARD\] Step 6 \(SYNC\) pending/);
    assert.strictEqual(r.stderr, '');
  } finally {
    cleanup();
  }
});

test('sync-check emits empty JSON in explicit Codex JSON compatibility mode', () => {
  const { repo, cleanup } = sandboxRepo();
  try {
    const r = spawnSync('bash', [SCRIPT], {
      cwd: repo,
      encoding: 'utf8',
      env: Object.assign({}, process.env, { SPEC_GUARD_HOOK_FORMAT: 'codex-json' }),
    });
    assert.strictEqual(r.status, 0);
    assert.deepStrictEqual(JSON.parse(r.stdout), {});
    assert.strictEqual(r.stderr, '');
  } finally {
    cleanup();
  }
});

test('sync-check auto-detects Codex-installed path and emits only JSON on stdout', () => {
  const { repo, cleanup } = sandboxRepo();
  const installedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-codex-home-'));
  const installedDir = path.join(installedRoot, '.codex', 'hooks', 'spec-guard');
  const installedScript = path.join(installedDir, 'sync-check.sh');
  try {
    fs.mkdirSync(installedDir, { recursive: true });
    fs.copyFileSync(SCRIPT, installedScript);

    const r = spawnSync('bash', [installedScript], { cwd: repo, encoding: 'utf8' });
    assert.strictEqual(r.status, 0);
    assert.deepStrictEqual(JSON.parse(r.stdout), {});
    assert.strictEqual(r.stderr, '');
  } finally {
    cleanup();
    fs.rmSync(installedRoot, { recursive: true, force: true });
  }
});

// Regression: the not-a-git-repo early exit ran before the format-aware output block, so Codex
// mode got empty stdout instead of the JSON object its hook consumer expects.
test('sync-check emits empty JSON in Codex mode even outside a git repo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-nogit-'));
  try {
    const r = spawnSync('bash', [SCRIPT], {
      cwd: dir,
      encoding: 'utf8',
      env: Object.assign({}, process.env, { SPEC_GUARD_HOOK_FORMAT: 'codex-silent', CLAUDE_CWD: dir }),
    });
    assert.strictEqual(r.status, 0);
    assert.deepStrictEqual(JSON.parse(r.stdout), {});
    assert.strictEqual(r.stderr, '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
