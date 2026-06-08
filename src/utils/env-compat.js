/**
 * Environment-variable compatibility shim (Amicus rebrand).
 *
 * DEPRECATED(amicus-shim): the SIDECAR_* fallbacks exist only for backward
 * compatibility with pre-rebrand setups. Remove in a future revision once users
 * have migrated to the AMICUS_* names. See docs/SHIMS.md.
 */
const { logger } = require('./logger');

const warned = new Set();

/**
 * Read an env var by its canonical AMICUS_<suffix> name, falling back to the
 * legacy SIDECAR_<suffix> name (with a one-time deprecation warning) if unset.
 *
 * @param {string} suffix - e.g. 'CONFIG_DIR' (no AMICUS_/SIDECAR_ prefix)
 * @returns {string|undefined}
 */
function getCompatEnv(suffix) {
  const amicusName = `AMICUS_${suffix}`;
  if (process.env[amicusName] !== undefined) {
    return process.env[amicusName];
  }
  const legacyName = `SIDECAR_${suffix}`;
  if (process.env[legacyName] !== undefined) {
    if (!warned.has(legacyName)) {
      warned.add(legacyName);
      logger.warn(
        `${legacyName} is deprecated; use ${amicusName} instead. ` +
        'Support will be removed in a future Amicus release.'
      );
    }
    return process.env[legacyName];
  }
  return undefined;
}

module.exports = { getCompatEnv };
