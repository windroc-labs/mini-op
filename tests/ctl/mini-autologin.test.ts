import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, type FakeRule, type Sandbox } from "../lib/sandbox.ts";
import { MINI_USER } from "../lib/ssh_config.ts";
import { onlyOnStdin, remote } from "./remote.ts";

const SCRIPT = path.join(REPO, "ctl/mini-autologin");
const RESTORED = `mini-autologin: auto-login restored for ${MINI_USER}\n`;
const NOT_RESTORED = `mini-autologin: auto-login not restored for ${MINI_USER} (/etc/kcpassword not rewritten or autoLoginUser not ${MINI_USER})\n`;
const NOT_WRITTEN = "mini-autologin: cannot write /etc/kcpassword; auto-login not restored\n";
const REBOOTING = "mini-autologin: rebooting\n";
const LOST =
  "mini-autologin: ssh to the mini failed before any reboot; auto-login may not be restored, run it again\n";

const PLIST = "/Library/Preferences/com.apple.loginwindow";
// The one root command that writes the file: mode 600 from the start, replaced only when non-empty.
const ROOT_WRITE =
  "umask 077 && cat > /etc/kcpassword.new && [ -s /etc/kcpassword.new ] && chown root:wheel /etc/kcpassword.new && chmod 600 /etc/kcpassword.new && mv -f /etc/kcpassword.new /etc/kcpassword || { rm -f /etc/kcpassword.new; exit 1; }";
const KC_STAT: FakeRule = {
  argv: ["-f", "%i %m %z", "/etc/kcpassword"],
  stdoutFromState: "kc",
  ignoresStdin: true,
};

// The root write keeps what it got (the encoded file) in the sandbox and, by default, gives
// /etc/kcpassword a new inode and mtime: the state stat prints.
const WRITE: FakeRule = {
  argv: ["-n", "sh", "-c"],
  shell: 'cat > "$FAKE_DIR/kcpassword"',
  set: { kc: "2 200 24\n" },
};
// sudo: -k and -S answer by rule, the root write by `write`; -n drops itself and -- and runs the
// rest, stdin included.
const sudo = (validate: FakeRule = {}, write: FakeRule = WRITE): FakeRule[] => [
  { argv: ["-k"], ignoresStdin: true },
  { argv: ["-S"], ...validate },
  write,
  { argv: ["-n"], shell: 'shift; [[ $1 == -- ]] && shift; exec "$@"' },
];
// defaults write sets autoLoginUser (to the account by default), read prints it.
const defaults = (written = `${MINI_USER}\n`): FakeRule[] => [
  { argv: ["write"], set: { auto: written }, ignoresStdin: true },
  { argv: ["read"], stdoutFromState: "auto", ignoresStdin: true },
];

// The mini as the remote side sees it: sudo, the encoder (real perl) and the restore check's tools,
// with an old /etc/kcpassword and autoLoginUser the account already there, as when the password changed.
async function mini(t: Parameters<typeof remote>[0], write: FakeRule = WRITE) {
  const sb = await remote(t, []);
  sb.setState({ kc: "1 100 24\n", auto: `${MINI_USER}\n` });
  sb.fake("sudo", sudo({}, write));
  sb.fake("sysadminctl", [{}]);
  sb.fake("stat", [KC_STAT]);
  sb.fake("defaults", defaults());
  return sb;
}

// The file the root write got: what perl encoded.
const written = (sb: Sandbox) => fs.readFileSync(path.join(sb.dir, "kcpassword"));

// /etc/kcpassword's public encoding (brunerd/macAdminTools setAutoLogin): the password zero-padded
// to the next multiple of 12 bytes (12 more when it is one), XORed with the 11-byte key repeated.
const KEY = [0x7d, 0x89, 0x52, 0x23, 0xd2, 0xbc, 0xdd, 0xea, 0xa3, 0xb9, 0x1f];
function kcpassword(password: string): Buffer {
  const bytes = Buffer.from(password);
  const out = Buffer.alloc(bytes.length + 12 - (bytes.length % 12));
  for (let i = 0; i < out.length; i++) out[i] = (bytes[i] ?? 0) ^ (KEY[i % KEY.length] ?? 0);
  return out;
}

// Runs the restore with `password` as the account's password instead of the canary.
async function withPassword(t: Parameters<typeof remote>[0], password: string) {
  const sb = await mini(t);
  fs.rmSync(sb.passwordFile);
  fs.writeFileSync(sb.passwordFile, password, { mode: 0o400 });
  const r = await sb.run(["zsh", SCRIPT]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, RESTORED);
  assert.equal(r.stderr, "");
  return written(sb);
}

