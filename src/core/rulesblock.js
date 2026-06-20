'use strict';

// Managed, delimited block written into an agent's rules file (CLAUDE.md / AGENTS.md /
// .github/copilot-instructions.md / GEMINI.md). spec-guard owns ONLY the region between the
// markers; surrounding user content is never touched. The block is a SHORT pointer (the full
// governance is the skill), generated from templates/rules-block.md.

const fs = require('fs');
const path = require('path');
const render = require('./render');

const START = '<!-- spec-guard:start -->';
const END = '<!-- spec-guard:end -->';

const BLOCK_RE = new RegExp(
  `${START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
);

// The pointer body (substituted), without the markers.
function buildBody(vars) {
  const tplPath = path.join(render.PKG_ROOT, 'templates', 'rules-block.md');
  return render.substitute(fs.readFileSync(tplPath, 'utf8'), Object.assign({ specDir: 'docs/specs', plansDir: 'docs/plans' }, vars)).replace(/\s*$/, '');
}

function wrap(body) {
  return `${START}\n${body}\n${END}`;
}

// Extract the current block body (between markers), or null if absent.
function extract(fileContent) {
  const m = BLOCK_RE.exec(fileContent || '');
  if (!m) return null;
  return m[0].slice(START.length, m[0].length - END.length).replace(/^\n/, '').replace(/\n$/, '');
}

function hasBlock(fileContent) {
  return BLOCK_RE.test(fileContent || '');
}

// Upsert the managed block into file content. Replaces the region in place if present,
// else appends it (with a separating blank line). Returns the new full content.
function upsert(fileContent, body) {
  const block = wrap(body);
  const text = fileContent || '';
  if (hasBlock(text)) {
    return text.replace(BLOCK_RE, block);
  }
  const sep = text.length && !/\n\n$/.test(text) ? (/\n$/.test(text) ? '\n' : '\n\n') : '';
  return text + sep + block + '\n';
}

module.exports = { START, END, buildBody, wrap, extract, hasBlock, upsert };
