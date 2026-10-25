import assert from "node:assert/strict";
import { test } from "node:test";
import { fromFiles } from "../lib/repo.ts";
import { guards } from "./index.ts";

// Each guard reports exactly its sample's expected violations, so a rule that stops firing fails.
for (const guard of guards) {
  test(`${guard.name} reports exactly its expected violations and passes its clean sample`, async () => {
    const samples = await import(`./samples/${guard.name}.ts`);
    assert.ok(samples.violation && samples.clean && samples.expected, `samples/${guard.name}.ts`);
    const found = guard
      .check(fromFiles(samples.violation))
      .map((v) => `${v.file}:${v.line}: ${v.message}`);
    assert.deepEqual(found.sort(), [...samples.expected].sort());
    assert.deepEqual(guard.check(fromFiles(samples.clean)), []);
    // Optional further violation samples, for cases one repo view cannot hold together.
    for (const more of samples.more ?? []) {
      const extra = guard
        .check(fromFiles(more.violation))
        .map((v) => `${v.file}:${v.line}: ${v.message}`);
      assert.deepEqual(extra.sort(), [...more.expected].sort());
    }
  });
}
