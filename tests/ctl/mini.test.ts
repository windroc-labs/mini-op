import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox, type FakeRule } from "../lib/sandbox.ts";
import { onlyOnStdin, remote } from "./remote.ts";
import { fakeTerminal } from "../lib/terminal.ts";

const MINI = path.join(REPO, "ctl/mini");

test("exec returns complete visible results and original status including 255", async (t) => {
  for (const code of [0, 7, 124, 255]) {
    const sb = await remote(t, []);
    fakeTerminal(sb);
    const r = await sb.run(["zsh", MINI, "exec", "0"], {
      input: `printf 'result\n\n'; printf 'error without newline' >&2; exit ${code}`,
    });
    assert.equal(r.code, code, r.stderr);
    assert.equal(r.stdout, "result\n\n");
    assert.equal(r.stderr, "error without newline");
    assert.equal(sb.calls("ssh").length, 1);
  }
});

test("exec separates transport failure and rejects a missing or invalid status frame", async (t) => {
  const sb = await Sandbox.create(t);
  for (const stderr of ["connection lost", "\nmini-exec-rc:no\n", "\nmini-exec-rc:256\n"]) {
    sb.fake("ssh", [{ stderr }]);
    const r = await sb.run(["zsh", MINI, "exec"], { input: "echo hi" });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /missing result status/);
  }
  sb.fake("ssh", [{ stderr: "offline\n", exit: 255 }]);
  const r = await sb.run(["zsh", MINI, "exec"]);
  assert.equal(r.code, 255);
  assert.match(r.stderr, /ssh to the mini failed/);
});

test("exec validates collect ids before SSH and collects without new input", async (t) => {
  const sb = await remote(t, []);
  const id = "1761200000-4242-17";
  const dir = apm(sb, `state/visible/${id}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, value] of [
    ["stdout", "saved"],
    ["stderr", ""],
    ["rc", "0\n"],
  ]) {
    fs.writeFileSync(path.join(dir, name!), value!);
  }
  const r = await sb.run(["zsh", MINI, "exec", "--collect", id]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "saved");
  const bad = await sb.run(["zsh", MINI, "exec", "--collect", "../x"]);
  assert.equal(bad.code, 2);
  assert.equal(sb.calls("ssh").length, 1);
});
const GIT = ["git", "-c", "user.name=t", "-c", "user.email=t@example.com"];
// The only commands sync runs on the mini: unpack, then swap the code in around ~/apm/state.
const PACKING =
  /^(set -e|chmod -R u\+w \S+( \S+)*( 2>\/dev\/null \|\| true)?|rm -rf \S+( \S+)*|(then )?mkdir( -p)? \S+|tar -xf - -C \S+|mv \S+ \S+|if \[ -d \S+ \] && \[ ! -d \S+ \]|fi)$/;

type T = Parameters<typeof Sandbox.create>[0];

function apm(sb: Sandbox, file: string): string {
  return path.join(sb.home, "apm", file);
}

// A committed copy of the repo's shipped files: a MacBook checkout.
async function checkout(sb: Sandbox): Promise<{ dir: string; commit: string }> {
  const dir = path.join(sb.dir, "checkout");
  fs.mkdirSync(dir);
  for (const name of ["README.md", "status.md", "runbooks", "mini", "ctl", "host"]) {
    fs.cpSync(path.join(REPO, name), path.join(dir, name), { recursive: true });
  }
  for (const args of [
    ["init", "-q"],
    ["add", "-A"],
    ["commit", "-q", "-m", "c"],
  ]) {
    const r = await sb.run([...GIT, "-C", dir, ...args]);
    assert.equal(r.code, 0, r.stderr);
  }
  const head = await sb.run(["git", "-C", dir, "rev-parse", "HEAD"]);
  return { dir, commit: head.stdout.trim() };
}

// The image's plugin root as host/Dockerfile lays it out: ctl/ and mini/ side by side, no git
// checkout around them, mini/VERSION the stamp host/start built it with.
function pluginRoot(sb: Sandbox, stamp: string): string {
  const root = path.join(sb.dir, "plugin-root");
  for (const dir of ["ctl", "mini"]) {
    fs.cpSync(path.join(REPO, dir), path.join(root, dir), { recursive: true });
  }
  // CI's shipped dirs are read-only, and the copy keeps their modes.
  fs.chmodSync(path.join(root, "mini"), 0o755);
  fs.writeFileSync(path.join(root, "mini/VERSION"), `${stamp}\n`);
  return root;
}

function remoteCommands(sb: Sandbox): string[][] {
  return sb.calls("ssh").map((call) => (call.argv.at(-1) ?? "").split("; "));
}

test("the image's plugin root syncs to ~/apm with its baked mini/VERSION", async (t) => {
  const sb = await Sandbox.create(t);
  const commit = "0123456789abcdef0123456789abcdef01234567-dirty";
  const root = pluginRoot(sb, commit);
  sb.fake("ssh", [{ local: true }]);
  const r = await sb.run(["zsh", path.join(root, "ctl/mini"), "sync"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, `mini: synced mini/ to the mini's ~/apm at ${commit}\n`);
  assert.equal(fs.readFileSync(apm(sb, "VERSION"), "utf8"), `${commit}\n`);
  assert.ok(fs.existsSync(apm(sb, "bin/termwait")));
  assert.ok(fs.existsSync(apm(sb, "bin/maillink")));
  const [call] = sb.calls("ssh");
  assert.deepEqual(call?.argv.slice(0, -1), ["-o", "BatchMode=yes", "mini"]);
});

test("sync removes old code, keeps ~/apm/state, and syncs again over read-only files", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("ssh", [{ local: true }]);
  fs.mkdirSync(apm(sb, "state/done"), { recursive: true });
  fs.writeFileSync(apm(sb, "state/done/1-2-3"), "0\n");
  fs.writeFileSync(apm(sb, "old-script"), "#!/bin/zsh\n", { mode: 0o755 });
  fs.mkdirSync(apm(sb, "bin"));
  fs.writeFileSync(apm(sb, "bin/tw"), "#!/bin/zsh\n", { mode: 0o755 });
  for (let round = 0; round < 2; round++) {
    const r = await sb.run(["zsh", MINI, "sync"]);
    assert.equal(r.code, 0, r.stderr);
  }
  assert.ok(!fs.existsSync(apm(sb, "old-script")));
  assert.ok(!fs.existsSync(apm(sb, "bin/tw")));
  assert.equal(fs.readFileSync(apm(sb, "state/done/1-2-3"), "utf8"), "0\n");
  const shipped = fs.readdirSync(path.join(REPO, "mini")).filter((name) => name !== "VERSION");
  assert.deepEqual(fs.readdirSync(apm(sb, "")).sort(), [...shipped, "VERSION", "state"].sort());
  assert.ok(!fs.existsSync(path.join(sb.home, "apm.new")));
  assert.ok(!fs.existsSync(path.join(sb.home, "apm.old")));
  assert.deepEqual(fs.readdirSync(path.join(sb.dir, "tmp")), []);
});

