'use strict';

/**
 * #258 — `config.js :: saveConfig` writes config.json atomically (temp + rename
 * through `utils/atomic-write.js :: writeFileAtomic`), and every Notice line it
 * would print is BUFFERED until the rename lands.
 *
 * Two defects, one function. (1) The plain truncate-and-write meant a crash or
 * SIGKILL between the truncate and the write left the user's whole config —
 * aliases, default, council, routing — empty or partial. (2) The
 * invalid-alias removals and the #238 D6 "now following" conversions printed
 * BEFORE the write, so a failed write announced conversions that never reached
 * disk.
 *
 * The file's bytes and the requested mode are pinned here too: atomic is a
 * change of HOW the bytes land, never of WHAT lands.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('saveConfig atomic write + deferred Notices (#258)', () => {
  let dir;
  let configPath;
  let prevConfigDir;
  let config;
  let notices;

  /** The exact bytes `saveConfig` has always produced for FIXTURE (frozen, pre-change). */
  const FROZEN =
    '{\n  "default": "mine",\n  "aliases": {\n    "mine": "openrouter/acme/model-1.0"\n  }\n}';
  const FIXTURE = () => ({ default: 'mine', aliases: { mine: 'openrouter/acme/model-1.0' } });

  /** Temp files writeFileAtomic may have left in the config dir. */
  const tempFiles = () => fs.readdirSync(dir).filter((n) => n.includes('.tmp'));

  /**
   * Record each stderr line together with the config file's content AT THAT
   * MOMENT — that pairing is what proves a Notice printed after the rename.
   */
  function spyStderr() {
    return jest.spyOn(process.stderr, 'write').mockImplementation((line) => {
      notices.push({
        line: String(line),
        onDisk: fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf-8') : null,
      });
      return true;
    });
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-cfg-atomic-'));
    prevConfigDir = process.env.AMICUS_CONFIG_DIR;
    process.env.AMICUS_CONFIG_DIR = dir;
    configPath = path.join(dir, 'config.json');
    notices = [];
    jest.resetModules();
    config = require('../../src/utils/config');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (prevConfigDir === undefined) { delete process.env.AMICUS_CONFIG_DIR; }
    else { process.env.AMICUS_CONFIG_DIR = prevConfigDir; }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes through a temp file carrying mode 0o600 and renames it onto config.json', () => {
    const realWrite = fs.writeFileSync;
    const realRename = fs.renameSync;
    const writes = [];
    const renames = [];
    jest.spyOn(fs, 'writeFileSync').mockImplementation((p, data, opts) => {
      writes.push({ path: String(p), opts });
      return realWrite(p, data, opts);
    });
    jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      renames.push({ from: String(from), to: String(to) });
      return realRename(from, to);
    });
    spyStderr();

    config.saveConfig(FIXTURE());

    expect(writes).toHaveLength(1);
    expect(writes[0].path).not.toBe(configPath);           // the temp, never the target
    expect(path.dirname(writes[0].path)).toBe(dir);        // same dir => same filesystem
    expect(writes[0].opts).toEqual({ mode: 0o600 });
    expect(renames).toEqual([{ from: writes[0].path, to: configPath }]);
  });

  it('produces byte-identical content to the pre-change write and leaves no temp behind', () => {
    spyStderr();

    config.saveConfig(FIXTURE());

    expect(fs.readFileSync(configPath, 'utf-8')).toBe(FROZEN);
    expect(tempFiles()).toEqual([]);
  });

  it('prints the removal and the D6 conversion Notice only after the new bytes are on disk', () => {
    fs.writeFileSync(configPath, '{"default":"stale"}');
    spyStderr();
    const shipped = config.getDefaultAliases();

    config.saveConfig({
      default: 'mine',
      aliases: { mine: 'openrouter/acme/model-1.0', broken: null, gemini: shipped.gemini },
    });

    expect(notices.map((n) => n.line)).toEqual([
      expect.stringContaining("Removing invalid alias 'broken'"),
      expect.stringContaining("alias 'gemini' matches the shipped recommendation"),
    ]);
    // Each Notice saw the NEW config already in place — not the stale bytes.
    for (const n of notices) {
      expect(n.onDisk).toContain('openrouter/acme/model-1.0');
      expect(n.onDisk).not.toBe('{"default":"stale"}');
    }
    expect(tempFiles()).toEqual([]);
  });

  it('a failed rename leaves the original bytes intact, throws, and prints NOTHING', () => {
    fs.writeFileSync(configPath, FROZEN);
    spyStderr();
    jest.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('EPERM: simulated rename failure');
    });
    const shipped = config.getDefaultAliases();

    expect(() => config.saveConfig({
      default: 'mine',
      aliases: { mine: 'openrouter/acme/model-2.0', broken: null, gemini: shipped.gemini },
    })).toThrow(/simulated rename failure/);

    expect(fs.readFileSync(configPath, 'utf-8')).toBe(FROZEN);   // untouched original
    expect(notices).toEqual([]);                                  // no conversion was announced
    expect(tempFiles()).toEqual([]);                              // temp cleaned up
  });
});
