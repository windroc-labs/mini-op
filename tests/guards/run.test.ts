import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { runGuards, type Guard } from "../lib/guard.ts";
import { fromFiles, shellKind } from "../lib/repo.ts";
import { REPO, Sandbox } from "../lib/sandbox.ts";
import { guards } from "./index.ts";

const clean: Guard = { name: "clean", check: () => [] };
const dirty: Guard = {
  name: "dirty",
  check: (view) => view.files.map((file) => ({ file, line: 2, message: "bad" })),
};
const reading: Guard = {
  name: "reading",
  check: (view) => {
    view.read("missing.txt");
    return [];
  },
};

function capture(view: ReturnType<typeof fromFiles>, list: Guard[]): [number, string] {
  let out = "";
  const code = runGuards(view, list, (text) => (out += text));
  return [code, out];
}

test("prints N violations per guard and exits 1 on any", () => {
  const [code, out] = capture(fromFiles({ "a.sh": "x" }), [clean, dirty]);
  assert.equal(code, 1);
  assert.equal(out, "clean: 0 violations\ndirty: 1 violations\n  a.sh:2: bad\n");
  assert.equal(capture(fromFiles({}), [clean, dirty])[0], 0);
});

test("an unreadable file is an error, not a pass", () => {
  const [code, out] = capture(fromFiles({}), [reading, clean]);
  assert.equal(code, 1);
  assert.match(out, /^reading: error: .*missing\.txt/m);
  assert.match(out, /^clean: 0 violations$/m);
});

test("the CLI runs every guard on this checkout", async (t) => {
  const sb = await Sandbox.create(t);
  const r = await sb.run(["node", path.join(REPO, "tests/guards/run.ts")]);
  for (const guard of guards)
    assert.match(r.stdout, new RegExp(`^${guard.name}: \\d+ violations$`, "m"));
  assert.equal(r.code, /: [1-9]\d* violations$/m.test(r.stdout) ? 1 : 0);
});

test("the CLI gives the address guard ~/.mini-op/config.local.yaml when HOME has one", async (t) => {
  const sb = await Sandbox.create(t);
  const local = path.join(sb.home, ".mini-op/config.local.yaml");
  fs.mkdirSync(path.dirname(local), { recursive: true });
  // Built here, so this file names neither value.
  const host = [10, 201, 202, 203].join(".");
  fs.writeFileSync(local, `mini_host: ${host}\nmini_user: ${"zq_"}nobody\n`);
  const run = () => sb.run(["node", path.join(REPO, "tests/guards/run.ts")]);
  assert.match((await run()).stdout, /^address: 0 violations$/m);
  fs.writeFileSync(local, `mini_host ${host}\n`);
  const r = await run();
  assert.match(r.stdout, /^address: 1 violations$/m);
  assert.match(r.stdout, new RegExp(`^  ${local}:1: not a key: value line; run host/config$`, "m"));
  assert.equal(r.code, 1);
});

test("shellKind reads the shebang, then the extension", () => {
  const cases: [string, string, string | null][] = [
    ["a", "#!/bin/zsh\n", "zsh"],
    ["a", "#!/usr/bin/env bash\n", "bash"],
    ["a", "#!/usr/bin/env -S bash -e\n", "bash"],
    ["a", "#!/bin/sh\n", "sh"],
    ["a", "#!/usr/bin/env node\n", null],
    ["lib/x.zsh", "f() {}\n", "zsh"],
    ["x.bash", "", "bash"],
    ["x.sh", "", "sh"],
    ["README.md", "# x\n", null],
  ];
  for (const [file, text, kind] of cases) assert.equal(shellKind(file, text), kind, file + text);
});
