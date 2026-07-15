const d = require('../src/utils/model-descriptor');
const aliases = { gpt: 'openrouter/openai/gpt-5.5', gemini: 'openrouter/google/gemini-3.5-flash' };

describe('parseDescriptor', () => {
  test('explicit openrouter/ literal', () => {
    expect(d.parseDescriptor('openrouter/openai/gpt-5.5', { aliases })).toMatchObject({
      kind: 'openrouter-literal', vendor: 'openai', model: 'gpt-5.5', isExplicitOpenRouter: true,
    });
  });
  test('bare canonical provider/model', () => {
    expect(d.parseDescriptor('openai/gpt-5.5', { aliases })).toMatchObject({
      kind: 'canonical', vendor: 'openai', model: 'gpt-5.5', isExplicitOpenRouter: false,
    });
  });
  test('multi-segment canonical keeps the full model tail', () => {
    expect(d.parseDescriptor('google/gemini-3.5-flash', { aliases })).toMatchObject({
      kind: 'canonical', vendor: 'google', model: 'gemini-3.5-flash',
    });
  });
  test('known no-slash alias', () => {
    expect(d.parseDescriptor('gpt', { aliases })).toMatchObject({ kind: 'alias', raw: 'gpt' });
  });
  test('unknown no-slash token is invalid (was a silent openrouter default)', () => {
    const r = d.parseDescriptor('grok4', { aliases });
    expect(r.kind).toBe('invalid');
    expect(r.error).toMatch(/unknown model/i);
  });
  test('empty / whitespace token is invalid', () => {
    expect(d.parseDescriptor('   ', { aliases }).kind).toBe('invalid');
  });
});

describe('RouteResult factories', () => {
  test('resolved', () => {
    expect(d.resolved({ model: 'openai/gpt-5.5', gateway: 'direct', executableId: 'openai/gpt-5.5', provenance: { source: 'cli' } }))
      .toMatchObject({ kind: 'resolved', gateway: 'direct', executableId: 'openai/gpt-5.5' });
  });
  test('routeError carries the machine-readable shape', () => {
    expect(d.routeError({ field: 'model', requested: 'x-ai/grok', reason: 'no_direct_integration', preferredGateway: 'direct', suggestions: [] }))
      .toEqual({ kind: 'error', type: 'model_route_error', field: 'model', requested: 'x-ai/grok', reason: 'no_direct_integration', preferredGateway: 'direct', suggestions: [] });
  });
  test('selectionRequired', () => {
    expect(d.selectionRequired({ requested: 'anthropic/claude-x', suggestions: [{ model: 'x', gateway: 'openrouter', note: 'via OR' }] }))
      .toMatchObject({ kind: 'selection_required', requested: 'anthropic/claude-x' });
  });
});
