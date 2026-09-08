// tests/sidecar/zip-name-scan.test.js
'use strict';

/**
 * THE NAME SCAN — what it sees, what it does not, and the false positives that
 * would cost the rescue.
 *
 * `electron-native-rescue.js` consults this before handing an archive to a tool
 * with no path-traversal check of its own, because its exclusion keys on the
 * refusal yauzl FORMED and yauzl checks an entry's size before its name. The
 * end-to-end case lives in tests/electron-native-rescue.test.js
 * (ENTRYORDERTRAVERSAL); this pins the primitive.
 *
 * THE TWO WAYS TO BE WRONG ARE NOT SYMMETRICAL. A missed hostile name costs a
 * control. A name flagged that yauzl would have ACCEPTED costs the rescue an
 * archive it was written for — and the rescue exists for a machine with no
 * network, so that is not a small cost either. Both directions are measured.
 *
 * ── NAMED MUTANT ──────────────────────────────────────────────────────────
 * NAMESCANLEXICAL  zip-name-scan.js :: nameRefusal — drop the
 *   `.replace(/\\/g, '/')`, so the backslash form yauzl rewrites and refuses
 *   walks straight past the scan.
 *   RED: "a BACKSLASH traversal is refused, exactly as yauzl refuses it".
 * ──────────────────────────────────────────────────────────────────────────
 */

const { scanEntryNames, nameRefusal } = require('../../src/sidecar/zip-name-scan');
const { buildZip, FLAG_ENCRYPTED } = require('../helpers/zip-fixture');

/** The entry that ends yauzl's walk before it validates any later name. */
const BREAKS_THE_WALK = { name: 'first.bin', body: 'DATA', flags: FLAG_ENCRYPTED };

describe('nameRefusal mirrors yauzl validateFileName under amicus\'s options', () => {
  test('refuses what yauzl refuses', () => {
    expect(nameRefusal('../x')).toMatch(/^invalid relative path: /);
    expect(nameRefusal('a/../../x')).toMatch(/^invalid relative path: /);
    expect(nameRefusal('/etc/x')).toMatch(/^absolute path: /);
    expect(nameRefusal('C:/x')).toMatch(/^absolute path: /);
    expect(nameRefusal('z:/x')).toMatch(/^absolute path: /);
    // strictFileNames is off, so yauzl rewrites backslashes and THEN validates.
    expect(nameRefusal('..\\..\\x')).toMatch(/^invalid relative path: /);
  });

  test('accepts what yauzl accepts, including the names a lexical rule over-reads', () => {
    // Each of these survives yauzl's own validator, so flagging any of them
    // would delete the rescue for an archive that has nothing wrong with it.
    for (const ok of [
      'electron.exe', 'resources/app.asar', 'locales/en-US.pak',
      'sub\\file.txt',           // rewritten to sub/file.txt: no `..` segment
      '..hidden/x', 'a..b/x', 'x/..y', 'C/x', 'cc:x/y',
    ]) {
      expect(nameRefusal(ok)).toBeNull();
    }
  });

  test('the refusal is yauzl\'s own wording, so unzip.js still classifies it', () => {
    // eslint-disable-next-line global-require
    const { UNSAFE_PATTERNS } = require('../../src/sidecar/unzip');
    for (const name of ['../x', '/etc/x', 'C:/x']) {
      expect(UNSAFE_PATTERNS.some((p) => p.test(nameRefusal(name)))).toBe(true);
    }
  });
});

describe('scanEntryNames reads the central directory past the broken entry', () => {
  test('a BACKSLASH traversal is refused, exactly as yauzl refuses it (NAMESCANLEXICAL)', async () => {
    const seen = await scanEntryNames(buildZip([BREAKS_THE_WALK, { name: '..\\..\\PWNED.txt', body: 'p' }]));

    expect(seen.read).toBe(true);
    expect(seen.refusal).toBe('invalid relative path: ..\\..\\PWNED.txt');
  });

  test('the entry that BROKE the extraction does not stop the walk', async () => {
    // The whole point: yauzl's own extract dies on entry 0, so the traversal
    // entry behind it is never validated and the archive is classified as
    // merely unreadable. The scan turns size validation off and sees it.
    const seen = await scanEntryNames(buildZip([
      BREAKS_THE_WALK, { name: '../../../PWNED.txt', body: 'p' }, { name: 'electron.exe', body: 'MZ' },
    ]));

    expect(seen.refusal).toBe('invalid relative path: ../../../PWNED.txt');
  });

  test('a clean archive reports read:true and no refusal — the caller may proceed', async () => {
    const seen = await scanEntryNames(buildZip([BREAKS_THE_WALK, { name: 'electron.exe', body: 'MZ' }]));

    expect(seen).toEqual({ read: true, refusal: null, why: '' });
  });

  test('an unreadable central directory proves NOTHING, and says so', async () => {
    // `read:false` is the residual the rescue states out loud: a truncated zip
    // declares no names anyone can see, and the archive still goes to the native
    // extractor. The flag exists so that stays a decision rather than a silence.
    const whole = buildZip([{ name: 'electron.exe', body: 'MZ' }]);
    for (const bytes of [Buffer.from('not a zip at all'), whole.subarray(0, whole.length - 8), Buffer.alloc(0)]) {
      const seen = await scanEntryNames(bytes);
      expect(seen.read).toBe(false);
      expect(seen.refusal).toBeNull();
      expect(seen.why).toMatch(/central directory/);
    }
  });

  test('it never throws and never rejects, whatever it is handed', async () => {
    // The caller already has a failure in flight; a diagnostic must not add one.
    for (const junk of [Buffer.from([0x50, 0x4b]), Buffer.from('PK\u0005\u0006')]) {
      await expect(scanEntryNames(junk)).resolves.toMatchObject({ refusal: null });
    }
  });

  test('a yauzl that will not load is a silent no-opinion, not a crash', async () => {
    const seen = await scanEntryNames(Buffer.from('x'), {
      deps: { yauzl: { fromBuffer: () => { throw new Error('MODULE_NOT_FOUND'); } } },
    });

    expect(seen.read).toBe(false);
    expect(seen.refusal).toBeNull();
  });

  test('the walk is bounded: a scan that never settles resolves as read:false', async () => {
    // Every wait in this subsystem is bounded (see zip-stall-bound.js). This one
    // is in-memory and should never fire; it is armed anyway, because "should
    // never" is not a property.
    const fired = [];
    const pending = scanEntryNames(Buffer.from('x'), {
      deps: {
        // A yauzl that opens and then says nothing at all: no entry, no end, no
        // error. Without the bound this promise never settles, and it is awaited
        // on a provisioning path.
        yauzl: { fromBuffer: (b, o, cb) => cb(null, { on: () => {}, readEntry: () => {} }) },
        setTimeout: (fn) => { fired.push(fn); return 1; },
        clearTimeout: () => {},
      },
    });

    expect(fired).toHaveLength(1);
    fired[0]();

    await expect(pending).resolves.toEqual({ read: false, refusal: null, why: expect.stringMatching(/exceeded/) });
  });
});
