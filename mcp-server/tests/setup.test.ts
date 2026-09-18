/**
 * `lit setup` — the parts that touch the network, the disk and other people's
 * config files. Nothing here reaches the internet: `fetch` is injected, and
 * every write goes to a temporary directory.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  backupStamp,
  chromeLaunch,
  clientTarget,
  configSnippet,
  downloadExtension,
  extensionZipUrl,
  installExtension,
  latestReleaseApiUrl,
  mergeMcpConfig,
  packageVersion,
  pairingTimeoutMessage,
  readZip,
  resolveLatestRelease,
  safeEntryName,
  serverEntry,
  SetupError,
  swapIn,
  unpackZipTo,
  validateExtensionZip,
  writeClientConfig,
  type ClientTarget,
} from '../src/setup.js';
import { extensionZip, makeZip, manifest } from './zipFixture.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lit-setup-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A `fetch` that answers from a table and records what it was asked for. */
function fakeFetch(
  routes: Record<string, { status?: number; body?: Buffer | object }>,
): typeof fetch & { calls: string[] } {
  const calls: string[] = [];
  const impl = (async (input: any) => {
    const url = String(input);
    calls.push(url);
    const route = routes[url];
    if (!route) return { ok: false, status: 404, json: async () => null } as unknown as Response;
    const status = route.status ?? 200;
    const body = route.body;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => (Buffer.isBuffer(body) ? null : body),
      arrayBuffer: async () =>
        Buffer.isBuffer(body) ? body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) : new ArrayBuffer(0),
    } as unknown as Response;
  }) as typeof fetch & { calls: string[] };
  impl.calls = calls;
  return impl;
}

const latestJson = (version: string) => ({
  tag_name: `v${version}`,
  assets: [
    { name: 'source.tar.gz', browser_download_url: 'https://example.invalid/source.tar.gz' },
    {
      name: `linkedin-toolkit-extension-v${version}.zip`,
      browser_download_url: `https://cdn.invalid/linkedin-toolkit-extension-v${version}.zip`,
    },
  ],
});

/* ------------------------------------------------------------------ */

describe('version to URL', () => {
  it('points at the release asset named for that version', () => {
    expect(extensionZipUrl('2.1.0')).toBe(
      'https://github.com/OpenRecruiterTools/linkedin-toolkit/releases/download/v2.1.0/linkedin-toolkit-extension-v2.1.0.zip',
    );
  });

  it('tolerates a leading v without doubling it', () => {
    expect(extensionZipUrl('v2.1.0')).toContain('/download/v2.1.0/linkedin-toolkit-extension-v2.1.0.zip');
  });

  it('accepts a prerelease version', () => {
    expect(extensionZipUrl('2.1.0-rc.1')).toContain('linkedin-toolkit-extension-v2.1.0-rc.1.zip');
  });

  it('refuses something that is not a version', () => {
    expect(() => extensionZipUrl('latest')).toThrow(SetupError);
    expect(() => extensionZipUrl('main')).toThrow(/not a version/);
  });

  it('reads the installed package version rather than a constant', () => {
    expect(packageVersion()).toMatch(/^\d+\.\d+\.\d+/);
    expect(packageVersion(() => '{"version":"9.9.9"}')).toBe('9.9.9');
    expect(packageVersion(() => 'not json')).toBeNull();
  });
});

