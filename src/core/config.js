'use strict';

// spec-guard — configuration resolver.
//
// Default-mode resolution order:
//   1. SPEC_GUARD_DEFAULT_MODE environment variable
//   2. XDG global config file `defaultMode` field:
//      - $XDG_CONFIG_HOME/spec-guard/config.json (any platform, if set)
//      - ~/.config/spec-guard/config.json (macOS / Linux fallback)
//      - %APPDATA%\spec-guard\config.json (Windows fallback)
//   3. 'on' (spec-guard is active by default)
//
// Phase 2 extends this module with repo-local `.spec-guard/config.json` resolution
// (specDir / plansDir / agents / modules) walked up from a working directory.

const fs = require('fs');
const path = require('path');
const os = require('os');

const VALID_MODES = ['on', 'off'];

function getConfigDir() {
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, 'spec-guard');
  }
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'spec-guard'
    );
  }
  return path.join(os.homedir(), '.config', 'spec-guard');
}

function getConfigPath() {
  return path.join(getConfigDir(), 'config.json');
}

function readGlobalConfig() {
  try {
    return JSON.parse(fs.readFileSync(getConfigPath(), 'utf8'));
  } catch (e) {
    return {};
  }
}

function getDefaultMode() {
  const envMode = process.env.SPEC_GUARD_DEFAULT_MODE;
  if (envMode && VALID_MODES.includes(envMode.toLowerCase())) {
    return envMode.toLowerCase();
  }
  const config = readGlobalConfig();
  if (config.defaultMode && VALID_MODES.includes(String(config.defaultMode).toLowerCase())) {
    return String(config.defaultMode).toLowerCase();
  }
  return 'on';
}

function setDefaultMode(mode) {
  const m = String(mode).toLowerCase();
  if (!VALID_MODES.includes(m)) throw new Error('invalid mode: ' + mode);
  const dir = getConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  const config = readGlobalConfig();
  config.defaultMode = m;
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  return m;
}

// Symlink-safe, atomic flag write with 0600 perms. Refuses to follow a symlink
// at the flag path (local-attacker clobber vector). Silent best-effort.
function safeWriteFlag(flagPath, content) {
  try {
    const dir = path.dirname(flagPath);
    fs.mkdirSync(dir, { recursive: true });

    try {
      if (fs.lstatSync(flagPath).isSymbolicLink()) return;
    } catch (e) {
      if (e.code !== 'ENOENT') return;
    }

    const tempPath = path.join(dir, `.spec-guard-active.${process.pid}.tmp`);
    const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW;
    let fd;
    try {
      fd = fs.openSync(tempPath, flags, 0o600);
      fs.writeSync(fd, String(content));
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    fs.renameSync(tempPath, flagPath);
  } catch (e) {
    // Silent fail — flag is best-effort.
  }
}

function removeFlag(flagPath) {
  try { fs.unlinkSync(flagPath); } catch (e) {}
}

function getFlagPath() {
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(claudeDir, '.spec-guard-active');
}

// ---------------------------------------------------------------------------
// Repo-local configuration (`.spec-guard/config.json`)
// ---------------------------------------------------------------------------

const DEFAULTS = Object.freeze({ specDir: 'docs/specs', plansDir: 'docs/plans' });

// Walk up from startDir to the filesystem root looking for `.spec-guard/config.json`.
// Returns the absolute path to that file, or null.
function findRepoConfigPath(startDir) {
  let dir = path.resolve(startDir || process.cwd());
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = path.join(dir, '.spec-guard', 'config.json');
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch (e) {
      // not here — keep walking
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// The repo root is the directory CONTAINING `.spec-guard/` (one level above the config file).
function findRepoRoot(startDir) {
  const cfg = findRepoConfigPath(startDir);
  return cfg ? path.dirname(path.dirname(cfg)) : null;
}

function readRepoConfig(startDir) {
  const cfgPath = findRepoConfigPath(startDir);
  if (!cfgPath) return null;
  try {
    return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch (e) {
    return null;
  }
}

// Resolved settings for a repo: repo-local config merged over defaults.
// `root` is the repo root if an `.spec-guard/config.json` was found, else null.
function resolveRepoSettings(startDir) {
  const cfg = readRepoConfig(startDir) || {};
  return {
    root: findRepoRoot(startDir),
    specDir: cfg.specDir || DEFAULTS.specDir,
    plansDir: cfg.plansDir || DEFAULTS.plansDir,
    agents: Array.isArray(cfg.agents) ? cfg.agents : [],
    modules: Array.isArray(cfg.modules) ? cfg.modules : [],
    backupMonorepo: cfg.backupMonorepo === true,
  };
}

function writeRepoConfig(repoRoot, settings) {
  const dir = path.join(repoRoot, '.spec-guard');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'config.json');
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
  const merged = Object.assign({}, existing, settings);
  fs.writeFileSync(file, JSON.stringify(merged, null, 2) + '\n');
  return file;
}

module.exports = {
  VALID_MODES,
  DEFAULTS,
  getConfigDir,
  getConfigPath,
  readGlobalConfig,
  getDefaultMode,
  setDefaultMode,
  safeWriteFlag,
  removeFlag,
  getFlagPath,
  findRepoConfigPath,
  findRepoRoot,
  readRepoConfig,
  resolveRepoSettings,
  writeRepoConfig,
};
