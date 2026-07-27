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

  /**
   * Split one line into literal / inline-code segments in a SINGLE linear pass.
   *
   * ⚠️ v4.4.1 A1/D1 (Confirmed 4/4). The previous form re-`exec`ed a freshly
   * sliced `rest` string each iteration and advanced with
   * `rest = rest.slice(...)` — quadratic by construction in both time and
   * transient allocation, on a string parseMdLite has already coalesced from
   * every consecutive prose line (`p.join(' ')`) and which artifact-guard.js
   * caps at only 200 KB. A `lastIndex` cursor walks the ORIGINAL string once
   * and never copies a tail, so total work is linear in input length no matter
   * how many spans the line holds.
   *
   * Output is identical to the old function for every input: the pattern is
   * context-free — no `^`, `\b`, lookaround or backreference — so a /g scan
   * resuming at `lastIndex` lands on exactly the same match positions that
   * re-`exec`ing the remainder did. The three boundary cases match too: no
   * match at all yields one literal segment, a trailing match yields no empty
   * tail segment, and empty input yields [].
   *
   * The regex is constructed per call and deliberately NOT hoisted to module
   * scope: a /g regex carries mutable `lastIndex`, so one shared instance would
   * leak cursor state between calls and silently drop spans.
   */
  function parseInline(text) {
    var out = [];
    var s = String(text);
    var re = /`([^`\n]+)`/g;
    var pos = 0;
    var m;
    while ((m = re.exec(s)) !== null) {
      if (m.index > pos) { out.push({ code: false, text: s.slice(pos, m.index) }); }
      out.push({ code: true, text: m[1] });
      pos = re.lastIndex;
    }
    if (pos < s.length) { out.push({ code: false, text: s.slice(pos) }); }
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
      // ⚠️ v4.4.1 D3: trim the heading text. H_RE's `\s+` eats the run of
      // whitespace after the hashes, but `(.*)$` keeps everything to end of
      // line — so `# Title   ` rendered a heading with trailing blanks baked
      // into its text node.
      if (h) { blocks.push({ t: 'h', level: h[1].length, text: h[2].trim() }); i += 1; continue; }
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
        // ⚠️ v4.4.1 D4: the `Math.min(6, …)` that used to wrap this was
        // unreachable — H_RE's `#{1,4}` bounds level to 1–4, so the tag is
        // always h3–h6 and the clamp could never fire. Dead defensive code is
        // worse than none here: it made the h6 ceiling look enforced when the
        // real guarantee lives in H_RE. If that `#{1,4}` is ever widened, THIS
        // line must widen with it — h7 is not an element. The
        // `'#'.repeat(4) + ' X'` → h6 test pins the true boundary.
        el = d.createElement('h' + (b.level + 2));
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
