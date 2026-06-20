'use strict';

// IP/deliverable wall lint. The golden rule: deliverable docs (`docs/`) must never link into
// NON-deliverable content. Non-deliverable = the internal IP knowledge base (the configurable
// `privateDir`, default `.private/`) and per-agent integration dirs (`.claude/`, `.codex/`,
// `.gemini/`). A violation is a *hyperlink* whose target points into one of those at any `../`
// depth (e.g. `](.private/x)`, `](../.private/x)`, `](.claude/x)`). A *prose* mention of those
// paths (e.g. while explaining this rule) is NOT a violation.

const fs = require('fs');
const path = require('path');

const DEFAULT_AGENT_DIRS = ['.claude/', '.codex/', '.gemini/'];

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Build a regex matching a markdown link target into any forbidden dir at any ../ depth.
function buildWallRegex(forbidden) {
  const alts = forbidden.map((f) => esc(f.endsWith('/') ? f : f + '/')).join('|');
  return new RegExp(`\\]\\((?:\\.\\.\\/)*(?:${alts})`);
}

function walkMarkdown(dir, acc) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return acc;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      walkMarkdown(full, acc);
    } else if (e.isFile() && e.name.endsWith('.md')) {
      acc.push(full);
    }
  }
  return acc;
}

// Lint a single docs directory against a forbidden-target list. Returns [{ file, line, text }].
function lintDocsDir(docsDir, forbidden) {
  const violations = [];
  if (!fs.existsSync(docsDir)) return violations;
  const re = buildWallRegex(forbidden);
  for (const file of walkMarkdown(docsDir, [])) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((text, i) => {
      if (re.test(text)) violations.push({ file, line: i + 1, text: text.trim() });
    });
  }
  return violations;
}

// Lint a repo's deliverable docs tree. `opts.privateDir` (default `.private`) + the agent dirs are
// forbidden link targets.
function lintRepo(repoRoot, opts) {
  const options = opts || {};
  const privateDir = options.privateDir || '.private';
  const docsRel = options.docsRel || 'docs';
  const forbidden = [privateDir].concat(DEFAULT_AGENT_DIRS);
  return lintDocsDir(path.join(repoRoot, docsRel), forbidden);
}

module.exports = { buildWallRegex, lintDocsDir, lintRepo, DEFAULT_AGENT_DIRS };
