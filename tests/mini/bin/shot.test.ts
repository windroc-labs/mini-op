import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox, type FakeRule } from "../../lib/sandbox.ts";

const SCRIPT = path.join(REPO, "mini/bin/shot");
const REFUSED = "shot: a secret is in a Terminal window; clear it (Cmd-K) before a screenshot\n";

async function sandbox(
  t: Parameters<typeof Sandbox.create>[0],
  terminal: FakeRule,
  capture: FakeRule = {},
) {
  const sb = await Sandbox.create(t);
  sb.fake("osascript", [{ program: "terminal.js", args: ["history", "--all"], ...terminal }]);
  sb.fake("screencapture", [capture]);
  return sb;
}

test("a clean screen is captured to the given or default path", async (t) => {
  const sb = await sandbox(t, { stdout: "mini ~ % ls\nghp_ is a prefix\n" });
  const out = path.join(sb.dir, "tmp/a.png");
  const r = await sb.run(["zsh", SCRIPT, out]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, out + "\n");
  assert.equal(sb.calls("osascript")[0]?.program, "terminal.js");
  const state = path.join(sb.home, "apm/state/shot.png");
  assert.equal((await sb.run(["zsh", SCRIPT])).stdout, state + "\n");
  assert.deepEqual(
    sb.calls("screencapture").map((call) => call.argv),
    [
      ["-x", out],
      ["-x", state],
    ],
  );
});

test("any secret pattern in a Terminal window refuses the screenshot (FR-34)", async (t) => {
  for (const secret of [
    "ghs_" + "abc123",
    "lin_api_" + "abc123",
    "sk-ant-" + "abc",
    "github_pat_" + "abc",
    "-----BEGIN " + "PRIVATE KEY-----",
  ]) {
    const sb = await sandbox(t, { stdout: `line\n  ${secret}\n` });
    const r = await sb.run(["zsh", SCRIPT]);
    assert.equal(r.code, 1, secret);
    assert.equal(r.stderr, REFUSED);
    assert.equal(r.stdout, "");
    assert.deepEqual(sb.calls("screencapture"), []);
  }
});

test("an unreadable Terminal refuses the screenshot (fails closed)", async (t) => {
  const sb = await sandbox(t, { stderr: "execution error: Not authorized (-1743)\n", exit: 1 });
  const r = await sb.run(["zsh", SCRIPT]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "shot: cannot read the Terminal windows; no screenshot\n");
  assert.deepEqual(sb.calls("screencapture"), []);
});

test("without its secrets lib shot refuses (fails closed)", async (t) => {
  const sb = await sandbox(t, { stdout: "x\n" });
  const copy = path.join(sb.dir, "copy/bin/shot");
  fs.mkdirSync(path.dirname(copy), { recursive: true });
  fs.copyFileSync(SCRIPT, copy);
  const r = await sb.run(["zsh", copy]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /shot: cannot load .*secrets\.zsh; no screenshot\n$/);
  assert.deepEqual(sb.calls("screencapture"), []);
});

test("a failed capture fails", async (t) => {
  const sb = await sandbox(t, { stdout: "x\n" }, { exit: 1 });
  const r = await sb.run(["zsh", SCRIPT]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "shot: screencapture failed; no screenshot\n");
});

test("extra or option arguments are a usage error", async (t) => {
  const sb = await sandbox(t, { stdout: "x\n" });
  for (const args of [["a.png", "b.png"], ["--x"], ["-h", "x"]]) {
    const r = await sb.run(["zsh", SCRIPT, ...args]);
    assert.equal(r.code, 2, args.join(" "));
    assert.equal(r.stderr, "shot: usage: shot [out.png]\n");
    assert.equal(r.stdout, "");
  }
  assert.deepEqual(sb.calls(), []);
  assert.ok(!fs.existsSync(path.join(sb.home, "apm")));
});

test("-h prints the usage to stdout and calls nothing", async (t) => {
  const sb = await Sandbox.create(t);
  const r = await sb.run(["zsh", SCRIPT, "-h"], { input: "probe\n" });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, "");
  assert.match(r.stdout, /^shot \[out\.png\] /);
  assert.deepEqual(sb.calls(), []);
  assert.ok(!fs.existsSync(path.join(sb.home, "apm")));
});

test("an unwritable ~/apm/state refuses the screenshot", async (t) => {
  const sb = await sandbox(t, { stdout: "x\n" });
  fs.writeFileSync(path.join(sb.home, "apm"), "");
  const r = await sb.run(["zsh", SCRIPT]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "shot: cannot make ~/apm/state; no screenshot\n");
  assert.deepEqual(sb.calls(), []);
});
