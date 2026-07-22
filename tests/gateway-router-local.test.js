'use strict';

const { resolveRoute } = require('../src/utils/gateway-router');

const OLLAMA = { id: 'ollama', baseURL: 'http://127.0.0.1:11434/v1', flavor: 'ollama', keyPresent: false };
const base = (over) => ({
  descriptor: 'ollama/llama3.3',
  source: 'test', gatewayMode: 'auto', validateModel: true, allowSelection: false,
  keys: { openrouter: false }, catalogInfo: { models: [] },
  localProviders: { ollama: OLLAMA },
  localLive: { status: 'ok', models: ['ollama/llama3.3'] },
  ...over,
});

describe('resolveRoute: local class', () => {
  test('resolves to gateway:local when the model is in the live list', () => {
    const r = resolveRoute(base());
    expect(r.kind).toBe('resolved');
    expect(r.gateway).toBe('local');
    expect(r.executableId).toBe('ollama/llama3.3');
  });

  test('--gateway direct ACCEPTS a local route (resolved Q2)', () => {
    const r = resolveRoute(base({ gatewayMode: 'direct' }));
    expect(r.kind).toBe('resolved');
    expect(r.gateway).toBe('local');
  });

  test('--gateway openrouter on a local vendor → no_openrouter_route', () => {
    const r = resolveRoute(base({ gatewayMode: 'openrouter' }));
    expect(r.kind).toBe('error');
    expect(r.reason).toBe('no_openrouter_route');
  });

  test('explicit openrouter/<localId>/... literal → no_openrouter_route', () => {
    const r = resolveRoute(base({ descriptor: 'openrouter/ollama/llama3.3' }));
    expect(r.kind).toBe('error');
    expect(r.reason).toBe('no_openrouter_route');
  });

  // D2/M4: step 2 ("explicit conflict: force-OR literal vs --gateway direct",
  // gateway-router.js:80-83) fires BEFORE step 3 and returns gateway_conflict with no
  // local carve-out, so without the step-2 bypass the local branch is never reached.
  // Spec §4.2 point 1 is unconditional: an explicit openrouter/<localId>/… literal is
  // ALWAYS no_openrouter_route, with no `direct` exception.
  test('explicit openrouter/<localId>/... + --gateway direct → no_openrouter_route (NOT gateway_conflict)', () => {
    const r = resolveRoute(base({ descriptor: 'openrouter/ollama/llama3.3', gatewayMode: 'direct' }));
    expect(r.kind).toBe('error');
    expect(r.reason).toBe('no_openrouter_route');
    expect(r.reason).not.toBe('gateway_conflict');
  });

  test('declared bearer but missing value → no_local_key', () => {
    const r = resolveRoute(base({
      localProviders: { ollama: { ...OLLAMA, apiKeyEnv: 'OLLAMA_API_KEY', keyPresent: false } },
    }));
    expect(r.kind).toBe('error');
    expect(r.reason).toBe('no_local_key');
  });

  test('keyless provider skips the key check', () => {
    const r = resolveRoute(base({ localProviders: { ollama: OLLAMA } }));
    expect(r.kind).toBe('resolved');
  });

  test('unreachable endpoint → local_endpoint_unreachable with flavor hint', () => {
    const r = resolveRoute(base({ localLive: { status: 'unreachable', models: [] } }));
    expect(r.kind).toBe('error');
    expect(r.reason).toBe('local_endpoint_unreachable');
    expect(r.hint || '').toMatch(/ollama serve/i);
  });

  test('probe ok but model absent + allowSelection → selection_required (capped at 6)', () => {
    const r = resolveRoute(base({
      descriptor: 'ollama/ghost', allowSelection: true,
      localLive: { status: 'ok', models: ['ollama/a', 'ollama/b', 'ollama/c', 'ollama/d', 'ollama/e', 'ollama/f', 'ollama/g'] },
    }));
    expect(r.kind).toBe('selection_required');
    expect(r.suggestions.length).toBe(6);
  });

  test('probe ok but model absent + no selection → model_not_found w/ ollama pull hint', () => {
    const r = resolveRoute(base({ descriptor: 'ollama/ghost', allowSelection: false }));
    expect(r.kind).toBe('error');
    expect(r.reason).toBe('model_not_found');
    expect(r.hint || '').toMatch(/ollama pull/i);
  });

  test('probe skipped (--no-validate-model) → resolved with unverified notice', () => {
    const r = resolveRoute(base({ localLive: { status: 'skipped', models: [] } }));
    expect(r.kind).toBe('resolved');
    expect(r.gateway).toBe('local');
    expect(r.notice || '').toMatch(/unverified|attempting/i);
  });

  // C5: a local id that collides with a real OpenRouter vendor namespace (spec §4.2
  // worked example, ...-design.md:145-149) must still resolve local for a BARE
  // descriptor — shadowing (resolved Q6), not ambiguity. No explicit openrouter/
  // prefix and no OpenRouter key configured; step 3.5 fires before the
  // gateway-only-vendor check, so the local id wins regardless of isDirectProvider.
  test('a local id shadows a same-named OpenRouter vendor for a bare descriptor (spec Q6)', () => {
    const QWEN = { id: 'qwen', baseURL: 'http://127.0.0.1:11434/v1', flavor: 'ollama', keyPresent: false };
    const r = resolveRoute(base({
      descriptor: 'qwen/some-model',
      localProviders: { qwen: QWEN },
      localLive: { status: 'ok', models: ['qwen/some-model'] },
      keys: { openrouter: false },
    }));
    expect(r.kind).toBe('resolved');
    expect(r.gateway).toBe('local');
    expect(r.executableId).toBe('qwen/some-model');
  });
});
