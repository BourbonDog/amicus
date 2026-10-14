/**
 * Setup UI - Step 1 Key Management Script
 *
 * Returns the inline JS for provider selection, key input,
 * test/save, eye toggle, and remove handlers.
 * Extracted from setup-ui.js to keep file sizes under 300 lines.
 */

/**
 * Build the key management JS for inline inclusion in the wizard script
 * @returns {string} JavaScript source (no <script> tags)
 */
function buildKeysScript() {
  return `
  // Step 1: Provider selection & key management
  document.querySelectorAll('.provider-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var id = this.getAttribute('data-provider');
      var prov = providers.find(function(p) { return p.id === id; });
      if (!prov) { return; }
      selectedProvider = prov;
      // Task 8: a picker rendered for the previously-selected provider is stale here.
      if (window.hideProviderDefaultPicker) { window.hideProviderDefaultPicker(); }
      document.querySelectorAll('.provider-btn').forEach(function(b) { b.classList.remove('selected'); });
      this.classList.add('selected');
      keySection.classList.add('visible');
      keyLabel.textContent = prov.name + ' API Key';
      keyInput.placeholder = prov.placeholder;
      if (keyHints[prov.id]) {
        // The masked hint (8 chars + bullets) is the PLACEHOLDER, never the
        // value. As the value it was sent as the key by Save & Test, and a
        // paste APPENDED to it; now typing replaces it, and Save & Test on the
        // empty box re-tests the stored key (testStoredKey below).
        keyInput.value = ''; keyInput.placeholder = keyHints[prov.id]; keyInput.type = 'password'; keyValid = false;
        setInputState('valid');
        statusMsg.textContent = 'Key configured \\u2714'; statusMsg.className = 'status-valid';
        removeBtn.style.display = '';
      } else {
        keyInput.value = ''; keyInput.type = 'password'; keyValid = false;
        setInputState(null);
        statusMsg.textContent = ''; statusMsg.className = '';
        removeBtn.style.display = 'none';
      }
      eyeBtn.classList.remove('active'); keyInput.focus();
      var a = document.createElement('a');
      a.href = prov.helpUrl; a.textContent = prov.helpLabel;
      helpLink.textContent = "Don't have a key? Get one at ";
      helpLink.appendChild(a);
      a.addEventListener('click', function(e) {
        e.preventDefault();
        if (window.sidecarSetup && window.sidecarSetup.openExternal) { window.sidecarSetup.openExternal(this.href); }
      });
    });
  });

  function setInputState(state) {
    keyInput.classList.remove('input-valid', 'input-invalid', 'input-testing');
    if (state) { keyInput.classList.add('input-' + state); }
  }

  // The user can pick another provider while a probe is in flight (only the
  // test button is disabled). So a click works on the provider it was MADE
  // for: the IPC calls and that provider's records (check mark, hint) use
  // it, and the shared box UI is touched only if it is still the one shown.
  // Reading selectedProvider after an await saved a key under whichever
  // provider was picked meanwhile. Council review of PR 288 (A1/D2).
  function showVerdict(prov, text, cls, state) {
    if (selectedProvider !== prov) { return false; }
    statusMsg.textContent = text; statusMsg.className = cls; setInputState(state);
    return true;
  }

  // An empty box on a provider that has a stored key: test THAT key, in the
  // main process. The renderer never holds it (only its masked hint), and
  // nothing is saved.
  async function testStoredKey(prov) {
    testBtn.disabled = true; testBtn.textContent = 'Testing...';
    statusMsg.textContent = ''; statusMsg.className = ''; setInputState('testing');
    try {
      var res = await window.sidecarSetup.invoke('sidecar:test-stored-key', prov.id);
      if (res && res.valid) {
        showVerdict(prov, 'Stored key verified \\u2713', 'status-valid', 'valid');
      } else {
        showVerdict(prov, (res && res.error) || 'Stored key failed the test', 'status-invalid', 'invalid');
      }
    } catch (_e) {
      showVerdict(prov, 'Connection failed', 'status-invalid', 'invalid');
    }
    testBtn.disabled = false; testBtn.textContent = 'Save \\u0026 Test';
  }

  testBtn.addEventListener('click', async function() {
    var prov = selectedProvider;
    if (!prov) { return; }
    var key = keyInput.value.trim();
    if (!key && keyHints[prov.id]) { await testStoredKey(prov); return; }
    if (!key) {
      statusMsg.textContent = 'Please enter an API key'; statusMsg.className = 'status-invalid';
      setInputState('invalid'); return;
    }
    testBtn.disabled = true; testBtn.textContent = 'Testing...';
    statusMsg.textContent = ''; statusMsg.className = ''; setInputState('testing');
    try {
      var res = await window.sidecarSetup.invoke('sidecar:validate-key', prov.id, key);
      if (res.valid) {
        var saveResult = await window.sidecarSetup.invoke('sidecar:save-key', prov.id, key);
        // Issue 212: the main process validates again before it persists, so a save
        // can be REFUSED even after this probe passed (a key revoked between
        // the two calls, or a second probe that answered 401). Reporting
        // 'Saved' on a refusal -- which this branch did unconditionally, for
        // every failed save -- is exactly the silent credential loss issue
        // 212 is about, so the outcome of the save now decides what is shown.
        if (saveResult && saveResult.success === false) {
          if (showVerdict(prov, saveResult.error || 'Save failed', 'status-invalid', 'invalid')) { keyValid = false; }
        } else {
          configuredKeys[prov.id] = true;
          var c = document.getElementById('check-' + prov.id);
          if (c) { c.textContent = '\\u2713'; }
          // Same mask as api-key-store.js :: readApiKeyHints.
          keyHints[prov.id] = key.slice(0, 8) + '\\u2022'.repeat(Math.max(0, Math.min(key.length - 8, 12)));
          updateNextState();
          if (showVerdict(prov, 'Saved \\u2713', 'status-valid', 'valid')) {
            keyValid = true; validatedKey = key;
            // The NEW key's hint, so an emptied box says which key Save &
            // Test would re-test (council review of PR 288, D1).
            keyInput.placeholder = keyHints[prov.id];
            removeBtn.style.display = '';
            // Task 8: inline per-provider default picker beneath the just-saved key.
            if (window.renderProviderDefaultPicker) {
              window.renderProviderDefaultPicker(prov.id, prov.name, saveResult && saveResult.providerDefault);
            }
          }
        }
      } else {
        if (showVerdict(prov, res.error || 'Invalid key', 'status-invalid', 'invalid')) { keyValid = false; }
      }
    } catch (_e) {
      if (showVerdict(prov, 'Connection failed', 'status-invalid', 'invalid')) { keyValid = false; }
    }
    testBtn.disabled = false; testBtn.textContent = 'Save \\u0026 Test';
  });

  keyInput.addEventListener('input', function() {
    if (keyInput.type === 'text') { keyInput.type = 'password'; }
    if (keyValid && keyInput.value.trim() !== validatedKey) { keyValid = false; statusMsg.textContent = ''; setInputState(null); }
    if (!keyInput.value.trim()) { statusMsg.textContent = ''; statusMsg.className = ''; setInputState(null); }
  });
  keyInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') { testBtn.click(); } });

  eyeBtn.addEventListener('click', function() {
    if (keyInput.type === 'password') { keyInput.type = 'text'; eyeBtn.classList.add('active'); }
    else { keyInput.type = 'password'; eyeBtn.classList.remove('active'); }
    keyInput.focus();
  });

  removeBtn.addEventListener('click', async function() {
    var prov = selectedProvider;   // the provider this click was made for (see showVerdict)
    if (!prov) { return; }
    removeBtn.disabled = true;
    try {
      await window.sidecarSetup.invoke('sidecar:remove-key', prov.id);
      delete configuredKeys[prov.id]; delete keyHints[prov.id];
      var c = document.getElementById('check-' + prov.id);
      if (c) { c.textContent = ''; }
      updateNextState();
      if (selectedProvider === prov) {
        keyInput.value = ''; keyInput.placeholder = prov.placeholder;
        keyInput.type = 'password'; keyValid = false; setInputState(null);
        statusMsg.textContent = 'Key removed'; statusMsg.className = 'status-testing';
        removeBtn.style.display = 'none';
        if (window.hideProviderDefaultPicker) { window.hideProviderDefaultPicker(); }
      }
    } catch (_e) {
      if (selectedProvider === prov) { statusMsg.textContent = 'Failed to remove'; statusMsg.className = 'status-invalid'; }
    }
    removeBtn.disabled = false;
  });`;
}

module.exports = { buildKeysScript };
