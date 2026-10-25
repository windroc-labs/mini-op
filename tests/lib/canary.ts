// FR-36's canary scenarios: every script that reads a secret, run with fakes feeding it, so a
// test can check the secret reaches only its final consumers' stdin (Sandbox.leaks). The
// canary_scenarios guard requires a row here for each secret-reading script.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { RunResult, Sandbox } from "./sandbox.ts";
import { MINI_USER } from "./ssh_config.ts";

export type Scenario = {
  script: string;
  title: string;
  args?: (sb: Sandbox) => string[];
  input?: (sb: Sandbox) => string;
  // Sets up the fakes; returns the secrets to look for (default: the sandbox canary).
  setup(sb: Sandbox): string[] | void;
  consumers: string[];
  // Checks the run did its job: the consumers got the secrets.
  check(sb: Sandbox, r: RunResult, secrets: string[]): void;
};

export const hex = () => randomBytes(8).toString("hex");

const ID = "1761200000-4242-17";

// Screen text holding one token of each pattern around a fresh hex body, and those bodies.
function screen(): { text: string; secrets: string[] } {
  const secrets = [hex(), hex(), hex(), hex()];
  const [a, b, c, d] = secrets;
  const key = [
    "-----BEGIN " + "OPENSSH PRIVATE KEY-----",
    `b3Bl${d}`,
    "-----END " + "OPENSSH PRIVATE KEY-----",
  ];
  const lines = [
    "mini ~ % x",
    `ghs_${a}`,
    `lin_api_${b}`,
    `sk-ant-oat01-${c}`,
    ...key,
    "mini ~ % ",
  ];
  return { text: lines.join("\n") + "\n", secrets };
}

const stdinOf = (sb: Sandbox, cmd: string) =>
  sb
    .calls(cmd)
    .map((call) => call.stdin)
    .join("");

function sshGotCanary(sb: Sandbox, r: RunResult): void {
  assert.equal(r.code, 0, r.stderr);
  assert.ok(sb.calls("ssh").length > 0);
  for (const call of sb.calls("ssh")) assert.equal(call.stdin, sb.canary);
}

// ctl/ scripts send the mini account's password from the secrets dir to ssh's stdin.
type CtlRow = { script: string; title: string; args: string[] };
const ctl = ({ script, title, args }: CtlRow): Scenario => ({
  script,
  title,
  args: () => args,
  setup: (sb) => sb.fake("ssh", [{ stdout: "ok\n" }]),
  consumers: ["ssh"],
  check: sshGotCanary,
});

