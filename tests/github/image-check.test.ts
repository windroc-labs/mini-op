import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { REPO, Sandbox, type FakeRule } from "../lib/sandbox.ts";
import { FAKE_LOCAL, MINI_HOST, MINI_USER } from "../lib/ssh_config.ts";
import { steps, type Job } from "../lib/workflows.ts";

const CHECK = path.join(REPO, ".github/image-check");
const IMAGES = ["mini-op:2.1.308-1", "mini-op-proxy:v0.1.0"];
const INSPECT = ["inspect", "-f", "{{.Config.Image}}", "mini-op", "mini-op-proxy"];
const HISTORY = ["history", "--no-trunc", "--format", "{{.CreatedBy}}"];
const TAG = "/* mini-op-image-check */";
const ADDRESS = MINI_HOST;
// The container's account as ctl/lib/ssh.zsh reads it there.
const MINI_USER_CMD = [
  "exec",
  "mini-op",
  "zsh",
  "-fc",
  "source /opt/windroc/plugins/mini-op/ctl/lib/ssh.zsh && mini_user",
];
const GIT_ENV = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};
type T = Parameters<typeof Sandbox.create>[0];

// A git repo whose HEAD commit changes `files` on top of base.
async function repoWith(sb: Sandbox, files: string[]): Promise<{ dir: string; base: string }> {
  const dir = path.join(sb.dir, "repo");
  fs.mkdirSync(dir);
  const git = async (...args: string[]) => {
    const r = await sb.run(["git", ...args], { cwd: dir, env: GIT_ENV });
    assert.equal(r.code, 0, r.stderr);
    return r.stdout.trim();
  };
  await git("init", "-q");
  fs.writeFileSync(path.join(dir, "README.md"), "one\n");
  await git("add", "-A");
  await git("commit", "-q", "-m", "base");
  const base = await git("rev-parse", "HEAD");
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), "changed\n");
  }
  await git("add", "-A");
  await git("commit", "-q", "-m", "change");
  return { dir, base };
}

async function changed(t: T, files: string[], base?: string) {
  const sb = await Sandbox.create(t);
  const repo = await repoWith(sb, files);
  const args = ["bash", CHECK, "changed", ...(base === undefined ? [repo.base] : [base])];
  return sb.run(base === "" ? args.slice(0, 3) : args, { cwd: repo.dir });
}

test("changed: a docs-only diff needs no build, and says so", async (t) => {
  const r = await changed(t, ["README.md", "runbooks/x.md", "host/README.md", "mini/bin/ans"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "build=false\n");
  assert.match(r.stderr, /no build needed \(无需构建\)/);
});

for (const file of [
  "host/Dockerfile",
  "host/claude-code.asc",
  "host/config",
  "host/config.yaml",
  "host/proxy/acl.yaml",
  "host/proxy/Dockerfile",
  "host/ssh_config.container",
  ".github/workflows/ci.yml",
  ".github/image-check",
  "mini/lib/secrets.zsh",
  "host/start",
  "host/update",
  "host/verify-egress",
]) {
  test(`changed: ${file} needs a build`, async (t) => {
    const r = await changed(t, ["README.md", file]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, "build=true\n");
  });
}

test("changed: moving a file out of an image input needs a build", async (t) => {
  const sb = await Sandbox.create(t);
  const dir = path.join(sb.dir, "repo");
  fs.mkdirSync(path.join(dir, "host/proxy"), { recursive: true });
  fs.mkdirSync(path.join(dir, "docs"));
  const git = (...args: string[]) => sb.run(["git", ...args], { cwd: dir, env: GIT_ENV });
  fs.writeFileSync(path.join(dir, "host/proxy/acl.yaml"), "version: v1\n".repeat(20));
  await git("init", "-q");
  await git("add", "-A");
  await git("commit", "-q", "-m", "base");
  const base = (await git("rev-parse", "HEAD")).stdout.trim();
  await git("mv", "host/proxy/acl.yaml", "docs/acl.yaml");
  await git("commit", "-q", "-m", "move");
  const r = await sb.run(["bash", CHECK, "changed", base], { cwd: dir });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "build=true\n");
});

test("changed: no base, or a base git does not have, builds", async (t) => {
  for (const base of ["", "0".repeat(40)]) {
    const r = await changed(t, ["README.md"], base);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, "build=true\n");
  }
});

function docker(history: Record<string, string>): FakeRule[] {
  return [
    { argv: INSPECT, stdout: IMAGES.join("\n") + "\n" },
    ...IMAGES.map((image) => ({ argv: [...HISTORY, image], stdout: history[image] ?? "" })),
  ];
}

const CLEAN = "RUN /bin/sh -c apt-get install -y claude-code=2.1.308-1\nCOPY ssh_config /etc/ssh\n";

