import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox } from "../lib/sandbox.ts";

const LINT = path.join(REPO, ".github/lint.ts");
const WORKFLOW =
  "name: t\non: push\njobs:\n  a:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo ok\n";
const CLEAN: Record<string, string> = {
  "scripts/z": '#!/bin/zsh\nprint -r -- "${1:-x}"\n',
  "scripts/b": '#!/usr/bin/env bash\necho "${1:-x}"\n',
  "lib/x.zsh": "f() { print ok; }\n",
  ".github/workflows/t.yml": WORKFLOW,
  "README.md": "Plain words here.\n",
};

async function lint(
  t: Parameters<typeof Sandbox.create>[0],
  files: Record<string, string>,
  extra: string[] = [],
) {
  const sb = await Sandbox.create(t);
  const root = path.join(sb.dir, "fixture");
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return sb.run(["node", LINT, "--root", root, ...extra], { timeoutMs: 30000 });
}

test("clean shell files, workflows and words pass", async (t) => {
  const r = await lint(t, CLEAN);
  assert.equal(r.code, 0, r.stdout + r.stderr);
});

test("a zsh syntax error fails naming the file", async (t) => {
  const r = await lint(t, { ...CLEAN, "scripts/z": "#!/bin/zsh\nif true; then\n" });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /lint: zsh -n scripts\/z:/);
});

test("a bash syntax error fails", async (t) => {
  const r = await lint(t, { ...CLEAN, "scripts/b": "#!/usr/bin/env bash\nif then fi\n" });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /lint: bash -n scripts\/b:/);
});

test("a shellcheck finding fails", async (t) => {
  const r = await lint(t, { ...CLEAN, "scripts/b": "#!/usr/bin/env bash\nls $1\n" });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /lint: shellcheck scripts\/b:[\s\S]*SC2086/);
});

test("actionlint rejects an unknown workflow key", async (t) => {
  const r = await lint(t, { ...CLEAN, ".github/workflows/t.yml": WORKFLOW + "    bogus-key: 1\n" });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /lint: actionlint:[\s\S]*bogus-key/);
});

test("typos reports a misspelling", async (t) => {
  const r = await lint(t, { ...CLEAN, "README.md": "This is " + "t" + "eh readme.\n" });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /lint: typos:[\s\S]*teh/);
});

test("missing tools fail with the install hint", async (t) => {
  const r = await lint(t, CLEAN, ["--tools", "/nonexistent-tools"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /run \.github\/tools install/);
});

test("an unknown option or a positional is a usage error", async (t) => {
  for (const extra of [["--bogus"], ["file"]]) {
    const r = await lint(t, CLEAN, extra);
    assert.equal(r.code, 2, extra.join(" "));
    assert.match(r.stderr, /^lint: /);
    assert.match(r.stderr, /usage: lint \[--root <dir>\] \[--tools <dir>\]/);
  }
});
