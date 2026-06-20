'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const completion = require('../src/core/completion');
const cmd = require('../src/cli/completion');

test('SHELLS covers the cross-platform set', () => {
  assert.deepStrictEqual(completion.SHELLS, ['bash', 'zsh', 'fish', 'powershell']);
});

test('each generator emits its shell hook + command + value words', () => {
  const bash = completion.generate('bash');
  assert.match(bash, /complete -F _specguard specguard/);
  assert.match(bash, /\binit\b/);
  assert.match(bash, /github-copilot/); // an --agent value
  assert.match(bash, /--with-global/); // an init flag

  const zsh = completion.generate('zsh');
  assert.match(zsh, /compdef _specguard specguard/);
  assert.match(zsh, /_describe/);

  const fish = completion.generate('fish');
  assert.match(fish, /complete -c specguard/);
  assert.match(fish, /-l agent/);

  const ps = completion.generate('powershell');
  assert.match(ps, /Register-ArgumentCompleter/);
  assert.match(ps, /specguard/);
});

test('generate throws on an unknown shell', () => {
  assert.throws(() => completion.generate('tcsh'), /unknown shell/);
});

test('CLI: completion <shell> prints the script; unknown shell errors', () => {
  function capture(args) {
    let out = '', err = '';
    const o = process.stdout.write, e = process.stderr.write;
    process.stdout.write = (c) => { out += c; return true; };
    process.stderr.write = (c) => { err += c; return true; };
    try { return { code: cmd.run(args), out, err }; } finally { process.stdout.write = o; process.stderr.write = e; }
  }
  const ok = capture(['bash']);
  assert.strictEqual(ok.code, 0);
  assert.match(ok.out, /complete -F _specguard specguard/);

  const bad = capture(['tcsh']);
  assert.strictEqual(bad.code, 1);
  assert.match(bad.err, /unknown shell/);
});

// Validate real shell syntax where the interpreter is available (skips cleanly if not).
function syntaxOk(shell, checkArgv, content) {
  const which = spawnSync('which', [shell], { encoding: 'utf8' });
  if (which.status !== 0) return null; // not installed → skip
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-comp-'));
  const file = path.join(dir, 'c');
  fs.writeFileSync(file, content);
  const r = spawnSync(shell, checkArgv.concat(file), { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  return r;
}

test('generated bash script is syntactically valid (bash -n)', () => {
  const r = syntaxOk('bash', ['-n'], completion.generate('bash'));
  if (r === null) return; // bash not present
  assert.strictEqual(r.status, 0, 'bash -n failed:\n' + (r.stderr || ''));
});

test('generated zsh script is syntactically valid (zsh -n) when zsh is present', () => {
  const r = syntaxOk('zsh', ['-n'], completion.generate('zsh'));
  if (r === null) return; // zsh not present
  assert.strictEqual(r.status, 0, 'zsh -n failed:\n' + (r.stderr || ''));
});