test("history: clean images pass", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("docker", docker({ [IMAGES[0]!]: CLEAN, [IMAGES[1]!]: CLEAN }));
  const r = await sb.run(["bash", CHECK, "history"]);
  assert.equal(r.code, 0, r.stderr);
  for (const image of IMAGES) assert.ok(r.stdout.includes(`history clean: ${image}`));
});

for (const [name, secret] of [
  ["sk-ant-", "sk-ant-" + "api03-NOTAREALKEY"],
  ["lin_api_", "lin_api_" + "NOTAREALKEY"],
  ["gh[pousr]_", "ghs_" + "NOTAREALTOKEN"],
  ["gh[pousr]_", "ghp_" + "NOTAREALTOKEN"],
  ["github_pat_", "github_pat_" + "NOTAREALTOKEN"],
  ["private key", "-----BEGIN " + "OPENSSH PRIVATE KEY-----"],
  ["private key", "-----BEGIN " + "PRIVATE KEY-----"],
  ["sk-ant-", "KEY_" + "sk-ant-" + "_x"],
] as const) {
  test(`history: ${secret.slice(0, 8)}… in a layer fails without printing it`, async (t) => {
    const sb = await Sandbox.create(t);
    const leaky = `${CLEAN}RUN /bin/sh -c echo ${secret} > /x\n`;
    sb.fake("docker", docker({ [IMAGES[0]!]: leaky, [IMAGES[1]!]: CLEAN }));
    const r = await sb.run(["bash", CHECK, "history"]);
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes(`${IMAGES[0]} history line(s) 3 match ${name}`), r.stderr);
    assert.ok(!(r.stdout + r.stderr).includes(secret));
    assert.equal(r.stdout, `history clean: ${IMAGES[1]}\n`);
  });
}

test("history: patterns come from mini/lib/secrets.zsh; without it the check fails", async (t) => {
  const sb = await Sandbox.create(t);
  const copy = path.join(sb.dir, "copy/.github/image-check");
  fs.mkdirSync(path.dirname(copy), { recursive: true });
  fs.copyFileSync(CHECK, copy);
  sb.fake("docker", docker({ [IMAGES[0]!]: CLEAN, [IMAGES[1]!]: CLEAN }));
  const r = await sb.run(["bash", copy, "history"]);
  assert.equal(r.code, 1);
  const lib = path.join(sb.dir, "copy/mini/lib/secrets.zsh");
  assert.equal(r.stderr, `image-check: cannot read secret patterns from ${lib}\n`);
  assert.equal(r.stdout, "");
});

test("history: containers that cannot be inspected fail", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("docker", [{ argv: INSPECT, exit: 1 }]);
  const r = await sb.run(["bash", CHECK, "history"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^image-check: cannot inspect/);
});

const SMOKE: FakeRule[] = [
  { argv: ["exec", "mini-op", "id", "-u"], stdout: "1000\n" },
  { argv: ["exec", "mini-op", "sh", "-c", "! command -v sudo"] },
  { argv: ["exec", "mini-op", "sh", "-c", "! command -v python3"] },
  { argv: ["exec", "mini-op", "claude", "--version"], stdout: "2.1.308 (Claude Code)\n" },
  { argv: ["exec", "mini-op", "ssh", "-V"], stderr: "OpenSSH_10.0\n" },
  { argv: ["exec", "mini-op", "zsh", "--version"] },
  { argv: ["exec", "mini-op", "jq", "--version"] },
  { argv: ["exec", "mini-op", "sh", "-c", "command -v nc"], stdout: "/usr/bin/nc\n" },
  { argv: MINI_USER_CMD, stdout: `${MINI_USER}\n` },
];

async function smoke(t: T, extra: FakeRule[] = []) {
  const sb = await Sandbox.create(t);
  sb.fake("docker", [...extra, ...SMOKE]);
  return sb.run(["bash", CHECK, "smoke"]);
}

test("smoke: a non-root container without sudo or python3 and with its tools passes", async (t) => {
  const r = await smoke(t);
  assert.equal(r.code, 0, r.stdout);
  assert.ok(!/FAIL/.test(r.stdout), r.stdout);
  for (const row of [
    "non-root (uid 1000)",
    "no sudo on PATH",
    "no python3 on PATH",
    "claude --version",
    "nc on PATH",
    "mini_user is host/config's mini_user",
  ]) {
    assert.ok(r.stdout.includes(row), row);
  }
});

