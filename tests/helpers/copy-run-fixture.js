'use strict';

const fs = require('fs');
const path = require('path');

// copyRunFixture(srcFixtureDir, destRunDir) → destRunDir
function copyRunFixture(src, dest) {
  fs.cpSync(src, dest, { recursive: true });
  const p = path.join(dest, 'run.json');
  const run = JSON.parse(fs.readFileSync(p, 'utf-8'));
  if (run.options) { run.options.outDir = dest; }
  for (const s of run.stages || []) {
    if (typeof s.project === 'string' && s.project.startsWith('__RUNDIR__')) {
      s.project = path.join(dest, s.project.slice('__RUNDIR__'.length)); // '' | '/_scratch'
    }
  }
  fs.writeFileSync(p, JSON.stringify(run, null, 2));
  return dest;
}

module.exports = { copyRunFixture };
