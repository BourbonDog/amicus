'use strict';

/**
 * The setup window's Step 1 "Save & Test" against the MASKED HINT
 * (2026-10-14 diagnosis). The inline keys script
 * (electron/setup-ui-keys-script.js) runs here under `new Function` against
 * tests/helpers/fake-dom.js — the page globals setup-ui.js declares around it
 * are declared by the harness.
 *
 * The defect: for a provider with a stored key, the box was pre-filled with
 * the hint `readApiKeyHints()` returns (first 8 chars + U+2022 bullets), and
 * Save & Test sent the box's value verbatim. So it tested the HINT — every
 * vendor failed, each with a different message (Node's header-character error
 * for four, a 400 for google) — and clicking in and pasting APPENDED the real
 * key to the hint, with the same result.
 *
 * Now the hint is the box's PLACEHOLDER, never its value: typing or pasting
 * cannot append to it, and an empty box on a configured provider re-tests the
 * STORED key in the main process (sidecar:test-stored-key) — the renderer
 * never sees the real key.
 */

const { buildKeysScript } = require('../../electron/setup-ui-keys-script');
const { PROVIDERS } = require('../../electron/setup-ui-keys');
const { createFakeDocument } = require('../helpers/fake-dom');

const HINT = 'sk-proj-' + '•'.repeat(12);
const PLACEHOLDER = (id) => PROVIDERS.find((p) => p.id === id).placeholder;
const flush = async () => { for (let i = 0; i < 5; i++) { await new Promise((r) => setImmediate(r)); } };

/**
 * Build the Step 1 DOM, run the real keys script against it, and hand back the
 * controls plus a recording `invoke` that answers per channel.
 */
function loadKeysStep({ keyHints = { openai: HINT }, answers = {} } = {}) {
  const { document, body } = createFakeDocument();
  const add = (tag, id, cls) => {
    const e = document.createElement(tag);
    if (id) { e.id = id; }
    if (cls) { e.className = cls; }
    body.appendChild(e);
    return e;
  };
  for (const p of PROVIDERS) {
    add('button', null, 'provider-btn').setAttribute('data-provider', p.id);
    add('span', `check-${p.id}`);
  }
  ['test-btn', 'eye-btn', 'remove-btn', 'status-msg', 'key-section', 'key-label', 'help-link']
    .forEach((id) => add('div', id));
  add('input', 'api-key-input');

  const calls = [];
  const invoke = jest.fn(async (channel, ...args) => {
    calls.push([channel, ...args]);
    const a = answers[channel];
    return typeof a === 'function' ? a(...args) : a;
  });
  const window = { sidecarSetup: { invoke, openExternal: () => {} } };
  const configuredKeys = {};
  Object.keys(keyHints).forEach((k) => { configuredKeys[k] = true; });

  // eslint-disable-next-line no-new-func
  const factory = new Function('document', 'window', 'providers', 'keyHints', 'configuredKeys', 'updateNextState', `
    var selectedProvider = null;
    var keyValid = false, validatedKey = '';
    var $ = function(id) { return document.getElementById(id); };
    var keyInput = $('api-key-input'), testBtn = $('test-btn'), eyeBtn = $('eye-btn');
    var removeBtn = $('remove-btn'), statusMsg = $('status-msg');
    var keySection = $('key-section'), keyLabel = $('key-label'), helpLink = $('help-link');
    ${buildKeysScript()}
  `);
  // A private copy: the page reads this array, and rebuildProviders swaps its
  // objects for equal new ones (same ids) in place.
  const providers = PROVIDERS.map((p) => ({ ...p }));
  factory(document, window, providers, keyHints, configuredKeys, () => {});

  const $ = (id) => document.getElementById(id);
  const pick = (id) => body.querySelector(`.provider-btn[data-provider="${id}"]`).click();
  const rebuildProviders = () => providers.splice(0, providers.length, ...providers.map((p) => ({ ...p })));
  return { input: $('api-key-input'), testBtn: $('test-btn'), removeBtn: $('remove-btn'), status: $('status-msg'), pick, calls, keyHints, rebuildProviders };
}

/** Every argument the page ever sent over IPC. */
const sentValues = (calls) => calls.flatMap((c) => c.slice(1)).filter((v) => typeof v === 'string');

describe('a configured provider shows its hint, but never as the value', () => {
  it('the hint is the placeholder and the box is empty', () => {
    const page = loadKeysStep();
    page.pick('openai');
    expect(page.input.value).toBe('');
    expect(page.input.placeholder).toBe(HINT);
    expect(page.status.textContent).toMatch(/configured/i);
  });

  it('an unconfigured provider gets its own placeholder back — the hint never lingers', () => {
    const page = loadKeysStep();
    page.pick('openai');
    page.pick('deepseek');
    expect(page.input.value).toBe('');
    expect(page.input.placeholder).toBe(PLACEHOLDER('deepseek'));
  });
});

