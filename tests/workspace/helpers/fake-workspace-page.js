'use strict';

/**
 * Shared headless fake DOM for electron/workspace-ui/*.js tests (Task 13 note: "reuse
 * that harness for anything you test here" — this factors the workspace-render.test.js
 * inline copy out and extends it with the extra surface Task 13's files need: a
 * getElementById-addressable page skeleton that mirrors index.html's id/parent
 * relationships (renderGauge reads fillEl.parentElement), a minimal querySelector(All)
 * that understands `#id`, `tag[data-x]` and `tag[data-x="v"]`, mutable text nodes with
 * splitText/parentNode (highlightText's DOM-safe <mark> wrap needs a real TreeWalker),
 * and a fake `document.createTreeWalker` + global `NodeFilter`.
 *
 * innerHTML / outerHTML / insertAdjacentHTML stay THROWING TRAPS (H9 hard rule) — any
 * painter that reaches for one instead of textContent/createTextNode/setAttribute fails
 * loud here, same contract as workspace-render.test.js's harness.
 */

function throwTrap(prop) {
  return function trap() {
    throw new Error('workspace-ui must never touch ' + prop);
  };
}

function toCamel(dashed) {
  return dashed.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); });
}

function makeTextNode(data) {
  var node = {
    data: String(data),
    parentNode: null,
    splitText: function (index) {
      var after = makeTextNode(node.data.slice(index));
      node.data = node.data.slice(0, index);
      var parent = node.parentNode;
      if (parent) {
        var idx = parent.childNodes.indexOf(node);
        parent.childNodes.splice(idx + 1, 0, after);
        after.parentNode = parent;
      }
      return after;
    },
  };
  Object.defineProperty(node, 'nodeValue', {
    get: function () { return node.data; },
    set: function (v) { node.data = String(v); },
  });
  return node;
}

function isTextNode(n) { return !!n && typeof n.data === 'string' && typeof n.splitText === 'function'; }

