import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox, type FakeRule } from "../../lib/sandbox.ts";
import { events, fakeTerminal, SLEEP, sleeps } from "../../lib/terminal.ts";

const TERMWAIT = path.join(REPO, "mini/bin/termwait");
const ID = "1761200000-4242-17";
// With a "finish" file holding "<n> <rc>", the command ends (marker via tmp + mv) during the n-th
// one-second sleep.
const FINISHING_SLEEP = `${SLEEP}
[[ -e $FAKE_DIR/finish ]] || exit 0
read at rc < "$FAKE_DIR/finish"
(( $(wc -l < "$FAKE_DIR/sleeps") == at )) || exit 0
print -r -- "$rc" > "$HOME/apm/state/done/$ID.tmp" && mv "$HOME/apm/state/done/$ID.tmp" "$HOME/apm/state/done/$ID"`;

async function sandbox(t: Parameters<typeof Sandbox.create>[0]) {
  const sb = await Sandbox.create(t);
  sb.mini();
  const done = path.join(sb.home, "apm/state/done");
  fs.mkdirSync(done, { recursive: true });
  const wait = async (
    args: string[],
    opts: { screen?: string; finish?: string; read?: FakeRule } = {},
  ) => {
    fakeTerminal(sb, { screen: opts.screen ?? "Dots-Mac-mini acp-exp % " }, FINISHING_SLEEP);
    if (opts.read)
      sb.fake("osascript", [{ program: "terminal.js", args: ["contents"], ...opts.read }]);
    if (opts.finish !== undefined) fs.writeFileSync(path.join(sb.dir, "finish"), opts.finish);
    return sb.run(["zsh", TERMWAIT, ...args], { env: { ID } });
  };
  return { sb, done, wait };
}

test("a marker written before the wait starts ends it at once", async (t) => {
  const { sb, done, wait } = await sandbox(t);
  fs.writeFileSync(path.join(done, ID), "0\n");
  const r = await wait(["120", "--after", ID], { screen: "ok\nmini ~ % " });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(sleeps(sb), []);
  assert.equal(r.stdout, `ok\nmini ~ % \n${ID} exited 0\n`);
  assert.ok(!fs.existsSync(path.join(done, ID)));
  assert.deepEqual(events(sb), ["contents"]);
});

test("a command ending in blank lines ends when its marker appears", async (t) => {
  const { sb, done, wait } = await sandbox(t);
  const screen = "Projects\nNew\n\n\nArtifacts\n\n\n\nDots-Mac-mini acp-exp % \n\n\n";
  const r = await wait(["120", "--after", ID], { screen, finish: "2 0" });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(sleeps(sb), ["1", "1"]);
  assert.deepEqual(r.stdout.split("\n").slice(0, -1), [
    "Projects",
    "New",
    "Artifacts",
    "Dots-Mac-mini acp-exp % ",
    `${ID} exited 0`,
  ]);
  assert.ok(!fs.existsSync(path.join(done, ID)));
});

test("a non-zero exit code is printed and exits 1", async (t) => {
  const { done, wait } = await sandbox(t);
  const r = await wait(["5", "--after", ID], { finish: "1 3" });
  assert.equal(r.code, 1, r.stderr);
  assert.equal(r.stderr, "");
  assert.ok(r.stdout.endsWith(`${ID} exited 3\n`));
  assert.ok(!fs.existsSync(path.join(done, ID)));
});

test("a timeout shorter than the idle threshold exits 124 and names the id", async (t) => {
  const { sb, wait } = await sandbox(t);
  const r = await wait(["2", "--after", ID], { screen: "Write it? [y/N] " });
  assert.equal(r.code, 124);
  assert.deepEqual(sleeps(sb), ["1", "1"]);
  assert.equal(r.stdout, "Write it? [y/N] \n");
  assert.equal(
    r.stderr,
    `termwait: still running: ${ID} (after 2 s); keep waiting with termwait <secs> --after ${ID}\n`,
  );
});

