/**
 * Task 6 (#gwid): per-gateway-form audit for curated DEFAULT aliases.
 * auditGatewayRoutes() checks BOTH `toGatewayRoutes()` forms per alias against
 * the live catalog: STALE (a stored form absent from its namespace) and
 * DIVERGENT (a direct-capable vendor alias missing/mismatching the direct
 * form the catalog can confirm). Never reports against data it can't trust
 * (no key -> classifyModel 'unknown', or a non-authoritative floor-only pair).
 */
'use strict';

function loadAudit(routes, provenance = {}) {
  jest.resetModules();
  jest.doMock('../../src/utils/curated-models', () => ({
    toGatewayRoutes: () => routes,
    directFormProvenance: () => provenance,
  }));
  return require('../../src/utils/gateway-route-audit');
}

const cat = (rows) => ({ models: rows });

describe('auditGatewayRoutes — STALE', () => {
  afterEach(() => jest.resetModules());

  it('flags a stale openrouter form (id absent from its namespace)', () => {
    const { auditGatewayRoutes } = loadAudit({
      opus: { direct: 'anthropic/claude-opus-4-8', openrouter: 'openrouter/anthropic/claude-opus-4.8' },
    });
    const catalogInfo = cat([
      { id: 'anthropic/claude-opus-4-8' },
      { id: 'openrouter/anthropic/claude-opus-4.1' }, // stale: 4.8 not present
    ]);
    const findings = auditGatewayRoutes(catalogInfo);
    expect(findings).toContainEqual({
      alias: 'opus', gateway: 'openrouter', kind: 'stale', model: 'openrouter/anthropic/claude-opus-4.8'
    });
  });

  it('flags a stale direct form when the namespace has authoritative rows that miss it', () => {
    const { auditGatewayRoutes } = loadAudit({
      gpt: { direct: 'openai/gpt-5.4', openrouter: 'openrouter/openai/gpt-5.5' },
    });
    const catalogInfo = cat([
      { id: 'openai/gpt-5.5' }, // live/authoritative row, but not gpt-5.4
      { id: 'openrouter/openai/gpt-5.5' },
    ]);
    const findings = auditGatewayRoutes(catalogInfo);
    expect(findings).toContainEqual({
      alias: 'gpt', gateway: 'direct', kind: 'stale', model: 'openai/gpt-5.4'
    });
  });

  it('does NOT flag a direct form as stale when the namespace has zero rows (no key -- skip, never guess)', () => {
    const { auditGatewayRoutes } = loadAudit({
      gpt: { direct: 'openai/gpt-5.4', openrouter: 'openrouter/openai/gpt-5.5' },
    });
    const catalogInfo = cat([
      { id: 'openrouter/openai/gpt-5.5' }, // only the OR row -- no openai/* rows at all
    ]);
    expect(auditGatewayRoutes(catalogInfo)).toEqual([]);
  });

  it('does NOT flag a direct form as stale when every namespace row is non-authoritative (Anthropic offline floor)', () => {
    const { auditGatewayRoutes } = loadAudit({
      haiku: { direct: 'anthropic/claude-haiku-4-5-20251001', openrouter: 'openrouter/anthropic/claude-haiku-4.5' },
    });
    const catalogInfo = cat([
      { id: 'anthropic/claude-haiku-4-5', authoritative: false }, // floor row, no date suffix, no key
      { id: 'openrouter/anthropic/claude-haiku-4.5' },
    ]);
    expect(auditGatewayRoutes(catalogInfo)).toEqual([]);
  });

  it('the refreshed current curated defaults pass cleanly against a catalog built from them', () => {
    jest.resetModules();
    jest.dontMock('../../src/utils/curated-models');
    const { toGatewayRoutes } = require('../../src/utils/curated-models');
    const { auditGatewayRoutes } = require('../../src/utils/gateway-route-audit');
    const routes = toGatewayRoutes();
    const rows = [];
    for (const forms of Object.values(routes)) {
      if (forms.direct) { rows.push({ id: forms.direct, authoritative: true }); }
      if (forms.openrouter) { rows.push({ id: forms.openrouter }); }
    }
    expect(auditGatewayRoutes(cat(rows))).toEqual([]);
  });
});

