/**
 * @module engine-variants
 * #218 PR 4: the effort lever. The engine's prompt endpoint selects reasoning
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
 *     glm-5.3 on a cold engine) and is known within 36 ms on another run (M12) —
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

/** How long a read waits for the engine's startup refresh to make a model known (M12: 36 ms). */
const DECLARATION_WAIT_MS = 5000;
const DECLARATION_POLL_MS = 250;

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
 * `limitOutput` is whatever the dump says — the engine's own ceiling for a bare descriptor, and the ECHO of a descriptor amicus wrote otherwise (M3).
 * @returns {Promise<{known: boolean, variants: object, limitOutput: number|null}>}
 */
async function readDeclarationOnce(client, providerID, modelID) {
  const r = await client.config.providers();
  const list = (r && r.data && Array.isArray(r.data.providers)) ? r.data.providers : [];
  const p = list.find((x) => x && x.id === providerID);
  const m = (p && p.models && Object.prototype.hasOwnProperty.call(p.models, modelID)) ? p.models[modelID] : null;
  const limit = (m && m.limit && typeof m.limit === 'object') ? m.limit : {};
  return {
    known: positiveCount(limit.context) !== null,
    variants: (m && m.variants && typeof m.variants === 'object') ? m.variants : {},
    limitOutput: positiveCount(limit.output),
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
 * @param {{waitMs?: number, pollMs?: number, sleep?: Function, now?: Function, catalogCeiling?: number|null, readCache?: Function}} [opts] test seams — `catalogCeiling` (explicit) wins over `readCache`
 * @returns {Promise<{known: boolean, variants: object, limitOutput: number|null, ceiling: number|null, waitedMs: number}>} `ceiling` is what the fit judges against: the amicus catalog's ceiling when it knows the model, else `limitOutput`.
 */
async function readModelDeclaration(client, model, opts = {}) {
  const idx = typeof model === 'string' ? model.indexOf('/') : -1;
  const providerID = idx > 0 ? model.slice(0, idx) : String(model);
  const modelID = idx > 0 ? model.slice(idx + 1) : '';
  const waitMs = opts.waitMs === undefined ? DECLARATION_WAIT_MS : opts.waitMs;
  const pollMs = opts.pollMs === undefined ? DECLARATION_POLL_MS : opts.pollMs;
  const sleep = opts.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = opts.now || Date.now;
  const start = now();
  let d = await readDeclarationOnce(client, providerID, modelID);
  while (!d.known && now() - start < waitMs) {
    await sleep(pollMs);
    d = await readDeclarationOnce(client, providerID, modelID);
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
  const catalogCeiling = opts.catalogCeiling !== undefined ? opts.catalogCeiling : catalogCeilingFor(model, opts.readCache);
  return { ...d, ceiling: catalogCeiling !== null ? catalogCeiling : d.limitOutput, waitedMs: now() - start };
}

/**
 * Pure: send, refuse, or send unverified — in that order of tests.
 *   1. unknown model -> {ok: true, verified: false} (mutant "UNKNOWNREFUSED");
 *   2. known, undeclared -> VARIANT_UNDECLARED naming the declared set
 *      (own properties only — mutant "PROTOLOOKUP");
 *   3. declared, entry `thinking: {type: 'enabled', budgetTokens: N}`, a positive
 *      budget B below the ceiling C -> VARIANT_OVER_BUDGET with min(B + N, C)
 *      (mutants "ALWAYSREFUSE": drop `B < C`; "FITWITHOUTBUDGET": default a null
 *      budget to 32000; "ANTHROPICONLY": key on the provider id instead of the shape);
 *   4. otherwise {ok: true, verified: true, entry}.
 * @param {{variant: string, model: string, declaration: object, outputBudget?: number|null}} a
 * @returns {{ok: true, verified: boolean, entry?: object} | {ok: false, code: string, reason: string}}
 */
function checkVariant({ variant, model, declaration, outputBudget }) {
  if (!declaration || !declaration.known) { return { ok: true, verified: false }; }
  const variants = (declaration.variants && typeof declaration.variants === 'object') ? declaration.variants : {};
  if (!Object.prototype.hasOwnProperty.call(variants, variant)) {
    const names = Object.keys(variants);
    const listed = names.length > 0 ? names.join(', ') : 'no variants at all';
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
    return { ok: false, code: 'VARIANT_OVER_BUDGET', reason: `VARIANT_OVER_BUDGET: the '${variant}' variant on ${model} carries a ${budgetTokens}-token thinking budget that the engine adds ON TOP of the reservation on this route (probe M2: 24000 + 16000 = 40000; K2), so with outputBudget ${budget} this leg would reserve ${reservation} (${how}) — ${reservation - budget} over the budget; nothing was sent. Raise outputBudget to at least ${ceiling} (the sum is then clamped to the ceiling, K4), route the model through OpenRouter (its OpenRouter row carries the thinking budget inside the reservation, M9), or use an adaptive-thinking model such as claude-sonnet-5 (M10b)` };
  }
  return { ok: true, verified: true, entry };
}

/**
 * The log line for a variant sent to a model the catalogue did not know in time.
 * @param {{model: string, variant: string, waitedMs: number}} a
 * @returns {string}
 */
function formatUnverifiedVariantNote({ model, variant, waitedMs }) {
  return `the engine's catalogue did not know ${model} within ${waitedMs} ms (limit.context 0, no variants declared), so '${variant}' was sent unverified: it applies only if the engine learns the model before it builds the request (its startup models.dev refresh — probe M12 saw qwen3.8-max-0902 known within 36 ms on one run and unknown at the first read on another, M0) and is a silent no-op otherwise (M7)`;
}

module.exports = { VARIANT_LEVELS, VariantRefusedError, readModelDeclaration, checkVariant, formatUnverifiedVariantNote };
