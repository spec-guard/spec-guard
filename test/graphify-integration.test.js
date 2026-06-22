'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const installer = require('../src/core/installer.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Every governance doc the agent reads about graphify.
function proseFiles() {
  const dirs = ['templates/commands', 'skill/references', 'skill', 'docs/reference/decisions'];
  const files = [];
  for (const d of dirs) {
    for (const f of fs.readdirSync(path.join(ROOT, d))) {
      if (f.endsWith('.md')) files.push(path.join(d, f));
    }
  }
  return files;
}

// Regression: `graphify update` rejects `--mode` (exit 2) and `--mode deep` is extract-only, so the
// two must never appear as a contiguous command. Warning prose that says "never `--update` with
// `--mode deep`" is fine (not contiguous); an actual `… --update --mode deep` invocation is the bug.
test('no governance doc emits the invalid `--update --mode deep` command', () => {
  const bad = /--update\s+--mode\s+deep/;
  for (const rel of proseFiles()) {
    assert.ok(!bad.test(read(rel)), `${rel} contains the invalid contiguous "--update --mode deep"`);
  }
});

// Regression: the SKILL writes graphify-out/ to CWD, so per-module refresh must run from inside the
// module (cd in), never `/graphify <module>` from the root (which clobbers the root graph).
test('graphify reference teaches the cwd=module form + clobber/IP-firewall guardrails', () => {
  const ref = read('skill/references/graphify-integration.md');
  assert.match(ref, /cd <module> && \/graphify \./, 'must show the run-from-module form');
  assert.match(ref, /clobber/i, 'must explain why not to run from root');
  assert.match(ref, /merge-graphs/, 'root graph is a merge');
  assert.match(ref, /IP firewall/i, 'must carry the IP firewall section');
  assert.match(ref, /host agent session/i, 'must state semantic runs in the session (no key)');
});

// Regression: /spec:commit is the terminal SYNC step and must be discoverable from the umbrella and
// the claude-code overlay (previously both omitted it, orphaning the graph logic).
test('/spec:commit is wired as the terminal SYNC step', () => {
  assert.match(read('templates/commands/spec.md'), /\/spec:commit/);
  assert.match(read('templates/agents/claude-code/overlay.md'), /\/spec:commit/);
});

// ADR 0009 records the topology + IP-firewall decision.
test('ADR 0009 documents per-module + merge topology and the IP firewall', () => {
  const adr = read('docs/reference/decisions/0009-graph-topology-and-ip-firewall.md');
  assert.match(adr, /per-module/i);
  assert.match(adr, /merge-graphs/);
  assert.match(adr, /IP firewall/i);
});

// scaffoldGraphifyignore writes an IP-excluding, fully-substituted .graphifyignore, write-if-absent.
test('scaffoldGraphifyignore writes a substituted IP-firewall file, never clobbering', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-gi-'));
  try {
    const rel = installer.scaffoldGraphifyignore(tmp, { privateDir: '.private' });
    assert.strictEqual(rel, '.graphifyignore');
    const body = fs.readFileSync(path.join(tmp, '.graphifyignore'), 'utf8');
    assert.match(body, /^\.private\/$/m, 'privateDir excluded (substituted)');
    assert.match(body, /^\.claude\/$/m, 'agent dir excluded');
    assert.doesNotMatch(body, /\$\{privateDir\}/, 'fully substituted');
    // write-if-absent: a second call is a no-op.
    assert.strictEqual(installer.scaffoldGraphifyignore(tmp, { privateDir: '.private' }), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
