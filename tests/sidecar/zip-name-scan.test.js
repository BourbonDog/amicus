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

const { scanEntryNames, nameRefusal, scanLocalNames } = require('../../src/sidecar/zip-name-scan');
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

describe('scanLocalNames reads the OTHER table an archive declares its names in (B3)', () => {
  // WHY A SECOND WALK. `scanEntryNames` reads the central directory, and an
  // archive can blind yauzl there while leaving every local header whole -- a
  // truncation does it by accident, and four ONE-FIELD edits to a COMPLETE
  // end-of-central-directory record do it on purpose. MEASURED before this
  // shipped: seven such archives carrying `../../../PWNED-BY-NATIVE.txt` reached
  // a real spawn; with the local walk, zero do. The end-to-end rows live in
  // tests/electron-native-rescue.test.js; this pins the primitive.
  //
  // -- NAMED MUTANTS --
  // LOCALSCANIGNORED   zip-name-scan.js :: scanLocalNames -- return
  //   `{refusal:null, complete:false, names:0}` unconditionally, restoring the
  //   v4.9.6 state where only the central directory was read.
  //   RED: 'a hostile LOCAL name is found when the central directory is blinded'.
  // LOCALNAMERULEDRIFT zip-name-scan.js :: scanLocalNames -- inline a second
  //   lexical rule instead of calling `nameRefusal`, so the two tables can start
  //   disagreeing about what yauzl would refuse.
  //   RED: 'both tables refuse by the SAME rule'.
  // LOCALSIZETRUST     zip-name-scan.js :: scanLocalNames -- drop the
  //   deferred-size guard, so an entry whose size lives in a data descriptor is
  //   skipped by 0 bytes and the walk resynchronises on payload.
  //   RED: 'an entry that does not declare its size here STOPS the walk'.
  // LOCALCOMPLETEONREFUSAL zip-name-scan.js :: scanLocalNames -- return
  //   `complete: true` on the refusal path, contradicting the field's own JSDoc.
  //   RED: 'a refusal reports complete:false -- it did not see them all'.
  const HOSTILE = '../../../PWNED-BY-NATIVE.txt';
  // Entry 1 carries the encrypted bit, which is what breaks yauzl BEFORE it ever
  // looks at entry 2's name -- the measured shape that lands in the ONE class a
  // rescue may act on.
  const hostileArchive = () => buildZip([
    { name: 'first.bin', body: 'AAAA', flags: FLAG_ENCRYPTED },
    { name: HOSTILE, body: 'PWNED' },
    { name: 'electron.exe', body: 'MZ' },
  ]);

  test('a hostile LOCAL name is found when the central directory is blinded (LOCALSCANIGNORED)', () => {
    // Blind the central walk by lying about the EOCD comment length -- one field,
    // on an archive whose every local header is untouched.
    const bytes = hostileArchive();
    let eocd = -1;
    for (let i = bytes.length - 22; i >= 0; i -= 1) { if (bytes.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } }
    expect(eocd).toBeGreaterThan(-1);
    bytes.writeUInt16LE(500, eocd + 20);

    const local = scanLocalNames(bytes);

    expect(local.refusal).toMatch(/invalid relative path/);
    expect(local.refusal).toContain(HOSTILE);
  });

  test('both tables refuse by the SAME rule (LOCALNAMERULEDRIFT)', () => {
    // A second lexical rule free to drift from yauzl's starts costing the rescue
    // archives yauzl ACCEPTS, which is the failure this module was written to
    // avoid. Names yauzl allows must stay allowed in both walks.
    for (const name of ['a..b/c.txt', '...leading/x', 'sub/..hidden.txt']) {
      const local = scanLocalNames(buildZip([{ name, body: 'x' }]));
      expect(local.refusal).toBeNull();
    }
    // A '..' that is a whole path COMPONENT is refused wherever it sits -- yauzl
    // splits on '/' and asks `includes('..')`, so an interior one counts too.
    for (const name of ['../out.txt', '/abs.txt', 'C:/drive.txt', 'deep/../inside/ok.txt']) {
      const local = scanLocalNames(buildZip([{ name, body: 'x' }]));
      expect(local.refusal).not.toBeNull();
    }
  });

  test('a refusal reports complete:false -- it did not see them all (LOCALCOMPLETEONREFUSAL)', () => {
    // The walk stops at the refusal, so it did NOT reach the directory. A field
    // whose JSDoc says "EVERY local header was seen" must not claim otherwise on
    // one of its own return sites, even where nothing reads it today.
    const local = scanLocalNames(buildZip([
      { name: HOSTILE, body: 'PWNED' },
      { name: 'electron.exe', body: 'MZ' },
    ]));

    expect(local.refusal).not.toBeNull();
    expect(local.complete).toBe(false);
  });

  test('a clean archive is walked to the directory, and reports it', () => {
    const local = scanLocalNames(buildZip([
      { name: 'first.bin', body: 'AAAA', flags: FLAG_ENCRYPTED },
      { name: 'electron.exe', body: 'MZ' },
    ]));

    expect(local).toMatchObject({ refusal: null, complete: true, names: 2 });
  });

  test('a TRUNCATED archive still yields its names, which is the whole point', () => {
    // The central walk goes blind here; this one does not. Cut inside the central
    // directory, so every local header survives -- the shape a partial copy of a
    // real artifact produces, and the case the rescue exists for.
    const whole = hostileArchive();
    const local = scanLocalNames(whole.subarray(0, whole.length - 8));

    expect(local.refusal).toContain(HOSTILE);
  });

  test('an entry that does not declare its size here STOPS the walk (LOCALSIZETRUST)', () => {
    // Bit 3 puts the sizes BEHIND the payload, so the next offset is unknowable
    // without decompressing. Guessing would resynchronise the walk on payload
    // bytes; it stops instead, and says why.
    const bytes = buildZip([{ name: 'a.bin', body: 'AAAA' }, { name: 'b.bin', body: 'BB' }]);
    bytes.writeUInt16LE(0x08, 6);      // flags on the FIRST local header
    bytes.writeUInt32LE(0, 18);        // and no size declared here

    const local = scanLocalNames(bytes);

    expect(local).toMatchObject({ refusal: null, complete: false, names: 1 });
    expect(local.why).toMatch(/does not declare its size here/);
  });

  // -- COUNCIL #239 ROUND 1, BLOCKER A1 AND WHAT IT TURNED OUT TO BE --
  // Filed as "bit 3 with a nonzero size lets the walk skip a hostile entry". True,
  // and the narrow half: the advance is `30 + nameLen + extraLen + compressed` and
  // THREE of those four terms are attacker-chosen, so bit 3 is one route to a
  // desync and not the route. The root cause is that `complete: true` rested on
  // where the walk LANDED, never on what it JUMPED.
  //
  // -- NAMED MUTANTS --
  // LOCALDEFERREDTRUSTED  scanLocalNames -- delete the `flags & FLAG_SIZES_DEFERRED`
  //   demotion, restoring the state where a nonzero size beside bit 3 is trusted.
  //   RED: 'a bit-3 entry whose stated size is a lie cannot report a clean bill'.
  // LOCALSPANUNPROVEN     scanLocalNames -- delete the `hidden` span scan, so a
  //   declared size may jump a local header with no demotion.
  //   RED: 'an inflated extraLen or size cannot report a clean bill'.
  // LOCALTERMINUSUNANCHORED scanLocalNames -- return `complete: true` on any
  //   central/EOCD signature without comparing `at` to `declaredCentralOffset`.
  //   RED: 'four planted bytes cannot end the walk with a clean bill'.
  // LOCALDEMOTESTOPS      scanLocalNames -- turn either demotion into an early
  //   `return`, which is the remedy three adversarial lenses measured as WORSE
  //   than the defect: it forfeits the refusal for every entry behind it.
  //   RED: 'a doubt DEMOTES the claim and keeps walking, so refusals still form'.
  // A LOW-LEVEL builder, because `buildZip` writes HONEST headers and every shape
  // here is a lie about a length. Fields not named are correct.
  const LOCAL_SIG = 0x04034b50;
  const CENTRAL_SIG = 0x02014b50;
  const EOCD_SIG = 0x06054b50;
  function zipEntry(name, body, { flags = 0, size = null, extraLen = 0 } = {}) {
    const n = Buffer.from(name, 'latin1');
    const d = Buffer.from(body, 'latin1');
    const h = Buffer.alloc(30);
    h.writeUInt32LE(LOCAL_SIG, 0);
    h.writeUInt16LE(flags, 6);
    h.writeUInt32LE(size === null ? d.length : size, 18);
    h.writeUInt32LE(d.length, 22);
    h.writeUInt16LE(n.length, 26);
    h.writeUInt16LE(extraLen, 28);
    return Buffer.concat([h, n, d]);
  }
  function concatZip(entries) {
    const locals = Buffer.concat(entries);
    const names = ['first.bin', HOSTILE, 'electron.exe'].slice(0, entries.length);
    const central = Buffer.concat(names.map((nm) => {
      const n = Buffer.from(nm, 'latin1');
      const c = Buffer.alloc(46);
      c.writeUInt32LE(CENTRAL_SIG, 0);
      c.writeUInt16LE(n.length, 28);
      return Buffer.concat([c, n]);
    }));
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(EOCD_SIG, 0);
    eocd.writeUInt16LE(names.length, 8);
    eocd.writeUInt16LE(names.length, 10);
    eocd.writeUInt32LE(central.length, 12);
    eocd.writeUInt32LE(locals.length, 16);   // the DECLARED directory offset
    return Buffer.concat([locals, central, eocd]);
  }

  const jumpFixture = (opts) => {
    const first = zipEntry('first.bin', opts.body || 'AAAA', opts);
    return concatZip([first, zipEntry(HOSTILE, 'PWNED'), zipEntry('electron.exe', 'MZ')]);
  };

  test('a bit-3 entry whose stated size is a lie cannot report a clean bill (LOCALDEFERREDTRUSTED)', () => {
    // THE FILED BLOCKER, reproduced: entry 1 sets bit 3 and declares a nonzero
    // size aimed exactly past entry 2. APPNOTE 4.4.4 has the writer set that
    // field to ZERO under bit 3, so a nonzero value beside the flag is malformed
    // by construction and nothing may rest on it.
    const hostile = zipEntry(HOSTILE, 'PWNED');
    const bytes = jumpFixture({ flags: 0x08, size: 4 + hostile.length });

    const local = scanLocalNames(bytes);

    expect(local.complete).toBe(false);
    expect(local.why).toMatch(/bit 3|not authoritative|jumps over/);
  });

  test('an inflated extraLen cannot report a clean bill (LOCALSPANUNPROVEN)', () => {
    // No bit 3 anywhere: the same skip through a different attacker-chosen term.
    const hostile = zipEntry(HOSTILE, 'PWNED');
    const local = scanLocalNames(jumpFixture({ extraLen: hostile.length }));

    expect(local.complete).toBe(false);
  });

  test('a doubt DEMOTES the claim and keeps walking, so refusals still form (LOCALDEMOTESTOPS)', () => {
    // THE REGRESSION THREE ADVERSARIAL LENSES PREDICTED, and the reason the
    // remedy is a flag and not a return. Bit 3 with an HONEST size, hostile entry
    // BEHIND it: stopping at the doubt forfeits the refusal and the archive goes
    // to a native extractor. MEASURED on the rejected remedy: a terminal
    // UNZIP_UNSAFE_ARCHIVE became a completed `tar` rescue.
    const local = scanLocalNames(jumpFixture({ flags: 0x08 }));

    expect(local.refusal).toContain(HOSTILE);
    expect(local.complete).toBe(false);
  });

  test('an incidental local signature in a payload still refuses what is behind it (LOCALDEMOTESTOPS)', () => {
    // A 140 MB artifact carries these by chance. Demotion costs a disclosure
    // sentence; a return would cost the refusal.
    const local = scanLocalNames(jumpFixture({ body: 'PKxx' }));

    expect(local.refusal).toContain(HOSTILE);
  });

  test('bit 3 alone demotes the claim, even when nothing is skipped (LOCALDEFERREDTRUSTED)', () => {
    // ISOLATING FIXTURE. On an archive where an entry is JUMPED, the span check
    // fires too, so both controls are satisfied and neither is pinned. Here the
    // declared size is HONEST and the chain lands exactly on the declared
    // directory -- nothing is skipped, and the ONLY reason the claim may not
    // stand is that bit 3 says this size was never authoritative in the first
    // place (a real writer puts the true sizes in a trailing data descriptor).
    const bytes = concatZip([zipEntry('first.bin', 'AAAA', { flags: 0x08 }), zipEntry('electron.exe', 'MZ')]);

    const local = scanLocalNames(bytes);

    expect(local.refusal).toBeNull();
    expect(local.complete).toBe(false);
    expect(local.why).toMatch(/bit 3|not authoritative/);
  });

  test('four planted bytes cannot end the walk with a clean bill (LOCALTERMINUSUNANCHORED)', () => {
    // THE ZERO-FORGERY SHAPE. Every local header is honest and no length lies:
    // the attacker appends `PK` where an honest advance lands, and a walk
    // that stops on any central signature declares victory with the hostile entry
    // still ahead of it. The terminus must be anchored to the offset the archive
    // ITSELF declares its directory begins at.
    const first = Buffer.concat([
      zipEntry('first.bin', 'AAAA'),
      Buffer.from([0x50, 0x4b, 0x01, 0x02]),
    ]);
    const bytes = concatZip([first, zipEntry(HOSTILE, 'PWNED'), zipEntry('electron.exe', 'MZ')]);

    const local = scanLocalNames(bytes);

    expect(local.complete).toBe(false);
    expect(local.why).toMatch(/declares its directory begins/);
  });

  test('a CLEAN archive still reports a clean bill, or the notice over-warns forever', () => {
    const local = scanLocalNames(concatZip([zipEntry('first.bin', 'AAAA'), zipEntry('electron.exe', 'MZ')]));

    expect(local).toMatchObject({ refusal: null, complete: true });
  });

  test('it never throws, whatever it is handed', () => {
    for (const b of [Buffer.alloc(0), Buffer.from('not a zip at all'), Buffer.alloc(3),
      Buffer.from([0x50, 0x4b, 0x03, 0x04])]) {
      expect(() => scanLocalNames(b)).not.toThrow();
      expect(scanLocalNames(b).refusal).toBeNull();
    }
  });
});
