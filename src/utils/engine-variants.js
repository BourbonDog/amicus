/**
 * @module engine-variants
 * The effort lever (#218 PR 4): --thinking sent as the engine's variant field, validated against the engine's own declaration.
 * The engine's prompt endpoint selects reasoning
 * effort through `variant: string` (probe F2); the `reasoning` object amicus sent
 * for every `--thinking` until now was never a prompt field and reached nothing
 * (F1). A variant the model does not DECLARE is a silent no-op that the engine
 * still echoes on the assistant message (F3 on a known model, M7 on one with
 * `variants {}`), so a run's own artifact can claim an effort the wire never
 * saw. This module is the one place amicus asks the engine what a model declares
 * (`/config/providers` -> `variants` + `limit`, M0) and decides, per leg, to send,
 * refuse, or send unverified.
 *
 * Measured, engine 1.18.15 (BACKLOG "v4.9.4 records", the PR 4 table):
 *   - a model newer than the engine's bundled catalogue reads `limit 0/0,
 *     variants {}` until the startup models.dev refresh lands (M0: qwen3.8-max-0902,
 *     glm-5.3 on a cold engine) and is known on the first poll of a WARM engine (M12: 36 ms on one run) —
 *     so a read that finds the model unknown WAITS, bounded, before deciding;
 *   - a variant does not move the reservation on OpenRouter (M1, M9), direct
 *     Google (M15), direct DeepSeek (M16) or an adaptive-thinking Anthropic model
 *     (M10b); only an entry shaped `thinking: {type: 'enabled', budgetTokens: N}`
 *     adds N ON TOP of the reservation (M2: 24000 + 16000 = 40000; K2/K11),
 *     clamped to the model's ceiling (K3/K4/K10);
 *   - N is the engine's, not a formula of the ceiling (M0: opus-4-5 declares
 *     16000 for low, medium AND high, and no max), so the post-spawn dump is the
 *     only source of N — and nothing changes a descriptor after the spawn: a
 *     runtime PATCH /config changes nothing the engine serves and writes a
 *     config.json into its cwd (M3/M4/M11). The exact pre-spawn fit (descriptor
 *     = budget − N, proven M17) is filed, not built; this module REFUSES the
 *     over-budget shape with the numbers instead (BACKLOG C1's second clause).
 *   - /config/providers echoes a descriptor amicus wrote (M3: a 24000 limit.output reads back as 24000), so the ceiling a fit judges against comes from amicus's own catalog when it knows the model and from the dump only for a bare descriptor.
 */
'use strict';

const { positiveCount } = require('./model-output-limit');

/** Every level the curated routes declare between them (M0), in effort order. */
const VARIANT_LEVELS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/** How long a read waits for the engine's startup refresh to make a model known (the cold wait is unmeasured — BACKLOG item 3; M12's 36 ms was a warm read). */
const DECLARATION_WAIT_MS = 5000;
const DECLARATION_POLL_MS = 500; // council #235 r1 (D2): ten reads across the bound, not twenty
const DECLARATION_READ_TIMEOUT_MS = 2000; // council #235 r2 (A1): ONE read's own bound. A warm read measured 36-285 ms (M12), so 2 s is generous; without it a stalled endpoint runs to undici's ~306 s default and the 5 s "bound" below caps only the NUMBER of reads.

/**
 * Defang engine-sourced text before it enters a message. `/config/providers` is
 * filled from the engine's remote models.dev refresh, so variant names are not
 * ours; control characters and fence/tag characters are stripped so a poisoned
 * catalogue cannot forge terminal escapes or markdown structure in a reason
 * string. Mirrors sidecar/progress-fields.js :: sanitizePreview, which does the
 * same job for briefings crossing the MCP boundary. Named mutant "RAWENGINETEXT".
 * @param {string} s @returns {string}
 */
