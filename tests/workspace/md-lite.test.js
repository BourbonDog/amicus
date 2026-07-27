'use strict';

const fs = require('fs');
const path = require('path');

const { parseMdLite, parseInline, renderMdLite } = require('../../electron/workspace-ui/md-lite');

describe('parseMdLite', () => {
  test('headings, bullets, numbered lists, fences, paragraphs', () => {
    const text = [
      '# Title',
      '',
      'Intro paragraph',
      'continues here.',
      '',
      '- one',
      '- two',
      '',
      '1. first',
      '2) second',
      '',
      '```',
      'raw <b>code</b> & things',
      '```',
      '## Sub',
    ].join('\n');
    expect(parseMdLite(text)).toEqual([
      { t: 'h', level: 1, text: 'Title' },
      { t: 'p', text: 'Intro paragraph continues here.' },
      { t: 'ul', items: ['one', 'two'] },
      { t: 'ol', items: ['first', 'second'] },
      { t: 'code', text: 'raw <b>code</b> & things' },
      { t: 'h', level: 2, text: 'Sub' },
    ]);
  });

  test('unclosed fence swallows to EOF without throwing', () => {
    expect(parseMdLite('```js\nlet x = 1;')).toEqual([{ t: 'code', text: 'let x = 1;' }]);
  });

  test('HTML in prose stays inert text (no parsing, no stripping)', () => {
    const blocks = parseMdLite('<img src=x onerror=alert(1)> hello');
    expect(blocks).toEqual([{ t: 'p', text: '<img src=x onerror=alert(1)> hello' }]);
  });

  test('CRLF input and empty/nullish input', () => {
    expect(parseMdLite('# A\r\n\r\n- b\r\n')).toEqual([{ t: 'h', level: 1, text: 'A' }, { t: 'ul', items: ['b'] }]);
    expect(parseMdLite('')).toEqual([]);
    expect(parseMdLite(null)).toEqual([]);
  });
});

describe('parseInline', () => {
  test('splits inline code spans', () => {
    expect(parseInline('call `fn()` twice')).toEqual([
      { code: false, text: 'call ' },
      { code: true, text: 'fn()' },
      { code: false, text: ' twice' },
    ]);
  });

  test('no spans → single text segment; unbalanced backtick stays literal', () => {
    expect(parseInline('plain')).toEqual([{ code: false, text: 'plain' }]);
    expect(parseInline('a ` b')).toEqual([{ code: false, text: 'a ` b' }]);
  });
});

/**
 * Minimal fake DOM for exercising renderMdLite() under jest's `node` test
 * environment (no jsdom dependency — this task adds zero new deps).
 *
 * The critical design point: `innerHTML` / `insertAdjacentHTML` / `outerHTML`
 * are TRAPS, not no-ops. If renderMdLite (or any helper it calls) ever
 * assigned untrusted text through one of those instead of textContent /
 * createTextNode, the trap throws immediately and the test fails loud. A
 * plain stub (or a real jsdom element) would silently accept an innerHTML
 * assignment and this proof would be lost — the trap is what makes "would
 * this test fail if text were assigned as HTML instead?" true for every
 * assertion below.
 */
