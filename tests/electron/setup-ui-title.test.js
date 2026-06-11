const { buildSetupHTML } = require('../../electron/setup-ui');

describe('setup wizard window title', () => {
  test('titles the window "Amicus Setup" with no Sidecar residue', () => {
    const html = buildSetupHTML();
    expect(html).toContain('<title>Amicus Setup</title>');
    expect(html).not.toContain('Sidecar Setup');
  });
});