// eslint-disable-next-line no-control-regex
const defang = (s) => String(s).replace(/[\u0000-\u001F\u007F]/g, '').replace(/[`<>]/g, '').replace(/\s+/g, ' ').trim();

/** Thrown by opencode-client.js :: sendPrompt BEFORE any request when a variant is refused. */
class VariantRefusedError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'VariantRefusedError';
    this.code = code;
  }
}

/**
 * One read of `/config/providers` for one model. `known` is `limit.context > 0`:
 * a model amicus registered that the engine's catalogue lacks reads 0/0 (J1, M0);
 * a provider or model missing from the dump altogether is unknown too.
 * A descriptor amicus wrote is echoed with `variants {}` (M3), so a positive context alone does not prove the ENGINE knows the model — readModelDeclaration keeps polling on that shape.
 * `limitOutput` is whatever the dump says — the engine's own ceiling for a bare descriptor, and the ECHO of a descriptor amicus wrote otherwise (M3).
 * @param {object} client SDK client
 * @param {string} providerID provider half of the executable id
 * @param {string} modelID model half of the executable id
 * @param {{signal?: object, readTimeoutMs?: number}} [opts] `signal` — the caller's abandon signal, joined to this read's own deadline when it is a real AbortSignal; `readTimeoutMs` — that deadline (default DECLARATION_READ_TIMEOUT_MS).
 * @returns {Promise<{known: boolean, variants: object, limitOutput: number|null, unreadable: string|null}>}
 */
async function readDeclarationOnce(client, providerID, modelID, opts = {}) {
  const readTimeoutMs = positiveCount(opts.readTimeoutMs) || DECLARATION_READ_TIMEOUT_MS;
  // council #235 r2 (A1): the read gets its OWN deadline, and the caller's abandon
  // signal is joined to it so an abort cancels the read in flight rather than only
  // ending the loop. Named mutant "UNBOUNDEDREAD" (tests/utils/engine-variants.test.js):
  // drop the signal from the call and the read runs to the transport's own default
  // (the SDK deletes its own — node_modules/@opencode-ai/sdk/dist/client.js sets
  // `req.timeout = false` — leaving undici's ~306 s; the triage measured one read at
  // 306,639 ms against a socket that accepts and never answers).
  const timeoutSignal = AbortSignal.timeout(readTimeoutMs);
  // AbortSignal.any REJECTS a duck-typed `{aborted}` (TypeError: not of type AbortSignal),
  // and both the documented `options.signal` type and the tests use that shape; only the
  // real AbortController signal headless passes can be joined. The loop's own `signal.aborted`
  // check still ends the wait for the duck-typed case — it just cannot cancel a read already
  // in flight, which is exactly what the timeout above now bounds.
  const joinable = opts.signal && typeof AbortSignal !== 'undefined' && opts.signal instanceof AbortSignal;
  const readSignal = joinable ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal;
  let r;
  try { r = await client.config.providers({ signal: readSignal }); } catch (err) {
    // council #235 r1 (C1/D1/A2): a THROWN read — a transport error, a dead engine — is
    // unreadable exactly like the returned non-2xx tuple below: one read, no wait, the level
    // sent unverified with the note naming the error. Before this the rejection escaped
    // sendPrompt and the leg died on it. Named mutant "THROWNREADFAILS"
    // (tests/utils/engine-variants.test.js): drop the try/catch.
    return { known: false, variants: {}, limitOutput: null, unreadable: `read threw: ${(err && err.message) || String(err)}` };
  }
  // #218 PR 4 whole-branch review (EP-3): the SDK returns a non-2xx as a VALUE ({error,
  // response}, no data — opencode-client.js :: providerErrorReason keys on the same shape).
  // A response with no providers array is UNREADABLE, not "model unknown": the wait must not
  // burn 5 s on it and the note must not claim a read that never happened.
  // Named mutant "UNREADABLEISCOLD" (tests/utils/engine-variants.test.js): `list = []` on that shape.
  const list = (r && r.data && Array.isArray(r.data.providers)) ? r.data.providers : null;
  if (list === null) {
    const status = r && ((r.response && r.response.status) || (r.error && r.error.status));
    return { known: false, variants: {}, limitOutput: null, unreadable: typeof status === 'number' ? `HTTP ${status}` : 'no providers array in the response' };
  }
  const p = list.find((x) => x && x.id === providerID);
  const m = (p && p.models && Object.prototype.hasOwnProperty.call(p.models, modelID)) ? p.models[modelID] : null;
  const limit = (m && m.limit && typeof m.limit === 'object') ? m.limit : {};
  return {
    known: positiveCount(limit.context) !== null,
    variants: (m && m.variants && typeof m.variants === 'object') ? m.variants : {},
    limitOutput: positiveCount(limit.output),
    unreadable: null,
  };
}

/**
 * The ceiling amicus's own catalog knows for `model` — the number
 * config.js :: buildProviderModels clamps a budget-derived descriptor to — or
 * null when it knows none (the descriptor was then bare).
 * @param {string} model executable id
 * @param {Function} [readCache] test seam for model-catalog.js :: readCache
 * @returns {number|null}
 */
function catalogCeilingFor(model, readCache) {
  try {
    const { buildLimitLookup } = require('./model-output-limit');
    const cache = (readCache || require('./model-catalog').readCache)();
    const row = buildLimitLookup(cache && cache.models).get(model);
    return row ? positiveCount(row.maxOutputTokens) : null;
  } catch { return null; }
}

/**
 * The engine's declaration for `model` ('provider/model', split at the FIRST
 * slash — an OpenRouter id keeps its vendor path), waiting up to `waitMs` for
 * the catalogue to know it. Named mutant "NOWAIT" (tests/utils/engine-variants.test.js).
 * @param {object} client SDK client
 * @param {string} model executable id
 * @param {{waitMs?: number, pollMs?: number, sleep?: Function, now?: Function, catalogCeiling?: number|null, readCache?: Function, signal?: {aborted: boolean}, outputBudget?: number|null, readTimeoutMs?: number}} [opts] test seams — `catalogCeiling` (explicit) wins over `readCache`. `outputBudget` (the budget the engine was spawned with; sendPrompt passes it): the echo shape is possible only when a budget-derived descriptor was written, i.e. when it is a positive integer. `readTimeoutMs` — each individual `/config/providers` read's own deadline (council #235 r2 A1).
 * @returns {Promise<{known: boolean, variants: object, limitOutput: number|null, unreadable: string|null, ceiling: number|null, ceilingFrom: string, waitedMs: number, ambiguous: boolean}>} `ceiling` is what the fit judges against: the amicus catalog's ceiling when it knows the model, else `limitOutput`; `ceilingFrom` is `'catalog'` or `'engine'` accordingly, and checkVariant's OVER_BUDGET remedy reads it. `ambiguous` — the wait ended on a read that could still be an echo (budget set, amicus's catalog knows the model, no variants): reported as `known: false` so the level is sent unverified.
 */
async function readModelDeclaration(client, model, opts = {}) {
  const idx = typeof model === 'string' ? model.indexOf('/') : -1;
  const providerID = idx > 0 ? model.slice(0, idx) : String(model);
  const modelID = idx > 0 ? model.slice(idx + 1) : '';
  const waitMs = opts.waitMs === undefined ? DECLARATION_WAIT_MS : opts.waitMs;
  const pollMs = opts.pollMs === undefined ? DECLARATION_POLL_MS : opts.pollMs;
  const sleep = opts.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = opts.now || Date.now;
  const catalogCeiling = opts.catalogCeiling !== undefined ? opts.catalogCeiling : catalogCeilingFor(model, opts.readCache);
  const signal = opts.signal || null; // #218 PR 4 whole-branch review (EP-2): the caller's abandon signal
  // #218 PR 4 whole-branch review (EP-1): with a budget in force amicus wrote a descriptor
  // for every model its own catalog knows, and /config/providers ECHOES it (M3) — so a
  // model the ENGINE's catalogue does not know yet reads `limit.context > 0, variants {}`
  // instead of 0/0 and would count as known on the FIRST read, skipping the wait rule 3
  // exists for. Keep polling while the read could be that echo: amicus's catalog knows the
  // model and no variant has appeared. The shape needs a budget-derived descriptor, so with no
  // budget there is no echo and a variant-less model amicus's catalog knows (M0: gpt-4o) is
  // refused on the first read; with one, the two states read alike (M0/J1: both `variants {}`)
  // and a read still ambiguous when the wait ends is reported UNKNOWN — sent unverified with a
  // note — rather than refused as undeclared (council #235 r1 B1/D2/A4).
  const budgetInForce = positiveCount(opts.outputBudget) !== null;
  // Named mutants "ECHOKNOWN" (drop `couldBeEcho(d)` from the loop), "ECHOWITHOUTBUDGET"
  // (drop `budgetInForce`), "NOCATALOGECHO" (drop `catalogCeiling !== null`) and
  // "AMBIGUOUSKNOWN" (report the ambiguous read as known) — all in
  // tests/utils/engine-variants.test.js.
  const couldBeEcho = (r) => budgetInForce && catalogCeiling !== null && Object.keys(r.variants).length === 0;
  const start = now();
  let d = await readDeclarationOnce(client, providerID, modelID, { signal, readTimeoutMs: opts.readTimeoutMs });
  while (!d.unreadable && (!d.known || couldBeEcho(d)) && !(signal && signal.aborted) && now() - start < waitMs) {
    await sleep(pollMs);
    d = await readDeclarationOnce(client, providerID, modelID, { signal, readTimeoutMs: opts.readTimeoutMs });
  }
  const ambiguous = !d.unreadable && d.known && couldBeEcho(d);
  // #218 PR 4 (found by probe row M20 in Task 2): /config/providers ECHOES the
  // descriptor amicus wrote -- a budget-derived limit.output 24000 reads back as
  // 24000 (M3's dump-after) -- so with a budget in force the dump cannot tell
  // the model's ceiling. The fit judges against the ceiling amicus clamped that
  // descriptor to (its own catalog's maxOutputTokens, the same number
  // config.js :: buildProviderModels used) and against the dump's value only
  // when the catalog has none: then the descriptor was bare and the dump is the
  // engine's own ceiling (K5/K12). Named mutant "ECHOEDCEILING"
  // (tests/utils/engine-variants.test.js): `ceiling: d.limitOutput` unconditionally.
  // council #235 r2 (B1): `ceilingFrom` says whose number this is. 'engine' = a bare descriptor,
  // so the dump IS the engine's ceiling (K5/K12) and the remedy below is provable. 'catalog' =
  // the dump echoes what amicus wrote (M3), so the engine's real ceiling may be HIGHER and
  // raising the budget to it can land inside the unrefused window. Named mutant "CEILINGPROVENANCE".
  return { ...d, known: d.known && !ambiguous, ambiguous, ceiling: catalogCeiling !== null ? catalogCeiling : d.limitOutput, ceilingFrom: catalogCeiling !== null ? 'catalog' : 'engine', waitedMs: now() - start };
}

/**
 * Pure: send, refuse, or send unverified — in that order of tests.
 *   1. unknown model -> {ok: true, verified: false} (mutant "UNKNOWNREFUSED");
 *   2. known, undeclared -> VARIANT_UNDECLARED naming the declared set
 *      (own properties only — mutant "PROTOLOOKUP");
 *   3. declared, entry `thinking: {type: 'enabled', budgetTokens: N}`, a positive
 *      budget B below the ceiling C -> VARIANT_OVER_BUDGET with min(B + N, C)
 *      (mutants "ALWAYSREFUSE": drop `B < C`; "FITWITHOUTBUDGET": default a null
 *      budget to 32000; "ANTHROPICONLY": key on the provider id instead of the shape).
 *      The remedy has TWO shapes, keyed on `declaration.ceilingFrom` (council #235 r2 B1):
 *      an ENGINE-sourced ceiling gets "raise to at least C (the sum is then clamped, K4)",
 *      which the dump proves; a CATALOG-sourced one names C as amicus's own number and says
 *      to run `amicus models --refresh` first, because the engine's real ceiling may be
 *      higher and a budget in that gap is never re-checked (mutant "REMEDYALWAYSCATALOG");
 *   4. otherwise {ok: true, verified: true, entry}.
 * @param {{variant: string, model: string, declaration: object, outputBudget?: number|null}} a
 * @returns {{ok: true, verified: boolean, entry?: object} | {ok: false, code: string, reason: string}}
 */
function checkVariant({ variant, model, declaration, outputBudget }) {
  if (!declaration || !declaration.known) { return { ok: true, verified: false }; }
  const variants = (declaration.variants && typeof declaration.variants === 'object') ? declaration.variants : {};
  if (!Object.prototype.hasOwnProperty.call(variants, variant)) {
    const names = Object.keys(variants);
    // council #235 r2 (B4): the names come from the engine's remote models.dev refresh, so
    // they are defanged before they enter a message that reaches a log and a terminal.
    // `model` is NOT defanged and must not be: it is amicus's own resolved config id, not
    // engine-sourced text.
    const listed = names.length > 0 ? defang(names.join(', ')) : 'no variants at all';
    return { ok: false, code: 'VARIANT_UNDECLARED', reason: `VARIANT_UNDECLARED: ${model} does not declare a '${variant}' variant — the engine's catalogue lists ${listed} for it (/config/providers); an undeclared variant is a silent no-op on the wire (probe F3/M7), so nothing was sent. Pick one of the listed levels, or omit --thinking to run at the provider's own default effort` };
  }
  const entry = variants[variant];
  const thinking = (entry && entry.thinking && typeof entry.thinking === 'object') ? entry.thinking : null;
  const budgetTokens = (thinking && thinking.type === 'enabled') ? positiveCount(thinking.budgetTokens) : null;
  const budget = positiveCount(outputBudget);
  const ceiling = declaration.ceiling;
  if (budgetTokens !== null && budget !== null && ceiling !== null && budget < ceiling) {
    const sum = budget + budgetTokens;
    const reservation = Math.min(sum, ceiling);
    const how = sum > ceiling ? `${budget} + ${budgetTokens}, clamped to the model's ${ceiling} ceiling` : `${budget} + ${budgetTokens}`;
    // council #235 r2 (B1): the remedy must not walk the user into the one unrefused window.
    // With a budget in force the dump ECHOES the descriptor amicus wrote (M3), so `ceiling` is
    // amicus's own catalog number; if the engine's real ceiling is higher, a budget raised to
    // exactly this number sits in [C_catalog, C_engine) — the fit falls silent there and the leg
    // still reserves up to C_catalog + N on the wire. Named mutant "REMEDYALWAYSCATALOG".
    const raise = declaration.ceilingFrom === 'catalog'
      ? `Raise outputBudget to at least ${ceiling} — the ceiling amicus's own catalog carries for this model, which is what the fit can read once a budget is set (M3); if the engine's real ceiling is higher, a budget in that gap is not re-checked, so prefer \`amicus models --refresh\` first`
      : `Raise outputBudget to at least ${ceiling} (the sum is then clamped to the ceiling, K4)`;
    return { ok: false, code: 'VARIANT_OVER_BUDGET', reason: `VARIANT_OVER_BUDGET: the '${variant}' variant on ${model} carries a ${budgetTokens}-token thinking budget that the engine adds ON TOP of the reservation on this route (probe M2: 24000 + 16000 = 40000; K2), so with outputBudget ${budget} this leg would reserve ${reservation} (${how}) — ${reservation - budget} over the budget; nothing was sent. ${raise}, route the model through OpenRouter (a variant leaves the reservation at the budget there — M1: 8000 stayed 8000 under 'low'; M9: 32000 with 'high' on both of the engine's catalogues), or use an adaptive-thinking model such as claude-sonnet-5 (M10b)` };
  }
  return { ok: true, verified: true, entry };
}

