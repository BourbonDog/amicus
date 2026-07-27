'use strict';

const { makeFakeDom } = require('./helpers/fake-workspace-page');

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

    test('a dispute cell wires onDrill(judgePair, findingId); an agree cell gets no click listener', () => {
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
  });
});
