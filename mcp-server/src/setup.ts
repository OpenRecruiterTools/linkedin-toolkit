/**
 * `lit setup` — everything between "I found this repo" and "my agent can use
 * it", minus the three clicks Chrome will not let anybody automate.
 *
 * The old path was: find the Releases page, download a zip, unzip it somewhere
 * you will not delete, turn on Developer mode, Load unpacked, run a server,
 * find the pairing token, paste it, then hand-write a JSON config block for
 * whichever agent you use. Seven steps, six of which a computer can do.
 *
 * This module does the six. Everything here is a small function with its
 * dependencies passed in — `fetch`, the filesystem, the clock, the
 * environment — so the whole flow is testable without a network, a Chrome, or
 * a home directory.
 *
 * What it deliberately does not do:
 *   - claim Chrome opened a page it may have ignored (see `chromeLaunch`);
 *   - write a client config file it cannot parse (a malformed file is refused,
 *     never rewritten);
 *   - install anything outside `~/.linkedin-toolkit` unless asked.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

export const REPO = 'OpenRecruiterTools/linkedin-toolkit';
export const RELEASES_URL = `https://github.com/${REPO}/releases`;

/** A setup step that failed for a reason the user can act on. */
export class SetupError extends Error {
  constructor(
    message: string,
    readonly howToFix?: string,
  ) {
    super(message);
    this.name = 'SetupError';
  }
}

/** The slice of `node:fs` this module uses, so tests can pass their own. */
export type FsLike = {
  existsSync: typeof existsSync;
  mkdirSync: typeof mkdirSync;
  readFileSync: typeof readFileSync;
  readdirSync: typeof readdirSync;
  renameSync: typeof renameSync;
  rmSync: typeof rmSync;
  writeFileSync: typeof writeFileSync;
  copyFileSync: typeof copyFileSync;
};

export const realFs: FsLike = {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  copyFileSync,
};

/* ------------------------------------------------------------------ *
 * Which zip, and where from
 * ------------------------------------------------------------------ */

/**
 * The release asset for one version.
 *
 * The release workflow names the zip from the tag, so `linkedin-toolkit-mcp`
 * 2.1.0 and `linkedin-toolkit-extension-v2.1.0.zip` are the same release by
 * construction. A version the user passed by hand may carry a leading `v`.
 */
export function extensionZipUrl(version: string): string {
  const bare = String(version).trim().replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(bare)) {
    throw new SetupError(
      `"${version}" is not a version. Pass one like 2.1.0, or leave --version off to use the installed one.`,
    );
  }
  return `${RELEASES_URL}/download/v${bare}/linkedin-toolkit-extension-v${bare}.zip`;
}

/** The API read that answers "what is the newest release, and what is in it?" */
export function latestReleaseApiUrl(): string {
  return `https://api.github.com/repos/${REPO}/releases/latest`;
}

export type Download = {
  url: string;
  version: string;
  /** `version` when the exact release existed, `latest` when we fell back. */
  source: 'version' | 'latest';
};

