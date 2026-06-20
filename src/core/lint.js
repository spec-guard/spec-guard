'use strict';

// IP/deliverable wall lint. The golden rule: deliverable docs (`docs/`) must never link into
// internal IP (`.claude/`). A violation is a *hyperlink* whose target points at `.claude/` at
// any `../` depth — e.g. `](.claude/x)`, `](../.claude/x)`, `](../../.claude/x)`. A *prose*
// mention of the string `.claude/` (e.g. while explaining this very rule) is NOT a violation.

const fs = require('fs');
const path = require('path');

// Markdown link target that resolves to .claude/ at any depth.
const WALL_RE = /\]\((?:\.\.\/)*\.claude\//;

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

// Lint a single docs directory. Returns [{ file, line, text }].
function lintDocsDir(docsDir) {
  const violations = [];
  if (!fs.existsSync(docsDir)) return violations;
  for (const file of walkMarkdown(docsDir, [])) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((text, i) => {
      if (WALL_RE.test(text)) violations.push({ file, line: i + 1, text: text.trim() });
    });
  }
  return violations;
}

// Lint a repo's deliverable docs tree (default `<root>/docs`).
function lintRepo(repoRoot, docsRel) {
  return lintDocsDir(path.join(repoRoot, docsRel || 'docs'));
}

module.exports = { WALL_RE, lintDocsDir, lintRepo };