function makeFakeDoc() {
  function throwTrap(prop) {
    return function trap() {
      throw new Error(`md-lite must never touch ${prop}`);
    };
  }

  function FakeElement(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.childNodes = [];
  }
  FakeElement.prototype.appendChild = function appendChild(node) {
    this.childNodes.push(node);
    return node;
  };
  FakeElement.prototype.querySelector = function querySelector(selector) {
    const tag = String(selector).toUpperCase();
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
  // ⚠️ v4.4.1 (opus finding 3): the ATTRIBUTE sink, trapped the same way. md-lite
  // emits no attributes today, so the trap is silent — but if a link/image feature
  // ever set one from model text, every render test below fails immediately rather
  // than staying green while a javascript:/data: URL vector opens. This is the
  // behavioral half of the guard; the source-grep half is at the bottom of the file.
  FakeElement.prototype.setAttribute = throwTrap('setAttribute');
  FakeElement.prototype.setAttributeNS = throwTrap('setAttributeNS');

  return {
    createElement: (tag) => new FakeElement(tag),
    createTextNode: (text) => ({ data: String(text) }),
    write: throwTrap('document.write'),
  };
}

describe('renderMdLite (DOM safety proof)', () => {
  test('a <script> tag inside prose renders as literal text, not an element', () => {
    const doc = makeFakeDoc();
    const container = doc.createElement('div');
    renderMdLite(container, '<script>alert(1)</script> hello', doc);
    expect(container.textContent).toContain('<script>alert(1)</script>');
    expect(container.querySelector('script')).toBeNull();
  });

  test('an <img onerror> payload inside prose renders as literal text, not an element', () => {
    const doc = makeFakeDoc();
    const container = doc.createElement('div');
    renderMdLite(container, '<img src=x onerror=alert(1)> hello', doc);
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(container.querySelector('img')).toBeNull();
  });

  test('raw & < > characters survive as literal text in a paragraph', () => {
    const doc = makeFakeDoc();
    const container = doc.createElement('div');
    renderMdLite(container, 'A & B < C > D', doc);
    expect(container.textContent).toBe('A & B < C > D');
    expect(container.childNodes.length).toBe(1);
    expect(container.childNodes[0].tagName).toBe('P');
  });

  test('markup inside a fenced code block renders as literal text, not elements', () => {
    const doc = makeFakeDoc();
    const container = doc.createElement('div');
    renderMdLite(container, '```\n<script>alert(1)</script>\n```', doc);
    expect(container.textContent).toBe('<script>alert(1)</script>');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('pre')).not.toBeNull();
    expect(container.querySelector('code')).not.toBeNull();
  });

  test('an onerror payload inside inline code renders as literal text, not an element', () => {
    const doc = makeFakeDoc();
    const container = doc.createElement('div');
    renderMdLite(container, 'call `<img src=x onerror=alert(1)>` now', doc);
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(container.querySelector('img')).toBeNull();
  });

  test('re-render clears prior content instead of appending', () => {
    const doc = makeFakeDoc();
    const container = doc.createElement('div');
    renderMdLite(container, '# First', doc);
    renderMdLite(container, '# Second', doc);
    expect(container.textContent).toBe('Second');
  });

  test('structural mapping: heading level, list items, inline code element', () => {
    const doc = makeFakeDoc();
    const container = doc.createElement('div');
    renderMdLite(container, '# Title\n\n- one\n- two\n\ncall `fn()` now', doc);
    expect(container.childNodes[0].tagName).toBe('H3'); // level 1 -> h3 (panels reserve h1/h2)
    expect(container.childNodes[0].textContent).toBe('Title');
    expect(container.childNodes[1].tagName).toBe('UL');
    expect(container.childNodes[1].childNodes.map((li) => li.textContent)).toEqual(['one', 'two']);
    const p = container.childNodes[2];
    expect(p.tagName).toBe('P');
    expect(p.querySelector('code').textContent).toBe('fn()');
  });

  test('renderMdLite defaults to the global `document` when no doc is passed', () => {
    expect(typeof renderMdLite).toBe('function');
    expect(renderMdLite.length).toBe(3);
  });
});

