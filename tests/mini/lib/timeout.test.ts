import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox } from "../../lib/sandbox.ts";

const LIB = path.join(REPO, "mini/lib/timeout.zsh");
// Sourced by the mini's zsh scripts and by ssh's remote shell: both must agree.
const SHELLS = [
  ["zsh", "-fc"],
  ["sh", "-c"],
] as const;

// Runs `call` after sourcing the lib in each shell, each in a fresh sandbox; `setup` fakes tools.
async function lib(
  t: Parameters<typeof Sandbox.create>[0],
  call: string,
  opts: { input?: string; setup?: (sb: Sandbox) => void } = {},
) {
  const results = [];
  for (const [shell, flag] of SHELLS) {
    const sb = await Sandbox.create(t);
    opts.setup?.(sb);
    const r = await sb.run([shell, flag, `. "$1" && ${call}`, shell, LIB], { input: opts.input });
    results.push({ ...r, sb, shell });
  }
  return results;
}

const countSleeps = (sb: Sandbox) => sb.fake("sleep", [{ ignoresStdin: true }]);
const sleeps = (sb: Sandbox) => sb.calls("sleep").map((call) => call.argv.join(" "));

test("with_timeout passes the status, stdin and stdout", async (t) => {
  for (const r of await lib(t, "with_timeout 5 true")) assert.equal(r.code, 0, r.shell);
  for (const r of await lib(t, "with_timeout 5 false")) assert.equal(r.code, 1, r.shell);
  for (const r of await lib(t, "with_timeout 5 sh -c 'exit 3'")) assert.equal(r.code, 3, r.shell);
  for (const r of await lib(t, "with_timeout 5 cat", { input: "in\n" })) {
    assert.equal(r.code, 0, r.shell);
    assert.equal(r.stdout, "in\n", r.shell);
  }
});

test("with_timeout exits 124 on timeout", async (t) => {
  const call =
    'start=$(date +%s); with_timeout 1 sleep 5; rc=$?; echo "$rc $(($(date +%s) - start))"';
  for (const r of await lib(t, call)) {
    const [rc, secs] = r.stdout.trim().split(" ").map(Number);
    assert.equal(rc, 124, r.shell);
    assert.ok(secs! <= 3, `${r.shell}: took ${secs} s`);
    // sh reports the SIGALRM death itself on stderr; zsh, the mini's shell, says nothing.
    if (r.shell === "zsh") assert.equal(r.stderr, "");
  }
});

test("with_timeout runs no shell and no function", async (t) => {
  for (const r of await lib(t, "with_timeout 5 'x;touch f'")) {
    assert.equal(r.code, 127, r.shell);
    assert.equal(fs.existsSync(path.join(r.sb.dir, "f")), false, r.shell);
    assert.equal(fs.existsSync(path.join(r.sb.dir, "x;touch f")), false, r.shell);
  }
  for (const r of await lib(t, "fn() { return 0; }; with_timeout 5 fn")) {
    assert.equal(r.code, 127, r.shell);
  }
});

test("poll returns 0 once the command succeeds, sleeping between tries", async (t) => {
  // A function in the current shell: it counts its tries in a variable poll's caller sees.
  const call = 'n=0; try() { n=$((n + 1)); [ "$n" -ge 3 ]; }; poll 5 0.5 try; echo "rc=$? n=$n"';
  for (const r of await lib(t, call, { setup: countSleeps })) {
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, "rc=0 n=3\n", r.shell);
    assert.deepEqual(sleeps(r.sb), ["0.5", "0.5"], r.shell);
  }
  for (const r of await lib(t, "poll 3 1 true", { setup: countSleeps })) {
    assert.equal(r.code, 0, r.shell);
    assert.deepEqual(sleeps(r.sb), [], r.shell);
  }
});

test("poll returns 124 after its tries, with no sleep after the last", async (t) => {
  for (const r of await lib(t, "poll 4 2 false", { setup: countSleeps })) {
    assert.equal(r.code, 124, r.shell);
    assert.deepEqual(sleeps(r.sb), ["2", "2", "2"], r.shell);
  }
  for (const r of await lib(t, "poll 1 2 false", { setup: countSleeps })) {
    assert.equal(r.code, 124, r.shell);
    assert.deepEqual(sleeps(r.sb), [], r.shell);
  }
});

test("backoff returns 0 once the command succeeds, doubling its gaps up to the cap", async (t) => {
  const call =
    'n=0; try() { n=$((n + 1)); [ "$n" -ge 5 ]; }; backoff 60 1 4 try; echo "rc=$? n=$n"';
  for (const r of await lib(t, call, { setup: countSleeps })) {
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, "rc=0 n=5\n", r.shell);
    assert.deepEqual(sleeps(r.sb), ["1", "2", "4", "4"], r.shell);
  }
  for (const r of await lib(t, "backoff 60 1 4 true", { setup: countSleeps })) {
    assert.equal(r.code, 0, r.shell);
    assert.deepEqual(sleeps(r.sb), [], r.shell);
  }
});

test("backoff returns 124 once its seconds ran out, the last gap cut to fit", async (t) => {
  for (const r of await lib(t, "backoff 20 2 8 false", { setup: countSleeps })) {
    assert.equal(r.code, 124, r.shell);
    assert.deepEqual(sleeps(r.sb), ["2", "4", "8", "6"], r.shell);
  }
  for (const r of await lib(t, "backoff 1 5 5 false", { setup: countSleeps })) {
    assert.equal(r.code, 124, r.shell);
    assert.deepEqual(sleeps(r.sb), ["1"], r.shell);
  }
});

// AC15: secs and tries match ^[1-9][0-9]*$, so 0 and a leading zero are refused; the interval
// matches ^[0-9]+(\.[0-9]+)?$. backoff's three numbers are secs-like, its first gap within its cap.
test("bad arguments return 2 and run nothing", async (t) => {
  const calls = [
    "with_timeout",
    "with_timeout 5",
    "with_timeout 0 touch ran",
    "with_timeout 05 touch ran",
    "with_timeout -1 touch ran",
    "with_timeout 1.5 touch ran",
    "with_timeout x touch ran",
    "with_timeout '' touch ran",
    "poll",
    "poll 3 1",
    "poll 0 1 touch ran",
    "poll 03 1 touch ran",
    "poll x 1 touch ran",
    "poll 3 '' touch ran",
    "poll 3 .5 touch ran",
    "poll 3 1. touch ran",
    "poll 3 1.2.3 touch ran",
    "poll 3 -1 touch ran",
    "poll 3 '1;x' touch ran",
    "backoff",
    "backoff 9 1 4",
    "backoff 0 1 4 touch ran",
    "backoff 9 0 4 touch ran",
    "backoff 9 01 4 touch ran",
    "backoff 9 1 1.5 touch ran",
    "backoff 9 1 -4 touch ran",
    "backoff 9 '1;x' 4 touch ran",
    "backoff 9 '' 4 touch ran",
    "backoff 9 5 4 touch ran",
  ];
  for (const call of calls) {
    for (const r of await lib(t, call, { setup: countSleeps })) {
      assert.equal(r.code, 2, `${r.shell}: ${call}`);
      assert.equal(fs.existsSync(path.join(r.sb.dir, "ran")), false, `${r.shell}: ${call}`);
      assert.deepEqual(sleeps(r.sb), [], `${r.shell}: ${call}`);
    }
  }
});
