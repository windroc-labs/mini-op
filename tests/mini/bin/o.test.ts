import assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox } from "../../lib/sandbox.ts";

const O = path.join(REPO, "mini/bin/o");

test("o runs opencli browser with its args and exits as opencli does", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("opencli", [
    { argv: ["browser", "open"], stdout: '{"data":"ok"}\n' },
    { argv: ["browser", "eval"], stderr: "no session\n", exit: 1 },
  ]);
  const ok = await sb.run(["zsh", O, "open", "https://linear.app", "--session", "role"]);
  assert.equal(ok.code, 0, ok.stderr);
  assert.equal(ok.stdout, '{"data":"ok"}\n');
  assert.deepEqual(sb.calls("opencli")[0]?.argv, [
    "browser",
    "open",
    "https://linear.app",
    "--session",
    "role",
  ]);
  const failed = await sb.run(["zsh", O, "eval", "1", "--session", "x"]);
  assert.equal(failed.code, 1);
  assert.equal(failed.stderr, "no session\n");
});

test("opencli's dirs come after PATH, so the sandbox's opencli is the one run", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("opencli", [{}]);
  const r = await sb.run(["zsh", O, "list"]);
  assert.equal(r.code, 0, r.stderr);
  const dirs = sb.calls("opencli")[0]?.env.PATH?.split(":") ?? [];
  assert.equal(dirs[0], path.join(sb.dir, "bin"));
  assert.deepEqual(dirs.slice(-2), [path.join("/usr", "local/bin"), `${sb.home}/.npm-global/bin`]);
});

test("no command or a leading option is a usage error and runs nothing", async (t) => {
  const sb = await Sandbox.create(t);
  for (const args of [[], [""], ["--session", "x"], ["-h", "x"]]) {
    const r = await sb.run(["zsh", O, ...args]);
    assert.equal(r.code, 2, args.join(" "));
    assert.equal(r.stderr, "o: usage: o <command> [args...]\n");
    assert.equal(r.stdout, "");
  }
  assert.deepEqual(sb.calls(), []);
});

test("-h prints the usage to stdout and calls nothing", async (t) => {
  const sb = await Sandbox.create(t);
  const r = await sb.run(["zsh", O, "-h"], { input: "probe\n" });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, "");
  assert.match(r.stdout, /^o <command> /);
  assert.deepEqual(sb.calls(), []);
});
