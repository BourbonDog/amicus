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
 * skips it, so the once-only retry fires). A promoted Stage-2 judge is never
 * used as it stands — it is relaunched once with the ORIGINAL bundle (R-X32),
 * and a `judge-reasoning-only` note names how that ended (run-stage2-judge.js,
 * run-stage2-notes.js); a promoted debate defence or re-vote is likewise
 * relaunched with its original briefing (R-X33).
 */
'use strict';

/** The literal `true`, nothing else — the same discipline as `variantUnverified`. */
function isPromotedLeg(leg) {
  return !!leg && typeof leg === 'object' && leg.promoted === true;
}

/**
 * A `finish` identifier's cap — the same ceiling `schemas/run.schema.json` puts
 * on the backstop's `status`, and the one `session-status.js` spells as
 * `MAX_STATUS_TYPE_CHARS`: an identifier, not a sentence. It is the SECOND of
 * the three bounds `promotedFacts` applies: the token allowlist decides WHICH
 * characters may reach this ceiling at all, this decides how many, and the
 * intraword-underscore rule then runs on what the cut actually LEFT — in that
 * order, so the cut itself cannot strand a trailing `_` the rule never saw.
 */
const MAX_FINISH_CHARS = 40;

/**
 * Bound 1 — the ALLOWLIST: the characters a `finish` is really spelled with.
 * Every other character is dropped (the why is on `promotedFacts`).
 */
const FINISH_ALLOWED = /[^A-Za-z0-9_.:-]/g;

/**
 * Bound 3 — every `_` WITHOUT an alphanumeric on both sides. CommonMark's
 * flanking rules are the whole reason only THAT underscore may stay: a leading,
 * trailing or doubled one can open or close emphasis (`_x_`, `__x__`), while an
 * intraword one (`end_turn`) can do neither and is inert wherever it is quoted.
 */
const FINISH_LONE_UNDERSCORE = /(?<![A-Za-z0-9])_|_(?![A-Za-z0-9])/g;