const ASSET = /^linkedin-toolkit-extension-v(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\.zip$/;

/**
 * Resolve the newest release's extension asset.
 *
 * `releases/latest/download/<name>` cannot be used directly because the asset
 * name carries the version, which is the thing we do not know — so the release
 * is read through the API and its asset list is matched.
 */
export async function resolveLatestRelease(fetchImpl: typeof fetch): Promise<Download> {
  let response: Response;
  try {
    response = await fetchImpl(latestReleaseApiUrl(), {
      headers: { accept: 'application/vnd.github+json' },
    });
  } catch (err) {
    throw new SetupError(
      `Could not reach GitHub to find the latest release: ${err instanceof Error ? err.message : String(err)}`,
      `Download the zip by hand from ${RELEASES_URL} and point Chrome at the unzipped folder.`,
    );
  }
  if (!response.ok) {
    throw new SetupError(
      `GitHub answered ${response.status} for the latest release.`,
      `Download the zip by hand from ${RELEASES_URL}.`,
    );
  }
  const body = (await response.json().catch(() => null)) as any;
  const assets: any[] = Array.isArray(body?.assets) ? body.assets : [];
  for (const asset of assets) {
    const match = ASSET.exec(String(asset?.name ?? ''));
    if (match && typeof asset?.browser_download_url === 'string') {
      return { url: asset.browser_download_url, version: match[1], source: 'latest' };
    }
  }
  throw new SetupError(
    'The latest release carries no linkedin-toolkit-extension zip.',
    `Look at ${RELEASES_URL} and download whichever asset is there.`,
  );
}

/**
 * Download the extension zip for `version`, falling back to the latest release.
 *
 * The fallback is the normal case on a fork, on a pre-release npm install, or
 * any time the npm package is published slightly ahead of the GitHub release —
 * and it is reported, because installing a different version than you asked
 * for should never be silent.
 */
export async function downloadExtension(options: {
  version: string;
  fetchImpl?: typeof fetch;
}): Promise<Download & { buffer: Buffer }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const wanted: Download = {
    url: extensionZipUrl(options.version),
    version: options.version.replace(/^v/, ''),
    source: 'version',
  };

  let chosen = wanted;
  let response: Response | null = null;
  try {
    response = await fetchImpl(wanted.url, { redirect: 'follow' });
  } catch {
    response = null;
  }

  if (!response || !response.ok) {
    chosen = await resolveLatestRelease(fetchImpl);
    try {
      response = await fetchImpl(chosen.url, { redirect: 'follow' });
    } catch (err) {
      throw new SetupError(
        `Could not download ${chosen.url}: ${err instanceof Error ? err.message : String(err)}`,
        `Download it by hand from ${RELEASES_URL}.`,
      );
    }
    if (!response.ok) {
      throw new SetupError(
        `GitHub answered ${response.status} for ${chosen.url}.`,
        `Download it by hand from ${RELEASES_URL}.`,
      );
    }
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return { ...chosen, buffer };
}

/* ------------------------------------------------------------------ *
 * Reading the zip
 *
 * A dependency-free reader, because the only zip it ever opens is one this
 * repo built, and because unpacking an archive from the internet is exactly
 * the place to control entry names rather than trust a library's defaults.
 * ------------------------------------------------------------------ */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

export type ZipEntry = { name: string; data: Buffer };

/** Every file in the archive, decompressed. Directory entries are dropped. */
export function readZip(buffer: Buffer): ZipEntry[] {
  if (buffer.length < 22) throw new SetupError('That download is too small to be a zip file.');

  let eocd = -1;
  const from = Math.max(0, buffer.length - 66_000);
  for (let i = buffer.length - 22; i >= from; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new SetupError('That file is not a zip archive (no end-of-archive record).');

  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];

  for (let i = 0; i < count; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new SetupError('That zip file is damaged (its directory does not line up).');
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) continue;

    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new SetupError(`That zip file is damaged (no local header for ${name}).`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(start, start + compressedSize);

    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw);
    else throw new SetupError(`${name} uses an unsupported compression method (${method}).`);

    entries.push({ name, data });
  }

  return entries;
}

/**
 * Is this a LinkedIn Toolkit extension zip?
 *
 * The failure this catches is mundane and common: GitHub served an HTML error
 * page, a proxy served a login page, or the release has no asset — and the
 * bytes get unpacked into a folder Chrome then refuses. Checking the magic
 * number and the manifest turns that into one sentence.
 */
