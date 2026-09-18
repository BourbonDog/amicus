// tests/utils/redaction-perimeter.test.js
'use strict';

/**
 * #256 / council #264 r2 (HQ4, finding D4) — THE REDACTION PERIMETER, PINNED.
 *
 * The earlier comment asserted "the two seams where provider prose enters a
 * death reason, and no more". deepseek's objection was not that the claim was
 * wrong; it was that the claim was UNVERIFIABLE from the diff — a third entry
 * point could appear and nothing would notice, because a claim in a comment is
 * not a check.
 *
 * So this file makes it one. It enumerates every site that assigns a leg's
 * death reason in `src/headless.js` and `src/sidecar/fanout-leg*.js`, classifies
 * each by WHERE ITS TEXT COMES FROM, and asserts the multiset is exactly the
 * known one. A new assignment site — or an old one whose source changes —
 * produces an unrecognised entry and reddens this test, instead of silently
 * bypassing `redactProviderError`.
 *
 * The perimeter, stated once so the classification below has something to mean:
 *   ENGINE-AUTHORED text (a provider can put anything in it, including a key
 *   identifier) enters at exactly TWO sites, and both redact:
 *     - the assistant message's own error, in the poll loop;
 *     - the engine-log excerpt a no-output backstop folds in
 *       (`engineErrorExcerptSafe`, which redacts at its own seam).
 *   Everything else is AMICUS-AUTHORED: a fixed string, a template amicus
 *   writes, an HTTP/Node error message, or a routing diagnosis. Those carry no
 *   provider prose, so they are not redacted — and if one ever starts to, this
 *   test is where it is noticed.
 */

const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf-8');

/**
 * Classify one right-hand side by the ORIGIN of the text it puts in the reason.
 * An unrecognised shape is deliberately returned verbatim so the failure message
 * names the new site instead of a generic count mismatch.
 */
function classify(rhs) {
  const s = rhs.trim();
  if (/^null\b/.test(s)) { return 'declaration'; }
  if (s.includes('redactProviderError(')) { return 'ENGINE:redacted'; }
  // #251 item 1: `noOutputBackstopReason(` rather than `noOutputBackstopReason()` —
  // both firing sites now hand it the status they already read and the extension
  // record. NOT a new site and NOT a new text origin: the record's clause is built
  // from numbers amicus measured, a sanitised status identifier and an ISO timestamp
  // amicus formatted (utils/no-output-backstop.js :: formatBackstopExtensionClause).
  // The engine-authored inputs on this path are the engine-log excerpt (redacted at
  // its own seam) and the session clause's retry `message` (sanitised at render by
  // `collapseExcerpt`); the extension clause carries only a sanitised type identifier,
  // integers and an amicus-formatted timestamp.
  if (s.includes('noOutputBackstopReason(')) { return 'AMICUS:backstop (engine-log excerpt redacted at its own seam)'; }
  // Council #269 r1 (A1/B1/C2): the decision block's own catch kills under the backstop's
  // name instead of letting a throw be retried as a poll failure. It calls the PURE
  // module-scope formatter (not the closure — the closure does I/O, and this site is
  // already handling a failure), with no engine-log excerpt and no skew: its only variable
  // text is `decisionErr.message`, an amicus-authored exception from amicus's own decision
  // code, carried through `probeUnknown` and sanitised at render by `collapseExcerpt`
  // (utils/session-status.js). The load-bearing reason no provider prose reaches it:
  // `sessionStatusSafe` converts every engine/SDK rejection into a `probeUnknown` RETURN,
  // never a throw, and the decision is pure — so the only throwable inside the block is
  // amicus's own code. A NEW site, deliberately classified, not a shape that slipped in.
  if (s.includes('formatNoOutputBackstopReason(')) { return 'AMICUS:backstop decision failure (no engine text)'; }
  if (s.includes('promptResult.providerError')) { return 'AMICUS:client-boundary synthetic'; }
  if (s.includes('formatOutputLengthReason(')) { return 'AMICUS:output-length'; }
  if (s.startsWith('sessionError')) { return 'AMICUS:poll-failure fallback'; }
  if (s.startsWith('`')) { return 'AMICUS:template'; }
  return `UNCLASSIFIED: ${s.slice(0, 80)}`;
}

describe('#256 the redaction perimeter is enumerated, not asserted', () => {
  test('src/headless.js assigns a death reason at exactly these sites', () => {
    const src = read('src/headless.js');
    const sites = [...src.matchAll(/sessionError\s*=(?!=)([^\n]*)/g)].map((m) => classify(m[1]));

    // ⚠️ A CHANGE HERE IS A DESIGN DECISION, NOT A TEST FIX. Adding a site means
    // deciding whether its text can carry provider prose; if it can, it belongs
    // behind redactProviderError BEFORE this list grows.
    expect(sites).toEqual([
      'declaration',
      'AMICUS:backstop (engine-log excerpt redacted at its own seam)',  // pre-send firing site
      'AMICUS:client-boundary synthetic',                                // #37
      'ENGINE:redacted',                                                 // the assistant message's error
      'AMICUS:template',                                                 // RETRY_BEYOND_DEADLINE
      'AMICUS:backstop (engine-log excerpt redacted at its own seam)',  // poll-loop firing site
      'AMICUS:backstop decision failure (no engine text)',                // #269 r1 A1/B1/C2
      'AMICUS:template',                                                 // tool-call stall
      'AMICUS:poll-failure fallback',                                    // F4
      'AMICUS:output-length',                                            // #218 PR 3
    ]);

    // Exactly ONE site takes engine prose, and it redacts.
    expect(sites.filter((s) => s.startsWith('ENGINE:'))).toEqual(['ENGINE:redacted']);
    expect(sites.filter((s) => s.startsWith('UNCLASSIFIED'))).toEqual([]);
  });

  test('the engine-log excerpt redacts at its own seam, which is the second entry point', () => {
    const src = read('src/headless.js');
    // The backstop reason folds this in, so redacting it HERE covers both of the
    // backstop's firing sites with one call.
    expect(src).toMatch(/return redactProviderError\(engineErrorForSession\(/);
    // And those are the only two CALLS in the file: entry points, not consumers.
    // (The destructuring `require` names the symbol without calling it.)
    expect(src.match(/redactProviderError\(/g)).toHaveLength(2);
  });

  test('src/sidecar/fanout-leg*.js builds a leg error only from amicus-authored text', () => {
    // Every leg attempt — first AND retry — runs through runSingleAttempt here,
    // which is why the two headless.js seams cover both. These two sites are the
    // only places this module puts text in a leg's `error`.
    const src = read('src/sidecar/fanout-leg.js');
    const sites = [...src.matchAll(/\berror:\s*([^,\n]*)/g)].map((m) => m[1].trim());
    expect(sites).toEqual([
      'message',       // buildRoutingFailureLeg: route-error.js :: toCliMessage, amicus-authored
      'err.message',   // a thrown Node/HTTP error, amicus-observed
    ]);
    // buildRoutingFailureLeg sits OUTSIDE the two seams by construction: it
    // never calls runHeadless. That is safe only while its text stays
    // amicus-authored — pinned here so a provider string arriving in
    // toCliMessage has to pass this test first.
    expect(src).toContain("const { toCliMessage } = require('../utils/route-error')");
    expect(read('src/sidecar/fanout-leg-fallback.js')).not.toMatch(/\berror:\s/);
  });
});
