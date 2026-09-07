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

// A real repo/module has `.git` (or, transiently, `.git_backup`) as a DIRECTORY. A git worktree
// presents `.git` as a FILE (a `gitdir: ...` pointer) — without this check, a worktree created
// inside the repo root would be misclassified as a deliverable module. (`specguard coordinate`
// avoids this primarily by always placing worktrees as a sibling of the repo, never inside it;
// this is the second line of defense.)
function isRealGitDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch (e) { return false; }
}

function isGitRepoDir(dir) {
  return isRealGitDir(path.join(dir, '.git')) || isRealGitDir(path.join(dir, '.git_backup'));
}

// A module can sit inside a plain "grouping" directory that is itself not a git repo (e.g.
// `api-rag-engine/api-chunker`), not just as a direct child of root. Recurse into any directory
// that ISN'T itself a git repo, up to MAX_MODULE_DEPTH levels; never recurse INTO a directory
// once it's identified as a module (a module's own subtree is its own concern, not this repo's
// module list, and recursing there risks picking up e.g. that module's own nested checkouts).
const MAX_MODULE_DEPTH = 4;

function listModules(root) {
  const modules = [];
  function walk(dir, relPrefix, depth) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      const sub = path.join(dir, e.name);
      const relName = relPrefix ? `${relPrefix}/${e.name}` : e.name;
      if (isGitRepoDir(sub)) {
        modules.push({ name: relName, gitDir: fs.existsSync(path.join(sub, '.git')) ? '.git' : '.git_backup' });
      } else if (depth < MAX_MODULE_DEPTH) {
        walk(sub, relName, depth + 1);
      }
    }
  }
  walk(root, '', 1);
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
