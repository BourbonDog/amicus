// tests/council/run-stats-entry.test.js
'use strict';

const fs = require('fs');
const path = require('path');

const asm = require('../../src/council/run-assemble');
const rse = require('../../src/council/run-stats-entry');

describe('run-stats-entry — extraction pins (v4.8 Phase 1 T1.1)', () => {
  test('P1 — re-export is the SAME function object, not a copy', () => {
    // Every production consumer (run-chair.js:23, run-stage1-rows.js:9,
    // run-stage2.js:26, run-stages.js:27, run-stage1-superseded.js — added by the v4.8 T-A6
    // split, and deliberately carrying NO line number so it cannot rot — run-finish.js
    // via `asm.`) writes
    // require('./run-assemble') — a different specifier string than `asm`
    // above, but CommonJS resolves both to the same absolute path and
    // caches by resolved path: one entry, shared by every requirer, no
    // resetModules in this project's jest config. So this identity check
    // covers every consumer's own spelling of the require — there is no
    // second, independently-testable import path for a separate pin to add.
    expect(asm.buildRunStatsEntry).toBe(rse.buildRunStatsEntry);
  });

  test('P3 — the module is REQUIRE-FREE, so require-free consumers can import it', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../src/council/run-stats-entry.js'), 'utf8');
    expect(src.match(/require\(/g)).toBeNull();
  });
});

/**
 * v4.9 W13 Task A — the TTFT probe's last hop: the runStats row.
 *
 * `ttftMs` is read off the LEG run document (buildRunResult already carries it
 * when set), exactly the way `waveId` and `resolvedModel` are, so every one of
 * the ten `buildRunStatsEntry({...})` call sites that holds a leg gets it with
 * no caller change and none can be forgotten. See the DEVIATION note on the
 * production side for why that shape was chosen over a threaded parameter.
 *
 * PROBE ONLY: nothing in the engine derives a backstop, a threshold, or a
 * routing decision from this number. It exists so the C2 derivation has real
 * observations to work from later (W13 R12: probe first, derive later).
 *
 * Named mutant TTFTDROP — delete the `ttftMs` emit from
 * `src/headless.js`'s poll loop (the `if (ttftMs === null && substantiveActivity)`
 * line) so the measure never records. Its measured red set is recorded beside
 * the measure itself, in tests/no-output-backstop-wiring.test.js. These rows
 * stay GREEN under it BY DESIGN: they take a leg document as INPUT and never
 * run headless, so they pin the carry, not the measure. Do not "fix" them to
 * red here.
 */
describe('run-stats-entry — the TTFT probe rides the row (v4.9 W13 Task A)', () => {
  const legWith = (extra) => ({ model: 'openrouter/x/y', status: 'complete', durationMs: 42, usage: null, ...extra });

  test('a leg carrying ttftMs stamps it verbatim on the row', () => {
    const row = rse.buildRunStatsEntry({
      leg: legWith({ ttftMs: 1234 }), model: 'alias', role: 'reviewer', wasChair: false,
    });
    expect(row.ttftMs).toBe(1234);
  });

  test('zero survives — a first substantive tick inside the first poll is a real measurement, not an absence', () => {
    const row = rse.buildRunStatsEntry({
      leg: legWith({ ttftMs: 0 }), model: 'alias', role: 'reviewer', wasChair: false,
    });
    expect(row.ttftMs).toBe(0);
    expect('ttftMs' in row).toBe(true);
  });

  // The absence pin. A row built from a leg that produced nothing must be
  // byte-identical to the pre-W13 row — key set and all — so every existing
  // review/task/legacy tally artifact is unchanged when the field is absent.
  test('ABSENCE: a leg with no ttftMs yields a row with NO ttftMs key at all', () => {
    const row = rse.buildRunStatsEntry({
      leg: legWith({}), model: 'alias', role: 'reviewer', wasChair: false,
    });
    expect('ttftMs' in row).toBe(false);
    expect(Object.keys(row)).toEqual([
      'model', 'role', 'wasChair', 'conformance', 'resolvedModel', 'status', 'durationMs', 'usage',
    ]);
  });

  test('ABSENCE: a dead seat (leg: null) carries no ttftMs key', () => {
    const row = rse.buildRunStatsEntry({ leg: null, model: 'alias', role: 'reviewer', wasChair: false });
    expect('ttftMs' in row).toBe(false);
    expect(Object.keys(row)).toEqual(['model', 'role', 'wasChair', 'conformance', 'status', 'durationMs', 'usage']);
  });

  test('ABSENCE: a non-number ttftMs (null / string from a hand-edited artifact) is dropped, never echoed', () => {
    for (const bad of [null, undefined, '1234', {}]) {
      const row = rse.buildRunStatsEntry({
        leg: legWith({ ttftMs: bad }), model: 'alias', role: 'reviewer', wasChair: false,
      });
      expect('ttftMs' in row).toBe(false);
    }
  });

  /**
   * PR #207 council round 3, B3 — a `typeof x === 'number'` gate is not the
   * schema's contract. `council-tally.schema.json` declares this field
   * `integer, minimum 0`; `typeof` admits four families that violate it:
   *   · NaN       — serializes to JSON `null`, which the schema forbids outright
   *   · ±Infinity — REACHABLE from a real artifact (MEASURED:
   *                 `JSON.parse('1e999')` is `Infinity`), also serializes to null
   *   · negative  — the probe is a `Date.now()` delta, so a backward wall-clock
   *                 jump measures below zero
   *   · fractional— a hand-edited leg document
   */
  test('ABSENCE: a dishonest NUMBER (NaN / Infinity / negative / fractional) is dropped, never echoed', () => {
    for (const bad of [NaN, Infinity, -Infinity, -5, -1, 1.5]) {
      const row = rse.buildRunStatsEntry({
        leg: legWith({ ttftMs: bad }), model: 'alias', role: 'reviewer', wasChair: false,
      });
      expect('ttftMs' in row).toBe(false);
    }
  });
});

