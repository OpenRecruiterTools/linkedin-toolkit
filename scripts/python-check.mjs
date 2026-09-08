#!/usr/bin/env node
/**
 * Run the Python client's test suite as part of `npm run release:check`.
 *
 * `clients/python` ships to PyPI, so a release gate that never runs it is a
 * release gate with a hole in it. But the toolkit is a Node project and a
 * contributor without Python must still be able to run the gate, so this:
 *
 *  - finds a Python 3.10+ interpreter, and exits 0 with a message if there is
 *    none — a skip that says why;
 *  - installs into a cached virtualenv under `node_modules/.cache/`, never into
 *    the user's own Python;
 *  - runs `pip install -e clients/python[test]` and then `pytest clients/python`,
 *    and fails the gate if either fails.
 *
 * Nothing here is shelled out through a string, so the `[test]` extra needs no
 * quoting and works the same on cmd.exe, PowerShell and sh.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const client = join(root, 'clients', 'python');
const venvDir = join(root, 'node_modules', '.cache', 'lit-python-venv');
const isWindows = process.platform === 'win32';

function skip(reason) {
  console.log(`Python checks skipped: ${reason}`);
  process.exit(0);
}

function fail(what, result) {
  console.error(`\n${what} failed (exit ${result.status}).`);
  if (result.stdout) console.error(result.stdout.toString().trimEnd());
  if (result.stderr) console.error(result.stderr.toString().trimEnd());
  process.exit(1);
}

if (!existsSync(join(client, 'pyproject.toml'))) {
  skip('clients/python is not in this checkout');
}

function findPython() {
  for (const [command, args] of [
    ['python3', []],
    ['python', []],
    ['py', ['-3']],
  ]) {
    const probe = spawnSync(command, [...args, '--version'], { encoding: 'utf8' });
    if (probe.status !== 0) continue;
    const match = `${probe.stdout}${probe.stderr}`.match(/Python (\d+)\.(\d+)/);
    if (!match) continue;
    if (Number(match[1]) > 3 || (Number(match[1]) === 3 && Number(match[2]) >= 10)) {
      return { command, args, version: match[0] };
    }
  }
  return null;
}

const python = findPython();
if (!python) skip('no Python 3.10 or newer on PATH');
console.log(`Using ${python.version} (${python.command})`);

const venvPython = isWindows
  ? join(venvDir, 'Scripts', 'python.exe')
  : join(venvDir, 'bin', 'python');

if (!existsSync(venvPython)) {
  mkdirSync(dirname(venvDir), { recursive: true });
  console.log(`Creating a virtualenv at ${venvDir}`);
  const created = spawnSync(python.command, [...python.args, '-m', 'venv', venvDir], {
    encoding: 'utf8',
  });
  if (created.status !== 0 || !existsSync(venvPython)) {
    skip(`could not create a virtualenv (${(created.stderr || created.stdout || '').trim()})`);
  }
}

console.log('pip install -e clients/python[test]');
const installed = spawnSync(
  venvPython,
  ['-m', 'pip', 'install', '--disable-pip-version-check', '-e', `${client}[test]`],
  { cwd: root, encoding: 'utf8' },
);
if (installed.status !== 0) {
  const output = `${installed.stdout ?? ''}${installed.stderr ?? ''}`;
  // No network is a reason to skip; a broken package is a reason to fail.
  if (/Network is unreachable|Temporary failure in name resolution|ProxyError|Failed to establish a new connection|Read timed out/i.test(output)) {
    skip('pip could not reach the network');
  }
  fail('pip install', installed);
}

console.log('pytest clients/python');
const tested = spawnSync(venvPython, ['-m', 'pytest', client], {
  cwd: root,
  encoding: 'utf8',
  stdio: 'inherit',
});
if (tested.status !== 0) {
  console.error(`\npytest clients/python failed (exit ${tested.status}).`);
  process.exit(1);
}
