/**
 * The readline setup wizard's local / self-hosted provider add step (v4.2 §4.6, Task 12).
 *
 * Split out of setup.js per RULING D14: setup.js is 516 lines and sits on
 * check-file-sizes.js's exclude list (grandfathered — the gate can never flag
 * further growth there), so this extraction is unconditional, not gated on a
 * line-count check.
 *
 * Collects an id + preset (or a custom base URL) and delegates EVERY write to
 * handleProvider(['provider', 'add', id], deps) (RULING D7), so the wizard and
 * `amicus provider add` cannot drift apart: id-format + RESERVED_IDS
 * validation, the plaintext-bearer warning, the shadow-namespace warning, the
 * 2s reachability probe, and the shared per-provider default picker all come
 * from that single path. handleProvider's own probe-success branch calls
 * runProviderDefaultFlow non-interactively (no extra readline prompts here)
 * and, per D4, remains the sole writer of config.default — this module never
 * seeds it directly.
 *
 * Transport-agnostic by injection (mirrors provider-default-prompt.js): `ask`
 * and `print` are passed in by the caller rather than imported, because
 * setup.js defines neither as a bare identifier (B8) — its real idiom is the
 * module-level `askQuestion(rl, prompt)` plus bare `console.log`. Taking them
 * as parameters keeps this module callable without a TTY.
 *
 * Guarded end-to-end (house best-effort rule, mirrors provisionElectron /
 * maybeMigrationNotice): any failure — a rejected probe, a validation error,
 * a thrown handleProvider — is swallowed here. This optional wizard step must
 * never abort the rest of `amicus setup`.
 */

'use strict';

const { PRESETS } = require('../utils/local-providers');

/**
 * @param {(question: string) => Promise<string>} ask reads one line of input
 * @param {(line: string) => void} print writes one line of output
 * @param {object} [deps] forwarded verbatim to handleProvider (tests inject
 *   `probe`/`loadConfig`/`saveConfig`/etc.; production passes {} so
 *   handleProvider's own realDeps() perform the real I/O)
 * @returns {Promise<void>}
 */
async function addLocalProviderInteractive(ask, print, deps = {}) {
  try {
    const id = (await ask('Provider id (e.g. lmstudio, ollama, mylab): ')).trim();
    if (!id) { return; }

    const presetKey = (await ask('Preset? [ollama / lmstudio / vllm / none]: ')).trim().toLowerCase();
    const args = { _: ['provider', 'add', id] };
    // hasOwnProperty guard (trap #6/#8): a bare PRESETS[presetKey] for
    // presetKey === 'constructor' would read the inherited
    // Object.prototype.constructor (truthy) and wrongly skip the URL prompt
    // below — the same recurring v4.2 bug class already guarded in
    // cli-handlers-provider.js's entryFromArgs and local-providers.js.
    if (Object.prototype.hasOwnProperty.call(PRESETS, presetKey)) {
      args.preset = presetKey;
    } else {
      // D15: every preset already carries a baseURL, so a URL prompt is only
      // needed for 'none' / a blank / an unrecognized preset name.
      args.url = (await ask('Base URL (e.g. http://127.0.0.1:11434/v1): ')).trim();
    }

    // D7: one call performs id/format validation + save + probe + the shared
    // default picker, and prints its own "Added '<id>' — N model(s) found."
    // / unreachable message through the injected print/warn — both point at
    // the same callback so nothing silently goes to realDeps' stderr instead
    // of the wizard's own output stream.
    const { handleProvider } = require('../cli-handlers-provider');
    await handleProvider(args, { print, warn: print, ...deps });
  } catch (_err) {
    // Best-effort: a bug in this optional wizard step must never abort setup.
  }
}

module.exports = { addLocalProviderInteractive };
