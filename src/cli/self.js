'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');

const { parseArgs, homeDir, globalManifestPath } = require('./_shared');
const config = require('../core/config');
const manifest = require('../core/manifest');
const setup = require('./setup');
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

// External calls are funnelled through `deps` so tests can inject fakes and exercise the
// upgrade/rollback decision logic without touching the network or the real npm/global binary.
const deps = {
  npmView(spec) {
    const r = spawnSync('npm', ['view', spec, 'version'], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : null;
  },
  npmInstallGlobal(tag) {
    return spawnSync('npm', ['install', '-g', `${PKG_NAME}@${tag}`], { encoding: 'utf8' });
  },
  // Post-upgrade smoke: invoke the freshly-installed global binary out-of-process and read its
  // reported version. (The in-process `pkg.version` is the OLD code still resident in memory, so
  // it can't validate the upgrade.) Returns the version string, or null if the binary can't run.
  installedVersion() {
    const r = spawnSync('specguard', ['--version'], { encoding: 'utf8' });
    return r.status === 0 && r.stdout ? r.stdout.trim() : null;
  },
  // Refresh this machine's wired hooks/skill/statusline to match the freshly-installed CLI.
  refreshMachine(home, opts) {
    return setup.wireMachine(home, opts);
  },
  // Best-effort changelog for the dry-run preview (private repo → unavailable without a token).
  ghReleases() {
    return spawnSync('gh', ['release', 'list', '--repo', 'spec-guard/spec-guard', '--limit', '5'], { encoding: 'utf8' });
  },
};

function check() {
  process.stdout.write(`current: ${pkg.version}\n`);
  const latest = deps.npmView(`${PKG_NAME}@latest`);
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
  const force = !!flags.force;

  if (flags['dry-run']) {
    const target = deps.npmView(`${PKG_NAME}@${tag}`);
    if (target && target === pkg.version && !force) {
      process.stdout.write(`specguard: already at latest (${pkg.version}) — nothing to do (use --force to reinstall)\n`);
      return 0;
    }
    // Mirror the real path's decisions so the preview never over-promises: a real upgrade is only
    // claimed when a newer version is CONFIRMED (target known and different). Offline (target null)
    // the real path can't confirm a change and ends up reinstalling — so we preview a reinstall too.
    // The machine refresh happens only when (upgrade-or-force) AND the machine is already wired.
    const willUpgrade = !!(target && target !== pkg.version);
    const verb = willUpgrade ? 'upgrade' : 'reinstall';
    process.stdout.write(`would ${verb} ${pkg.version} -> ${target || tag} (npm i -g ${PKG_NAME}@${tag})\n`);
    const wired = Object.keys(manifest.load(globalManifestPath(homeDir(flags))).files || {}).length > 0;
    if ((willUpgrade || force) && wired) {
      process.stdout.write("  would also refresh this machine's wired hooks.\n");
    } else if (willUpgrade && !wired) {
      process.stdout.write("  machine hooks aren't wired here — would suggest 'specguard setup' (left as-is otherwise).\n");
    }
    if (willUpgrade) {
      process.stdout.write("  spec-guard will auto-update on next session start in your repos.\n");
    }
    const gh = deps.ghReleases();
    if (gh && gh.status === 0 && gh.stdout && gh.stdout.trim()) process.stdout.write('recent releases:\n' + gh.stdout);
    else process.stdout.write('changelog: unavailable (private repo — set GH_TOKEN or use `gh auth login`).\n');
    return 0;
  }

  const target = deps.npmView(`${PKG_NAME}@${tag}`); // may be null when offline

  // Idempotency: if we can confirm we're already on the target version, do nothing (no LKG churn,
  // no global reinstall). `--force` reinstalls anyway. When offline (target null) we can't prove
  // we're current, so we fall through and let npm decide.
  if (target && target === pkg.version && !force) {
    process.stdout.write(`specguard: already at latest (${pkg.version})\n`);
    return 0;
  }

  writeLKG(pkg.version);
  const r = deps.npmInstallGlobal(tag);
  if (r.status !== 0) {
    const err = (r.stderr || '') + (r.error ? String(r.error) : '');
    if (/EACCES|EPERM|permission denied/i.test(err)) {
      process.stderr.write('specguard self: upgrade blocked by permissions (EACCES). Nothing was installed — fix npm\n' +
        'global perms (e.g. set a user prefix: `npm config set prefix ~/.npm-global`) and retry. No rollback needed.\n');
      return 1;
    }
    process.stderr.write('specguard self: upgrade failed:\n' + err + '\n');
    return 1;
  }

  // Only roll back on a CONFIRMED bad upgrade (installed version differs from the target). If we
  // can't run the binary to confirm (e.g. PATH oddities) we trust npm's success and don't churn.
  const installed = deps.installedVersion();
  if (installed && target && installed !== target) {
    process.stderr.write(`specguard self: post-upgrade check failed (expected ${target}, got ${installed}) — rolling back.\n`);
    return rollback(flags);
  }

  const newVersion = installed || target || tag;
  // A confirmed version change ships new machine-level artifacts (hooks/skill/statusline), so the
  // wired files are now stale. We only claim a real upgrade when we can confirm the version actually
  // changed; otherwise (offline, same-version --force reinstall) we report a reinstall and skip the
  // "go update your repos" nudge.
  const changed = installed || target ? newVersion !== pkg.version : false;

  // Refresh the machine ONLY if it was actually wired (init --with-global / setup). A user who
  // installed the CLI alone (npx / --no-global) opted out of machine config; a self-upgrade must not
  // silently create it — mirrors init's "already wired" sentinel and the "never mutate machine
  // config silently" rule in init.js.
  const home = homeDir(flags);
  const machineWired = Object.keys(manifest.load(globalManifestPath(home)).files || {}).length > 0;
  let refreshed = false;
  if ((changed || force) && machineWired) {
    const res = deps.refreshMachine(home, { force: true });
    refreshed = true;
    if (res && res.missing && res.missing.length) {
      process.stderr.write('specguard self: machine refresh incomplete — missing:\n  ' + res.missing.join('\n  ') + '\n');
    }
  }

  if (changed) {
    process.stdout.write(`specguard: upgraded to ${newVersion}${refreshed ? ' (machine hooks refreshed)' : ''}\n`);
    if (!machineWired) {
      process.stdout.write("  (machine hooks not wired here — run 'specguard setup' to add session hooks + statusline.)\n");
    }
    process.stdout.write("  spec-guard will auto-update on next session start in each repo.\n");
  } else {
    process.stdout.write(`specguard: reinstalled ${newVersion}${refreshed ? ' (machine hooks refreshed)' : ''}\n`);
  }
  return 0;
}

function rollback(flags = {}) {
  const lkg = readLKG();
  if (!lkg) {
    process.stderr.write(`specguard self: no previous version recorded — cannot roll back. Reinstall: npm i -g ${PKG_NAME}\n`);
    return 1;
  }
  if (flags['dry-run']) {
    process.stdout.write(`would roll back ${pkg.version} -> ${lkg} (npm i -g ${PKG_NAME}@${lkg})\n`);
    return 0;
  }
  const r = deps.npmInstallGlobal(lkg);
  if (r.status !== 0) {
    process.stderr.write(`specguard self: rollback to ${lkg} failed:\n` + (r.stderr || '') + '\n');
    return 1;
  }
  process.stdout.write(`specguard: rolled back to ${lkg}\n`);
  return 0;
}

function run(args) {
  const { flags, positionals } = parseArgs(args);
  const sub = (positionals[0] || 'check').toLowerCase();
  if (sub === 'check') return check(flags);
  if (sub === 'upgrade') return upgrade(flags);
  if (sub === 'rollback') return rollback(flags);
  process.stderr.write('usage: specguard self check|upgrade|rollback [--dry-run] [--tag vX.Y.Z] [--force]\n');
  return 1;
}

module.exports = { run, deps };
