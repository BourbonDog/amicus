/**
 * Export kinds for the module table: is an export a function, a value, or
 * unknown?
 *
 * The table writes `name()` for a function and `name` for a value. Every
 * export used to get `()`, so string constants read as functions (council
 * finding A3 on PR 289). Each module is parsed with espree and read, never
 * run. Only a PROVEN value drops the parens; 'unknown' keeps the old `name()`.
 *
 * Only top-level statements bind a name, so comments, strings and nested
 * scopes cannot decide one (council A2/C2 on PR 291).
 */

const fs = require('node:fs');
const path = require('node:path');
const espree = require('espree');

const PARSE_OPTIONS = { ecmaVersion: 'latest', ecmaFeatures: { globalReturn: true } };

// Builtins whose `new` result is never callable. `new Function`, `new Proxy`
// and a local class can all yield a callable (council B1/C1 on PR 291).
const PLAIN_CONSTRUCTORS = new Set([
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Date', 'RegExp', 'URL', 'URLSearchParams',
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'AggregateError',
]);
// Global calls whose result is never a function.
const VALUE_CALLS = new Set(['Symbol', 'Number', 'String', 'Boolean', 'Object.create', 'Object.fromEntries']);
const VALUE_GLOBALS = new Set(['undefined', 'NaN', 'Infinity']);

/** Call `fn` on every node under `root` (a node or an array of nodes). */
function forEachNode(root, fn) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (Array.isArray(node)) { stack.push(...node); continue; }
    if (!node || typeof node.type !== 'string') { continue; }
    fn(node);
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') { stack.push(value); }
    }
  }
}

const isModuleExports = (n) => n.type === 'MemberExpression' && !n.computed
  && n.object.type === 'Identifier' && n.object.name === 'module' && n.property.name === 'exports';

/** NAME for an `exports.NAME` or `module.exports.NAME` target, else null. */
function exportName(n) {
  if (n.type !== 'MemberExpression' || n.computed) { return null; }
  const onExports = (n.object.type === 'Identifier' && n.object.name === 'exports') || isModuleExports(n.object);
  return onExports ? n.property.name : null;
}

/**
 * Parse `file` once per run. Keeps its top-level statements and every
 * assignment that can change an export or rebind a name. Null when the file
 * cannot be read or parsed, and then nothing in it is proven.
 */
function readModule(file, ctx) {
  if (!ctx.modules.has(file)) {
    let mod = null;
    try {
      const { body } = espree.parse(fs.readFileSync(file, 'utf-8'), PARSE_OPTIONS);
      mod = { file, body, objects: [], assigns: new Map(), reassigned: new Set() };
      const top = new Set(body.filter((s) => s.type === 'ExpressionStatement').map((s) => s.expression));
      forEachNode(body, (node) => {
        if (node.type !== 'AssignmentExpression') { return; }
        const site = { right: node.right, top: top.has(node) && node.operator === '=' };
        const name = exportName(node.left);
        if (isModuleExports(node.left)) {
          mod.objects.push(site);
        } else if (name) {
          if (!mod.assigns.has(name)) { mod.assigns.set(name, []); }
          mod.assigns.get(name).push(site);
        } else if (node.left.type === 'Identifier') {
          mod.reassigned.add(node.left.name);
        }
      });
    } catch { /* unreadable or unparsable */ }
    ctx.modules.set(file, mod);
  }
  return ctx.modules.get(file);
}

/** Whether a declaration pattern binds `name`. */
function bindsName(pattern, name) {
  switch (pattern.type) {
    case 'Identifier': return pattern.name === name;
    case 'ObjectPattern': return pattern.properties.some((p) => bindsName(p.type === 'RestElement' ? p.argument : p.value, name));
    case 'ArrayPattern': return pattern.elements.some((e) => e && bindsName(e, name));
    case 'AssignmentPattern': return bindsName(pattern.left, name);
    case 'RestElement': return bindsName(pattern.argument, name);
    default: return false;
  }
}

