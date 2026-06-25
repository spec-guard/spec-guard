'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// Load the real tryAutoUpdate from activate.js by monkey-patching its config
// dependency and then requiring the module's internals via a thin re-export shim.
// activate.js does not export anything, so we use Module._compile to run it with
// an injected exports object that captures the function.

const activateSrc = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'hooks', 'activate.js'),
  'utf8'
);

// Append an export statement so we can pull out tryAutoUpdate
const patchedSrc = activateSrc + '\nmodule.exports = { tryAutoUpdate };\n';

function loadActivate(hookDir) {
  const Module = require('module');
  const fakeFile = path.join(hookDir, 'activate.js');
  const m = new Module(fakeFile);
  m.filename = fakeFile;
  m.paths = Module._nodeModulePaths(path.dirname(fakeFile));
  m._compile(patchedSrc, fakeFile);
  return m.exports;
}

function hashContent(content) {
  return crypto.createHash('sha256').update(String(content), 'utf8').digest('hex');
}

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-activate-test-'));
}

function makeHookDir(globalSkillParent) {
  // activate.js resolves GLOBAL_SKILL_DIR as path.resolve(__dirname, '..', '..', 'skills', 'spec-guard')
  // So hookDir must be <globalSkillParent>/hooks/spec-guard/
  const hookDir = path.join(globalSkillParent, 'hooks', 'spec-guard');
  fs.mkdirSync(hookDir, { recursive: true });
  // The installed config.js is src/core/config.js (the shim at src/hooks/config.js
  // just re-exports it; the real file is what gets copied during install).
  const configSrc = path.join(__dirname, '..', 'src', 'core', 'config.js');
  fs.copyFileSync(configSrc, path.join(hookDir, 'config.js'));
  return hookDir;
}

function writeManifest(repoRoot, files) {
  const dir = path.join(repoRoot, '.spec-guard');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version: 1, files }, null, 2) + '\n');
}

function readManifest(repoRoot) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, '.spec-guard', 'manifest.json'), 'utf8'));
}

