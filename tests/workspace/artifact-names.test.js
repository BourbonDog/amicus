'use strict';

// v4.8 PR5a T1a (R5-13) — the seat-space artifact allowlist.
//
// Four designs were refuted before this one, ALL of them on the same intersection:
// a rule about filenames validated on benches where every leg BINDS. The on-disk
// namespace only collides when one does not, because the engine names an artifact
// from the seat when a leg binds and from the leg's alias when it does not
// (run-launch.js:205-207). Every case below that matters drives an ORPHAN.
//
// The suite had ZERO coverage of this function's seat behaviour before this file:
// artifact-guard.test.js contains no `seats` key at all, which is why the whole
// rebuild could be applied with 522 suites staying green.

const { artifactAllowlist } = require('../../src/workspace/artifact-names');
const { buildSeats } = require('../../src/council/seats');

const seatsFor = (bench) => buildSeats(bench, null, null);
const orphanNote = (alias, waveId = 'w-s1') => ({
  channel: 'seat-unbound', data: { legId: `${waveId}-9`, seat: alias, waveId },
});
// Per-SEAT review names only. `review-claude.md` is a FIXED artifact (T1b) — a
// skill-authored input, not a seat's output — so it must not be counted here or
// every seat assertion below silently depends on T1b's separate commit.
const reviewsIn = (list) => list
  .filter(n => n.startsWith('review-') && n !== 'review-claude.md').sort();

describe('seat-space allowlist', () => {
  test('a twin bench lists BOTH seats\' files and attributes each to its own seat', () => {
    const bench = ['gemini', 'gemini'];
    const list = artifactAllowlist({ bench, seats: seatsFor(bench) });
    expect(reviewsIn(list)).toEqual(['review-gemini-1.md', 'review-gemini-2.md']);
    // Killing mutant: entities = bench -> this collapses to one `review-gemini.md`,
    // which is HEAD's behaviour and the whole #137 Workspace defect.
    expect(list.artifactsByModel['gemini#1'].review).toBe('review-gemini-1.md');
    expect(list.artifactsByModel['gemini#2'].review).toBe('review-gemini-2.md');
    expect(list.collisions).toBeUndefined();
  });

  // The F1 bench from the plan's §0.2. HEAD attributes `review-vendor-a.md` to
  // `vendor/a` while the file physically holds `vendor?a`'s review. Under seat
  // space `vendor?a` is a seat whose id EQUALS its alias, so the bare name is its
  // own primary and no other entity can take it.
  test('F1: a twin mixed with a sanitize-collision attributes every seat to its own file', () => {
    const bench = ['vendor/a', 'vendor?a', 'vendor/a'];
    const list = artifactAllowlist({ bench, seats: seatsFor(bench) });
    const map = list.artifactsByModel;
    expect(map['vendor/a#1'].review).toBe('review-vendor-a-1.md');
    expect(map['vendor?a'].review).toBe('review-vendor-a.md');
    expect(map['vendor/a#2'].review).toBe('review-vendor-a-2.md');
    // No two seats may be pointed at one file — the property a content assertion
    // would establish, stated so it cannot pass vacuously.
    const names = Object.values(map).map(r => r.review);
    expect(new Set(names).size).toBe(names.length);
    expect(list.collisions).toBeUndefined();
  });

  test('every seat file the engine would write is on the list (no seat is unreachable)', () => {
    const bench = ['a', 'a', 'a-1', 'a-1'];
    const list = artifactAllowlist({ bench, seats: seatsFor(bench) });
    expect(reviewsIn(list)).toEqual([
      'review-a-1-1.md', 'review-a-1-2.md', 'review-a-1.md', 'review-a-2.md',
    ]);
    expect(list.collisions).toBeUndefined();
  });
});

