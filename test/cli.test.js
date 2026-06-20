'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const cli = require('../src/cli/index.js');
const pkg = require('../package.json');

function captureStdout(fn) {
  const orig = process.stdout.write;
  let out = '';
  process.stdout.write = (chunk) => {
    out += chunk;
    return true;
  };
  return Promise.resolve(fn())
    .then((code) => {
      process.stdout.write = orig;
      return { out, code };
    })
    .catch((err) => {
      process.stdout.write = orig;
      throw err;
    });
}

test('--version prints the package version', async () => {
  const { out, code } = await captureStdout(() => cli.main(['--version']));
  assert.strictEqual(out.trim(), pkg.version);
  assert.strictEqual(code, 0);
});

test('--help lists the commands', async () => {
  const { out, code } = await captureStdout(() => cli.main(['--help']));
  assert.match(out, /Usage: specguard/);
  for (const name of Object.keys(cli.COMMANDS)) {
    assert.match(out, new RegExp(`\\b${name}\\b`));
  }
  assert.strictEqual(code, 0);
});

test('unknown command exits non-zero', async () => {
  const code = await cli.main(['definitely-not-a-command']);
  assert.notStrictEqual(code, 0);
});

// Capture stdout + stderr around a (possibly async) call.
function captureBoth(fn) {
  const o = process.stdout.write;
  const e = process.stderr.write;
  let out = '';
  let err = '';
  process.stdout.write = (c) => ((out += c), true);
  process.stderr.write = (c) => ((err += c), true);
  return Promise.resolve()
    .then(fn)
    .then((code) => ({ out, err, code }))
    .finally(() => {
      process.stdout.write = o;
      process.stderr.write = e;
    });
}

test('per-command --help prints usage and does NOT run the command', async () => {
  for (const name of ['self', 'init', 'toggle']) {
    const { out, code } = await captureBoth(() => cli.main([name, '--help']));
    assert.strictEqual(code, 0, `${name} --help should exit 0`);
    assert.match(out, new RegExp(`usage: specguard ${name}`), `${name} --help should show its usage`);
  }
});

test('top-level --help shows subcommands inline', async () => {
  const { out } = await captureBoth(() => cli.main(['--help']));
  assert.match(out, /check\|upgrade\|rollback/);
  assert.match(out, /on\|off\|toggle\|status/);
});

test('unknown command suggests the closest match', async () => {
  const { err, code } = await captureBoth(() => cli.main(['slef']));
  assert.notStrictEqual(code, 0);
  assert.match(err, /Did you mean 'self'\?/);
});

test('helpFor renders flags for a command that has them', () => {
  const text = cli.helpFor('uninstall');
  assert.match(text, /usage: specguard uninstall/);
  assert.match(text, /--global/);
});
