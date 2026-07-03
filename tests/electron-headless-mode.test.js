const fs = require('fs');
const path = require('path');

describe('Electron headless test mode', () => {
  it('main.js checks AMICUS_HEADLESS_TEST before showing window', () => {
    const mainSrc = fs.readFileSync(
      path.join(__dirname, '..', 'electron', 'main.js'), 'utf-8'
    );
    expect(mainSrc).toContain('AMICUS_HEADLESS_TEST');
    expect(mainSrc).toContain('mainWindow.show()');
    const showPattern = /if\s*\(\s*!process\.env\.AMICUS_HEADLESS_TEST\s*\)\s*\{[^}]*mainWindow\.show\(\)/s;
    expect(mainSrc).toMatch(showPattern);
  });
});
