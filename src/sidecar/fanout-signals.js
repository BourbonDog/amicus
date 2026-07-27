// src/sidecar/fanout-signals.js
'use strict';

/**
 * @module fanout-signals
 * A fan-out wave's signal-abort handler, extracted from fanout.js for the
 * 300-line size gate (v4.4.1 fix wave, finding F3 needed room in fanout.js).
 * Pure move plus the force-exit reaper described below — same markers, same
 * ordering, same watchdog window.
 *
 * The contract fanout.js relies on: mark the wave and every leg aborted, then
 * let NORMAL control flow finalize. Legs see their abort marker within one poll
 * (~2s) and settle, so the caller still writes wave.json and emits a parseable
 * aborted document. The force-exit watchdog is only a backstop for a wedged leg.
 */

const { logger } = require('../utils/logger');
const { installSignalAbort, markAborted } = require('../utils/session-abort');
const { armExitWatchdog, exitReaping } = require('../utils/lifecycle');

/** Force-exit backstop window; comfortably outlives close()'s ~2s escalation. */
const WAVE_FORCE_EXIT_MS = 10000;

/**
 * @param {{waveId: string, waveDir: string, legDirs: string[], server: object,
 *   externalServer: boolean}} args
 * @returns {{uninstall: Function, signal: () => (string|null)}} `signal()` is a
 *   GETTER — the handler mutates it between awaits, so a snapshot would miss it.
 */
function installWaveAbort({ waveId, waveDir, legDirs, server, externalServer }) {
  let signalled = null;
  const uninstall = installSignalAbort({
    onAbort: (signal) => {
      const code = signal === 'SIGINT' ? 130 : 143;
      if (signalled) { process.exit(code); } // second signal: exit NOW
      signalled = signal;
      logger.warn('Signal received — aborting wave', { waveId, signal });
      markAborted(waveDir, signal);
      for (const dir of legDirs) { markAborted(dir, signal); }
      // close() is async (B06 escalation); this handler stays sync, so
      // fire-and-forget with a rejection guard.
      // ⚠️ close site 1 of 2 — NEVER an injected server: it belongs to the
      // council run, whose own signal handler tears it down in finalize().
      // Closing it here would kill every sibling and later wave in the run.
      if (!externalServer) { try { server.close().catch(() => {}); } catch { /* best-effort */ } }
      // ⚠️ …but a FORCE exit must not orphan it either (F3). We no longer close
      // an injected server above, so if this watchdog fires before the owner's
      // finalize() runs, the OpenCode process outlives the parent — still
      // holding the SQLite lock this whole task exists to stop contending on.
      // exitReaping SIGTERMs its Go pid on the way out. An OWNED server needs
      // no hook: close() above already signalled it.
      armExitWatchdog(code, WAVE_FORCE_EXIT_MS, {
        log: (m, meta) => logger.debug(m, meta),
        ...(externalServer ? { exit: exitReaping(server) } : {}),
      });
    },
  });
  return { uninstall, signal: () => signalled };
}

module.exports = { installWaveAbort, WAVE_FORCE_EXIT_MS };
