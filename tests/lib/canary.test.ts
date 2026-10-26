import assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";
import { SECRET_SCRIPTS } from "./canary.ts";
import { REPO, Sandbox } from "./sandbox.ts";

// FR-36: each secret-reading script, fed its secrets by fakes, sends them only to its final
// consumers' stdin: never to argv, env, other stdin, output or a written file.
for (const scenario of SECRET_SCRIPTS) {
  test(`canary: ${scenario.script} ${scenario.title}`, async (t) => {
    const sb = await Sandbox.create(t);
    const secrets = scenario.setup(sb) || [sb.canary];
    const args = scenario.args?.(sb) ?? [];
    const input = scenario.input?.(sb);
    const r = await sb.run(["zsh", path.join(REPO, scenario.script), ...args], {
      ...(input !== undefined && { input }),
    });
    scenario.check(sb, r, secrets);
    assert.deepEqual(sb.leaks({ consumers: scenario.consumers, secrets }), []);
  });
}