describe('falling back to the latest release', () => {
  it('reads the asset list and picks the extension zip', async () => {
    const fetchImpl = fakeFetch({ [latestReleaseApiUrl()]: { body: latestJson('2.0.4') } });
    const resolved = await resolveLatestRelease(fetchImpl);
    expect(resolved).toEqual({
      url: 'https://cdn.invalid/linkedin-toolkit-extension-v2.0.4.zip',
      version: '2.0.4',
      source: 'latest',
    });
  });

  it('says so plainly when the latest release has no extension zip', async () => {
    const fetchImpl = fakeFetch({ [latestReleaseApiUrl()]: { body: { assets: [] } } });
    await expect(resolveLatestRelease(fetchImpl)).rejects.toThrow(/no linkedin-toolkit-extension zip/);
  });

  it('downloads the exact version when that release exists', async () => {
    const zip = extensionZip('2.1.0');
    const fetchImpl = fakeFetch({ [extensionZipUrl('2.1.0')]: { body: zip } });
    const download = await downloadExtension({ version: '2.1.0', fetchImpl });
    expect(download.source).toBe('version');
    expect(download.version).toBe('2.1.0');
    expect(fetchImpl.calls).toEqual([extensionZipUrl('2.1.0')]);
  });

  it('falls back to the latest release when that version was never released', async () => {
    const zip = extensionZip('2.0.4');
    const fetchImpl = fakeFetch({
      [extensionZipUrl('2.1.0')]: { status: 404 },
      [latestReleaseApiUrl()]: { body: latestJson('2.0.4') },
      'https://cdn.invalid/linkedin-toolkit-extension-v2.0.4.zip': { body: zip },
    });
    const download = await downloadExtension({ version: '2.1.0', fetchImpl });
    expect(download.source).toBe('latest');
    expect(download.version).toBe('2.0.4');
    expect(fetchImpl.calls[0]).toBe(extensionZipUrl('2.1.0'));
    expect(fetchImpl.calls[1]).toBe(latestReleaseApiUrl());
  });

  it('falls back when the network throws rather than answering', async () => {
    const calls: string[] = [];
    const zip = extensionZip('2.0.4');
    const fetchImpl = (async (input: any) => {
      const url = String(input);
      calls.push(url);
      if (url === extensionZipUrl('2.1.0')) throw new Error('ENOTFOUND');
      if (url === latestReleaseApiUrl()) {
        return { ok: true, status: 200, json: async () => latestJson('2.0.4') } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength),
      } as unknown as Response;
    }) as typeof fetch;
    const download = await downloadExtension({ version: '2.1.0', fetchImpl });
    expect(download.source).toBe('latest');
    expect(calls).toHaveLength(3);
  });
});

describe('zip validation', () => {
  it('reads every entry, stored or deflated', () => {
    const entries = readZip(extensionZip('2.0.4'));
    expect(entries.map((entry) => entry.name).sort()).toEqual([
      'README.txt',
      'manifest.json',
      'popup/popup.html',
      'src/background/index.js',
    ]);
    expect(entries.find((entry) => entry.name === 'README.txt')!.data.toString()).toContain('2.0.4');
  });

  it('accepts a real extension zip and reports the manifest version', () => {
    const checked = validateExtensionZip(extensionZip('2.0.4'));
    expect(checked.manifestVersion).toBe('2.0.4');
    expect(checked.entries).toHaveLength(4);
  });

  it('rejects an HTML error page, and quotes it back', () => {
    const html = Buffer.from('<!DOCTYPE html><html><title>Not Found</title>');
    expect(() => validateExtensionZip(html)).toThrow(/not a zip file/);
    expect(() => validateExtensionZip(html)).toThrow(/DOCTYPE/);
  });

  it('rejects a zip with no manifest.json at the top level', () => {
    const zip = makeZip([{ name: 'nested/manifest.json', content: manifest() }]);
    expect(() => validateExtensionZip(zip)).toThrow(/no manifest.json/);
  });

  it('rejects a manifest that is not MV3', () => {
    const zip = makeZip([
      { name: 'manifest.json', content: JSON.stringify({ manifest_version: 2, version: '1.0' }) },
    ]);
    expect(() => validateExtensionZip(zip)).toThrow(/not a Chrome MV3 manifest/);
  });

  it('rejects a manifest that is not JSON', () => {
    const zip = makeZip([{ name: 'manifest.json', content: '{ broken' }]);
    expect(() => validateExtensionZip(zip)).toThrow(/not valid JSON/);
  });

  it('refuses entry names that would escape the target folder', () => {
    expect(safeEntryName('src/a.js')).toBe('src/a.js');
    expect(() => safeEntryName('../../evil.js')).toThrow(/unsafe path/);
    expect(() => safeEntryName('/etc/passwd')).toThrow(/unsafe path/);
    expect(() => safeEntryName('C:\\Windows\\evil.js')).toThrow(/unsafe path/);
  });
});