/**
 * The log line for a variant sent to a model the catalogue did not know in time.
 * @param {{model: string, variant: string, waitedMs: number, unreadable?: string|null, ambiguous?: boolean}} a
 * @returns {string}
 */
function formatUnverifiedVariantNote({ model, variant, waitedMs, unreadable, ambiguous }) {
  const why = unreadable
    // council #235 r2 (B4): `unreadable` carries an engine/transport error message — defanged
    // before it reaches a log line and a terminal. `model` stays raw: it is amicus's own id.
    ? `the engine's /config/providers could not be read (${defang(unreadable)}; one read, no wait)`
    : ambiguous
      ? `the engine's catalogue reported no variants for ${model} within ${waitedMs} ms while the dump echoed the descriptor amicus wrote for it (a budget is set), and those two states read alike — the engine may not know the model yet, or may know it and declare no variants`
      : `the engine's catalogue did not know ${model} within ${waitedMs} ms (limit.context 0, no variants declared)`;
  return `${why}, so '${variant}' was sent unverified: it applies only if the engine learns the model before it builds the request (its startup models.dev refresh — probe M12 saw qwen3.8-max-0902 known on the first poll of a warm engine, 36 ms on one run, and unknown at the first read of a cold one, M0) and is a silent no-op otherwise (M7)`;
}

module.exports = { VARIANT_LEVELS, VariantRefusedError, readModelDeclaration, checkVariant, formatUnverifiedVariantNote };
