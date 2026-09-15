'use strict';
/**
 * #238 D4: createSetupWindow threads the launcher's AMICUS_SETUP_PANE token
 * into buildSetupHTML as initialPane. Source-level, like
 * tests/setup-ui-effective-aliases.test.js (main.js runs Electron at import).
 */
const fs = require('fs');
const path = require('path');
const MAIN = fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'main.js'), 'utf-8');

function fnBlock(name) {
  const start = MAIN.indexOf(`function ${name}`);
  expect(start).toBeGreaterThan(-1);
  const end = MAIN.indexOf('// ====', start);
  return MAIN.slice(start, end > start ? end : MAIN.length);
}
function balancedParens(text, openParenIdx) {
  let depth = 0;
  for (let i = openParenIdx; i < text.length; i++) {
    if (text[i] === '(') { depth++; }
    else if (text[i] === ')') { depth--; if (depth === 0) { return text.slice(openParenIdx, i + 1); } }
  }
  throw new Error('unbalanced parens');
}

describe('createSetupWindow → initialPane', () => {
  it('passes initialPane from AMICUS_SETUP_PANE into buildSetupHTML', () => {
    const block = fnBlock('createSetupWindow');
    const idx = block.indexOf('buildSetupHTML(');
    const call = balancedParens(block, idx + 'buildSetupHTML'.length);
    expect(call).toMatch(/initialPane:\s*process\.env\.AMICUS_SETUP_PANE \|\| ''/);
  });
  it('the Settings child window (toolbar gear) never lands on a pane', () => {
    const block = fnBlock('createSettingsChildWindow');
    expect(block).not.toContain('initialPane');
  });
});
