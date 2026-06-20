'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');

const { parseArgs } = require('./_shared');
const config = require('../core/config');
const pkg = require('../../package.json');

const PKG_NAME = '@spec-guard/cli';

function readLKG() {
  return config.readGlobalConfig().lastKnownGood;
}

function writeLKG(v) {
  const dir = config.getConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  const c = config.readGlobalConfig();
  c.lastKnownGood = v;
  fs.writeFileSync(config.getConfigPath(), JSON.stringify(c, null, 2) + '\n', { mode: 0o600 });
}

function npmView(spec) {
  const r = spawnSync('npm', ['view', spec, 'version'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

function npmInstallGlobal(tag) {
  const r = spawnSync('npm', ['install', '-g', `${PKG_NAME}@${tag}`], { encoding: 'utf8' });
  return r;
}

// Post-upgrade smoke: invoke the freshly-installed global binary out-of-process and read its
// reported version. (The in-process `pkg.version` is the OLD code still resident in memory, so it
// can't validate the upgrade.) Returns the version string, or null if the binary can't be run.
function installedVersion() {
  const r = spawnSync('specguard', ['--version'], { encoding: 'utf8' });
  return r.status === 0 && r.stdout ? r.stdout.trim() : null;
}

function check() {
  process.stdout.write(`current: ${pkg.version}\n`);
  const latest = npmView(`${PKG_NAME}@latest`);
  if (!latest) {
    process.stdout.write('latest: unavailable (offline or package not yet published)\n');
    return 0;
  }
  process.stdout.write(`latest: ${latest}\n`);
  process.stdout.write(latest === pkg.version ? 'up to date\n' : `update available: ${pkg.version} -> ${latest}\n`);
  return 0;
}

function upgrade(flags) {
  const tag = (typeof flags.tag === 'string' && flags.tag) || 'latest';

  if (flags['dry-run']) {
    const target = npmView(`${PKG_NAME}@${tag}`);
    process.stdout.write(`would upgrade ${pkg.version} -> ${target || tag} (npm i -g ${PKG_NAME}@${tag})\n`);
    const gh = spawnSync('gh', ['release', 'list', '--repo', 'spec-guard/spec-guard', '--limit', '5'], { encoding: 'utf8' });
    if (gh.status === 0 && gh.stdout.trim()) process.stdout.write('recent releases:\n' + gh.stdout);
    else process.stdout.write('changelog: unavailable (private repo — set GH_TOKEN or use `gh auth login`).\n');
    return 0;
  }

  const target = npmView(`${PKG_NAME}@${tag}`); // may be null when offline
  writeLKG(pkg.version);
  const r = npmInstallGlobal(tag);
  if (r.status !== 0) {
    const err = (r.stderr || '') + (r.error ? String(r.error) : '');
    if (/EACCES|EPERM|permission denied/i.test(err)) {
      process.stderr.write('Upgrade blocked by permissions (EACCES). Nothing was installed — fix npm global perms\n' +
        '(e.g. set a user prefix: `npm config set prefix ~/.npm-global`) and retry. No rollback needed.\n');
      return 1;
    }
    process.stderr.write('Upgrade failed:\n' + err + '\n');
    return 1;
  }

  // Only roll back on a CONFIRMED bad upgrade (installed version differs from the target). If we
  // can't run the binary to confirm (e.g. PATH oddities) we trust npm's success and don't churn.
  const installed = installedVersion();
  if (installed && target && installed !== target) {
    process.stderr.write(`Post-upgrade check failed: expected ${target}, got ${installed} — rolling back.\n`);
    return rollback(flags);
  }
  process.stdout.write(`upgraded to ${installed || target || tag}\n`);
  return 0;
}

function rollback() {
  const lkg = readLKG();
  if (!lkg) {
    process.stderr.write(`No previous version recorded — cannot roll back. Reinstall: npm i -g ${PKG_NAME}\n`);
    return 1;
  }
  const r = npmInstallGlobal(lkg);
  if (r.status !== 0) {
    process.stderr.write(`Rollback to ${lkg} failed:\n` + (r.stderr || '') + '\n');
    return 1;
  }
  process.stdout.write(`rolled back to ${lkg}\n`);
  return 0;
}

function run(args) {
  const { flags, positionals } = parseArgs(args);
  const sub = (positionals[0] || 'check').toLowerCase();
  if (sub === 'check') return check(flags);
  if (sub === 'upgrade') return upgrade(flags);
  if (sub === 'rollback') return rollback(flags);
  process.stderr.write('usage: specguard self check|upgrade|rollback [--dry-run] [--tag vX.Y.Z]\n');
  return 1;
}

module.exports = { run };
