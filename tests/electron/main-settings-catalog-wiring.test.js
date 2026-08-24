'use strict';

/**
 * issue 138 wiring regression (source-level): main.js runs heavy Electron side
 * effects at import and exposes no module.exports, so createSettingsChildWindow
 * cannot be invoked directly from a test (same constraint documented in
 * main-security-wiring.test.js / main-workspace-wiring.test.js, which assert
 * on this exact file the same way). This asserts the Settings child window's
 * construction site resolves a live catalog and threads it into buildSetupHTML,
 * the same way createSetupWindow already does, instead of building Step 2 from
 * no quickPicks (which falls back to the pinned `[offline list]` badge even
 * when a fresh catalog sits on disk).
 */

const fs = require('fs');
const path = require('path');

const MAIN = fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'main.js'), 'utf-8');

/** The createSettingsChildWindow function body, isolated from the rest of main.js. */
function settingsWindowBlock() {
  const start = MAIN.indexOf('function createSettingsChildWindow');
  expect(start).toBeGreaterThan(-1);
  const end = MAIN.indexOf('// Council Workspace', start);
  expect(end).toBeGreaterThan(start);
  return MAIN.slice(start, end);
}

describe('main.js Settings child window catalog wiring (issue 138)', () => {
  test('resolves quick picks from the on-disk catalog cache', () => {
    const block = settingsWindowBlock();
    expect(block).toContain("require('../src/utils/model-catalog')");
    expect(block).toMatch(/\breadCache\(\)/);
    expect(block).toContain("require('../src/utils/quick-picks')");
    expect(block).toMatch(/resolveQuickPicks\(/);
  });

  test('builds a per-alias vendor shortlist, mirroring createSetupWindow', () => {
    const block = settingsWindowBlock();
    expect(block).toContain("require('../src/utils/model-shortlist')");
    expect(block).toMatch(/buildModelShortlist\(/);
  });

  test('passes both quickPicks and shortlists into buildSetupHTML', () => {
    const block = settingsWindowBlock();
    const callIdx = block.indexOf('buildSetupHTML({');
    expect(callIdx).toBeGreaterThan(-1);
    // buildSetupHTML({ client: CLIENT, quickPicks, shortlists }) — the whole
    // options object, not just the call site, so a revert to
    // `buildSetupHTML({ client: CLIENT })` (no quick picks) fails this.
    const call = block.slice(callIdx, block.indexOf('}', block.indexOf(')', callIdx)) + 1);
    expect(call).toMatch(/\bquickPicks\b/);
    expect(call).toMatch(/\bshortlists\b/);
  });

  test('stays synchronous — no getCatalog() network fetch when Settings opens', () => {
    const block = settingsWindowBlock();
    expect(block).not.toMatch(/getCatalog\(/);
    expect(MAIN).not.toMatch(/async function createSettingsChildWindow/);
  });

  test('does not carry a literal #138 (electron-token-drift traps this)', () => {
    const block = settingsWindowBlock();
    expect(block).not.toMatch(/#138/);
  });
});