/** The top-level function, class or variable declarator that binds `name`, or null. */
function declarationOf(mod, name) {
  for (const s of mod.body) {
    if ((s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration') && s.id.name === name) { return s; }
    if (s.type === 'VariableDeclaration') {
      const d = s.declarations.find((decl) => bindsName(decl.id, name));
      if (d) { return d; }
    }
  }
  return null;
}

/** The specifier of `require('<string>')`, else null. */
function requireSpec(n) {
  const isRequire = n && n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'require'
    && n.arguments.length === 1 && n.arguments[0].type === 'Literal';
  return isRequire && typeof n.arguments[0].value === 'string' ? n.arguments[0].value : null;
}

/** Resolve a relative require specifier the way Node would, or null. */
function resolveRelative(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  const hit = [base, `${base}.js`, path.join(base, 'index.js')].find((p) => {
    try { return fs.statSync(p).isFile(); } catch { return false; }
  });
  return hit || null;
}

/** Export `name` of the module a relative `spec` names, or 'unknown' for a package. */
function viaRequire(file, spec, name, ctx) {
  const target = spec.startsWith('.') ? resolveRelative(file, spec) : null;
  return target ? exportKind(target, name, ctx) : 'unknown';
}

/** What top-level `name` is bound to, following aliases and relative re-exports. */
function bindingKind(mod, name, ctx) {
  const key = `${mod.file}#${name}`;
  if (ctx.seen.has(key) || mod.reassigned.has(name)) { return 'unknown'; }
  ctx.seen.add(key);
  const decl = declarationOf(mod, name);
  if (!decl) { return 'unknown'; }
  if (decl.type !== 'VariableDeclarator') { return 'function'; }
  if (decl.id.type === 'Identifier') { return decl.init ? kindOf(mod, decl.init, ctx) : 'unknown'; }
  // const { imported: name } = require('./x')
  const spec = requireSpec(decl.init);
  const prop = decl.id.type === 'ObjectPattern' && decl.id.properties.find((p) => p.type === 'Property'
    && !p.computed && p.key.type === 'Identifier' && p.value.type === 'Identifier' && p.value.name === name);
  return spec !== null && prop ? viaRequire(mod.file, spec, prop.key.name, ctx) : 'unknown';
}

/** 'Number' or 'Object.freeze' for a callee whose root is not rebound in this module, else null. */
function globalName(mod, callee) {
  const root = callee.type === 'MemberExpression' ? callee.object : callee;
  if (root.type !== 'Identifier' || declarationOf(mod, root.name)) { return null; }
  if (callee === root) { return root.name; }
  return callee.computed ? null : `${root.name}.${callee.property.name}`;
}

/** `require('./x').NAME`, or `ns.NAME` where `const ns = require('./x')`: the re-exported NAME. */
function memberKind(mod, node, ctx) {
  if (node.computed) { return 'unknown'; }
  let spec = requireSpec(node.object);
  if (spec === null && node.object.type === 'Identifier' && !mod.reassigned.has(node.object.name)) {
    const decl = declarationOf(mod, node.object.name);
    spec = decl && decl.type === 'VariableDeclarator' && decl.id.type === 'Identifier' ? requireSpec(decl.init) : null;
  }
  return spec === null ? 'unknown' : viaRequire(mod.file, spec, node.property.name, ctx);
}

const same = (a, b) => (a === b ? a : 'unknown');

/** 'function' | 'value' | 'unknown' for an expression node. */
function kindOf(mod, node, ctx) {
  switch (node.type) {
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
    case 'ClassExpression':
      return 'function';
    // Literals, and operators whose result is never a function.
    case 'Literal':
    case 'TemplateLiteral':
    case 'ObjectExpression':
    case 'ArrayExpression':
    case 'UnaryExpression':
    case 'BinaryExpression':
    case 'UpdateExpression':
      return 'value';
    case 'LogicalExpression':
      return same(kindOf(mod, node.left, ctx), kindOf(mod, node.right, ctx));
    case 'ConditionalExpression':
      return same(kindOf(mod, node.consequent, ctx), kindOf(mod, node.alternate, ctx));
    case 'Identifier':
      return VALUE_GLOBALS.has(globalName(mod, node)) ? 'value' : bindingKind(mod, node.name, ctx);
    case 'NewExpression':
      return PLAIN_CONSTRUCTORS.has(globalName(mod, node.callee)) ? 'value' : 'unknown';
    case 'CallExpression': {
      // [...].join(...) always returns a string (how council/briefings*.js builds prompt text).
      const c = node.callee;
      if (c.type === 'MemberExpression' && !c.computed && c.object.type === 'ArrayExpression' && c.property.name === 'join') {
        return 'value';
      }
      const callee = globalName(mod, c);
      // Object.freeze returns its argument, so it keeps that argument's kind.
      if (callee === 'Object.freeze') { return node.arguments.length ? kindOf(mod, node.arguments[0], ctx) : 'unknown'; }
      return VALUE_CALLS.has(callee) ? 'value' : 'unknown';
    }
    case 'MemberExpression':
      return memberKind(mod, node, ctx);
    default:
      return 'unknown';
  }
}

/**
 * The property of object literal `obj` that supplies `name`. Null when none
 * does; undefined when a spread, a computed key, a getter or a setter might.
 */
function propertyOf(obj, name) {
  let found = null;
  for (const p of obj.properties) {
    if (p.type === 'SpreadElement' || p.computed) { found = undefined; continue; }
    const key = p.key.type === 'Identifier' ? p.key.name : String(p.key.value);
    if (key === name) { found = p.kind === 'init' ? p : undefined; }
  }
  return found;
}

/**
 * Whether export `name` of `file` is a function, a value, or unknown.
 * @param {string} file - Absolute path to a CommonJS module
 * @param {string} name - Export name
 * @param {{modules: Map, seen: Set}} ctx - Modules parsed in this run, and this walk's visited set
 * @returns {'function'|'value'|'unknown'}
 */
function exportKind(file, name, ctx) {
  // Every walk passes through here, so this guard ends every re-export cycle
  // (council A1 on PR 291).
  const key = `${file}@${name}`;
  if (ctx.seen.has(key)) { return 'unknown'; }
  ctx.seen.add(key);
  const mod = readModule(file, ctx);
  if (!mod || mod.objects.length > 1) { return 'unknown'; }
  const sites = mod.assigns.get(name) || [];
  const object = mod.objects[0];
  if (object && !object.top) { return 'unknown'; }
  if (object && object.right.type === 'ObjectExpression') {
    const prop = propertyOf(object.right, name);
    if (prop === undefined || (prop && sites.length)) { return 'unknown'; }
    if (prop) { return prop.method ? 'function' : kindOf(mod, prop.value, ctx); }
  }
  // exports.NAME = ..., assigned exactly once and at the top level
  return sites.length === 1 && sites[0].top ? kindOf(mod, sites[0].right, ctx) : 'unknown';
}

module.exports = { exportKind };
