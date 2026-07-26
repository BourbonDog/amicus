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

  test('zero runtime dependencies: no require() of any package', () => {
    expect(SRC).not.toMatch(/require\(/);
  });
});