for (const [label, rule, row] of [
  ["root", { argv: ["exec", "mini-op", "id", "-u"], stdout: "0\n" }, "non-root (uid 0)"],
  ["sudo on PATH", { argv: ["exec", "mini-op", "sh", "-c", "! command -v sudo"], exit: 1 }, "sudo"],
  [
    "a python3 on PATH",
    { argv: ["exec", "mini-op", "sh", "-c", "! command -v python3"], exit: 1 },
    "no python3",
  ],
  ["no claude", { argv: ["exec", "mini-op", "claude", "--version"], exit: 127 }, "claude"],
  ["no ssh", { argv: ["exec", "mini-op", "ssh", "-V"], exit: 127 }, "ssh -V"],
  ["no zsh", { argv: ["exec", "mini-op", "zsh", "--version"], exit: 127 }, "zsh"],
  ["no jq", { argv: ["exec", "mini-op", "jq", "--version"], exit: 127 }, "jq --version"],
  ["no nc", { argv: ["exec", "mini-op", "sh", "-c", "command -v nc"], exit: 1 }, "nc on PATH"],
  ["another account", { argv: MINI_USER_CMD, stdout: `x${MINI_USER}\n` }, "mini_user"],
  ["no account", { argv: MINI_USER_CMD, exit: 1 }, "mini_user"],
] satisfies [string, FakeRule, string][]) {
  test(`smoke: ${label} fails`, async (t) => {
    const r = await smoke(t, [rule]);
    assert.equal(r.code, 1, r.stdout);
    const failing = r.stdout.split("\n").filter((line) => line.endsWith("| FAIL"));
    assert.equal(failing.length, 1, r.stdout);
    assert.ok(failing[0]!.includes(row), r.stdout);
  });
}

function table(chain: string, pkts: number | null): string {
  const rows = [
    `Chain ${chain} (1 references)`,
    "    pkts      bytes target     prot opt in     out     source               destination",
  ];
  if (pkts !== null) {
    rows.push(
      `${String(pkts).padStart(8)}     4200 REJECT     0    --  *      *       0.0.0.0/0` +
        `            ${ADDRESS}        ${TAG} reject-with icmp-port-unreachable`,
    );
  }
  rows.push("     812    90210 RETURN     0    --  *      *       0.0.0.0/0            0.0.0.0/0");
  return rows.join("\n") + "\n";
}

test("block-mini rejects the address from host/config in DOCKER-USER and OUTPUT", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("iptables", [{ argv: ["-w", "-I"] }]);
  const r = await sb.run(["bash", CHECK, "block-mini"]);
  assert.equal(r.code, 0, r.stderr);
  const rule = ["-d", ADDRESS, "-m", "comment", "--comment", "mini-op-image-check", "-j", "REJECT"];
  assert.deepEqual(
    sb.calls("iptables").map((call) => call.argv),
    [
      ["-w", "-I", "DOCKER-USER", ...rule],
      ["-w", "-I", "OUTPUT", ...rule],
    ],
  );
});

test("block-mini writes CI's fake config when HOME has none, and keeps an existing one", async (t) => {
  const sb = await Sandbox.create(t);
  const local = path.join(sb.home, ".mini-op/config.local.yaml");
  fs.rmSync(path.join(sb.home, ".mini-op"), { recursive: true });
  sb.fake("iptables", [{ argv: ["-w", "-I"] }]);
  const r = await sb.run(["bash", CHECK, "block-mini"]);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.stdout.startsWith(`wrote CI's fake ${local} (no mini in CI)\n`), r.stdout);
  assert.equal(fs.readFileSync(local, "utf8"), FAKE_LOCAL);
  assert.equal(fs.statSync(path.dirname(local)).mode & 0o777, 0o700);
  assert.ok(sb.calls("iptables").every((call) => call.argv.includes(MINI_HOST)));
  const other = [10, 1, 2, 3].join(".");
  fs.writeFileSync(local, `mini_host: ${other}\nmini_user: ${MINI_USER}\n`);
  const again = await sb.run(["bash", CHECK, "block-mini"]);
  assert.equal(again.code, 0, again.stderr);
  assert.ok(!again.stdout.includes("wrote"), again.stdout);
  assert.ok(
    sb
      .calls("iptables")
      .slice(2)
      .every((call) => call.argv.includes(other)),
  );
});