test("three unchanged seconds returns a look-now signal without claiming completion", async (t) => {
  const { sb, done, wait } = await sandbox(t);
  const r = await wait(["300", "--after", ID], { screen: "no recognizable prompt here" });
  assert.equal(r.code, 75, r.stderr);
  assert.deepEqual(sleeps(sb), ["1", "1", "1"]);
  assert.match(r.stderr, /look now.*not finished/);
  assert.ok(!r.stdout.includes("exited"));
  assert.ok(!fs.existsSync(path.join(done, ID)));
});

test("a completion marker wins over idle at the same instant", async (t) => {
  const { done, wait } = await sandbox(t);
  const r = await wait(["300", "--after", ID], { finish: "3 0" });
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.stdout.endsWith(`${ID} exited 0\n`));
  assert.ok(!fs.existsSync(path.join(done, ID)));
});

test("changing contents time out even if the text looks like an input prompt", async (t) => {
  const { sb, wait } = await sandbox(t);
  const r = await wait(["5", "--after", ID], {
    read: {
      shell:
        'n=$(( $(cat $FAKE_DIR/reads 2>/dev/null || print 0) + 1 )); print $n > $FAKE_DIR/reads; print "Write it? [y/N] $n"',
    },
  });
  assert.equal(r.code, 124);
  assert.equal(sleeps(sb).length, 5);
});

test("failed or hung reads cannot establish idle", async (t) => {
  for (const shell of [
    "exit 1",
    "kill -ALRM $PPID",
    "n=$(( $(cat $FAKE_DIR/reads 2>/dev/null || print 0) + 1 )); print $n > $FAKE_DIR/reads; (( n % 2 )) || exit 1; print unchanged",
  ]) {
    const { wait } = await sandbox(t);
    const r = await wait(["5", "--after", ID], { read: { shell } });
    assert.equal(r.code, 124, r.stderr);
    assert.ok(!r.stderr.includes("look now"));
  }
});

test("a zero-second wait checks the marker once", async (t) => {
  const { sb, done, wait } = await sandbox(t);
  assert.equal((await wait(["0", "--after", ID])).code, 124);
  assert.deepEqual(sleeps(sb), []);
  fs.writeFileSync(path.join(done, ID), "0\n");
  assert.equal((await wait(["0", "--after", ID])).code, 0);
});

test("a later wait reads the marker a timed-out one left", async (t) => {
  const { done, wait } = await sandbox(t);
  assert.equal((await wait(["1", "--after", ID])).code, 124);
  fs.writeFileSync(path.join(done, ID), "0\n");
  const r = await wait(["1", "--after", ID]);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(!fs.existsSync(path.join(done, ID)));
});

test("a marker holding no exit code fails", async (t) => {
  const { done, wait } = await sandbox(t);
  fs.writeFileSync(path.join(done, ID), "oops\n");
  const r = await wait(["1", "--after", ID]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, `termwait: ${ID} marker holds no exit code\n`);
});

test("deletes only its own marker", async (t) => {
  const { done, wait } = await sandbox(t);
  const other = "1761200000-4242-18";
  fs.writeFileSync(path.join(done, other), "0\n");
  fs.writeFileSync(path.join(done, ID), "0\n");
  assert.equal((await wait(["1", "--after", ID])).code, 0);
  assert.deepEqual(fs.readdirSync(done), [other]);
});

test("removes only stale marker files in the marker dir", async (t) => {
  const { sb, done, wait } = await sandbox(t);
  const old = Date.now() / 1000 - 2 * 86400;
  const stale = [path.join(done, "1761000000-1-1"), path.join(done, "1761000000-1-2.tmp")];
  const kept = [
    path.join(done, "1761200000-1-3"),
    path.join(done, "1761200000-1-4.tmp"),
    path.join(done, "notes"),
    path.join(done, "1761000000-1-5.log"),
    path.join(done, "sub", "1761000000-1-6"),
    path.join(sb.home, "apm", "1761000000-1-7"),
  ];
  fs.mkdirSync(path.join(done, "sub"));
  for (const file of [...stale, ...kept]) fs.writeFileSync(file, "0\n");
  for (const file of [...stale, ...kept.slice(2)]) fs.utimesSync(file, old, old);
  fs.writeFileSync(path.join(done, ID), "0\n");
  assert.equal((await wait(["1", "--after", ID])).code, 0);
  for (const file of stale) assert.ok(!fs.existsSync(file), file);
  for (const file of kept) assert.ok(fs.existsSync(file), file);
});