export function validateExtensionZip(buffer: Buffer): {
  entries: ZipEntry[];
  manifestVersion: string;
  name: string;
} {
  const magic = buffer.subarray(0, 2).toString('latin1');
  if (magic !== 'PK') {
    const head = buffer.subarray(0, 40).toString('utf8').replace(/\s+/g, ' ').trim();
    throw new SetupError(
      `What downloaded is not a zip file (it starts "${head}").`,
      `That is usually an error page. Check ${RELEASES_URL} in a browser.`,
    );
  }

  const entries = readZip(buffer);
  const manifest = entries.find((entry) => entry.name === 'manifest.json');
  if (!manifest) {
    throw new SetupError(
      'That zip has no manifest.json at its top level, so Chrome could not load it.',
      `Check the asset on ${RELEASES_URL}.`,
    );
  }
  let parsed: any;
  try {
    parsed = JSON.parse(manifest.data.toString('utf8'));
  } catch {
    throw new SetupError('The manifest.json inside that zip is not valid JSON.');
  }
  if (!parsed?.version || parsed?.manifest_version !== 3) {
    throw new SetupError('The manifest.json inside that zip is not a Chrome MV3 manifest.');
  }
  return { entries, manifestVersion: String(parsed.version), name: String(parsed.name ?? 'extension') };
}

/** Reject anything that would write outside the target folder. */
export function safeEntryName(name: string): string {
  const normalized = name.replace(/\\/g, '/');
  if (
    normalized.startsWith('/') ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split('/').some((part) => part === '..')
  ) {
    throw new SetupError(`That zip contains an unsafe path (${name}); nothing was written.`);
  }
  return normalized;
}

/** Write every entry under `dir`, creating the folders it needs. */
export function unpackZipTo(entries: ZipEntry[], dir: string, fs: FsLike = realFs): number {
  fs.mkdirSync(dir, { recursive: true });
  let written = 0;
  for (const entry of entries) {
    const target = join(dir, safeEntryName(entry.name));
    fs.mkdirSync(dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.data);
    written++;
  }
  return written;
}

/**
 * Replace `target` with `staged`, keeping a working folder at all times.
 *
 * Chrome loads the extension from this folder on every start, so a half-
 * written folder is a broken extension until the user notices. The new copy is
 * unpacked beside it and only then swapped in; if the swap fails, the previous
 * copy goes back.
 */
export function swapIn(options: {
  target: string;
  staged: string;
  fs?: FsLike;
  now?: () => number;
}): { replaced: boolean } {
  const fs = options.fs ?? realFs;
  const { target, staged } = options;
  const existed = fs.existsSync(target);
  if (!existed) {
    fs.mkdirSync(dirname(target), { recursive: true });
    fs.renameSync(staged, target);
    return { replaced: false };
  }

  const parked = `${target}.old-${(options.now ?? Date.now)()}`;
  fs.renameSync(target, parked);
  try {
    fs.renameSync(staged, target);
  } catch (err) {
    fs.renameSync(parked, target);
    throw new SetupError(
      `Could not replace ${target}: ${err instanceof Error ? err.message : String(err)}`,
      'The previous copy is untouched. Close anything holding that folder open and try again.',
    );
  }
  fs.rmSync(parked, { recursive: true, force: true });
  return { replaced: true };
}

export type InstallResult = Download & {
  dir: string;
  files: number;
  replaced: boolean;
  manifestVersion: string;
};

/** Download, check, unpack, swap. The whole of step (a) in one call. */
export async function installExtension(options: {
  version: string;
  dir: string;
  fetchImpl?: typeof fetch;
  fs?: FsLike;
  now?: () => number;
}): Promise<InstallResult> {
  const fs = options.fs ?? realFs;
  const now = options.now ?? Date.now;
  const download = await downloadExtension({ version: options.version, fetchImpl: options.fetchImpl });
  const { entries, manifestVersion } = validateExtensionZip(download.buffer);

  const target = resolve(options.dir);
  const staged = `${target}.tmp-${process.pid}-${now()}`;
  fs.rmSync(staged, { recursive: true, force: true });
  let files: number;
  try {
    files = unpackZipTo(entries, staged, fs);
  } catch (err) {
    fs.rmSync(staged, { recursive: true, force: true });
    throw err;
  }
  const { replaced } = swapIn({ target, staged, fs, now });

  return {
    url: download.url,
    version: download.version,
    source: download.source,
    dir: target,
    files,
    replaced,
    manifestVersion,
  };
}