describe('unpacking and the safe swap', () => {
  it('writes every entry, folders and all', () => {
    const target = join(dir, 'extension');
    const written = unpackZipTo(readZip(extensionZip()), target);
    expect(written).toBe(4);
    expect(readFileSync(join(target, 'src', 'background', 'index.js'), 'utf8')).toContain('hello');
  });

  it('moves a staged folder into place when nothing is there yet', () => {
    const staged = join(dir, 'staged');
    mkdirSync(staged, { recursive: true });
    writeFileSync(join(staged, 'manifest.json'), manifest());
    const result = swapIn({ target: join(dir, 'extension'), staged });
    expect(result.replaced).toBe(false);
    expect(existsSync(join(dir, 'extension', 'manifest.json'))).toBe(true);
  });

  it('replaces an existing copy and leaves no leftovers', () => {
    const target = join(dir, 'extension');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'old.js'), 'old');
    const staged = join(dir, 'staged');
    mkdirSync(staged, { recursive: true });
    writeFileSync(join(staged, 'new.js'), 'new');

    const result = swapIn({ target, staged, now: () => 1_700_000_000_000 });
    expect(result.replaced).toBe(true);
    expect(readdirSync(target)).toEqual(['new.js']);
    expect(readdirSync(dir)).toEqual(['extension']);
  });

  it('puts the old copy back when the swap fails, so the extension keeps working', () => {
    const target = join(dir, 'extension');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'old.js'), 'old');

    const real = { existsSync, mkdirSync, renameSync, rmSync };
    let renames = 0;
    const fs = {
      ...real,
      renameSync: (from: string, to: string) => {
        renames++;
        // The first rename parks the old copy; the second is the one that fails.
        if (renames === 2) throw new Error('EBUSY');
        real.renameSync(from, to);
      },
    };

    expect(() =>
      swapIn({ target, staged: join(dir, 'staged'), fs: fs as never, now: () => 1 }),
    ).toThrow(/Could not replace/);
    expect(readFileSync(join(target, 'old.js'), 'utf8')).toBe('old');
  });

  it('installs end to end from a downloaded zip', async () => {
    const fetchImpl = fakeFetch({ [extensionZipUrl('2.0.4')]: { body: extensionZip('2.0.4') } });
    const target = join(dir, 'extension');
    const first = await installExtension({ version: '2.0.4', dir: target, fetchImpl });
    expect(first.replaced).toBe(false);
    expect(first.files).toBe(4);

    // Idempotent: running it again replaces the folder and leaves one copy.
    const second = await installExtension({ version: '2.0.4', dir: target, fetchImpl });
    expect(second.replaced).toBe(true);
    expect(readdirSync(dir)).toEqual(['extension']);
    expect(existsSync(join(target, 'manifest.json'))).toBe(true);
  });

  it('leaves nothing behind when the download is not an extension', async () => {
    const fetchImpl = fakeFetch({
      [extensionZipUrl('2.0.4')]: { body: Buffer.from('<html>nope</html>') },
    });
    await expect(
      installExtension({ version: '2.0.4', dir: join(dir, 'extension'), fetchImpl }),
    ).rejects.toThrow(/not a zip file/);
    expect(readdirSync(dir)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */

describe('client config paths', () => {
  const home = '/home/dom';
  const cwd = '/work/project';

  it('puts Claude Code in the project .mcp.json', () => {
    const target = clientTarget('claude-code', { platform: 'linux', home, cwd });
    expect(target.path).toBe(join(cwd, '.mcp.json'));
    expect(target.key).toBe('mcpServers');
  });

  it('knows where Claude Desktop keeps its config on each OS', () => {
    expect(clientTarget('claude-desktop', { platform: 'darwin', home }).path).toBe(
      join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    );
    expect(
      clientTarget('claude-desktop', {
        platform: 'win32',
        home,
        env: { APPDATA: 'C:\\Users\\dom\\AppData\\Roaming' },
      }).path,
    ).toBe(join('C:\\Users\\dom\\AppData\\Roaming', 'Claude', 'claude_desktop_config.json'));
    expect(clientTarget('claude-desktop', { platform: 'linux', home, env: {} }).path).toBe(
      join(home, '.config', 'Claude', 'claude_desktop_config.json'),
    );
  });

  it('uses the user-wide files for Cursor and Windsurf', () => {
    expect(clientTarget('cursor', { platform: 'linux', home }).path).toBe(
      join(home, '.cursor', 'mcp.json'),
    );
    expect(clientTarget('windsurf', { platform: 'linux', home }).path).toBe(
      join(home, '.codeium', 'windsurf', 'mcp_config.json'),
    );
  });

  it('uses VS Code\'s workspace file, its "servers" key and its stdio type', () => {
    const target = clientTarget('vscode', { platform: 'linux', home, cwd });
    expect(target.path).toBe(join(cwd, '.vscode', 'mcp.json'));
    expect(target.key).toBe('servers');
    expect(serverEntry('vscode')).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'linkedin-toolkit-mcp'],
    });
  });

  it('prints for n8n rather than writing, and says why', () => {
    const target = clientTarget('n8n', { platform: 'linux', home });
    expect(target.mode).toBe('print');
    expect(target.path).toBeUndefined();
    expect(target.note).toMatch(/no MCP config file/);
  });

  it('prints a generic snippet for anything else', () => {
    expect(configSnippet('print')).toContain('"linkedin-toolkit"');
    expect(configSnippet('print')).toContain('"mcpServers"');
  });
});