test("redaction and the tail are kept", async (t) => {
  const { done, wait } = await sandbox(t);
  const tokens = ["sk-ant-", "lin_api_", "ghp_", "gho_", "github_pat_"].map(
    (prefix) => `${prefix}offline_fixture`,
  );
  const screen = [
    ...Array.from({ length: 30 }, (_, n) => `line ${n}`),
    "Your OAuth token",
    "offline-oauth-fixture",
    "Store this token safely",
    tokens.join(" "),
    "mini ~ % ",
  ].join("\n");
  fs.writeFileSync(path.join(done, ID), "0\n");
  const r = await wait(["3", "--after", ID], { screen });
  assert.equal(r.code, 0, r.stderr);
  assert.ok(!r.stdout.includes("offline-oauth-fixture"));
  for (const token of tokens) assert.ok(!r.stdout.includes(token), token);
  assert.ok(r.stdout.includes("<token hidden>"));
  assert.ok(r.stdout.split("\n").length - 1 <= 26);
});

test("invalid options fail before touching anything", async (t) => {
  const { sb, done, wait } = await sandbox(t);
  const stale = path.join(done, "1761000000-1-1");
  fs.writeFileSync(stale, "0\n");
  const old = Date.now() / 1000 - 2 * 86400;
  fs.utimesSync(stale, old, old);
  for (const args of [
    ["--after", ID],
    ["3"],
    ["3", "--after"],
    ["3", "--after", "../x"],
    ["3", "--after", `48:${"a".repeat(64)}`],
    ["--baseline"],
    ["3", "--again"],
    ["oops"],
    ["--no-such-option"],
    ["-h", "x"],
  ]) {
    const r = await wait(args);
    assert.equal(r.code, 2, args.join(" "));
    assert.equal(r.stderr, "termwait: usage: termwait <secs> --after <id>\n", args.join(" "));
    assert.equal(r.stdout, "");
    assert.deepEqual(events(sb), []);
    assert.ok(fs.existsSync(stale));
  }
});

test("every secret pattern on screen is redacted (FR-34)", async (t) => {
  const { done, wait } = await sandbox(t);
  const tokens = ["ghs_", "ghu_", "ghr_", "ghp_", "lin_api_", "sk-ant-", "github_pat_"].map(
    (prefix) => prefix + "Hidden0" + prefix.length,
  );
  const key = [
    "-----BEGIN " + "RSA PRIVATE KEY-----",
    "MIIEkeybody",
    "-----END " + "RSA PRIVATE KEY-----",
  ];
  fs.writeFileSync(path.join(done, ID), "0\n");
  const screen = ["start", ...tokens, ...key, "mini ~ % "].join("\n") + "\n";
  const r = await wait(["1", "--after", ID], { screen });
  assert.equal(r.code, 0, r.stderr);
  assert.ok(!r.stdout.includes("Hidden0"), r.stdout);
  assert.ok(!r.stdout.includes("keybody"), r.stdout);
  assert.equal(r.stdout.split("<redacted>").length - 1, tokens.length);
  assert.ok(r.stdout.includes("<redacted private key>\n"));
});

test("-h prints the usage to stdout and touches nothing", async (t) => {
  const { sb, wait } = await sandbox(t);
  const r = await wait(["-h"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, "");
  assert.match(r.stdout, /^termwait <secs> --after <id> /);
  assert.match(r.stdout, /124/);
  assert.deepEqual(sb.calls(), []);
});
