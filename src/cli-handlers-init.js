/**
 * `amicus init [--claude] [--desktop] [--json]` (v4.2 §4.8, C2). Re-runs the
 * SAME registration core `npm install`'s postinstall runs (src/utils/
 * claude-register.js — Task 15's extraction), with per-step status and a
 * compact doctor summary (Task 14's summarizeDoctor). Useful after a failed
 * postinstall, for plugin-channel / --ignore-scripts installs (which set
 * AMICUS_SKIP_POSTINSTALL), or to repair deleted ~/.claude state. Never does
 * keys/model setup or engine/electron provisioning — that is `amicus setup` /
 * `amicus doctor --fix`.
 *
 * DI-injected (mirrors cli-handlers-doctor.js / cli-handlers-provider.js) so
 * it is unit-testable without ever touching a real Claude Code / Claude
 * Desktop config file.
 */
'use strict';

function realDeps() {
  return {
    reg: require('./utils/claude-register'),
    runDoctorChecks: (o) => require('./cli-handlers-doctor').runDoctorChecks(o),
    summarizeDoctor: (c) => require('./utils/doctor-summary').summarizeDoctor(c),
    print: (l) => process.stdout.write(`${l}\n`),
    emitJson: (o) => process.stdout.write(`${JSON.stringify(o, null, 2)}\n`),
  };
}

/**
 * Run one registration step, isolating a throw to just this step so the rest
 * of `init` can still make progress — graceful degradation (a broken Claude
 * Code registration must not skip an otherwise-working Claude Desktop one).
 * @param {object} steps - mutated in place: steps[key] = status | 'failed: <msg>'
 * @param {string} key
 * @param {() => (string|void)} fn - returns a status string, or void for
 *   fire-and-forget steps (skills/legacyMigration), which report 'done'. A
 *   falsy return (including undefined, e.g. from a stale/incompatible dep)
 *   also reports the honest 'done' fallback rather than fabricating a
 *   specific added/updated/unchanged value it cannot back up.
 * @returns {boolean} true if the step succeeded
 */
function runStep(steps, key, fn) {
  try {
    steps[key] = fn() || 'done';
    return true;
  } catch (e) {
    steps[key] = `failed: ${e.message}`;
    return false;
  }
}

/**
 * @param {{_:string[], claude?:boolean, desktop?:boolean, json?:boolean}} args
 * @param {object} [deps] DI overrides (reg/runDoctorChecks/summarizeDoctor/print/emitJson)
 * @returns {Promise<number>} exit code (0 ok, 1 a target genuinely failed)
 */
async function handleInit(args, deps = {}) {
  const d = { ...realDeps(), ...deps };
  const both = !args.claude && !args.desktop;
  const steps = {};
  let ok = true;

  // Fire-and-forget: best-effort skill copy, reported as a single combined step.
  ok = runStep(steps, 'skills', () => { d.reg.installSkill(); d.reg.installCouncilSkill(); }) && ok;
  if (both || args.claude) { ok = runStep(steps, 'claudeCode', () => d.reg.registerClaudeCode()) && ok; }
  if (both || args.desktop) { ok = runStep(steps, 'claudeDesktop', () => d.reg.registerClaudeDesktop()) && ok; }
  ok = runStep(steps, 'legacyMigration', () => { d.reg.migrateLegacyMcp(); }) && ok;

  // Guarded polish: a bug in the doctor check / summary formatting must never
  // crash `init` itself — registration already happened above; the summary
  // is a best-effort bonus tacked on at the end.
  let summary = '';
  try { summary = d.summarizeDoctor(await d.runDoctorChecks()); } catch { summary = ''; }

  if (args.json) {
    d.emitJson({ ok, steps, ...(summary ? { summary } : {}) });
  } else {
    for (const [k, v] of Object.entries(steps)) { d.print(`  ${k}: ${v}`); }
    if (summary) { d.print(summary); }
    if (!ok) { d.print('amicus init: one or more steps failed — see above'); }
  }
  return ok ? 0 : 1;
}

module.exports = { handleInit };