describe('Save & Test on the untouched box re-tests the STORED key', () => {
  it('asks the main process to test the stored key — no key travels, nothing is saved', async () => {
    const page = loadKeysStep({ answers: { 'sidecar:test-stored-key': { valid: true, status: 200 } } });
    page.pick('openai');
    page.testBtn.click();
    await flush();
    expect(page.calls).toEqual([['sidecar:test-stored-key', 'openai']]);
    expect(page.status.textContent).toMatch(/stored key verified/i);
    expect(page.status.className).toBe('status-valid');
  });

  it('a stored key that fails says why, in the validator\'s words', async () => {
    const page = loadKeysStep({
      answers: { 'sidecar:test-stored-key': { valid: false, status: 401, keyRejected: true, error: 'Invalid API key (401)' } },
    });
    page.pick('openai');
    page.testBtn.click();
    await flush();
    expect(page.status.textContent).toBe('Invalid API key (401)');
    expect(page.status.className).toBe('status-invalid');
  });

  it('a stored-key test that cannot reach the main process reports it, not a verdict', async () => {
    const page = loadKeysStep({ answers: { 'sidecar:test-stored-key': () => { throw new Error('ipc gone'); } } });
    page.pick('openai');
    page.testBtn.click();
    await flush();
    expect(page.calls.map((c) => c[0])).toEqual(['sidecar:test-stored-key']);
    expect(page.status.textContent).toBe('Connection failed');
    expect(page.testBtn.disabled).toBe(false);
  });
});

describe('typing or pasting replaces the hint — it can never append to it', () => {
  it('the typed key is exactly what is validated and saved', async () => {
    const NEW_KEY = 'sk-proj-abcdef0123456789';
    const page = loadKeysStep({
      answers: { 'sidecar:validate-key': { valid: true, status: 200 }, 'sidecar:save-key': { success: true } },
    });
    page.pick('openai');
    // A browser inserts typed or pasted text at the caret, into whatever the
    // box already holds. Emulated literally: append, then fire `input`.
    page.input.value += NEW_KEY;
    page.input.dispatch('input');
    page.testBtn.click();
    await flush();
    expect(page.calls).toEqual([
      ['sidecar:validate-key', 'openai', NEW_KEY],
      ['sidecar:save-key', 'openai', NEW_KEY],
    ]);
  });

  it('no flow ever sends the masked hint over IPC', async () => {
    const page = loadKeysStep({
      answers: {
        'sidecar:test-stored-key': { valid: true, status: 200 },
        'sidecar:validate-key': { valid: true, status: 200 },
        'sidecar:save-key': { success: true },
      },
    });
    page.pick('openai');
    page.testBtn.click();
    await flush();
    page.input.value += 'sk-proj-pasted0123456789';
    page.input.dispatch('input');
    page.testBtn.click();
    await flush();
    expect(sentValues(page.calls).filter((v) => v.includes('•'))).toEqual([]);
  });
});

/** A promise the test settles by hand, to hold an IPC answer in flight. */
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

// Council review of PR 288 (A1/D2): the verdict of a probe still in flight was
// applied to whichever provider was selected when it LANDED, and the save
// path read `selectedProvider.id` after awaiting validate-key — so switching
// provider mid-probe saved the key under the NEWLY selected provider.
describe('switching provider while a probe is in flight', () => {
  it("a stored-key verdict never lands on another provider's box", async () => {
    const inflight = deferred();
    const page = loadKeysStep({ answers: { 'sidecar:test-stored-key': () => inflight.promise } });
    page.pick('openai');
    page.testBtn.click();
    page.pick('deepseek');                     // unconfigured: an empty box, no verdict
    inflight.resolve({ valid: true, status: 200 });
    await flush();
    expect(page.status.textContent).toBe('');
    expect(page.input.classList.contains('input-valid')).toBe(false);
    expect(page.testBtn.disabled).toBe(false);
  });

  it('a typed key is validated and saved under the provider it was typed for', async () => {
    const validating = deferred();
    const page = loadKeysStep({
      keyHints: {},
      answers: { 'sidecar:validate-key': () => validating.promise, 'sidecar:save-key': { success: true } },
    });
    page.pick('openai');
    page.input.value = 'sk-proj-abcdef0123456789';
    page.input.dispatch('input');
    page.testBtn.click();
    page.pick('deepseek');
    validating.resolve({ valid: true, status: 200 });
    await flush();
    expect(page.calls).toEqual([
      ['sidecar:validate-key', 'openai', 'sk-proj-abcdef0123456789'],
      ['sidecar:save-key', 'openai', 'sk-proj-abcdef0123456789'],
    ]);
    // openai's own record is updated; deepseek's view is not touched.
    expect(page.keyHints.openai).toMatch(/^sk-proj-•/);
    expect(page.keyHints.deepseek).toBeUndefined();
    expect(page.status.textContent).toBe('');
  });
});

