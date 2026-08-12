// tests/scripts/workflow-yaml-valid.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const WORKFLOWS_DIR = path.join(__dirname, '..', '..', '.github', 'workflows');
const files = fs.readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith('.yml'));

describe('every workflow file is valid YAML', () => {
  test('at least one workflow file was found to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test.each(files)('%s parses with yaml.load()', (file) => {
    const full = path.join(WORKFLOWS_DIR, file);
    expect(() => yaml.load(fs.readFileSync(full, 'utf-8'))).not.toThrow();
  });
});