// The mini at the login window for --reboot: the console user and boot time come from state, which
// `shutdown` (by default) turns into a new boot with the account logged in.
async function loginWindow(
  t: Parameters<typeof remote>[0],
  shutdown: FakeRule = { set: { boot: "b2\n", console: `${MINI_USER}\n` } },
  write: FakeRule = WRITE,
) {
  const sb = await mini(t, write);
  sb.setState({ console: "root\n", boot: "b1\n" });
  sb.fake("stat", [
    { argv: ["-f%Su", "/dev/console"], stdoutFromState: "console", ignoresStdin: true },
    KC_STAT,
  ]);
  sb.fake("sysctl", [
    { argv: ["-n", "kern.boottime"], stdoutFromState: "boot", ignoresStdin: true },
  ]);
  sb.fake("shutdown", [{ argv: ["-r", "now"], ignoresStdin: true, ...shutdown }]);
  sb.fake("sleep", [{ ignoresStdin: true }]);
  return sb;
}

const lastSudo = (sb: Sandbox) => sb.calls("sudo").at(-1)?.argv;
const PROBE = "stat -f%Su /dev/console; sysctl -n kern.boottime";
const probes = (sb: Sandbox) => sb.calls("ssh").filter((c) => c.argv.at(-1) === PROBE);

test("restores auto-login with the password on stdin only", async (t) => {
  const sb = await mini(t);
  const r = await sb.run(["zsh", SCRIPT]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, RESTORED);
  assert.equal(r.stderr, "");
  assert.equal(sb.calls("ssh").length, 1);
  assert.equal(sb.calls("ssh")[0]?.stdin, sb.canary);
  const validate = sb.calls("sudo").find((c) => c.argv[0] === "-S");
  assert.equal(validate?.stdin, sb.canary + "\n");
  const writes = sb.calls("sudo").filter((c) => c.argv[1] === "sh");
  assert.deepEqual(
    writes.map((c) => c.argv),
    [["-n", "sh", "-c", ROOT_WRITE]],
  );
  assert.deepEqual(written(sb), kcpassword(sb.canary));
  assert.deepEqual(
    sb.calls("defaults").map((c) => c.argv),
    [
      ["write", PLIST, "autoLoginUser", "-string", MINI_USER],
      ["read", PLIST, "autoLoginUser"],
    ],
  );
  assert.deepEqual(sb.calls("sysadminctl"), []);
  assert.deepEqual(sb.calls("sudo")[0]?.argv, ["-k"]);
  assert.deepEqual(lastSudo(sb), ["-k"]);
  onlyOnStdin(sb, r);
});

test("a refused sudo password changes nothing", async (t) => {
  const sb = await mini(t);
  sb.fake("sudo", sudo({ exit: 1, stderr: "Sorry, try again.\n" }));
  const r = await sb.run(["zsh", SCRIPT]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "mini-autologin: sudo refused the password; changed nothing\n");
  assert.deepEqual(
    sb.calls("sudo").filter((c) => c.argv[0] === "-n"),
    [],
  );
  assert.deepEqual(sb.calls("defaults"), []);
  assert.deepEqual(lastSudo(sb), ["-k"]);
  onlyOnStdin(sb, r);
});

test("encodes /etc/kcpassword in the public format", async (t) => {
  // The public example: "password" padded to 12 bytes.
  assert.equal((await withPassword(t, "password")).toString("hex"), "0de82150a5d3af8ea3b91f7d");
  // 12 bytes take 12 bytes of padding.
  assert.equal(
    (await withPassword(t, "passwordpass")).toString("hex"),
    "0de82150a5d3af8ed3d86c0e" + "895223d2bcddeaa3b91f7d89",
  );
  // A trailing newline ends the password; it is not encoded.
  assert.deepEqual(await withPassword(t, "password\n"), kcpassword("password"));
});

test("an old /etc/kcpassword left in place fails the restore check", async (t) => {
  const kept: FakeRule = { ...WRITE, set: {} };
  const sb = await mini(t, kept);
  sb.fake("shutdown", [{}]);
  let r = await sb.run(["zsh", SCRIPT]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, NOT_RESTORED);
  assert.equal(sb.state().kc, "1 100 24\n");
  assert.equal(sb.state().auto, `${MINI_USER}\n`);
  assert.deepEqual(lastSudo(sb), ["-k"]);
  onlyOnStdin(sb, r);

  const lw = await loginWindow(t, undefined, kept);
  r = await lw.run(["zsh", SCRIPT, "--reboot"]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, NOT_RESTORED);
  assert.deepEqual(lw.calls("shutdown"), []);
  assert.deepEqual(lw.calls("sleep"), []);
});

