import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox, type FakeRule } from "../../../lib/sandbox.ts";

const LQ = path.join(REPO, "mini/runbooks/setup-test-env/lq");
const KEYCHAIN = ["find-generic-password", "-s", "ensemble-test-linear-key", "-a", "ensemble-test"];
const NOT_FOUND: FakeRule = {
  argv: ["find-generic-password"],
  stderr: "security: SecKeychainSearchCopyNext: The specified item could not be found.\n",
  exit: 44,
};

async function sandbox(
  t: Parameters<typeof Sandbox.create>[0],
  security: FakeRule = { argv: ["find-generic-password"], stdout: "lin_api_k\n" },
  curl: FakeRule = { stdout: '{"data":{"viewer":{"id":"u1"}}}' },
) {
  const sb = await Sandbox.create(t);
  sb.fake("security", [security]);
  sb.fake("curl", [curl]);
  const body = path.join(sb.dir, "tmp/body.json");
  fs.writeFileSync(body, '{"query":"{ viewer { id } }"}');
  const run = (args = [body]) => sb.run(["zsh", LQ, ...args]);
  return { sb, body, run };
}

test("sends the body with the keychain key on curl's stdin and prints the reply", async (t) => {
  const { sb, body, run } = await sandbox(t);
  const r = await run();
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, '{"data":{"viewer":{"id":"u1"}}}');
  assert.equal(r.stderr, "");
  assert.deepEqual(
    sb.calls("security").map((c) => c.argv),
    [KEYCHAIN, [...KEYCHAIN, "-w"]],
  );
  const [curl] = sb.calls("curl");
  assert.equal(curl?.stdin, "Authorization: lin_api_k\n");
  assert.deepEqual(curl?.argv, [
    "-s",
    "https://api.linear.app/graphql",
    "-H",
    "@-",
    "-H",
    "Content-Type: application/json",
    "--data-binary",
    `@${body}`,
  ]);
});

test("a body file it cannot read exits 1 before any keychain read", async (t) => {
  const { sb, run } = await sandbox(t);
  const missing = path.join(sb.dir, "tmp/none.json");
  const r = await run([missing]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, `lq: cannot read ${missing}\n`);
  assert.deepEqual(sb.calls(), []);
});

test("no key in the keychain exits 1 without sending a request", async (t) => {
  const { sb, run } = await sandbox(t, NOT_FOUND, { stdout: '{"errors":[]}' });
  const r = await run();
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "lq: no ensemble-test-linear-key key in the keychain\n");
  assert.deepEqual(sb.calls("curl"), []);
  assert.deepEqual(
    sb.calls("security").map((c) => c.argv),
    [KEYCHAIN],
  );
});

test("a failed request exits 1 with curl's rc", async (t) => {
  const { run } = await sandbox(t, undefined, { exit: 7 });
  const r = await run();
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "lq: curl exited 7\n");
});

test("anything but one body file is a usage error", async (t) => {
  const { sb, run } = await sandbox(t);
  for (const args of [[], ["a", "b"], ["--no-such-option"], ["-h", "x"], [""]]) {
    const r = await run(args);
    assert.equal(r.code, 2, args.join(" "));
    assert.equal(r.stderr, "lq: usage: lq <json-body-file>\n");
    assert.equal(r.stdout, "");
  }
  assert.deepEqual(sb.calls(), []);
});

test("-h prints the usage to stdout and reads no key", async (t) => {
  const { sb, run } = await sandbox(t);
  const r = await run(["-h"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, "");
  assert.match(r.stdout, /^lq <json-body-file> /);
  assert.deepEqual(sb.calls(), []);
});
