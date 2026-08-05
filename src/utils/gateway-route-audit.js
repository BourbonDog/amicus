/**
 * Per-gateway-form audit for curated DEFAULT aliases (Task 6, #gwid).
 *
 * Complements the flat alias-audit.js (which audits the single pinned string
 * per alias from `toDefaultAliases()`/`listCuratedRoutes()`): this audits
 * BOTH gateway-native forms from `curated-models.toGatewayRoutes()` against
 * the live catalog.
 *
 *   - STALE      a stored form's id is absent from its namespace.
 *   - DIVERGENT  a direct-capable vendor's alias is missing a `direct` form
 *                the catalog can now confirm ('divergent-missing'), or its
 *                stored `direct` form no longer matches what the catalog
 *                pairs ('divergent-mismatch').
 *
 * Never reports against data it cannot trust: a direct namespace the process
 * has no key for is skipped, not flagged --
 *   - STALE relies on classifyModel(), whose 'unknown' already covers this
 *     (empty namespace, or every row a non-authoritative floor-fallback).
 *   - DIVERGENT additionally re-checks `authoritative` itself, because
 *     pairAcrossGateways() (Task 5) is a pure string matcher that has no
 *     concept of authoritative vs. floor-fallback rows -- left unguarded, it
 *     would happily "confirm" a direct pairing against the hardcoded
 *     Anthropic offline floor (e.g. matching a dated id like
 *     claude-haiku-4-5-20251001 to the floor's undated claude-haiku-4-5) and
 *     report a false mismatch with no key present at all.
 *
 * Consumed by `amicus models --check` (Task 6); `--strict` gates the exit
 * code on these findings.
 */

'use strict';

const { toGatewayRoutes, directFormProvenance } = require('./curated-models');
const { classifyModel } = require('./model-classification');
const { pairAcrossGateways } = require('./gateway-route-catalog');
const { isDirectProvider } = require('./provider-registry');

const OR_PREFIX = 'openrouter/';

/** @param {string} orId e.g. 'openrouter/anthropic/claude-sonnet-5' @returns {string|null} vendor segment */
function vendorOf(orId) {
  if (typeof orId !== 'string' || !orId.startsWith(OR_PREFIX)) { return null; }
  const rest = orId.slice(OR_PREFIX.length);
  const i = rest.indexOf('/');
  return i > 0 ? rest.slice(0, i) : null;
}

/**
 * Bare model segment for pairAcrossGateways' versionToken -- Task-5's locked
 * calling convention: strip BOTH the `openrouter/` and `<vendor>/` prefixes
 * before calling, never pass the route string verbatim.
 * @param {string} orId @param {string} vendor @returns {string|null}
 */
function bareSegment(orId, vendor) {
  const prefix = `${OR_PREFIX}${vendor}/`;
  return typeof orId === 'string' && orId.startsWith(prefix) ? orId.slice(prefix.length) : null;
}

/** @returns {boolean} true only when `id` names a live-fetched (not floor-fallback) catalog row */
function isAuthoritative(catalogInfo, id) {
  const models = (catalogInfo && Array.isArray(catalogInfo.models)) ? catalogInfo.models : [];
  const row = models.find(m => m && m.id === id);
  return !!row && row.authoritative !== false;
}

/**
 * @param {{models: Array<{id:string, authoritative?: boolean}>, lastRefreshError?: string|null}} catalogInfo
 * @returns {Array<{alias:string, gateway:'direct'|'openrouter',
 *   kind:'stale'|'divergent-missing'|'divergent-mismatch', model:string, expected?:string}>}
 */
function auditGatewayRoutes(catalogInfo) {
  const routes = toGatewayRoutes();
  const provenance = directFormProvenance();
  const findings = [];

  for (const [alias, forms] of Object.entries(routes)) {
    const prov = provenance[alias] || { directForm: 'none', gatewayOnly: false };
    for (const gateway of ['direct', 'openrouter']) {
      const id = forms[gateway];
      if (!id) { continue; }
      if (classifyModel(id, gateway, catalogInfo) !== 'invalid') { continue; }
      // v4.6.3 PR1 (spec D2): a DERIVED direct form is a computed convenience,
      // not an authored claim. Its absence from the direct namespace is a
      // routing fact — not staleness — while the authoring openrouter route
      // is live, or when the entry declares gatewayOnly (an owner-ruled
      // routing choice). An AUTHORED direct form absent from its namespace
      // reports exactly as before.
      if (gateway === 'direct' && prov.directForm === 'derived' &&
          (prov.gatewayOnly ||
           classifyModel(forms.openrouter, 'openrouter', catalogInfo) === 'valid')) {
        continue;
      }
      findings.push({ alias, gateway, kind: 'stale', model: id });
    }

    const vendor = vendorOf(forms.openrouter);
    if (!vendor || !isDirectProvider(vendor)) { continue; } // gateway-only vendor: no direct route ever possible
    if (prov.gatewayOnly) { continue; } // declared routing choice: never suggest a direct pairing
    const token = bareSegment(forms.openrouter, vendor);
    if (!token) { continue; }
    const paired = pairAcrossGateways(vendor, token, catalogInfo); // Task-5 contract: bare segment only
    if (!paired.direct || !isAuthoritative(catalogInfo, paired.direct)) { continue; } // unconfirmed -- never guess

    if (!forms.direct) {
      findings.push({ alias, gateway: 'direct', kind: 'divergent-missing', model: paired.direct });
    } else if (forms.direct !== paired.direct) {
      findings.push({
        alias, gateway: 'direct', kind: 'divergent-mismatch', model: forms.direct, expected: paired.direct
      });
    }
  }

  return findings;
}

module.exports = { auditGatewayRoutes };
