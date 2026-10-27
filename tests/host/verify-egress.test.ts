import assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox, type FakeRule } from "../lib/sandbox.ts";

const SCRIPT = path.join(REPO, "host/verify-egress");
const ID = "direct-use-id";
const PS = [
  "ps",
  "-q",
  "--no-trunc",
  "--filter",
  "label=windroc.lock=mini-op",
  "--filter",
  "label=windroc.lock.owner=mini-op",
];
const PROMPT = "Reply with exactly: ok";
// The broker hands the Claude token only to a client started through with-secrets.
const CLAUDE = [
  "exec",
  ID,
  "with-secrets",
  "--client",
  "claude",
  "timeout",
  "120",
  "claude",
  "-p",
  PROMPT,
];
const BARE_CLAUDE = ["exec", ID, "timeout", "120", "claude", "-p", PROMPT];
const SSH = [
  "exec",
  ID,
  "timeout",
  "30",
  "ssh",
  "-o",
  "BatchMode=yes",
  "-o",
  "ConnectTimeout=10",
  "mini",
  "echo",
  "ok",
];
async function verify(
  t: Parameters<typeof Sandbox.create>[0],
  extra: FakeRule[] = [],
  args: string[] = [],
) {
  const sb = await Sandbox.create(t);
  sb.fake("docker", [
    ...extra,
    { argv: PS, stdout: ID + "\n" },
    { argv: CLAUDE, stdout: "ok\n" },
    { argv: SSH, stdout: "ok\n" },
  ]);
  const r = await sb.run(["bash", SCRIPT, ...args]);
  return { sb, r };
}

test("only the direct owner is selected and only two end-to-end rows run", async (t) => {
  const { sb, r } = await verify(t);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, "");
  const rows = r.stdout.trim().split("\n");
  assert.equal(rows.length, 2);
  assert.match(rows[0]!, /^claude -p answers\s+\| PASS$/);
  assert.match(rows[1]!, /^ssh mini echo ok\s+\| PASS$/);
  assert.deepEqual(
    sb.calls("docker").map((c) => c.argv),
    [PS, CLAUDE, SSH],
  );
  assert.ok(sb.calls("docker").every((c) => c.stdin === ""));
});

test("no direct container, including a verifier-only host, never execs", async (t) => {
  const { sb, r } = await verify(t, [{ argv: PS, stdout: "" }]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /host\/start/);
  assert.deepEqual(
    sb.calls("docker").map((c) => c.argv),
    [PS],
  );
  assert.ok(PS.includes("label=windroc.lock.owner=mini-op"));
});

test("multiple matching containers or a failed query never exec", async (t) => {
  for (const rule of [{ stdout: "one\ntwo\n" }, { exit: 1 }]) {
    const { sb, r } = await verify(t, [{ argv: PS, ...rule }]);
    assert.equal(r.code, 1);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /host\/start/);
    assert.deepEqual(
      sb.calls("docker").map((c) => c.argv),
      [PS],
    );
  }
});

test("a failed command or wrong reply fails just its row without exposing replies", async (t) => {
  for (const argv of [CLAUDE, SSH]) {
    for (const rule of [{ stdout: "private error reply\n" }, { stdout: "ok\n", exit: 1 }]) {
      const { r } = await verify(t, [{ argv, ...rule, stderr: "private details\n" }]);
      assert.equal(r.code, 1);
      assert.equal(r.stdout.trim().split("\n").length, 2);
      assert.equal(r.stdout.match(/FAIL/g)?.length, 1);
      assert.equal(r.stderr, "");
      assert.ok(!r.stdout.includes("private"));
    }
  }
});

test("Claude without with-secrets never counts as an answer", async (t) => {
  const { sb, r } = await verify(t, [
    { argv: CLAUDE, stdout: "Not logged in\n", exit: 1 },
    { argv: BARE_CLAUDE, stdout: "ok\n" },
  ]);
  assert.equal(r.code, 1);
  assert.match(r.stdout.trim().split("\n")[0]!, /^claude -p answers\s+\| FAIL$/);
  assert.ok(!sb.calls("docker").some((c) => c.argv.join(" ") === BARE_CLAUDE.join(" ")));
});

test("an uppercase Claude OK. reply passes", async (t) => {
  const { r } = await verify(t, [{ argv: CLAUDE, stdout: " OK. \n" }]);
  assert.equal(r.code, 0, r.stdout);
});

test("help runs nothing", async (t) => {
  for (const args of [["-h"], ["--help"]]) {
    const { sb, r } = await verify(t, [], args);
    assert.equal(r.code, 0);
    assert.deepEqual(sb.calls("docker"), []);
  }
});

test("invalid arguments exit 2 without running anything", async (t) => {
  for (const args of [["--egress-only"], ["x"], ["x", "y"]]) {
    const { sb, r } = await verify(t, [], args);
    assert.equal(r.code, 2);
    assert.deepEqual(sb.calls("docker"), []);
  }
});
