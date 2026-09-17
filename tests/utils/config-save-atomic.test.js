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

  // ── PR #261 council round 1 ────────────────────────────────────────────────

  // Windows has neither of the two things these need: creating a symlink wants
  // Developer Mode or elevation, and `statSync().mode` carries no POSIX
  // permission bits there. Skipped by name rather than weakened to a no-op.
  const itPosix = process.platform === 'win32' ? it.skip : it;

  itPosix('follows a symlinked config.json to its target instead of replacing the link (#261 r1 A1/C4/D2)', () => {
    const realDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-cfg-target-'));
    const targetPath = path.join(realDir, 'real-config.json');
    fs.writeFileSync(targetPath, '{"default":"stale"}');
    fs.symlinkSync(targetPath, configPath);
    spyStderr();

    try {
      config.saveConfig(FIXTURE());

      expect(fs.lstatSync(configPath).isSymbolicLink()).toBe(true);   // the link survived
      expect(fs.readFileSync(targetPath, 'utf-8')).toBe(FROZEN);      // the TARGET got the bytes
      expect(fs.readdirSync(realDir).filter((n) => n.includes('.tmp'))).toEqual([]);
      expect(tempFiles()).toEqual([]);
    } finally {
      fs.rmSync(realDir, { recursive: true, force: true });
    }
  });

  itPosix('the renamed config.json carries mode 0o600, not just the temp (#261 r1 A2)', () => {
    spyStderr();

    config.saveConfig(FIXTURE());

    expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
  });

  it('a dead stderr after the rename does not turn a committed save into a throw (#261 r1 B1/C6/D3)', () => {
    jest.spyOn(process.stderr, 'write').mockImplementation(() => {
      throw new Error('EPIPE: broken pipe');
    });
    const shipped = config.getDefaultAliases();

    expect(() => config.saveConfig({
      default: 'mine',
      aliases: { mine: 'openrouter/acme/model-1.0', broken: null, gemini: shipped.gemini },
    })).not.toThrow();

    expect(fs.readFileSync(configPath, 'utf-8')).toBe(FROZEN);   // the save is committed
  });

  it("a failed write leaves the caller's configData exactly as it was passed (#261 r1 C1/D1)", () => {
    fs.writeFileSync(configPath, FROZEN);
    spyStderr();
    jest.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('EPERM: simulated rename failure');
    });
    const shipped = config.getDefaultAliases();
    const passed = {
      default: 'mine',
      aliases: { mine: 'openrouter/acme/model-2.0', broken: null, gemini: shipped.gemini },
    };

    expect(() => config.saveConfig(passed)).toThrow(/simulated rename failure/);

    // Neither the invalid-alias strip nor the D6 drop reached the caller's object:
    // disk and memory did not diverge.
    expect(Object.keys(passed.aliases)).toEqual(['mine', 'broken', 'gemini']);
    expect(passed.aliases).toEqual({
      mine: 'openrouter/acme/model-2.0', broken: null, gemini: shipped.gemini,
    });
  });

  it('a retry with the same object after a failed write re-announces and lands (#261 r1 C1/D1)', () => {
    fs.writeFileSync(configPath, '{"default":"stale"}');
    spyStderr();
    const shipped = config.getDefaultAliases();
    const passed = {
      default: 'mine',
      aliases: { mine: 'openrouter/acme/model-1.0', broken: null, gemini: shipped.gemini },
    };
    // jest.spyOn keeps the real implementation as its default, so only the
    // FIRST rename fails and the retry goes through for real.
    jest.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('EPERM: simulated rename failure');
    });

    expect(() => config.saveConfig(passed)).toThrow(/simulated rename failure/);
    expect(notices).toEqual([]);

    config.saveConfig(passed);   // same object, second attempt

    expect(notices.map((n) => n.line)).toEqual([
      expect.stringContaining("Removing invalid alias 'broken'"),
      expect.stringContaining("alias 'gemini' matches the shipped recommendation"),
    ]);
    expect(fs.readFileSync(configPath, 'utf-8')).toBe(FROZEN);
    // On SUCCESS the caller's object still carries the normalized aliases —
    // sidecar/setup.js :: createDefaultConfig reads and returns cfg right after.
    expect(passed.aliases).toEqual({ mine: 'openrouter/acme/model-1.0' });
  });

  it('a failed TEMP write leaves the original intact, cleans up, and prints nothing (#261 r1 C5)', () => {
    fs.writeFileSync(configPath, FROZEN);
    spyStderr();
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('ENOSPC: no space left on device');
    });
    const shipped = config.getDefaultAliases();

    expect(() => config.saveConfig({
      default: 'mine',
      aliases: { mine: 'openrouter/acme/model-2.0', broken: null, gemini: shipped.gemini },
    })).toThrow(/ENOSPC/);

    expect(fs.readFileSync(configPath, 'utf-8')).toBe(FROZEN);
    expect(notices).toEqual([]);
    expect(tempFiles()).toEqual([]);
  });
});
