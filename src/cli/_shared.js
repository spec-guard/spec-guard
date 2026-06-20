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

// Levenshtein edit distance — small inputs (command names), so the simple O(n*m) DP is fine.
function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

// Return the candidate closest to `input` within `maxDistance` edits, or null when nothing is
// close enough. Used for "did you mean '<x>'?" suggestions on unknown commands.
function closest(input, candidates, maxDistance = 2) {
  let best = null;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = editDistance(input, c);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return bestD <= maxDistance ? best : null;
}

function isSpecGuardRepo(repoRoot) {
  try {
    return require(path.join(repoRoot, 'package.json')).name === '@spec-guard/cli';
  } catch (e) {
    return false;
  }
}

module.exports = { parseArgs, homeDir, globalManifestPath, isSpecGuardRepo, closest, editDistance };
