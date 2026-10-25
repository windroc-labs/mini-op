import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { PLUGIN_ROOT } from "../lib/repo.ts";
import { REPO, Sandbox, type FakeRule } from "../lib/sandbox.ts";
import { steps, type Job } from "../lib/workflows.ts";

const CHECK = path.join(REPO, ".github/image-check");
const TAG = "mini-op-image-check";
const HISTORY = ["history", "--no-trunc", "--format", "{{.CreatedBy}}", TAG];
const IN = ["run", "--rm", "--network", "none", TAG];
const LABELS = [
  "image",
  "inspect",
  "-f",
  "{{range $k, $v := .Config.Labels}}{{println $k}}{{end}}",
];
const HOME_FILES = ["-name", "mini", "-o", "-name", "ctl", "-o", "-name", ".claude-plugin"];
// The PATH the ensemble layer sets (its Dockerfile), built from parts.
const ENSEMBLE_PATH = [
  "/opt/ensemble/bin",
  "/home/agent/.npm-global/bin",
  ...["usr/local/bin", "usr/bin", "bin"].map((dir) => "/" + dir),
].join(":");
const MINI_H = ["run", "--rm", "--network", "none", "-e", `PATH=${ENSEMBLE_PATH}`, "-w", "/tmp"];
const GIT_ENV = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};
type T = Parameters<typeof Sandbox.create>[0];

function gitIn(sb: Sandbox, dir: string) {
  return async (...args: string[]) => {
    const r = await sb.run(["git", ...args], { cwd: dir, env: GIT_ENV });
    assert.equal(r.code, 0, r.stderr);
    return r.stdout.trim();
  };
}

// A git repo whose HEAD commit changes `files` on top of base.
async function repoWith(sb: Sandbox, files: string[]): Promise<{ dir: string; base: string }> {
  const dir = path.join(sb.dir, "repo");
  fs.mkdirSync(dir);
  const git = gitIn(sb, dir);
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

test("changed: a diff of tests and host docs needs no build, and says so", async (t) => {
  const r = await changed(t, ["tests/github/x.test.ts", "host/README.md"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "build=false\n");
  assert.match(r.stderr, /no build needed \(无需构建\)/);
});

// The job builds no proxy and runs no host script: their changes alone need no image build.
for (const file of [
  "tests/x.test.ts",
  "host/README.md",
  "host/config",
  "host/config.yaml",
  "host/proxy/acl.yaml",
  "host/proxy/Dockerfile",
  "host/start",
  "host/verify-egress",
]) {
  test(`changed: ${file} alone needs no build`, async (t) => {
    const r = await changed(t, [file]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, "build=false\n");
  });
}

for (const file of [
  "host/Dockerfile",
  "host/Dockerfile.dockerignore",
  "host/claude-code.asc",
  "host/ssh_config.container",
  "host/ssh_config.keys",
  "plugin/.claude-plugin/plugin.json",
  "ctl/mini",
  "mini/lib/secrets.zsh",
  "runbooks/x.md",
  "README.md",
  ".github/workflows/ci.yml",
  ".github/image-check",
]) {
  test(`changed: ${file} needs a build`, async (t) => {
    const r = await changed(t, [file]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, "build=true\n");
  });
}

test("changed: moving a file out of an image input needs a build", async (t) => {
  const sb = await Sandbox.create(t);
  const dir = path.join(sb.dir, "repo");
  fs.mkdirSync(path.join(dir, "ctl/lib"), { recursive: true });
  fs.mkdirSync(path.join(dir, "docs"));
  const git = gitIn(sb, dir);
  fs.writeFileSync(path.join(dir, "ctl/lib/x.zsh"), "print x\n".repeat(20));
  await git("init", "-q");
  await git("add", "-A");
  await git("commit", "-q", "-m", "base");
  const base = await git("rev-parse", "HEAD");
  await git("mv", "ctl/lib/x.zsh", "docs/x.zsh");
  await git("commit", "-q", "-m", "move");
  const r = await sb.run(["bash", CHECK, "changed", base], { cwd: dir });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "build=true\n");
});

test("changed: no base, or a base git does not have, builds", async (t) => {
  for (const base of ["", "0".repeat(40)]) {
    const r = await changed(t, ["tests/x.test.ts"], base);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, "build=true\n");
  }
});