/**
 * The version of `linkedin-toolkit-mcp` that is actually running.
 *
 * The extension and the server are released together from one tag, so the
 * installed package version is the right default for which zip to fetch. This
 * reads the package's own manifest rather than a constant, so a published
 * build can never disagree with itself about what it is.
 */
export function packageVersion(
  read: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): string | null {
  try {
    const path = fileURLToPath(new URL('../package.json', import.meta.url));
    const version = JSON.parse(read(path))?.version;
    return typeof version === 'string' && version ? version : null;
  } catch {
    return null;
  }
}

/** Where the extension lives unless `--dir` says otherwise. */
export function defaultExtensionDir(home = process.env.LINKEDIN_TOOLKIT_HOME): string {
  return join(home || join(homedir(), '.linkedin-toolkit'), 'extension');
}

/* ------------------------------------------------------------------ *
 * Chrome
 * ------------------------------------------------------------------ */

export type Platform = 'win32' | 'darwin' | 'linux' | string;

export type ChromeLaunch =
  | { kind: 'spawn'; command: string; args: string[] }
  | { kind: 'none'; reason: string };

/**
 * How to ask Chrome to show `chrome://extensions`, if we can ask at all.
 *
 * Chrome ignores `chrome://` URLs handed to it on the command line in most
 * builds — it opens a new tab page instead and says nothing. So this never
 * reports success: it either asks and tells the user to type the URL if
 * nothing appeared, or it does not ask and says why. Claiming a page opened
 * when it did not is worse than not trying.
 */
export function chromeLaunch(
  platform: Platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = (path) => existsSync(path),
): ChromeLaunch {
  const url = 'chrome://extensions';
  if (platform === 'darwin') {
    return { kind: 'spawn', command: 'open', args: ['-a', 'Google Chrome', url] };
  }
  if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(
      (root): root is string => Boolean(root),
    );
    for (const root of roots) {
      const exe = join(root, 'Google', 'Chrome', 'Application', 'chrome.exe');
      if (exists(exe)) return { kind: 'spawn', command: exe, args: [url] };
    }
    return {
      kind: 'none',
      reason: 'Chrome is not in its usual place under Program Files or AppData',
    };
  }
  if (platform === 'linux') {
    for (const exe of [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
    ]) {
      if (exists(exe)) return { kind: 'spawn', command: exe, args: [url] };
    }
    return { kind: 'none', reason: 'no Chrome or Chromium binary was found on this machine' };
  }
  return { kind: 'none', reason: `this platform (${platform}) has no known Chrome location` };
}

/* ------------------------------------------------------------------ *
 * MCP client configuration
 * ------------------------------------------------------------------ */

export const CLIENTS = [
  'claude-desktop',
  'claude-code',
  'cursor',
  'windsurf',
  'vscode',
  'n8n',
  'print',
] as const;

export type ClientId = (typeof CLIENTS)[number];

export const SERVER_KEY = 'linkedin-toolkit';

/** The stdio entry every MCP client gets, in that client's spelling. */
export function serverEntry(client: ClientId): Record<string, unknown> {
  const base = { command: 'npx', args: ['-y', 'linkedin-toolkit-mcp'] };
  // VS Code's own schema wants the transport named; the rest infer stdio.
  return client === 'vscode' ? { type: 'stdio', ...base } : base;
}

export type ClientTarget = {
  id: ClientId;
  label: string;
  /** `write`: we can merge into a real file. `print`: we can only show it. */
  mode: 'write' | 'print';
  /** The config file, when there is one. */
  path?: string;
  /** The object key servers hang off: `mcpServers` everywhere but VS Code. */
  key: 'mcpServers' | 'servers';
  /** Why this one is printed rather than written, or what to do after writing. */
  note: string;
};

export type Env = {
  platform: Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
  cwd?: string;
};

/**
 * Where each client keeps its MCP config, per OS.
 *
 * Two are project-scoped by design (`.mcp.json`, `.vscode/mcp.json`) because
 * that is where those clients look first and where a user can see them; two
 * are user-scoped because the client has no project scope. n8n is printed, not
 * written: its MCP client is configured inside a workflow in the n8n UI — and
 * on the usual Docker install the config is not even on this machine — so
 * there is no file here to merge into.
 */
