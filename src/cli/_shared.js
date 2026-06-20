'use strict';

const os = require('os');
const path = require('path');

// Minimal flag parser: --key value | --key=value | --bool, plus positionals.
function parseArgs(args) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq >= 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = args[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
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

function globalManifestPath(home) {
  return path.join(home, '.config', 'spec-guard', 'manifest.json');
}

function isSpecGuardRepo(repoRoot) {
  try {
    return require(path.join(repoRoot, 'package.json')).name === '@spec-guard/cli';
  } catch (e) {
    return false;
  }
}

module.exports = { parseArgs, homeDir, globalManifestPath, isSpecGuardRepo };
