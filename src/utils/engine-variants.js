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
 *   - /config/providers echoes a descriptor amicus wrote (M3: a 24000 limit.output reads back as 24000), so the ceiling a fit judges against comes from amicus's own catalog when it knows the model and from the dump only for a bare descriptor. The echo overwrites `limit` and NOTHING else (M23), so it never hides whose row it is: the engine's own catalogue still fills the name, family, release date, prices, capabilities and variants beside it, and `engineSourced` below reads those.
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

/** A non-empty string cell. */
const filled = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * Whose row is this — the engine's own catalogue, or nothing but the descriptor amicus registered? Amicus writes exactly ONE cell into a model's entry (`limit`, src/utils/config.js:406) and /config/providers echoes it (M3), so `limit` can never answer that; everything else can. Measured with the IDENTICAL descriptor on both rows (record M23, engine 1.18.15): an engine row keeps its display name, family, release date, prices, capabilities and variants, a config-only row reads `name === modelID`, empty family/release_date, cost 0, `variants {}`.
 * THE DISJUNCTS ARE EXACTLY THESE EIGHT: `id`, `providerID`, `api`, `status`, `options`, `headers`, `capabilities.toolcall` and `capabilities.input/output.text` are populated on a config-only row TOO (M23), so adding any of them reads every model the engine has not learned yet as a declaration and refuses it falsely — named mutants "TOOLCALLDISJUNCT" and "ECHOSOURCED" (add `limit`); "ONEDISJUNCT" shrinks the OR. Cost is compared `> 0`, never through positiveCount, which FLOORS $0.05 to 0 — mutant "COSTVIAPOSITIVECOUNT".
 * @param {string} modelID model half of the executable id
 * @param {object|null} m the dump's entry for it
 * @returns {boolean}
 */
function engineSourced(modelID, m) {
  if (!m || typeof m !== 'object') { return false; }
  const cost = (m.cost && typeof m.cost === 'object') ? m.cost : {};
  const caps = (m.capabilities && typeof m.capabilities === 'object') ? m.capabilities : {};
  const variants = (m.variants && typeof m.variants === 'object') ? m.variants : {};
  return filled(m.release_date)
    || filled(m.family)
    || (filled(m.name) && m.name !== modelID)
    || (typeof cost.input === 'number' && cost.input > 0)
    || (typeof cost.output === 'number' && cost.output > 0)
    || Object.keys(variants).length > 0
    || caps.temperature === true || caps.reasoning === true || caps.attachment === true;
}

