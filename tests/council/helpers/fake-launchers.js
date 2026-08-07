// tests/council/helpers/fake-launchers.js — shared fakes for driver tests.
'use strict';

const review = (n, findings) => `Prose ${n}.\n\n\`\`\`json\n${JSON.stringify({
  overall: 'take',
  findings: findings || [{ id: 1, severity: 'major', claim: `claim-${n}`, location: 'loc', rationale: 'why' }],
})}\n\`\`\`\n`;

const judgeOut = (ranking, adjudications) =>
  `Judged.\n\n\`\`\`json\n${JSON.stringify({ ranking, adjudications })}\n\`\`\`\n`;

const mkLeg = (model, summary, status = 'complete', cost = 0.01, waveId) => ({
  taskId: `${model}-leg`, model, modelInput: model, status, summary,
  durationMs: 1000, usage: { cost: { amount: cost, source: 'reported' } },
  ...(waveId !== undefined ? { waveId } : {}),
});

const okWave = (legs, exitCode = 0, status = 'complete') =>
  ({ wave: { status, legs }, exitCode });

/**
 * Scripted launchers: script[waveId] = (opts) => {wave, exitCode}.
 * Records every launch's opts in .calls. Throws on an unscripted waveId so a
 * test can prove a launch did NOT happen.
 */
function scriptedLaunchers(script) {
  const calls = [];
  async function launchWave(opts) {
    calls.push(opts);
    const fn = script[opts.waveId];
    if (!fn) { throw new Error(`no script for waveId ${opts.waveId}`); }
    return fn(opts);
  }
  async function launchSolo(opts) {
    const r = await launchWave({ ...opts, models: [opts.model] });
    return { ...r, leg: (r.wave && r.wave.legs && r.wave.legs[0]) || null };
  }
  return { launchWave, launchSolo, calls };
}

/** 3-bench happy-path script: gemini/gpt/qwen review; all judge; deepseek chairs. */
function happyScript() {
  return {
    'abc123-s1': (opts) => okWave(opts.models.map(m => mkLeg(m, review(m)))),
    'abc123-s2': () => okWave([
      mkLeg('gemini', judgeOut(['Review B', 'Review C', 'Review A'],
        [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }, { id: 'C1', verdict: 'neutral' }])),
      mkLeg('gpt', judgeOut(['Review A', 'Review C', 'Review B'],
        [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }, { id: 'C1', verdict: 'dispute' }])),
      mkLeg('qwen', judgeOut(['Review A', 'Review B', 'Review C'],
        [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'neutral' }, { id: 'C1', verdict: 'agree' }])),
    ]),
    'abc123-ch1': () => okWave([
      mkLeg('deepseek', 'Synthesis of the bench.\n\nHARD QUESTIONS\n1. Q?\n\nVERDICT: Ship it', 'complete', 0.03),
    ]),
  };
}

/** Standard options for runCouncil in driver tests. */
function baseOptions(tmp, overrides = {}) {
  const path = require('path');
  return {
    briefing: 'Review this material.', models: ['gemini', 'gpt', 'qwen'], chair: 'deepseek',
    critic: null, lenses: null, project: tmp, runId: 'abc123',
    runDir: path.join(tmp, 'council-abc123'), timeout: 5, maxCost: null,
    gateway: 'auto', noValidateModel: false, date: '2026-07-19', ...overrides,
  };
}

// ---- v4.1 debate + claude-review scripted launchers (append; runId 'r') ----

/** A defense-solo output body: prose + trailing {"responses":[…]} JSON block. */
const defenseOut = (responses) =>
  `Defending.\n\n\`\`\`json\n${JSON.stringify({ responses })}\n\`\`\`\n`;

/** A re-vote leg output body: prose + trailing {"revotes":[…]} JSON block. */
const revoteOut = (revotes) =>
  `Re-voting.\n\n\`\`\`json\n${JSON.stringify({ revotes })}\n\`\`\`\n`;

/**
 * Build launchers from a flat `{[waveId]: (opts) => {wave, exitCode}}` map (the
 * same shape scriptedLaunchers dispatches on), firing an optional onLaunch(opts)
 * hook exactly ONCE per launch (wave or solo). Throws on an unscripted waveId so
 * a test can prove a launch did NOT happen (e.g. no leg for 'claude'). Records
 * every launch's opts in `.calls`; solos expose `leg = wave.legs[0] || null`.
 */
function launchersFromScript(script, onLaunch) {
  const calls = [];
  async function dispatch(opts) {
    calls.push(opts);
    if (onLaunch) { onLaunch(opts); }
    const fn = script[opts.waveId];
    if (!fn) { throw new Error(`no script for waveId ${opts.waveId}`); }
    return fn(opts);
  }
  return {
    calls,
    launchWave: (opts) => dispatch(opts),
    launchSolo: async (opts) => {
      const r = await dispatch({ ...opts, models: [opts.model] });
      return { ...r, leg: (r.wave && r.wave.legs && r.wave.legs[0]) || null };
    },
  };
}