/**
 * PR #207 council round 3, B3 — ONE predicate, spelled once, at every gate.
 *
 * There are five `ttftMs` sites in src/: the probe that computes it
 * (src/headless.js's poll loop) and four EMIT GATES that decide whether the key
 * rides a document. Every gate used to spell its own `typeof … === 'number'`,
 * which is four chances to disagree and, as the pin above records, four ways to
 * ship a value the schema forbids.
 *
 * The predicate now lives in `src/utils/ttft.js :: isMeasuredTtft`. Three gates
 * IMPORT it. The fourth — `src/council/run-stats-entry.js` — cannot: P3 above
 * pins that module REQUIRE-FREE so require-free consumers (./debate.js) can
 * import it, and the pin fires on the character sequence anywhere in the file,
 * comments included. It therefore spells the same expression inline, and this
 * describe is what keeps the hand-spelled copy in step with the shared one.
 *
 * These are STRUCTURAL pins. The behavioural drift pins live with each surface:
 * the row above, `tests/sidecar/fanout.test.js` (leg patch + wave doc) and
 * `tests/no-output-backstop-wiring.test.js` (the probe's own clock-skew ruling).
 *
 * Named mutant "GATESPLIT" — revert ONE gate to a bare type test. Measured per
 * gate, 2026-08-26, at the shared 8-suite scope named in
 * tests/alias-shadow.test.js's header — 323 tests when these sets were first
 * taken at round 3, 330 after round 4 grew that file; all four variants were
 * re-run at 330 and every set below is UNCHANGED. Every gate has BEHAVIOURAL
 * cover; the
 * structural pins are what make the drift legible when it happens:
 *   · rse           RED 2 / 1 — the dishonest-number row above · "…spells the
 *                   SAME expression by hand"
 *   · fanout-leg    RED 3 / 2 — "…dropped on BOTH hops" and the `result &&`
 *                   shape pin (tests/sidecar/fanout.test.js) · "…gates import it"
 *   · result-schema RED 2 / 1 — "buildRunResult drops a dishonest
 *                   metadata.ttftMs" · "…gates import it"
 *   · headless      RED 2 / 2 — "CLOCK SKEW…"
 *                   (tests/no-output-backstop-wiring.test.js) · "…gates import it"
 * ⚠️ The result-schema fixture had to be written DIRECTLY against
 * `buildRunResult`, not driven through fanout: MEASURED, the fanout pin stays
 * GREEN under GATESPLIT:result-schema, because fanout-leg's gate drops the bad
 * value one hop earlier. A gate whose only exposure runs through another gate
 * has no cover at all.
 */