describe('the orphan intersection — where four designs died', () => {
  // THE case. `a-1#1`'s alias-named file is `review-a-1.md`, which is ALSO seat
  // `a#1`'s primary. When an `a-1` leg orphans, the file on disk may hold either
  // seat's prose and run.json cannot say which. Revision 3 deduped the ambiguity
  // away and served the orphan's bytes under `a#1`.
  test('a name claimed by a primary AND an orphan is listed, attributed to NOBODY, and bannered', () => {
    const bench = ['a', 'a', 'a-1', 'a-1'];
    const list = artifactAllowlist({
      bench, seats: seatsFor(bench), degrades: [orphanNote('a-1')],
    });
    expect(list).toContain('review-a-1.md');            // still readable
    expect(list.artifactsByModel['a#1'].review).toBeUndefined();   // attributed to nobody
    expect(list.artifactsByModel['a#1'].judge).toBeUndefined();
    expect(list.collisions).toEqual([
      { sanitized: 'a-1', models: ['a#1', 'a-1'], orphan: true },
    ]);
    // Anti-vacuity: the seats that are NOT contested keep their attribution, so this
    // is not "attribution was dropped everywhere".
    expect(list.artifactsByModel['a#2'].review).toBe('review-a-2.md');
    expect(list.artifactsByModel['a-1#1'].review).toBe('review-a-1-1.md');
  });

  // ── v4.8 PR5a fix-wave, council finding B2 ──────────────────────────────────────
  // A contested stem used to drop EVERY kind from the owning seat's attribution. The
  // kinds an orphan can own are not "all of them": they are what its note proves, and
  // `data.waveId` proves it exactly — run-stage2.js:67/69/90 build the -s2 wave id from
  // the same runId run.json carries, so this is an equality test, not a prefix guess.
  //
  // ⚠️ The Stage-1 half of B2's rationale ("the orphan may have only written a review")
  // is measured FALSE and is disputed on the PR, so it is deliberately not implemented:
  // tests/council/run-stages.test.js:1757 shows a Stage-1 orphan's judge file is
  // alias-named too (it re-binds to a placeholder in Stage 2 and emits no -s2 note).
  // The two tests below pin both directions so neither can be "fixed" into the other.
  const S2_RUN = 'abc123';
  const s2Orphan = (alias) => orphanNote(alias, `${S2_RUN}-s2`);

  test('B2: a Stage-2 orphan contests the JUDGE half only — the seat keeps its own review', () => {
    const bench = ['a', 'a', 'a-1', 'a-1'];
    const list = artifactAllowlist({
      runId: S2_RUN, bench, seats: seatsFor(bench), degrades: [s2Orphan('a-1')],
    });
    // Killing mutant: delete `if (!claimed.has(kind)) { continue; }` from the orphan
    // loop -> review-a-1.md is contested again and this is undefined (MEASURED red).
    expect(list.artifactsByModel['a#1'].review).toBe('review-a-1.md');
    expect(list.artifactsByModel['a#1'].judge).toBeUndefined();
    // The banner is NOT weakened: the stem is still ambiguous, still named once, and
    // still names both claimants. Anti-vacuity for the assertion above.
    expect(list.collisions).toEqual([
      { sanitized: 'a-1', models: ['a#1', 'a-1'], orphan: true },
    ]);
    expect(list).toContain('review-a-1.md');
  });

  test('B2: a Stage-1 orphan still contests BOTH — its judge file is alias-named too', () => {
    const bench = ['a', 'a', 'a-1', 'a-1'];
    // Same run id, same alias, same collision — ONLY the wave differs.
    const list = artifactAllowlist({
      runId: S2_RUN, bench, seats: seatsFor(bench), degrades: [orphanNote('a-1', `${S2_RUN}-s1`)],
    });
    expect(list.artifactsByModel['a#1'].review).toBeUndefined();
    expect(list.artifactsByModel['a#1'].judge).toBeUndefined();
  });

  test('B2: a note whose waveId cannot be matched falls to the WIDER pair (fail-safe)', () => {
    const bench = ['a', 'a', 'a-1', 'a-1'];
    // No runId on the run doc -> the -s2 equality can never hold. Over-contesting is
    // the safe direction: attributing a file that may hold the orphan's prose is the
    // silent misattribution this whole block exists to prevent.
    const list = artifactAllowlist({ bench, seats: seatsFor(bench), degrades: [s2Orphan('a-1')] });
    expect(list.artifactsByModel['a#1'].review).toBeUndefined();
    expect(list.artifactsByModel['a#1'].judge).toBeUndefined();
  });

  test('B2: narrowing the CONTEST never narrows the LIST — a --debate orphan keeps its names', () => {
    const bench = ['gemini', 'gemini'];
    const list = artifactAllowlist({
      runId: S2_RUN, bench, seats: seatsFor(bench), debate: true, degrades: [s2Orphan('gemini')],
    });
    // A debate leg whose raiser key names no seat takes materializeDebate's alias
    // branch, so these can exist on disk with no note recording them. Killing mutant:
    // drive `orphanKinds` off `claimed` -> both of these vanish and readRunArtifact
    // answers `artifact not allowed` for a file that is really there.
    expect(list).toContain('rebuttal-gemini.md');
    expect(list).toContain('revote-gemini.md');
    expect(list).toContain('review-gemini.md');
    expect(list).toContain('judge-gemini.md');
  });

  test('the same bench with every leg BOUND banners nothing and attributes all four', () => {
    const bench = ['a', 'a', 'a-1', 'a-1'];
    const list = artifactAllowlist({ bench, seats: seatsFor(bench), degrades: [] });
    expect(list.collisions).toBeUndefined();
    expect(list.artifactsByModel['a#1'].review).toBe('review-a-1.md');
  });

  test('a twin orphan keeps its landed review readable, attributed to nobody', () => {
    const bench = ['gemini', 'gemini'];
    const list = artifactAllowlist({
      bench, seats: seatsFor(bench), degrades: [orphanNote('gemini')],
    });
    expect(list).toContain('review-gemini.md');
    expect(Object.values(list.artifactsByModel).map(r => r.review))
      .toEqual(['review-gemini-1.md', 'review-gemini-2.md']);
    expect(list.collisions).toBeUndefined();
  });

  // The note carries `leg.modelInput || leg.model`, i.e. the string the WRITER used.
  // Spelling the fallback from `seat.alias` instead would name a file that does not
  // exist and leave the one that does unreachable.
  test('an orphan whose leg reported no modelInput is reachable under its RESOLVED id', () => {
    const bench = ['gemini', 'gemini'];
    const list = artifactAllowlist({
      bench, seats: seatsFor(bench), degrades: [orphanNote('google/gemini-2.5-pro')],
    });
    expect(list).toContain('review-google-gemini-2.5-pro.md');
  });

  // Revision 4 gated fallbacks on "is this seat's primary absent from disk", which
  // made both of these banner a perfectly healthy run.
  test('a healthy --debate twin raises no banner', () => {
    const bench = ['gemini', 'gemini'];
    const list = artifactAllowlist({ bench, seats: seatsFor(bench), debate: true });
    expect(list.collisions).toBeUndefined();
    expect(list).toContain('rebuttal-gemini-1.md');
    expect(list).toContain('revote-gemini-2.md');
  });

  test('a merely-dead seat (no orphan note) raises no banner', () => {
    const bench = ['a', 'a', 'a-1', 'a-1'];
    const list = artifactAllowlist({ bench, seats: seatsFor(bench), degrades: [] });
    expect(list.collisions).toBeUndefined();
  });

  test('a degrade that is not a seat-unbound note, or carries no legId, emits no fallback', () => {
    const bench = ['a', 'a', 'a-1', 'a-1'];
    const seats = seatsFor(bench);
    const other = { channel: 'dead-leg', data: { legId: 'w-s1-9', seat: 'a-1' } };
    const noLeg = { channel: 'seat-unbound', data: { seat: 'a-1' } };
    for (const d of [other, noLeg]) {
      const list = artifactAllowlist({ bench, seats, degrades: [d] });
      expect(list.collisions).toBeUndefined();
      expect(list.artifactsByModel['a#1'].review).toBe('review-a-1.md');
    }
  });
});