/**
 * Happy 3-bench script map keyed to runId 'r': gemini/gpt/qwen review (A1/B1/C1),
 * all three judge A1/B1/C1/D1, deepseek chairs with a VERDICT line. D1 covers a
 * Claude review added as label D (Task 7): the D1 adjudications are valid ONLY
 * BECAUSE a claude-review file is present. Without one, D1 is an unknown id —
 * `parse-stage2` pushes `UNKNOWN_FINDING_ID`, which makes `ok:false` and triggers
 * the bounded judge-repair loop whose repair waveId is not in this script, so
 * `launchersFromScript` throws. Use this map only with a claude review present.
 */
function happyScriptMap() {
  return {
    'r-s1': (opts) => okWave(opts.models.map(m => mkLeg(m, review(m)))),
    'r-s2': () => okWave([
      // Follow-up 4: gemini's ranking includes Review D (claude) — the ONLY
      // fixture ranking exercising claude's street-cred/ledger path; the
      // other two judges' rankings are left bench-only on purpose.
      mkLeg('gemini', judgeOut(['Review B', 'Review C', 'Review D', 'Review A'],
        [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }, { id: 'C1', verdict: 'neutral' }, { id: 'D1', verdict: 'agree' }])),
      mkLeg('gpt', judgeOut(['Review A', 'Review C', 'Review B'],
        [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }, { id: 'C1', verdict: 'dispute' }, { id: 'D1', verdict: 'agree' }])),
      mkLeg('qwen', judgeOut(['Review A', 'Review B', 'Review C'],
        [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'neutral' }, { id: 'C1', verdict: 'agree' }, { id: 'D1', verdict: 'agree' }])),
    ]),
    'r-ch1': () => okWave([mkLeg('deepseek', 'Synthesis of the bench.\n\nVERDICT: Ship it', 'complete', 0.03)]),
  };
}

/** Happy launchers keyed to runId 'r' (claude-review test). onLaunch counts launches. */
function happyLaunchers({ onLaunch } = {}) {
  return launchersFromScript(happyScriptMap(), onLaunch);
}

/**
 * Debate script map keyed to runId 'r'. A1 (raised by gemini) is Disputed by
 * peers gpt+qwen; gemini defends A1 (r-d1); the re-vote wave [gpt,qwen] (r-rv)
 * flips gpt→agree and holds qwen→dispute, moving A1 Disputed→Contested (one
 * verdict change); deepseek chairs (r-ch1). Override individual keys for the
 * degradation cases (dead defense, partial/dead re-vote, cost ceiling, abort).
 */
function debateScriptMap() {
  return {
    'r-s1': (opts) => okWave(opts.models.map(m => mkLeg(m, review(m)))),
    'r-s2': () => okWave([
      mkLeg('gemini', judgeOut(['Review B', 'Review C', 'Review A'],
        [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }, { id: 'C1', verdict: 'agree' }])),
      mkLeg('gpt', judgeOut(['Review B', 'Review C', 'Review A'],
        [{ id: 'A1', verdict: 'dispute' }, { id: 'B1', verdict: 'agree' }, { id: 'C1', verdict: 'agree' }])),
      mkLeg('qwen', judgeOut(['Review B', 'Review C', 'Review A'],
        [{ id: 'A1', verdict: 'dispute' }, { id: 'B1', verdict: 'agree' }, { id: 'C1', verdict: 'agree' }])),
    ]),
    'r-d1': () => okWave([mkLeg('gemini', defenseOut([{ id: 'A1', action: 'defend', argument: 'the retry caps at 5' }]))]),
    'r-rv': () => okWave([
      mkLeg('gpt', revoteOut([{ id: 'A1', verdict: 'agree', reason: 'defense convincing' }])),
      mkLeg('qwen', revoteOut([{ id: 'A1', verdict: 'dispute', reason: 'still unsupported' }])),
    ]),
    'r-ch1': () => okWave([mkLeg('deepseek', 'Synthesis after debate.\n\nVERDICT: Fix these first', 'complete', 0.03)]),
  };
}

/** Debate launchers keyed to runId 'r' (happy debate path). onLaunch optional. */
function debateScript({ onLaunch } = {}) {
  return launchersFromScript(debateScriptMap(), onLaunch);
}

module.exports = { review, judgeOut, mkLeg, okWave, scriptedLaunchers, happyScript, baseOptions,
  defenseOut, revoteOut, launchersFromScript,
  happyScriptMap, happyLaunchers, debateScriptMap, debateScript };
