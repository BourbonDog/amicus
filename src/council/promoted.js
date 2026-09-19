/**
 * @module council/promoted
 * The ONE vocabulary for a leg that answered only in its reasoning channel (#257).
 * The engine's last message carried no text part, so conversation-mirror.js
 * promoted the accumulated reasoning into the leg's output.
 *
 * ⚠️ The JSDoc leads this file, ahead of `'use strict'` and with no `// <path>`
 * line above it, matching `utils/ttft.js:1-9`: `scripts/generate-docs.js` reads
 * only a block comment that starts at byte zero, so a path comment there would
 * leave this module's `docs/architecture-map.md` row blank.
 *
 * A LEAF — it requires nothing — so run-retry-group.js (leaf-only by header)
 * and any require-free consumer can import it.
 *
 * `promoted` is emit-when-true on every leg document (headless.js mints it from
 * `mirror.promotedOutput` at the normal terminal return; fanout-leg.js,
 * session-utils.js, leg-riders.js, run-stats-entry.js and tally.js carry it).
 * A promoted Stage-1 leg is NOT a review (run-launch.js :: materializeReviews
 * skips it, so the once-only retry fires); a promoted judge is used when its
 * fenced block parses, or when the judge repair supplies one, and a
 * `judge-reasoning-only` note names which (run-stage2.js, run-stage2-notes.js).
 */
'use strict';

/** The literal `true`, nothing else — the same discipline as `variantUnverified`. */
function isPromotedLeg(leg) {
  return !!leg && typeof leg === 'object' && leg.promoted === true;
}

/**
 * The facts every announcement of a promoted leg names, read off the leg
 * document; null for a leg that is not promoted so callers can spread
 * `...(facts ? { promoted: facts } : {})`.
 */
function promotedFacts(leg) {
  if (!isPromotedLeg(leg)) { return null; }
  const t = (leg.usage && leg.usage.tokens) || {};
  return {
    reasoning: Number.isInteger(t.reasoning) && t.reasoning >= 0 ? t.reasoning : 0,
    output: Number.isInteger(t.output) && t.output >= 0 ? t.output : 0,
    finish: typeof leg.finish === 'string' && leg.finish ? leg.finish : null,
  };
}

/**
 * The one clause the retry heal note, the still-dead notes and the skipped-leg
 * note append after "with no usable output". The EMPTY STRING for anything
 * that is not a facts object, so every announcement for a leg that is not
 * promoted stays byte-identical (spec R9).
 */
function reasoningOnlyClause(facts) {
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) { return ''; }
  const finish = facts.finish ? `, finish '${facts.finish}'` : '';
  return ` — it answered only in its reasoning channel (${facts.reasoning} reasoning / ${facts.output} output tokens${finish}), which is not a review`;
}

module.exports = { isPromotedLeg, promotedFacts, reasoningOnlyClause };
