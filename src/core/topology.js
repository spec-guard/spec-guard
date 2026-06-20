'use strict';

// Repo-topology detection. Distinguishes a plain repo from a multi-git backup monorepo
// (N deliverable repos under a private root) and from a deliverable sub-repo inside one.
//
// kind:
//   single-repo          - one git repo, no nested deliverable repos
//   multi-git-root       - a backup monorepo: own .git + >=2 subdirs that are their own repos
//   deliverable-subrepo  - own .git AND an ancestor is also a git repo (we're inside a root)
//   already-initialized  - this dir already has .spec-guard/config.json
//
// Backup-monorepo bootstrap (two-pass): in steady state the flag lives in config; on a fresh
// run we also detect the pattern directly (root .git + >=2 subdir repos, where a subdir repo's
// git dir may be transiently renamed `.git_backup` during a root commit).

const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['node_modules', '.git', '.git_backup', '.spec-guard', '.claude', '.codex', '.gemini', '.github', 'graphify-out']);

function isGitRepoDir(dir) {
  return fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, '.git_backup'));
}

function listModules(root) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (e) {
    return [];
  }
  const modules = [];
  for (const e of entries) {
    if (!e.isDirectory() || SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
    const sub = path.join(root, e.name);
    if (isGitRepoDir(sub)) {
      modules.push({ name: e.name, gitDir: fs.existsSync(path.join(sub, '.git')) ? '.git' : '.git_backup' });
    }
  }
  return modules;
}

function hasAncestorGit(dir) {
  let cur = path.dirname(path.resolve(dir));
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (isGitRepoDir(cur)) return true;
    const parent = path.dirname(cur);
    if (parent === cur) return false;
    cur = parent;
  }
}

function detect(startDir, opts) {
  const options = opts || {};
  const root = path.resolve(startDir || process.cwd());
  const hasConfig = fs.existsSync(path.join(root, '.spec-guard', 'config.json'));
  const modules = listModules(root);
  const selfGit = isGitRepoDir(root);
  const ancestorGit = hasAncestorGit(root);

  let kind;
  if (hasConfig && !options.reinit) {
    kind = 'already-initialized';
  } else if (selfGit && modules.length >= 2) {
    kind = 'multi-git-root';
  } else if (selfGit && ancestorGit) {
    kind = 'deliverable-subrepo';
  } else {
    kind = 'single-repo';
  }

  return {
    kind,
    root,
    modules: modules.map((m) => m.name),
    backupMonorepo: kind === 'multi-git-root',
    transientGitBackup: modules.some((m) => m.gitDir === '.git_backup'),
  };
}

module.exports = { detect, listModules, isGitRepoDir, hasAncestorGit };