test("sync after an interrupted one keeps the state it had moved aside", async (t) => {
  for (const swapped of [false, true]) {
    const sb = await Sandbox.create(t);
    sb.fake("ssh", [{ local: true }]);
    const aside = path.join(sb.home, "apm.new/state/done");
    fs.mkdirSync(aside, { recursive: true });
    fs.writeFileSync(path.join(aside, "1-2-3"), "0\n");
    // Cut off before the swap (~/apm still there, its state gone) or right after ~/apm moved out.
    const old = path.join(sb.home, swapped ? "apm.old/bin" : "apm/bin");
    fs.mkdirSync(old, { recursive: true });
    fs.writeFileSync(path.join(old, "tw"), "#!/bin/zsh\n", { mode: 0o755 });
    const r = await sb.run(["zsh", MINI, "sync"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(fs.readFileSync(apm(sb, "state/done/1-2-3"), "utf8"), "0\n", String(swapped));
    assert.ok(!fs.existsSync(apm(sb, "bin/tw")));
    assert.ok(!fs.existsSync(path.join(sb.home, "apm.new")));
    assert.ok(!fs.existsSync(path.join(sb.home, "apm.old")));
  }
});

test("sync only unpacks on the mini: no sudo, no installs", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("ssh", [{ local: true }]);
  const r = await sb.run(["zsh", MINI, "sync"]);
  assert.equal(r.code, 0, r.stderr);
  const [commands, ...more] = remoteCommands(sb);
  assert.deepEqual(more, []);
  for (const command of commands ?? []) assert.match(command, PACKING);
  for (const command of commands ?? []) assert.doesNotMatch(command, /sudo|brew|install/);
});

test("on the MacBook checkout sync stamps on the spot, -dirty included, via ~/.mini-op/ssh_config", async (t) => {
  const sb = await Sandbox.create(t);
  const { dir, commit } = await checkout(sb);
  fs.writeFileSync(path.join(dir, "untracked"), "x\n");
  sb.fake("ssh", [{ local: true }]);
  const r = await sb.run(["zsh", path.join(dir, "ctl/mini"), "sync"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(fs.readFileSync(apm(sb, "VERSION"), "utf8"), `${commit}-dirty\n`);
  assert.deepEqual(sb.calls("ssh")[0]?.argv.slice(0, 2), [
    "-F",
    path.join(sb.home, ".mini-op/ssh_config"),
  ]);
});

test("without a VERSION outside a checkout sync and --check exit 1 and never call ssh", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("ssh", [{ local: true }]);
  const root = path.join(sb.dir, "plugin-root");
  fs.mkdirSync(path.join(root, "ctl/lib"), { recursive: true });
  fs.mkdirSync(path.join(root, "mini/bin"), { recursive: true });
  for (const file of ["ctl/mini", "ctl/lib/ssh.zsh", "ctl/lib/secrets.zsh", "ctl/lib/version.sh"]) {
    fs.copyFileSync(path.join(REPO, file), path.join(root, file));
  }
  for (const args of [["sync"], ["sync", "--check"]]) {
    const r = await sb.run(["zsh", path.join(root, "ctl/mini"), ...args]);
    assert.equal(r.code, 1);
    assert.equal(
      r.stderr,
      `mini: no ${root}/mini/VERSION; rebuild the image with host/start on the Mac\n`,
    );
  }
  assert.deepEqual(sb.calls("ssh"), []);
});

test("a failed ssh makes sync exit 1", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("ssh", [{ exit: 255 }]);
  const r = await sb.run(["zsh", MINI, "sync"]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "mini: sync to the mini failed; ~/apm is unchanged or partly updated\n");
  assert.equal(r.stdout, "");
});

test("sync --check exits 0 only when the mini's ~/apm/VERSION matches this copy's", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("ssh", [{ local: true }]);
  assert.equal((await sb.run(["zsh", MINI, "sync"])).code, 0);
  const version = fs.readFileSync(apm(sb, "VERSION"), "utf8").trim();
  const same = await sb.run(["zsh", MINI, "sync", "--check"]);
  assert.equal(same.code, 0, same.stderr);
  assert.equal(same.stdout, `mini: in sync at ${version}\n`);
  assert.deepEqual(remoteCommands(sb).at(-1), ["cat ~/apm/VERSION"]);

  fs.writeFileSync(apm(sb, "VERSION"), "0000000000000000000000000000000000000000\n");
  const other = await sb.run(["zsh", MINI, "sync", "--check"]);
  assert.equal(other.code, 1);
  assert.equal(
    other.stderr,
    `mini: the mini's ~/apm is at 0000000000000000000000000000000000000000, this copy at ${version}; run mini sync\n`,
  );

  fs.rmSync(apm(sb, "VERSION"));
  const missing = await sb.run(["zsh", MINI, "sync", "--check"]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /^mini: cannot read ~\/apm\/VERSION on the mini; run mini sync\n$/m);
});

