/**
 * Council Workspace — DOM painters (run list, header, stage rail, seats,
 * banner, cost). Every string lands via textContent/createTextNode; keyed
 * updates for seat rows (no full re-render per tick, spec §5.2).
 */
(function () {
  'use strict';

  /** Element builder: children that are strings become TEXT nodes (never markup). */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'className') { node.className = attrs[k]; }
        else if (k === 'dataset') {
          Object.keys(attrs[k]).forEach(function (d) { node.dataset[d] = attrs[k][d]; });
        } else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') {
          node.addEventListener(k.slice(2), attrs[k]);
        } else if (attrs[k] === false || attrs[k] === null || attrs[k] === undefined) {
          /* skip */
        } else { node.setAttribute(k, String(attrs[k])); }
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) { return; }
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function chip(text, kind) {
    return el('span', { className: 'chip ' + (kind || ''), title: text }, [text]);
  }

  /** Dual-name display flip (blind mode). pair = {model, label}. */
  function display(pair, blind) {
    if (!pair) { return '—'; }
    return blind && pair.label ? pair.label : (pair.model || '—');
  }

  function relTime(iso) {
    if (!iso) { return '—'; }
    var ms = Date.now() - Date.parse(iso);
    if (!isFinite(ms) || ms < 0) { return iso; }
    var m = Math.floor(ms / 60000);
    if (m < 1) { return 'just now'; }
    if (m < 60) { return m + 'm ago'; }
    var h = Math.floor(m / 60);
    if (h < 48) { return h + 'h ago'; }
    return Math.floor(h / 24) + 'd ago';
  }

  function renderRunList(container, rows, selectedId, onOpen) {
    container.textContent = '';
    rows.forEach(function (row) {
      if (row.error) {
        container.appendChild(el('li', { className: 'error-row', title: row.pointerPath || '' }, [
          el('div', { className: 'run-row-top' }, [
            el('span', { className: 'mono' }, [row.runId]),
            el('span', {}, ['unreadable']),
          ]),
          el('div', { className: 'run-row-sub' }, [row.runDir || row.error]),
        ]));
        return;
      }
      var li = el('li', {
        className: row.runId === selectedId ? 'selected' : '',
        tabindex: '-1',
        dataset: { runId: row.runId },
        onclick: function () { onOpen(row.runId); },
      }, [
        el('div', { className: 'run-row-top' }, [
          el('span', { className: 'mono' }, [row.runId]),
          chip(row.status, row.status),
        ]),
        el('div', { className: 'run-row-sub' }, [
          relTime(row.startedAt),
          String(row.bench.length) + ' seats',
          'chair ' + (row.chair || '—'),
          row.overallVerdict || '',
          row.costDisplay || '',
        ].filter(Boolean).map(function (t) { return el('span', {}, [t]); })),
      ]);
      container.appendChild(li);
    });
  }

  function renderHeaderChips(container, run) {
    container.textContent = '';
    container.appendChild(chip(run.status || 'unknown', run.status));
    (Array.isArray(run.bench) ? run.bench : []).forEach(function (m) {
      container.appendChild(chip(m, ''));
    });
    if (run.critic) { container.appendChild(chip('critic: ' + run.critic, '')); }
    (Array.isArray(run.lenses) ? run.lenses : []).forEach(function (s) {
      container.appendChild(chip('lens: ' + s, ''));
    });
    container.appendChild(chip('chair: ' + (run.chair || '—'), ''));
    if (run.options && run.options.gateway) { container.appendChild(chip('gw: ' + run.options.gateway, '')); }
  }

  function renderGauge(fillEl, textEl, costAmount, maxCost, totalDisplay) {
    var gauge = fillEl.parentElement;
    if (maxCost === null || costAmount === null) {
      fillEl.style.width = '0%';
      gauge.classList.remove('over');
      textEl.textContent = totalDisplay + (maxCost !== null ? ' / $' + maxCost.toFixed(2) : '');
      return;
    }
    var pct = Math.min(100, (costAmount / maxCost) * 100);
    fillEl.style.width = pct.toFixed(1) + '%';
    gauge.classList.toggle('over', costAmount >= maxCost);
    textEl.textContent = totalDisplay + ' / $' + maxCost.toFixed(2);
  }

  function renderStageRail(container, stageRail) {
    container.textContent = '';
    (stageRail || []).forEach(function (s) {
      var mark = s.status === 'complete' ? '✓ ' : (s.status === 'running' ? '▶ ' : '· ');
      container.appendChild(el('span', {
        className: 'stage ' + (s.status || 'pending'),
        title: (s.startedAt || '') + (s.completedAt ? ' → ' + s.completedAt : ''),
        'aria-label': s.label + ': ' + s.status,
      }, [mark + s.label]));
    });
  }

  /** Keyed seat rows: update in place per seat id/model; remove leavers. */
  function renderSeats(tbody, seats, blindOn, labelOf) {
    var seen = {};
    seats.forEach(function (seat) {
      // ⚠️ DE-ROT (F37): `seat.id` is now always set by seatsFromRunStats (`model:role`), so
      // debate rebuttal/revote rows no longer collide with the seat row. The `|| seat.model`
      // fallback covers live seats, whose taskId-derived id is already unique.
      var key = String(seat.id || seat.model);
      seen[key] = true;
      var row = tbody.querySelector('tr[data-key="' + key.replace(/"/g, '') + '"]');
      // ⚠️ DE-ROT (F35): seat.lastActivity is the ISO `leg.lastActivityAt`; format it HERE.
      // seatCells lives in live-model.js, which loads first and has no access to relTime.
      var view = Object.assign({}, seat, {
        lastActivity: seat.lastActivity ? relTime(seat.lastActivity) : null,
      });
      var cells = window.AmicusLive.seatCells(view, blindOn, labelOf);
      if (!row) {
        row = el('tr', { dataset: { key: key } }, cells.map(function (c, i) {
          return el('td', { className: i >= 4 && i <= 6 ? 'num' : (i === 8 ? 'stalled-flag' : '') }, [c]);
        }));
        tbody.appendChild(row);
        return;
      }
      cells.forEach(function (c, i) {
        var td = row.children[i];
        if (td && td.textContent !== c) { td.textContent = c; }
      });
    });
    Array.prototype.slice.call(tbody.children).forEach(function (row) {
      if (!seen[row.dataset.key]) { row.remove(); }
    });
  }

  function renderBanner(bannerEl, text, kind) {
    if (!text) { bannerEl.hidden = true; bannerEl.textContent = ''; return; }
    bannerEl.hidden = false;
    bannerEl.className = 'banner ' + (kind || '');
    bannerEl.textContent = text;
  }

  function renderCost(container, cost, blindOn, labelOf) {
    container.textContent = '';
    var head = el('tr', {}, ['Seat', 'Role', 'Status', 'Duration', 'Cost'].map(function (h, i) {
      return el('th', { className: i >= 3 ? 'num' : '' }, [h]);
    }));
    var rows = (cost.rows || []).map(function (r) {
      var label = labelOf ? labelOf(r.model) : null;
      var name = blindOn && label ? label : r.model;
      var dur = r.durationMs === null ? '—' : Math.round(r.durationMs / 1000) + 's';
      return el('tr', {}, [
        el('td', {}, [name]),
        el('td', {}, [r.role || '—']),
        el('td', {}, [r.status || '—']),
        el('td', { className: 'num' }, [dur]),
        el('td', { className: 'num' }, [r.costDisplay || '—']),
      ]);
    });
    var total = el('tr', {}, [
      el('td', {}, [el('strong', {}, ['Run total'])]),
      el('td', {}, ['']), el('td', {}, ['']), el('td', {}, ['']),
      el('td', { className: 'num' }, [cost.totalDisplay || '—']),
    ]);
    var table = el('table', { className: 'table' }, [el('thead', {}, [head]), el('tbody', {}, rows.concat([total]))]);
    container.appendChild(table);
  }

  /** Prose panels: one titled section per artifact, markdown-lite rendered. */
  function renderProseSections(container, sections) {
    container.textContent = '';
    sections.forEach(function (s) {
      var host = el('div', { className: 'prose-section', dataset: { artifact: s.name } }, [
        el('h3', {}, [s.title]),
      ]);
      var body = el('div', {}, []);
      if (s.error) {
        body.appendChild(el('p', { className: 'empty-note' }, [s.error]));
      } else {
        window.AmicusMd.renderMdLite(body, s.text, document);
        if (s.truncated) {
          body.appendChild(el('p', { className: 'truncate-note' }, ['Truncated at 200 KB — open the run folder for the full file.']));
        }
      }
      host.appendChild(body);
      container.appendChild(host);
    });
  }

  window.AmicusRender = {
    el: el, chip: chip, display: display, relTime: relTime, renderRunList: renderRunList,
    renderHeaderChips: renderHeaderChips, renderGauge: renderGauge, renderStageRail: renderStageRail,
    renderSeats: renderSeats, renderBanner: renderBanner, renderCost: renderCost,
    renderProseSections: renderProseSections,
  };
})();