describe('merging into an existing config', () => {
  const entry = serverEntry('claude-code');

  it('creates the file contents from nothing', () => {
    const merged = mergeMcpConfig({ existing: null, key: 'mcpServers', entry });
    expect(JSON.parse(merged.contents)).toEqual({
      mcpServers: { 'linkedin-toolkit': entry },
    });
    expect(merged.changed).toBe(true);
    expect(merged.kept).toEqual([]);
  });

  it('keeps every other server, and everything outside mcpServers', () => {
    const existing = JSON.stringify({
      $schema: 'https://example.invalid/schema.json',
      mcpServers: {
        github: { command: 'docker', args: ['run', 'ghcr.io/github/github-mcp-server'] },
        filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
      },
      theme: 'dark',
    });
    const merged = mergeMcpConfig({ existing, key: 'mcpServers', entry });
    const parsed = JSON.parse(merged.contents);
    expect(Object.keys(parsed.mcpServers).sort()).toEqual(['filesystem', 'github', 'linkedin-toolkit']);
    expect(parsed.mcpServers.github.command).toBe('docker');
    expect(parsed.theme).toBe('dark');
    expect(parsed.$schema).toBe('https://example.invalid/schema.json');
    expect(merged.kept.sort()).toEqual(['filesystem', 'github']);
  });

  it('is a no-op the second time', () => {
    const first = mergeMcpConfig({ existing: null, key: 'mcpServers', entry });
    const second = mergeMcpConfig({ existing: first.contents, key: 'mcpServers', entry });
    expect(second.changed).toBe(false);
    expect(second.contents).toBe(first.contents);
  });

  it('replaces an older entry of ours without disturbing the neighbours', () => {
    const existing = JSON.stringify({
      mcpServers: {
        'linkedin-toolkit': { command: 'node', args: ['/old/path/server.js'] },
        github: { command: 'docker' },
      },
    });
    const merged = mergeMcpConfig({ existing, key: 'mcpServers', entry });
    const parsed = JSON.parse(merged.contents);
    expect(merged.changed).toBe(true);
    expect(parsed.mcpServers['linkedin-toolkit']).toEqual(entry);
    expect(parsed.mcpServers.github).toEqual({ command: 'docker' });
  });

  it('merges into VS Code\'s "servers" key', () => {
    const existing = JSON.stringify({ servers: { other: { type: 'stdio', command: 'x' } } });
    const merged = mergeMcpConfig({ existing, key: 'servers', entry: serverEntry('vscode') });
    const parsed = JSON.parse(merged.contents);
    expect(Object.keys(parsed.servers).sort()).toEqual(['linkedin-toolkit', 'other']);
    expect(parsed.servers['linkedin-toolkit'].type).toBe('stdio');
  });

  it('refuses malformed JSON instead of overwriting it', () => {
    expect(() =>
      mergeMcpConfig({ existing: '{ "mcpServers": ', key: 'mcpServers', entry, path: '/tmp/x.json' }),
    ).toThrow(/not valid JSON/);
    expect(() =>
      mergeMcpConfig({ existing: '{ "mcpServers": ', key: 'mcpServers', entry, path: '/tmp/x.json' }),
    ).toThrow(/\/tmp\/x.json/);
  });

  it('refuses a top level that is not an object', () => {
    expect(() => mergeMcpConfig({ existing: '[1,2,3]', key: 'mcpServers', entry })).toThrow(
      /does not hold a JSON object/,
    );
  });

  it('refuses an mcpServers that is not an object', () => {
    expect(() =>
      mergeMcpConfig({ existing: '{"mcpServers": "yes please"}', key: 'mcpServers', entry }),
    ).toThrow(/is not a JSON object/);
  });

  it('treats an empty file as a new one', () => {
    const merged = mergeMcpConfig({ existing: '   \n', key: 'mcpServers', entry });
    expect(JSON.parse(merged.contents).mcpServers['linkedin-toolkit']).toEqual(entry);
  });
});

