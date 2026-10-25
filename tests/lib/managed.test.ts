import assert from "node:assert/strict";
import { test } from "node:test";
import { isExecutable, isProgramEntry, managedFiles, testedFile, testPath } from "./managed.ts";
import { fromFiles } from "./repo.ts";

test("testPath drops a leading . and the code extension", () => {
  assert.equal(testPath(".github/format.ts"), "tests/github/format.test.ts");
  assert.equal(testPath(".githooks/pre-commit"), "tests/githooks/pre-commit.test.ts");
  assert.equal(testPath("mini/bin/ans"), "tests/mini/bin/ans.test.ts");
  assert.equal(testPath("mini/ts/keys.ts"), "tests/mini/ts/keys.test.ts");
  assert.equal(testPath("ctl/lib/ssh.zsh"), "tests/ctl/lib/ssh.test.ts");
  assert.equal(testPath("host/ssh_config.container"), "tests/host/ssh_config.container.test.ts");
});

test("executables are shebang files under the tested dirs", () => {
  assert.ok(isExecutable("mini/bin/ans", "#!/usr/bin/env zsh\n"));
  assert.ok(isExecutable(".github/tools", "#!/usr/bin/env bash\n"));
  assert.ok(isExecutable(".githooks/pre-commit", "#!/usr/bin/env bash\n"));
  assert.ok(!isExecutable("ctl/lib/ssh.zsh", "f() {}\n"));
  assert.ok(!isExecutable("tests/x", "#!/usr/bin/env zsh\n"));
  assert.ok(!isExecutable("runbooks/x", "#!/usr/bin/env zsh\n"));
});

test("program entries are TS outside tests/ and lib/, not the generated JXA files", () => {
  for (const file of [".github/format.ts", "mini/ts/keys.ts"]) {
    assert.ok(isProgramEntry(file), file);
  }
  for (const file of [
    ".github/lib/tools.ts",
    "mini/ts/lib/jxa.ts",
    "mini/ts/jxa.d.ts",
    "tests/guards/run.ts",
    "mini/js/keys.js",
    "mini/js/sub/x.js",
    "README.md",
  ]) {
    assert.ok(!isProgramEntry(file), file);
  }
});

test("a test maps to a file by path, by extension, under a .-prefixed dir, in tests/ or to a dir", () => {
  const files = new Set([
    ".github/format.ts",
    "ctl/lib/ssh.zsh",
    "tsconfig.json",
    "tests/guards/address.ts",
    "tests/guards/samples/x.ts",
    "host/ssh_config",
    "tests/lib/sandbox.test.ts",
  ]);
  for (const test of [
    "tests/github/format.test.ts",
    "tests/ctl/lib/ssh.test.ts",
    "tests/tsconfig.test.ts",
    "tests/guards/address.test.ts",
    "tests/guards/samples.test.ts",
    "tests/host/ssh_config.test.ts",
  ]) {
    assert.ok(testedFile(test, files), test);
  }
  for (const test of [
    "tests/lib/sandbox.test.ts",
    "tests/ghost.test.ts",
    "tests/host/ssh.test.ts",
  ]) {
    assert.ok(!testedFile(test, files), test);
  }
});

test("managed files are executables and program entries off the allowlist", () => {
  const view = fromFiles({
    "tests/registry/untested.json": JSON.stringify([{ file: "mini/bin/ans", reason: "E10" }]),
    "mini/bin/ans": "#!/usr/bin/env zsh\n",
    "ctl/mini": "#!/usr/bin/env zsh\n",
    ".github/lint.ts": "",
    ".github/lib/tools.ts": "",
    "host/Dockerfile": "FROM x\n",
  });
  assert.deepEqual(managedFiles(view), [".github/lint.ts", "ctl/mini"]);
});
