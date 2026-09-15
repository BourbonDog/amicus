'use strict';

/**
 * A minimal DOM for exercising the wizard's INLINE page scripts under jest's
 * `node` environment (there is no jsdom in this repo — R-P3-9). Supports
 * exactly what electron/setup-ui-alias-*.js use: createElement, append /
 * insertBefore / remove / replaceWith, closest / querySelector(All) over
 * simple selectors (`tag`, `#id`, `.cls`, `[attr]`, `[attr="v"]`, `:not(.cls)`,
 * compound and descendant combinations), classList, get/set/hasAttribute,
 * addEventListener + a bubbling `dispatch`, `hidden`, `open`, `disabled`,
 * `value`, `textContent` (leaf text only — never composed from children).
 */

function parseCompound(sel) {
  const out = { tag: null, id: null, classes: [], attrs: [], not: [] };
  const re = /^([a-z]+)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]|:not\(\.([\w-]+)\)/g;
  let m;
  let consumed = 0;
  while ((m = re.exec(sel)) !== null) {
    // A gap means `re` skipped over something it doesn't support (`>`,
    // `:first-child`, a single-quoted attribute value, ...) -- silently
    // treating that as a wildcard is worse than a loud, named failure.
    if (m.index !== consumed) { throw new Error('fake-dom: unsupported selector: ' + sel); }
    consumed = re.lastIndex;
    if (m[1]) { out.tag = m[1].toUpperCase(); }
    else if (m[2]) { out.id = m[2]; }
    else if (m[3]) { out.classes.push(m[3]); }
    else if (m[4]) { out.attrs.push([m[4], m[5]]); }
    else if (m[6]) { out.not.push(m[6]); }
  }
  if (consumed !== sel.length) { throw new Error('fake-dom: unsupported selector: ' + sel); }
  return out;
}

function matchesCompound(el, c) {
  if (!el || !el.tagName) { return false; }
  if (c.tag && el.tagName !== c.tag) { return false; }
  if (c.id && el.getAttribute('id') !== c.id) { return false; }
  if (c.classes.some(k => !el.classList.contains(k))) { return false; }
  if (c.not.some(k => el.classList.contains(k))) { return false; }
  return c.attrs.every(([name, value]) => (value === undefined ? el.hasAttribute(name) : el.getAttribute(name) === value));
}

/** Descendant combinator only (`a b c`), matched right-to-left like a browser. */
function matches(el, selector) {
  const parts = selector.trim().split(/\s+/).map(parseCompound);
  if (!matchesCompound(el, parts[parts.length - 1])) { return false; }
  let node = el.parentNode;
  for (let i = parts.length - 2; i >= 0; i--) {
    while (node && !matchesCompound(node, parts[i])) { node = node.parentNode; }
    if (!node) { return false; }
    node = node.parentNode;
  }
  return true;
}

function walk(node, visit) {
  for (const child of node.children) { visit(child); walk(child, visit); }
}

class FakeElement {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = doc;
    this.children = [];
    this.parentNode = null;
    this.attributes = Object.create(null);
    this.listeners = Object.create(null);
    this.style = {};
    this.textContent = '';
    this.value = '';
    this.label = '';
    this.title = '';
    this.type = '';
    this.hidden = false;
    this.open = false;
    this.disabled = false;
    this.selected = false;
    const classes = new Set();
    this.classList = {
      add: (...ks) => ks.forEach(k => classes.add(k)),
      remove: (...ks) => ks.forEach(k => classes.delete(k)),
      contains: (k) => classes.has(k),
      toggle: (k, force) => { const on = force === undefined ? !classes.has(k) : !!force; if (on) { classes.add(k); } else { classes.delete(k); } return on; },
    };
    Object.defineProperty(this, 'className', {
      get: () => [...classes].join(' '),
      set: (v) => { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach(k => classes.add(k)); },
    });
  }
  get firstChild() { return this.children[0] || null; }
  get id() { return this.attributes.id || ''; }
  set id(v) { this.attributes.id = String(v); }
  get options() { return this.querySelectorAll('option'); }
  appendChild(child) { if (child.parentNode) { child.remove(); } child.parentNode = this; this.children.push(child); return child; }
  insertBefore(child, ref) {
    if (ref && this.children.indexOf(ref) === -1) { throw new Error('fake-dom: insertBefore ref is not a child'); }
    if (child.parentNode) { child.remove(); }
    child.parentNode = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i === -1) { this.children.push(child); } else { this.children.splice(i, 0, child); }
    return child;
  }
  remove() { if (!this.parentNode) { return; } const i = this.parentNode.children.indexOf(this); if (i !== -1) { this.parentNode.children.splice(i, 1); } this.parentNode = null; }
  replaceWith(other) { const p = this.parentNode; if (!p) { return; } p.insertBefore(other, this); this.remove(); }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'id') { /* kept in attributes */ } }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name); }
  closest(selector) { let n = this; while (n && n.tagName) { if (matches(n, selector)) { return n; } n = n.parentNode; } return null; }
  querySelectorAll(selector) { const out = []; walk(this, n => { if (matches(n, selector)) { out.push(n); } }); return out; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  /** Bubble `type` from this element to the document; the event carries `target` and `closest`-capable `target`. */
  dispatch(type, init = {}) {
    const event = { type, target: this, ...init };
    // The propagation path is frozen BEFORE any listener runs (as a real
    // browser computes it), so a listener that detaches an ancestor
    // (e.g. `row.remove()`) mid-bubble cannot strand the event before it
    // reaches `document`.
    const path = [];
    let n = this;
    while (n) { path.push(n); n = n.parentNode || (n === this.ownerDocument.body ? this.ownerDocument : null); }
    path.forEach(node => (node.listeners[type] || []).slice().forEach(fn => fn(event)));
    return event;
  }
  click() { return this.dispatch('click'); }
  focus() {}
  blur() {}
}

/** @returns {{document: object, body: FakeElement}} */
function createFakeDocument() {
  const document = {
    listeners: Object.create(null),
    createElement: (tag) => new FakeElement(tag, document),
    getElementById: (id) => document.body.querySelector(`#${id}`),
    querySelector: (sel) => document.body.querySelector(sel),
    querySelectorAll: (sel) => document.body.querySelectorAll(sel),
    addEventListener: (type, fn) => { (document.listeners[type] = document.listeners[type] || []).push(fn); },
  };
  document.body = new FakeElement('body', document);
  document.body.parentNode = null;
  document.tagName = undefined;              // `closest` stops at the document
  document.parentNode = null;
  return { document, body: document.body };
}

module.exports = { createFakeDocument, FakeElement };
