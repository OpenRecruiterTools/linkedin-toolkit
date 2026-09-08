#!/usr/bin/env node
/**
 * Build the loadable extension zip.
 *
 * The extension has no build step — what ships is the source folder — so this
 * is a copy with the test and tooling files left out, plus a README.txt that a
 * person who downloaded a zip from a GitHub release can actually follow.
 *
 * The release workflow runs this same script, so what a maintainer inspects
 * locally on any OS is byte-for-byte what a release ships — and the checks at
 * the bottom (README.txt present, no tests, no node_modules) fail the release
 * build too rather than only a laptop.
 *
 *   node scripts/zip-extension.mjs
 *   → dist/linkedin-toolkit-extension-v<version>.zip
 */
import AdmZip from 'adm-zip';
import { readFileSync, mkdirSync, rmSync, statSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'extension');
const outDir = join(root, 'dist');

/** Never shipped: tests, dependencies, tooling, OS litter. */
const EXCLUDED_DIRS = new Set(['tests', 'node_modules', 'coverage', '.git']);
const EXCLUDED_FILES = new Set([
  '.DS_Store',
  'Thumbs.db',
  'package.json',
  'package-lock.json',
  'vitest.config.js',
  '.eslintrc.cjs',
]);

function walk(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (EXCLUDED_DIRS.has(entry)) continue;
      walk(full, found);
    } else {
      if (EXCLUDED_FILES.has(entry)) continue;
      found.push(full);
    }
  }
  return found;
}

const manifest = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8'));
const version = manifest.version;
if (!version) throw new Error('extension/manifest.json has no version');

const readme = `LinkedIn Toolkit ${version}
${'='.repeat(`LinkedIn Toolkit ${version}`.length)}

Install
-------
1. Unzip this file somewhere you will keep it. Chrome loads the extension from
   this folder every time it starts, so do not unzip it into Downloads and then
   delete it.
2. Open chrome://extensions
3. Turn on "Developer mode" (top right).
4. Click "Load unpacked" and pick the unzipped folder — the one holding
   manifest.json.
5. The toolbar icon opens the popup.

This is deliberately not on the Chrome Web Store. Store policy forbids
extensions that facilitate third-party terms-of-service violations, and an
honest reading of LinkedIn's terms puts automation of your own account in that
territory. Loading it unpacked keeps the decision, and the code you are running,
with you.

Connecting an agent
-------------------
The extension is the engine; the MCP server is how an agent reaches it.

  npx linkedin-toolkit-mcp

The first run prints a pairing token. Paste it into the popup:
Settings → Local bridge → paste the token → enable. The badge turns to
"connected".

Full setup for Claude Code, the OpenAI Agents SDK, LangChain, n8n and the rest:
https://github.com/OpenRecruiterTools/linkedin-toolkit/tree/master/docs/agents

Before you use it
-----------------
Read this part.

- Automating your LinkedIn account may breach LinkedIn's User Agreement.
  LinkedIn restricts and permanently bans accounts for it. That risk is yours,
  and no setting in here removes it. Read docs/safety.md.
- Copilot mode is on by default: every write waits in a queue for you to approve
  it. Autopilot exists; think hard before turning it on.
- Daily hard caps are enforced in the engine and cannot be raised by an agent,
  the CLI, the MCP server or a config file: 100 invitations, 150 messages,
  500 profile visits, 1,000 search results.
- Nothing leaves your machine. There is no account, no server, no telemetry.
  Your data is in Chrome's local storage and, if you run the MCP server, in a
  SQLite file in your home directory.
- Never run this against an account you cannot afford to lose while you are
  still learning what it does.

MIT licensed. Issues and pull requests:
https://github.com/OpenRecruiterTools/linkedin-toolkit
`;

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const zip = new AdmZip();
const files = walk(source).sort();
if (files.length === 0) throw new Error(`nothing to package under ${source}`);
for (const file of files) {
  const rel = relative(source, file).split(sep).join('/');
  zip.addFile(rel, readFileSync(file));
}
zip.addFile('README.txt', Buffer.from(readme, 'utf8'));

const outFile = join(outDir, `linkedin-toolkit-extension-v${version}.zip`);
zip.writeZip(outFile);

const bytes = statSync(outFile).size;
const entries = zip.getEntries().length;
console.log(`Wrote ${relative(root, outFile).split(sep).join('/')}`);
console.log(`  ${entries} entries, ${(bytes / 1024).toFixed(0)} KB`);
for (const required of ['manifest.json', 'README.txt']) {
  if (!zip.getEntry(required)) throw new Error(`${required} is missing from the zip`);
}
const shipped = zip.getEntries().map((e) => e.entryName);
const leaked = shipped.filter((name) => name.startsWith('tests/') || name.includes('node_modules/'));
if (leaked.length) throw new Error(`these should not be in the zip: ${leaked.join(', ')}`);
console.log('  manifest.json and README.txt present; no tests or node_modules.');
