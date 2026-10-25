import assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox, type FakeRule } from "../lib/sandbox.ts";

const RESUME = path.join(REPO, "host/resume");
const START_PROXY = ["start", "mini-op-proxy"];
const RUNNING = ["inspect", "-f", "{{.State.Running}}", "mini-op-proxy"];
const START_OP = ["start", "mini-op"];

async function resume(
  t: Parameters<typeof Sandbox.create>[0],
  rules: FakeRule[],
  args: string[] = [],
) {
  const sb = await Sandbox.create(t);
  sb.fake("docker", rules);
  const r = await sb.run(["bash", RESUME, ...args]);
  return { sb, r, argv: sb.calls("docker").map((call) => call.argv) };
}

test("starts the proxy, confirms it runs, then starts mini-op", async (t) => {
  const { r, argv } = await resume(t, [
    { argv: START_PROXY, stdout: "mini-op-proxy\n" },
    { argv: RUNNING, stdout: "true\n" },
    { argv: START_OP, stdout: "mini-op\n" },
  ]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(argv, [START_PROXY, RUNNING, START_OP]);
  assert.equal(
    r.stdout,
    "resumed mini-op-proxy and mini-op; give mini-op the mini's password again (host/README.md step 4)\n",
  );
});

test("a proxy that fails to start leaves mini-op stopped and exits 1", async (t) => {
  const { r, argv } = await resume(t, [
    { argv: START_PROXY, stderr: "Error: No such container\n", exit: 1 },
    { argv: START_OP },
  ]);
  assert.equal(r.code, 1);
  assert.deepEqual(argv, [START_PROXY]);
  assert.match(r.stderr, /^resume: mini-op-proxy did not start; mini-op not started/m);
});

test("a proxy that exits right after starting leaves mini-op stopped and exits 1", async (t) => {
  const { r, argv } = await resume(t, [
    { argv: START_PROXY },
    { argv: RUNNING, stdout: "false\n" },
    { argv: START_OP },
  ]);
  assert.equal(r.code, 1);
  assert.deepEqual(argv, [START_PROXY, RUNNING]);
  assert.equal(r.stderr, "resume: mini-op-proxy is not running; mini-op not started\n");
});

test("mini-op failing to start exits 1", async (t) => {
  const { r } = await resume(t, [
    { argv: START_PROXY },
    { argv: RUNNING, stdout: "true\n" },
    { argv: START_OP, exit: 1 },
  ]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "resume: mini-op did not start\n");
});

test("-h prints the usage; any other argument is a usage error", async (t) => {
  const help = await resume(t, [], ["-h"]);
  assert.equal(help.r.code, 0);
  assert.match(help.r.stdout, /^resume /);
  assert.equal(help.r.stderr, "");
  assert.deepEqual(help.argv, []);
  for (const arg of ["now", "--bogus"]) {
    const bad = await resume(t, [], [arg]);
    assert.equal(bad.r.code, 2);
    assert.equal(bad.r.stdout, "");
    assert.equal(bad.r.stderr, "resume: usage: resume\n");
    assert.deepEqual(bad.argv, []);
  }
});
