/**
 * Legacy config-dir migration tests.
 *
 * `migrateLegacyConfigDir` consolidates the legacy ~/.config/sidecar directory
 * onto the canonical ~/.config/amicus once, non-destructively (copy, not move),
 * so getConfigDir() can no longer flip between the two and orphan data.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const { migrateLegacyConfigDir } = require('../src/utils/config');

let home;
let prevAmicus;
let prevSidecar;

function configDirs(h) {
  return { amicus: path.join(h, '.config', 'amicus'), legacy: path.join(h, '.config', 'sidecar') };
}

beforeEach(() => {
  // The migration must be independent of any CONFIG_DIR override env var.
  prevAmicus = process.env.AMICUS_CONFIG_DIR;
  prevSidecar = process.env.SIDECAR_CONFIG_DIR;
  delete process.env.AMICUS_CONFIG_DIR;
  delete process.env.SIDECAR_CONFIG_DIR;
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-home-'));
});

afterEach(() => {
  if (prevAmicus === undefined) { delete process.env.AMICUS_CONFIG_DIR; } else { process.env.AMICUS_CONFIG_DIR = prevAmicus; }
  if (prevSidecar === undefined) { delete process.env.SIDECAR_CONFIG_DIR; } else { process.env.SIDECAR_CONFIG_DIR = prevSidecar; }
  fs.rmSync(home, { recursive: true, force: true });
});

test('copies the legacy dir onto amicus when amicus is absent, leaving legacy intact', () => {
  const { amicus, legacy } = configDirs(home);
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'config.json'), '{"default":"gemini"}');
  fs.writeFileSync(path.join(legacy, 'council-ledger.jsonl'), '{"model":"gpt"}\n');

  const r = migrateLegacyConfigDir({ home });

  expect(r.migrated).toBe(true);
  expect(r.from).toBe(legacy);
  expect(r.to).toBe(amicus);
  // amicus now has the migrated files...
  expect(fs.readFileSync(path.join(amicus, 'config.json'), 'utf-8')).toBe('{"default":"gemini"}');
  expect(fs.existsSync(path.join(amicus, 'council-ledger.jsonl'))).toBe(true);
  // ...and the legacy dir is untouched (kept as a backup).
  expect(fs.existsSync(path.join(legacy, 'config.json'))).toBe(true);
});

test('no-op when amicus already exists (never clobbers the canonical dir)', () => {
  const { amicus, legacy } = configDirs(home);
  fs.mkdirSync(amicus, { recursive: true });
  fs.writeFileSync(path.join(amicus, 'config.json'), '{"default":"opus"}');
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'config.json'), '{"default":"gemini"}');

  const r = migrateLegacyConfigDir({ home });

  expect(r.migrated).toBe(false);
  expect(r.reason).toBe('amicus-exists');
  expect(fs.readFileSync(path.join(amicus, 'config.json'), 'utf-8')).toBe('{"default":"opus"}'); // unchanged
});

test('no-op when there is no legacy dir', () => {
  const r = migrateLegacyConfigDir({ home });
  expect(r.migrated).toBe(false);
  expect(r.reason).toBe('no-legacy');
  expect(fs.existsSync(configDirs(home).amicus)).toBe(false);
});

test('is idempotent — the second run is a no-op', () => {
  const { legacy } = configDirs(home);
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'config.json'), '{"default":"gemini"}');

  expect(migrateLegacyConfigDir({ home }).migrated).toBe(true);
  const second = migrateLegacyConfigDir({ home });
  expect(second.migrated).toBe(false);
  expect(second.reason).toBe('amicus-exists');
});

test('skips migration when a CONFIG_DIR override is set', () => {
  process.env.AMICUS_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-override-'));
  const { legacy } = configDirs(home);
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'config.json'), '{"default":"gemini"}');

  const r = migrateLegacyConfigDir({ home });
  expect(r.migrated).toBe(false);
  expect(r.reason).toBe('override-set');
});