function writeFile(base, rel, content) {
  const abs = path.join(base, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

test('tryAutoUpdate: outdated file is refreshed and manifest hash updated', () => {
  const tmp = mkTmp();
  const hookDir = makeHookDir(tmp);
  const { tryAutoUpdate } = loadActivate(hookDir);

  const globalSkillDir = path.join(tmp, 'skills', 'spec-guard');
  const repoRoot = path.join(tmp, 'repo');

  const oldContent = 'old skill content';
  const newContent = 'new skill content v2';

  writeFile(globalSkillDir, 'SKILL.md', newContent);
  writeFile(path.join(repoRoot, '.claude/skills/spec-guard'), 'SKILL.md', oldContent);
  writeManifest(repoRoot, {
    'repo:claude-code:skill:SKILL.md': { hash: hashContent(oldContent) },
  });

  const result = tryAutoUpdate(repoRoot);

  assert.deepEqual(result, { updated: 1, protectedCount: 0 });
  const actual = fs.readFileSync(path.join(repoRoot, '.claude/skills/spec-guard/SKILL.md'), 'utf8');
  assert.equal(actual, newContent);
  const m = readManifest(repoRoot);
  assert.equal(m.files['repo:claude-code:skill:SKILL.md'].hash, hashContent(newContent));
});

test('tryAutoUpdate: user-edited file is protected and not overwritten', () => {
  const tmp = mkTmp();
  const hookDir = makeHookDir(tmp);
  const { tryAutoUpdate } = loadActivate(hookDir);

  const globalSkillDir = path.join(tmp, 'skills', 'spec-guard');
  const repoRoot = path.join(tmp, 'repo');

  const originalContent = 'original content';
  const userEditedContent = 'user customized this file';
  const newGlobalContent = 'new global content v2';

  writeFile(globalSkillDir, 'SKILL.md', newGlobalContent);
  writeFile(path.join(repoRoot, '.claude/skills/spec-guard'), 'SKILL.md', userEditedContent);
  writeManifest(repoRoot, {
    'repo:claude-code:skill:SKILL.md': { hash: hashContent(originalContent) },
  });

  const result = tryAutoUpdate(repoRoot);

  assert.deepEqual(result, { updated: 0, protectedCount: 1 });
  const actual = fs.readFileSync(path.join(repoRoot, '.claude/skills/spec-guard/SKILL.md'), 'utf8');
  assert.equal(actual, userEditedContent, 'user-edited file must not be overwritten');
});

test('tryAutoUpdate: missing manifest returns null (not empty result)', () => {
  const tmp = mkTmp();
  const hookDir = makeHookDir(tmp);
  const { tryAutoUpdate } = loadActivate(hookDir);

  const repoRoot = path.join(tmp, 'repo');
  // No manifest written — .spec-guard/manifest.json does not exist

  const result = tryAutoUpdate(repoRoot);

  assert.equal(result, null, 'must return null when manifest is unreadable, not { updated: 0 }');
});

test('tryAutoUpdate: empty files manifest falls back to claude-code and refreshes skill', () => {
  const tmp = mkTmp();
  const hookDir = makeHookDir(tmp);
  const { tryAutoUpdate } = loadActivate(hookDir);

  const globalSkillDir = path.join(tmp, 'skills', 'spec-guard');
  const repoRoot = path.join(tmp, 'repo');

  const newContent = 'new skill content';
  writeFile(globalSkillDir, 'SKILL.md', newContent);
  // Old installed file — no manifest record yet (simulates a pre-manifest install)
  const oldContent = 'old skill content';
  writeFile(path.join(repoRoot, '.claude/skills/spec-guard'), 'SKILL.md', oldContent);
  // Empty files object: no repo:*:skill:* keys → installedAgentsFromManifest falls back to claude-code
  writeManifest(repoRoot, {});

  const result = tryAutoUpdate(repoRoot);

  // Fallback to claude-code must have fired: file updated (recorded was falsy, file existed on disk)
  assert.deepEqual(result, { updated: 1, protectedCount: 0 });
  const actual = fs.readFileSync(path.join(repoRoot, '.claude/skills/spec-guard/SKILL.md'), 'utf8');
  assert.equal(actual, newContent);
});

test('tryAutoUpdate: global skill dir missing returns without throwing', () => {
  const tmp = mkTmp();
  const hookDir = makeHookDir(tmp);
  const { tryAutoUpdate } = loadActivate(hookDir);

  const repoRoot = path.join(tmp, 'repo');
  // global skill dir (tmp/skills/spec-guard) intentionally not created
  writeManifest(repoRoot, {});

  let result;
  assert.doesNotThrow(() => { result = tryAutoUpdate(repoRoot); });
  // SKILL.md read fails → continue; allFiles processed with no updates
  assert.deepEqual(result, { updated: 0, protectedCount: 0 });
});

test('tryAutoUpdate: opencode-only repo does not get claude-code skill silently created', () => {
  const tmp = mkTmp();
  const hookDir = makeHookDir(tmp);
  const { tryAutoUpdate } = loadActivate(hookDir);

  const globalSkillDir = path.join(tmp, 'skills', 'spec-guard');
  const repoRoot = path.join(tmp, 'repo');

  writeFile(globalSkillDir, 'SKILL.md', 'skill content');
  // Manifest has opencode entries only — no claude-code entries
  writeManifest(repoRoot, {
    'repo:opencode:skill:SKILL.md': { hash: hashContent('old opencode skill') },
  });

  const result = tryAutoUpdate(repoRoot);

  // opencode skill dir should be updated (recorded exists, file needs refresh from global)
  // claude-code skill dir must NOT be created
  assert.ok(!fs.existsSync(path.join(repoRoot, '.claude/skills/spec-guard/SKILL.md')),
    'must not silently create claude-code skill tree in opencode-only repo');
  // The opencode file should have been updated (recorded present + file missing → install refresh)
  assert.deepEqual(result, { updated: 1, protectedCount: 0 });
  const actual = fs.readFileSync(path.join(repoRoot, '.opencode/skill/spec-guard/SKILL.md'), 'utf8');
  assert.equal(actual, 'skill content');
});

test('tryAutoUpdate: codex entry in manifest is skipped — no repo-scoped file created', () => {
  const tmp = mkTmp();
  const hookDir = makeHookDir(tmp);
  const { tryAutoUpdate } = loadActivate(hookDir);

  const globalSkillDir = path.join(tmp, 'skills', 'spec-guard');
  const repoRoot = path.join(tmp, 'repo');

  const content = 'skill content';
  writeFile(globalSkillDir, 'SKILL.md', content);

  // claude-code entry is up-to-date; codex is home-scoped and must be silently skipped
  writeFile(path.join(repoRoot, '.claude/skills/spec-guard'), 'SKILL.md', content);
  writeManifest(repoRoot, {
    'repo:claude-code:skill:SKILL.md': { hash: hashContent(content) },
    'repo:codex:skill:SKILL.md':       { hash: hashContent('old codex content') },
  });

  const result = tryAutoUpdate(repoRoot);

  assert.deepEqual(result, { updated: 0, protectedCount: 0 });
  assert.ok(!fs.existsSync(path.join(repoRoot, '.codex')),
    'must not create .codex/ inside the repo for a home-scoped agent');
});

test('tryAutoUpdate: no-op when repo skill already matches global', () => {
  const tmp = mkTmp();
  const hookDir = makeHookDir(tmp);
  const { tryAutoUpdate } = loadActivate(hookDir);

  const globalSkillDir = path.join(tmp, 'skills', 'spec-guard');
  const repoRoot = path.join(tmp, 'repo');

  const content = 'current content — already up to date';

  writeFile(globalSkillDir, 'SKILL.md', content);
  writeFile(path.join(repoRoot, '.claude/skills/spec-guard'), 'SKILL.md', content);
  writeManifest(repoRoot, {
    'repo:claude-code:skill:SKILL.md': { hash: hashContent(content) },
  });

  const manifestBefore = fs.readFileSync(path.join(repoRoot, '.spec-guard/manifest.json'), 'utf8');
  const result = tryAutoUpdate(repoRoot);

  assert.deepEqual(result, { updated: 0, protectedCount: 0 });
  const manifestAfter = fs.readFileSync(path.join(repoRoot, '.spec-guard/manifest.json'), 'utf8');
  assert.equal(manifestBefore, manifestAfter, 'manifest must not be rewritten on no-op');
});
