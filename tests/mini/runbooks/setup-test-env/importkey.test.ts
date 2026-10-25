import assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox, type FakeRule } from "../../../lib/sandbox.ts";

const IMPORTKEY = path.join(REPO, "mini/runbooks/setup-test-env/importkey");
const EXPORT = "/tmp/apm.x/export.keychain-db";
const READ = ["find-generic-password", "-s", "svc", "-a", "acct", "-w", EXPORT];
const IN_LOGIN = ["find-generic-password", "-s", "svc", "-a", "acct", "login.keychain"];
const UNLOCK = `unlock-keychain -p "pw" login.keychain\nunlock-keychain -p "pw" "${EXPORT}"\n`;

// The canary scenario (tests/lib/canary.ts) checks where the password and the item go; these cases
// check the exits, the streams and what reaches security.
async function sandbox(
  t: Parameters<typeof Sandbox.create>[0],
  opts: { value?: string; inExport?: FakeRule; inLogin?: FakeRule } = {},
) {
  const sb = await Sandbox.create(t);
  sb.fake("security", [
    { argv: ["-i"] },
    { argv: READ, stdout: `${opts.value ?? "v4lue x"}\n` },
    { argv: IN_LOGIN, ...opts.inLogin },
    { argv: ["find-generic-password"], ...opts.inExport },
    { argv: ["lock-keychain"] },
  ]);
  const run = (args = [EXPORT, "svc", "acct"]) =>
    sb.run(["zsh", IMPORTKEY, ...args], { input: "pw\n" });
  return { sb, run };
}

const interactive = (sb: Sandbox) =>
  sb
    .calls("security")
    .filter((c) => c.argv[0] === "-i")
    .map((c) => c.stdin);
const lastArgv = (sb: Sandbox) => sb.calls("security").at(-1)?.argv;

test("copies the item into the login keychain, locks the export and prints the check", async (t) => {
  const { sb, run } = await sandbox(t);
  const r = await run();
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "importkey: svc/acct imported\n");
  assert.equal(r.stderr, "");
  assert.deepEqual(interactive(sb), [
    UNLOCK,
    'add-generic-password -U -s svc -a acct -l "svc" -w "v4lue x" login.keychain\n',
  ]);
  assert.ok(sb.calls("security").some((c) => c.argv.join(" ") === IN_LOGIN.join(" ")));
  assert.deepEqual(lastArgv(sb), ["lock-keychain", EXPORT]);
  for (const call of sb.calls("security")) {
    assert.ok(!call.argv.join(" ").includes("pw") && !call.argv.join(" ").includes("v4lue"));
  }
});

test("names with + and : (role accounts, gh:github.com) are imported", async (t) => {
  const sb = await Sandbox.create(t);
  const s = "gh:github.com";
  const a = "dotpm2026+pm@outlook.com";
  sb.fake("security", [
    { argv: ["-i"] },
    { argv: ["find-generic-password", "-s", s, "-a", a, "-w", EXPORT], stdout: "v4lue\n" },
    { argv: ["find-generic-password"] },
    { argv: ["lock-keychain"] },
  ]);
  const r = await sb.run(["zsh", IMPORTKEY, EXPORT, s, a], { input: "pw\n" });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, `importkey: ${s}/${a} imported\n`);
  assert.equal(
    interactive(sb)[1],
    `add-generic-password -U -s ${s} -a ${a} -l "${s}" -w "v4lue" login.keychain\n`,
  );
});

test("a new service stores the item under it, with the old account", async (t) => {
  const { sb, run } = await sandbox(t);
  const inNew = ["find-generic-password", "-s", "new", "-a", "acct", "login.keychain"];
  const r = await run([EXPORT, "svc", "acct", "new"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "importkey: svc/acct imported as new/acct\n");
  assert.equal(r.stderr, "");
  assert.equal(
    interactive(sb)[1],
    'add-generic-password -U -s new -a acct -l "new" -w "v4lue x" login.keychain\n',
  );
  assert.ok(sb.calls("security").some((c) => c.argv.join(" ") === inNew.join(" ")));
  assert.deepEqual(lastArgv(sb), ["lock-keychain", EXPORT]);
});

test("a new service and account store the item under both", async (t) => {
  const { sb, run } = await sandbox(t);
  const inNew = ["find-generic-password", "-s", "new", "-a", "acct2", "login.keychain"];
  const r = await run([EXPORT, "svc", "acct", "new", "acct2"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "importkey: svc/acct imported as new/acct2\n");
  assert.equal(
    interactive(sb)[1],
    'add-generic-password -U -s new -a acct2 -l "new" -w "v4lue x" login.keychain\n',
  );
  assert.ok(sb.calls("security").some((c) => c.argv.join(" ") === inNew.join(" ")));
});

test("a renamed item missing from the login keychain afterwards exits 1", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("security", [
    { argv: ["-i"] },
    { argv: READ, stdout: "v4lue\n" },
    { argv: ["find-generic-password", "-s", "new", "-a", "acct2", "login.keychain"], exit: 44 },
    { argv: ["find-generic-password"] },
    { argv: ["lock-keychain"] },
  ]);
  const r = await sb.run(["zsh", IMPORTKEY, EXPORT, "svc", "acct", "new", "acct2"], {
    input: "pw\n",
  });
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "importkey: new/acct2 is not in the login keychain\n");
});