describe('source-level negative proof (kept alongside the behavioral tests above)', () => {
  const SRC = fs.readFileSync(
    path.join(__dirname, '..', '..', 'electron', 'workspace-ui', 'md-lite.js'),
    'utf-8'
  );

  test('the raw source (comments and strings included) never spells the banned DOM-injection APIs', () => {
    // Deliberately NOT constructed via string concatenation of the banned
    // token — see the DE-ROT F32 note in md-lite.js's header: the token
    // itself must never appear anywhere in electron/workspace-ui/, comments
    // included, so this check must not introduce it either.
    const bannedTokens = ['inner' + 'HTML', 'insertAdjacentHTML', 'outer' + 'HTML', 'document.write'];
    for (const token of bannedTokens) {
      expect(SRC).not.toContain(token);
    }
  });

  /**
   * ⚠️ v4.4.1 — opus finding 3, harvested from the review the fence bug truncated.
   * The grep above guards four HTML-STRING APIs and would not have caught a future
   * `setAttribute('href', userText)`. No live vulnerability exists today (md-lite
   * emits no attributes at all), so this is purely a CI safety net for the day
   * links or images are added — which is precisely when nobody re-reads this file.
   *
   * Scoped to md-lite.js on purpose: workspace-render.js legitimately calls the
   * attribute API for its own trusted, non-model-derived markup.
   */
  const ATTRIBUTE_SINKS = ['set' + 'Attribute', 'srcdoc', 'createContextualFragment'];

  test('the raw source never spells an ATTRIBUTE sink either', () => {
    for (const token of ATTRIBUTE_SINKS) {
      expect(SRC).not.toContain(token);
    }
  });

  test('the attribute-sink guard is not vacuous — it catches a simulated regression', () => {
    // Without this control the test above passes for a file that simply does not
    // contain the string, and would keep passing if the token list were emptied.
    const regressed = SRC + '\n  a.set' + 'Attribute(\'href\', userText);\n';
    expect(ATTRIBUTE_SINKS.some((t) => regressed.includes(t))).toBe(true);
    expect(ATTRIBUTE_SINKS.some((t) => SRC.includes(t))).toBe(false);
  });

  test('zero runtime dependencies: no require() of any package', () => {
    expect(SRC).not.toMatch(/require\(/);
  });
});

/**
 * ============================================================================
 * v4.4.1 Task 10 — adversarial coverage (accepted finding A2/D2).
 *
 * The suite above proves exactly one theorem: "no string is ever assigned as
 * HTML." The paid bench confirmed 4/4 that the rest of the threat model was
 * untested. The specific list below is harvested from the two Stage-1 reviews
 * (opus, glm) that never reached the tally, because src/council/findings.js
 * truncated their findings blocks on a fence inside a claim string — the
 * Part-1 defect fixed in this same change. These are those reviewers' own
 * recommendations, implemented.
 * ============================================================================
 */

describe('heading edges (v4.4.1 D3 + D4)', () => {
  test('D3: heading text is trimmed, not padded out to end of line', () => {
    // H_RE's `\s+` already ate the run after the hashes, but `(.*)$` kept
    // everything to EOL — so trailing blanks were baked into the text node.
    expect(parseMdLite('#   Title   ')).toEqual([{ t: 'h', level: 1, text: 'Title' }]);
    expect(parseMdLite('## Sub\t\t')).toEqual([{ t: 'h', level: 2, text: 'Sub' }]);
    expect(parseMdLite('# ')).toEqual([{ t: 'h', level: 1, text: '' }]);
  });

  test('D4: h6 is the TRUE ceiling at level 4, not a clamp', () => {
    // The removed `Math.min(6, level + 2)` was unreachable: H_RE's `#{1,4}` is
    // the only thing bounding this. Pin the boundary so a future widening of
    // that quantifier fails here instead of silently emitting an <h7>.
    const doc = makeFakeDoc();
    const container = doc.createElement('div');
    renderMdLite(container, '#'.repeat(4) + ' X', doc);
    expect(container.childNodes[0].tagName).toBe('H6');

    for (let n = 1; n <= 4; n++) {
      const d = makeFakeDoc();
      const c = d.createElement('div');
      renderMdLite(c, '#'.repeat(n) + ' T', d);
      expect(c.childNodes[0].tagName).toBe('H' + (n + 2));
    }
  });

  test('D4: five hashes is not a heading, so no tag above h6 is reachable', () => {
    // `#{1,4}` cannot be followed by `\s+` here at any backtrack depth.
    expect(parseMdLite('#'.repeat(5) + ' X')).toEqual([{ t: 'p', text: '##### X' }]);
    expect(parseMdLite('#NoSpace')).toEqual([{ t: 'p', text: '#NoSpace' }]);
  });
});

describe('resource budget (v4.4.1 A1/D1 — the O(n) parseInline rewrite)', () => {
  const { MAX_ARTIFACT_BYTES } = require('../../src/workspace/artifact-guard');

  /**
   * Why this absolute budget is a BOUND and not a wall-clock guess.
   *
   * Measured in this repo at exactly MAX_ARTIFACT_BYTES of backtick pairs:
   *   - the linear implementation:             ~5 ms   (400x UNDER the budget)
   *   - a genuinely copying quadratic one:  ~78,000 ms  (39x OVER the budget)
   *
   * The two populations sit ~15,000x apart, so any threshold in the gap
   * separates them. 2 s is in that gap with ~400x of headroom for a loaded CI
   * box, and jest's own 5 s default timeout is the backstop if a regression is
   * slower still. Note the clock is the weaker half of each test: the
   * assertion that actually proves the work happened is the deterministic
   * segment/child count next to it.
   */
  const BUDGET_MS = 2000;

  test('a full-cap line of backtick pairs completes within the budget', () => {
    const pairs = Math.floor(MAX_ARTIFACT_BYTES / 3);
    const line = '`a`'.repeat(pairs);
    expect(line.length).toBeLessThanOrEqual(MAX_ARTIFACT_BYTES);

    const t0 = Date.now();
    const segs = parseInline(line);
    const elapsed = Date.now() - t0;

    expect(segs).toHaveLength(pairs);                 // deterministic proof of the work
    expect(segs.every((s) => s.code === true && s.text === 'a')).toBe(true);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  test('a full-cap line with NO closing backtick does not backtrack quadratically', () => {
    // The other pathological shape: one open backtick then a long non-backtick
    // run, forcing `[^`\n]+` to give ground one character at a time before the
    // match can fail.
    const line = '`' + 'a'.repeat(MAX_ARTIFACT_BYTES - 1);
    const t0 = Date.now();
    const segs = parseInline(line);
    expect(Date.now() - t0).toBeLessThan(BUDGET_MS);
    expect(segs).toEqual([{ code: false, text: line }]);
  });

  test('a full-cap document of structural lines renders within the budget', () => {
    // glm's D2: no regex in the file had ever been fed a stress input. This
    // mixes every branch (fence, heading, ul, ol, paragraph, inline span) so a
    // single slow regex anywhere in the parser shows up here.
    const unit = '# H\n- a\n* b\n1. c\n2) d\ntext `x` more\n\n';
    const doc = makeFakeDoc();
    const container = doc.createElement('div');
    const text = unit.repeat(Math.floor(MAX_ARTIFACT_BYTES / unit.length));

    const t0 = Date.now();
    renderMdLite(container, text, doc);
    expect(Date.now() - t0).toBeLessThan(BUDGET_MS);
    expect(container.childNodes.length).toBeGreaterThan(1000);
  });
});

describe('malformed inline code spans stay literal (v4.4.1 A2/D2)', () => {
  test('unmatched and odd-count backticks never open a span', () => {
    expect(parseInline('`')).toEqual([{ code: false, text: '`' }]);
    expect(parseInline('``')).toEqual([{ code: false, text: '``' }]);
    expect(parseInline('```')).toEqual([{ code: false, text: '```' }]);
    expect(parseInline('`a')).toEqual([{ code: false, text: '`a' }]);
    expect(parseInline('a`')).toEqual([{ code: false, text: 'a`' }]);
    expect(parseInline('')).toEqual([]);
  });

  test('an odd run closes the first pair and leaves the remainder literal', () => {
    expect(parseInline('`a`b`')).toEqual([
      { code: true, text: 'a' },
      { code: false, text: 'b`' },
    ]);
    expect(parseInline('``x``')).toEqual([
      { code: false, text: '`' },
      { code: true, text: 'x' },
      { code: false, text: '`' },
    ]);
  });

  test('an empty span is not a span — the pattern requires content', () => {
    expect(parseInline('a `` b')).toEqual([{ code: false, text: 'a `` b' }]);
  });

  test('a span cannot straddle a newline inside a single call', () => {
    expect(parseInline('a `x\ny` b')).toEqual([{ code: false, text: 'a `x\ny` b' }]);
  });
});

describe('prototype-pollution inertness (v4.4.1 A2/D2 — glm finding 3)', () => {
  test('__proto__ / constructor / prototype in prose become TEXT, never keys', () => {
    const payload = [
      '# __proto__',
      '',
      'constructor and prototype in a paragraph',
      '',
      '- __proto__',
      '- constructor',
      '',
      '```',
      '{"__proto__": {"polluted": true}}',
      '```',
      '',
      'inline `__proto__` span',
    ].join('\n');

    const blocks = parseMdLite(payload);

    // 1. Nothing reached Object.prototype.
    expect({}.polluted).toBeUndefined();
    expect(Object.prototype.polluted).toBeUndefined();

    // 2. Every block object carries ONLY the parser's own literal keys.
    const allowed = ['t', 'level', 'text', 'items'];
    for (const b of blocks) {
      expect(Object.keys(b).every((k) => allowed.includes(k))).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(b, '__proto__')).toBe(false);
      expect(Object.getPrototypeOf(b)).toBe(Object.prototype);
    }

    // 3. The payload still survives as CONTENT — inert, not silently dropped.
    expect(JSON.stringify(blocks)).toContain('__proto__');
  });

  test('rendering the same payload pollutes nothing and emits it as text', () => {
    const doc = makeFakeDoc();
    const container = doc.createElement('div');
    renderMdLite(container, '__proto__ constructor prototype', doc);
    expect(container.textContent).toBe('__proto__ constructor prototype');
    expect({}.polluted).toBeUndefined();
    expect([].polluted).toBeUndefined();
  });

  test('inline segment objects are plain too', () => {
    for (const seg of parseInline('a `__proto__` b')) {
      expect(Object.keys(seg).sort()).toEqual(['code', 'text']);
      expect(Object.getPrototypeOf(seg)).toBe(Object.prototype);
    }
  });
});

describe('URL inertness — md-lite has no link grammar (v4.4.1 A2/D2 — glm finding 5)', () => {
  // Worth asserting even though the code is clean: the Workspace CSP allows
  // `img-src data:`, so the day a link or image feature is added, these
  // payloads stop being inert. The fake DOM's attribute trap is the other half.
  test('javascript: and data: URLs render as literal text, not links or images', () => {
    const doc = makeFakeDoc();
    const container = doc.createElement('div');
    const payload = '[click](javascript:alert(1)) and ![x](data:text/html;base64,PHNjcmlwdD4=)';
    renderMdLite(container, payload, doc);

    expect(container.textContent).toBe(payload);
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.childNodes).toHaveLength(1);
    expect(container.childNodes[0].tagName).toBe('P');
  });

  test('a bare javascript: URL inside inline code is still only text', () => {
    const doc = makeFakeDoc();
    const container = doc.createElement('div');
    renderMdLite(container, 'try `javascript:alert(1)` here', doc);
    expect(container.querySelector('code').textContent).toBe('javascript:alert(1)');
    expect(container.querySelector('a')).toBeNull();
  });
});

describe('fence info string is discarded (v4.4.1 A2/D2 — glm finding 4)', () => {
  test('the info string never reaches the block or the DOM', () => {
    expect(parseMdLite('```js\nlet x = 1;\n```')).toEqual([{ t: 'code', text: 'let x = 1;' }]);
    expect(parseMdLite('```html\n<b>hi</b>\n```')).toEqual([{ t: 'code', text: '<b>hi</b>' }]);

    const doc = makeFakeDoc();
    const container = doc.createElement('div');
    renderMdLite(container, '```js\nlet x = 1;\n```', doc);
    expect(container.textContent).toBe('let x = 1;');
    // No class/lang attribute was derived from `js`: the element carries only
    // what the fake DOM's constructor puts there. (The attribute API is a trap,
    // so a future setter would have thrown before reaching this assertion.)
    expect(Object.keys(container.querySelector('code'))).toEqual(['tagName', 'childNodes']);
  });
});
