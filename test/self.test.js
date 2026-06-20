'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const self = require('../src/cli/self.js');
const pkg = require('../package.json');

// Capture stdout + stderr around a (possibly async) call.
function capture(fn) {
  const o = process.stdout.write;
  const e = process.stderr.write;
  let out = '';
  let err = '';
  process.stdout.write = (c) => ((out += c), true);
  process.stderr.write = (c) => ((err += c), true);
  try {
    const code = fn();
    return { out, err, code };
  } finally {
    process.stdout.write = o;
    process.stderr.write = e;
  }
}

let tmpHome;
let savedDeps;
let savedXdg;

beforeEach(() => {
  // Hermetic config dir so writeLKG/readLKG never touch the real machine config.
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-self-'));
  savedXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = tmpHome;
  savedDeps = { ...self.deps };
});

afterEach(() => {
  Object.assign(self.deps, savedDeps);
  if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = savedXdg;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function stub(overrides) {
  const calls = { install: 0, refresh: 0 };
  Object.assign(self.deps, {
    npmView: () => overrides.view,
    npmInstallGlobal: () => {
      calls.install++;
      return { status: overrides.installStatus != null ? overrides.installStatus : 0, stdout: '', stderr: '' };
    },
    installedVersion: () => overrides.installed,
    refreshMachine: () => {
      calls.refresh++;
      return { wired: [], missing: [], changed: true };
    },
    // Keep dry-run hermetic: never spawn the real `gh`.
    ghReleases: () => ({ status: 1, stdout: '', stderr: '' }),
  });
  return calls;
}

// The global config dir resolves to $XDG_CONFIG_HOME/spec-guard (set to tmpHome in beforeEach).
function configDir() {
  return path.join(tmpHome, 'spec-guard');
}
// Mark this machine as "wired" (non-empty global manifest) so upgrade refreshes it.
function seedMachineWired() {
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(
    path.join(configDir(), 'manifest.json'),
    JSON.stringify({ version: 1, files: { 'global:claude-code:skill': { hash: 'x' } } })
  );
}
function seedLKG(v) {
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(path.join(configDir(), 'config.json'), JSON.stringify({ lastKnownGood: v }));
}

test('self upgrade: already at latest is a no-op (no install, no machine refresh)', () => {
  const calls = stub({ view: pkg.version });
  const { out, code } = capture(() => self.run(['upgrade']));
  assert.strictEqual(code, 0);
  assert.match(out, /already at latest/);
  assert.strictEqual(calls.install, 0, 'must not reinstall when already current');
  assert.strictEqual(calls.refresh, 0, 'must not refresh the machine when nothing changed');
});

test('self upgrade --force reinstalls the same version (and refreshes a wired machine)', () => {
  seedMachineWired();
  const calls = stub({ view: pkg.version, installed: pkg.version });
  const { out, code } = capture(() => self.run(['upgrade', '--force']));
  assert.strictEqual(code, 0);
  assert.match(out, /reinstalled/);
  assert.strictEqual(calls.install, 1);
  assert.strictEqual(calls.refresh, 1, '--force should refresh the machine when it is wired');
});

test('self upgrade to a newer version installs, refreshes a wired machine, and nudges to update repos', () => {
  seedMachineWired();
  const calls = stub({ view: '9.9.9', installed: '9.9.9' });
  const { out, code } = capture(() => self.run(['upgrade']));
  assert.strictEqual(code, 0);
  assert.match(out, /upgraded to 9\.9\.9/);
  assert.match(out, /machine hooks refreshed/);
  assert.match(out, /specguard update/);
  assert.strictEqual(calls.install, 1);
  assert.strictEqual(calls.refresh, 1);
});

test('self upgrade does NOT wire a machine that was never set up (CLI-only / --no-global users)', () => {
  // No seedMachineWired(): empty global manifest = machine was never wired.
  const calls = stub({ view: '9.9.9', installed: '9.9.9' });
  const { out, code } = capture(() => self.run(['upgrade']));
  assert.strictEqual(code, 0);
  assert.match(out, /upgraded to 9\.9\.9/);
  assert.doesNotMatch(out, /machine hooks refreshed/);
  assert.match(out, /run 'specguard setup'/);
  assert.match(out, /specguard update/);
  assert.strictEqual(calls.install, 1);
  assert.strictEqual(calls.refresh, 0, 'must not silently create machine config the user opted out of');
});

test('self upgrade --dry-run when current says nothing to do', () => {
  stub({ view: pkg.version });
  const { out, code } = capture(() => self.run(['upgrade', '--dry-run']));
  assert.strictEqual(code, 0);
  assert.match(out, /already at latest/);
});

test('self upgrade --dry-run preview matches the real path (wired machine)', () => {
  seedMachineWired();
  const calls = stub({ view: '9.9.9' });
  const { out, code } = capture(() => self.run(['upgrade', '--dry-run']));
  assert.strictEqual(code, 0);
  assert.match(out, /would upgrade .* -> 9\.9\.9/);
  assert.match(out, /would also refresh this machine's wired hooks/);
  assert.match(out, /would then suggest running 'specguard update'/);
  assert.strictEqual(calls.install, 0, 'dry-run must not install');
});

test('self upgrade --dry-run does NOT promise a refresh on a never-wired machine', () => {
  // No seedMachineWired(): the real path would skip the refresh, so the preview must too.
  const calls = stub({ view: '9.9.9' });
  const { out, code } = capture(() => self.run(['upgrade', '--dry-run']));
  assert.strictEqual(code, 0);
  assert.match(out, /would upgrade .* -> 9\.9\.9/);
  assert.doesNotMatch(out, /would also refresh/);
  assert.match(out, /machine hooks aren't wired here/);
  assert.strictEqual(calls.install, 0);
});

test('self upgrade --dry-run offline (no version confirmable) previews a reinstall, not an upgrade', () => {
  // Offline: npmView returns null. The real path can't confirm a change → reinstalls with no repo
  // nudge, so the preview must NOT claim an upgrade or promise "specguard update".
  seedMachineWired();
  const calls = stub({ view: null });
  const { out, code } = capture(() => self.run(['upgrade', '--dry-run']));
  assert.strictEqual(code, 0);
  assert.match(out, /would reinstall .* -> latest/);
  assert.doesNotMatch(out, /would upgrade/);
  assert.doesNotMatch(out, /specguard update/);
  assert.strictEqual(calls.install, 0);
});

test('self check reports up to date when versions match', () => {
  stub({ view: pkg.version });
  const { out, code } = capture(() => self.run(['check']));
  assert.strictEqual(code, 0);
  assert.match(out, /up to date/);
});

test('self rollback --dry-run previews without installing anything', () => {
  seedLKG('0.0.1');
  const calls = stub({});
  const { out, code } = capture(() => self.run(['rollback', '--dry-run']));
  assert.strictEqual(code, 0);
  assert.match(out, /would roll back .* -> 0\.0\.1/);
  assert.strictEqual(calls.install, 0, '--dry-run must not install');
});

test('self rollback installs the last-known-good version', () => {
  seedLKG('0.0.1');
  const calls = stub({});
  const { out, code } = capture(() => self.run(['rollback']));
  assert.strictEqual(code, 0);
  assert.match(out, /rolled back to 0\.0\.1/);
  assert.strictEqual(calls.install, 1);
});

test('self rollback with no recorded version fails cleanly', () => {
  const calls = stub({});
  const { err, code } = capture(() => self.run(['rollback']));
  assert.strictEqual(code, 1);
  assert.match(err, /no previous version recorded/);
  assert.strictEqual(calls.install, 0);
});
