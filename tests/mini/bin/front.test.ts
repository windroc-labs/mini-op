import assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox } from "../../lib/sandbox.ts";

const FRONT = path.join(REPO, "mini/bin/front");

test("front runs front.js with the URL part and passes its result on", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("osascript", [
    { program: "front.js", args: ["linear.app"], stdout: "front\n" },
    { program: "front.js", stderr: "front: no Chrome tab's URL contains x\n", exit: 1 },
  ]);
  const ok = await sb.run(["zsh", FRONT, "linear.app"]);
  assert.equal(ok.code, 0, ok.stderr);
  assert.equal(ok.stdout, "front\n");
  assert.deepEqual(sb.calls("osascript")[0]?.argv.slice(0, 2), ["-l", "JavaScript"]);
  const none = await sb.run(["zsh", FRONT, "x"]);
  assert.equal(none.code, 1);
  assert.match(none.stderr, /front: no Chrome tab/);
});

test("anything but one non-empty URL part is a usage error", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("osascript", [{}]);
  for (const args of [[], [""], ["a", "b"], ["--no-such-option"], ["-h", "x"]]) {
    const r = await sb.run(["zsh", FRONT, ...args]);
    assert.equal(r.code, 2, args.join(" "));
    assert.equal(r.stderr, "front: usage: front <url-substring>\n");
    assert.equal(r.stdout, "");
  }
  assert.deepEqual(sb.calls(), []);
});

test("-h prints the usage to stdout and calls nothing", async (t) => {
  const sb = await Sandbox.create(t);
  const r = await sb.run(["zsh", FRONT, "-h"], { input: "probe\n" });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, "");
  assert.match(r.stdout, /^front <url-substring> /);
  assert.deepEqual(sb.calls(), []);
});
