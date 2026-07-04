'use strict';

/**
 * @module result-schema-version
 * The single SCHEMA_VERSION constant shared by result-schema.js and
 * abort-result.js (split out to avoid a circular require between them).
 *
 * Stability contract: fields on any doc built from this version are only
 * ADDED within a SCHEMA_VERSION; any rename/removal bumps SCHEMA_VERSION.
 */

const SCHEMA_VERSION = 2;

module.exports = { SCHEMA_VERSION };