export function clientTarget(id: ClientId, context: Env): ClientTarget {
  const env = context.env ?? process.env;
  const home = context.home ?? homedir();
  const cwd = context.cwd ?? process.cwd();

  switch (id) {
    case 'claude-code':
      return {
        id,
        label: 'Claude Code',
        mode: 'write',
        path: join(cwd, '.mcp.json'),
        key: 'mcpServers',
        note: 'Project-scoped. Claude Code asks you to approve the server the first time you open this folder.',
      };
    case 'claude-desktop': {
      const path =
        context.platform === 'win32'
          ? join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')
          : context.platform === 'darwin'
            ? join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
            : join(env.XDG_CONFIG_HOME || join(home, '.config'), 'Claude', 'claude_desktop_config.json');
      return {
        id,
        label: 'Claude Desktop',
        mode: 'write',
        path,
        key: 'mcpServers',
        note: 'Quit and reopen Claude Desktop afterwards — a window reload is not enough.',
      };
    }
    case 'cursor':
      return {
        id,
        label: 'Cursor',
        mode: 'write',
        path: join(home, '.cursor', 'mcp.json'),
        key: 'mcpServers',
        note: 'User-scoped, so every project gets it. For one project only, put the same block in .cursor/mcp.json.',
      };
    case 'windsurf':
      return {
        id,
        label: 'Windsurf',
        mode: 'write',
        path: join(home, '.codeium', 'windsurf', 'mcp_config.json'),
        key: 'mcpServers',
        note: 'Settings → Cascade → MCP Servers → Refresh picks it up without restarting.',
      };
    case 'vscode':
      return {
        id,
        label: 'VS Code',
        mode: 'write',
        path: join(cwd, '.vscode', 'mcp.json'),
        key: 'servers',
        note: 'Workspace-scoped. VS Code shows a Start button above the server entry; agent mode then lists the tools.',
      };
    case 'n8n':
      return {
        id,
        label: 'n8n',
        mode: 'print',
        key: 'mcpServers',
        note:
          'n8n has no MCP config file: the MCP Client Tool node is configured inside a workflow, and a Docker ' +
          'install cannot see this machine\'s filesystem anyway. Use the command below in the node, or point it ' +
          'at `lit serve --http`. See docs/agents/n8n.md.',
      };
    case 'print':
    default:
      return {
        id: 'print',
        label: 'any MCP client',
        mode: 'print',
        key: 'mcpServers',
        note: 'Paste this into your client\'s MCP config. docs/clients.md has the file path for each one.',
      };
  }
}

/** The snippet a print-only client gets. */
export function configSnippet(client: ClientId): string {
  const target = clientTarget(client, { platform: process.platform });
  return `${JSON.stringify({ [target.key]: { [SERVER_KEY]: serverEntry(client) } }, null, 2)}\n`;
}

export type MergeResult = {
  /** The file to write, already serialised. */
  contents: string;
  /** False when the file already said exactly this. */
  changed: boolean;
  /** Other servers that were in the file and are still in it. */
  kept: string[];
};

/**
 * Merge our entry into an existing client config without touching anything else.
 *
 * A config file people have edited by hand is not ours to rewrite. Anything we
 * cannot parse — malformed JSON, a top level that is not an object, a
 * `mcpServers` that is not an object — is refused with the path, so the user
 * fixes their file rather than losing it to us.
 */
