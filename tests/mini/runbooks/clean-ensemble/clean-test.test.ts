import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox } from "../../../lib/sandbox.ts";

const CLEAN_TEST = path.join(REPO, "mini/runbooks/clean-ensemble/clean-test");
const URL = (ref: string) =>
  `https://raw.githubusercontent.com/windroc/ensemble/${ref}/scripts/install-cleanup.sh`;

// The fake curl serves an install-cleanup.sh that writes the args it got to ~/args and exits `rc`.
async function sandbox(t: Parameters<typeof Sandbox.create>[0], rc = 0) {
  const sb = await Sandbox.create(t);
  sb.fake("curl", [{ stdout: `printf '%s\\n' "$0" "$@" > "$HOME/args"\nexit ${rc}\n` }]);
  const args = () => {
    const file = path.join(sb.home, "args");
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").slice(0, -1) : null;
  };
  const run = (argv: string[], env: Record<string, string> = {}) =>
    sb.run(["zsh", CLEAN_TEST, ...argv], { env });
  return { sb, args, run };
}

test("runs main's install-cleanup.sh --yes with only the flags after --", async (t) => {
  const { sb, args, run } = await sandbox(t);
  const r = await run(["--", "--password-stdin"]);
  assert.equal(r.code, 0, r.stderr);
  // FR-57 (E8) fixes the name in this line.
  assert.equal(r.stdout, "install-cleanup.sh exited 0\n");
  assert.equal(r.stderr, "");
  assert.deepEqual(
    sb.calls("curl").map((c) => c.argv),
    [["-fsSL", URL("main")]],
  );
  assert.deepEqual(args(), ["install-cleanup.sh", "--yes", "--password-stdin"]);
});

test("REF picks the ref; no flags runs --yes alone", async (t) => {
  const { sb, args, run } = await sandbox(t);
  const r = await run([], { REF: "feature-x" });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(
    sb.calls("curl").map((c) => c.argv.at(-1)),
    [URL("feature-x")],
  );
  assert.deepEqual(args(), ["install-cleanup.sh", "--yes"]);
});

test("install-cleanup.sh exiting non-zero exits 1 with its rc on stdout", async (t) => {
  const { args, run } = await sandbox(t, 4);
  const r = await run(["--"]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "install-cleanup.sh exited 4\n");
  assert.equal(r.stderr, "");
  assert.deepEqual(args(), ["install-cleanup.sh", "--yes"]);
});

test("a failed download exits 1 and runs nothing", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("curl", [{ stderr: "curl: (6) Could not resolve host\n", exit: 6 }]);
  const r = await sb.run(["zsh", CLEAN_TEST]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(
    r.stderr,
    `curl: (6) Could not resolve host\nclean-test: cannot fetch ${URL("main")}; ran nothing\n`,
  );
  assert.ok(!fs.existsSync(path.join(sb.home, "args")));
});

test("flags before -- and stray words are usage errors that fetch nothing", async (t) => {
  const { sb, run } = await sandbox(t);
  for (const argv of [["-h", "x"], ["--yes"], ["--no-such-option"], ["x", "--"], ["x"]]) {
    const r = await run(argv);
    assert.equal(r.code, 2, argv.join(" "));
    assert.equal(r.stderr, "clean-test: usage: clean-test [-- <install-cleanup.sh flags>]\n");
    assert.equal(r.stdout, "");
  }
  assert.deepEqual(sb.calls(), []);
});

test("-h prints the usage to stdout and runs no cleanup", async (t) => {
  const { sb, args, run } = await sandbox(t);
  const r = await run(["-h"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, "");
  assert.match(r.stdout, /^clean-test \[-- <install-cleanup\.sh flags>\] /);
  assert.deepEqual(sb.calls(), []);
  assert.equal(args(), null);
});
