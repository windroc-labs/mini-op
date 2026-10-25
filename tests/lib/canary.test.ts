import assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";
import { hex, SECRET_SCRIPTS } from "./canary.ts";
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

test("storekey stores nothing unless the clipboard is exactly one Linear key", async (t) => {
  const storekey = path.join(REPO, "mini/runbooks/setup-test-env/storekey");
  const key = "lin_api_" + hex();
  for (const clipboard of [
    `My key: ${key}`,
    `${key}" -A -l "y`,
    `${key}\\n" -A`,
    `${key}\nsecond line`,
    "ghs_" + hex(),
    "",
  ]) {
    const sb = await Sandbox.create(t);
    sb.fake("pbpaste", [{ stdout: clipboard }]);
    sb.fake("pbcopy", [{}]);
    sb.fake("security", [{}]);
    sb.fake("curl", [{}]);
    const r = await sb.run(["zsh", storekey, "s", "a"], { input: sb.canary + "\n" });
    assert.equal(r.code, 1, JSON.stringify(clipboard));
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, "storekey: clipboard holds no Linear key; stored nothing\n");
    const stdin = sb.calls("security").map((call) => call.stdin);
    assert.ok(!stdin.some((s) => s.includes("add-generic-password")), JSON.stringify(clipboard));
    assert.deepEqual(sb.calls("pbcopy"), []);
    assert.deepEqual(sb.leaks({ consumers: ["security"], secrets: [sb.canary, key] }), []);
  }
});