// AC8: a pre-E7 mini has no ~/apm/lib/timeout.zsh; sync and --check must not need it.
test("sync and sync --check work on a mini without timeout.zsh", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("ssh", [{ local: true }]);
  sb.mini();
  fs.rmSync(apm(sb, "lib/timeout.zsh"));
  fs.writeFileSync(apm(sb, "VERSION"), "0000000000000000000000000000000000000000\n");
  const old = await sb.run(["zsh", MINI, "sync", "--check"]);
  assert.equal(old.code, 1);
  assert.match(
    old.stderr,
    /^mini: the mini's ~\/apm is at 0{40}, this copy at \S+; run mini sync\n$/,
  );

  const synced = await sb.run(["zsh", MINI, "sync"]);
  assert.equal(synced.code, 0, synced.stderr);
  assert.ok(fs.existsSync(apm(sb, "lib/timeout.zsh")));
  const version = fs.readFileSync(apm(sb, "VERSION"), "utf8").trim();

  // sync's tar keeps the modes of CI's read-only shipped dirs: give the owner write on lib first.
  fs.chmodSync(apm(sb, "lib"), fs.statSync(apm(sb, "lib")).mode | 0o700);
  fs.rmSync(apm(sb, "lib/timeout.zsh"));
  const check = await sb.run(["zsh", MINI, "sync", "--check"]);
  assert.equal(check.code, 0, check.stderr);
  assert.equal(check.stdout, `mini: in sync at ${version}\n`);
  assert.equal(sb.calls("ssh").length, 3);
  for (const call of sb.calls("ssh")) assert.doesNotMatch(call.argv.join(" "), /timeout\.zsh/);
});