/**
 * The facts every announcement of a promoted leg names, read off the leg
 * document; null for a leg that is not promoted so callers can spread
 * `...(facts ? { promoted: facts } : {})`.
 *
 * `reasoning` and `output` are null when the count was not REPORTED — absent
 * `usage`, absent `usage.tokens`, or a value that is not a non-negative
 * integer — never a fabricated `0` (R-X44, council round 4, D2 major, both
 * Confirmed 3-0: "promotedFacts floors absent or invalid usage tokens to 0, so
 * every announcement asserts a confident '(0 reasoning / 0 output tokens)' for
 * a promoted leg whose usage was not recorded"). A REPORTED zero stays `0` —
 * a reported zero is a fact, not the same thing as an unrecorded one.
 * `tokenSplit` below is where that distinction actually reaches prose.
 *
 * `finish` is PROVIDER text, and every PROSE surface interpolates it RAW: the
 * five Stage-1 announcements, the `Notice:` lines run-degrade.js writes to
 * stderr, the degrade text carried in run.json / verdict.json, and the MARKDOWN
 * REPORT — `report-md.js :: renderMd` renders each degrade record as a LIST
 * ITEM (`- ` + formatDegrade(d)), which `amicus council report`
 * (`cli-handlers-council.js`) writes to stdout, and which the `amicus_verdict`
 * MCP tool (schema `mcp-tools.js:514`, handler `mcp-server.js :: amicus_verdict`)
 * returns to a client to RENDER when called with `render: true` — there is no
 * separate MCP `report` tool. That list item is the one surface where a
 * Markdown-active character actually renders; the
 * on-disk report artifact is report.html, and report-html.js escapes it. The
 * bound is applied HERE, at the one producer, for all of them, rather than at
 * each reader (repo rule #219, and the house rule that one value has one
 * sanitizer).
 *
 * NOT the sticky PR comment, which council r1 and r2 both named and r3
 * measured: .github/workflows/council-review.yml composes that comment from the
 * verdict line, the tier table, the four tier sections and the
 * withdrawn-in-debate list (each one run through the workflow's own
 * byte-identical `neutralize()` sed filter), the street-cred table, and a
 * status/cost footer carrying the seat census.
 * `seatLoss` and `degrades` are interpolated NOWHERE in that step, which is
 * what makes the guarantee STRUCTURAL rather than a matter of configuration:
 * the default PR path asks for no `--critic`, but the `critic`
 * `workflow_call` input can ask for one (the workflow has no `workflow_dispatch`
 * trigger at all) and this prose still would not reach the comment.
 *
 * The MACHINE fields are deliberately NOT bounded and do not need to be:
 * headless.js PRODUCES the provider's raw `finish`, session-finalize.js writes
 * it into metadata.json, and fanout-leg.js and leg-riders.js carry it onto the
 * leg documents that wave.json and the `--json` run documents are built from.
 * (run-stats-entry.js carries no `finish` at all, and run-assemble.js derives
 * only the boolean `cut` from it.) That is DATA a consumer matches on, not
 * PROSE a renderer interprets — the bound exists to stop provider text becoming
 * markup, and nothing renders those.
 *
 * The bound is three steps:
 *   1. an ALLOWLIST of the token characters a finish is actually spelled with —
 *      `A-Z a-z 0-9 _ . : -`, enough for every real value ('stop', 'length',
 *      'end_turn', 'tool_calls', 'content-filter', 'stop:1') — and every other
 *      character is DROPPED;
 *   2. what remains is cut to `MAX_FINISH_CHARS`;
 *   3. every `_` that is not INTRAWORD is dropped. Step 1 has to keep `_`
 *      because real values are spelled with it, but CommonMark opens emphasis
 *      on a leading, trailing or doubled underscore (`_x_` is emphasis, `__x__`
 *      is strong emphasis, and a trailing one can close a run opened elsewhere
 *      in the same line); only an underscore with an alphanumeric on BOTH sides
 *      can neither open nor close it (council r3). `end_turn` and `a_b-c.d:e`
 *      keep theirs; `_x_`, `x_`, `a__b`, `-_-` and `a_.b` lose theirs.
 * Nothing left means there was no usable finish, so it is `null`,
 * indistinguishable from an absent one.
 *
 * An ALLOWLIST, not the printable-ASCII strip this started as (council r2): a
 * strip keeps every Markdown-active character, so a provider-controlled finish
 * of `[click](http://x)` would reach that rendered report as a LINK. The
 * allowlist drops brackets, parentheses, backticks, angle brackets, pipes and
 * spaces for the same reason it drops C0 controls, DEL, an ANSI escape's
 * introducer and the bidi overrides that would reorder the sentence it is
 * quoted into: none of them belong in an identifier.
 *
 * HAND-SPELLED, not `text-sanitize.js :: collapseExcerpt`: this module is a LEAF
 * (see the header) and requiring the house sanitizer would end that. The
 * dialects differ deliberately — a `finish` is an identifier the provider
 * chooses from a small set ('stop', 'length', 'tool_calls'), so a stray byte in
 * one is corruption to drop, not prose to collapse into spaces.
 */
/**
 * #257 R-X44(c) — THE PHYSICS RULE. A usage record with no positive count is not a report.
 *
 * Every trigger that reaches one of R-X44's three formatters CONSUMED tokens: a `finish 'length'`
 * stop hit the reservation, and a promoted leg produced the reasoning it promoted. So had usage
 * actually been reported, at least one of the five counts would be positive. An all-zero record
 * is therefore the absence of an observation, exactly as `utils/pricing.js :: resolveLegCost`
 * already rules for cost (v4.4 B2) — and it is what the product really hands us:
 * `pricing.js :: sumPerMessageUsage` starts from `emptyUsageTotals()` and accumulates with
 * `|| 0`, so a leg whose engine reported nothing arrives as `{ input: 0, output: 0, … }`,
 * indistinguishable from reported zeros. Without this clause R-X44's not-reported arm was
 * unreachable from the product (council #270 r4 review of G2, I1).
 *
 * NOT `pricing.js :: hasObservedTokens`, which was read and rejected: it tests input/output
 * ONLY (v4.4.1 CA-7, deliberately — reasoning and cache tokens are real observations that its
 * estimate cannot price). A reasoning-only promoted leg — `{ reasoning: 32000, output: 0 }`, the
 * #218 flagship shape — is a REPORT here and is not observed there. Two predicates, two jobs.
 * HAND-SPELLED for the same reason the finish bound is: this module is a LEAF.
 * @param {object|null|undefined} tokens
 * @returns {boolean}
 */