// The stamp ctl/lib/version.sh gives this checkout: its commit, -dirty with anything uncommitted.
async function stampOf(sb: Sandbox): Promise<string> {
  const git = gitIn(sb, REPO);
  const head = await git("rev-parse", "HEAD");
  return (await git("status", "--porcelain")) === "" ? head : `${head}-dirty`;
}

test("build: builds the image target from the checkout, stamped", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("docker", [{ argv: ["build"], stdout: "sha256:0123\n" }]);
  const r = await sb.run(["bash", CHECK, "build"]);
  assert.equal(r.code, 0, r.stderr);
  const stamp = await stampOf(sb);
  assert.equal(r.stdout, `built ${TAG} (${stamp})\n`);
  assert.deepEqual(
    sb.calls("docker").map((call) => call.argv),
    [
      [
        "build",
        "-q",
        "-t",
        TAG,
        "--target",
        "image",
        "-f",
        path.join(REPO, "host/Dockerfile"),
        "--build-arg",
        `MINI_OP_VERSION=${stamp}`,
        REPO,
      ],
    ],
  );
});

test("build: a failed build fails", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("docker", [{ argv: ["build"], stderr: "ERROR: no space\n", exit: 1 }]);
  const r = await sb.run(["bash", CHECK, "build"]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "ERROR: no space\nimage-check: building the image failed\n");
  assert.equal(r.stdout, "");
});

test("build: a copy outside a git checkout cannot be stamped and builds nothing", async (t) => {
  const sb = await Sandbox.create(t);
  const copy = path.join(sb.dir, "copy");
  for (const file of [".github/image-check", "ctl/lib/version.sh"]) {
    fs.mkdirSync(path.dirname(path.join(copy, file)), { recursive: true });
    fs.copyFileSync(path.join(REPO, file), path.join(copy, file));
  }
  sb.fake("docker", [{ argv: ["build"] }]);
  const r = await sb.run(["bash", path.join(copy, ".github/image-check"), "build"]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, `image-check: ${copy} is not a git checkout; cannot stamp the image\n`);
  assert.deepEqual(sb.calls("docker"), []);
});

const CLEAN = [
  "RUN /bin/sh -c apt-get install -y claude-code=2.1.308-1 # buildkit",
  "COPY host/ssh_config.container /etc/ssh/ssh_config.d/mini-proxy.conf # buildkit",
  "COPY host/ssh_config.keys /etc/ssh/ssh_config.d/mini-keys.conf # buildkit",
  "",
].join("\n");

async function history(t: T, lines: string, check = CHECK) {
  const sb = await Sandbox.create(t);
  sb.fake("docker", [{ argv: HISTORY, stdout: lines }]);
  return { sb, r: await sb.run(["bash", check, "history"]) };
}

test("history: a clean image passes", async (t) => {
  const { sb, r } = await history(t, CLEAN);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, `history clean: ${TAG}\n`);
  assert.deepEqual(
    sb.calls("docker").map((call) => call.argv),
    [HISTORY],
  );
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
    const { r } = await history(t, `${CLEAN}RUN /bin/sh -c echo ${secret} > /x\n`);
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes(`${TAG} history line(s) 4 match ${name}`), r.stderr);
    assert.ok(!(r.stdout + r.stderr).includes(secret));
    assert.equal(r.stdout, "");
  });
}

for (const copied of [
  "COPY --from=mini --chmod=0644 ssh_config /etc/ssh/ssh_config.d/mini.conf # buildkit",
  "COPY --from=mini --chmod=0644 known_hosts /etc/ssh/mini_known_hosts # buildkit",
]) {
  test(`history: ${copied.split(" ").at(-3)} copied in fails`, async (t) => {
    const { r } = await history(t, `${CLEAN}${copied}\n`);
    assert.equal(r.code, 1);
    assert.equal(
      r.stderr,
      `image-check: ${TAG} history line(s) 4 copy in the mini's ssh config or host key\n`,
    );
    assert.equal(r.stdout, "");
  });
}

test("history: patterns come from mini/lib/secrets.zsh; without it the check fails", async (t) => {
  const sb = await Sandbox.create(t);
  const copy = path.join(sb.dir, "copy/.github/image-check");
  fs.mkdirSync(path.dirname(copy), { recursive: true });
  fs.copyFileSync(CHECK, copy);
  const { r } = await history(t, CLEAN, copy);
  assert.equal(r.code, 1);
  const lib = path.join(sb.dir, "copy/mini/lib/secrets.zsh");
  assert.equal(r.stderr, `image-check: cannot read secret patterns from ${lib}\n`);
  assert.equal(r.stdout, "");
});