const KEYS = { program: "keys.js", stdout: "keys: typed the secret, Enter\n" };
// ioreg reports the screen locked for as many calls as the "locked" file holds lines.
const IOREG = `n=$(wc -l < "$FAKE_DIR/locked" 2>/dev/null || print 0); (( n > 0 )) || exit 0
sed -i 1d "$FAKE_DIR/locked"; print '<key>CGSSessionScreenIsLocked</key>'; print '<true/>'`;
// An osascript call that runs out of time: SIGALRM ends it as with_timeout's timer would.
const HANGS = "kill -ALRM $PPID";
// sudo on the mini: -S takes the password on stdin, checked against the sandbox's password file; -n
// runs the command after --.
const SUDO = [
  { argv: ["-k"], ignoresStdin: true },
  { argv: ["-S"], shell: `[[ $(cat) == "$(<$FAKE_DIR/secrets/mini-password)" ]]` },
  { argv: ["-n"], shell: 'shift; [[ $1 == -- ]] && shift; "$@"' },
];

async function sandbox(t: T, osascript: FakeRule[] = [KEYS]): Promise<Sandbox> {
  return remote(t, osascript);
}

// A stand-in for ~/apm/bin/ans (tests/mini/bin/ans.test.ts tests the real one): it keeps its
// args and stdin in ~/ans.args and ~/ans.stdin, then runs `then`.
function ans(sb: Sandbox, then: string): void {
  fs.rmSync(apm(sb, "bin/ans"));
  const body = `print -r -- "$*" > ~/ans.args; cat > ~/ans.stdin\n${then}\n`;
  fs.writeFileSync(apm(sb, "bin/ans"), `#!/usr/bin/env zsh\n${body}`, { mode: 0o755 });
}

function home(sb: Sandbox, file: string): string {
  return fs.readFileSync(path.join(sb.home, file), "utf8");
}

test("run sends stdin to ans and passes its rc", async (t) => {
  for (const [args, rc, stderr] of [
    [[], 0, ""],
    [["300", "--to", "1761200000-4242-17"], 1, "keys: Terminal not frontmost; typed nothing\n"],
    [["5"], 124, "ans: still running: 1-2-3; keep waiting with termwait 5 --after 1-2-3\n"],
    [["30", "--to", "1761200000-4242-17"], 75, "termwait: look now; not finished\n"],
  ] as const) {
    const sb = await sandbox(t);
    ans(sb, `print 'mini ~ %'; print -u2 -n -- ${JSON.stringify(stderr)}; exit ${rc}`);
    const r = await sb.run(["zsh", MINI, "run", ...args], { input: "ls -l\n" });
    assert.equal(r.code, rc, r.stderr);
    assert.equal(r.stdout, "mini ~ %\n");
    assert.equal(r.stderr, stderr);
    assert.equal(home(sb, "ans.args"), `${args.length > 0 ? args.join(" ") : "60"}\n`);
    assert.equal(home(sb, "ans.stdin"), "ls -l\n");
    assert.equal(sb.calls("ssh")[0]?.stdin, "ls -l\n");
  }
});

test("run maps another rc of the mini or a failed ssh to 1", async (t) => {
  const sb = await sandbox(t);
  ans(sb, "exit 3");
  const r = await sb.run(["zsh", MINI, "run"], { input: "x\n" });
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "mini: run: the mini exited 3\n");

  const down = await Sandbox.create(t);
  down.fake("ssh", [{ exit: 255 }]);
  const d = await down.run(["zsh", MINI, "run"], { input: "x\n" });
  assert.equal(d.code, 1);
  assert.equal(d.stderr, "mini: run: ssh to the mini failed\n");
});