export const SECRET_SCRIPTS: Scenario[] = [
  ctl({ script: "ctl/mini", title: "pw types the password into the Terminal", args: ["pw"] }),
  ctl({
    script: "ctl/mini",
    title: "pw --lock types the password into the lock screen",
    args: ["pw", "--lock"],
  }),
  ctl({
    script: "ctl/mini",
    title: "pw --sa types the password into SecurityAgent",
    args: ["pw", "--sa"],
  }),
  ctl({
    script: "ctl/mini",
    title: "pw --settings types the password into a System Settings sheet",
    args: ["pw", "--settings"],
  }),
  ctl({ script: "ctl/mini", title: "sudo -v checks the sudo password", args: ["sudo", "-v"] }),
  ctl({ script: "ctl/mini", title: "sudo runs a command with sudo", args: ["sudo", "ls", "-la"] }),
  ctl({
    script: "ctl/mini-autologin",
    title: "restores the account's auto-login as root",
    args: [],
  }),
  {
    script: "ctl/mini-autologin",
    title: "restores the account's auto-login, reboots and waits for it",
    args: () => ["--reboot"],
    setup(sb) {
      // the probe at the login window, the restore call, then the probe after the reboot
      sb.fake("ssh", [
        { when: { ssh: "probed" }, stdout: "ok\n", set: { ssh: "restored" } },
        { when: { ssh: "restored" }, stdout: `${MINI_USER}\nb2\n` },
        { stdout: "root\nb1\n", set: { ssh: "probed" } },
      ]);
      sb.fake("sleep", [{ ignoresStdin: true }]);
    },
    consumers: ["ssh"],
    check(sb, r) {
      assert.equal(r.code, 0, r.stderr);
      assert.deepEqual(
        sb.calls("ssh").map((call) => call.stdin),
        ["", sb.canary, ""],
      );
    },
  },
  {
    script: "mini/bin/secfield",
    title: "types a secret from stdin into a page field",
    args: () => ["role", "#pw"],
    input: (sb) => sb.canary + "\n",
    setup(sb) {
      const o = path.join(sb.home, "apm/bin/o");
      fs.mkdirSync(path.dirname(o), { recursive: true });
      fs.writeFileSync(o, '#!/bin/sh\nexec opencli browser "$@"\n', { mode: 0o755 });
      sb.setState({ step: "xy" });
      const evalRule = (step: string, next: string, data: string) => ({
        argv: ["browser", "eval"],
        when: { step },
        set: { step: next },
        stdout: `{"data":${data}}\n`,
      });
      sb.fake("opencli", [
        evalRule("xy", "focus", '"100 200"'),
        evalRule("focus", "len", "true"),
        evalRule("len", "done", "12"),
      ]);
      sb.fake("osascript", [{}]);
    },
    consumers: ["osascript"],
    check(sb, r) {
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.stdout, "secfield: #pw filled, 12 chars\n");
      const typed = sb.calls("osascript").filter((call) => call.program === "keys.js");
      assert.deepEqual(
        typed.map((call) => call.stdin),
        [sb.canary],
      );
    },
  },
  {
    script: "mini/runbooks/setup-test-env/storekey",
    title: "stores the clipboard's Linear key and checks it",
    args: () => ["ensemble-test-linear-key", "ensemble-test"],
    input: (sb) => sb.canary + "\n",
    setup(sb) {
      const clip = hex();
      const stored = hex();
      sb.fake("pbpaste", [{ stdout: `lin_api_${clip}` }]);
      sb.fake("pbcopy", [{}]);
      sb.fake("security", [
        { argv: ["-i"] },
        { argv: ["find-generic-password"], stdout: `lin_api_${stored}\n` },
      ]);
      sb.fake("curl", [{ stdout: '{"data":{"viewer":{"name":"x"}}}' }]);
      return [sb.canary, clip, stored];
    },
    consumers: ["security", "curl"],
    check(sb, r, secrets) {
      assert.equal(r.code, 0, r.stderr);
      const [password, clip, stored] = secrets;
      const security = stdinOf(sb, "security");
      assert.ok(security.includes(`unlock-keychain -p "${password}"`));
      assert.ok(security.includes(`-w "lin_api_${clip}"`));
      assert.equal(stdinOf(sb, "curl"), `Authorization: lin_api_${stored}\n`);
      assert.deepEqual(
        sb.calls("pbcopy").map((call) => call.stdin),
        ["x"],
      );
    },
  },
  {
    script: "mini/runbooks/setup-test-env/importkey",
    title: "copies an exported keychain item into the login keychain",
    args: () => ["/tmp/apm.x/export.keychain-db", "ensemble-test-github", "dotpm2026"],
    input: (sb) => sb.canary + "\n",
    setup(sb) {
      const item = hex();
      sb.fake("security", [
        { argv: ["-i"] },
        {
          argv: ["find-generic-password", "-s", "ensemble-test-github", "-a", "dotpm2026", "-w"],
          stdout: `${item}\n`,
        },
        { argv: ["find-generic-password"] },
        { argv: ["lock-keychain"] },
      ]);
      return [sb.canary, item];
    },
    consumers: ["security"],
    check(sb, r, secrets) {
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.stdout, "importkey: ensemble-test-github/dotpm2026 imported\n");
      const [password, item] = secrets;
      const security = stdinOf(sb, "security");
      assert.ok(security.includes(`unlock-keychain -p "${password}" login.keychain`));
      assert.ok(security.includes(`-w "${item}" login.keychain`));
    },
  },
  {
    script: "mini/runbooks/setup-test-env/lq",
    title: "sends a Linear request with the keychain key",
    args: (sb) => {
      const body = path.join(sb.dir, "tmp/body.json");
      fs.writeFileSync(body, '{"query":"{ viewer { id } }"}');
      return [body];
    },
    setup(sb) {
      sb.fake("security", [{ argv: ["find-generic-password"], stdout: sb.canary + "\n" }]);
      sb.fake("curl", [{ stdout: "{}" }]);
    },
    consumers: ["curl"],
    check(sb, r) {
      assert.equal(r.code, 0, r.stderr);
      assert.equal(stdinOf(sb, "curl"), `Authorization: ${sb.canary}\n`);
    },
  },
  {
    script: "mini/bin/ans",
    title: "types a secret answer from stdin (a keychain key piped in)",
    args: () => ["5", "--to", ID],
    input: (sb) => sb.canary + "\n",
    setup(sb) {
      sb.mini();
      fs.mkdirSync(path.join(sb.home, "apm/state/done"), { recursive: true });
      fs.writeFileSync(path.join(sb.home, "apm/state/done", ID), "0\n");
      sb.setState({ hist: "before" });
      const terminal = (arg: string) => ({
        program: "terminal.js",
        args: [arg],
        ignoresStdin: true,
      });
      sb.fake("osascript", [
        { program: "keys.js", args: ["--enter"], set: { hist: "after" } },
        { ...terminal("activate"), stdout: "Terminal\n" },
        { ...terminal("history"), stdoutFromState: "hist" },
        { ...terminal("contents"), stdout: "API key saved\nmini ~ % \n" },
        terminal("bottom"),
      ]);
    },
    consumers: ["osascript"],
    check(sb, r) {
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.stdout, `API key saved\nmini ~ % \n${ID} exited 0\n`);
      const typed = sb.calls("osascript").filter((call) => call.program === "keys.js");
      assert.deepEqual(
        typed.map((call) => call.stdin),
        [sb.canary + "\n"],
      );
    },
  },
  {
    script: "mini/bin/termwait",
    title: "prints the screen with every secret pattern hidden",
    args: () => ["1", "--after", ID],
    setup(sb) {
      const { text, secrets } = screen();
      fs.mkdirSync(path.join(sb.home, "apm/state/done"), { recursive: true });
      fs.writeFileSync(path.join(sb.home, "apm/state/done", ID), "0\n");
      sb.fake("osascript", [{ stdout: text }]);
      return secrets;
    },
    consumers: [],
    check(_sb, r) {
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, /<redacted>/);
    },
  },
  {
    script: "mini/bin/shot",
    title: "refuses a screenshot while the screen holds a secret",
    setup(sb) {
      const { text, secrets } = screen();
      sb.fake("osascript", [{ stdout: text }]);
      sb.fake("screencapture", [{}]);
      return secrets;
    },
    consumers: [],
    check(sb, r) {
      assert.equal(r.code, 1);
      assert.deepEqual(sb.calls("screencapture"), []);
    },
  },
];