test("history: an image whose history cannot be read fails", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("docker", [{ argv: HISTORY, exit: 1 }]);
  const r = await sb.run(["bash", CHECK, "history"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^image-check: cannot read the history of mini-op-image-check\n$/);
});

function smokeRules(stamp: string): FakeRule[] {
  return [
    { argv: [...IN, "claude", "--version"], stdout: "2.1.308 (Claude Code)\n" },
    { argv: [...IN, "sh", "-c", "! command -v python3"] },
    { argv: [...IN, "id"], stdout: "uid=1000(agent) gid=1000(agent) groups=1000(agent)\n" },
    { argv: [...IN, "npm", "--version"], stdout: "10.9.9\n" },
    { argv: [...IN, "node", "--version"], stdout: "v20.19.2\n" },
    {
      argv: [...IN, "jq", "-r", ".version", `${PLUGIN_ROOT}/.claude-plugin/plugin.json`],
      stdout: `${stamp}\n`,
    },
    { argv: [...LABELS, TAG], stdout: "mini-op.version\n\n" },
    { argv: [...IN, "find", "/home/agent", ...HOME_FILES, "-o", "-name", "plugin.json"] },
    { argv: [...MINI_H, TAG, `${PLUGIN_ROOT}/ctl/mini`, "-h"], stdout: "mini <command>\n" },
    { argv: [...IN, "ssh", "-V"], stderr: "OpenSSH_10.0\n" },
    { argv: [...IN, "zsh", "--version"] },
    { argv: [...IN, "jq", "--version"] },
    { argv: [...IN, "sh", "-c", "command -v nc"], stdout: "/usr/bin/nc\n" },
    { argv: [...IN, "sh", "-c", "! command -v sudo"] },
    { argv: [...IN, "test", "!", "-e", "/etc/ssh/ssh_config.d/mini.conf"] },
    { argv: [...IN, "test", "!", "-e", "/etc/ssh/mini_known_hosts"] },
  ];
}

async function smoke(t: T, extra: (stamp: string) => FakeRule[] = () => []) {
  const sb = await Sandbox.create(t);
  const stamp = await stampOf(sb);
  sb.fake("docker", [...extra(stamp), ...smokeRules(stamp)]);
  return { sb, stamp, r: await sb.run(["bash", CHECK, "smoke"]) };
}

test("smoke: an image meeting every check passes, each row from a container without network", async (t) => {
  const { sb, stamp, r } = await smoke(t);
  assert.equal(r.code, 0, r.stdout);
  assert.ok(!/FAIL/.test(r.stdout), r.stdout);
  const rows = [
    "claude --version",
    "no python3 on PATH",
    "user agent, non-root (uid 1000)",
    "npm --version",
    "node --version",
    `plugin.json version ${stamp}`,
    "no windroc./ensemble. label",
    "/home/agent has no plugin files",
    "ctl/mini -h, ensemble PATH, cwd /tmp",
    "ssh -V",
    "zsh --version",
    "jq --version",
    "nc on PATH",
    "no sudo on PATH",
    "no ssh_config.d/mini.conf",
    "no mini_known_hosts",
  ];
  assert.deepEqual(
    r.stdout.split("\n").map((line) => line.split(" | ")[0]!.trim()),
    [...rows, ""],
  );
  const calls = sb.calls("docker");
  assert.ok(calls.every((call) => call.matched !== null));
  for (const call of calls) {
    assert.ok(
      call.argv[0] === "image" || call.argv.slice(0, 4).join(" ") === "run --rm --network none",
    );
  }
});