// Council round 2 on PR 288 (A1/C1): the switch guard compared provider
// OBJECTS, so it silently relied on every pick returning the same object.
// Switching away and back must still show the verdict, even if the provider
// list is rebuilt in between.
describe('switching away and back before a probe lands', () => {
  it('the verdict still shows on the provider it belongs to', async () => {
    const inflight = deferred();
    const page = loadKeysStep({ answers: { 'sidecar:test-stored-key': () => inflight.promise } });
    page.pick('openai');
    page.testBtn.click();
    page.pick('deepseek');
    page.rebuildProviders();                  // same ids, new objects
    page.pick('openai');
    inflight.resolve({ valid: true, status: 200 });
    await flush();
    expect(page.status.textContent).toMatch(/stored key verified/i);
  });
});

// Council round 2 on PR 288 (A2): a stored-key test and a Remove could
// interleave, leaving "Stored key verified" on a box whose key was just
// removed. While one key action is in flight, neither button can start
// another.
describe('one key action at a time', () => {
  it('Remove is unavailable while a test runs, and comes back after', async () => {
    const inflight = deferred();
    const page = loadKeysStep({ answers: { 'sidecar:test-stored-key': () => inflight.promise } });
    page.pick('openai');
    page.testBtn.click();
    expect(page.removeBtn.disabled).toBe(true);
    inflight.resolve({ valid: true, status: 200 });
    await flush();
    expect(page.removeBtn.disabled).toBe(false);
    expect(page.testBtn.disabled).toBe(false);
  });

  it('Save & Test is unavailable while a Remove runs, and comes back after', async () => {
    const removing = deferred();
    const page = loadKeysStep({ answers: { 'sidecar:remove-key': () => removing.promise } });
    page.pick('openai');
    page.removeBtn.click();
    expect(page.testBtn.disabled).toBe(true);
    removing.resolve({ success: true });
    await flush();
    expect(page.testBtn.disabled).toBe(false);
  });
});

describe('switching provider while a Remove is in flight', () => {
  it("clears the removed provider's records, never the newly picked one's", async () => {
    const removing = deferred();
    const page = loadKeysStep({
      keyHints: { openai: HINT, deepseek: 'sk-00000' + '•'.repeat(12) },
      answers: { 'sidecar:remove-key': () => removing.promise },
    });
    page.pick('openai');
    page.removeBtn.click();
    page.pick('deepseek');
    removing.resolve({ success: true });
    await flush();
    expect(page.calls).toEqual([['sidecar:remove-key', 'openai']]);
    expect(page.keyHints.openai).toBeUndefined();
    expect(page.keyHints.deepseek).toBeDefined();
    // deepseek's box still shows deepseek's hint and state.
    expect(page.input.placeholder).toBe('sk-00000' + '•'.repeat(12));
    expect(page.status.textContent).toMatch(/configured/i);
  });
});

// Council review of PR 288 (D1): after a save the placeholder still showed
// the hint from BEFORE it (or the provider's generic one, on a first save),
// so an emptied box no longer said which key Save & Test would test.
describe('after a save, the placeholder is the new key\'s hint', () => {
  const SAVE_OK = { 'sidecar:validate-key': { valid: true, status: 200 }, 'sidecar:save-key': { success: true } };

  it('a first save: emptying the box shows the new hint and re-tests the stored key', async () => {
    const page = loadKeysStep({
      keyHints: {}, answers: { ...SAVE_OK, 'sidecar:test-stored-key': { valid: true, status: 200 } },
    });
    page.pick('openai');
    page.input.value = 'sk-proj-abcdef0123456789';
    page.input.dispatch('input');
    page.testBtn.click();
    await flush();
    page.input.value = '';
    page.input.dispatch('input');
    expect(page.input.placeholder).toBe('sk-proj-' + '•'.repeat(12));
    page.testBtn.click();
    await flush();
    expect(page.calls.map((c) => c.slice(0, 2))).toEqual([
      ['sidecar:validate-key', 'openai'], ['sidecar:save-key', 'openai'], ['sidecar:test-stored-key', 'openai'],
    ]);
  });

  it("a replaced key: the old key's hint does not linger", async () => {
    const page = loadKeysStep({ answers: SAVE_OK });      // openai starts with HINT ('sk-proj-…')
    page.pick('openai');
    page.input.value = 'sk-svcacct-abcdef0123456789';
    page.input.dispatch('input');
    page.testBtn.click();
    await flush();
    expect(page.input.placeholder).toBe('sk-svcac' + '•'.repeat(12));
  });
});

describe('the paths that have no stored key are unchanged', () => {
  it('an unconfigured provider with an empty box still asks for a key and sends nothing', async () => {
    const page = loadKeysStep();
    page.pick('deepseek');
    page.testBtn.click();
    await flush();
    expect(page.calls).toEqual([]);
    expect(page.status.textContent).toBe('Please enter an API key');
  });

  it('after Remove, the placeholder is the provider\'s again and an empty box cannot re-test a key that is gone', async () => {
    const page = loadKeysStep({ answers: { 'sidecar:remove-key': { success: true } } });
    page.pick('openai');
    page.removeBtn.click();
    await flush();
    expect(page.input.placeholder).toBe(PLACEHOLDER('openai'));
    page.testBtn.click();
    await flush();
    expect(page.calls.map((c) => c[0])).toEqual(['sidecar:remove-key']);
    expect(page.status.textContent).toBe('Please enter an API key');
  });
});
