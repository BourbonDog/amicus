// tests/schemas-degrades-lockstep.test.js
'use strict';

const fs = require('fs');
const path = require('path');

const SCHEMAS_DIR = path.join(__dirname, '..', 'schemas');

function readSchema(name) {
  return JSON.parse(fs.readFileSync(path.join(SCHEMAS_DIR, `${name}.schema.json`), 'utf-8'));
}

/** Recursively strip every `description` key — the per-schema prose legitimately differs. */
function stripDescriptions(node) {
  if (Array.isArray(node)) { return node.map(stripDescriptions); }
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k !== 'description') { out[k] = stripDescriptions(v); }
    }
    return out;
  }
  return node;
}

// v4.6 Plan 4 Task 6a: council-run/council-verdict/doctor each publish their
// own degrades[] block, hand-copied into three files — nothing enforces they
// stay the same record shape. STRUCTURE-ONLY: per-file `description` prose
// legitimately differs (e.g. doctor's `data` field names a doctor-flavored
// example), so every description is stripped before comparing.
describe('degrades.items schema lockstep across council-run/council-verdict/doctor (v4.6 Plan 4 Task 6a)', () => {
  test('the three schemas define the identical degrade/heal record shape, structure-only', () => {
    const runItems = stripDescriptions(readSchema('council-run').properties.degrades.items);
    const verdictItems = stripDescriptions(readSchema('council-verdict').properties.degrades.items);
    const doctorItems = stripDescriptions(readSchema('doctor').properties.degrades.items);
    expect(runItems).toEqual(verdictItems);
    expect(verdictItems).toEqual(doctorItems);
  });
});
