'use strict';

// Owned-file manifest + write guard. Every file spec-guard installs is recorded with a content
// hash. On re-write (`update`/`upgrade`):
//   - whole-file owned: hash match -> overwrite; user-edited (hash differs) -> write a
//     `<file>.spec-guard-update` sidecar and warn, never clobber.
//   - block-owned (rules files): only the delimited block is hashed; a diverged block warns but
//     is still replaced in place (surrounding user content is never touched, so no sidecar).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const rulesblock = require('./rulesblock');

const MANIFEST_VERSION = 1;

function emptyManifest() {
  return { version: MANIFEST_VERSION, files: {} };
}

function load(manifestPath) {
  try {
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!m.files) m.files = {};
    return m;
  } catch (e) {
    return emptyManifest();
  }
}

function save(manifestPath, manifest) {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

function hash(content) {
  return crypto.createHash('sha256').update(String(content), 'utf8').digest('hex');
}

function record(manifest, key, h, extra) {
  manifest.files[key] = Object.assign({ hash: h }, extra || {});
}

// Whole-file owned write. Returns action: created | unchanged | updated | diverged.
function writeManaged({ absPath, content, manifest, key, force }) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const newHash = hash(content);

  if (!fs.existsSync(absPath)) {
    fs.writeFileSync(absPath, content);
    record(manifest, key, newHash);
    return { action: 'created', absPath };
  }

  const current = fs.readFileSync(absPath, 'utf8');
  const currentHash = hash(current);
  const recorded = manifest.files[key] && manifest.files[key].hash;

  if (currentHash === newHash) {
    record(manifest, key, newHash);
    return { action: 'unchanged', absPath };
  }

  // User-edited an owned file (we have a record and it no longer matches): protect it.
  if (recorded && currentHash !== recorded && !force) {
    const sidecar = `${absPath}.spec-guard-update`;
    fs.writeFileSync(sidecar, content);
    return { action: 'diverged', absPath, sidecar };
  }

  fs.writeFileSync(absPath, content);
  record(manifest, key, newHash);
  return { action: 'updated', absPath };
}

// Block-owned write into a rules file. Returns action: block-created | block-unchanged |
// block-updated | block-diverged (diverged still replaces, just warns).
function writeBlockManaged({ absPath, body, manifest, key, force }) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const existing = fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf8') : '';
  const currentBlock = rulesblock.extract(existing);
  const recorded = manifest.files[key] && manifest.files[key].hash;
  const newHash = hash(body);

  let action;
  if (currentBlock === null) {
    action = 'block-created';
  } else if (hash(currentBlock) === newHash) {
    record(manifest, key, newHash, { blockOwned: true });
    return { action: 'block-unchanged', absPath };
  } else if (recorded && hash(currentBlock) !== recorded && !force) {
    action = 'block-diverged'; // user edited inside our block; warn but still replace
  } else {
    action = 'block-updated';
  }

  const next = rulesblock.upsert(existing, body);
  fs.writeFileSync(absPath, next);
  record(manifest, key, newHash, { blockOwned: true });
  return { action, absPath };
}

module.exports = {
  MANIFEST_VERSION,
  emptyManifest,
  load,
  save,
  hash,
  writeManaged,
  writeBlockManaged,
};
