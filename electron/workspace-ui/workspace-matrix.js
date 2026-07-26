/**
 * Council Workspace — adjudication matrix + verdict panel painters.
 * Tier row colors use the report-html light-ground token pairs
 * (--tier-* / --tier-*-ink). Cells carry symbols + title/aria text (never
 * color alone). Dispute cells drill into the judge's prose with the finding
 * id highlighted client-side — HONESTY NOTE rendered with it: the Stage-2
 * contract captures {id, verdict} only, so rationale is LOCATED IN prose,
 * not parsed from it (spec §5.2).
 */
(function () {
  'use strict';

  var MATRIX_ROW_CAP = 500; // §5.4 safety valve

  function verdictTitle(cell) {
    var v = cell.verdict || 'no vote';
    return display(cell.judge) + ': ' + v + (cell.isRaiser ? ' (raiser)' : '');
  }

  function display(pair) {
    var blind = window.AmicusApp ? window.AmicusApp.isBlind() : false;
    return window.AmicusRender.display(pair, blind);
  }

  // ⚠️ Fix-wave item 2 (F29): matrix-model.js's buildMatrixModel already attaches
  // row.debate ({action, previousTier}, action ∈ defended|amended|withdrawn|no-response) on
  // every --debate run — renderMatrix used to never read it, so a withdrawn/amended/
  // defended/no-response finding rendered identically to an ordinary live row (the exact
  // defect F29 was filed against). Rendered as a badge alongside the existing thin/
  // tierOverride badges (same element shape, same CSS rule) rather than new machinery.
  var DEBATE_LABEL = { withdrawn: 'withdrawn', amended: 'amended', defended: 'defended', 'no-response': 'no response' };

  function debateBadge(R, debate, tier) {
    if (!debate || !debate.action) { return null; }
    var label = DEBATE_LABEL[debate.action] || debate.action;
    var moved = !!(debate.previousTier && tier && debate.previousTier !== tier);
    var arrow = moved ? ' (' + debate.previousTier + ' → ' + tier + ')' : '';
    var title;
    if (debate.action === 'withdrawn') {
      title = 'withdrawn by raiser — no longer live' + (arrow || (debate.previousTier ? ' (was ' + debate.previousTier + ')' : ''));
    } else if (debate.action === 'no-response') {
      title = 'no response — original stands' + arrow;
    } else {
      title = debate.action + ' after re-vote' + (arrow || ' — tier unchanged');
    }
    return R.el('span', { className: 'debate-badge debate-' + debate.action, title: title }, [label]);
  }

  function renderMatrix(container, matrix, onDrill) {
    var R = window.AmicusRender;
    container.textContent = '';
    if (!matrix) {
      container.appendChild(R.el('p', { className: 'empty-note' }, ['tally.json not written yet — the matrix appears after the tally stage.']));
      return;
    }
    if (!matrix.judged) {
      container.appendChild(R.el('p', { className: 'truncate-note' }, ['Fewer than 2 judges completed — tally is peers-reduced.']));
    }
    var shown = matrix.rows.slice(0, MATRIX_ROW_CAP);
    var head = R.el('tr', {}, [
      R.el('th', {}, ['Finding']), R.el('th', {}, ['Sev']), R.el('th', {}, ['Raiser']),
    ].concat(matrix.judges.map(function (j) {
      return R.el('th', { className: 'num' }, [display(j)]);
    })).concat([R.el('th', {}, ['Tier']), R.el('th', { className: 'num' }, ['a/d/n'])]));

    var body = shown.map(function (row) {
      var cells = [
        R.el('td', { className: 'mono' }, [row.id]),
        R.el('td', {}, [row.severity || '—']),
        R.el('td', {}, [display(row.raiser)]),
      ];
      row.cells.forEach(function (cell) {
        var td = R.el('td', {
          className: 'vote-cell ' + (cell.verdict || ''),
          title: verdictTitle(cell),
          'aria-label': verdictTitle(cell),
        }, [cell.sym + (cell.isRaiser ? '*' : '')]);
        if (cell.verdict === 'dispute') {
          td.addEventListener('click', function () { onDrill(cell.judge, row.id); });
        }
        cells.push(td);
      });
      var tierTd = R.el('td', {}, [row.tier || '—']);
      if (row.thin) { tierTd.appendChild(R.el('span', { className: 'thin-badge', title: 'thin confidence (a+d ≤ 1)' }, ['thin'])); }
      if (row.tierOverride) {
        tierTd.appendChild(R.el('span', {
          className: 'override-badge',
          title: 'override: ' + row.tierOverride.from + ' → ' + row.tierOverride.to,
        }, ['override']));
      }
      var dBadge = debateBadge(R, row.debate, row.tier);
      if (dBadge) { tierTd.appendChild(dBadge); }
      cells.push(tierTd);
      cells.push(R.el('td', { className: 'num' }, [row.basis.a + '/' + row.basis.d + '/' + row.basis.n]));
      return R.el('tr', { className: 'tier-' + (row.tier || 'none'), dataset: { findingId: row.id } }, cells);
    });

    var table = R.el('table', { className: 'table' }, [R.el('thead', {}, [head]), R.el('tbody', {}, body)]);
    container.appendChild(R.el('div', { className: 'matrix-wrap' }, [table]));
    if (matrix.rows.length > MATRIX_ROW_CAP) {
      container.appendChild(R.el('p', { className: 'truncate-note' }, [
        'Showing ' + MATRIX_ROW_CAP + ' of ' + matrix.rows.length + ' findings.',
      ]));
    }
    // ⚠️ DE-ROT (F38): on `--debate` runs the re-vote rationale IS structured — debate.json
    // `revotes[] {judge, id, verdict, reason}` (run-debate.js:257-262) — so the parenthetical must
    // not claim "no structured field". Wording below is corrected to cover both cases.
    container.appendChild(R.el('p', { className: 'empty-note' }, [
      'Legend: ✓ agree · ✗ dispute · – neutral · * raiser · click a dispute cell for the judge’s prose (rationale lives in prose; on --debate runs a re-voted cell also carries a structured reason from debate.json).',
    ]));
  }

  function renderVerdict(container, vp, opts) {
    var R = window.AmicusRender;
    container.textContent = '';
    var head = R.el('div', { className: 'chips' }, []);
    if (vp.overallVerdict) {
      head.appendChild(R.el('span', { className: 'chip complete' }, ['VERDICT: ' + vp.overallVerdict]));
    } else {
      head.appendChild(R.el('span', { className: 'chip error' }, ['no chair verdict']));
      if (vp.reason) { head.appendChild(R.el('span', { className: 'empty-note' }, [vp.reason])); }
    }
    container.appendChild(head);

    if (vp.tierCounts) {
      container.appendChild(R.el('p', { className: 'mono' }, [
        'Confirmed ' + (vp.tierCounts.Confirmed || 0) + ' · Disputed ' + (vp.tierCounts.Disputed || 0) +
        ' · Contested ' + (vp.tierCounts.Contested || 0) + ' · Singleton ' + (vp.tierCounts.Singleton || 0),
      ]));
    }

    var chairHost = R.el('div', { id: 'chair-prose', className: 'prose-host' }, []);
    container.appendChild(chairHost);

    if (vp.streetCred && vp.streetCred.length) {
      var rows = vp.streetCred.map(function (s) {
        var label = opts.labelOf(s.model);
        var name = opts.isBlind() && label ? label : s.model;
        var fmt = function (v) { return (v === null || v === undefined) ? '—' : Number(v).toFixed(2); };
        return R.el('tr', {}, [
          R.el('td', {}, [name]),
          R.el('td', { className: 'num' }, [R.el('strong', {}, [fmt(s.peersOnly)])]),
          R.el('td', { className: 'num' }, [fmt(s.withSelf)]),
        ]);
      });
      container.appendChild(R.el('table', { className: 'table' }, [
        R.el('thead', {}, [R.el('tr', {}, [
          R.el('th', {}, ['Street-cred']), R.el('th', { className: 'num' }, ['peers-only']), R.el('th', { className: 'num' }, ['with-self']),
        ])]),
        R.el('tbody', {}, rows),
      ]));
    }

    if (vp.decisions && vp.decisions.length) {
      container.appendChild(R.el('table', { className: 'table' }, [
        R.el('thead', {}, [R.el('tr', {}, [R.el('th', {}, ['Finding']), R.el('th', {}, ['Decision']), R.el('th', {}, ['Applied'])])]),
        R.el('tbody', {}, vp.decisions.map(function (d) {
          return R.el('tr', {}, [
            R.el('td', { className: 'mono' }, [d.id]),
            R.el('td', {}, [d.decision]),
            R.el('td', {}, [d.applied ? 'yes' : 'no']),
          ]);
        })),
      ]));
    }

    var actions = R.el('div', { className: 'dialog-actions' }, [
      R.el('button', { id: 'fold-btn', className: 'btn primary' }, ['Fold to Claude Code']),
      R.el('button', { id: 'open-report-btn', className: 'btn' }, ['Open report.html']),
    ]);
    container.appendChild(actions);
    actions.querySelector('#fold-btn').addEventListener('click', opts.onFold);
    actions.querySelector('#open-report-btn').addEventListener('click', opts.onOpenReport);
    if (!opts.reportPresent) { actions.querySelector('#open-report-btn').disabled = true; }
    return chairHost;
  }

  /** Wrap every text-node occurrence of needle in <mark> (DOM-safe highlight). */
  function highlightText(container, needle) {
    if (!needle) { return; }
    var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    var nodes = [];
    while (walker.nextNode()) { nodes.push(walker.currentNode); }
    nodes.forEach(function (node) {
      var idx = node.nodeValue.indexOf(needle);
      if (idx === -1) { return; }
      var after = node.splitText(idx);
      after.splitText(needle.length);
      var mark = document.createElement('mark');
      mark.textContent = needle;
      after.parentNode.replaceChild(mark, after);
    });
  }

  // ⚠️ R4 COUNCIL REVIEW (fourth live paid council, major, unanimous): undoes highlightText —
  // needed because drillIntoJudge's prose section is built once (loadPanel's promise cache)
  // and never rebuilt, so re-drilling into a DIFFERENT finding on the same judge must clear
  // the PREVIOUS finding's <mark> before applying the new one, rather than leaving it stuck
  // (the stale mark was what made the old idempotency guard misfire on a different finding).
  function clearHighlight(container) {
    var marks = container.querySelectorAll('mark');
    for (var i = 0; i < marks.length; i++) {
      var mark = marks[i];
      if (mark.parentNode) { mark.parentNode.replaceChild(document.createTextNode(mark.textContent), mark); }
    }
  }

  window.AmicusMatrix = {
    renderMatrix: renderMatrix, renderVerdict: renderVerdict,
    highlightText: highlightText, clearHighlight: clearHighlight, MATRIX_ROW_CAP: MATRIX_ROW_CAP,
  };
})();
