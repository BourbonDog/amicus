// tests/helpers/zip-fixture.js
'use strict';

/**
 * A minimal ZIP WRITER, so the custody suite can build archives that carry
 * shapes this machine cannot produce.
 *
 * WHY HAND-BUILT RATHER THAN `Compress-Archive` / `zip`. Three of the shapes
 * that matter are unreachable through a real archiver here:
 *   - a SYMLINK entry (`0o120000` in the external attributes' high word), which
 *     is what every darwin `.app` bundle is full of and which Windows cannot
 *     even create without Developer Mode;
 *   - a symlink whose target ESCAPES the extraction root, which no archiver
 *     will produce on purpose;
 *   - an entry NAME that yauzl's `validateFileName` refuses (`../`, `/etc/x`,
 *     `C:\x`), which every archiver normalises away.
 * The alternative — checking a binary fixture into the repo — hides those bytes
 * from review. This builds them in front of the reader, in ~40 lines.
 *
 * Deliberately store-only (`method 0`): the deflate path is covered by the real
 * `Compress-Archive` archive `realZip()` makes and, in the custody suite, by the
 * measured comparison against `extract-zip` over the real 138 MiB electron
 * artifact. Nothing here needs a compressor.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

/** `versionMadeBy` high byte 3 = unix, so the high word of externalFileAttributes is a st_mode. */
const MADE_BY_UNIX = 0x0314;
/** External-attribute helpers: what `(externalFileAttributes >> 16) & 0xFFFF` must decode to. */
const MODE_FILE = 0o100644;
const MODE_DIR = 0o040755;
const MODE_SYMLINK = 0o120777;

/**
 * Build a zip from `entries`.
 * @param {Array<{name:string, body?:string, mode?:number}>} entries
 *   `mode` is a full st_mode (use MODE_FILE / MODE_DIR / MODE_SYMLINK).
 *   For a symlink, `body` is the link TARGET.
 * @returns {Buffer}
 */
function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.from(e.body === undefined ? '' : e.body, 'utf8');
    const crc = zlib.crc32(data) >>> 0;
    const mode = e.mode === undefined ? MODE_FILE : e.mode;
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(data.length, 18);
    lfh.writeUInt32LE(data.length, 22);
    lfh.writeUInt16LE(name.length, 26);
    const local = Buffer.concat([lfh, name, data]);
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(MADE_BY_UNIX, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(data.length, 20);
    cdh.writeUInt32LE(data.length, 24);
    cdh.writeUInt16LE(name.length, 28);
    cdh.writeUInt32LE((mode << 16) >>> 0, 38);
    cdh.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([cdh, name]));
    locals.push(local);
    offset += local.length;
  }
  const central = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, eocd]);
}

/** Write `bytes` to a fresh temp file and return its path. */
function zipFile(bytes, name = 'fixture.zip') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-zipfix-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, bytes);
  return file;
}

/**
 * A REAL, DEFLATED archive built by the platform's own archiver, so at least one
 * case in the suite is not reading bytes this file wrote. Returns null where no
 * archiver is available, so the caller can skip rather than fail.
 * @returns {Buffer|null}
 */
function realZip(files = { 'a.txt': 'hello from a\n', 'sub/b.txt': 'nested\n' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-realzip-'));
  const src = path.join(dir, 'src');
  for (const [name, body] of Object.entries(files)) {
    const dest = path.join(src, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, body);
  }
  const out = path.join(dir, 'real.zip');
  try {
    if (process.platform === 'win32') {
      execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
        `$ProgressPreference='SilentlyContinue'; Compress-Archive -Path ${JSON.stringify(path.join(src, '*'))} -DestinationPath ${JSON.stringify(out)} -Force`],
      { stdio: 'ignore' });
    } else {
      execFileSync('zip', ['-q', '-r', out, '.'], { cwd: src, stdio: 'ignore' });
    }
    return fs.readFileSync(out);
  } catch {
    return null;
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* litter */ }
  }
}

module.exports = { buildZip, zipFile, realZip, MODE_FILE, MODE_DIR, MODE_SYMLINK };
