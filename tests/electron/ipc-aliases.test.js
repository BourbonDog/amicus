'use strict';

/**
 * issue 238 D9 / Phase 3: the wizard's "Needs review" section reads ONE
 * document over IPC, built from the same collectAliasView the CLI list and
 * picker use. These tests pin the document's shape, its freshness flag (the
 * §5 write gate) and the moment it expires (`freshUntil`, so the page can
 * re-check at ACTION time), the §5-gated id set the page's "choose…" may
 * offer, the never-rejects error shape, and Finish's dismissal step — which
 * stamps into the config object it is handed and never touches disk itself.
 */

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
// applyDismissals must never load or save config (mutant WRITEHERE): the
// module is mocked so any such call is visible — and would be a bug.
jest.mock('../../src/utils/config', () => ({ loadConfig: jest.fn(), saveConfig: jest.fn() }));

const { buildAliasReviewResponse, applyDismissals, registerAliasHandlers } = require('../../electron/ipc-aliases');
const { loadConfig, saveConfig } = require('../../src/utils/config');
const { isFresh } = require('../../src/sidecar/aliases-review-gate');
const { gatedCatalogIds } = require('../../src/utils/alias-proposals');

const HOUR = 60 * 60 * 1000;
const FETCHED_AT = 1_000_000;
const MAX_AGE = 24 * HOUR;   // injected, never the live DEFAULT_MAX_AGE_MS

// A hand-built engine view (the proposal shape is alias-proposals.js's
// docblock contract) — never the live shipped pins.
const VIEW = {
  rows: [],
  proposals: [{
    alias: 'glm', state: 'pinned', current: 'openrouter/z-ai/glm-5.3', shipped: 'openrouter/z-ai/glm-5.3', curated: true,
    reasons: ['newer-sibling'], candidates: [{ id: 'openrouter/z-ai/glm-5.4', why: 'newer-sibling', evidence: {} }],
    dismissKey: 'glm@openrouter/z-ai/glm-5.4',
  }],
  catalogInfo: {
    models: [
      { id: 'openrouter/z-ai/glm-5.3' }, { id: 'openrouter/z-ai/glm-5.4' },
      { id: 'anthropic/claude-floor', authoritative: false },   // floor row: never offered
      { id: 'google/gemini-x' },                                // rejected namespace: never offered
    ],
    fetchedAt: FETCHED_AT,
    providerFailures: [{ provider: 'google', error: 'HTTP 403' }],
  },
  catalogAvailable: true,
  retired: {},
};

function deps(over = {}) {
  return {
    collectAliasView: jest.fn(async () => VIEW),
    isFresh,
    gatedCatalogIds,
    now: () => FETCHED_AT + HOUR,
    maxAgeMs: MAX_AGE,
    ...over,
  };
}

