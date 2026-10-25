import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox } from "./lib/sandbox.ts";

const TSC = path.join(REPO, "node_modules/typescript/bin/tsc");

async function typecheck(t: Parameters<typeof Sandbox.create>[0], source: string) {
  const sb = await Sandbox.create(t);
  const dir = path.join(sb.dir, "project");
  fs.mkdirSync(dir);
  const config = {
    extends: path.join(REPO, "tsconfig.json"),
    compilerOptions: { types: [] },
    include: ["x.ts"],
  };
  fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify(config));
  fs.writeFileSync(path.join(dir, "package.json"), '{ "type": "module" }');
  fs.writeFileSync(path.join(dir, "x.ts"), source);
  return sb.run(["node", TSC, "-p", dir], { timeoutMs: 30000 });
}

test("the repo tsconfig rejects an unused variable", async (t) => {
  const r = await typecheck(
    t,
    "export function f(): number {\n  const unused = 1;\n  return 2;\n}\n",
  );
  assert.notEqual(r.code, 0);
  assert.match(r.stdout, /error TS6133: 'unused' is declared but its value is never read/);
});

test("the repo tsconfig rejects an unused parameter and implicit any", async (t) => {
  const r = await typecheck(t, "export function f(a, b: number): number {\n  return 2;\n}\n");
  assert.match(r.stdout, /TS7006/);
  assert.match(r.stdout, /TS6133: 'b'/);
});

test("clean code passes", async (t) => {
  const r = await typecheck(t, "export function f(a: number): number {\n  return a;\n}\n");
  assert.equal(r.code, 0, r.stdout);
});