test("an item missing from the export exits 1 and imports nothing", async (t) => {
  const { sb, run } = await sandbox(t, { inExport: { exit: 44 } });
  const r = await run();
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, `importkey: svc/acct not in ${EXPORT}; imported nothing\n`);
  assert.deepEqual(interactive(sb), [UNLOCK]);
  assert.deepEqual(lastArgv(sb), ["lock-keychain", EXPORT]);
});

test("an item whose password cannot be read exits 1 and imports nothing", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("security", [
    { argv: ["-i"] },
    { argv: READ, stderr: "security: User interaction is not allowed.\n", exit: 36 },
    { argv: ["find-generic-password"] },
    { argv: ["lock-keychain"] },
  ]);
  const r = await sb.run(["zsh", IMPORTKEY, EXPORT, "svc", "acct"], { input: "pw\n" });
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, `importkey: cannot read svc/acct from ${EXPORT}; imported nothing\n`);
  assert.deepEqual(interactive(sb), [UNLOCK]);
  assert.deepEqual(lastArgv(sb), ["lock-keychain", EXPORT]);
});

test("a value with a quote, backslash or newline exits 1 and imports nothing", async (t) => {
  for (const value of ['a"b', "a\\b", "a\nb"]) {
    const { sb, run } = await sandbox(t, { value });
    const r = await run();
    assert.equal(r.code, 1, value);
    assert.equal(r.stdout, "");
    assert.equal(
      r.stderr,
      "importkey: svc/acct holds a quote, backslash or newline; imported nothing\n",
    );
    assert.deepEqual(interactive(sb), [UNLOCK]);
    assert.deepEqual(lastArgv(sb), ["lock-keychain", EXPORT]);
  }
});

test("an item missing from the login keychain afterwards exits 1", async (t) => {
  const { sb, run } = await sandbox(t, { inLogin: { exit: 44 } });
  const r = await run();
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "importkey: svc/acct is not in the login keychain\n");
  assert.equal(interactive(sb).length, 2);
  assert.deepEqual(lastArgv(sb), ["lock-keychain", EXPORT]);
});

test("bad arguments are usage errors that read and call nothing", async (t) => {
  const { sb } = await sandbox(t);
  for (const args of [
    [],
    [EXPORT, "svc"],
    [EXPORT, "svc", "acct", "new", "acct2", "x"],
    [EXPORT, "svc", "acct", "-new"],
    [EXPORT, "svc", "acct", "new", "a;b"],
    [EXPORT, "svc", "acct", ""],
    ["", "svc", "acct"],
    ["/tmp/a b", "svc", "acct"],
    ["/tmp/a'b", "svc", "acct"],
    ['/tmp/a"b', "svc", "acct"],
    ["/tmp/a\\b", "svc", "acct"],
    ["/tmp/a\nb", "svc", "acct"],
    [EXPORT, "-svc", "acct"],
    [EXPORT, "svc", "a;b"],
    [EXPORT, "svc", "$(x)"],
  ]) {
    const r = await sb.run(["zsh", IMPORTKEY, ...args], { input: "pw\n" });
    assert.equal(r.code, 2, JSON.stringify(args));
    assert.equal(r.stdout, "");
    assert.equal(
      r.stderr,
      "importkey: usage: importkey <keychain> <service> <account> [<new-service> [<new-account>]]\n",
    );
  }
  assert.deepEqual(sb.calls(), []);
});

test("-h prints the usage to stdout and calls nothing", async (t) => {
  const { sb } = await sandbox(t);
  const r = await sb.run(["zsh", IMPORTKEY, "-h"]);
  assert.equal(r.code, 0);
  assert.equal(r.stderr, "");
  assert.match(
    r.stdout,
    /^importkey <keychain> <service> <account> \[<new-service> \[<new-account>\]\] /,
  );
  for (const part of ["password on stdin", "login keychain", "Exits 0, 1", "2 (usage error)"]) {
    assert.ok(r.stdout.includes(part), part);
  }
  assert.deepEqual(sb.calls(), []);
});
