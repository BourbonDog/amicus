// src/observe/follow.js
'use strict';

/**
 * @module observe/follow
 * --follow (spec 5.2): stream a run's OWN events as they are emitted, to
 * stderr — no tailing, the orchestrator is the emitter. json mode -> NDJSON
 * event lines (CI: --json --follow 2>progress.ndjson); human mode -> terse
 * per-event lines replacing the 15 s heartbeat table. stdout contracts stay
 * byte-identical (the --json final doc / human summary are untouched).
 */

const { renderPlainLines } = require('./watch-render');

function createFollowPrinter({ json, stream } = {}) {
  const out = stream || process.stderr;
  return {
    onEvent(event) {
      if (json) { out.write(JSON.stringify(event) + '\n'); return; }
      const [line] = renderPlainLines([event], null);
      if (line) { out.write(line + '\n'); }
    },
  };
}

module.exports = { createFollowPrinter };