describe('buildAliasReviewResponse (sidecar:get-alias-review)', () => {
  it('returns the engine view as one document: proposals, catalog facts, fresh, gatedIds', async () => {
    const d = deps();
    const doc = await buildAliasReviewResponse(d);
    expect(doc.proposals).toHaveLength(1);
    expect(doc.proposals[0].alias).toBe('glm');
    expect(doc.catalogAvailable).toBe(true);
    expect(doc.fetchedAt).toBe(FETCHED_AT);
    expect(doc.fresh).toBe(true);
    expect(doc.freshUntil).toBe(FETCHED_AT + MAX_AGE);
    expect(doc.gatedIds).toEqual(['openrouter/z-ai/glm-5.3', 'openrouter/z-ai/glm-5.4']); // §5 rules 1–2 applied
    expect(doc.error).toBeUndefined();
  });

  it('A4: freshUntil = fetchedAt + the injected maxAgeMs, so the page can re-check the gate at ACTION time (mutant FROZENFRESH: no freshUntil)', async () => {
    const doc = await buildAliasReviewResponse(deps({ maxAgeMs: 2 * HOUR }));
    expect(doc.freshUntil).toBe(FETCHED_AT + 2 * HOUR);
    expect(doc.fresh).toBe(true);                                   // still the fetch-time verdict
    // the two are independent facts: a stale-at-fetch document still says when it WOULD have expired
    const stale = await buildAliasReviewResponse(deps({ now: () => FETCHED_AT + 25 * HOUR }));
    expect(stale.fresh).toBe(false);
    expect(stale.freshUntil).toBe(FETCHED_AT + MAX_AGE);
  });

  it('A4: freshUntil is null without a catalog or without a timestamp', async () => {
    const noCatalog = await buildAliasReviewResponse(deps({ collectAliasView: jest.fn(async () => ({ ...VIEW, catalogAvailable: false })) }));
    expect(noCatalog.freshUntil).toBeNull();
    const noStamp = await buildAliasReviewResponse(deps({ collectAliasView: jest.fn(async () => ({ ...VIEW, catalogInfo: { ...VIEW.catalogInfo, fetchedAt: null } })) }));
    expect(noStamp.fetchedAt).toBeNull();
    expect(noStamp.freshUntil).toBeNull();
  });

  it('the wizard view never writes config: collectAliasView is asked for write:false (mutant WIZARDWRITE)', async () => {
    const d = deps();
    await buildAliasReviewResponse(d);
    expect(d.collectAliasView).toHaveBeenCalledTimes(1);
    expect(d.collectAliasView.mock.calls[0][0]).toEqual({ write: false });
  });

  it('a catalog older than 24 h is not fresh (the §5 write gate)', async () => {
    const doc = await buildAliasReviewResponse(deps({ now: () => FETCHED_AT + 25 * HOUR }));
    expect(doc.fresh).toBe(false);
    expect(doc.proposals).toHaveLength(1); // display gate: still shown (Q1)
  });

  it('a fetchedAt in the future (clock skew) is not fresh', async () => {
    const doc = await buildAliasReviewResponse(deps({ now: () => FETCHED_AT - 1 }));
    expect(doc.fresh).toBe(false);
  });

  it('catalogAvailable false overrides an otherwise-fresh fetchedAt (mutant FRESHNOCATALOG)', async () => {
    const doc = await buildAliasReviewResponse(deps({
      collectAliasView: jest.fn(async () => ({ ...VIEW, catalogAvailable: false })),
    }));
    expect(doc.fresh).toBe(false);
  });

  it('no catalog at all: catalogAvailable false, fetchedAt null, no proposals, nothing gated', async () => {
    const doc = await buildAliasReviewResponse(deps({
      collectAliasView: jest.fn(async () => ({ rows: [], proposals: [], catalogInfo: { models: [], fetchedAt: null, providerFailures: [] }, catalogAvailable: false, retired: {} })),
    }));
    expect(doc).toEqual({ proposals: [], catalogAvailable: false, fetchedAt: null, fresh: false, freshUntil: null, gatedIds: [] });
  });

  it('a throwing collection resolves to the safe shape with the reason — the renderer never sees a rejection', async () => {
    const doc = await buildAliasReviewResponse(deps({ collectAliasView: jest.fn(async () => { throw new Error('disk on fire'); }) }));
    expect(doc.proposals).toEqual([]);
    expect(doc.catalogAvailable).toBe(false);
    expect(doc.fresh).toBe(false);
    expect(doc.freshUntil).toBeNull();
    expect(doc.gatedIds).toEqual([]);
    expect(doc.error).toBe('disk on fire');
  });

  it('tolerates a view with odd fields (non-array proposals, missing catalogInfo)', async () => {
    const doc = await buildAliasReviewResponse(deps({ collectAliasView: jest.fn(async () => ({ proposals: null, catalogAvailable: 'yes' })) }));
    expect(doc.proposals).toEqual([]);
    expect(doc.catalogAvailable).toBe(true);
    expect(doc.fetchedAt).toBeNull();
    expect(doc.gatedIds).toEqual([]);
  });
});

describe('registerAliasHandlers', () => {
  it('registers sidecar:get-alias-review on the given ipcMain and serves the document', async () => {
    const handlers = {};
    registerAliasHandlers({ handle: (channel, fn) => { handlers[channel] = fn; } }, deps());
    expect(Object.keys(handlers)).toEqual(['sidecar:get-alias-review']);
    const doc = await handlers['sidecar:get-alias-review']({});
    expect(doc.proposals[0].dismissKey).toBe('glm@openrouter/z-ai/glm-5.4');
  });
});

describe('applyDismissals (Finish\'s never-ask-again step: stamps into the config it is handed — one write, B1/C4/A5/D3)', () => {
  const NOW = new Date('2026-09-15T12:00:00Z');
  beforeEach(() => { jest.clearAllMocks(); });

  it('nothing to stamp: undefined/null → 0, cfg untouched', () => {
    const cfg = { default: 'gemini', aliases: {} };
    expect(applyDismissals(cfg, undefined)).toBe(0);
    expect(applyDismissals(cfg, null)).toBe(0);
    expect(cfg).toEqual({ default: 'gemini', aliases: {} });
  });

  it('stamps each key into cfg.aliasReview.dismissed with the ISO time, returns the count, and never loads or saves config (mutant WRITEHERE)', () => {
    const cfg = { default: 'gemini', aliases: { glm: 'openrouter/z-ai/glm-5.4' }, aliasReview: { autoRefresh: false } };
    expect(applyDismissals(cfg, ['glm@openrouter/z-ai/glm-5.4', 'atlas@openrouter/x/atlas-1'], NOW)).toBe(2);
    expect(cfg.aliasReview).toEqual({ autoRefresh: false, dismissed: { 'glm@openrouter/z-ai/glm-5.4': '2026-09-15T12:00:00.000Z', 'atlas@openrouter/x/atlas-1': '2026-09-15T12:00:00.000Z' } });
    expect(cfg.aliases).toEqual({ glm: 'openrouter/z-ai/glm-5.4' });   // siblings kept
    expect(loadConfig).not.toHaveBeenCalled();                            // WRITEHERE dies here
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it('refuses a non-array and a malformed key (mutant DISMISSKEY: accept anything) — and a malformed key stamps nothing before it throws', () => {
    expect(() => applyDismissals({}, 'glm@x')).toThrow(/array/);
    const cfg = { aliases: {} };
    expect(() => applyDismissals(cfg, ['no-at-sign'])).toThrow(/alias@proposedId/);
    expect(() => applyDismissals(cfg, [42])).toThrow(/alias@proposedId/);
    expect(cfg).toEqual({ aliases: {} });
    expect(saveConfig).not.toHaveBeenCalled();
  });
});
