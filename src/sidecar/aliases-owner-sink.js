/**
 * @module sidecar/aliases-owner-sink
 * The owner-mode write path for `amicus aliases --review --owner` (#238 D8),
 * split out of aliases-owner.js (council round 2 fix wave — the CAS-skew fix
 * (G1) and the sticky-refusal fixes (G2) pushed that file past the 300-line
 * gate).
 *
 * `commit()` is the ONE compare-and-swap write every owner-mode write goes
 * through (#238 council r1 F1): refuse (throw, nothing written) when
 * curated-pins.json changed on disk since this session loaded it (see its
 * own docblock for the HELD non-atomicity caveat).
 *
 * `askRulings()` walks every touched pin after the review passes, prompting
 * for an optional one-line ruling; a CAS refusal is STICKY (the disk will
 * never re-match the baseline again for the rest of the session), so it
 * breaks the loop rather than asking for more doomed writes (#238 council r2
 * G2/A4/B2).
 */

'use strict';

const { setPinRuling } = require('../utils/curated-pins');
const { collapseExcerpt, safeFragment } = require('../utils/text-sanitize');

/**
 * Compare-and-swap write: refuse (throw, nothing written) when
 * curated-pins.json changed on disk since this session loaded it — a
 * concurrent session or a hand edit mid-walk must never be clobbered. On
 * success, advances the in-memory doc and the CAS baseline together, so a
 * later write in the SAME session compares against what THIS write landed.
 * Shared by the sink (`aliases-owner.js :: passDeps`'s `addAlias`) and
 * `askRulings`; both print `could not write: …` on refusal. Mutant NOCAS:
 * drop the comparison. HELD (#238 council r2 B1/A3): not atomic end-to-end —
 * a write landing in the microseconds between the read above and
 * `saveCuratedPins`'s rename is not detected (inherent to a lock-free file
 * CAS, same property as this repo's other atomic-write stores; `git diff`
 * still surfaces it).
 * @param {{doc: object, diskBytes: string, casRefused?: boolean}} state mutated in place
 * @param {object} next the new document to write
 * @param {{readCuratedPinsBytes: () => string, saveCuratedPins: (doc: object) => void}} d
 */
function commit(state, next, d) {
  const onDisk = d.readCuratedPinsBytes();
  if (onDisk !== state.diskBytes) {
    state.casRefused = true; // the closing summary reports this instead of "no pin changed" -- that line is false once the file changed under us
    throw new Error('curated-pins.json changed on disk since this session loaded it — restart the review to pick up the change (nothing was written)');
  }
  d.saveCuratedPins(next);          // Mutant SAVEFIRST: assign state.doc before this line
  state.diskBytes = JSON.stringify(next, null, 2) + '\n';
  state.doc = next;
}

/**
 * After the walk: one optional ruling per touched pin; enter keeps the
 * current text; each answer is written at once.
 * @param {{doc: object, touched: Set<string>, diskBytes: string, casRefused?: boolean}} state
 * @param {(q: string) => Promise<string>} ask
 * @param {{write: (s: string) => void, readCuratedPinsBytes: () => string, saveCuratedPins: (doc: object) => void}} d
 */
async function askRulings(state, ask, d) {
  if (state.touched.size === 0) { return; }
  d.write('  rulings — a sentence on WHY, stored beside the pin (enter keeps the current text):\n');
  for (const alias of state.touched) {
    const pin = state.doc.pins[alias];
    // F5/G4: a ruling is free text from an interactive prompt, rendered back
    // later -- sanitize before showing it; the alias itself rides safeFragment
    // too (the one render site here that used to skip it).
    d.write(`  ${safeFragment(alias)} → ${Object.values(pin.routes).map(safeFragment).join(', ')}\n    current: ${pin.ruling ? collapseExcerpt(pin.ruling) : '(none)'}\n`);
    const ans = String((await ask('    ruling: ')) || '').trim();
    if (!ans) { continue; }
    try {
      commit(state, setPinRuling(state.doc, alias, ans), d);
    } catch (err) {
      d.write(`    could not write: ${collapseExcerpt(err.message)}\n`);
      // G2: casRefused is sticky -- every remaining ruling is guaranteed to fail the same way.
      if (state.casRefused) { break; }
    }
  }
}

module.exports = { commit, askRulings };
