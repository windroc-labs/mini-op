import assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox, type FakeRule } from "../../../lib/sandbox.ts";

const STOREKEY = path.join(REPO, "mini/runbooks/setup-test-env/storekey");
const VIEWER = '{"data":{"viewer":{"name":"Agent role","email":"r@x.com"}}}';
const STORED: FakeRule = { argv: ["find-generic-password"], stdout: "lin_api_stored\n" };

// The canary scenario (tests/lib/canary.ts) checks where the password and the key go; these
// cases check the exits and the streams.
async function sandbox(
  t: Parameters<typeof Sandbox.create>[0],
  opts: { clipboard?: string; stored?: FakeRule; curl?: FakeRule } = {},
) {
  const sb = await Sandbox.create(t);
  sb.fake("pbpaste", [{ stdout: opts.clipboard ?? "lin_api_clip" }]);
  sb.fake("pbcopy", [{}]);
  sb.fake("security", [{ argv: ["-i"] }, opts.stored ?? STORED]);
  sb.fake("curl", [opts.curl ?? { stdout: VIEWER }]);
  const run = (args = ["svc", "acct"]) => sb.run(["zsh", STOREKEY, ...args], { input: "pw\n" });
  return { sb, run };
}

const added = (sb: Sandbox) =>
  sb
    .calls("security")
    .map((c) => c.stdin)
    .filter((s) => s.startsWith("add-generic-password"));

test("stores the clipboard key, clears the clipboard and prints the viewer", async (t) => {
  const { sb, run } = await sandbox(t);
  const r = await run();
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, `${VIEWER}\n`);
  assert.equal(r.stderr, "");
  assert.deepEqual(added(sb), [
    'add-generic-password -U -s svc -a acct -l "svc" -w "lin_api_clip"\n',
  ]);
  assert.deepEqual(
    sb.calls("pbcopy").map((c) => c.stdin),
    ["x"],
  );
  assert.deepEqual(sb.calls("security").at(-1)?.argv, [
    "find-generic-password",
    "-s",
    "svc",
    "-a",
    "acct",
    "-w",
  ]);
  assert.equal(sb.calls("curl")[0]?.stdin, "Authorization: lin_api_stored\n");
});

test("a clipboard without a Linear key exits 1 and stores nothing", async (t) => {
  const { sb, run } = await sandbox(t, { clipboard: "hello" });
  const r = await run();
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "storekey: clipboard holds no Linear key; stored nothing\n");
  assert.deepEqual(added(sb), []);
  assert.deepEqual(sb.calls("pbcopy"), []);
  assert.deepEqual(sb.calls("curl"), []);
});

test("a key missing from the keychain after storing exits 1", async (t) => {
  const { run } = await sandbox(t, {
    stored: { argv: ["find-generic-password"], stderr: "security: not found\n", exit: 44 },
    curl: { stdout: '{"errors":[]}' },
  });
  const r = await run();
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '{"errors":[]}\n');
  assert.equal(r.stderr, "security: not found\nstorekey: svc/acct is not in the keychain\n");
});

test("a failed check request exits 1 with curl's rc", async (t) => {
  const { run } = await sandbox(t, { curl: { exit: 6 } });
  const r = await run();
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "\n");
  assert.equal(r.stderr, "storekey: the check's curl exited 6\n");
});

test("anything but a service and an account name is a usage error", async (t) => {
  const { sb, run } = await sandbox(t);
  const bad = [[], ["svc"], ["svc", "acct", "x"], ["--no-such-option", "a"], ["svc", "-x"]];
  for (const args of [...bad, ["-h", "x"], ["s v", "a"], ["svc", 'a" -A']]) {
    const r = await run(args);
    assert.equal(r.code, 2, args.join(" "));
    assert.equal(r.stderr, "storekey: usage: storekey <service> <account>\n");
    assert.equal(r.stdout, "");
  }
  assert.deepEqual(sb.calls(), []);
});

test("-h prints the usage to stdout and reads neither stdin nor the clipboard", async (t) => {
  const { sb, run } = await sandbox(t);
  const r = await run(["-h"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, "");
  assert.match(r.stdout, /^storekey <service> <account> /);
  assert.deepEqual(sb.calls(), []);
});