export function mergeMcpConfig(options: {
  existing: string | null;
  key: 'mcpServers' | 'servers';
  name?: string;
  entry: Record<string, unknown>;
  path?: string;
}): MergeResult {
  const { existing, key, entry } = options;
  const name = options.name ?? SERVER_KEY;
  const where = options.path ? ` in ${options.path}` : '';

  let root: Record<string, unknown> = {};
  if (existing !== null && existing.trim() !== '') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(existing);
    } catch (err) {
      throw new SetupError(
        `The config file${where} is not valid JSON, so it was left alone: ${
          err instanceof Error ? err.message : String(err)
        }`,
        'Fix the file (or move it aside) and run the command again. Nothing was written.',
      );
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new SetupError(
        `The config file${where} does not hold a JSON object, so it was left alone.`,
        'Fix the file (or move it aside) and run the command again. Nothing was written.',
      );
    }
    root = parsed as Record<string, unknown>;
  }

  const current = root[key];
  if (current !== undefined && (current === null || typeof current !== 'object' || Array.isArray(current))) {
    throw new SetupError(
      `"${key}"${where} is not a JSON object, so the file was left alone.`,
      'Fix the file (or move it aside) and run the command again. Nothing was written.',
    );
  }

  const servers = { ...((current as Record<string, unknown>) ?? {}) };
  const kept = Object.keys(servers).filter((server) => server !== name);
  const changed = JSON.stringify(servers[name] ?? null) !== JSON.stringify(entry);
  servers[name] = entry;

  return {
    contents: `${JSON.stringify({ ...root, [key]: servers }, null, 2)}\n`,
    changed,
    kept,
  };
}

/** `2026-09-18T14-22-05Z`, so backups sort and never collide on a retry. */
export function backupStamp(at: number): string {
  return new Date(at).toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
}

export type WriteOutcome = {
  path: string;
  /** What happened: nothing needed, written, or would have been written. */
  action: 'unchanged' | 'written' | 'dry-run';
  backup?: string;
  kept: string[];
  created: boolean;
};

/**
 * Write (or pretend to write) one client's config.
 *
 * The original is copied to `<file>.bak-<timestamp>` before it is replaced —
 * this is somebody's editor config, and a merge bug should cost them a rename,
 * not their other MCP servers.
 */
export function writeClientConfig(options: {
  target: ClientTarget;
  entry: Record<string, unknown>;
  dryRun?: boolean;
  fs?: FsLike;
  now?: () => number;
}): WriteOutcome {
  const fs = options.fs ?? realFs;
  const now = options.now ?? Date.now;
  const { target } = options;
  if (!target.path) throw new SetupError(`${target.label} has no config file to write.`);

  const existed = fs.existsSync(target.path);
  const existing = existed ? fs.readFileSync(target.path, 'utf8').toString() : null;
  const merged = mergeMcpConfig({
    existing,
    key: target.key,
    entry: options.entry,
    path: target.path,
  });

  if (options.dryRun) {
    return { path: target.path, action: 'dry-run', kept: merged.kept, created: !existed };
  }
  if (!merged.changed && existed) {
    return { path: target.path, action: 'unchanged', kept: merged.kept, created: false };
  }

  let backup: string | undefined;
  if (existed) {
    backup = `${target.path}.bak-${backupStamp(now())}`;
    fs.copyFileSync(target.path, backup);
  }
  fs.mkdirSync(dirname(target.path), { recursive: true });
  fs.writeFileSync(target.path, merged.contents, 'utf8');
  return { path: target.path, action: 'written', backup, kept: merged.kept, created: !existed };
}

/* ------------------------------------------------------------------ *
 * Words
 * ------------------------------------------------------------------ */

/** The three things Chrome will not let any installer do for you. */
export function chromeSteps(dir: string): string[] {
  return [
    '  1. Open  chrome://extensions  (type it in the address bar — it does not come up in search).',
    '  2. Turn on "Developer mode", top right.',
    `  3. Click "Load unpacked" and choose this exact folder:\n\n       ${dir}\n`,
  ];
}

/** What `lit setup` says when the extension never paired. */
export function pairingTimeoutMessage(seconds: number): string {
  return [
    `Not paired after ${seconds}s — the extension has not connected to this server.`,
    '',
    'That is normal if you have not finished the three Chrome steps above yet; nothing is lost.',
    'When you have loaded the extension:',
    '',
    '  1. Run:  lit serve --http',
    '  2. Open the toolkit popup → Settings → Local bridge, paste the pairing token, enable it.',
    '  3. Check it:  lit status',
  ].join('\n');
}
