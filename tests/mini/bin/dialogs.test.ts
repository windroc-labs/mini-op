import assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox } from "../../lib/sandbox.ts";

const DIALOGS = path.join(REPO, "mini/bin/dialogs");

test("dialogs lists and clicks through dialogs.js", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("osascript", [
    { program: "dialogs.js", args: ["click", "Allow"], stdout: "clicked Allow in X\n" },
    {
      program: "dialogs.js",
      args: ["click"],
      stderr: "dialogs: no window has a button OK\n",
      exit: 1,
    },
    { program: "dialogs.js", stdout: "X | w | Allow, Cancel\n" },
  ]);
  const list = await sb.run(["zsh", DIALOGS]);
  assert.equal(list.code, 0, list.stderr);
  assert.equal(list.stdout, "X | w | Allow, Cancel\n");
  const click = await sb.run(["zsh", DIALOGS, "click", "Allow"]);
  assert.equal(click.stdout, "clicked Allow in X\n");
  const none = await sb.run(["zsh", DIALOGS, "click", "OK"]);
  assert.equal(none.code, 1);
  assert.match(none.stderr, /no window has a button OK/);
});

test("other arguments are usage errors", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("osascript", [{}]);
  for (const args of [
    ["click"],
    ["list"],
    ["click", "a", "b"],
    ["--no-such-option"],
    ["click", "-x"],
    ["-h", "x"],
  ]) {
    const r = await sb.run(["zsh", DIALOGS, ...args]);
    assert.equal(r.code, 2, args.join(" "));
    assert.equal(r.stderr, "dialogs: usage: dialogs [click <button>]\n");
    assert.equal(r.stdout, "");
  }
  assert.deepEqual(sb.calls(), []);
});

test("-h prints the usage to stdout and calls nothing", async (t) => {
  const sb = await Sandbox.create(t);
  const r = await sb.run(["zsh", DIALOGS, "-h"], { input: "probe\n" });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, "");
  assert.match(r.stdout, /^dialogs \[click <button>\] /);
  assert.deepEqual(sb.calls(), []);
});
