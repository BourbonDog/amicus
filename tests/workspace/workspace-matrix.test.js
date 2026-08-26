'use strict';

const { makeFakeDom } = require('./helpers/fake-workspace-page');
const { buildMatrixModel } = require('../../src/workspace/matrix-model');

/**
 * Headless painter proof for electron/workspace-ui/workspace-matrix.js, same harness
 * discipline as workspace-render.test.js (innerHTML/outerHTML/insertAdjacentHTML are
 * throwing traps — see tests/workspace/helpers/fake-workspace-page.js). Requires the
 * REAL workspace-render.js first so AmicusMatrix's `display()` delegates to the real
 * `AmicusRender.display(pair, blind)` flip rather than a test double.
 */
describe('workspace-matrix.js (adjudication matrix + verdict painters)', () => {
  let AmicusMatrix;
  let document;

  beforeEach(() => {
    jest.resetModules(); // force both IIFEs to re-run against THIS test's fresh globals below
    const fake = makeFakeDom();
    document = fake.document;
    global.window = fake.window;
    global.document = document;
    global.NodeFilter = fake.NodeFilter;
    // eslint-disable-next-line global-require
    require('../../electron/workspace-ui/workspace-render');
    // eslint-disable-next-line global-require
    require('../../electron/workspace-ui/workspace-matrix');
    AmicusMatrix = global.window.AmicusMatrix;
  });

  afterEach(() => {
    delete global.window;
    delete global.document;
    delete global.NodeFilter;
  });

  test('MATRIX_ROW_CAP is exported and is the §5.4 safety-valve value', () => {
    expect(AmicusMatrix.MATRIX_ROW_CAP).toBe(500);
  });

  describe('renderMatrix', () => {
    test('no tally.json yet renders the not-written-yet note, nothing else', () => {
      const container = document.createElement('div');
      AmicusMatrix.renderMatrix(container, null, () => {});
      expect(container.textContent).toContain('tally.json not written yet');
    });

    test('judged:false (fewer than 2 judges) shows the peers-reduced note above the table', () => {
      const container = document.createElement('div');
      const matrix = { judges: [], rows: [], tierCounts: null, judged: false };
      AmicusMatrix.renderMatrix(container, matrix, () => {});
      expect(container.textContent).toContain('Fewer than 2 judges completed');
    });

    // ⚠️ T19-m2 (v4.7 PR7): onDrill used to be invoked synchronously from the click listener.
    // It is now called inside a `Promise.resolve().then(...)` (see workspace-matrix.js) so a
    // rejection or a synchronous throw from onDrill can be terminated with a `.catch` instead of
    // escaping — see tests/workspace/matrix-drill-rejection.test.js for that behavior. This test
    // still pins the WHAT (exact args onDrill is called with); it now awaits a few microtask
    // ticks to observe it, matching this file's own async-flush house pattern elsewhere.
    test('a dispute cell wires onDrill(judgePair, findingId); an agree cell gets no click listener', async () => {
      const container = document.createElement('div');
      const matrix = {
        judges: [{ model: 'gemini', label: 'Review A' }, { model: 'gpt', label: 'Review B' }],
        rows: [{
          id: 'A1', severity: 'high', tier: 'Confirmed', thin: false, tierOverride: null, debate: null,
          raiser: { model: 'gemini', label: 'Review A' }, basis: { a: 1, d: 0, n: 0 },
          cells: [
            { judge: { model: 'gemini', label: 'Review A' }, verdict: 'agree', sym: '✓', isRaiser: true },
            { judge: { model: 'gpt', label: 'Review B' }, verdict: 'dispute', sym: '✗', isRaiser: false },
          ],
        }],
        tierCounts: { Confirmed: 1 }, judged: true,
      };
      const onDrill = jest.fn();
      AmicusMatrix.renderMatrix(container, matrix, onDrill);
      const voteCells = container.querySelectorAll('td').filter((td) => td.classList.contains('vote-cell'));
      expect(voteCells.length).toBe(2);
      expect(voteCells[0]._listeners.click).toBeUndefined();
      expect(voteCells[1]._listeners.click.length).toBe(1);
      voteCells[1]._listeners.click[0]();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(onDrill).toHaveBeenCalledWith({ model: 'gpt', label: 'Review B' }, 'A1');
    });

    test('thin and tierOverride badges render without throwing and carry their title text', () => {
      const container = document.createElement('div');
      const matrix = {
        judges: [{ model: 'gemini', label: 'Review A' }],
        rows: [{
          id: 'B2', severity: 'low', tier: 'Disputed', thin: true,
          tierOverride: { from: 'Contested', to: 'Disputed', reason: 'tie-break' }, debate: null,
          raiser: { model: 'gemini', label: 'Review A' }, basis: { a: 1, d: 1, n: 0 },
          cells: [{ judge: { model: 'gemini', label: 'Review A' }, verdict: 'dispute', sym: '✗', isRaiser: true }],
        }],
        tierCounts: { Disputed: 1 }, judged: true,
      };
      expect(() => AmicusMatrix.renderMatrix(container, matrix, () => {})).not.toThrow();
      expect(container.textContent).toContain('thin');
      expect(container.textContent).toContain('override');
    });

    // ⚠️ Fix-wave item 2 (F29 half-landed): matrix-model.js's buildMatrixModel already emits
    // row.debate ({action, previousTier}) on a --debate run, but renderMatrix never read it —
    // so a withdrawn/amended/defended/no-response finding rendered identically to an ordinary
    // live row, which is exactly the defect F29 was filed against.
    test('a withdrawn finding (row.debate.action) renders a badge in the tier cell, not an ordinary live row', () => {
      const container = document.createElement('div');
      const matrix = {
        judges: [{ model: 'gemini', label: 'Review A' }],
        rows: [{
          id: 'C3', severity: 'medium', tier: 'Singleton', thin: false, tierOverride: null,
          debate: { action: 'withdrawn', previousTier: 'Contested' },
          raiser: { model: 'gemini', label: 'Review A' }, basis: { a: 0, d: 0, n: 1 },
          cells: [{ judge: { model: 'gemini', label: 'Review A' }, verdict: 'agree', sym: '✓', isRaiser: true }],
        }],
        tierCounts: { Singleton: 1 }, judged: true,
      };
      AmicusMatrix.renderMatrix(container, matrix, () => {});
      const badge = container.querySelector('.debate-badge');
      expect(badge).toBeTruthy();
      expect(badge.textContent).toContain('withdrawn');
      expect(badge.attributes.title).toContain('withdrawn');
      expect(badge.attributes.title).toContain('Contested');
    });

    test('an amended finding renders a badge naming the action and the previousTier -> tier movement', () => {
      const container = document.createElement('div');
      const matrix = {
        judges: [{ model: 'gemini', label: 'Review A' }],
        rows: [{
          id: 'D4', severity: 'high', tier: 'Confirmed', thin: false, tierOverride: null,
          debate: { action: 'amended', previousTier: 'Disputed' },
          raiser: { model: 'gemini', label: 'Review A' }, basis: { a: 1, d: 0, n: 0 },
          cells: [{ judge: { model: 'gemini', label: 'Review A' }, verdict: 'agree', sym: '✓', isRaiser: true }],
        }],
        tierCounts: { Confirmed: 1 }, judged: true,
      };
      AmicusMatrix.renderMatrix(container, matrix, () => {});
      const badge = container.querySelector('.debate-badge');
      expect(badge).toBeTruthy();
      expect(badge.textContent).toContain('amended');
      expect(badge.attributes.title).toContain('Disputed');
      expect(badge.attributes.title).toContain('Confirmed');
    });

    test('debate: null (non-debate run, or a finding no debate touched) renders no debate badge', () => {
      const container = document.createElement('div');
      const matrix = {
        judges: [{ model: 'gemini', label: 'Review A' }],
        rows: [{
          id: 'A1', severity: 'high', tier: 'Confirmed', thin: false, tierOverride: null, debate: null,
          raiser: { model: 'gemini', label: 'Review A' }, basis: { a: 1, d: 0, n: 0 },
          cells: [{ judge: { model: 'gemini', label: 'Review A' }, verdict: 'agree', sym: '✓', isRaiser: true }],
        }],
        tierCounts: { Confirmed: 1 }, judged: true,
      };
      AmicusMatrix.renderMatrix(container, matrix, () => {});
      expect(container.querySelector('.debate-badge')).toBeNull();
    });

    test('hard-caps rendered rows at MATRIX_ROW_CAP with a show-more note (spec §5.4)', () => {
      const container = document.createElement('div');
      const rows = [];
      for (let i = 0; i < 501; i += 1) {
        rows.push({
          id: 'F' + i, severity: null, tier: null, thin: false, tierOverride: null, debate: null,
          raiser: { model: 'gemini', label: null }, basis: { a: 0, d: 0, n: 0 }, cells: [],
        });
      }
      AmicusMatrix.renderMatrix(container, { judges: [], rows, tierCounts: null, judged: true }, () => {});
      expect(container.querySelector('tbody').children.length).toBe(500);
      expect(container.textContent).toContain('Showing 500 of 501 findings.');
    });

    /**
     * v4.8 PR4c §3.6 (R4c-8), T19 — the HARD prerequisite on the seat re-key.
     *
     * A seat id CONTAINS its alias, so rendering one with blind mode on defeats
     * blind mode. matrix-model.js therefore resolves each column's label from
     * the seat's ALIAS and carries the seat's ID only as identity; this is the
     * only test that puts that pair through the REAL display() flip, which is
     * where the leak would actually surface (workspace-render.js's
     * `blind && pair.label ? pair.label : pair.model`).
     *
     * Named mutant: `pairFor(seat.id, map)` in matrix-model.js — labelMap's
     * values are aliases, so labelFor returns null for `gemini#1`, display()
     * falls back to pair.model and the blind header renders `gemini#1 |
     * gemini#2` UNMASKED. Measured RED against it. The non-blind half is
     * asserted in the same test because a spelling that masks correctly by
     * throwing the seat id away (`pairFor(seat.alias, map)`) restores two
     * indistinguishable `gemini` columns — the R4c-8 defect again.
     */
    test('T19: blind mode renders NO seat id on a twin bench — both columns read Review A', () => {
      const twinTally = {
        meta: {
          models: ['gemini', 'gemini'], claudeInCouncil: false,
          seats: [
            { id: 'gemini#1', alias: 'gemini', role: 'seat', lens: null, position: 1 },
            { id: 'gemini#2', alias: 'gemini', role: 'seat', lens: null, position: 2 },
          ],
        },
        findings: [{
          id: 'A1', severity: 'major', raiser: 'gemini', raiserSeat: 'gemini#1',
          tier: 'Contested', basis: { a: 0, d: 1, n: 0 },
          adjudications: [
            { judge: 'gemini', verdict: 'agree', seat: 'gemini#1' },
            { judge: 'gemini', verdict: 'dispute', seat: 'gemini#2' },
          ],
        }],
        tierCounts: { Contested: 1 },
      };
      // The real labelMap a twin bench writes: two labels, ONE alias.
      const matrix = buildMatrixModel(twinTally, { 'Review A': 'gemini', 'Review B': 'gemini' }, null);

      global.window.AmicusApp = { isBlind: () => true };
      const blindC = document.createElement('div');
      AmicusMatrix.renderMatrix(blindC, matrix, () => {});
      expect(blindC.textContent).not.toContain('gemini');
      expect(blindC.textContent).toContain('Review A');

      global.window.AmicusApp = { isBlind: () => false };
      const plainC = document.createElement('div');
      AmicusMatrix.renderMatrix(plainC, matrix, () => {});
      const heads = plainC.querySelectorAll('th').map(th => th.textContent);
      expect(heads).toEqual(['Finding', 'Sev', 'Raiser', 'gemini#1', 'gemini#2', 'Tier', 'a/d/n']);
      // …and the raiser cell names a column that exists, starred on that seat only.
      const tds = plainC.querySelectorAll('td').map(td => td.textContent);
      expect(tds.slice(0, 5)).toEqual(['A1', 'major', 'gemini#1', '✓*', '✗']);
    });

    /**
     * v4.8 T-C2 (SI-22.5, ruling R18) — the fold column through the REAL painter.
     *
     * ⚠️ `electron/workspace-ui/workspace-matrix.js` needed ZERO edits for this
     * and received none: renderMatrix iterates `matrix.judges` for the header
     * and `row.cells` for the body, so a roster entry IS a column. This test is
     * the proof by execution.
     *
     * It is also where the BLIND-MODE decision is pinned, and the labelMap is
     * adversarial on purpose. UNATTRIBUTED has no alias to protect and no
     * identity to reveal, so matrix-model.js carries the same literal in BOTH
     * name slots and the flip (`blind && pair.label ? pair.label : pair.model`)
     * is a no-op on it BY CONSTRUCTION. The obvious alternative spelling,
     * `pairFor(UNATTRIBUTED, map)`, renders identically on every ordinary
     * labelMap — `labelFor` returns null and display() falls back to
     * `pair.model` — so it would be GREEN against its own mutant here. The
     * `'Review Z': 'UNATTRIBUTED'` entry below is what makes the two spellings
     * diverge: measured, that mutant prints `Review Z` for the fold column with
     * blind mode on, which is a column of nobody's votes wearing a seat's label.
     * Named mutant, with its measured red set: tests/council/seat-matrix.test.js :: WSPAIRFOR.
     */
    test('T-C2: the UNATTRIBUTED column paints, and reads the same with blind mode ON and OFF', () => {
      const orphanTally = {
        meta: {
          models: ['gemini', 'gemini'], claudeInCouncil: false,
          seats: [
            { id: 'gemini#1', alias: 'gemini', role: 'seat', lens: null, position: 1 },
            { id: 'gemini#2', alias: 'gemini', role: 'seat', lens: null, position: 2 },
          ],
        },
        findings: [{
          id: 'A1', severity: 'major', raiser: 'gemini', raiserSeat: 'gemini#1',
          tier: 'Contested', basis: { a: 1, d: 1, n: 0 },
          adjudications: [
            { judge: 'gemini', verdict: 'agree', seat: 'gemini#1' },
            { judge: 'gemini', verdict: 'dispute' },   // Stage-2 seat orphaned
          ],
        }],
        tierCounts: { Contested: 1 },
      };
      const matrix = buildMatrixModel(orphanTally, {
        'Review A': 'gemini', 'Review B': 'gemini', 'Review Z': 'UNATTRIBUTED',
      }, null);

      global.window.AmicusApp = { isBlind: () => false };
      const plainC = document.createElement('div');
      AmicusMatrix.renderMatrix(plainC, matrix, () => {});
      expect(plainC.querySelectorAll('th').map(th => th.textContent))
        .toEqual(['Finding', 'Sev', 'Raiser', 'gemini#1', 'gemini#2', 'UNATTRIBUTED', 'Tier', 'a/d/n']);
      const tds = plainC.querySelectorAll('td').map(td => td.textContent);
      expect(tds.slice(0, 6)).toEqual(['A1', 'major', 'gemini#1', '✓*', ' ', '✗']);

      global.window.AmicusApp = { isBlind: () => true };
      const blindC = document.createElement('div');
      AmicusMatrix.renderMatrix(blindC, matrix, () => {});
      expect(blindC.querySelectorAll('th').map(th => th.textContent))
        .toEqual(['Finding', 'Sev', 'Raiser', 'Review A', 'Review A', 'UNATTRIBUTED', 'Tier', 'a/d/n']);
      // The seat ids are still masked — the new column changed nothing about
      // the twins — and the fold column reads the same word in both modes.
      expect(blindC.textContent).not.toContain('gemini');
      expect(blindC.textContent).not.toContain('Review Z');
      // The hover/aria text names it too, so a cell of nobody's votes is not a
      // silent blank: verdictTitle() runs the same display() over cell.judge.
      const foldCell = blindC.querySelectorAll('td').filter(td => td.textContent === '✗')[0];
      expect(foldCell.attributes['aria-label']).toBe('UNATTRIBUTED: dispute');
    });
  });

  describe('renderVerdict', () => {
    test('no chair verdict renders the error chip + degraded reason', () => {
      const container = document.createElement('div');
      const vp = { present: false, overallVerdict: null, tierCounts: null, streetCred: [], decisions: [], reason: 'chair stage failed' };
      AmicusMatrix.renderVerdict(container, vp, {
        labelOf: () => null, isBlind: () => false, reportPresent: false, onFold: () => {}, onOpenReport: () => {},
      });
      expect(container.textContent).toContain('no chair verdict');
      expect(container.textContent).toContain('chair stage failed');
    });

    /**
     * v4.9 fix round 2 (council B2), the renderer half — ALREADY GREEN by
     * construction, and pinned here because it is the half that was never the
     * defect. `renderVerdict` has forked this chip on `vp.intent` since W8; what
     * was broken was upstream, in `src/workspace/run-detail.js :: verdictPanel`,
     * which minted a hard-coded `intent: 'review'` on every present:false panel
     * and so could never hand this branch a task payload. The fix sources the
     * panel's intent as `verdict.intent || run.intent`; this pin states the
     * contract that fix now satisfies, so a future edit cannot quietly retire
     * the branch it feeds.
     */
    test("a task payload with no chair answer renders 'no chair answer', not 'no chair verdict'", () => {
      const container = document.createElement('div');
      const vp = {
        present: false, intent: 'task', overallVerdict: null, tierCounts: null,
        streetCred: [], decisions: [], reason: 'chair stage failed',
      };
      AmicusMatrix.renderVerdict(container, vp, {
        labelOf: () => null, isBlind: () => false, reportPresent: false, onFold: () => {}, onOpenReport: () => {},
      });
      expect(container.textContent).toContain('no chair answer');
      expect(container.textContent).not.toContain('no chair verdict');
      expect(container.textContent).toContain('chair stage failed');
    });

    test('tierCounts renders AS-IS even when it disagrees with the visible rows — a PRE-override aggregate, never derived (matches report.html / verdict.js:48)', () => {
      const container = document.createElement('div');
      const vp = {
        present: true, overallVerdict: 'Fix these first',
        tierCounts: { Confirmed: 1, Disputed: 0, Contested: 1, Singleton: 0 },
        streetCred: [], decisions: [], reason: null,
      };
      AmicusMatrix.renderVerdict(container, vp, {
        labelOf: () => null, isBlind: () => false, reportPresent: true, onFold: () => {}, onOpenReport: () => {},
      });
      expect(container.textContent).toContain('VERDICT: Fix these first');
      expect(container.textContent).toContain('Confirmed 1');
      expect(container.textContent).toContain('Contested 1');
    });

    test('street-cred blind flip uses labelOf/isBlind, not a hand-rolled ternary', () => {
      const container = document.createElement('div');
      const vp = {
        present: true, overallVerdict: 'ok', tierCounts: null,
        streetCred: [{ model: 'gemini', peersOnly: 0.8, withSelf: 0.75 }], decisions: [], reason: null,
      };
      AmicusMatrix.renderVerdict(container, vp, {
        labelOf: (m) => (m === 'gemini' ? 'Review A' : null), isBlind: () => true, reportPresent: true,
        onFold: () => {}, onOpenReport: () => {},
      });
      expect(container.textContent).toContain('Review A');
      expect(container.textContent).not.toContain('gemini');
    });

    test('fold + open-report buttons wire opts.onFold/onOpenReport, and reportPresent:false disables open-report', () => {
      const container = document.createElement('div');
      const onFold = jest.fn();
      const onOpenReport = jest.fn();
      const vp = { present: true, overallVerdict: 'ok', tierCounts: null, streetCred: [], decisions: [], reason: null };
      AmicusMatrix.renderVerdict(container, vp, {
        labelOf: () => null, isBlind: () => false, reportPresent: false, onFold, onOpenReport,
      });
      const foldBtn = container.querySelector('#fold-btn');
      const reportBtn = container.querySelector('#open-report-btn');
      expect(foldBtn).toBeTruthy();
      expect(reportBtn.disabled).toBe(true);
      foldBtn._listeners.click[0]();
      expect(onFold).toHaveBeenCalledTimes(1);
      reportBtn._listeners.click[0]();
      expect(onOpenReport).toHaveBeenCalledTimes(1);
    });

    /**
     * v4.9 W8 T-B — the chip names the scale its phrase belongs to.
     *
     * Payload-driven ONLY: this file is a plain browser script loaded by the
     * Electron renderer, so it cannot require() src/ to learn the run's intent.
     * `vp.intent` is minted by src/workspace/run-detail.js :: verdictPanel, which
     * always materializes it; the ternary below is `=== 'task'` rather than
     * `!== 'review'` so a payload that predates v4.9 (no key at all — the shape
     * every other workspace suite hand-builds) reads as review rather than
     * flipping every legacy run's chip to ANSWER.
     *
     * Named mutant CHIPLABELSTUCK: drop the ternary back to the bare
     * `'VERDICT: ' + vp.overallVerdict`. RED SET: the task test below.
     */
    test("a task payload's chip reads ANSWER:, never VERDICT:", () => {
      const container = document.createElement('div');
      const vp = {
        present: true, intent: 'task', overallVerdict: 'Converged',
        tierCounts: null, streetCred: [], decisions: [], reason: null,
      };
      AmicusMatrix.renderVerdict(container, vp, {
        labelOf: () => null, isBlind: () => false, reportPresent: true, onFold: () => {}, onOpenReport: () => {},
      });
      expect(container.textContent).toContain('ANSWER: Converged');
      expect(container.textContent).not.toContain('VERDICT');
    });

    test('a review payload keeps VERDICT: — and so does a legacy payload with no intent key (absence pin)', () => {
      const render = (vp) => {
        const container = document.createElement('div');
        AmicusMatrix.renderVerdict(container, vp, {
          labelOf: () => null, isBlind: () => false, reportPresent: true, onFold: () => {}, onOpenReport: () => {},
        });
        return container.textContent;
      };
      const base = { present: true, overallVerdict: 'Fix these first', tierCounts: null, streetCred: [], decisions: [], reason: null };
      expect(render({ ...base, intent: 'review' })).toContain('VERDICT: Fix these first');
      expect(render(base)).toContain('VERDICT: Fix these first');   // no intent key at all
      expect(render(base)).not.toContain('ANSWER');
    });

    test('returns the chair-prose host element for the caller to render markdown into', () => {
      const container = document.createElement('div');
      const vp = { present: true, overallVerdict: 'ok', tierCounts: null, streetCred: [], decisions: [], reason: null };
      const chairHost = AmicusMatrix.renderVerdict(container, vp, {
        labelOf: () => null, isBlind: () => false, reportPresent: true, onFold: () => {}, onOpenReport: () => {},
      });
      expect(chairHost.attributes.id).toBe('chair-prose');
    });
  });

  describe('highlightText', () => {
    // ⚠️ v4.4.1 RN-3 + DOC-6: this test's title used to read "wraps the FIRST occurrence" —
    // it pinned the defect. The implementation did one indexOf/splitText per collected text
    // node, so the second "A1" in this very fixture went unmarked while the docblock above it
    // promised "every occurrence". Drilling into a dispute cell therefore highlighted the first
    // mention of a finding in the judge's prose and silently skipped the rest.
    test('wraps EVERY occurrence of the needle in a <mark>, DOM-safe (no innerHTML)', () => {
      const container = document.createElement('div');
      const p = document.createElement('p');
      p.appendChild(document.createTextNode('The finding A1 appears in this sentence about A1 twice.'));
      container.appendChild(p);
      AmicusMatrix.highlightText(container, 'A1');
      const marks = container.querySelectorAll('mark');
      expect(marks.length).toBe(2);                       // ← 1 pre-fix
      expect(marks[0].textContent).toBe('A1');
      expect(marks[1].textContent).toBe('A1');
      // DOM-safe: reconstructing the full text must still read identically (split/replace,
      // not string surgery on markup).
      expect(container.textContent).toBe('The finding A1 appears in this sentence about A1 twice.');
    });

    test('marks every occurrence across SEVERAL text nodes, including repeats within each', () => {
      const container = document.createElement('div');
      ['A1 then A1', 'nothing here', 'A1 once'].forEach((t) => {
        const p = document.createElement('p');
        p.appendChild(document.createTextNode(t));
        container.appendChild(p);
      });
      AmicusMatrix.highlightText(container, 'A1');
      expect(container.querySelectorAll('mark').length).toBe(3);
      expect(container.textContent).toBe('A1 then A1nothing hereA1 once');
    });

    test('adjacent and back-to-back occurrences terminate (the splitText tail is what is rescanned)', () => {
      // The loop advances onto the NEW node splitText leaves behind. Rescanning `cursor`
      // instead would re-find the text it just replaced and spin forever — this is the
      // shape that would hang.
      const container = document.createElement('div');
      container.appendChild(document.createTextNode('A1A1A1'));
      AmicusMatrix.highlightText(container, 'A1');
      expect(container.querySelectorAll('mark').length).toBe(3);
      expect(container.textContent).toBe('A1A1A1');
    });

    test('a needle that does not appear leaves the tree untouched, no throw', () => {
      const container = document.createElement('div');
      container.appendChild(document.createTextNode('nothing to see here'));
      expect(() => AmicusMatrix.highlightText(container, 'ZZZ')).not.toThrow();
      expect(container.querySelector('mark')).toBeNull();
    });

    test('an empty/falsy needle is a no-op', () => {
      const container = document.createElement('div');
      container.appendChild(document.createTextNode('some text'));
      AmicusMatrix.highlightText(container, '');
      expect(container.querySelector('mark')).toBeNull();
    });

    // ⚠️ v4.4.1 M1: clearHighlight() unwraps <mark> back to a plain text node but never
    // normalizes, so the sibling text nodes either side of the old mark are left un-merged.
    // Drilling into finding "B3" first incidentally matches the "B3" PREFIX of the unrelated
    // "B31" mention right next to it (plain indexOf substring match — exactly what makes this
    // reachable with real finding ids), splitting "B31" into a "B3" node and a "1..." node.
    // clearHighlight() leaves those two un-merged. Re-drilling into "B31" itself then has to
    // find a needle that SPANS that leftover boundary — which a single-text-node .indexOf scan
    // can never do — so pre-fix this finds nothing at all, even though "B31" plainly still
    // reads correctly in container.textContent.
    test('a second drill still finds a needle that straddles a fragment boundary left by a previous drill+clear cycle', () => {
      const container = document.createElement('div');
      container.appendChild(document.createTextNode('See B31 for details, not B3 alone.'));

      AmicusMatrix.highlightText(container, 'B3'); // matches the real "B3 alone" AND the "B3" prefix of "B31"
      AmicusMatrix.clearHighlight(container); // unwraps both marks, does NOT re-merge the tree

      AmicusMatrix.highlightText(container, 'B31'); // the second, different drill

      const marks = container.querySelectorAll('mark');
      expect(marks.length).toBe(1); // 0 pre-fix: "B31" is invisible once "B3"/"1..." are split apart
      expect(marks[0].textContent).toBe('B31');
      expect(container.textContent).toBe('See B31 for details, not B3 alone.');
    });

    // Same fix, the literal case the brief describes: drilling into the SAME finding twice in a
    // row (clear in between) must still find every occurrence on the second pass, even after the
    // tree has been fragmented by drill cycles for OTHER findings sharing the same prose panel
    // (drillIntoJudge's cached, never-rebuilt prose — see clearHighlight's docblock).
    test('drilling the same finding twice in a row (with an unrelated drill in between) still finds every occurrence on the second pass', () => {
      const container = document.createElement('div');
      container.appendChild(document.createTextNode('B31 mentions B3 twice: see B3 and B31 again.'));

      AmicusMatrix.highlightText(container, 'B31'); // first drill: finding B31
      AmicusMatrix.clearHighlight(container);
      AmicusMatrix.highlightText(container, 'B3'); // an unrelated drill into a different finding, B3 — fragments the B31 mentions too (substring match)
      AmicusMatrix.clearHighlight(container);

      AmicusMatrix.highlightText(container, 'B31'); // re-drilling the SAME finding, B31, a second time
      const marks = container.querySelectorAll('mark');
      expect(marks.length).toBe(2); // both "B31" mentions, not just whichever one avoided fragmentation
      marks.forEach((m) => expect(m.textContent).toBe('B31'));
    });
  });
});
