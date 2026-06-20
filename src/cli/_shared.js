'use strict';

const os = require('os');
const path = require('path');

const config = require('../core/config');

// Minimal flag parser. Supports:
//   --key value | --key=value | --bool        (long flags)
//   -k value    | -k=value    | -k             (short flags, e.g. `-m "feat: x"`)
//   positionals (anything else)
// A flag's value is the next token unless that token itself looks like a flag.
function setFlag(flags, key, args, i) {
  const next = args[i + 1];
  if (next !== undefined && !next.startsWith('-')) {
    flags[key] = next;
    return i + 1; // consumed the value
  }
  flags[key] = true;
  return i;
}

function parseArgs(args) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq >= 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else i = setFlag(flags, a.slice(2), args, i);
    } else if (a.length > 1 && a[0] === '-' && /^[a-zA-Z]/.test(a[1])) {
      // Short flag (single dash). `-m=x` or `-m x` or bare `-m`.
      const eq = a.indexOf('=');
      if (eq >= 0) flags[a.slice(1, eq)] = a.slice(eq + 1);
      else i = setFlag(flags, a.slice(1), args, i);
    } else {
      positionals.push(a);
    }
  }
  return { flags, positionals };
}

// Home base — overridable via SPEC_GUARD_HOME for hermetic tests.
function homeDir(flags) {
  return (flags && typeof flags.home === 'string' && flags.home) || process.env.SPEC_GUARD_HOME || os.homedir();
}

// The machine-level manifest lives alongside the global config (XDG_CONFIG_HOME / %APPDATA% /
// ~/.config aware, rooted at `home` for test hermeticity), so install/uninstall/purge all agree
// on one location regardless of platform.
function globalManifestPath(home) {
  return path.join(config.getConfigDir(home), 'manifest.json');
}

function isSpecGuardRepo(repoRoot) {
  try {
    return require(path.join(repoRoot, 'package.json')).name === '@spec-guard/cli';
  } catch (e) {
    return false;
  }
}

module.exports = { parseArgs, homeDir, globalManifestPath, isSpecGuardRepo };