function reportedTokens(tokens) {
  if (!tokens || typeof tokens !== 'object') { return false; }
  return [tokens.input, tokens.output, tokens.reasoning, tokens.cacheRead, tokens.cacheWrite]
    .some((v) => Number.isInteger(v) && v > 0);
}

function promotedFacts(leg) {
  if (!isPromotedLeg(leg)) { return null; }
  const t = (leg.usage && leg.usage.tokens) || {};
  const reported = reportedTokens(t);
  const finish = typeof leg.finish === 'string'
    ? leg.finish.replace(FINISH_ALLOWED, '').slice(0, MAX_FINISH_CHARS)
      .replace(FINISH_LONE_UNDERSCORE, '')
    : '';
  return {
    reasoning: reported && Number.isInteger(t.reasoning) && t.reasoning >= 0 ? t.reasoning : null,
    output: reported && Number.isInteger(t.output) && t.output >= 0 ? t.output : null,
    finish: finish || null,
  };
}

/**
 * The token split every announcement of a promoted leg quotes:
 * `<r> reasoning / <o> output tokens[, finish '<f>']`. ONE home (council r2) —
 * the clause below, run-stage2-notes.js's still-unread sentence and
 * chair-fallback.js's chair reason all read it, so the wording cannot drift
 * between the Stage-1 notes, the Stage-2 judge notes and the chair walk. The
 * EMPTY STRING for anything that is not a facts object, matching the clause.
 *
 * R-X44 (Chair HQ2): the counts render ONLY when BOTH `reasoning` and `output`
 * are integers (a REPORTED count, possibly zero); otherwise the literal
 * `token usage not reported` — never `null reasoning / null output tokens`,
 * and never a fabricated number either. The finish clause is unchanged and
 * still appends in both cases: whether a `finish` reached the leg is
 * independent of whether the token usage did.
 */
function tokenSplit(facts) {
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) { return ''; }
  const finish = facts.finish ? `, finish '${facts.finish}'` : '';
  const counts = Number.isInteger(facts.reasoning) && Number.isInteger(facts.output)
    ? `${facts.reasoning} reasoning / ${facts.output} output tokens`
    : 'token usage not reported';
  return `${counts}${finish}`;
}

/** The sentence both arms of the clause share, so the two cannot drift apart. */
const REASONING_ONLY_CAUSE = ' — it answered only in its reasoning channel';

/**
 * The one clause the retry heal note, the still-dead notes and the skipped-leg
 * note append after "with no usable output".
 *
 * `promoted` has TWO documented shapes and this takes either:
 *   - the literal `true`, which is what a leg DOCUMENT and a run row carry
 *     (`isPromotedLeg` above reads exactly that, and nothing else);
 *   - `{ reasoning, output, finish }`, the facts object `promotedFacts` builds,
 *     which the three Stage-1 still-dead RECORDS carry on `data.promoted`.
 * The readers spell `reasoningOnlyClause(ff && ff.promoted)` and
 * `reasoningOnlyClause(criticLeg.data.promoted)` without knowing which shape
 * they hold, so a producer that stamped the boolean on a record silently lost
 * the CAUSE — the R-X14 regression, one guard away (council r3). The boolean
 * now names the cause; it carries no numbers to quote, so it gets no
 * parenthetical and `tokenSplit` is never called with it.
 *
 * The EMPTY STRING for anything else, so every announcement for a leg that is
 * not promoted stays byte-identical (spec R9) — the guard is kept HERE rather
 * than delegated to `tokenSplit`, which would otherwise leave an empty
 * parenthetical.
 */
function reasoningOnlyClause(facts) {
  if (facts === true) { return `${REASONING_ONLY_CAUSE}, which is not a review`; }
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) { return ''; }
  return `${REASONING_ONLY_CAUSE} (${tokenSplit(facts)}), which is not a review`;
}

module.exports = { isPromotedLeg, promotedFacts, tokenSplit, reasoningOnlyClause, reportedTokens };
