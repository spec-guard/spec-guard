'use strict';

// Single-source -> per-agent rendering.
//
// Templates under skill/ and templates/commands/ are parameterized with ${specDir},
// ${plansDir}, ${agentName}, ${version}. render.js performs ONLY substitution + a per-agent
// command-format emit; it contains no agent-specific business logic (that lives in the
// path matrix, src/core/agents.js, and the per-agent overlays under templates/agents/).

const fs = require('fs');
const path = require('path');

const PKG_ROOT = path.resolve(__dirname, '..', '..');
const pkg = require(path.join(PKG_ROOT, 'package.json'));

function substitute(str, vars) {
  return String(str).replace(/\$\{(\w+)\}/g, (match, key) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match;
  });
}

// Minimal YAML-ish frontmatter parser for our own templates (key: value lines only).
function parseFrontmatter(text) {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(text);
  if (!m) return { attrs: {}, body: text };
  const attrs = {};
  for (const line of m[1].split('\n')) {
    const kv = /^(\w[\w-]*):\s*(.*)$/.exec(line.trim());
    if (kv) attrs[kv[1]] = kv[2].trim();
  }
  return { attrs, body: m[2] };
}

function defaultVars(extra) {
  return Object.assign({ version: pkg.version, specDir: 'docs/specs', plansDir: 'docs/plans', privateDir: '.private' }, extra || {});
}

// Render the skill body for an agent: SKILL.md (substituted) + the agent's overlay (if any).
function renderSkill(agentId, vars) {
  const v = defaultVars(Object.assign({ agentName: agentId }, vars));
  const skill = substitute(fs.readFileSync(path.join(PKG_ROOT, 'skill', 'SKILL.md'), 'utf8'), v);
  const overlayPath = path.join(PKG_ROOT, 'templates', 'agents', agentId, 'overlay.md');
  let overlay = '';
  if (fs.existsSync(overlayPath)) {
    overlay = '\n' + substitute(fs.readFileSync(overlayPath, 'utf8'), v).replace(/\s*$/, '') + '\n';
  }
  return skill.replace(/\s*$/, '') + '\n' + overlay;
}

// Render one reference file (just substitution).
function renderReference(refName, vars) {
  const v = defaultVars(vars);
  return substitute(fs.readFileSync(path.join(PKG_ROOT, 'skill', 'references', refName), 'utf8'), v);
}

function listReferences() {
  return fs.readdirSync(path.join(PKG_ROOT, 'skill', 'references')).filter((f) => f.endsWith('.md'));
}

function listCommandTemplates() {
  return fs
    .readdirSync(path.join(PKG_ROOT, 'templates', 'commands'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => path.join(PKG_ROOT, 'templates', 'commands', f));
}

function tomlEscapeBasic(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Render a command template into the target agent's command-file { filename, content }.
// format: 'claude-md' | 'copilot-prompt' | 'gemini-toml'
function renderCommand(templatePath, format, vars) {
  const v = defaultVars(vars);
  const raw = substitute(fs.readFileSync(templatePath, 'utf8'), v);
  const { attrs, body } = parseFrontmatter(raw);
  const id = attrs.id || path.basename(templatePath, '.md');
  const description = attrs.description || '';
  const trimmedBody = body.replace(/^\s+|\s+$/g, '') + '\n';

  switch (format) {
    case 'claude-md':
      return {
        filename: `${id}.md`,
        content: `---\ndescription: ${description}\n---\n\n${trimmedBody}`,
      };
    case 'copilot-prompt':
      return {
        filename: `spec-${id}.prompt.md`,
        content: `---\ndescription: ${description}\n---\n\n${trimmedBody}`,
      };
    case 'gemini-toml':
      return {
        filename: `${id}.toml`,
        content: `description = "${tomlEscapeBasic(description)}"\nprompt = """\n${trimmedBody}"""\n`,
      };
    default:
      throw new Error(`unknown command format: ${format}`);
  }
}

module.exports = {
  PKG_ROOT,
  substitute,
  parseFrontmatter,
  renderSkill,
  renderReference,
  listReferences,
  listCommandTemplates,
  renderCommand,
};
