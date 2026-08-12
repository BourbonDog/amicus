// tests/docs-plan-refs.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

/** Files that must not hard-link a specific plan doc: plans are pruned at the
 *  release cut (R13), so any citation of one rots into a dead path. Specs are
 *  permanent and may be cited freely. */
const SCANNED = ['src', 'docs', 'skills'];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'superpowers') { continue; } // the plans themselves may cross-reference
      walk(p, out);
    } else if (/\.(js|md)$/.test(e.name)) { out.push(p); }
  }
  return out;
}

test('no shipped source or doc cites a specific plan file (plans are pruned at release)', () => {
  const offenders = [];
  for (const root of SCANNED) {
    for (const file of walk(path.join(ROOT, root))) {
      const text = fs.readFileSync(file, 'utf-8');
      const hits = text.match(/docs\/superpowers\/plans\/[\w.-]+\.md/g);
      if (hits) { offenders.push(`${path.relative(ROOT, file)} -> ${hits.join(', ')}`); }
    }
  }
  expect(offenders).toEqual([]);
});
