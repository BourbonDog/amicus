/**
 * Robust unzip for the electron self-heal (src/sidecar/unzip.js).
 *
 * The field bug (amicus-bug-report-extract-zip-node24): on some Node 24 boxes
 * `extract-zip@2.0.1` (frozen — 2.0.1 is the latest) STALLS mid-extract — its
 * promise never resolves AND never rejects. Because the self-heal `await`s that
 * promise, when the event loop drains Node exits 0 with a partial extract and no
 * electron.exe, so the repair silently no-ops. extract-zip is the latest release
 * so "bump it" is impossible.
 *
 * robustExtract() makes extraction survive that:
 *   1. it BOUNDS extract-zip with an idle+max timer, so a stall becomes a
 *      catchable outcome (and the live timer keeps the loop alive → no exit 0);
 *   2. it FALLS BACK to a native OS unzip (tar / Expand-Archive on Windows,
 *      ditto / unzip on macOS, unzip / tar on Linux) whenever extract-zip
 *      stalls, throws, or leaves an empty dir;
 *   3. it only reports success when files actually landed on disk (the electron
 *      exe-stat verify stays upstream in electron-quarantine).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  robustExtract, nativeUnzipPlan, IDLE_MS, MAX_MS,
} = require('../../src/sidecar/unzip');

/**
 * Injectable fake-timer harness. robustExtract takes deps.setTimeout /
 * deps.clearTimeout, so we can fire a "stall" deterministically without real
 * wall-clock waits and assert that progress RESETS the idle timer.
 */
function makeTimers() {
  let seq = 0;
  const live = new Map(); // id -> fn
  const cleared = [];
  return {
    setTimeout: (fn) => { const id = ++seq; live.set(id, fn); return id; },
    clearTimeout: (id) => { if (live.has(id)) { live.delete(id); cleared.push(id); } },
    fireAll: () => { for (const [id, fn] of [...live]) { live.delete(id); fn(); } },
    pending: () => live.size,
    cleared: () => cleared.slice(),
  };
}

const NEVER = () => new Promise(() => {}); // never resolves, never rejects — the stall

describe('nativeUnzipPlan (per-platform command selection)', () => {
  it('Windows tries bsdtar first (ABSOLUTE System32 path, not bare "tar"), then Expand-Archive', () => {
    const plan = nativeUnzipPlan('Z.zip', 'D:\\out', 'win32');
    expect(plan.map((s) => s.name)).toEqual(['tar', 'Expand-Archive']);
    // MUST be the absolute System32 bsdtar, else a bare "tar" resolves to GNU tar
    // (git-bash on PATH) which reads "C:\..." as a remote host and can't unzip.
    expect(plan[0].cmd).toMatch(/system32[\\/]tar\.exe$/i);
    expect(path.win32.isAbsolute(plan[0].cmd)).toBe(true);
    expect(plan[0].args).toEqual(['-xf', 'Z.zip', '-C', 'D:\\out']);
    expect(plan[1].cmd.toLowerCase()).toContain('powershell');
    expect(plan[1].args.join(' ')).toContain('Expand-Archive');
  });

  it('macOS tries ditto first, then unzip', () => {
    const plan = nativeUnzipPlan('z.zip', '/out', 'darwin');
    expect(plan.map((s) => s.name)).toEqual(['ditto', 'unzip']);
    expect(plan[0].cmd).toBe('ditto');
    expect(plan[1].cmd).toBe('unzip');
  });

  it('Linux tries unzip first, then tar', () => {
    const plan = nativeUnzipPlan('z.zip', '/out', 'linux');
    expect(plan.map((s) => s.name)).toEqual(['unzip', 'tar']);
  });

  it('single-quote-escapes the PowerShell Expand-Archive path args (injection-safe)', () => {
    const plan = nativeUnzipPlan("C:\\o'ut\\z.zip", "C:\\d'ir", 'win32');
    const cmdStr = plan[1].args[plan[1].args.length - 1];
    // PowerShell escapes a literal single quote by doubling it inside a '...' literal.
    expect(cmdStr).toContain("'C:\\o''ut\\z.zip'");
    expect(cmdStr).toContain("'C:\\d''ir'");
  });
});

