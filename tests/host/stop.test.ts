import assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox, type FakeRule } from "../lib/sandbox.ts";

const STOP = path.join(REPO, "host/stop");
const inspect = (name: string) => ["inspect", "-f", "{{.Name}}", name];

// fake docker where both containers exist and stop; `extra` rules come first and override.
function docker(extra: FakeRule[] = []): FakeRule[] {
  return [
    ...extra,
    { argv: ["inspect"], stdout: "/x\n" },
    { argv: ["info"], stdout: "Server: x\n" },
    { argv: ["stop"], stdout: "x\n" },
  ];
}

async function stop(
  t: Parameters<typeof Sandbox.create>[0],
  extra?: FakeRule[],
  args: string[] = [],
) {
  const sb = await Sandbox.create(t);
  sb.fake("docker", docker(extra));
  const r = await sb.run(["bash", STOP, ...args]);
  const stops = sb
    .calls("docker")
    .filter((call) => call.argv[0] === "stop")
    .map((call) => call.argv);
  return { sb, r, stops };
}

const MISSING: FakeRule[] = [
  { argv: inspect("mini-op"), stderr: "Error: No such object: mini-op\n", exit: 1 },
];
const DOWN: FakeRule[] = [
  { argv: ["inspect"], stderr: "Cannot connect to the Docker daemon\n", exit: 1 },
  { argv: ["info"], stderr: "Cannot connect to the Docker daemon\n", exit: 1 },
];

test("stops mini-op, then its proxy", async (t) => {
  const { r, stops } = await stop(t);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "stopped mini-op\nstopped mini-op-proxy\n");
  assert.equal(r.stderr, "");
  assert.deepEqual(stops, [
    ["stop", "mini-op"],
    ["stop", "mini-op-proxy"],
  ]);
});

test("a missing container is skipped with a note on stderr", async (t) => {
  const { r, stops } = await stop(t, MISSING);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "stopped mini-op-proxy\n");
  assert.equal(r.stderr, "stop: no container mini-op, skipped\n");
  assert.deepEqual(stops, [["stop", "mini-op-proxy"]]);
});

test("Docker down exits 1 and stops nothing", async (t) => {
  const { r, stops } = await stop(t, DOWN);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "stop: Docker is not reachable\n");
  assert.deepEqual(stops, []);
});

test("a failed stop still stops the proxy, then exits 1", async (t) => {
  const { r, stops } = await stop(t, [
    { argv: ["stop", "mini-op"], stderr: "Error response from daemon: x\n", exit: 1 },
  ]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "stopped mini-op-proxy\n");
  assert.match(r.stderr, /^stop: could not stop mini-op$/m);
  assert.deepEqual(stops, [
    ["stop", "mini-op"],
    ["stop", "mini-op-proxy"],
  ]);
});

test("-h prints the usage to stdout and runs nothing", async (t) => {
  const { sb, r } = await stop(t, [], ["-h"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^stop /);
  assert.equal(r.stderr, "");
  assert.deepEqual(sb.calls(), []);
});

test("any argument is a usage error and runs nothing", async (t) => {
  for (const arg of ["now", "--bogus"]) {
    const { sb, r } = await stop(t, [], [arg]);
    assert.equal(r.code, 2);
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, "stop: usage: stop\n");
    assert.deepEqual(sb.calls(), []);
  }
});
