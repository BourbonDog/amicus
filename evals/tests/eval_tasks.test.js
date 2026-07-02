// Guard: MCP-mode eval criteria must reference the CANONICAL amicus_* tool
// names. sidecar_* aliases are opt-in (AMICUS_LEGACY_ALIASES=1) since v1.8.0
// and the eval harness spawns the server env-free, so a sidecar_* criterion
// can never match — it would silently fail every MCP-mode eval.
const tasks = require('../eval_tasks.json');

describe('eval_tasks.json MCP criteria use canonical amicus_* tool names', () => {
  test('every tool-referencing MCP criterion names amicus_* and never sidecar_*', () => {
    expect(tasks.length).toBeGreaterThan(0);
    for (const task of tasks) {
      for (const c of task.success_criteria.programmatic) {
        if (c.tool) {
          expect(c.tool).not.toMatch(/(^|\|)sidecar_/);
          expect(c.tool).toMatch(/(^|\|)amicus_/);
        }
      }
    }
  });
});