test("block-mini fails on an invalid local config or SUDO_USER, adding no rule", async (t) => {
  const sb = await Sandbox.create(t);
  const local = path.join(sb.home, ".mini-op/config.local.yaml");
  fs.writeFileSync(local, `mini_user: ${MINI_USER}\n`);
  sb.fake("iptables", [{ argv: ["-w", "-I"] }]);
  const r = await sb.run(["bash", CHECK, "block-mini"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^config: mini_host is empty/);
  assert.ok(r.stderr.endsWith("image-check: cannot read the mini's mini_host (host/config)\n"));
  for (const [user, message] of [
    ["../x", "SUDO_USER ../x is not an account name"],
    ["zq_absent", "no home for SUDO_USER zq_absent"],
  ]) {
    const bad = await sb.run(["bash", CHECK, "block-mini"], { env: { SUDO_USER: user } });
    assert.equal(bad.code, 1, user);
    assert.equal(bad.stderr, `image-check: ${message}\n`);
  }
  assert.deepEqual(sb.calls("iptables"), []);
});

test("block-mini fails when a rule cannot be added", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("iptables", [{ argv: ["-w", "-I"], exit: 1 }]);
  const r = await sb.run(["bash", CHECK, "block-mini"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^image-check: cannot add the DOCKER-USER rule/);
});

async function untouched(t: T, user: number | null, output: number | null) {
  const sb = await Sandbox.create(t);
  sb.fake("iptables", [
    { argv: ["-w", "-nvxL", "DOCKER-USER"], stdout: table("DOCKER-USER", user) },
    { argv: ["-w", "-nvxL", "OUTPUT"], stdout: table("OUTPUT", output) },
  ]);
  return sb.run(["bash", CHECK, "mini-untouched"]);
}

test("mini-untouched passes when no packet hit the mini rules", async (t) => {
  const r = await untouched(t, 0, 0);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "nothing was sent to the mini\n");
});

test("mini-untouched fails when a packet was sent to the mini", async (t) => {
  for (const [user, output] of [
    [3, 0],
    [0, 1],
  ] as const) {
    const r = await untouched(t, user, output);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /^image-check: \d+ packet\(s\) to the mini were sent and rejected/);
  }
});

test("mini-untouched fails when a rule is missing", async (t) => {
  const r = await untouched(t, 0, null);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^image-check: no mini-op-image-check rule in OUTPUT/);
});

test("-h prints usage; misuse exits 2 and runs nothing", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("docker", []);
  sb.fake("iptables", []);
  const help = await sb.run(["bash", CHECK, "-h"]);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /^image-check changed \[<base>\] \| history \| smoke \|/);
  assert.equal(help.stderr, "");
  for (const args of [
    [],
    ["bogus"],
    ["--bogus"],
    ["smoke", "x"],
    ["changed", "a", "b"],
    ["changed", "--bogus"],
    ["-h", "x"],
  ]) {
    const r = await sb.run(["bash", CHECK, ...args]);
    assert.equal(r.code, 2, args.join(" "));
    assert.equal(r.stdout, "", args.join(" "));
    assert.equal(
      r.stderr,
      "image-check: usage: image-check changed [<base>] | history | smoke | block-mini |" +
        " mini-untouched\n",
      args.join(" "),
    );
  }
  assert.deepEqual(sb.calls(), []);
});

test("ci.yml: the Image job always reports, builds only on a change, and runs weekly", () => {
  const ci = parse(fs.readFileSync(path.join(REPO, ".github/workflows/ci.yml"), "utf8")) as {
    on: Record<string, { paths?: unknown; cron?: string }[] | Record<string, unknown> | null>;
    jobs: Record<string, Job>;
  };
  assert.ok(Array.isArray(ci.on.schedule) && ci.on.schedule.some((s) => s.cron), "no schedule");
  for (const event of ["pull_request", "push"]) {
    assert.ok(!(ci.on[event] && "paths" in ci.on[event]), `${event} has a paths filter`);
  }
  const job = ci.jobs.image;
  assert.equal(job?.name, "Image");
  assert.equal(job?.if, undefined);
  const list = steps(job!);
  const decide = list.find((step) => step.run?.includes(".github/image-check changed"));
  assert.equal(decide?.id, "changes");
  const BUILD = "steps.changes.outputs.build == 'true'";
  const report = list.find((step) => step.if?.includes("steps.changes.outputs.build != 'true'"));
  assert.match(report?.run ?? "", /无需构建[\s\S]*GITHUB_STEP_SUMMARY/);
  const gated = [
    "sudo .github/image-check block-mini",
    "host/start",
    ".github/image-check history",
    ".github/image-check smoke",
    "host/verify-egress --egress-only",
    "sudo .github/image-check mini-untouched",
  ];
  const at = gated.map((run) => list.findIndex((step) => step.run?.trim() === run));
  assert.ok(
    at.every((i) => i > 0),
    `missing: ${gated.filter((_, i) => at[i]! < 0).join(", ")}`,
  );
  assert.deepEqual(
    [...at].sort((a, b) => a - b),
    at,
    "steps out of order",
  );
  for (const i of at) assert.ok(list[i]!.if?.includes(BUILD), list[i]!.run);
  assert.match(list[at.at(-1)!]!.if ?? "", /always\(\)/);
  assert.ok([ci.jobs.ci?.needs ?? []].flat().includes("image"));
});
