/**
 * Setup UI — Local server widget runtime script (Task 13, v4.2 §4.6).
 *
 * Companion to setup-ui-local.js's HTML. Preset chips fill the URL field and track
 * a flavor (defaulting to 'generic' the moment the URL no longer matches any chip's
 * preset value — mirrors cli-handlers-provider.js's entryFromArgs: `(preset &&
 * preset.flavor) || 'generic'`). "Test connection" invokes setup:probe-local and
 * renders the returned model count or error; Save invokes setup:save-local-provider
 * and renders its result (including the plaintext-bearer warning, D-posture parity
 * with the CLI's doAdd). Model/error strings from the response are rendered via
 * textContent only — never innerHTML — mirroring the no-innerHTML-for-catalog-data
 * convention setup-ui-provider-default.js documents.
 */
'use strict';

/**
 * Build the local-server widget JS for inline inclusion in the wizard script.
 * @returns {string} JavaScript source (no <script> tags)
 */
function buildLocalScript() {
  return `
  // Task 13: Local server card (Ollama / LM Studio / vLLM / any OpenAI-compatible).
  (function() {
    var idInput = document.getElementById('local-id-input');
    var urlInput = document.getElementById('local-url-input');
    var bearerInput = document.getElementById('local-bearer-input');
    var testBtn = document.getElementById('local-test-btn');
    var saveBtn = document.getElementById('local-save-btn');
    var statusMsg = document.getElementById('local-status-msg');
    var chips = Array.prototype.slice.call(document.querySelectorAll('.local-chip'));
    var selectedFlavor = 'generic';

    function setStatus(text, cls) {
      if (!statusMsg) { return; }
      statusMsg.textContent = text || '';
      statusMsg.className = cls || '';
    }

    chips.forEach(function(chip) {
      chip.addEventListener('click', function() {
        chips.forEach(function(c) { c.classList.remove('active'); });
        chip.classList.add('active');
        var preset = chip.getAttribute('data-preset');
        if (urlInput) { urlInput.value = chip.getAttribute('data-url'); }
        if (idInput && !idInput.value.trim()) { idInput.value = preset; }
        selectedFlavor = chip.getAttribute('data-flavor');
        setStatus('', '');
      });
    });

    if (urlInput) {
      urlInput.addEventListener('input', function() {
        var matched = chips.filter(function(c) { return c.getAttribute('data-url') === urlInput.value; });
        selectedFlavor = matched.length > 0 ? matched[0].getAttribute('data-flavor') : 'generic';
        if (matched.length === 0) { chips.forEach(function(c) { c.classList.remove('active'); }); }
      });
    }

    if (testBtn) {
      testBtn.addEventListener('click', async function() {
        var url = (urlInput && urlInput.value.trim()) || '';
        if (!url) { setStatus('Enter a server URL first', 'status-invalid'); return; }
        testBtn.disabled = true; testBtn.textContent = 'Testing...';
        setStatus('', '');
        try {
          var res = await window.sidecarSetup.invoke('setup:probe-local', {
            baseURL: url, flavor: selectedFlavor, bearer: (bearerInput && bearerInput.value) || undefined,
          });
          if (res && res.ok) {
            setStatus(res.count + ' model' + (res.count === 1 ? '' : 's') + ' found \\u2713', 'status-valid');
          } else {
            setStatus((res && res.error) || 'Unreachable', 'status-invalid');
          }
        } catch (_e) {
          setStatus('Connection failed', 'status-invalid');
        }
        testBtn.disabled = false; testBtn.textContent = 'Test connection';
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', async function() {
        var id = (idInput && idInput.value.trim()) || '';
        var url = (urlInput && urlInput.value.trim()) || '';
        if (!id || !url) { setStatus('Provider ID and server URL are required', 'status-invalid'); return; }
        saveBtn.disabled = true; saveBtn.textContent = 'Saving...';
        try {
          var res = await window.sidecarSetup.invoke('setup:save-local-provider', {
            id: id, baseURL: url, flavor: selectedFlavor, bearer: (bearerInput && bearerInput.value) || undefined,
          });
          if (res && res.ok) {
            // A returned warning (plaintext-bearer-to-remote-host, ipc-setup.js) is
            // shown with the same visual weight as an error even though the save
            // itself succeeded -- it is safety-relevant, not merely informational.
            setStatus(res.warning || 'Saved \\u2713', res.warning ? 'status-invalid' : 'status-valid');
            // Configuring a local provider counts toward "at least one provider
            // ready" the same way a cloud API key does, so Step 1's Next button
            // unlocks for a local-only setup too.
            if (typeof configuredKeys === 'object') { configuredKeys[id] = true; }
            if (typeof updateNextState === 'function') { updateNextState(); }
          } else {
            setStatus((res && res.error) || 'Save failed', 'status-invalid');
          }
        } catch (_e) {
          setStatus('Save failed', 'status-invalid');
        }
        saveBtn.disabled = false; saveBtn.textContent = 'Save local server';
      });
    }
  })();
  `;
}

module.exports = { buildLocalScript };