function makeFakeDom() {
  function FakeElement(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.childNodes = [];
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.parentElement = null;
    this.parentNode = null;
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
    get: function () { return this._classes.join(' '); },
    set: function (value) { this._classes = String(value).split(/\s+/).filter(Boolean); },
  });
  Object.defineProperty(FakeElement.prototype, 'children', {
    get: function () { return this.childNodes.filter(function (n) { return n instanceof FakeElement; }); },
  });
  Object.defineProperty(FakeElement.prototype, 'textContent', {
    get: function () {
      return this.childNodes.map(function (n) { return n instanceof FakeElement ? n.textContent : n.data; }).join('');
    },
    set: function (value) {
      this.childNodes = [];
      if (value) { this.childNodes.push(makeTextNode(value)); }
    },
  });
  ['innerHTML', 'outerHTML'].forEach(function (prop) {
    Object.defineProperty(FakeElement.prototype, prop, { get: throwTrap(prop), set: throwTrap(prop) });
  });
  FakeElement.prototype.insertAdjacentHTML = throwTrap('insertAdjacentHTML');

  FakeElement.prototype.appendChild = function (node) {
    this.childNodes.push(node);
    if (node instanceof FakeElement) { node.parentElement = this; node.parentNode = this; }
    else if (isTextNode(node)) { node.parentNode = this; }
    return node;
  };
  FakeElement.prototype.insertBefore = function (node, ref) {
    var idx = ref ? this.childNodes.indexOf(ref) : -1;
    if (idx === -1) { return this.appendChild(node); }
    this.childNodes.splice(idx, 0, node);
    if (node instanceof FakeElement) { node.parentElement = this; node.parentNode = this; }
    else if (isTextNode(node)) { node.parentNode = this; }
    return node;
  };
  FakeElement.prototype.replaceChild = function (newNode, oldNode) {
    var idx = this.childNodes.indexOf(oldNode);
    if (idx !== -1) {
      this.childNodes[idx] = newNode;
      if (newNode instanceof FakeElement) { newNode.parentElement = this; newNode.parentNode = this; }
      else if (isTextNode(newNode)) { newNode.parentNode = this; }
    }
    return oldNode;
  };
  FakeElement.prototype.setAttribute = function (name, value) { this.attributes[name] = String(value); };
  FakeElement.prototype.addEventListener = function (type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  };
  FakeElement.prototype.remove = function () {
    if (this.parentElement) {
      var idx = this.parentElement.childNodes.indexOf(this);
      if (idx !== -1) { this.parentElement.childNodes.splice(idx, 1); }
      this.parentElement = null;
      this.parentNode = null;
    }
  };
  // v4.4.1 M1: highlightText() now calls container.normalize() before scanning, to undo the
  // un-merged fragmentation clearHighlight() leaves behind (it unwraps <mark> but never
  // normalizes). Real DOM semantics: merge every run of adjacent Text-node siblings into one,
  // dropping any that end up empty, recursively through the whole subtree.
  FakeElement.prototype.normalize = function () {
    var merged = [];
    this.childNodes.forEach(function (node) {
      if (isTextNode(node)) {
        if (node.data === '') { node.parentNode = null; return; } // dropped, matches real normalize()
        var prev = merged[merged.length - 1];
        if (prev && isTextNode(prev)) {
          prev.data += node.data;
          node.parentNode = null;
          return;
        }
      }
      merged.push(node);
    });
    this.childNodes = merged;
    this.childNodes.forEach(function (node) {
      if (node instanceof FakeElement) { node.normalize(); }
    });
  };
  FakeElement.prototype.scrollIntoView = function () { /* no-op: jsdom-free harness */ };
  // Task 16: openAbortDialog() focuses the dialog's Cancel button (so Esc/Enter both
  // behave). A no-op-with-a-trace-flag is enough for tests to assert focus WAS requested
  // without pulling in real focus-management semantics this headless harness has no use for.
  FakeElement.prototype.focus = function () { this._focused = true; };

  function matchOne(selector, el) {
    var idMatch = /^#([\w-]+)$/.exec(selector);
    if (idMatch) { return el.attributes.id === idMatch[1]; }
    var classMatch = /^\.([\w-]+)$/.exec(selector);
    if (classMatch) { return el.classList.contains(classMatch[1]); }
    var attrMatch = /^([a-zA-Z]*)\[data-([\w-]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (attrMatch) {
      var tagOk = !attrMatch[1] || el.tagName === attrMatch[1].toUpperCase();
      var key = toCamel(attrMatch[2]);
      var hasAttr = Object.prototype.hasOwnProperty.call(el.dataset, key);
      var valueOk = attrMatch[3] === undefined || el.dataset[key] === attrMatch[3];
      return tagOk && hasAttr && valueOk;
    }
    return el.tagName === selector.toUpperCase();
  }

  FakeElement.prototype.querySelectorAll = function (selector) {
    var sel = String(selector).trim();
    var out = [];
    (function walk(node) {
      node.childNodes.forEach(function (child) {
        if (!(child instanceof FakeElement)) { return; }
        if (matchOne(sel, child)) { out.push(child); }
        walk(child);
      });
    })(this);
    return out;
  };
  FakeElement.prototype.querySelector = function (selector) {
    var all = this.querySelectorAll(selector);
    return all.length ? all[0] : null;
  };

  // Real root of the fake page: getElementById/querySelector search this whole connected
  // tree, not a flat id->element registry — a node created dynamically at runtime (e.g. the
  // Fold button `el()` builds and appends into #verdict-body) must be just as findable as
  // one mounted below at page-build time. That mirrors real `document.getElementById`,
  // which only ever sees nodes actually attached to the document.
  var root = new FakeElement('root');

  var document = {
    createElement: function (tag) { return new FakeElement(tag); },
    createTextNode: function (text) { return makeTextNode(text); },
    getElementById: function (id) { return root.querySelector('#' + id); },
    createTreeWalker: function (treeRoot /* , whatToShow */) {
      var nodes = [];
      (function collect(node) {
        node.childNodes.forEach(function (child) {
          if (isTextNode(child)) { nodes.push(child); }
          else if (child instanceof FakeElement) { collect(child); }
        });
      })(treeRoot);
      var i = -1;
      return {
        get currentNode() { return nodes[i]; },
        nextNode: function () { i += 1; return i < nodes.length ? nodes[i] : null; },
      };
    },
    // Task 16: workspace-app.js's Escape-to-dismiss handler registers here at load time.
    // Captured (not a no-op) so a test can dispatch it directly — same convention as a
    // FakeElement's `_listeners.click[0]()` — instead of needing real DOM event dispatch.
    _listeners: {},
    addEventListener: function (type, fn) {
      (this._listeners[type] = this._listeners[type] || []).push(fn);
    },
    write: throwTrap('document.write'),
  };

  /** Build one element and append it to `parent` (or the page root when omitted). */
  function mount(id, tag, parent) {
    var node = new FakeElement(tag);
    node.setAttribute('id', id);
    (parent || root).appendChild(node);
    return node;
  }

  // ---- page skeleton — mirrors index.html's id/parent relationships closely enough for
  // every painter this test suite exercises (renderGauge needs fillEl.parentElement; the
  // <details> panels need to exist so wireLazyPanels/proseLoader can address them). Every
  // node here (and anything a painter appends under it later, e.g. the Fold button) is
  // connected to `root`, so document.getElementById/querySelector finds it. ----
  mount('run-list', 'ul');
  mount('empty-state', 'div');
  var runView = mount('run-view', 'div');
  mount('run-title', 'h1', runView);
  mount('run-chips', 'div', runView);
  var gauge = mount('cost-gauge', 'div', runView);
  mount('cost-gauge-fill', 'div', gauge);
  mount('cost-gauge-text', 'span', gauge);
  mount('blind-toggle', 'input', runView);
  mount('abort-btn', 'button', runView);
  mount('banner', 'div', runView);
  mount('stage-rail', 'nav', runView);
  var seatsPanel = mount('seats-panel', 'section', runView);
  mount('seats-body', 'tbody', seatsPanel);
  var reviewsPanel = mount('reviews-panel', 'details', runView);
  mount('reviews-body', 'div', reviewsPanel);
  var bundlePanel = mount('bundle-panel', 'details', runView);
  mount('bundle-body', 'div', bundlePanel);
  var judgesPanel = mount('judges-panel', 'details', runView);
  mount('judges-body', 'div', judgesPanel);
  var matrixPanel = mount('matrix-panel', 'section', runView);
  mount('matrix-body', 'div', matrixPanel);
  var verdictPanel = mount('verdict-panel', 'section', runView);
  mount('verdict-body', 'div', verdictPanel);
  var costPanel = mount('cost-panel', 'section', runView);
  mount('cost-body', 'div', costPanel);
  var dialogAbort = mount('dialog-abort', 'div');
  mount('dialog-abort-confirm', 'button', dialogAbort);
  mount('dialog-abort-cancel', 'button', dialogAbort);

  var win = {
    document: document,
    location: { search: '' },
    amicusWorkspace: { invoke: function () { return Promise.resolve(null); } },
    addEventListener: function () { /* focus listener: not dispatched in this harness */ },
  };

  return { window: win, document: document, NodeFilter: { SHOW_TEXT: 4 } };
}

module.exports = { makeFakeDom, isTextNode };
