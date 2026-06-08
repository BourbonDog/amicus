/**
 * Amicus - Main Module
 *
 * Spec Reference: §9 Implementation
 * Re-exports all public APIs for the sidecar CLI.
 */

// Import sidecar operations from modular components
const { startSidecar, generateTaskId, runInteractive, HEARTBEAT_INTERVAL } = require('./sidecar/start');
const { resumeSidecar } = require('./sidecar/resume');
const { continueSidecar } = require('./sidecar/continue');
const { readSidecar, listSidecars, formatAge } = require('./sidecar/read');
const { buildContext, parseDuration } = require('./sidecar/context-builder');

// Import from prompt-builder
const { buildSystemPrompt, buildPrompts, getSummaryTemplate, SUMMARY_TEMPLATE } = require('./prompt-builder');

// Import from headless
const { runHeadless, extractSummary, formatFoldOutput, DEFAULT_TIMEOUT, FOLD_MARKER, COMPLETE_MARKER } = require('./headless');

// Track B modules - Context, Session Management, Conflict & Drift Detection
const { filterContext, estimateTokens, takeLastNTurns } = require('./context');
const { createSession, updateSession, getSession, saveConversation, saveSummary, getSessionDir, SESSION_STATUS } = require('./session-manager');
const { detectConflicts, formatConflictWarning } = require('./conflict');
const { calculateDrift, formatDriftWarning, countTurnsSince, isDriftSignificant } = require('./drift');

// v3 modules - Environment detection & Context compression
const { detectEnvironment, inferClient, getSessionRoot } = require('./environment');
const { compressContext, estimateTokenCount, buildPreamble } = require('./context-compression');

module.exports = {
  // Canonical Amicus public API (the *Sidecar names below are deprecated shims)
  startAmicus: startSidecar,
  listAmicus: listSidecars,
  resumeAmicus: resumeSidecar,
  continueAmicus: continueSidecar,
  readAmicus: readSidecar,

  // DEPRECATED(amicus-shim): remove *Sidecar exports in a future revision — see docs/SHIMS.md
  // Primary sidecar APIs
  startSidecar,
  listSidecars,
  resumeSidecar,
  continueSidecar,
  readSidecar,
  generateTaskId,

  // Context building
  buildContext,
  parseDuration,
  formatAge,

  // Re-export from prompt-builder
  buildSystemPrompt,
  buildPrompts,
  getSummaryTemplate,
  SUMMARY_TEMPLATE,

  // Re-export from headless
  runHeadless,
  extractSummary,
  formatFoldOutput,
  DEFAULT_TIMEOUT,
  FOLD_MARKER,
  COMPLETE_MARKER,

  // Re-export from context (Track B)
  filterContext,
  estimateTokens,
  takeLastNTurns,

  // Re-export from session-manager (Track B)
  createSession,
  updateSession,
  getSession,
  saveConversation,
  saveSummary,
  getSessionDir,
  SESSION_STATUS,

  // Re-export from conflict (Track B)
  detectConflicts,
  formatConflictWarning,

  // Re-export from drift (Track B)
  calculateDrift,
  formatDriftWarning,
  countTurnsSince,
  isDriftSignificant,

  // Re-export from environment (v3)
  detectEnvironment,
  inferClient,
  getSessionRoot,

  // Re-export from context-compression (v3)
  compressContext,
  estimateTokenCount,
  buildPreamble,

  // Internal exports (for use by sidecar modules)
  runInteractive,
  HEARTBEAT_INTERVAL
};
