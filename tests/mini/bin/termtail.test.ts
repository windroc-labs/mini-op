import assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox } from "../../lib/sandbox.ts";

const TAIL = path.join(REPO, "mini/bin/termtail");

test("termtail reads the last N nonblank redacted lines without driving Terminal", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("osascript", [
    { program: "terminal.js", args: ["contents"], stdout: "old\n\nnew\n\nlast\n" },
  ]);
  const r = await sb.run(["zsh", TAIL, "2"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "new\nlast\n");
  assert.deepEqual(
    sb.calls("osascript").map((c) => [c.program, c.argv.at(-1), c.stdin]),
    [["terminal.js", "contents", ""]],
  );
  sb.fake("osascript", [{ stdout: Array.from({ length: 30 }, (_, i) => `${i}\n`).join("") }]);
  const defaultTail = await sb.run(["zsh", TAIL]);
  assert.equal(defaultTail.code, 0);
  assert.equal(defaultTail.stdout.split("\n").length - 1, 25);
  const all = await sb.run(["zsh", TAIL, "--all"]);
  assert.equal(all.code, 0);
  assert.equal(all.stdout.split("\n").length - 1, 30);
});

test("termtail redacts before truncating, including wrapped tokens and private keys", async (t) => {
  const sb = await Sandbox.create(t);
  const tokens = ["sk-ant-", "lin_api_", "github_pat_", "ghp_"].map(
    (prefix) => prefix + "offline-secret",
  );
  sb.fake("osascript", [
    {
      stdout: [
        "old",
        "Your OAuth token",
        "wrapped-secret",
        "Store this token safely",
        ...tokens,
        "-----BEGIN RSA PRIVATE KEY-----",
        "private-body",
        "-----END RSA PRIVATE KEY-----",
      ].join("\n"),
    },
  ]);
  const r = await sb.run(["zsh", TAIL]);
  assert.equal(r.code, 0, r.stderr);
  for (const secret of [...tokens, "wrapped-secret", "private-body"])
    assert.ok(!r.stdout.includes(secret));
  assert.match(r.stdout, /<token hidden>/);
  assert.match(r.stdout, /<redacted private key>/);
});

test("termtail fails closed when contents cannot be read or times out", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("osascript", [{ stdout: "untrusted partial", stderr: "cannot read", exit: 1 }]);
  const failed = await sb.run(["zsh", TAIL]);
  assert.equal(failed.code, 1);
  assert.equal(failed.stdout, "");
  assert.match(failed.stderr, /termtail: cannot read Terminal/);
  sb.fake("osascript", [{ shell: "kill -ALRM $PPID" }]);
  const timed = await sb.run(["zsh", TAIL]);
  assert.equal(timed.code, 124);
  assert.equal(timed.stdout, "");
  assert.match(timed.stderr, /termtail: killed after 5 s/);
});

test("termtail rejects bad arguments and help reads nothing", async (t) => {
  const sb = await Sandbox.create(t);
  for (const args of [["0"], ["-1"], ["x"], ["2", "3"], ["--bad"], ["-h", "x"]]) {
    const r = await sb.run(["zsh", TAIL, ...args]);
    assert.equal(r.code, 2);
  }
  const help = await sb.run(["zsh", TAIL, "-h"]);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /^termtail /);
  assert.deepEqual(sb.calls(), []);
});
