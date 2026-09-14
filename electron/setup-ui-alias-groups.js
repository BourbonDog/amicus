/**
 * Setup UI - Alias grouping rule (issue 213)
 *
 * The grouping rule itself (groupAliases / aliasVendorOf / vendorLabel /
 * titleCaseVendor / PREFERRED_VENDOR_ORDER) now lives in
 * src/utils/alias-groups.js (issue 238 PR1 fix wave F5): `src/sidecar/aliases.js`
 * (the CLI `amicus aliases` list) needed the same grouping, and `src/`
 * requiring from `electron/` is a layering violation the whole-branch review
 * caught. This file re-exports every moved symbol so
 * electron/setup-ui-aliases.js, electron/setup-ui-alias-script.js and every
 * existing test keep working untouched, and keeps its own genuinely
 * UI-only export (NEW_ROUTES_GROUP_LABEL) defined here.
 *
 * SHARED-WITH-THE-BROWSER NOTE (still applies to the grouping rule, wherever
 * it lives) — deliberately NOT shared. The wizard's inline script cannot
 * `require`, so the browser could only get this rule as a copy: hand-written
 * (silent divergence — a 3-segment direct id like `a/b/c` already splits
 * differently under the two obvious spellings) or serialised from the
 * source (which would put `slice('openrouter/'.length)` back into the
 * page). The page carrying its own gateway-prefix strip is the exact shape
 * issue 214 removed and that tests/setup-ui.test.js still guards
 * ("ships no routing policy to the page: ... no prefix derivation"), because
 * that copy is how a direct id gets fabricated for a namespace that never
 * served it.
 *
 * So there is ONE grouping rule and it lives server-side (now in
 * src/utils/alias-groups.js). The client (setup-ui-alias-script.js) never
 * derives a vendor: a route added during the session goes into its own
 * clearly-labelled "New routes" group, and vendor filing happens when the
 * server next renders the editor.
 */

const {
  groupAliases, aliasVendorOf, vendorLabel, titleCaseVendor, PREFERRED_VENDOR_ORDER,
} = require('../src/utils/alias-groups');

/**
 * Heading for the client-side group that holds routes added during THIS
 * wizard session. Exported so the inline script and the tests name the same
 * string.
 *
 * Wording is deliberately non-committal about filing, but the reason is
 * narrower than it once was. It used to be that Step 3 was built from
 * getDefaultAliases(), so a custom alias had no row at all on reopen; that is
 * fixed — electron/setup-ui.js now renders from the effective aliases, and a
 * SAVED custom route is vendor-filed on the next open like any other.
 *
 * What the label still cannot promise is filing WITHIN this session: the page
 * derives no vendors (issue 214 keeps routing policy server-side), so a route
 * added here cannot move into its vendor group until the config round-trips.
 * "this session" is exactly that scope.
 */
const NEW_ROUTES_GROUP_LABEL = 'New routes (this session)';

module.exports = {
  NEW_ROUTES_GROUP_LABEL,
  aliasVendorOf,
  vendorLabel,
  groupAliases,
  titleCaseVendor,
  PREFERRED_VENDOR_ORDER,
};