describe('auditGatewayRoutes — DIVERGENT', () => {
  afterEach(() => jest.resetModules());

  it('flags divergent-missing when the alias lacks a direct form but the catalog authoritatively confirms one', () => {
    // Renamed off 'fable' (v4.6.3 PR1 Task 1 gave the real fable alias an
    // authored direct route, which would make this fixture misleading) --
    // this still pins the positive direction: gatewayOnly: false must NOT
    // suppress the finding for a non-annotated alias.
    const { auditGatewayRoutes } = loadAudit(
      { nova: { openrouter: 'openrouter/anthropic/claude-nova-5' } }, // no direct form authored
      { nova: { directForm: 'none', gatewayOnly: false } }
    );
    const catalogInfo = cat([
      { id: 'openrouter/anthropic/claude-nova-5' },
      { id: 'anthropic/claude-nova-5', authoritative: true }, // now live-confirmed
    ]);
    expect(auditGatewayRoutes(catalogInfo)).toContainEqual({
      alias: 'nova', gateway: 'direct', kind: 'divergent-missing', model: 'anthropic/claude-nova-5'
    });
  });

  it('flags divergent-mismatch when the stored direct form no longer matches the live pairing', () => {
    const { auditGatewayRoutes } = loadAudit({
      haiku: { direct: 'anthropic/claude-haiku-4-5-20250101', openrouter: 'openrouter/anthropic/claude-haiku-4.5' },
    });
    const catalogInfo = cat([
      { id: 'openrouter/anthropic/claude-haiku-4.5' },
      { id: 'anthropic/claude-haiku-4-5-20251001', authoritative: true }, // rotated date suffix
    ]);
    expect(auditGatewayRoutes(catalogInfo)).toContainEqual({
      alias: 'haiku', gateway: 'direct', kind: 'divergent-mismatch',
      model: 'anthropic/claude-haiku-4-5-20250101', expected: 'anthropic/claude-haiku-4-5-20251001'
    });
  });

  it('does NOT flag divergent-missing when the only pairable direct row is non-authoritative (no key)', () => {
    // Same shape as the real haiku-vs-offline-floor case: the floor row DOES
    // literally pair via normalizeKey, but it's a synthetic fallback, not a
    // live-confirmed model -- must never be trusted as "the catalog now has it".
    const { auditGatewayRoutes } = loadAudit({
      fable: { openrouter: 'openrouter/anthropic/claude-fable-5' },
    });
    const catalogInfo = cat([
      { id: 'openrouter/anthropic/claude-fable-5' },
      { id: 'anthropic/claude-fable-5', authoritative: false }, // floor fallback, unverifiable
    ]);
    expect(auditGatewayRoutes(catalogInfo)).toEqual([]);
  });

  it('never runs the divergent check for gateway-only vendors (no direct provider integration at all)', () => {
    const { auditGatewayRoutes } = loadAudit({
      grok: { openrouter: 'openrouter/x-ai/grok-4.3' },
    });
    const catalogInfo = cat([
      { id: 'openrouter/x-ai/grok-4.3' },
      { id: 'x-ai/grok-4.3', authoritative: true }, // hypothetical bare row; must be ignored
    ]);
    expect(auditGatewayRoutes(catalogInfo)).toEqual([]);
  });

  it('does not flag anything for a fully matching divergent alias (both forms present and confirmed)', () => {
    const { auditGatewayRoutes } = loadAudit({
      opus: { direct: 'anthropic/claude-opus-4-8', openrouter: 'openrouter/anthropic/claude-opus-4.8' },
    });
    const catalogInfo = cat([
      { id: 'anthropic/claude-opus-4-8', authoritative: true },
      { id: 'openrouter/anthropic/claude-opus-4.8' },
    ]);
    expect(auditGatewayRoutes(catalogInfo)).toEqual([]);
  });

  it('handles a malformed/absent openrouter form without throwing', () => {
    const { auditGatewayRoutes } = loadAudit({
      broken: { direct: 'anthropic/claude-opus-4-8' }, // no openrouter form at all
    });
    expect(() => auditGatewayRoutes(cat([{ id: 'anthropic/claude-opus-4-8' }]))).not.toThrow();
    expect(auditGatewayRoutes(cat([{ id: 'anthropic/claude-opus-4-8' }]))).toEqual([]);
  });
});

