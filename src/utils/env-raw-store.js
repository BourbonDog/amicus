/**
 * Arbitrary-env-var writes to the amicus .env (local-provider bearers, v4.2 §4.6).
 * Split out of api-key-store.js to keep that file under the 300-line gate (B2/D3).
 * The upsertEnvLine/deleteEnvLine merge helpers here are the SINGLE copy of the
 * .env line-merge logic: saveApiKey/removeApiKey in api-key-store.js call them too
 * (deduped, not copy-pasted). getEnvPath is required LAZILY inside each writer so
 * api-key-store.js can re-export from here without a load-time require cycle.
 */
'use strict';

const fs = require('fs');
const path = require('path');

/** Env-var names are UPPER_SNAKE, leading letter (mirrors POSIX + saveApiKey inputs). */
const ENV_VAR_RE = /^[A-Z][A-Z0-9_]*$/;

/**
 * Upsert `envVar=value` into the .env at envPath: preserve comments/other lines,
 * dedup by REPLACING an existing `<envVar>=` line rather than appending a second,
 * strip trailing blank lines before an append, write 0600 with a trailing newline.
 * @param {string} envPath
 * @param {string} envVar
 * @param {string} value
 */
function upsertEnvLine(envPath, envVar, value) {
  fs.mkdirSync(path.dirname(envPath), { recursive: true });

  let lines = [];
  try {
    if (fs.existsSync(envPath)) {
      lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    }
  } catch (_err) {
    // Start fresh
  }

  let found = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith(envVar + '=')) {
      lines[i] = `${envVar}=${value}`;
      found = true;
      break;
    }
  }
  if (!found) {
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
      lines.pop();
    }
    lines.push(`${envVar}=${value}`);
  }

  fs.writeFileSync(envPath, lines.join('\n') + '\n', { mode: 0o600 });
}

/**
 * Remove any `envVar=` line from the .env at envPath (best-effort): preserves the
 * other lines, strips trailing blanks, writes 0600 with a trailing newline (or an
 * empty file when nothing remains). No-op when the file is absent.
 * @param {string} envPath
 * @param {string} envVar
 */
function deleteEnvLine(envPath, envVar) {
  try {
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, 'utf-8').split('\n')
        .filter((line) => !line.trim().startsWith(envVar + '='));
      while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
        lines.pop();
      }
      fs.writeFileSync(envPath, lines.length > 0 ? lines.join('\n') + '\n' : '', { mode: 0o600 });
    }
  } catch (_err) {
    // Best-effort
  }
}

/**
 * Write an arbitrary env-var line to the amicus .env (local-provider bearers).
 * Keyed on the env-var NAME directly (no PROVIDER_ENV_MAP), so it can persist
 * `LAB_API_KEY`, `VLLM_LAB_API_KEY`, ... Validates the name and returns
 * `{success:false, error}` WITHOUT throwing so callers can bail before saving a
 * config entry that references a rejected name. Mirrors the value into process.env.
 * @param {string} envVar e.g. 'LAB_API_KEY'
 * @param {string} value bearer token
 * @returns {{success: boolean, error?: string}}
 */
function saveRawEnv(envVar, value) {
  if (typeof envVar !== 'string' || !ENV_VAR_RE.test(envVar)) {
    return { success: false, error: `Invalid env var name: ${envVar}` };
  }
  const { getEnvPath } = require('./api-key-store'); // lazy: avoids a load-time cycle
  upsertEnvLine(getEnvPath(), envVar, value);
  process.env[envVar] = value;
  return { success: true };
}

/**
 * Remove an arbitrary env-var line from the amicus .env (local-provider bearers).
 * No auth.json reconciliation — that store is keyed on the 5 static vendors, and a
 * local provider never has an entry there.
 * @param {string} envVar e.g. 'LAB_API_KEY'
 * @returns {{success: boolean}}
 */
function removeRawEnv(envVar) {
  const { getEnvPath } = require('./api-key-store'); // lazy: avoids a load-time cycle
  deleteEnvLine(getEnvPath(), envVar);
  delete process.env[envVar];
  return { success: true };
}

module.exports = { saveRawEnv, removeRawEnv, upsertEnvLine, deleteEnvLine };
