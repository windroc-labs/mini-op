import assert from "node:assert/strict";
import * as fs from "node:fs";
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
    "--window",
    "foreground",
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

test("caller window options are refused before any browser action", async (t) => {
  const sb = await Sandbox.create(t);
  for (const args of [
    ["state", "--window", "foreground"],
    ["state", "--window=foreground"],
    ["state", "--window", "background"],
    ["state", "--window"],
    ["state", "--window=background"],
  ]) {
    const bad = await sb.run(["zsh", O, ...args]);
    assert.equal(bad.code, 2);
  }
  assert.deepEqual(sb.calls(), []);
});

test("private mode hides Chrome before OpenCLI and never adds foreground", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("osascript", [{ program: "chrome.js", args: ["hide"] }]);
  sb.fake("opencli", [{ stdout: "private result", exit: 7 }]);
  const r = await sb.run(["zsh", O, "eval", "1", "--private", "--session", "mail"]);
  assert.equal(r.code, 7);
  assert.equal(r.stdout, "private result");
  assert.deepEqual(
    sb.calls().map((c) => c.cmd),
    ["osascript", "opencli"],
  );
  assert.deepEqual(sb.calls("opencli")[0]?.argv, [
    "browser",
    "eval",
    "1",
    "--session",
    "mail",
    "--window",
    "background",
  ]);
  sb.fake("osascript", [{ exit: 1 }]);
  const failed = await sb.run(["zsh", O, "state", "--private"]);
  assert.equal(failed.code, 1);
  assert.equal(sb.calls("opencli").length, 1);
  const mixed = await sb.run(["zsh", O, "state", "--private", "--window", "foreground"]);
  assert.equal(mixed.code, 2);
});

const JS = `document.querySelector("a[href='/x']")?.textContent; // "quoted" $HOME \`x\` \\n
[1, 2].map((n) => n * 2);`;
const EVAL = (js: string, window: string) => [
  "browser",
  "eval",
  js,
  "--session",
  "role",
  "--window",
  window,
];

test("evalfile runs the file's JS as one argv word, with no shell quoting", async (t) => {
  const sb = await Sandbox.create(t);
  const file = path.join(sb.home, "read.js");
  fs.writeFileSync(file, `${JS}\n`);
  sb.fake("opencli", [{ stdout: '{"data":4}\n', exit: 3 }]);
  const r = await sb.run(["zsh", O, "evalfile", "role", file]);
  assert.equal(r.code, 3, r.stderr);
  assert.equal(r.stdout, '{"data":4}\n');
  assert.deepEqual(sb.calls("opencli")[0]?.argv, EVAL(JS, "foreground"));
  const piped = await sb.run(["zsh", O, "evalfile", "role", "/dev/stdin"], { stdinFile: file });
  assert.equal(piped.code, 3, piped.stderr);
  assert.deepEqual(sb.calls("opencli")[1]?.argv, EVAL(JS, "foreground"));
});

test("evalfile --private hides Chrome and uses a background window", async (t) => {
  const sb = await Sandbox.create(t);
  const file = path.join(sb.home, "read.js");
  fs.writeFileSync(file, JS);
  sb.fake("osascript", [{ program: "chrome.js", args: ["hide"] }]);
  sb.fake("opencli", [{}]);
  const r = await sb.run(["zsh", O, "evalfile", "--private", "role", file]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(
    sb.calls().map((c) => c.cmd),
    ["osascript", "opencli"],
  );
  assert.deepEqual(sb.calls("opencli")[0]?.argv, EVAL(JS, "background"));
});

test("evalfile refuses a missing, unreadable or empty file and runs nothing", async (t) => {
  const sb = await Sandbox.create(t);
  const empty = path.join(sb.home, "empty.js");
  fs.writeFileSync(empty, " \n\n");
  const missing = path.join(sb.home, "missing.js");
  for (const [file, stderr] of [
    [missing, `o: cannot read ${missing}\n`],
    [sb.home, `o: cannot read ${sb.home}\n`],
    [empty, `o: ${empty} is empty\n`],
  ] as const) {
    const r = await sb.run(["zsh", O, "evalfile", "role", file, "--private"]);
    assert.equal(r.code, 1, file);
    assert.equal(r.stderr, stderr);
    assert.equal(r.stdout, "");
  }
  assert.deepEqual(sb.calls(), []);
});

test("evalfile with a wrong arg count or an option-like word is a usage error", async (t) => {
  const sb = await Sandbox.create(t);
  for (const args of [
    ["evalfile"],
    ["evalfile", "role"],
    ["evalfile", "role", "a.js", "b.js"],
    ["evalfile", "-x", "a.js"],
    ["evalfile", "role", "-a.js"],
    ["evalfile", "role", ""],
  ]) {
    const r = await sb.run(["zsh", O, ...args]);
    assert.equal(r.code, 2, args.join(" "));
    assert.equal(r.stderr, "o: usage: o evalfile <session> <file.js> [--private]\n");
  }
  assert.deepEqual(sb.calls(), []);
  const help = await sb.run(["zsh", O, "-h"]);
  assert.match(help.stdout, /\no evalfile <session> <file\.js> \[--private\] /);
});