test("a failed write or restore check exits 1 without a reboot", async (t) => {
  const cases: { write?: FakeRule; state?: Record<string, string>; auto?: string; err: string }[] =
    [
      // the root sh fails (a shell rule's own exit code is the call's)
      {
        write: { ...WRITE, shell: 'cat >/dev/null; print -u2 "sh: denied"; exit 1', set: {} },
        err: "sh: denied\n" + NOT_WRITTEN,
      },
      // no file before or after
      { write: { ...WRITE, set: {} }, state: { kc: "" }, err: NOT_RESTORED },
      // an empty file
      { write: { ...WRITE, set: { kc: "2 200 0\n" } }, err: NOT_RESTORED },
      // autoLoginUser not the account after the write
      { state: { auto: "" }, auto: "", err: NOT_RESTORED },
    ];
  for (const { write, state, auto, err } of cases) {
    const sb = await mini(t, write);
    if (state) sb.setState(state);
    if (auto !== undefined) sb.fake("defaults", defaults(auto));
    sb.fake("shutdown", [{}]);
    const r = await sb.run(["zsh", SCRIPT]);
    assert.equal(r.code, 1);
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, err);
    assert.deepEqual(sb.calls("shutdown"), []);
    assert.deepEqual(lastSudo(sb), ["-k"]);
    onlyOnStdin(sb, r);
  }
});

test("a lost ssh before the reboot exits 1 without waiting", async (t) => {
  const sb = await mini(t);
  sb.fake("ssh", [{ exit: 255, stderr: "ssh: connect to host mini: Connection refused\n" }]);
  sb.fake("sleep", [{ ignoresStdin: true }]);
  const r = await sb.run(["zsh", SCRIPT]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "ssh: connect to host mini: Connection refused\n" + LOST);
  assert.equal(sb.calls("ssh").length, 1);
  assert.deepEqual(sb.calls("sleep"), []);
});

