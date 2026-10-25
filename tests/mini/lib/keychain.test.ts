import assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox, type FakeRule } from "../../lib/sandbox.ts";

const LIB = path.join(REPO, "mini/lib/keychain.zsh");
// Sourced by the mini's zsh scripts and by runbook steps over ssh: both shells must agree.
const SHELLS = [
  ["zsh", "-c"],
  ["sh", "-c"],
] as const;
const FOUND: FakeRule = { argv: ["find-generic-password"], stdout: "k3y\n" };
const MISSING: FakeRule = {
  argv: ["find-generic-password"],
  stderr: "security: SecKeychainSearchCopyNext: The specified item could not be found.\n",
  exit: 44,
};

async function lib(t: Parameters<typeof Sandbox.create>[0], call: string, rule: FakeRule) {
  const results = [];
  for (const [shell, flag] of SHELLS) {
    const sb = await Sandbox.create(t);
    sb.fake("security", [rule]);
    const r = await sb.run([shell, flag, `. "$1" && ${call}`, shell, LIB]);
    results.push({ ...r, sb, shell });
  }
  return results;
}

test("keychain_read prints the item's password, by service or service and account", async (t) => {
  const cases: [string, string[]][] = [
    ["keychain_read svc acct | cat", ["find-generic-password", "-s", "svc", "-a", "acct", "-w"]],
    ["keychain_read svc | cat", ["find-generic-password", "-s", "svc", "-w"]],
    [
      "keychain_read svc acct /tmp/x/export.keychain-db | cat",
      ["find-generic-password", "-s", "svc", "-a", "acct", "-w", "/tmp/x/export.keychain-db"],
    ],
  ];
  for (const [call, argv] of cases) {
    for (const r of await lib(t, call, FOUND)) {
      assert.equal(r.code, 0, r.shell + r.stderr);
      assert.equal(r.stdout, "k3y\n", r.shell);
      assert.deepEqual(
        r.sb.calls("security").map((c) => c.argv),
        [argv],
        r.shell,
      );
    }
  }
});

test("keychain_read fails with security's message when the item is missing", async (t) => {
  for (const r of await lib(t, "keychain_read svc acct", MISSING)) {
    assert.equal(r.code, 1, r.shell);
    assert.equal(r.stdout, "", r.shell);
    assert.match(r.stderr, /^security: .*could not be found/, r.shell);
  }
});

test("keychain_has answers without reading the password or printing anything", async (t) => {
  for (const [rule, code] of [
    [FOUND, 0],
    [MISSING, 1],
  ] as const) {
    for (const r of await lib(t, "keychain_has svc acct", rule)) {
      assert.equal(r.code, code, r.shell);
      assert.equal(r.stdout + r.stderr, "", r.shell);
      assert.deepEqual(
        r.sb.calls("security").map((c) => c.argv),
        [["find-generic-password", "-s", "svc", "-a", "acct"]],
        r.shell,
      );
    }
  }
});

test("keychain_has by service alone", async (t) => {
  for (const r of await lib(t, "keychain_has svc", FOUND)) {
    assert.equal(r.code, 0, r.shell);
    assert.deepEqual(
      r.sb.calls("security").map((c) => c.argv),
      [["find-generic-password", "-s", "svc"]],
      r.shell,
    );
  }
});

test("keychain_has in another keychain file", async (t) => {
  for (const r of await lib(t, "keychain_has svc acct /tmp/x/export.keychain-db", FOUND)) {
    assert.equal(r.code, 0, r.shell);
    assert.deepEqual(
      r.sb.calls("security").map((c) => c.argv),
      [["find-generic-password", "-s", "svc", "-a", "acct", "/tmp/x/export.keychain-db"]],
      r.shell,
    );
  }
});

test("anything but a service, an optional account and keychain is a usage error", async (t) => {
  for (const call of [
    "keychain_read",
    "keychain_read a b c d",
    "keychain_has",
    "keychain_has a b c d",
  ]) {
    for (const r of await lib(t, call, FOUND)) {
      assert.equal(r.code, 2, `${r.shell} ${call}`);
      assert.deepEqual(r.sb.calls("security"), [], `${r.shell} ${call}`);
    }
  }
});