for (const [label, rule, row] of [
  ["no claude", { argv: [...IN, "claude", "--version"], exit: 127 }, "claude"],
  [
    "a python3 on PATH",
    { argv: [...IN, "sh", "-c", "! command -v python3"], exit: 1 },
    "no python3",
  ],
  ["root", { argv: [...IN, "id"], stdout: "uid=0(root) gid=0(root)\n" }, "user agent"],
  ["another user", { argv: [...IN, "id"], stdout: "uid=1000(op) gid=1000(op)\n" }, "user agent"],
  ["no npm", { argv: [...IN, "npm", "--version"], exit: 127 }, "npm --version"],
  ["no node", { argv: [...IN, "node", "--version"], exit: 127 }, "node --version"],
  ["another version", { argv: [...IN, "jq", "-r"], stdout: "0123\n" }, "plugin.json version"],
  ["no plugin.json", { argv: [...IN, "jq", "-r"], exit: 2 }, "plugin.json version"],
  ["a windroc. label", { argv: LABELS, stdout: "mini-op.version\nwindroc.x\n" }, "label"],
  ["an ensemble. label", { argv: LABELS, stdout: "ensemble.y\n" }, "label"],
  ["labels unreadable", { argv: LABELS, exit: 1 }, "label"],
  ["ctl/ under /home/agent", { argv: [...IN, "find"], stdout: "/home/agent/ctl\n" }, "/home/agent"],
  ["no /home/agent", { argv: [...IN, "find"], exit: 1 }, "/home/agent"],
  ["ctl/mini -h failing", { argv: MINI_H, exit: 1 }, "ctl/mini -h"],
  ["no ssh", { argv: [...IN, "ssh", "-V"], exit: 127 }, "ssh -V"],
  ["no zsh", { argv: [...IN, "zsh", "--version"], exit: 127 }, "zsh"],
  ["no jq", { argv: [...IN, "jq", "--version"], exit: 127 }, "jq --version"],
  ["no nc", { argv: [...IN, "sh", "-c", "command -v nc"], exit: 1 }, "nc on PATH"],
  ["sudo on PATH", { argv: [...IN, "sh", "-c", "! command -v sudo"], exit: 1 }, "sudo"],
  [
    "mini.conf baked",
    { argv: [...IN, "test", "!", "-e", "/etc/ssh/ssh_config.d/mini.conf"], exit: 1 },
    "mini.conf",
  ],
  [
    "host key baked",
    { argv: [...IN, "test", "!", "-e", "/etc/ssh/mini_known_hosts"], exit: 1 },
    "mini_known_hosts",
  ],
] satisfies [string, FakeRule, string][]) {
  test(`smoke: ${label} fails that row`, async (t) => {
    const { r } = await smoke(t, () => [rule]);
    assert.equal(r.code, 1, r.stdout);
    const failing = r.stdout.split("\n").filter((line) => line.endsWith("| FAIL"));
    assert.equal(failing.length, 1, r.stdout);
    assert.ok(failing[0]!.includes(row), r.stdout);
  });
}

test("-h prints usage; misuse exits 2 and runs nothing", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("docker", []);
  const help = await sb.run(["bash", CHECK, "-h"]);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /^image-check changed \[<base>\] \| build \| history \| smoke\n/);
  assert.equal(help.stderr, "");
  for (const args of [
    [],
    ["bogus"],
    ["--bogus"],
    ["build", "x"],
    ["history", "x"],
    ["smoke", "x"],
    ["block-mini"],
    ["changed", "a", "b"],
    ["changed", "--bogus"],
    ["-h", "x"],
  ]) {
    const r = await sb.run(["bash", CHECK, ...args]);
    assert.equal(r.code, 2, args.join(" "));
    assert.equal(r.stdout, "", args.join(" "));
    assert.equal(
      r.stderr,
      "image-check: usage: image-check changed [<base>] | build | history | smoke\n",
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
  const decide = list.findIndex((step) => step.run?.includes(".github/image-check changed"));
  assert.equal(list[decide]?.id, "changes");
  const BUILD = "steps.changes.outputs.build == 'true'";
  const report = list.find((step) => step.if?.includes("steps.changes.outputs.build != 'true'"));
  assert.match(report?.run ?? "", /无需构建[\s\S]*GITHUB_STEP_SUMMARY/);
  const gated = ["build", "history", "smoke"].map((sub) => `.github/image-check ${sub}`);
  const at = gated.map((run) => list.findIndex((step) => step.run?.trim() === run));
  assert.ok(
    at.every((i) => i > decide),
    `missing: ${gated.filter((_, i) => at[i]! <= decide).join(", ")}`,
  );
  assert.deepEqual(
    [...at].sort((a, b) => a - b),
    at,
    "steps out of order",
  );
  for (const i of at) assert.equal(list[i]!.if, BUILD, list[i]!.run);
  assert.equal(list.at(-1)?.name, "Require unchanged checkout");
  const runs = list.map((step) => step.run ?? "").join("\n");
  for (const word of ["host/start", "verify-egress", "sudo", "iptables", "proxy"]) {
    assert.ok(!runs.includes(word), `the Image job runs ${word}`);
  }
  assert.ok([ci.jobs.ci?.needs ?? []].flat().includes("image"));
});
