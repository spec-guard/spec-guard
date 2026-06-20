'use strict';

// Transitional command: upgrade an old-model repo to the current spec-guard layout.
//   - docs/superpowers/{specs,plans} -> docs/{specs,plans}
//   - .claude/docs and .claude/credentials (root + every module) -> <privateDir>/{docs,credentials}
//   - sweep references across text files
//   - add <privateDir>/ to deliverable .gitignores that already exclude .claude/
//
// Dry-run by DEFAULT; pass --apply to make changes. Intended to be deleted once your repos are
// migrated. It does NOT commit — review and commit yourself (it respects your git history best
// when you `git add -A` after, which detects the renames).

const fs = require('fs');
const path = require('path');

const { parseArgs } = require('./_shared');
const config = require('../core/config');

const TEXT_EXT = new Set(['.md', '.py', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.yml', '.yaml', '.json', '.sh', '.txt', '.toml', '.example', '.env']);
const SKIP = new Set(['node_modules', '.git', '.git_backup', 'graphify-out', '.venv', 'venv', '__pycache__', 'dist', 'build', '.next', 'dist-server']);

function walkDirs(root, match, acc) {
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (e) { return acc; }
  for (const e of entries) {
    if (!e.isDirectory() || SKIP.has(e.name)) continue;
    const full = path.join(root, e.name);
    if (match(full)) acc.push(full);
    walkDirs(full, match, acc);
  }
  return acc;
}

function walkTextFiles(root, acc) {
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (e) { return acc; }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(root, e.name);
    if (e.isDirectory()) walkTextFiles(full, acc);
    else if (TEXT_EXT.has(path.extname(e.name)) || e.name.endsWith('.env.example')) acc.push(full);
  }
  return acc;
}

function planMoves(root, privateDir) {
  const moves = [];
  // superpowers -> docs/{specs,plans}
  for (const [from, to] of [['docs/superpowers/specs', 'docs/specs'], ['docs/superpowers/plans', 'docs/plans']]) {
    if (fs.existsSync(path.join(root, from))) moves.push([from, to]);
  }
  if (fs.existsSync(path.join(root, 'docs/superpowers/README.md')) && !fs.existsSync(path.join(root, 'docs/specs/README.md'))) {
    moves.push(['docs/superpowers/README.md', 'docs/specs/README.md']);
  }
  // .claude/docs + .claude/credentials (root + every module) -> <privateDir>/...
  for (const kind of ['docs', 'credentials']) {
    for (const dir of walkDirs(root, (d) => path.basename(d) === kind && path.basename(path.dirname(d)) === '.claude', [])) {
      const rel = path.relative(root, dir);
      const moduleDir = path.dirname(path.dirname(rel)); // strip /.claude/<kind>
      const to = path.join(moduleDir === '' ? '.' : moduleDir, privateDir, kind);
      moves.push([rel, path.normalize(to)]);
    }
  }
  return moves;
}

function sweepReplacements(privateDir) {
  return [
    ['docs/superpowers/specs/', 'docs/specs/'],
    ['docs/superpowers/plans/', 'docs/plans/'],
    ['../superpowers/specs/', '../specs/'],
    ['../superpowers/plans/', '../plans/'],
    ['../../superpowers/specs/', '../../specs/'],
    ['../../superpowers/plans/', '../../plans/'],
    ['.claude/docs/', `${privateDir}/docs/`],
    ['.claude/credentials/', `${privateDir}/credentials/`],
    ['.claude/docs', `${privateDir}/docs`],
  ];
}

function run(args) {
  const { flags, positionals } = parseArgs(args);
  const root = path.resolve(positionals[0] || '.');
  const apply = !!flags.apply;
  const privateDir = (typeof flags['private-dir'] === 'string' && flags['private-dir']) ||
    config.resolveRepoSettings(root).privateDir || '.private';

  const moves = planMoves(root, privateDir);
  const rules = sweepReplacements(privateDir);

  // Count sweep hits without writing (dry-run) / apply.
  let sweepFiles = 0, sweepHits = 0;
  const files = walkTextFiles(root, []);
  for (const f of files) {
    let s;
    try { s = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
    let n = 0, out = s;
    for (const [a, b] of rules) { const p = out.split(a); if (p.length > 1) { n += p.length - 1; out = p.join(b); } }
    if (n > 0) { sweepFiles++; sweepHits += n; if (apply) fs.writeFileSync(f, out); }
  }

  // gitignores that exclude .claude/ -> ensure privateDir present (root + every subdir with one).
  let giCount = 0;
  const giDirs = [root].concat(walkDirs(root, (d) => fs.existsSync(path.join(d, '.gitignore')), []));
  for (const dir of giDirs) {
    const gi = path.join(dir, '.gitignore');
    if (!fs.existsSync(gi)) continue;
    const s = fs.readFileSync(gi, 'utf8');
    if (/(^|\n)\s*\.claude\//.test(s) && !s.includes(`${privateDir}/`)) {
      giCount++;
      if (apply) fs.writeFileSync(gi, s.replace(/^(\.claude\/.*$)/m, `$1\n${privateDir}/`));
    }
  }

  // Apply moves last (so the sweep above edited files at their old paths first).
  if (apply) {
    for (const [from, to] of moves) {
      const src = path.join(root, from), dst = path.join(root, to);
      if (!fs.existsSync(src)) continue;
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.renameSync(src, dst);
    }
    // Remove now-empty source parents (docs/superpowers, etc.).
    for (const [from] of moves) {
      let dir = path.dirname(path.join(root, from));
      while (dir !== root) {
        try { if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir); else break; } catch (e) { break; }
        dir = path.dirname(dir);
      }
    }
  }

  const mode = apply ? 'APPLIED' : 'DRY-RUN (pass --apply to execute)';
  const out = [`specguard migrate — ${mode}`, `repo: ${root}   privateDir: ${privateDir}`, ''];
  out.push(`moves (${moves.length}):`);
  for (const [from, to] of moves) out.push(`  ${from}  ->  ${to}`);
  out.push(`reference sweep: ${sweepHits} replacements in ${sweepFiles} files`);
  out.push(`.gitignore: ${giCount} files ${apply ? 'updated' : 'would gain'} ${privateDir}/`);
  if (!apply) out.push('', "Re-run with --apply, then `git add -A` (git detects the renames) and review before committing.");
  else out.push('', 'Done. Run `specguard init` if not yet initialized, then `git add -A` and review.');
  process.stdout.write(out.join('\n') + '\n');
  return 0;
}

module.exports = { run };