describe('writing a client config', () => {
  function target(path: string): ClientTarget {
    return { id: 'claude-code', label: 'Claude Code', mode: 'write', path, key: 'mcpServers', note: '' };
  }
  const entry = serverEntry('claude-code');

  it('creates the file and the folder it lives in', () => {
    const path = join(dir, 'nested', '.mcp.json');
    const outcome = writeClientConfig({ target: target(path), entry });
    expect(outcome.action).toBe('written');
    expect(outcome.created).toBe(true);
    expect(outcome.backup).toBeUndefined();
    expect(JSON.parse(readFileSync(path, 'utf8')).mcpServers['linkedin-toolkit']).toEqual(entry);
  });

  it('backs the old file up before replacing it', () => {
    const path = join(dir, '.mcp.json');
    writeFileSync(path, JSON.stringify({ mcpServers: { github: { command: 'docker' } } }));
    const outcome = writeClientConfig({
      target: target(path),
      entry,
      now: () => Date.parse('2026-09-18T14:22:05.123Z'),
    });
    expect(outcome.backup).toBe(`${path}.bak-2026-09-18T14-22-05Z`);
    expect(JSON.parse(readFileSync(outcome.backup!, 'utf8')).mcpServers.github).toEqual({
      command: 'docker',
    });
    expect(outcome.kept).toEqual(['github']);
  });

  it('does nothing, and makes no backup, when it is already configured', () => {
    const path = join(dir, '.mcp.json');
    writeClientConfig({ target: target(path), entry });
    const again = writeClientConfig({ target: target(path), entry });
    expect(again.action).toBe('unchanged');
    expect(readdirSync(dir)).toEqual(['.mcp.json']);
  });

  it('writes nothing at all in a dry run', () => {
    const path = join(dir, '.mcp.json');
    const outcome = writeClientConfig({ target: target(path), entry, dryRun: true });
    expect(outcome.action).toBe('dry-run');
    expect(existsSync(path)).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('leaves a malformed file exactly as it found it', () => {
    const path = join(dir, '.mcp.json');
    writeFileSync(path, '{ this is not json');
    expect(() => writeClientConfig({ target: target(path), entry })).toThrow(/not valid JSON/);
    expect(readFileSync(path, 'utf8')).toBe('{ this is not json');
    expect(readdirSync(dir)).toEqual(['.mcp.json']);
  });

  it('stamps backups so two runs a second apart do not collide', () => {
    expect(backupStamp(Date.parse('2026-09-18T14:22:05.000Z'))).toBe('2026-09-18T14-22-05Z');
    expect(backupStamp(Date.parse('2026-09-18T14:22:06.000Z'))).toBe('2026-09-18T14-22-06Z');
  });
});

describe('opening chrome://extensions', () => {
  it('uses `open -a` on macOS', () => {
    expect(chromeLaunch('darwin', {}, () => false)).toEqual({
      kind: 'spawn',
      command: 'open',
      args: ['-a', 'Google Chrome', 'chrome://extensions'],
    });
  });

  it('finds Chrome under Program Files on Windows', () => {
    const plan = chromeLaunch('win32', { PROGRAMFILES: 'C:\\Program Files' }, (path) =>
      path.includes('Program Files'),
    );
    expect(plan).toMatchObject({ kind: 'spawn', args: ['chrome://extensions'] });
  });

  it('declines, with a reason, when Chrome is nowhere to be found', () => {
    expect(chromeLaunch('win32', {}, () => false)).toMatchObject({ kind: 'none' });
    expect(chromeLaunch('linux', {}, () => false)).toMatchObject({
      kind: 'none',
      reason: expect.stringContaining('no Chrome or Chromium binary'),
    });
    expect(chromeLaunch('aix', {}, () => false)).toMatchObject({ kind: 'none' });
  });
});

describe('pairing timeout', () => {
  it('says what to do next rather than only that it failed', () => {
    const message = pairingTimeoutMessage(90);
    expect(message).toContain('Not paired after 90s');
    expect(message).toContain('lit serve --http');
    expect(message).toContain('lit status');
    expect(message).toMatch(/nothing is lost/);
  });
});