test("pw types the password into the Terminal from stdin only", async (t) => {
  const sb = await sandbox(t);
  const r = await sb.run(["zsh", MINI, "pw"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "keys: typed the secret, Enter\n");
  assert.equal(sb.calls("ssh")[0]?.stdin, sb.canary);
  const keys = sb.calls("osascript");
  assert.deepEqual(
    keys.map((c) => [c.program, c.argv.slice(-4)]),
    [["keys.js", ["--front", "Terminal", "--secret", "--enter"]]],
  );
  assert.equal(keys[0]?.stdin, sb.canary);
  onlyOnStdin(sb, r);
});

test("pw --sa types into SecurityAgent with --verify-field", async (t) => {
  const sb = await sandbox(t, [
    { program: "keys.js", stdout: "keys: typed the secret (12 characters); clicked Allow\n" },
  ]);
  const r = await sb.run(["zsh", MINI, "pw", "--sa"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "keys: typed the secret (12 characters); clicked Allow\n");
  const keys = sb.calls("osascript");
  assert.deepEqual(
    keys.map((c) => c.argv.slice(-4)),
    [["--front", "SecurityAgent", "--secret", "--verify-field"]],
  );
  assert.equal(keys[0]?.stdin, sb.canary);
  onlyOnStdin(sb, r);
});

test("pw --settings types into the System Settings sheet with --verify-field", async (t) => {
  const sb = await sandbox(t, [
    { program: "keys.js", stdout: "keys: typed the secret (12 characters); clicked OK\n" },
  ]);
  const r = await sb.run(["zsh", MINI, "pw", "--settings"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "keys: typed the secret (12 characters); clicked OK\n");
  const keys = sb.calls("osascript");
  assert.deepEqual(
    keys.map((c) => c.argv.slice(-4)),
    [["--front", "SettingsSheet", "--secret", "--verify-field"]],
  );
  assert.equal(keys[0]?.stdin, sb.canary);
  onlyOnStdin(sb, r);
});

test("a refusal on the mini exits 1 for pw, pw --sa and pw --settings", async (t) => {
  for (const args of [["pw"], ["pw", "--sa"], ["pw", "--settings"]]) {
    const sb = await sandbox(t, [
      {
        program: "keys.js",
        stderr: "keys: Terminal not frontmost (Finder); typed nothing\n",
        exit: 1,
      },
    ]);
    const r = await sb.run(["zsh", MINI, ...args]);
    assert.equal(r.code, 1, args.join(" "));
    assert.equal(r.stderr, "keys: Terminal not frontmost (Finder); typed nothing\n");
    onlyOnStdin(sb, r);
  }
});

// The lock screen: ioreg says locked for `locks` calls; caffeinate and sleep do nothing.
async function lockScreen(t: T, locks: number): Promise<Sandbox> {
  const sb = await sandbox(t);
  sb.fake("ioreg", [{ shell: IOREG, ignoresStdin: true }]);
  sb.fake("caffeinate", [{ ignoresStdin: true }]);
  sb.fake("sleep", [{ ignoresStdin: true }]);
  fs.writeFileSync(path.join(sb.dir, "locked"), "1\n".repeat(locks));
  return sb;
}

test("pw --lock types only while locked", async (t) => {
  const sb = await lockScreen(t, 1);
  const r = await sb.run(["zsh", MINI, "pw", "--lock"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "keys: typed the secret, Enter\nmini: pw: unlocked\n");
  assert.equal(r.stderr, "");
  const keys = sb.calls("osascript");
  assert.deepEqual(
    keys.map((c) => c.argv.slice(-3)),
    [["--wake", "--secret", "--enter"]],
  );
  assert.equal(keys[0]?.stdin, sb.canary);
  assert.equal(sb.calls("ssh")[0]?.stdin, sb.canary);
  assert.deepEqual(
    sb.calls("sleep").map((c) => c.argv),
    [["1"], ["3"]],
  );
  onlyOnStdin(sb, r);
});

test("pw --lock on an unlocked screen", async (t) => {
  const sb = await lockScreen(t, 0);
  const r = await sb.run(["zsh", MINI, "pw", "--lock"]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "mini: pw: screen not locked; typed nothing\n");
  assert.deepEqual(sb.calls("osascript"), []);
});

test("pw --lock exits 1 while still locked", async (t) => {
  const sb = await lockScreen(t, 2);
  const r = await sb.run(["zsh", MINI, "pw", "--lock"]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "keys: typed the secret, Enter\n");
  assert.equal(r.stderr, "mini: pw: still locked\n");
  onlyOnStdin(sb, r);
});

test("pw's typing that runs out of time exits 124 with its killed line", async (t) => {
  for (const [args, secs] of [
    [["pw"], 15],
    [["pw", "--sa"], 25],
    [["pw", "--settings"], 25],
    [["pw", "--lock"], 15],
  ] as const) {
    const sb = await lockScreen(t, 1);
    sb.fake("osascript", [{ program: "keys.js", shell: HANGS }]);
    const r = await sb.run(["zsh", MINI, ...args]);
    assert.equal(r.code, 124, args.join(" "));
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, `mini: pw: killed after ${secs} s: typing the password\n`);
    onlyOnStdin(sb, r);
  }
});

test("pw and sudo without the password file exit 1 and call no ssh", async (t) => {
  for (const [args, nothing] of [
    [["pw"], "typed nothing"],
    [["pw", "--lock"], "typed nothing"],
    [["pw", "--sa"], "typed nothing"],
    [["pw", "--settings"], "typed nothing"],
    [["sudo", "-v"], "ran nothing"],
    [["sudo", "ls"], "ran nothing"],
  ] as const) {
    const sb = await sandbox(t);
    fs.rmSync(sb.passwordFile);
    const r = await sb.run(["zsh", MINI, ...args]);
    assert.equal(r.code, 1, args.join(" "));
    assert.equal(r.stdout, "");
    const sub = args[0];
    assert.equal(
      r.stderr,
      `mini: ${sub}: no mini password in ${envPassword(sb)} or ${sb.passwordFile}; the user writes it (host/README.md, Steps 4); ${nothing}\n`,
    );
    assert.deepEqual(sb.calls(), []);
  }
});

const envPassword = (sb: Sandbox) => path.join(sb.secrets, "env/mini-password");

function writeEnvPassword(sb: Sandbox, text: string): void {
  fs.mkdirSync(path.join(sb.secrets, "env"));
  fs.writeFileSync(envPassword(sb), text, { mode: 0o400 });
}

test("pw and sudo send the environment's mini-password, not the secrets dir's", async (t) => {
  for (const args of [["pw"], ["pw", "--sa"], ["sudo", "-v"], ["sudo", "ls"]]) {
    const sb = await Sandbox.create(t);
    sb.fake("ssh", [{}]);
    writeEnvPassword(sb, `env-${sb.canary}`);
    const r = await sb.run(["zsh", MINI, ...args]);
    assert.equal(r.code, 0, args.join(" ") + r.stderr);
    assert.deepEqual(
      sb.calls("ssh").map((call) => call.stdin),
      [`env-${sb.canary}`],
    );
  }
});

test("pw and sudo with an empty environment mini-password exit 1 and call no ssh", async (t) => {
  for (const [args, nothing] of [
    [["pw"], "typed nothing"],
    [["sudo", "-v"], "ran nothing"],
  ] as const) {
    const sb = await sandbox(t);
    writeEnvPassword(sb, "");
    const r = await sb.run(["zsh", MINI, ...args]);
    assert.equal(r.code, 1, args.join(" "));
    assert.equal(r.stdout, "");
    assert.equal(
      r.stderr,
      `mini: ${args[0]}: ${envPassword(sb)} is empty or unreadable; ${nothing}\n`,
    );
    assert.deepEqual(sb.calls(), []);
  }
});

test("pw and sudo read no account: the password file is mini-password whatever it is", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("ssh", [{}]);
  const repo = path.join(sb.dir, "repo");
  fs.cpSync(path.join(REPO, "ctl"), path.join(repo, "ctl"), { recursive: true });
  fs.mkdirSync(path.join(repo, "host"));
  fs.writeFileSync(path.join(repo, "host/config"), "");
  fs.writeFileSync(path.join(sb.home, ".mini-op/ssh_config"), "Host mini\n    HostName 10.9.8.7\n");
  for (const args of [["pw"], ["sudo", "-v"]]) {
    const r = await sb.run(["zsh", path.join(repo, "ctl/mini"), ...args]);
    assert.equal(r.code, 0, args.join(" ") + r.stderr);
  }
  assert.deepEqual(
    sb.calls("ssh").map((call) => call.stdin),
    [sb.canary, sb.canary],
  );
});

test("sudo -v checks the password only", async (t) => {
  const sb = await sandbox(t);
  sb.fake("sudo", SUDO);
  const r = await sb.run(["zsh", MINI, "sudo", "-v"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "mini: sudo: password ok\n");
  assert.deepEqual(
    sb.calls("sudo").map((c) => c.argv),
    [["-k"], ["-S", "-p", "", "-v"], ["-n", "true"], ["-k"]],
  );
  assert.equal(sb.calls("ssh")[0]?.stdin, sb.canary);
  assert.equal(sb.calls("sudo")[1]?.stdin, sb.canary);
  onlyOnStdin(sb, r);

  const wrong = await sandbox(t);
  wrong.fake("sudo", [SUDO[0]!, { argv: ["-S"], exit: 1 }, { argv: ["-n"], exit: 1 }]);
  const w = await wrong.run(["zsh", MINI, "sudo", "-v"]);
  assert.equal(w.code, 1);
  assert.equal(w.stdout, "");
  assert.equal(w.stderr, "mini: sudo: sudo -S -v rc=1, sudo -n true rc=1\n");
});

test("sudo runs a command", async (t) => {
  const sb = await sandbox(t);
  sb.fake("sudo", SUDO);
  const r = await sb.run(["zsh", MINI, "sudo", "ls", "-d", "/"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "/\n");
  assert.deepEqual(
    sb.calls("sudo").map((c) => c.argv),
    [["-k"], ["-S", "-p", "", "-v"], ["-n", "--", "ls", "-d", "/"], ["-k"]],
  );
  assert.equal(sb.calls("sudo")[1]?.stdin, sb.canary);
  assert.equal(sb.calls("sudo")[2]?.stdin, "");
  onlyOnStdin(sb, r);
});

test("sudo passes metacharacter args literally", async (t) => {
  const sb = await sandbox(t);
  sb.fake("sudo", SUDO);
  const args = ["printf", "%s\\n", "a;touch ~/pwned", "$(id)", 'it\'s "q"'];
  const r = await sb.run(["zsh", MINI, "sudo", ...args]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, 'a;touch ~/pwned\n$(id)\nit\'s "q"\n');
  assert.deepEqual(sb.calls("sudo")[2]?.argv, ["-n", "--", ...args]);
  assert.ok(!fs.existsSync(path.join(sb.home, "pwned")));
});

test("sudo maps a command's failure to 1", async (t) => {
  for (const [args, command, rc] of [
    [["sh", "-c", "exit 3"], "sh", 3],
    [["$(touch ~/pwned)"], "$(touch ~/pwned)", 127],
  ] as const) {
    const sb = await sandbox(t);
    sb.fake("sudo", SUDO);
    const r = await sb.run(["zsh", MINI, "sudo", ...args]);
    assert.equal(r.code, 1, command);
    assert.ok(r.stderr.split("\n").includes(`mini: sudo: ${command} exited ${rc}`), r.stderr);
    assert.deepEqual(sb.calls("sudo").at(-1)?.argv, ["-k"]);
    assert.ok(!fs.existsSync(path.join(sb.home, "pwned")));
  }
});

test("sudo with a rejected password runs nothing", async (t) => {
  const sb = await sandbox(t);
  sb.fake("sudo", [SUDO[0]!, { argv: ["-S"], exit: 1 }, { argv: ["-n"] }]);
  const r = await sb.run(["zsh", MINI, "sudo", "ls"]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "mini: sudo: password rejected; ran nothing\n");
  assert.deepEqual(
    sb.calls("sudo").map((c) => c.argv[0]),
    ["-k", "-S"],
  );
});

test("chord sends the held-modifier program", async (t) => {
  const sb = await sandbox(t, [{ program: "chord.applescript", stdout: "chord: sent\n" }]);
  const r = await sb.run(["zsh", MINI, "chord", "command,shift", "40"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "chord: sent\n");
  assert.deepEqual(sb.calls("osascript")[0]?.argv, [
    apm(sb, "lib/chord.applescript"),
    "command,shift",
    "40",
  ]);
});

test("chord's refusal exits 1", async (t) => {
  const sb = await sandbox(t, [
    {
      program: "chord.applescript",
      stderr: "chord: Terminal not frontmost; sent nothing\n",
      exit: 1,
    },
  ]);
  const r = await sb.run(["zsh", MINI, "chord", "control", "8"]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "chord: Terminal not frontmost; sent nothing\n");
});

test("chord's timeout exits 124", async (t) => {
  const sb = await sandbox(t, [{ program: "chord.applescript", shell: HANGS }]);
  const r = await sb.run(["zsh", MINI, "chord", "control", "8"]);
  assert.equal(r.code, 124);
  assert.equal(r.stderr, "mini: chord: killed after 10 s: the chord\n");
});

test("a mini without timeout.zsh asks for mini sync", async (t) => {
  for (const args of [["run"], ["pw"], ["pw", "--lock"], ["sudo", "-v"], ["chord", "shift", "1"]]) {
    const sb = await sandbox(t);
    sb.fake("sudo", SUDO);
    fs.rmSync(apm(sb, "lib/timeout.zsh"));
    const r = await sb.run(["zsh", MINI, ...args], { input: "" });
    assert.equal(r.code, 1, args.join(" "));
    assert.equal(
      r.stderr,
      `mini: ${args[0]}: the mini has no ~/apm/lib/timeout.zsh; run mini sync\n`,
    );
    assert.deepEqual(
      sb.calls().map((c) => c.cmd),
      ["ssh"],
    );
  }
});

test("-h prints the usage to stdout and calls nothing", async (t) => {
  const sb = await sandbox(t);
  const r = await sb.run(["zsh", MINI, "-h"]);
  assert.equal(r.code, 0);
  assert.equal(r.stderr, "");
  assert.match(r.stdout, /exec.*255.*SSH.*completion.*unknown/i);
  const lines = r.stdout.split("\n");
  assert.match(lines[0] ?? "", /^mini exec \[secs\]/);
  assert.match(lines[2] ?? "", /^mini run \[secs\] \[--to <id>\] .*not for secrets: use mini pw$/);
  for (const form of [
    "mini pw [--lock | --sa | --settings]",
    "mini sudo <command> [args] ",
    "mini chord <mods> <key code> ",
    "mini sync [--check] ",
  ]) {
    assert.ok(
      lines.some((line) => line.startsWith(form)),
      form,
    );
  }
  assert.ok(r.stdout.includes("mini sudo -v"));
  const env = r.stdout.indexOf("$(env_secrets_dir)/mini-password");
  assert.ok(env >= 0);
  assert.ok(r.stdout.indexOf("$(secrets_dir)/mini-password") > env);
  assert.doesNotMatch(r.stdout, /<account>/);
  assert.deepEqual(sb.calls(), []);
});

test("run rejects a bad secs or id without ssh", async (t) => {
  const sb = await sandbox(t);
  for (const args of [
    ["x"],
    ["-5"],
    ["--to"],
    ["--to", "1-2"],
    ["--to", "1-2-3", "x"],
    ["60", "60"],
    ["--bogus"],
  ]) {
    const r = await sb.run(["zsh", MINI, "run", ...args], { input: "ls\n" });
    assert.equal(r.code, 2, args.join(" "));
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, "mini: usage: mini run [secs] [--to <id>]\n");
  }
  assert.deepEqual(sb.calls(), []);
});

test("run and chord reject a newline in their arguments", async (t) => {
  const sb = await sandbox(t);
  for (const args of [
    ["run", "60\ntouch ~/pwned"],
    ["run", "--to", "1-2-3\ntouch ~/pwned"],
    ["chord", "command", "1\ntouch ~/pwned"],
    ["chord", "command\ntouch ~/pwned", "1"],
  ]) {
    const r = await sb.run(["zsh", MINI, ...args], { input: "" });
    assert.equal(r.code, 2, JSON.stringify(args));
    assert.match(r.stderr, /^mini: usage: mini (run|chord) /);
  }
  assert.deepEqual(sb.calls(), []);
  assert.ok(!fs.existsSync(path.join(sb.home, "pwned")));
});

test("chord rejects bad modifiers", async (t) => {
  const sb = await sandbox(t);
  for (const args of [
    ["command", "36;id"],
    ["command;id", "36"],
    ["command", "-1"],
    ["command", "1e3"],
    ["fn", "36"],
    ["command,", "36"],
    ["command"],
    ["command", "36", "x"],
  ]) {
    const r = await sb.run(["zsh", MINI, "chord", ...args]);
    assert.equal(r.code, 2, args.join(" "));
    assert.equal(r.stderr, "mini: usage: mini chord <mods> <key code>\n");
  }
  assert.deepEqual(sb.calls(), []);
});

test("sudo rejects an unknown option", async (t) => {
  const sb = await sandbox(t);
  for (const args of [[], ["-x"], ["--", "ls"], ["-v", "x"], ["-k"]]) {
    const r = await sb.run(["zsh", MINI, "sudo", ...args]);
    assert.equal(r.code, 2, args.join(" "));
    assert.equal(r.stderr, "mini: usage: mini sudo <command> [args] | mini sudo -v\n");
  }
  assert.deepEqual(sb.calls(), []);
});

test("other subcommands and arguments are usage errors", async (t) => {
  const sb = await sandbox(t);
  for (const [args, synopsis] of [
    [[], "mini exec|run|pw|sudo|chord|sync …; mini -h for each"],
    [["nope"], "mini exec|run|pw|sudo|chord|sync …; mini -h for each"],
    [["-x"], "mini exec|run|pw|sudo|chord|sync …; mini -h for each"],
    [["-h", "x"], "mini exec|run|pw|sudo|chord|sync …; mini -h for each"],
    [["pw", "x"], "mini pw [--lock | --sa | --settings]"],
    [["pw", "--lock", "--sa"], "mini pw [--lock | --sa | --settings]"],
    [["pw", "--settings", "x"], "mini pw [--lock | --sa | --settings]"],
    [["sync", "--force"], "mini sync [--check]"],
    [["sync", "--check", "x"], "mini sync [--check]"],
  ] as const) {
    const r = await sb.run(["zsh", MINI, ...args]);
    assert.equal(r.code, 2, args.join(" "));
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, `mini: usage: ${synopsis}\n`);
  }
  assert.deepEqual(sb.calls(), []);
});