describe('byte-identity on everything that orphaned nothing', () => {
  const bench = ['gemini', 'gpt', 'qwen'];
  const baseline = artifactAllowlist({ bench });
  const shapes = {
    'seats absent': { bench },
    'seats null': { bench, seats: null },
    'seats []': { bench, seats: [] },
    'seats populated (unique bench)': { bench, seats: seatsFor(bench) },
    'malformed: duplicate ids': {
      bench, seats: [{ id: 'x', alias: 'x' }, { id: 'x', alias: 'x' }],
    },
    'malformed: empty id': { bench, seats: [{ id: '', alias: 'gemini' }] },
  };
  for (const [label, run] of Object.entries(shapes)) {
    test(`${label} -> identical list, collisions and map`, () => {
      const list = artifactAllowlist(run);
      expect([...list]).toEqual([...baseline]);
      expect(list.collisions).toEqual(baseline.collisions);
      // Key ORDER too: the map is rendered in iteration order.
      expect(JSON.stringify(list.artifactsByModel))
        .toBe(JSON.stringify(baseline.artifactsByModel));
    });
  }

  // RN-1 must survive the rebuild: two DISTINCT aliases that coincide after
  // sanitizeName is still a genuine run-integrity defect, still `~2`-suffixed,
  // still bannered. Deleting the machinery in favour of seat ids would re-open it.
  test('the preserved sanitize collision is unchanged in seat space', () => {
    const b = ['vendor/a', 'vendor?a'];
    const withSeats = artifactAllowlist({ bench: b, seats: seatsFor(b) });
    const legacy = artifactAllowlist({ bench: b });
    expect([...withSeats]).toEqual([...legacy]);
    expect(withSeats.collisions).toEqual([
      { sanitized: 'vendor-a', models: ['vendor/a', 'vendor?a'] },
    ]);
    expect(withSeats.artifactsByModel['vendor?a'].review).toBe('review-vendor-a~2.md');
  });
});

describe('isSeatTable narrows the shared predicate', () => {
  // ⚠️ Both conjuncts are observable ONLY on the name list. `collisions` is
  // `undefined` with and without them, which is why revision 2's mutant could not
  // fire and revision 3 then deleted the guard on the strength of that dead mutant.
  test('an empty seat id does not mint `review-.md` or a "" map key', () => {
    const list = artifactAllowlist({ bench: ['gemini'], seats: [{ id: '', alias: 'gemini' }] });
    expect(list).not.toContain('review-.md');
    expect(Object.keys(list.artifactsByModel)).toEqual(['gemini']);
  });

  test('duplicate seat ids do not mint a one-model "collision"', () => {
    const list = artifactAllowlist({
      bench: ['gemini', 'gemini'],
      seats: [{ id: 'gemini#1', alias: 'gemini' }, { id: 'gemini#1', alias: 'gemini' }],
    });
    expect(reviewsIn(list)).toEqual(['review-gemini.md']);
    expect(list.collisions).toBeUndefined();
  });
});
