// FR-36's canary scenarios: every script that reads a secret, run with fakes feeding it, so a
// test can check the secret reaches only its final consumers' stdin (Sandbox.leaks). The
// canary_scenarios guard requires a row here for each secret-reading script.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { REPO, type RunResult, type Sandbox } from "./sandbox.ts";
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

const hex = () => randomBytes(8).toString("hex");

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

function sshGotCanary(sb: Sandbox, r: RunResult): void {
  assert.equal(r.code, 0, r.stderr);
  assert.ok(sb.calls("ssh").length > 0);
  for (const call of sb.calls("ssh")) assert.equal(call.stdin, sb.canary);
}

// ctl/ scripts send only the injected password to ssh stdin.
type CtlRow = { script: string; title: string; args: string[]; env?: boolean };
const ctl = ({ script, title, args }: CtlRow): Scenario => ({
  script,
  title,
  args: () => args,
  setup(sb) {
    sb.fake("ssh", [{ stdout: "ok\n" }]);
  },
  consumers: ["ssh"],
  check: sshGotCanary,
});

export const SECRET_SCRIPTS: Scenario[] = [
  {
    script: "mini/bin/maillink",
    title: "consumes a mail login link through JXA stdin without token argv",
    args: () => ["follow", "role@example.com"],
    setup(sb) {
      sb.mini();
      sb.fake("sleep", [{ ignoresStdin: true }]);
      fs.mkdirSync(path.join(sb.home, "apm/state"), { recursive: true });
      fs.writeFileSync(path.join(sb.home, "apm/state/maillink.role_example_com"), "");
      const outlook = fs
        .readFileSync(path.join(REPO, "mini/js/page/outlook.js"), "utf8")
        .split("\n")
        .slice(1)
        .join("\n")
        .trimEnd();
      sb.fake("opencli", [
        { argv: ["browser", "eval", `${outlook}("rows","Linear")`], stdout: '{"data":"fresh"}\n' },
        {
          stdout:
            JSON.stringify({
              data: `https://linear.app/auth/email/role@example.com/${sb.canary}`,
            }) + "\n",
        },
      ]);
      sb.fake("osascript", [{}]);
    },
    consumers: ["osascript"],
    check(sb, r) {
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.stdout, "followed\n");
      const auth = sb
        .calls("osascript")
        .filter((c) => c.program === "chrome.js" && c.argv.at(-1) === "auth");
      assert.equal(auth.length, 1);
      assert.ok(auth[0]?.stdin.includes(sb.canary));
      assert.ok(
        sb.calls("opencli").every((c) => c.argv.slice(-2).join(" ") === "--window background"),
      );
    },
  },
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
  ctl({
    script: "ctl/mini",
    title: "sudo -v checks the environment's password",
    args: ["sudo", "-v"],
    env: true,
  }),
  ctl({ script: "ctl/mini", title: "sudo runs a command with sudo", args: ["sudo", "ls", "-la"] }),
  ctl({
    script: "ctl/mini-autologin",
    title: "restores the account's auto-login as root",
    args: [],
  }),
  ctl({
    script: "ctl/mini-autologin",
    title: "restores the auto-login with the environment's password",
    args: [],
    env: true,
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
      sb.mini();
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
