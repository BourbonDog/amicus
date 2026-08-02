'use strict';
// tests/council/degrade-invariant.test.js
const fs = require('fs'); const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');
const ALLOWED = path.join('council', 'run-degrade.js');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full, out); } else if (e.name.endsWith('.js')) { out.push(full); }
  }
  return out;
}

test('degraded.value is assigned ONLY inside run-degrade.js', () => {
  // Match assignments, not prose: several comments legitimately discuss `degraded`.
  const assign = /degraded\s*\.\s*value\s*=(?!=)/;
  const offenders = walk(SRC)
    // Normalize CRLF: checkouts with autocrlf have already broken two docs suites.
    .filter(f => assign.test(fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')))
    .map(f => path.relative(SRC, f))
    .filter(rel => rel !== ALLOWED);
  expect(offenders).toEqual([]);
});
