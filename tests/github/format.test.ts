import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox } from "../lib/sandbox.ts";

const FORMAT = path.join(REPO, ".github/format.ts");
const TS_OK = "export const x = { a: 1 };\n";
const BASH_OK = "#!/usr/bin/env bash\nif true; then\n  echo hi\nfi\n";

async function fixture(t: Parameters<typeof Sandbox.create>[0], files: Record<string, string>) {
  const sb = await Sandbox.create(t);
  const root = path.join(sb.dir, "fixture");
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  const run = (...args: string[]) =>
    sb.run(["node", FORMAT, "--root", root, ...args], { timeoutMs: 30000 });
  return { root, run };
}

test("formatted TS and bash pass; zsh is left alone", async (t) => {
  const { run } = await fixture(t, {
    "a.ts": TS_OK,
    b: BASH_OK,
    z: "#!/bin/zsh\nif true;then print x;fi\n",
  });
  const r = await run();
  assert.equal(r.code, 0, r.stdout + r.stderr);
});

test("unformatted TS fails", async (t) => {
  const { run } = await fixture(t, { "a.ts": "export const x = {a:1}\n" });
  const r = await run();
  assert.equal(r.code, 1);
  assert.match(r.stdout, /format: a\.ts is not formatted/);
});

test("unformatted bash fails", async (t) => {
  const { run } = await fixture(t, { b: "#!/usr/bin/env bash\nif true;then echo hi;fi\n" });
  const r = await run();
  assert.equal(r.code, 1);
  assert.match(r.stdout, /format: b is not formatted/);
});

test("a bash line over 100 columns fails", async (t) => {
  const { run } = await fixture(t, { b: `#!/usr/bin/env bash\necho ${"x".repeat(96)}\n` });
  const r = await run();
  assert.equal(r.code, 1);
  assert.match(r.stdout, /format: b:2: line longer than 100/);
});

test("--write fixes what the formatters can", async (t) => {
  const { root, run } = await fixture(t, {
    "a.ts": "export const x = {a:1}\n",
    b: "#!/usr/bin/env bash\nif true;then echo hi;fi\n",
  });
  const w = await run("--write");
  assert.equal(w.code, 0, w.stdout + w.stderr);
  assert.equal(fs.readFileSync(path.join(root, "a.ts"), "utf8"), TS_OK);
  assert.equal(
    fs.readFileSync(path.join(root, "b"), "utf8"),
    "#!/usr/bin/env bash\nif true; then echo hi; fi\n",
  );
  assert.equal((await run()).code, 0);
});

test("only the named files are checked", async (t) => {
  const { run } = await fixture(t, { "a.ts": "export const x = {a:1}\n", "c.ts": TS_OK });
  assert.equal((await run("--", "c.ts")).code, 0);
  assert.equal((await run("--", "a.ts")).code, 1);
});

test("missing shfmt fails with the install hint", async (t) => {
  const { run } = await fixture(t, { b: BASH_OK });
  const r = await run("--tools", "/nonexistent-tools");
  assert.equal(r.code, 1);
  assert.match(r.stderr, /run \.github\/tools install/);
});

test("an unknown option is a usage error", async (t) => {
  const { run } = await fixture(t, { "a.ts": TS_OK });
  const r = await run("--bogus");
  assert.equal(r.code, 2);
  assert.match(r.stderr, /^format: .*--bogus/);
  assert.match(r.stderr, /usage: format \[--root <dir>\]/);
});
