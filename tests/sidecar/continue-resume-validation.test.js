/** F5: continue --model validates like start; inherited models warn, never block. */

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

describe('warnIfNotInCatalog', () => {
  function load({ catalog }) {
    jest.resetModules();
    jest.doMock('../../src/utils/model-catalog', () => ({
      getCatalog: jest.fn(async () => catalog),
    }));
    return require('../../src/utils/model-validator');
  }

  it('writes a warning to stderr for a stale openrouter model', async () => {
    const { warnIfNotInCatalog } = load({
      catalog: [{ id: 'openrouter/x-ai/grok-4.3', name: 'G' }]
    });
    const writes = [];
    const orig = process.stderr.write;
    process.stderr.write = (s) => { writes.push(String(s)); return true; };
    try {
      await warnIfNotInCatalog('openrouter/x-ai/grok-4.1-fast');
    } finally { process.stderr.write = orig; }
    const out = writes.join('');
    expect(out).toContain('grok-4.1-fast');
    expect(out).toContain('amicus models --check');
  });

  it('is silent for a valid model, an empty catalog, and non-openrouter models', async () => {
    const cases = [
      { catalog: [{ id: 'openrouter/x-ai/grok-4.3', name: 'G' }], model: 'openrouter/x-ai/grok-4.3' },
      { catalog: [], model: 'openrouter/x-ai/grok-4.1-fast' },
      { catalog: [{ id: 'openrouter/x-ai/grok-4.3', name: 'G' }], model: 'google/gemini-3.1-pro-preview' },
    ];
    for (const c of cases) {
      const { warnIfNotInCatalog } = load({ catalog: c.catalog });
      const writes = [];
      const orig = process.stderr.write;
      process.stderr.write = (s) => { writes.push(String(s)); return true; };
      try { await warnIfNotInCatalog(c.model); } finally { process.stderr.write = orig; }
      expect(writes.join('')).toBe('');
    }
  });

  it('never throws even if the catalog read explodes', async () => {
    jest.resetModules();
    jest.doMock('../../src/utils/model-catalog', () => ({
      getCatalog: jest.fn(async () => { throw new Error('disk'); }),
    }));
    const { warnIfNotInCatalog } = require('../../src/utils/model-validator');
    await expect(warnIfNotInCatalog('openrouter/a/b')).resolves.toBeUndefined();
  });

  it('is silent for non-string/empty models (legacy metadata)', async () => {
    const { warnIfNotInCatalog } = load({ catalog: [{ id: 'openrouter/x-ai/grok-4.3', name: 'G' }] });
    const writes = [];
    const orig = process.stderr.write;
    process.stderr.write = (s) => { writes.push(String(s)); return true; };
    try {
      await warnIfNotInCatalog(undefined);
      await warnIfNotInCatalog('');
      await warnIfNotInCatalog(42);
    } finally { process.stderr.write = orig; }
    expect(writes.join('')).toBe('');
  });
});

describe('wiring (source guards)', () => {
  const fs = require('fs');
  const path = require('path');

  it('handleContinue resolves+validates an explicit --model like start', () => {
    // B21-rest: handleContinue moved from bin/amicus.js to its own module
    // (src/cli-handlers-resume-continue.js) so the --json plumbing could fit
    // under the size gate. Same behavior, new home — update the guard's source.
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'cli-handlers-resume-continue.js'), 'utf-8');
    const handler = src.slice(src.indexOf('async function handleContinue'));
    expect(handler).toMatch(/resolveModelFromArgs/);
    expect(handler).toMatch(/validateFallbackModel/);
    expect(handler).toMatch(/if \(args\.model !== undefined\)/);
  });

  it('continueSidecar and resumeSidecar warn on inherited models', () => {
    const cont = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'sidecar', 'continue.js'), 'utf-8');
    const res = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'sidecar', 'resume.js'), 'utf-8');
    expect(cont).toMatch(/warnIfNotInCatalog/);
    expect(res).toMatch(/warnIfNotInCatalog/);
  });
});
