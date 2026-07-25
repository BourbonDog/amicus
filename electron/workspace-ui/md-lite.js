/**
 * markdown-lite — dependency-free renderer for untrusted model prose
 * (v4.4 §4.2, resolved Q7). Supported: #–#### headings, - / * bullets,
 * numbered items, ``` fences, `inline code`, paragraphs. EVERY string lands
 * in the DOM via textContent / createTextNode — no HTML-string injection, no
 * HTML passthrough, no links. (⚠️ DE-ROT F32: wording avoids the banned token —
 * see the note above the block.) The parser is pure (node-tested); the applier takes
 * an explicit document. Loaded as a plain script (window.AmicusMd) and as a
 * CommonJS module (jest).
 */
(function () {
  'use strict';

  var H_RE = /^(#{1,4})\s+(.*)$/;
  var UL_RE = /^\s*[-*]\s+/;
  var OL_RE = /^\s*\d+[.)]\s+/;

  function parseInline(text) {
    var out = [];
    var rest = String(text);
    while (rest.length) {
      var m = /`([^`\n]+)`/.exec(rest);
      if (!m) { out.push({ code: false, text: rest }); break; }
      if (m.index > 0) { out.push({ code: false, text: rest.slice(0, m.index) }); }
      out.push({ code: true, text: m[1] });
      rest = rest.slice(m.index + m[0].length);
    }
    return out;
  }

  function parseMdLite(text) {
    var lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    var blocks = [];
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      if (/^```/.test(line)) {
        var buf = [];
        i += 1;
        while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i += 1; }
        i += 1; // closing fence (or EOF)
        blocks.push({ t: 'code', text: buf.join('\n') });
        continue;
      }
      var h = H_RE.exec(line);
      if (h) { blocks.push({ t: 'h', level: h[1].length, text: h[2] }); i += 1; continue; }
      if (UL_RE.test(line)) {
        var ul = [];
        while (i < lines.length && UL_RE.test(lines[i])) { ul.push(lines[i].replace(UL_RE, '')); i += 1; }
        blocks.push({ t: 'ul', items: ul });
        continue;
      }
      if (OL_RE.test(line)) {
        var ol = [];
        while (i < lines.length && OL_RE.test(lines[i])) { ol.push(lines[i].replace(OL_RE, '')); i += 1; }
        blocks.push({ t: 'ol', items: ol });
        continue;
      }
      if (!line.trim()) { i += 1; continue; }
      var p = [line];
      i += 1;
      while (i < lines.length && lines[i].trim() &&
             !/^```/.test(lines[i]) && !H_RE.test(lines[i]) &&
             !UL_RE.test(lines[i]) && !OL_RE.test(lines[i])) {
        p.push(lines[i]);
        i += 1;
      }
      blocks.push({ t: 'p', text: p.join(' ') });
    }
    return blocks;
  }

  function applyInline(el, segs, doc) {
    for (var i = 0; i < segs.length; i++) {
      if (segs[i].code) {
        var c = doc.createElement('code');
        c.textContent = segs[i].text;
        el.appendChild(c);
      } else {
        el.appendChild(doc.createTextNode(segs[i].text));
      }
    }
  }

  /** Render prose into container. Panels use h3–h6 so page structure wins. */
  function renderMdLite(container, text, doc) {
    var d = doc || document;
    container.textContent = '';
    var blocks = parseMdLite(text);
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      var el;
      if (b.t === 'h') {
        el = d.createElement('h' + Math.min(6, b.level + 2));
        applyInline(el, parseInline(b.text), d);
      } else if (b.t === 'code') {
        el = d.createElement('pre');
        var code = d.createElement('code');
        code.textContent = b.text;
        el.appendChild(code);
      } else if (b.t === 'ul' || b.t === 'ol') {
        el = d.createElement(b.t);
        for (var j = 0; j < b.items.length; j++) {
          var li = d.createElement('li');
          applyInline(li, parseInline(b.items[j]), d);
          el.appendChild(li);
        }
      } else {
        el = d.createElement('p');
        applyInline(el, parseInline(b.text), d);
      }
      container.appendChild(el);
    }
  }

  var api = { parseMdLite: parseMdLite, parseInline: parseInline, renderMdLite: renderMdLite };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (typeof window !== 'undefined') { window.AmicusMd = api; }
})();
