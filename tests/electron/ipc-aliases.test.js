'use strict';

/**
 * issue 238 D9 / Phase 3: the wizard's "Needs review" section reads ONE
 * document over IPC, built from the same collectAliasView the CLI list and
 * picker use. These tests pin the document's shape, its freshness flag (the
 * §5 write gate), the §5-gated id set the page's "choose…" may offer, the
 * never-rejects error shape, and Finish's dismissal sink.
 */

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { buildAliasReviewResponse, recordDismissals, registerAliasHandlers } = require('../../electron/ipc-aliases');
const { isFresh } = require('../../src/sidecar/aliases-review-gate');
const { gatedCatalogIds } = require('../../src/utils/alias-proposals');

const HOUR = 60 * 60 * 1000;
const FETCHED_AT = 1_000_000;

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
    expect(doc.gatedIds).toEqual(['openrouter/z-ai/glm-5.3', 'openrouter/z-ai/glm-5.4']); // §5 rules 1–2 applied
    expect(doc.error).toBeUndefined();
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
    expect(doc).toEqual({ proposals: [], catalogAvailable: false, fetchedAt: null, fresh: false, gatedIds: [] });
  });

  it('a throwing collection resolves to the safe shape with the reason — the renderer never sees a rejection', async () => {
    const doc = await buildAliasReviewResponse(deps({ collectAliasView: jest.fn(async () => { throw new Error('disk on fire'); }) }));
    expect(doc.proposals).toEqual([]);
    expect(doc.catalogAvailable).toBe(false);
    expect(doc.fresh).toBe(false);
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

describe('recordDismissals (Finish\'s never-ask-again sink)', () => {
  // Runs against the hermetic scratch config dir (tests/setup/hermetic-config-dir.js).
  const { readDismissals } = require('../../src/utils/alias-store');

  it('nothing to record: undefined/null → 0, no write', () => {
    expect(recordDismissals(undefined)).toBe(0);
    expect(recordDismissals(null)).toBe(0);
    expect(Object.keys(readDismissals())).toEqual([]);
  });

  it('records each key through alias-store (permanent for the alias@id pair, Q5)', () => {
    expect(recordDismissals(['glm@openrouter/z-ai/glm-5.4', 'atlas@openrouter/x/atlas-1'])).toBe(2);
    const d = readDismissals();
    expect(typeof d['glm@openrouter/z-ai/glm-5.4']).toBe('string');
    expect(typeof d['atlas@openrouter/x/atlas-1']).toBe('string');
  });

  it('refuses a non-array and a malformed key (mutant DISMISSKEY: accept anything)', () => {
    expect(() => recordDismissals('glm@x')).toThrow(/array/);
    expect(() => recordDismissals(['no-at-sign'])).toThrow(/alias@proposedId/);
    expect(() => recordDismissals([42])).toThrow(/alias@proposedId/);
  });
});
