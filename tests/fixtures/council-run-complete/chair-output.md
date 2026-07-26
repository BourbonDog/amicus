## Chair synthesis

The council converged on one hard blocker and split on scope.

[SIDECAR_FOLD:deadbeefdeadbeef]

### Hard questions

1. Is the retry path idempotent under double-invoke?
2. Who owns the migration if `schemaVersion` bumps mid-flight?
3. Does the cost gate fire before or after the second wave?

VERDICT: Fix these first