describe('robustExtract', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-unzip-test-'));
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    jest.restoreAllMocks();
  });

  const writeInto = (name = 'electron.exe') => fs.writeFileSync(path.join(dir, name), 'x');

  it('FAST PATH: extract-zip resolves and populates the dir → strategy "extract-zip", native never spawned', async () => {
    const spawn = jest.fn();
    const extractZip = jest.fn(async () => { writeInto(); });
    const res = await robustExtract('z.zip', { dir, platform: 'win32', deps: { extractZip, spawn, fs } });
    expect(res.strategy).toBe('extract-zip');
    expect(res.fallback).toBeFalsy();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('STALL: extract-zip never settles → idle timer fires → native tar recovers → strategy "tar", fallback true', async () => {
    const timers = makeTimers();
    const spawn = jest.fn((cmd) => { if (/tar/i.test(cmd)) { writeInto(); } return { status: 0 }; });
    const p = robustExtract('z.zip', {
      dir, platform: 'win32',
      deps: { extractZip: NEVER, spawn, fs, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout },
    });
    // The bounded race scheduled its timers synchronously; fire the stall.
    expect(timers.pending()).toBeGreaterThan(0);
    timers.fireAll();
    const res = await p;
    expect(res.strategy).toBe('tar');
    expect(res.fallback).toBe(true);
    expect(spawn).toHaveBeenCalledWith(expect.stringMatching(/tar\.exe$/i), ['-xf', 'z.zip', '-C', dir], expect.any(Object));
  });

  it('THROW: extract-zip rejects → native recovers', async () => {
    const spawn = jest.fn((cmd) => { if (/tar/i.test(cmd)) { writeInto(); } return { status: 0 }; });
    const extractZip = jest.fn(async () => { throw new Error('bad zip'); });
    const res = await robustExtract('z.zip', { dir, platform: 'win32', deps: { extractZip, spawn, fs } });
    expect(res.strategy).toBe('tar');
    expect(res.fallback).toBe(true);
  });

  it('EMPTY: extract-zip resolves but leaves the dir empty → native recovers', async () => {
    const spawn = jest.fn((cmd) => { if (/tar/i.test(cmd)) { writeInto(); } return { status: 0 }; });
    const extractZip = jest.fn(async () => { /* resolves, writes nothing */ });
    const res = await robustExtract('z.zip', { dir, platform: 'win32', deps: { extractZip, spawn, fs } });
    expect(res.strategy).toBe('tar');
  });

  it('NATIVE ORDER: first native strategy fails (non-zero exit), second succeeds; the partial dir is cleaned between', async () => {
    const spawn = jest.fn((cmd) => {
      if (/tar/i.test(cmd)) { writeInto('partial.tmp'); return { status: 1 }; } // "failed" but left junk
      writeInto('electron.exe'); // Expand-Archive succeeds
      return { status: 0 };
    });
    // idleMs:1 with a never-settling extract-zip drives the stall via real timers.
    const res = await robustExtract('z.zip', { dir, platform: 'win32', idleMs: 1, maxMs: 5, deps: { extractZip: NEVER, spawn, fs } });
    expect(res.strategy).toBe('Expand-Archive');
    // the failed tar's partial output was removed before Expand-Archive ran
    expect(fs.existsSync(path.join(dir, 'partial.tmp'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'electron.exe'))).toBe(true);
  });

  it('SIGNAL-KILLED native unzip with partial output is a FAILURE, not success (misclassification guard)', async () => {
    // An external kill (OOM/SIGKILL) returns status:null, no error, but may have
    // left partial files — dirNonEmpty alone would wrongly accept it. Must fail over.
    const spawn = jest.fn((cmd) => {
      if (/tar/i.test(cmd)) { writeInto('partial.bin'); return { status: null, signal: 'SIGKILL' }; }
      writeInto('electron.exe'); return { status: 0 };
    });
    const res = await robustExtract('z.zip', { dir, platform: 'win32', idleMs: 1, maxMs: 5, deps: { extractZip: NEVER, spawn, fs } });
    expect(res.strategy).toBe('Expand-Archive'); // did NOT accept the signal-killed tar
    expect(fs.existsSync(path.join(dir, 'partial.bin'))).toBe(false); // its junk was cleaned
  });

  it('ALL FAIL: extract-zip stalls and every native strategy fails → rejects with UNZIP_ALL_FAILED naming each attempt', async () => {
    const spawn = jest.fn(() => ({ status: 1 })); // every native unzip fails
    let err;
    try {
      await robustExtract('z.zip', { dir, platform: 'win32', idleMs: 1, maxMs: 5, deps: { extractZip: NEVER, spawn, fs } });
    } catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.code).toBe('UNZIP_ALL_FAILED');
    expect(err.message).toContain('tar');
    expect(err.message).toContain('Expand-Archive');
  });

  it('PROGRESS RESETS THE IDLE TIMER: an onEntry event clears the prior idle timer and re-arms a new one', async () => {
    const timers = makeTimers();
    // extract-zip fires ONE progress event, then stalls forever.
    const extractZip = (zip, opts) => { if (opts && opts.onEntry) { opts.onEntry({ fileName: 'a' }); } return new Promise(() => {}); };
    const spawn = jest.fn((cmd) => { if (/tar/i.test(cmd)) { writeInto(); } return { status: 0 }; });
    const p = robustExtract('z.zip', {
      dir, platform: 'win32',
      deps: { extractZip, spawn, fs, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout },
    });
    // The initial idle timer must have been cleared and re-armed by the progress event.
    expect(timers.cleared().length).toBeGreaterThan(0);
    timers.fireAll();
    const res = await p;
    expect(res.strategy).toBe('tar');
  });

  it('onEntry passthrough: the caller\'s onEntry is invoked for each entry extract-zip reports', async () => {
    const seen = [];
    const extractZip = async (zip, opts) => { opts.onEntry({ fileName: 'a' }); opts.onEntry({ fileName: 'b' }); writeInto(); };
    const res = await robustExtract('z.zip', {
      dir, platform: 'win32', onEntry: (e) => seen.push(e.fileName), deps: { extractZip, spawn: jest.fn(), fs },
    });
    expect(res.strategy).toBe('extract-zip');
    expect(seen).toEqual(['a', 'b']);
  });

  it('REAL extract-zip: extracts an actual (tiny) zip via the bundled dependency — no fallback', async () => {
    // A real one-file zip (hello.txt -> "hi from amicus unzip test"), so this
    // test exercises the REAL extract-zip code path hermetically, not a mock.
    const ZIP_B64 = 'UEsDBBQAAAAIAFW13lwYEN8PGwAAABkAAAAJAAAAaGVsbG8udHh0y8hUSCvKz1VIzM1MLi1WKM2ryixQKEktLgEAUEsBAhQAFAAAAAgAVbXeXBgQ3w8bAAAAGQAAAAkAAAAAAAAAAAAAAAAAAAAAAGhlbGxvLnR4dFBLBQYAAAAAAQABADcAAABCAAAAAAA=';
    const zipPath = path.join(dir, 'real.zip');
    fs.writeFileSync(zipPath, Buffer.from(ZIP_B64, 'base64'));
    const outDir = path.join(dir, 'out');
    const spawn = jest.fn();
    const res = await robustExtract(zipPath, { dir: outDir, platform: process.platform, deps: { spawn, fs } });
    expect(res.strategy).toBe('extract-zip');
    expect(fs.readFileSync(path.join(outDir, 'hello.txt'), 'utf-8')).toBe('hi from amicus unzip test');
    expect(spawn).not.toHaveBeenCalled();
  });
});

