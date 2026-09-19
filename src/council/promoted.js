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
 * A `finish` identifier's cap — the same ceiling `schemas/run.schema.json` puts
 * on the backstop's `status`, and the one `session-status.js` spells as
 * `MAX_STATUS_TYPE_CHARS`: an identifier, not a sentence.
 */
const MAX_FINISH_CHARS = 40;

/**
 * The facts every announcement of a promoted leg names, read off the leg
 * document; null for a leg that is not promoted so callers can spread
 * `...(facts ? { promoted: facts } : {})`.
 *
 * `finish` is PROVIDER text, and every reader interpolates it RAW — into the
 * five Stage-1 announcements, and into verdict.json's `seatLoss.reason`, which
 * CI renders into a sticky PR comment. It is therefore BOUNDED here, at the one
 * producer, rather than at each reader (repo rule #219, and the house rule that
 * one value has one sanitizer): everything outside printable ASCII is DROPPED —
 * C0 controls, DEL, an ANSI escape's introducer, bidi overrides that would
 * reorder the sentence it is quoted into — and what remains is cut to
 * `MAX_FINISH_CHARS`. Nothing printable left means there was no usable finish,
 * so it is `null`, indistinguishable from an absent one.
 *
 * HAND-SPELLED, not `text-sanitize.js :: collapseExcerpt`: this module is a LEAF
 * (see the header) and requiring the house sanitizer would end that. The
 * dialects differ deliberately — a `finish` is an identifier the provider
 * chooses from a small set ('stop', 'length', 'tool_calls'), so a stray byte in
 * one is corruption to drop, not prose to collapse into spaces.
 */
function promotedFacts(leg) {
  if (!isPromotedLeg(leg)) { return null; }
  const t = (leg.usage && leg.usage.tokens) || {};
  const finish = typeof leg.finish === 'string'
    ? leg.finish.replace(/[^\x20-\x7e]/g, '').slice(0, MAX_FINISH_CHARS)
    : '';
  return {
    reasoning: Number.isInteger(t.reasoning) && t.reasoning >= 0 ? t.reasoning : 0,
    output: Number.isInteger(t.output) && t.output >= 0 ? t.output : 0,
    finish: finish || null,
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
