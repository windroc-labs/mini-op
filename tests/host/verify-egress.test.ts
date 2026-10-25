import assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox, type FakeRule } from "../lib/sandbox.ts";

const VERIFY = path.join(REPO, "host/verify-egress");
const CURL = ["exec", "mini-op", "curl", "-sS", "-o", "/dev/null"];
const PROXIED = [
  ...CURL,
  "--proxytunnel",
  "-x",
  "http://mini-op-proxy:4750",
  "--connect-timeout",
  "5",
  "-m",
  "10",
  "-w",
  "%{http_connect}",
];
const DIRECT = [
  ...CURL,
  "--noproxy",
  "*",
  "--connect-timeout",
  "5",
  "-m",
  "10",
  "-w",
  "%{time_connect}",
];
const CLAUDE = ["exec", "mini-op", "timeout", "120", "claude", "-p", "Reply with exactly: ok"];
const SSH = [
  ...["exec", "mini-op", "timeout", "30", "ssh"],
  ...["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "mini", "echo", "ok"],
];
const BLOCKED = [
  "http://host.docker.internal:11434",
  "http://192.168.1.1",
  "https://192.168.1.1",
  "https://192.168.1.51:5001",
  "https://192.168.1.62:5001",
  "http://192.168.1.40:8080",
  "https://example.com",
  "https://1.1.1.1",
];

type Setup = { extra?: FakeRule[]; claude?: string; claudeExit?: number };

// fake docker for an isolated mini-op; `extra` rules come first, so they override a target's answer.
// claude also prints `secret` on its stderr, which verify-egress must never pass on.
function docker(secret: string, setup: Setup): FakeRule[] {
  return [
    ...(setup.extra ?? []),
    { argv: ["inspect"], stdout: "mini-op-net \n" },
    { argv: ["network", "inspect"], stdout: "true\n" },
    { argv: [...PROXIED, "https://api.anthropic.com"], stdout: "200" },
    { argv: PROXIED, stdout: "407", exit: 56 },
    { argv: DIRECT, stdout: "0.000000", exit: 7 },
    {
      argv: CLAUDE,
      stdout: setup.claude ?? "ok\n",
      stderr: `debug: token ${secret}\n`,
      exit: setup.claudeExit ?? 0,
    },
    { argv: SSH, stdout: "ok\n" },
  ];
}

async function verify(t: Parameters<typeof Sandbox.create>[0], args: string[], setup: Setup = {}) {
  const sb = await Sandbox.create(t);
  const secret = `sk-ant-oat01-${sb.canary}`;
  sb.fake("docker", docker(secret, setup));
  const r = await sb.run(["bash", VERIFY, ...args]);
  assert.deepEqual(sb.leaks({ consumers: [], secrets: [secret] }), []);
  return { sb, r };
}

// The table's rows after its header, check to result.
function rows(stdout: string): Map<string, string> {
  const [header = "", ...lines] = stdout.trimEnd().split("\n");
  assert.match(header, /^CHECK +\| EXPECTED +\| RESULT$/);
  return new Map(
    lines.map((line) => {
      const [check = "", , result = ""] = line.split(" | ").map((cell) => cell.trim());
      return [check, result];
    }),
  );
}

function failed(stdout: string): string[] {
  return [...rows(stdout)].filter(([, result]) => result !== "PASS").map(([check]) => check);
}

test("--egress-only passes an isolated container without running claude or ssh", async (t) => {
  const { sb, r } = await verify(t, ["--egress-only"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.ok(!/FAIL/.test(r.stdout), r.stdout);
  assert.match(r.stdout, /proxy: https:\/\/example\.com\s+\| denied \(407\)\s+\| PASS/);
  assert.match(r.stdout, /direct: https:\/\/1\.1\.1\.1\s+\| no connection\s+\| PASS/);
  assert.ok(!/claude -p|ssh mini/.test(r.stdout), r.stdout);
  const ran = sb.calls("docker").map((call) => call.argv);
  assert.ok(ran.length > 0);
  for (const argv of ran) {
    assert.ok(!argv.includes("claude") && !argv.includes("ssh"), argv.join(" "));
  }
});

test("--egress-only fails when the proxy lets a denied target through", async (t) => {
  const { r } = await verify(t, ["--egress-only"], {
    extra: [{ argv: [...PROXIED, "https://example.com"], stdout: "200" }],
  });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /proxy: https:\/\/example\.com\s+\| denied \(407\)\s+\| FAIL/);
});

test("--egress-only fails when a direct connection is made", async (t) => {
  const { r } = await verify(t, ["--egress-only"], {
    extra: [{ argv: [...DIRECT, "https://1.1.1.1"], stdout: "0.004211", exit: 60 }],
  });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /direct: https:\/\/1\.1\.1\.1\s+\| no connection\s+\| FAIL/);
});

test("--egress-only fails when the API is not reachable through the proxy", async (t) => {
  const { r } = await verify(t, ["--egress-only"], {
    extra: [{ argv: [...PROXIED, "https://api.anthropic.com"], stdout: "000", exit: 7 }],
  });
  assert.equal(r.code, 1);
});

test("-h prints usage to stdout and runs nothing", async (t) => {
  const { sb, r } = await verify(t, ["-h"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^verify-egress \[--egress-only\] /);
  assert.equal(r.stderr, "");
  assert.deepEqual(sb.calls("docker"), []);
});

test("an unknown option or extra argument is a usage error", async (t) => {
  for (const args of [["--bogus"], ["--egress-only", "x"]]) {
    const { sb, r } = await verify(t, args);
    assert.equal(r.code, 2);
    assert.equal(r.stderr, "verify-egress: usage: verify-egress [--egress-only]\n");
    assert.equal(r.stdout, "");
    assert.deepEqual(sb.calls("docker"), []);
  }
});

test("an isolated container passes every row, claude and ssh included", async (t) => {
  const { r } = await verify(t, []);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const table = rows(r.stdout);
  for (const target of BLOCKED) {
    assert.equal(table.get(`proxy: ${target}`), "PASS", target);
    assert.equal(table.get(`direct: ${target}`), "PASS", target);
  }
  for (const check of [
    "proxy: https://api.anthropic.com",
    "claude -p answers",
    "ssh mini echo ok",
  ]) {
    assert.equal(table.get(check), "PASS", check);
  }
  assert.equal(table.size, 4 + 2 * BLOCKED.length);
  assert.deepEqual(failed(r.stdout), []);
});

test("a target open through the proxy fails only its row", async (t) => {
  const { r } = await verify(t, [], {
    extra: [{ argv: [...PROXIED, "https://example.com"], stdout: "200" }],
  });
  assert.equal(r.code, 1);
  assert.deepEqual(failed(r.stdout), ["proxy: https://example.com"]);
});

test("a direct TCP connection fails even when TLS then fails", async (t) => {
  const { r } = await verify(t, [], {
    extra: [{ argv: [...DIRECT, "https://1.1.1.1"], stdout: "0.004211", exit: 60 }],
  });
  assert.equal(r.code, 1);
  assert.deepEqual(failed(r.stdout), ["direct: https://1.1.1.1"]);
});

test("a proxy that is down fails the control and every proxy row", async (t) => {
  const { r } = await verify(t, [], { extra: [{ argv: PROXIED, stdout: "000", exit: 7 }] });
  assert.equal(r.code, 1);
  const table = rows(r.stdout);
  assert.equal(table.get("proxy: https://api.anthropic.com"), "FAIL");
  for (const target of BLOCKED) assert.equal(table.get(`proxy: ${target}`), "FAIL", target);
});

test("an allowed target the proxy cannot reach (502) is not a block", async (t) => {
  const { r } = await verify(t, [], {
    extra: [{ argv: [...PROXIED, "http://192.168.1.40:8080"], stdout: "502", exit: 56 }],
  });
  assert.equal(r.code, 1);
  assert.deepEqual(failed(r.stdout), ["proxy: http://192.168.1.40:8080"]);
});

test("a network besides mini-op-net fails", async (t) => {
  const { r } = await verify(t, [], {
    extra: [{ argv: ["inspect"], stdout: "bridge mini-op-net \n" }],
  });
  assert.equal(r.code, 1);
  assert.deepEqual(failed(r.stdout), ["mini-op networks: only internal mini-op-net"]);
});

test("claude error text containing ok, or ok with a nonzero exit, fails", async (t) => {
  for (const setup of [
    { claude: "API Error: 401 OAuth token has expired\n" },
    { claude: "ok\n", claudeExit: 1 },
  ]) {
    const { r } = await verify(t, [], setup);
    assert.equal(r.code, 1, JSON.stringify(setup));
    assert.deepEqual(failed(r.stdout), ["claude -p answers"]);
  }
});

test("a reply of OK. passes", async (t) => {
  const { r } = await verify(t, [], { claude: "OK.\n" });
  assert.equal(r.code, 0, r.stdout);
  assert.deepEqual(failed(r.stdout), []);
});

test("an empty claude reply and a refused ssh fail their rows", async (t) => {
  const { r } = await verify(t, [], {
    claude: "\n",
    extra: [{ argv: SSH, stdout: "Permission denied\n" }],
  });
  assert.equal(r.code, 1);
  assert.deepEqual(failed(r.stdout), ["claude -p answers", "ssh mini echo ok"]);
});

test("the only mini contact is ssh mini echo ok", async (t) => {
  const { sb } = await verify(t, []);
  const calls = sb.calls("docker").map((call) => call.argv);
  const ssh = calls.filter((argv) => argv.includes("ssh"));
  assert.deepEqual(ssh, [SSH]);
  assert.deepEqual(ssh[0]?.slice(-3), ["mini", "echo", "ok"]);
  assert.deepEqual(
    calls.filter((argv) => argv.includes("mini")),
    ssh,
  );
});
