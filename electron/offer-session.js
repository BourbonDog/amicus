/**
 * Offer-session catalog snapshots for the setup wizard's provider-default
 * flow (extracted from ipc-setup.js at the 300-line gate, v4.9 / PR 199).
 *
 * V17 (council A4): each save-key offer snapshots the catalog it was built
 * from, so set-provider-default applies against the SAME catalog the picker
 * offered — a re-fetch there could return a different catalog and flip
 * directFormIfProven's evidence (TOCTOU).
 *
 * Lifetime = the OFFER SESSION (PR 199 B1/D2, re-ruled after review F1):
 * the wizard auto-applies on render and re-applies on every radio change,
 * so EVERY apply while the offer is on screen must see the offer's own
 * catalog — a one-shot delete-on-read handed every human pick a fresh
 * fetch, which is the original A4 race. A re-offer overwrites the entry;
 * setup-done ends the sender's sessions.
 *
 * Keyed per SENDER + provider (PR 199 round-2 council A1): two Settings
 * windows are independent offer sessions — one window's offer, apply, or
 * completion must never alter another's. A harness event with no sender id
 * keys by provider alone (also the single-window behavior), and its
 * endSession ends every session.
 */

'use strict';

function createOfferSessions() {
  const snapshots = new Map();
  const senderId = (event) => {
    const sid = event && event.sender ? event.sender.id : undefined;
    return (sid === undefined || sid === null) ? null : sid;
  };
  const key = (event, provider) => {
    const sid = senderId(event);
    return (sid !== null ? sid + ':' : '') + provider;
  };
  return {
    /** Arm (or re-arm) the sender's offer session for a provider. */
    set(event, provider, catalog) { snapshots.set(key(event, provider), catalog); },
    /** The sender's live offer catalog for a provider, or undefined. */
    get(event, provider) { return snapshots.get(key(event, provider)); },
    /** End every offer session belonging to this sender (setup-done). */
    endSession(event) {
      const sid = senderId(event);
      for (const k of [...snapshots.keys()]) {
        if (sid === null || k.startsWith(sid + ':')) { snapshots.delete(k); }
      }
    },
  };
}

module.exports = { createOfferSessions };
