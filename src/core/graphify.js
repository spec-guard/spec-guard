'use strict';

// Optional graphify enhancer. Strictly fallback-safe: when graphify-out/graph.json is absent
// or the CLI is missing, every function returns null and the caller falls back to grep/read.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function available(repoRoot) {
  try {
    return fs.existsSync(path.join(repoRoot || process.cwd(), 'graphify-out', 'graph.json'));
  } catch (e) {
    return false;
  }
}

function run(repoRoot, args) {
  if (!available(repoRoot)) return null;
  try {
    const r = spawnSync('graphify', args, { cwd: repoRoot, encoding: 'utf8', timeout: 60000 });
    if (r.status !== 0) return null;
    return r.stdout;
  } catch (e) {
    return null;
  }
}

function query(repoRoot, question) {
  return run(repoRoot, ['query', String(question)]);
}

function explain(repoRoot, concept) {
  return run(repoRoot, ['explain', String(concept)]);
}

function pathBetween(repoRoot, a, b) {
  return run(repoRoot, ['path', String(a), String(b)]);
}

module.exports = { available, query, explain, pathBetween };