describe('derived-direct suppression + gatewayOnly (v4.6.3 PR1, spec D2)', () => {
  afterEach(() => jest.resetModules());

  it('DERIVED direct miss with a catalog-valid openrouter sibling is NOT stale', () => {
    const { auditGatewayRoutes } = loadAudit(
      { 'gpt-pro': { direct: 'openai/gpt-5.6-sol-pro', openrouter: 'openrouter/openai/gpt-5.6-sol-pro' } },
      { 'gpt-pro': { directForm: 'derived', gatewayOnly: false } }
    );
    const catalogInfo = cat([
      { id: 'openai/gpt-5.6-sol' }, // direct ns non-empty, but sol-pro absent
      { id: 'openrouter/openai/gpt-5.6-sol-pro' }, // openrouter sibling IS catalog-valid
    ]);
    expect(auditGatewayRoutes(catalogInfo).filter(f => f.kind === 'stale')).toEqual([]);
  });

  it('DERIVED direct miss with the openrouter sibling ALSO dead still reports BOTH', () => {
    const { auditGatewayRoutes } = loadAudit(
      { 'gpt-pro': { direct: 'openai/gpt-5.6-sol-pro', openrouter: 'openrouter/openai/gpt-5.6-sol-pro' } },
      { 'gpt-pro': { directForm: 'derived', gatewayOnly: false } }
    );
    const catalogInfo = cat([
      { id: 'openai/gpt-5.6-sol' },
      { id: 'openrouter/openai/gpt-5.6-sol' }, // sol-pro absent from BOTH namespaces
    ]);
    const stale = auditGatewayRoutes(catalogInfo).filter(f => f.kind === 'stale');
    expect(stale.map(f => f.gateway).sort()).toEqual(['direct', 'openrouter']);
  });

  it('AUTHORED direct miss still reports -- suppression never blankets authored routes', () => {
    const { auditGatewayRoutes } = loadAudit(
      { haiku: { direct: 'anthropic/claude-haiku-4-5-20251001', openrouter: 'openrouter/anthropic/claude-haiku-4.5' } },
      { haiku: { directForm: 'authored', gatewayOnly: false } }
    );
    const catalogInfo = cat([
      { id: 'anthropic/claude-sonnet-5' }, // anthropic/ ns non-empty, but not the haiku id
      { id: 'openrouter/anthropic/claude-haiku-4.5' },
    ]);
    expect(auditGatewayRoutes(catalogInfo).filter(f => f.kind === 'stale')).toEqual([
      { alias: 'haiku', gateway: 'direct', kind: 'stale', model: 'anthropic/claude-haiku-4-5-20251001' },
    ]);
  });

  it('gatewayOnly suppresses the derived-direct stale even when the openrouter form is absent from the catalog', () => {
    const { auditGatewayRoutes } = loadAudit(
      { 'gpt-pro': { direct: 'openai/gpt-5.6-sol-pro', openrouter: 'openrouter/openai/gpt-5.6-sol-pro' } },
      { 'gpt-pro': { directForm: 'derived', gatewayOnly: true } }
    );
    const catalogInfo = cat([
      { id: 'openai/gpt-5.6-sol' }, // openrouter ns EMPTY -> classifyModel 'unknown', not 'valid'
    ]);
    expect(auditGatewayRoutes(catalogInfo).filter(f => f.gateway === 'direct')).toEqual([]);
  });

  it('gatewayOnly suppresses divergent-missing -- a declared routing choice never gets a pairing suggestion', () => {
    const { auditGatewayRoutes } = loadAudit(
      { shadow: { openrouter: 'openrouter/openai/some-model' } },
      { shadow: { directForm: 'none', gatewayOnly: true } }
    );
    const catalogInfo = cat([
      { id: 'openai/some-model', authoritative: true }, // would otherwise pair+confirm
      { id: 'openrouter/openai/some-model' },
    ]);
    expect(auditGatewayRoutes(catalogInfo).filter(f => f.kind === 'divergent-missing')).toEqual([]);
  });
});
