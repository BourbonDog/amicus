'use strict';
/**
 * Council finding A1 (PR #215): when the catalog cannot be loaded, main.js sets
 * `quickPicks = undefined` and buildSetupHTML falls back to its pinned default
 * (`resolveQuickPicks([])`). Those picks carried no `canonicalRoutes`, so
 * pickRouteFor fell back to the raw `openrouter/...` route -- which this
 * codebase treats as an EXPLICIT force-OpenRouter literal that never
 * reconsiders direct-first. An offline setup would therefore pin the user to
 * the gateway permanently. The deleted toBareIfDirect used to canonicalise
 * this path.
 */
const { buildSetupHTML } = require('../electron/setup-ui');

function modelChoicesFrom(html) {
  const m = html.match(/var modelChoicesData = (\[[\s\S]*?\]);\n/);
  expect(m).toBeTruthy();
  return JSON.parse(m[1]);
}

describe('setup wizard pinned fallback carries canonicalRoutes (A1)', () => {
  test('every pinned fallback pick ships canonicalRoutes', () => {
    const picks = modelChoicesFrom(buildSetupHTML({ client: 'test' }));
    expect(picks.length).toBeGreaterThan(0);
    for (const p of picks) {
      expect(p.canonicalRoutes).toBeDefined();
    }
  });

  test('a direct-capable vendor canonicalises to the bare form (direct-first preserved offline)', () => {
    const picks = modelChoicesFrom(buildSetupHTML({ client: 'test' }));
    const gemini = picks.find(p => p.alias === 'gemini');
    expect(gemini).toBeDefined();
    expect(gemini.canonicalRoutes.openrouter).not.toMatch(/^openrouter\//);
    expect(gemini.canonicalRoutes.openrouter.startsWith('google/')).toBe(true);
  });

  test('a DIVERGENT vendor keeps the gateway form even with no catalog', () => {
    const picks = modelChoicesFrom(buildSetupHTML({ client: 'test' }));
    const opus = picks.find(p => p.vendorPath === 'anthropic');
    expect(opus).toBeDefined();
    // toBareIfDirect stripped this and fabricated anthropic's dot id; the real
    // primitive refuses, catalog or no catalog.
    expect(opus.canonicalRoutes.openrouter.startsWith('openrouter/')).toBe(true);
  });
});
