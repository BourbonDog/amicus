'use strict';

const liveModel = require('../../electron/workspace-ui/live-model');

/**
 * Minimal fake DOM for exercising workspace-render.js's painters under jest's `node` test
 * environment (no jsdom — same harness pattern as md-lite.test.js, zero new deps). Jest runs
 * with `testEnvironment: 'node'`, so there is no global `document`/`window`; but
 * workspace-render.js reads both at CALL time (inside function bodies), not at load time,
 * so stubbing `global.document`/`global.window` before invoking a painter is sufficient —
 * the one load-time statement (`window.AmicusRender = {...}`) only needs `global.window` to
 * already be an object.
 *
 * `innerHTML` / `outerHTML` / `insertAdjacentHTML` are THROWING TRAPS, not no-ops: if any
 * painter (or `el()`, which every painter funnels through) ever reached for one of those
 * instead of textContent / createTextNode / setAttribute, the trap throws immediately and
 * the test fails loud rather than silently passing.
 */
function makeFakeDoc() {
  function throwTrap(prop) {
    return function trap() {
      throw new Error(`workspace-render must never touch ${prop}`);
    };
  }

  function FakeElement(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.childNodes = [];
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.parentElement = null;
    this._listeners = {};
    this._classes = [];
    var self = this;
    this.classList = {
      add: function (c) { if (self._classes.indexOf(c) === -1) { self._classes.push(c); } },
      remove: function (c) { self._classes = self._classes.filter(function (x) { return x !== c; }); },
      toggle: function (c, force) {
        var has = self._classes.indexOf(c) !== -1;
        var want = force === undefined ? !has : !!force;
        if (want && !has) { self._classes.push(c); }
        if (!want && has) { self._classes = self._classes.filter(function (x) { return x !== c; }); }
      },
      contains: function (c) { return self._classes.indexOf(c) !== -1; },
    };
  }
  Object.defineProperty(FakeElement.prototype, 'className', {
    get() { return this._classes.join(' '); },
    set(value) { this._classes = String(value).split(/\s+/).filter(Boolean); },
  });
  Object.defineProperty(FakeElement.prototype, 'children', {
    // Real DOM `.children` is a live HTMLCollection; a fresh array snapshot is enough here —
    // every painter either indexes it immediately or hands it to Array.prototype.slice.call.
    get() { return this.childNodes.filter(function (n) { return n instanceof FakeElement; }); },
  });
  FakeElement.prototype.appendChild = function appendChild(node) {
    this.childNodes.push(node);
    if (node instanceof FakeElement) { node.parentElement = this; }
    return node;
  };
  FakeElement.prototype.setAttribute = function setAttribute(name, value) {
    this.attributes[name] = String(value);
  };
  FakeElement.prototype.addEventListener = function addEventListener(type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  };
  FakeElement.prototype.remove = function remove() {
    if (this.parentElement) {
      var idx = this.parentElement.childNodes.indexOf(this);
      if (idx !== -1) { this.parentElement.childNodes.splice(idx, 1); }
      this.parentElement = null;
    }
  };
  FakeElement.prototype.querySelector = function querySelector(selector) {
    var tag = String(selector).replace(/[.#[].*$/, '').trim().toUpperCase();
    for (const child of this.childNodes) {
      if (child instanceof FakeElement) {
        if (child.tagName === tag) { return child; }
        const nested = child.querySelector(selector);
        if (nested) { return nested; }
      }
    }
    return null;
  };
  Object.defineProperty(FakeElement.prototype, 'textContent', {
    get() {
      return this.childNodes.map((n) => (n instanceof FakeElement ? n.textContent : n.data)).join('');
    },
    set(value) {
      this.childNodes = [];
      if (value) { this.childNodes.push({ data: String(value) }); }
    },
  });
  ['innerHTML', 'outerHTML'].forEach((prop) => {
    Object.defineProperty(FakeElement.prototype, prop, {
      get: throwTrap(prop),
      set: throwTrap(prop),
    });
  });
  FakeElement.prototype.insertAdjacentHTML = throwTrap('insertAdjacentHTML');

  return {
    createElement: (tag) => new FakeElement(tag),
    createTextNode: (text) => ({ data: String(text) }),
    write: throwTrap('document.write'),
  };
}

describe('workspace-render.js (headless painter proof — the 3 gaps the plan-mandated e2e leaves on a keyless runner)', () => {
  let AmicusRender;

  beforeAll(() => {
    global.window = { AmicusLive: liveModel };
    global.document = makeFakeDoc();
    delete require.cache[require.resolve('../../electron/workspace-ui/workspace-render')];
    // workspace-render.js has no module.exports guard (unlike live-model.js) — it is DOM-side
    // only, per the brief's Step 5 code and Interfaces note ("covered by the e2e"). Requiring
    // it purely for the side effect of `window.AmicusRender = {...}` at its one load-time
    // statement; the require()'s own return value (Node's default empty exports) is unused.
    // eslint-disable-next-line global-require
    require('../../electron/workspace-ui/workspace-render');
    AmicusRender = global.window.AmicusRender;
  });

  beforeEach(() => {
    // Fresh globals per test: `el()`/`renderSeats` read `document`/`window` at CALL time via
    // the module's closure over the (mutable) global object, so swapping these per test
    // isolates DOM state without re-requiring the module.
    global.window = { AmicusLive: liveModel };
    global.document = makeFakeDoc();
  });

  afterAll(() => {
    delete global.window;
    delete global.document;
  });

  describe('renderCost (blind flip) — the second blind-mode surface, hand-duplicated from seatCells', () => {
    const cost = {
      rows: [{ model: 'gemini', role: 'seat', status: 'complete', durationMs: 12000, costDisplay: '$0.10' }],
      totalDisplay: '$0.10',
    };
    const labelOf = (m) => (m === 'gemini' ? 'Review A' : null);

    test('blind ON renders the label', () => {
      const container = document.createElement('div');
      AmicusRender.renderCost(container, cost, true, labelOf);
      const tbody = container.children[0].children[1]; // table > tbody
      expect(tbody.children[0].children[0].textContent).toBe('Review A');
    });

    test('blind OFF renders the alias', () => {
      const container = document.createElement('div');
      AmicusRender.renderCost(container, cost, false, labelOf);
      const tbody = container.children[0].children[1];
      expect(tbody.children[0].children[0].textContent).toBe('gemini');
    });
  });

  // ⚠️ R4 COUNCIL REVIEW (fourth live paid council, major, unanimous): renderHeaderChips and
  // renderRunList interpolated raw model ids directly, bypassing display(pair, blind) — every
  // OTHER identity surface (seat rows, cost rows, revote titles) masks correctly through it.
  // Christian has ruled blind mode IS for masking the roster (superseding an earlier reading
  // that the unmasked header/rail was correct-by-design) — route both through display().
  describe('renderHeaderChips (blind flip) — bench/critic/chair chips must mask like every other identity surface', () => {
    const run = { status: 'complete', bench: ['gemini', 'gpt'], critic: 'gemini', chair: 'gpt', lenses: ['skeptic'] };
    const labelOf = (m) => ({ gemini: 'Review A', gpt: 'Review B' }[m] || null);

    test('blind ON renders labels for bench/critic/chair chips', () => {
      const container = document.createElement('div');
      AmicusRender.renderHeaderChips(container, run, true, labelOf);
      const chips = container.children.map((c) => c.textContent);
      expect(chips).toContain('Review A');
      expect(chips).toContain('Review B');
      expect(chips).toContain('critic: Review A');
      expect(chips).toContain('chair: Review B');
      // lenses are style slugs, not model identities — never masked.
      expect(chips).toContain('lens: skeptic');
      expect(chips.some((t) => t === 'gemini' || t === 'gpt')).toBe(false);
      expect(chips.some((t) => t.indexOf('gemini') !== -1 || t.indexOf('gpt') !== -1)).toBe(false);
    });

    test('blind OFF renders raw model ids for bench/critic/chair chips', () => {
      const container = document.createElement('div');
      AmicusRender.renderHeaderChips(container, run, false, labelOf);
      const chips = container.children.map((c) => c.textContent);
      expect(chips).toContain('gemini');
      expect(chips).toContain('gpt');
      expect(chips).toContain('critic: gemini');
      expect(chips).toContain('chair: gpt');
    });

    test('a model with no known label degrades gracefully to the raw id even while blind (reading aid, not a hard cut)', () => {
      const container = document.createElement('div');
      AmicusRender.renderHeaderChips(container, { status: 'complete', bench: ['unknown-model'], chair: 'unknown-model' }, true, () => null);
      const chips = container.children.map((c) => c.textContent);
      expect(chips).toContain('unknown-model');
      expect(chips).toContain('chair: unknown-model');
    });
  });

  describe('renderRunList (blind flip) — the chair id in the run-row-sub line must mask like every other identity surface', () => {
    const rows = [{
      runId: 'aaaa1111', status: 'complete', startedAt: null, bench: ['gemini', 'gpt'],
      chair: 'gpt', overallVerdict: '', costDisplay: '',
    }];
    const labelOf = (m) => (m === 'gpt' ? 'Review B' : null);

    test('blind ON renders the chair label when known', () => {
      const container = document.createElement('ul');
      AmicusRender.renderRunList(container, rows, null, () => {}, true, labelOf);
      const subText = container.children[0].children[1].textContent;
      expect(subText).toContain('chair Review B');
      expect(subText).not.toContain('chair gpt');
    });

    test('blind OFF renders the raw chair id', () => {
      const container = document.createElement('ul');
      AmicusRender.renderRunList(container, rows, null, () => {}, false, labelOf);
      const subText = container.children[0].children[1].textContent;
      expect(subText).toContain('chair gpt');
    });

    test('a row with no label data available for its chair still degrades gracefully to the raw id', () => {
      const container = document.createElement('ul');
      AmicusRender.renderRunList(container, rows, null, () => {}, true, () => null);
      const subText = container.children[0].children[1].textContent;
      expect(subText).toContain('chair gpt');
    });

    // ⚠️ v4.4.1 RN-12. scanCouncilRuns' contract is "never throws on bad input — degrade to a
    // row instead". renderRunList paints EVERY row, so an unguarded `String(row.bench.length)`
    // meant one row without a bench array threw a TypeError that blanked the whole list, and the
    // data layer's guarantee died one layer up. Both shapes below are refused pre-fix.
    test('a row whose bench is missing entirely does not throw, and reads 0 seats', () => {
      const container = document.createElement('ul');
      const bad = [{ runId: 'bbbb2222', status: 'unknown', startedAt: null, chair: null }];
      expect(() => AmicusRender.renderRunList(container, bad, null, () => {}, false, () => null)).not.toThrow();
      expect(container.children[0].children[1].textContent).toContain('0 seats');
    });

    test('a non-array bench does not throw either, and one bad row never blanks the good rows', () => {
      const container = document.createElement('ul');
      const mixed = [
        // A STRING bench is the nastier half: it has a `.length`, so it never throws — it
        // silently reports the character count as a seat count ("6 seats" for 'gemini').
        { runId: 'bbbb2222', status: 'unknown', startedAt: null, bench: 'gemini', chair: null },
        ...rows,
      ];
      expect(() => AmicusRender.renderRunList(container, mixed, null, () => {}, false, () => null)).not.toThrow();
      expect(container.children.length).toBe(2);
      expect(container.children[0].children[1].textContent).toContain('0 seats');
      expect(container.children[1].children[1].textContent).toContain('2 seats');
    });
  });

  describe('el() — every painter funnels through this, so one test proves textContent-only discipline file-wide', () => {
    test('a string child carrying a script/onerror payload lands as ONE literal text node, never parsed', () => {
      const payload = '<img src=x onerror=alert(1)>';
      const node = AmicusRender.el('div', {}, [payload]);
      expect(node.childNodes.length).toBe(1);
      expect(node.childNodes[0]).toEqual({ data: payload });
      expect(node.textContent).toBe(payload);
    });

    test('a non-function on* attribute value is dropped, never written as a live inline handler attribute', () => {
      const node = AmicusRender.el('button', { onclick: 'alert(1)' }, []);
      expect(node.attributes.onclick).toBeUndefined();
    });
  });

  describe('renderSeats — the only stateful painter, and where the key-escaping bug lived', () => {
    test('a second render with a changed field updates the existing row in place (no duplication)', () => {
      const tbody = document.createElement('tbody');
      const seat = { id: 'gemini:seat', model: 'gemini', role: 'seat', status: 'running', stalled: false, costDisplay: '$0.01' };
      AmicusRender.renderSeats(tbody, [seat], false, () => null);
      expect(tbody.children.length).toBe(1);
      AmicusRender.renderSeats(tbody, [{ ...seat, costDisplay: '$0.05' }], false, () => null);
      expect(tbody.children.length).toBe(1);
      expect(tbody.children[0].children[6].textContent).toBe('$0.05'); // cost column
    });

    test('a departed seat is removed from the table', () => {
      const tbody = document.createElement('tbody');
      const a = { id: 'gemini:seat', model: 'gemini', role: 'seat', status: 'running', stalled: false };
      const b = { id: 'gpt:seat', model: 'gpt', role: 'seat', status: 'running', stalled: false };
      AmicusRender.renderSeats(tbody, [a, b], false, () => null);
      expect(tbody.children.length).toBe(2);
      AmicusRender.renderSeats(tbody, [a], false, () => null);
      expect(tbody.children.length).toBe(1);
      expect(tbody.children[0].dataset.key).toBe('gemini:seat');
    });

    test('a debate trio for the same alias yields three distinct rows, not one overwritten row', () => {
      const tbody = document.createElement('tbody');
      const rows = liveModel.seatsFromRunStats([
        { model: 'gemini', role: 'seat', status: 'complete', durationMs: 120000, costDisplay: '$0.11' },
        { model: 'gemini', role: 'rebuttal', status: 'complete', durationMs: 9000, costDisplay: '$0.03' },
        { model: 'gemini', role: 'revote', status: 'complete', durationMs: 4000, costDisplay: '$0.01' },
      ]);
      AmicusRender.renderSeats(tbody, rows, false, () => null);
      expect(tbody.children.length).toBe(3);
      expect(tbody.children.map((r) => r.dataset.key)).toEqual(['gemini:seat', 'gemini:rebuttal', 'gemini:revote']);
    });

    // Regression guard for the key-escaping bug (review item 1): a v4.2 local-provider alias
    // (LM Studio/Ollama free-form ids) can contain a `"` or `\`. The old code queried
    // `tr[data-key="<escaped key>"]` against an UNESCAPED stored `dataset.key` — one side of
    // the comparison was sanitized and the other was not, so the lookup missed every tick and
    // duplicated the row. A plain object keyed lookup has no escaping step to get wrong.
    test('a seat id containing a quote and a backslash still updates in place across renders', () => {
      const tbody = document.createElement('tbody');
      const seat = { id: 'weird"back\\slash', model: 'local-model', role: 'seat', status: 'running', stalled: false, costDisplay: '$0.01' };
      AmicusRender.renderSeats(tbody, [seat], false, () => null);
      expect(tbody.children.length).toBe(1);
      AmicusRender.renderSeats(tbody, [{ ...seat, costDisplay: '$0.09' }], false, () => null);
      expect(tbody.children.length).toBe(1);
      expect(tbody.children[0].children[6].textContent).toBe('$0.09');
    });
  });
});
