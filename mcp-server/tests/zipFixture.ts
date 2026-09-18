/**
 * A zip writer, for tests only.
 *
 * `lit setup` downloads an archive from the internet and unpacks it into a
 * folder Chrome will load on every start, so the reader that opens it is worth
 * testing against real bytes rather than a mock. This builds those bytes: real
 * local headers, a real central directory, both compression methods the
 * release zip uses, and — on request — the shapes an attacker or a broken
 * mirror would send.
 */
import { deflateRawSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export type ZipFile = { name: string; content: string | Buffer; store?: boolean };

export function makeZip(files: ZipFile[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const raw = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf8');
    const method = file.store ? 0 : 8;
    const body = method === 0 ? raw : deflateRawSync(raw);
    const crc = crc32(raw);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locals.push(local, body);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);

    offset += local.length + body.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, directory, end]);
}

/** The manifest a real extension zip carries at its top level. */
export function manifest(version = '2.0.4'): string {
  return JSON.stringify({ manifest_version: 3, name: 'LinkedIn Toolkit', version }, null, 2);
}

/** A believable extension zip. */
export function extensionZip(version = '2.0.4'): Buffer {
  return makeZip([
    { name: 'manifest.json', content: manifest(version) },
    { name: 'README.txt', content: `LinkedIn Toolkit ${version}\n`, store: true },
    { name: 'src/background/index.js', content: 'export const hello = 1;\n' },
    { name: 'popup/popup.html', content: '<!doctype html><title>Toolkit</title>\n' },
  ]);
}
