// tests/template/render-drift.test.js
'use strict';
// v4.9 W1 Task 6: KNOWN_VARIABLES is the single source for validation AND
// rendering. Extending the exported set must be sufficient for both — no
// hand-enumerated copy (render.js once carried an inline validation array and
// a per-name replacement chain) left to drift. {{foo_bar}} reads data.fooBar.
const { renderTemplate, KNOWN_VARIABLES } = require('../../src/template/render');

describe('KNOWN_VARIABLES single source', () => {
  test('an entry added to KNOWN_VARIABLES validates AND renders', () => {
    const len = KNOWN_VARIABLES.length;
    KNOWN_VARIABLES.push('flavor', 'flavor_note');
    try {
      const res = renderTemplate('{{flavor}} {{flavor_note}}', {
        date: '2026-08-25', project: 'C:\\proj', flavor: 'oak', flavorNote: 'smoky',
      });
      expect(res.error).toBeUndefined();
      expect(res.text).toBe('oak smoky');
    } finally {
      KNOWN_VARIABLES.length = len;
    }
  });
});