describe('the ttftMs emit gate is ONE predicate (PR #207 round 3, B3)', () => {
  const ROOT = path.join(__dirname, '..', '..');
  const IMPORTERS = ['src/headless.js', 'src/sidecar/fanout-leg.js', 'src/utils/result-schema.js'];
  const INLINE = 'src/council/run-stats-entry.js';

  /**
   * Files that NAME `ttftMs` without being a site — comment mentions only, each
   * with a decision already made. The roster pin below fires on any file
   * containing the token, which is what gives it teeth; this list is where a
   * mention earns its exemption by carrying the DECISION, not by being quiet.
   *
   * `council/debate.js` (v4.9 W14): `mk` deliberately does NOT forward `ttftMs`
   * to debate rows, and the comment beside the fold says so and names the field.
   * The decision the pin exists to force was made and filed — widening `mk` is a
   * behaviour change with its own pins, recorded in BACKLOG. The absence itself
   * is pinned as G1e in tests/council/runstats-byte-order.test.js, so this is a
   * documented non-gate, not an unexamined sixth site. ⚠️ Do NOT move an entry
   * from here into IMPORTERS to silence a failure: that list also drives "the
   * three importable gates import it", which requires a real `isMeasuredTtft`
   * call. A file that gates belongs there; a file that talks belongs here.
   */
  const MENTIONS_ONLY = ['src/council/debate.js'];

  /** Every .js file under src/, repo-relative, forward-slashed. */
  function srcFiles(dir = 'src') {
    const out = [];
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { out.push(...srcFiles(rel)); }
      else if (e.name.endsWith('.js')) { out.push(rel); }
    }
    return out;
  }

  test('the shared predicate accepts non-negative INTEGERS and nothing else', () => {
    const { isMeasuredTtft } = require('../../src/utils/ttft');
    for (const ok of [0, 1, 1234, Number.MAX_SAFE_INTEGER]) { expect(isMeasuredTtft(ok)).toBe(true); }
    for (const bad of [NaN, Infinity, -Infinity, -1, -5, 1.5, 0.1,
      null, undefined, '1234', '', {}, [], true, false]) {
      expect(isMeasuredTtft(bad)).toBe(false);
    }
  });

  /**
   * `buildRunResult`'s gate needs its OWN fixture, MEASURED rather than assumed.
   * The fanout pin in tests/sidecar/fanout.test.js drives both on-disk and
   * wave-doc hops at once, but `fanout-leg.js`'s gate drops a dishonest value
   * FIRST — so under a mutant that reverts only this gate, that pin stays green
   * and the drift would be invisible. The real exposure is the rebuild path:
   * `buildRunResult` also serves `read <taskId> --json`, reading a metadata.json
   * written by some other producer, an older amicus, or a hand edit.
   */
  test('buildRunResult drops a dishonest metadata.ttftMs (the rebuild path has no upstream gate)', () => {
    const { buildRunResult } = require('../../src/utils/result-schema');
    for (const bad of [NaN, Infinity, -Infinity, -5, 1.5]) {
      const doc = buildRunResult({ taskId: 't1', metadata: { status: 'complete', ttftMs: bad } });
      expect(`${bad}: ${'ttftMs' in doc}`).toBe(`${bad}: false`);
    }
    // CONTROL: a real measurement, and a real 0, still ride the document.
    for (const ok of [0, 4321]) {
      expect(buildRunResult({ taskId: 't1', metadata: { status: 'complete', ttftMs: ok } }).ttftMs).toBe(ok);
    }
  });

  test('the three importable gates import it', () => {
    for (const f of IMPORTERS) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\s+/g, ' ');
      expect(src).toMatch(/require\(['"][^'"]*ttft['"]\)/);
      expect(src).toMatch(/isMeasuredTtft\(/);
    }
  });

  // Matched as an ordered TOKEN sequence, not as a source line: the round-2 B2
  // lesson is that pinning formatting breaks the suite for reasons unrelated to
  // the property. Any spacing/wrapping of the same expression passes.
  test('the require-free gate spells the SAME expression by hand', () => {
    const src = fs.readFileSync(path.join(ROOT, INLINE), 'utf8').replace(/\s+/g, ' ');
    expect(src).toMatch(/Number\.isInteger\(\s*ttftMs\s*\)\s*&&\s*ttftMs\s*>=\s*0/);
    expect(src.match(/require\(/g)).toBeNull(); // P3's invariant is why it is hand-spelled
  });

  /**
   * The drift guard with real teeth: a SIXTH site cannot appear unnoticed. A new
   * producer that touches `ttftMs` fails here until someone decides whether it is
   * a gate, and if so gates it. This is the one pin that can see a file nobody
   * thought to add to the lists above. A comment-only mention lands here too, by
   * design — it is still a decision someone has to make; `MENTIONS_ONLY` is where
   * that decision is recorded, and every entry there carries its reason.
   */
  test('no ttftMs site in src/ escapes the roster', () => {
    const touching = srcFiles().filter(
      (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').includes('ttftMs'));
    expect(new Set(touching))
      .toEqual(new Set([...IMPORTERS, INLINE, 'src/utils/ttft.js', ...MENTIONS_ONLY]));
  });

  /**
   * The exemption cannot rot into a blanket one: an entry that stops mentioning
   * `ttftMs`, or that quietly grows a real gate, must be re-decided rather than
   * left standing. Same anti-rot shape as the F-1 doc pin's allowlist checks.
   */
  test('every MENTIONS_ONLY entry still mentions ttftMs and still gates nothing', () => {
    for (const f of MENTIONS_ONLY) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      expect({ f, mentions: src.includes('ttftMs') }).toEqual({ f, mentions: true });
      expect({ f, gates: /isMeasuredTtft\(/.test(src) }).toEqual({ f, gates: false });
    }
  });
});