test("with no password file it exits 1 and never calls ssh", async (t) => {
  const sb = await mini(t);
  fs.rmSync(sb.passwordFile);
  const r = await sb.run(["zsh", SCRIPT]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(
    r.stderr,
    `mini-autologin: no mini password in ${envPassword(sb)} or ${sb.passwordFile}; the user writes it (host/README.md, Steps 4); changed nothing\n`,
  );
  assert.deepEqual(sb.calls("ssh"), []);
});

const envPassword = (sb: Sandbox) => path.join(sb.secrets, "env/mini-password");

function writeEnvPassword(sb: Sandbox, text: string): void {
  fs.mkdirSync(path.join(sb.secrets, "env"));
  fs.writeFileSync(envPassword(sb), text, { mode: 0o400 });
}

test("the environment's mini-password comes before the secrets dir's", async (t) => {
  const sb = await mini(t);
  writeEnvPassword(sb, "from-env");
  const r = await sb.run(["zsh", SCRIPT]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, RESTORED);
  assert.equal(sb.calls("ssh")[0]?.stdin, "from-env");
  assert.deepEqual(written(sb), kcpassword("from-env"));
});

test("an empty environment mini-password exits 1 and never calls ssh", async (t) => {
  const sb = await mini(t);
  writeEnvPassword(sb, "");
  const r = await sb.run(["zsh", SCRIPT]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(
    r.stderr,
    `mini-autologin: ${envPassword(sb)} is empty or unreadable; changed nothing\n`,
  );
  assert.deepEqual(sb.calls(), []);
});

test("without a valid account in ~/.mini-op/ssh_config it exits 1 and never calls ssh", async (t) => {
  const sb = await mini(t);
  const repo = path.join(sb.dir, "repo");
  fs.cpSync(path.join(REPO, "ctl"), path.join(repo, "ctl"), { recursive: true });
  fs.mkdirSync(path.join(repo, "host"));
  fs.writeFileSync(path.join(repo, "host/config"), "");
  const config = path.join(sb.home, ".mini-op/ssh_config");
  fs.writeFileSync(config, "Host mini\n    User ../x\n");
  const r = await sb.run(["zsh", path.join(repo, "ctl/mini-autologin")]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, `mini-autologin: cannot read the mini's account from ${config}\n`);
  assert.deepEqual(sb.calls(), []);
});

test("other arguments are usage errors", async (t) => {
  const sb = await mini(t);
  const shapes = [["x"], ["--lock"], ["--no-such-option"], ["--reboot", "x"], ["-h", "x"], [""]];
  for (const args of shapes) {
    const r = await sb.run(["zsh", SCRIPT, ...args]);
    assert.equal(r.code, 2);
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, "mini-autologin: usage: mini-autologin [--reboot]\n");
  }
  assert.deepEqual(sb.calls(), []);
});

test("-h prints the usage to stdout and calls nothing", async (t) => {
  const sb = await mini(t);
  fs.rmSync(sb.passwordFile);
  const r = await sb.run(["zsh", SCRIPT, "-h"]);
  assert.equal(r.code, 0);
  assert.equal(r.stderr, "");
  const lines = r.stdout.split("\n");
  assert.match(lines[0] ?? "", /^mini-autologin \[--reboot\] /);
  for (const part of [
    "writes /etc/kcpassword itself",
    "autoLoginUser",
    "only at the login window",
    "300 s",
    "$(env_secrets_dir)/mini-password",
    "$(secrets_dir)/mini-password",
    "sudo -S",
    "perl",
    "124",
  ]) {
    assert.ok(r.stdout.includes(part), part);
  }
  assert.ok(lines.every((line) => line.length <= 100));
  assert.deepEqual(sb.calls(), []);
});

test("--reboot restores, reboots and waits for the account", async (t) => {
  const sb = await loginWindow(t);
  const r = await sb.run(["zsh", SCRIPT, "--reboot"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(
    r.stdout,
    RESTORED + REBOOTING + `mini-autologin: rebooted; console user is ${MINI_USER}\n`,
  );
  assert.equal(r.stderr, "");
  const ssh = sb.calls("ssh");
  assert.equal(ssh.length, 3);
  assert.deepEqual(
    ssh.map((c) => c.stdin),
    ["", sb.canary, ""],
  );
  assert.equal(probes(sb).length, 2);
  assert.equal(sb.calls("shutdown").length, 1);
  assert.deepEqual(written(sb), kcpassword(sb.canary));
  assert.deepEqual(lastSudo(sb), ["-k"]);
  assert.equal(sb.calls("sleep").length, 1);
  onlyOnStdin(sb, r);
});

test("--reboot refuses unless at the login window", async (t) => {
  const sb = await loginWindow(t);
  sb.setState({ console: `${MINI_USER}\n` });
  let r = await sb.run(["zsh", SCRIPT, "--reboot"]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(
    r.stderr,
    `mini-autologin: ${MINI_USER} is logged in, not at the login window; changed nothing\n`,
  );
  assert.equal(sb.calls("ssh").length, 1);
  assert.deepEqual(sb.calls("sudo"), []);

  const down = await loginWindow(t);
  down.fake("ssh", [{ exit: 255, stderr: "ssh: connect to host mini: Operation timed out\n" }]);
  r = await down.run(["zsh", SCRIPT, "--reboot"]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(
    r.stderr,
    "ssh: connect to host mini: Operation timed out\nmini-autologin: cannot reach the mini; changed nothing\n",
  );
  assert.equal(down.calls("ssh").length, 1);
  assert.ok(down.calls("ssh").every((c) => c.stdin === ""));
});

test("--reboot does not reboot when the account logged in meanwhile", async (t) => {
  const sb = await loginWindow(t, undefined, {
    ...WRITE,
    set: { ...WRITE.set, console: `${MINI_USER}\n` },
  });
  const r = await sb.run(["zsh", SCRIPT, "--reboot"]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, RESTORED);
  assert.equal(
    r.stderr,
    `mini-autologin: ${MINI_USER} logged in meanwhile; auto-login is restored, not rebooting\n`,
  );
  assert.deepEqual(sb.calls("shutdown"), []);
  assert.deepEqual(sb.calls("sleep"), []);
  assert.deepEqual(lastSudo(sb), ["-k"]);
  onlyOnStdin(sb, r);
});

test("a refused reboot exits 1 without waiting", async (t) => {
  const sb = await loginWindow(t, { exit: 1, stderr: "shutdown: NOT super-user\n" });
  const r = await sb.run(["zsh", SCRIPT, "--reboot"]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, RESTORED + REBOOTING);
  assert.equal(
    r.stderr,
    "shutdown: NOT super-user\nmini-autologin: reboot refused; auto-login is restored\n",
  );
  assert.deepEqual(sb.calls("sleep"), []);
  assert.deepEqual(lastSudo(sb), ["-k"]);
  onlyOnStdin(sb, r);
});

test("--reboot times out with 124 when the mini does not come back", async (t) => {
  const sb = await loginWindow(t, {});
  const r = await sb.run(["zsh", SCRIPT, "--reboot"], { timeoutMs: 60000 });
  assert.equal(r.code, 124);
  assert.equal(r.stdout, RESTORED + REBOOTING);
  assert.equal(
    r.stderr,
    `mini-autologin: timed out after 300 s: the mini did not come back from the reboot; ask the user to log ${MINI_USER} in\n`,
  );
  assert.equal(sb.calls("sleep").length, 30);
  assert.ok(sb.calls("sleep").every((c) => c.argv.join(" ") === "10"));
  assert.equal(probes(sb).length, 31);
  onlyOnStdin(sb, r);
});

test("--reboot exits 1 when the console user after the reboot is not the account", async (t) => {
  const sb = await loginWindow(t, { set: { boot: "b2\n" } });
  const r = await sb.run(["zsh", SCRIPT, "--reboot"], { timeoutMs: 60000 });
  assert.equal(r.code, 1);
  assert.equal(r.stdout, RESTORED + REBOOTING);
  assert.equal(
    r.stderr,
    `mini-autologin: rebooted, but the console user is root, not ${MINI_USER}; ask the user to log ${MINI_USER} in\n`,
  );
  assert.equal(sb.calls("sleep").length, 30);
  onlyOnStdin(sb, r);
});

test("--reboot waits after ssh drops past the rebooting line, not before it", async (t) => {
  // sshd dies with the reboot: the restore call exits 255 after printing the rebooting line.
  const sb = await loginWindow(t);
  sb.fake("ssh", [
    {
      when: { phase: "probed" },
      stdout: RESTORED + REBOOTING,
      exit: 255,
      set: { phase: "rebooted", boot: "b2\n", console: `${MINI_USER}\n` },
    },
    { when: { phase: "rebooted" }, local: true },
    { local: true, set: { phase: "probed" } },
  ]);
  let r = await sb.run(["zsh", SCRIPT, "--reboot"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(
    r.stdout,
    RESTORED + REBOOTING + `mini-autologin: rebooted; console user is ${MINI_USER}\n`,
  );

  const lost = await loginWindow(t);
  lost.fake("ssh", [
    { when: { phase: "probed" }, exit: 255, stderr: "Connection closed by remote host\n" },
    { local: true, set: { phase: "probed" } },
  ]);
  r = await lost.run(["zsh", SCRIPT, "--reboot"]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "Connection closed by remote host\n" + LOST);
  assert.equal(lost.calls("ssh").length, 2);
  assert.deepEqual(lost.calls("sleep"), []);
});

// ssh's own lines (the reboot's lost connection) never come before the script's output; with both
// streams on one terminal, as `2>&1` puts them.
const merged = (sb: Sandbox, args: string[]) =>
  sb.run(["sh", "-c", 'exec zsh "$0" "$@" 2>&1', SCRIPT, ...args]);
const CLOSED =
  "Connection to mini closed by remote host.\nclient_loop: send disconnect: Broken pipe\n";

test("ssh's disconnect at the reboot is not shown; its other errors come after the output", async (t) => {
  const sb = await loginWindow(t);
  sb.fake("ssh", [
    {
      when: { phase: "probed" },
      stdout: RESTORED + REBOOTING,
      stderr: CLOSED,
      exit: 255,
      set: { phase: "rebooted", boot: "b2\n", console: `${MINI_USER}\n` },
    },
    { when: { phase: "rebooted" }, local: true },
    { local: true, set: { phase: "probed" } },
  ]);
  let r = await merged(sb, ["--reboot"]);
  assert.equal(r.code, 0, r.stdout);
  assert.equal(
    r.stdout,
    RESTORED + REBOOTING + `mini-autologin: rebooted; console user is ${MINI_USER}\n`,
  );

  // A refused reboot: the remote's stderr follows its stdout.
  const refused = await loginWindow(t, { exit: 1, stderr: "shutdown: NOT super-user\n" });
  r = await merged(refused, ["--reboot"]);
  assert.equal(r.code, 1);
  assert.equal(
    r.stdout,
    RESTORED +
      REBOOTING +
      "shutdown: NOT super-user\nmini-autologin: reboot refused; auto-login is restored\n",
  );

  // A failed write: the root sh's error, then the script's.
  const failed = await mini(t, {
    ...WRITE,
    shell: 'cat >/dev/null; print -u2 "sh: /etc/kcpassword.new: Permission denied"; exit 1',
    set: {},
  });
  r = await merged(failed, []);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "sh: /etc/kcpassword.new: Permission denied\n" + NOT_WRITTEN);

  // A connection lost before the reboot: ssh's reason, then the script's conclusion.
  const lost = await mini(t);
  lost.fake("ssh", [{ exit: 255, stderr: "ssh: connect to host mini: Connection refused\n" }]);
  r = await merged(lost, []);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "ssh: connect to host mini: Connection refused\n" + LOST);
});