/**
 * One read of `/config/providers` for one model. `known` is "the engine's own
 * catalogue supplied this row" (engineSourced above, record M23) — NOT
 * `limit.context > 0`, which reads the one cell amicus itself writes and the
 * dump echoes back (M3). A model amicus registered that the engine's catalogue
 * lacks carries nothing but that descriptor (J1, M0); a provider or model
 * missing from the dump altogether is unknown too. Named mutant "LIMITISKNOWN".
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
    known: engineSourced(modelID, m),
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
 * @param {{waitMs?: number, pollMs?: number, sleep?: Function, now?: Function, catalogCeiling?: number|null, readCache?: Function, signal?: {aborted: boolean}, readTimeoutMs?: number}} [opts] test seams — `catalogCeiling` (explicit) wins over `readCache`. `readTimeoutMs` — each individual `/config/providers` read's own deadline (council #235 r2 A1).
 * @returns {Promise<{known: boolean, variants: object, limitOutput: number|null, unreadable: string|null, ceiling: number|null, ceilingFrom: string, waitedMs: number}>} `ceiling` is what the fit judges against: the amicus catalog's ceiling when it knows the model, else `limitOutput`; `ceilingFrom` is `'catalog'` or `'engine'` accordingly, and checkVariant's OVER_BUDGET remedy reads it.
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
  // council #235 r3 (C1/B1): the wait asks `known` and NOTHING about the budget. `known` is now
  // "the engine's catalogue supplied this row" (engineSourced, M23), so the row that used to be
  // indistinguishable from an echo — amicus's descriptor and nothing else — is positively
  // identified and polled, and an engine row declaring no variants settles on the first read and
  // is refused; both in EITHER budget state. The deleted `budgetInForce`/`couldBeEcho`/`ambiguous`
  // machinery managed an ambiguity the response never had. Named mutant "COLDECHOKNOWN": stop
  // polling once the dump reports any `limit.output` — the echo ends the wait on the first read again.
  const start = now();
  let d = await readDeclarationOnce(client, providerID, modelID, { signal, readTimeoutMs: opts.readTimeoutMs });
  while (!d.unreadable && !d.known && !(signal && signal.aborted) && now() - start < waitMs) {
    await sleep(pollMs);
    d = await readDeclarationOnce(client, providerID, modelID, { signal, readTimeoutMs: opts.readTimeoutMs });
  }
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
  return { ...d, ceiling: catalogCeiling !== null ? catalogCeiling : d.limitOutput, ceilingFrom: catalogCeiling !== null ? 'catalog' : 'engine', waitedMs: now() - start };
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
    // council #235 r3 (C1/B1): the EMPTY set is its own answer and gets its own reason. The
    // row reached this branch because `known` says the engine's own catalogue supplied it
    // (engineSourced, M23), so "declares no variants" is an observation, not an unfinished
    // read — and it says so without claiming WHICH cell carried the evidence, because the
    // predicate is an OR (10 of 50 openai rows have `name === id`; 26 of 361 openrouter
    // `:free` rows price at zero, and both are engine-sourced through other cells). Named
    // mutants "EMPTYSETSILENT" (fall back to the listed wording) and "MESSAGEOVERCLAIMS"
    // (assert the row carries its name, family, release date AND prices).
    if (names.length === 0) {
      return { ok: false, code: 'VARIANT_UNDECLARED', reason: `VARIANT_UNDECLARED: ${model} declares no variants at all — the row the engine returned for it (/config/providers) carries cells only the engine's own catalogue fills (its release date, family, pricing or capabilities), so this is a declaration and not an unfinished read; an undeclared variant is a silent no-op on the wire (probe F3/M7), so nothing was sent. Omit --thinking to run at the provider's own default effort, or pick a route whose row declares levels (a gateway mirror of the same model often does). Setting an outputBudget does not change this verdict (council #235 r3, C1/B1); on a first engine start the bundled catalogue can declare a smaller set than the live one, so the same level can be accepted on the next run` };
    }
    // council #235 r2 (B4): the names come from the engine's remote models.dev refresh, so
    // they are defanged before they enter a message that reaches a log and a terminal.
    // `model` is NOT defanged and must not be: it is amicus's own resolved config id, not
    // engine-sourced text.
    const listed = defang(names.join(', '));
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
 * @param {{model: string, variant: string, waitedMs: number, unreadable?: string|null}} a
 * @returns {string}
 */
function formatUnverifiedVariantNote({ model, variant, waitedMs, unreadable }) {
  const why = unreadable
    // council #235 r2 (B4): `unreadable` carries an engine/transport error message — defanged
    // before it reaches a log line and a terminal. `model` stays raw: it is amicus's own id.
    ? `the engine's /config/providers could not be read (${defang(unreadable)}; one read, no wait)`
    // council #235 r3 (C1/B1): two shapes, not three. The `ambiguous` branch named a state the
    // dump never had — a row carrying only amicus's descriptor is positively identified now.
    : `the engine's catalogue did not know ${model} within ${waitedMs} ms (its /config/providers entry carries nothing but the descriptor amicus registered, or the model is absent from the dump)`;
  return `${why}, so '${variant}' was sent unverified: it applies only if the engine learns the model before it builds the request (its startup models.dev refresh — probe M12 saw qwen3.8-max-0902 known on the first poll of a warm engine, 36 ms on one run, and unknown at the first read of a cold one, M0) and is a silent no-op otherwise (M7)`;
}

module.exports = { VARIANT_LEVELS, VariantRefusedError, readModelDeclaration, checkVariant, formatUnverifiedVariantNote };
