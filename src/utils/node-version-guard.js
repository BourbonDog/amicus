'use strict';
const MIN_NODE = '22.12.0';

/** @param {string} current @param {string} min @returns {{ok:boolean,message:string|null}} */
function checkNodeVersion(current, min = MIN_NODE) {
  const c = current.replace(/^v/, '').split('.').map(Number);
  const m = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((c[i] || 0) > (m[i] || 0)) { return { ok: true, message: null }; }
    if ((c[i] || 0) < (m[i] || 0)) {
      return { ok: false, message: `Amicus 3.0 requires Node >=${min}; you are on ${current.replace(/^v/, '')}. Upgrade Node and retry.` };
    }
  }
  return { ok: true, message: null };
}
module.exports = { checkNodeVersion, MIN_NODE };
