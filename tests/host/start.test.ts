import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { SECRETS_LITERAL } from "../lib/literals.ts";
import { REPO, Sandbox, type FakeRule } from "../lib/sandbox.ts";
import { FAKE_LOCAL, MINI_HOST } from "../lib/ssh_config.ts";

const START = path.join(REPO, "host/start");
const UID = /^ARG AGENT_UID=(\d+)$/m.exec(
  fs.readFileSync(path.join(REPO, "host/Dockerfile"), "utf8"),
)?.[1];
const IMAGE = "mini-op:env";
const PROXY_IMAGE = "mini-op-proxy:v0.1.0";
const CHECK = "mini-op-proxy-check";
const KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFake mini-op container\n";
const GIT = ["git", "-c", "user.name=t", "-c", "user.email=t@example.com"];
// The fake build keeps a copy of the named context mini=<dir>, which start removes on exit.
const KEEP_CONTEXT =
  'for a; do [[ $a == mini=* ]] && cp -R "${a#mini=}" "$FAKE_DIR/context"; done; true';
// The mini's confirmed host keys as ssh-keygen -F prints them: a # line, a hashed and a plain entry.
const HOST_KEYS = [
  "|1|c2FsdA==|aGFzaA== ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHostKey",
  `${MINI_HOST} ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIHostKey`,
];
const KEYGEN: FakeRule = {
  argv: ["-F"],
  stdout: `# Host ${MINI_HOST} found: line 3\n${HOST_KEYS.join("\n")}\n`,
};

// fake docker for a host with no mini-op-net yet, where every step works; `extra` rules come
// first, so they override a step's answer.
function docker(extra: FakeRule[] = []): FakeRule[] {
  return [
    ...extra,
    { argv: ["network", "inspect"], stderr: "Error: network mini-op-net not found\n", exit: 1 },
    { argv: ["network"] },
    { argv: ["build", "-q", "-t", IMAGE], shell: KEEP_CONTEXT },
    { argv: ["build"] },
    { argv: ["run", "--rm"], stdout: "2.1.0 (Claude Code)\n" },
    { argv: ["inspect", "-f", "{{.State.Running}}", CHECK], stdout: "true\n" },
    { argv: ["run", "-d"], stdout: "0123abcd\n" },
    { argv: ["rm", "-f"] },
    { argv: ["exec", "mini-op", "cat"], stdout: KEY },
    { argv: ["exec"] },
  ];
}

async function start(
  t: Parameters<typeof Sandbox.create>[0],
  extra?: FakeRule[],
  args: string[] = [],
  script = START,
  sandbox?: Sandbox,
  keygen: FakeRule[] = [KEYGEN],
) {
  const sb = sandbox ?? (await Sandbox.create(t));
  sb.fake("docker", docker(extra));
  sb.fake("ssh-keygen", keygen);
  sb.fake("sleep", [{ ignoresStdin: true }]);
  const r = await sb.run(["bash", script, ...args]);
  // A call as `docker <first two args>` plus the container it names (--name, or rm's last arg).
  const steps = sb.calls("docker").map(({ argv }) => {
    const name = argv.indexOf("--name");
    const container = name >= 0 ? argv[name + 1] : argv[0] === "rm" ? argv.at(-1) : undefined;
    return [...argv.slice(0, 2), ...(container === undefined ? [] : [container])].join(" ");
  });
  return { sb, r, steps };
}

// Calls that remove, create or change a container.
function touches(steps: string[]): string[] {
  return steps.filter((step) => /^(rm|run -d|network connect)/.test(step) && !step.includes(CHECK));
}

test("builds and checks both images, then recreates the proxy and mini-op", async (t) => {
  const { sb, r, steps } = await start(t);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, "");
  assert.equal(
    r.stdout,
    `mini-op running from ${IMAGE} (${await headStamp(sb)}) on mini-op-net, out only via` +
      ` mini-op-proxy (${PROXY_IMAGE}); agent's public key:\n${KEY}`,
  );
  const order = [
    "network inspect",
    "network create",
    "build -q",
    "run --rm",
    `run -d ${CHECK}`,
    "inspect -f",
    "rm -f mini-op",
    "rm -f mini-op-proxy",
    "run -d mini-op-proxy",
    "network connect",
    "run -d mini-op",
    "exec mini-op",
  ];
  const at = order.map((step) => steps.indexOf(step));
  assert.ok(
    at.every((i, n) => i >= 0 && (n === 0 || i > at[n - 1]!)),
    steps.join("\n"),
  );
  assert.equal(steps.filter((step) => step === "build -q").length, 2);
  // Nothing is copied into the running container, and nothing runs in it as root (AC5).
  const execs = sb.calls("docker").filter(({ argv }) => argv[0] === "exec");
  assert.deepEqual(
    execs.filter(({ argv }) => argv.includes("-i") || argv.includes("-u")),
    [],
  );
  assert.deepEqual(execs.at(-1)?.argv, [
    ...["exec", "mini-op", "cat", "/home/agent/.ssh/id_ed25519.pub"],
  ]);
  assert.deepEqual(
    sb.calls("sleep").map((call) => call.argv),
    [["2"]],
  );
});

test("a failed build or image check exits 1 and leaves the containers untouched", async (t) => {
  const cases: [FakeRule, string][] = [
    [{ argv: ["build", "-q", "-t", IMAGE], exit: 1 }, `building ${IMAGE} failed`],
    [{ argv: ["build", "-q", "-t", PROXY_IMAGE], exit: 1 }, `building ${PROXY_IMAGE} failed`],
    [{ argv: ["run", "--rm"], exit: 1 }, `claude does not run in ${IMAGE}`],
    [{ argv: ["run", "-d", "--name", CHECK], exit: 125 }, `could not run ${CHECK}`],
  ];
  for (const [rule, message] of cases) {
    const { r, steps } = await start(t, [rule]);
    assert.equal(r.code, 1);
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, `start: ${message}; existing containers left as they were\n`);
    assert.deepEqual(touches(steps), []);
  }
});

// The values given to any of `flags` in an argv, and the argv of `docker run -d --name <name> ...`.
const values = (argv: string[], ...flags: string[]) =>
  argv.filter((_, i) => i > 0 && flags.includes(argv[i - 1]!));
function runOf(sb: Sandbox, name: string): string[] {
  const call = sb
    .calls("docker")
    .find(
      ({ argv }) => argv[0] === "run" && argv[1] === "-d" && values(argv, "--name")[0] === name,
    );
  assert.ok(call, `no docker run -d --name ${name}`);
  return call.argv;
}

test("makes mini-op-net internal when it is missing, and reuses an internal one", async (t) => {
  const networks = (sb: Sandbox) =>
    sb
      .calls("docker")
      .filter(({ argv }) => argv[0] === "network" && argv[1] !== "connect")
      .map(({ argv }) => argv);
  const fresh = await start(t);
  assert.equal(fresh.r.code, 0, fresh.r.stderr);
  assert.deepEqual(networks(fresh.sb), [
    ["network", "inspect", "-f", "{{.Internal}}", "mini-op-net"],
    ["network", "create", "--internal", "mini-op-net"],
  ]);
  const reused = await start(t, [{ argv: ["network", "inspect"], stdout: "true\n" }]);
  assert.equal(reused.r.code, 0, reused.r.stderr);
  assert.deepEqual(networks(reused.sb), [
    ["network", "inspect", "-f", "{{.Internal}}", "mini-op-net"],
  ]);
});

test("mini-op runs only on mini-op-net, with the proxy env and agent's home volume", async (t) => {
  const { sb, r } = await start(t);
  assert.equal(r.code, 0, r.stderr);
  const run = runOf(sb, "mini-op");
  assert.equal(run.at(-1), IMAGE);
  assert.deepEqual(values(run, "--network", "--net"), ["mini-op-net"]);
  const proxy = "http://mini-op-proxy:4750";
  const local = "localhost,127.0.0.1,::1";
  assert.deepEqual(
    values(run, "-e", "--env").sort(),
    [
      `HTTPS_PROXY=${proxy}`,
      `HTTP_PROXY=${proxy}`,
      `https_proxy=${proxy}`,
      `http_proxy=${proxy}`,
      `NO_PROXY=${local}`,
      `no_proxy=${local}`,
      "NODE_USE_ENV_PROXY=1",
    ].sort(),
  );
  for (const flag of ["-p", "--publish", "-P", "-v", "--volume", "--privileged", "--add-host"]) {
    assert.ok(!run.includes(flag), flag);
  }
  assert.deepEqual(
    run.filter((arg) => /^-[^=]*=/.test(arg)),
    [],
  );
  assert.deepEqual(values(run, "--mount"), ["type=volume,src=mini-op-home,dst=/home/agent"]);
  assert.equal(UID, "1000");
  assert.deepEqual(values(run, "--tmpfs"), [
    `${SECRETS_LITERAL}:size=64k,mode=0700,uid=${UID},gid=${UID}`,
  ]);
  assert.deepEqual(values(run, "--cap-drop"), ["ALL"]);
  assert.deepEqual(values(run, "--security-opt"), ["no-new-privileges"]);
  assert.deepEqual(values(run, "--restart"), ["unless-stopped"]);
});

test("the build's named context mini holds the generated ssh config and the mini's host keys, removed on exit", async (t) => {
  const { sb, r } = await start(t);
  assert.equal(r.code, 0, r.stderr);
  const kept = path.join(sb.dir, "context");
  assert.deepEqual(fs.readdirSync(kept).sort(), ["known_hosts", "ssh_config"]);
  assert.equal(
    fs.readFileSync(path.join(kept, "ssh_config"), "utf8"),
    fs.readFileSync(path.join(sb.home, ".mini-op/ssh_config"), "utf8"),
  );
  assert.equal(
    fs.readFileSync(path.join(kept, "known_hosts"), "utf8"),
    `${HOST_KEYS.join("\n")}\n`,
  );
  for (const file of ["ssh_config", "known_hosts"]) {
    assert.equal(fs.statSync(path.join(kept, file)).mode & 0o077, 0, file);
  }
  assert.deepEqual(fs.readdirSync(path.join(sb.dir, "tmp")), []);
});

test("the host keys come from this Mac's known_hosts entry for the mini's address and port", async (t) => {
  for (const [port, entry] of [
    ["22", MINI_HOST],
    ["2222", `[${MINI_HOST}]:2222`],
  ] as const) {
    const sb = await Sandbox.create(t);
    fs.writeFileSync(
      path.join(sb.home, ".mini-op/config.local.yaml"),
      `${FAKE_LOCAL}mini_port: ${port}\n`,
    );
    const { r } = await start(t, [], [], START, sb);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(
      sb.calls("ssh-keygen").map(({ argv }) => argv),
      [["-F", entry, "-f", path.join(sb.home, ".ssh/known_hosts")]],
    );
  }
});

test("no confirmed host key for the mini exits 1, naming the entry, before any docker call", async (t) => {
  const cases: FakeRule[] = [
    { exit: 1 },
    { stdout: "" },
    { stdout: `# Host ${MINI_HOST} found: line 3\n` },
    { stderr: "ssh-keygen: No such file or directory\n", exit: 255 },
  ];
  for (const rule of cases) {
    const { sb, r } = await start(t, [], [], START, undefined, [rule]);
    assert.equal(r.code, 1, JSON.stringify(rule));
    assert.equal(r.stdout, "");
    assert.equal(
      r.stderr,
      `start: ~/.ssh/known_hosts has no host key for ${MINI_HOST}; check the mini's fingerprint,` +
        " confirm it once with ssh -F ~/.mini-op/ssh_config mini true, then rerun\n",
    );
    assert.deepEqual(sb.calls("docker"), []);
  }
});

test("the proxy is built from host/proxy with the generated named context and the policy label, and runs read-only on bridge before joining mini-op-net", async (t) => {
  const { sb, r } = await start(t);
  assert.equal(r.code, 0, r.stderr);
  const builds = sb
    .calls("docker")
    .filter(({ argv }) => argv[0] === "build")
    .map(({ argv }) => argv);
  const generated = path.join(sb.home, ".mini-op/proxy");
  const files = ["config.yaml", "acl.yaml"].map((f) => fs.readFileSync(path.join(generated, f)));
  const policy = createHash("sha256").update(Buffer.concat(files)).digest("hex");
  const context = values(builds[0] ?? [], "--build-context")[0] ?? "";
  assert.ok(context.startsWith(`mini=${path.join(sb.dir, "tmp")}/`), context);
  assert.deepEqual(builds, [
    [
      ...["build", "-q", "-t", IMAGE, "-f", path.join(REPO, "host/Dockerfile")],
      ...["--build-arg", `MINI_OP_VERSION=${await headStamp(sb)}`, "--build-context", context],
      REPO,
    ],
    [
      ...["build", "-q", "-t", PROXY_IMAGE, "--label", `mini-op.proxy-policy=${policy}`],
      ...["--build-context", `generated=${generated}`, path.join(REPO, "host/proxy")],
    ],
  ]);
  const run = runOf(sb, "mini-op-proxy");
  assert.equal(run.at(-1), PROXY_IMAGE);
  assert.deepEqual(values(run, "--network", "--net"), ["bridge"]);
  assert.ok(run.includes("--read-only"));
  assert.deepEqual(values(run, "--cap-drop"), ["ALL"]);
  assert.deepEqual(values(run, "--security-opt"), ["no-new-privileges"]);
  assert.deepEqual(values(run, "--restart"), ["unless-stopped"]);
  for (const flag of ["-p", "--publish", "-P", "-v", "--volume", "--mount"]) {
    assert.ok(!run.includes(flag), flag);
  }
  assert.deepEqual(
    run.filter((arg) => /^-[^=]*=/.test(arg)),
    [],
  );
  const connects = sb.calls("docker").filter(({ argv }) => argv[1] === "connect");
  assert.deepEqual(
    connects.map(({ argv }) => argv),
    [["network", "connect", "mini-op-net", "mini-op-proxy"]],
  );
});

test("both images are checked offline before any container is replaced", async (t) => {
  const { sb, r } = await start(t);
  assert.equal(r.code, 0, r.stderr);
  const calls = sb.calls().map(({ cmd, argv }) => [cmd, ...argv]);
  const at = (...prefix: string[]) =>
    calls.findIndex((call) => prefix.every((arg, i) => call[i] === arg));
  const image = calls[at("docker", "run", "--rm")]!;
  assert.deepEqual(values(image, "--network"), ["none"]);
  assert.deepEqual(image.slice(-3), [IMAGE, "claude", "--version"]);
  const check = runOf(sb, CHECK);
  assert.equal(check.at(-1), PROXY_IMAGE);
  assert.deepEqual(values(check, "--network"), ["none"]);
  assert.ok(check.includes("--read-only"));
  assert.deepEqual(values(check, "--cap-drop"), ["ALL"]);
  assert.deepEqual(values(check, "--security-opt"), ["no-new-privileges"]);
  const removed = calls.findLastIndex((call) => call.join(" ") === `docker rm -f ${CHECK}`);
  const order = [
    at("docker", "build", "-q", "-t", IMAGE),
    at("docker", "build", "-q", "-t", PROXY_IMAGE),
    at("docker", "run", "--rm"),
    at("docker", "run", "-d", "--name", CHECK),
    at("sleep", "2"),
    at("docker", "inspect", "-f", "{{.State.Running}}", CHECK),
    removed,
    at("docker", "rm", "-f", "mini-op"),
  ];
  assert.ok(
    order.every((i, n) => i >= 0 && (n === 0 || i > order[n - 1]!)),
    calls.map((call) => call.join(" ")).join("\n"),
  );
});

// This checkout's stamp as ctl/lib/version.sh makes it: HEAD, -dirty with uncommitted changes.
async function headStamp(sb: Sandbox, dir = REPO): Promise<string> {
  const head = (await sb.run(["git", "-C", dir, "rev-parse", "HEAD"])).stdout.trim();
  const status = (await sb.run(["git", "-C", dir, "status", "--porcelain"])).stdout;
  return status ? `${head}-dirty` : head;
}

// A committed copy of what start needs from this repo, in the sandbox, plus `untracked` files.
async function checkout(sb: Sandbox, untracked: string[] = []): Promise<string> {
  const copy = path.join(sb.dir, "checkout");
  fs.mkdirSync(copy);
  for (const name of [".gitignore", "README.md", "runbooks", "skills", "mini", "ctl", "host"]) {
    fs.cpSync(path.join(REPO, name), path.join(copy, name), { recursive: true });
  }
  for (const args of [
    ["init", "-q"],
    ["add", "-A"],
    ["commit", "-q", "-m", "c"],
  ]) {
    assert.equal((await sb.run([...GIT, "-C", copy, ...args])).code, 0);
  }
  for (const file of untracked) fs.writeFileSync(path.join(copy, file), "x\n");
  return copy;
}

test("a checkout's commit is the stamp; untracked files the image does not take only dirty it", async (t) => {
  for (const untracked of [[], ["notes.txt"]]) {
    const sb = await Sandbox.create(t);
    const copy = await checkout(sb, untracked);
    const { r } = await start(t, [], [], path.join(copy, "host/start"), sb);
    assert.equal(r.code, 0, r.stderr);
    const head = (await sb.run(["git", "-C", copy, "rev-parse", "HEAD"])).stdout.trim();
    const stamp = untracked.length ? `${head}-dirty` : head;
    const build = sb.calls("docker").find(({ argv }) => argv[0] === "build")?.argv ?? [];
    assert.deepEqual(values(build, "-f", "--build-arg"), [
      path.join(copy, "host/Dockerfile"),
      `MINI_OP_VERSION=${stamp}`,
    ]);
    assert.equal(build.at(-1), copy);
    assert.ok(r.stdout.startsWith(`mini-op running from ${IMAGE} (${stamp}) on `), r.stdout);
  }
});

test("untracked files the image would take exit 1, naming them, before any docker call", async (t) => {
  const sb = await Sandbox.create(t);
  const copy = await checkout(sb, ["runbooks/x.md"]);
  // CI's shipped dirs are read-only, and the copy keeps their modes.
  fs.chmodSync(path.join(copy, "skills"), 0o755);
  fs.mkdirSync(path.join(copy, "skills/new"));
  fs.writeFileSync(path.join(copy, "skills/new/SKILL.md"), "x\n");
  const { r } = await start(t, [], [], path.join(copy, "host/start"), sb);
  assert.equal(r.code, 1);
  assert.equal(
    r.stderr,
    "start: untracked or ignored files would be built into the image:" +
      " runbooks/x.md" +
      " skills/new/SKILL.md; commit or remove them\n",
  );
  assert.equal(r.stdout, "");
  assert.deepEqual(sb.calls("docker"), []);
});

// Writes `file` in the checkout copy; CI's shipped dirs are read-only, and the copy keeps their modes.
function put(copy: string, file: string): void {
  fs.chmodSync(path.join(copy, file.split("/")[0]!), 0o755);
  fs.mkdirSync(path.dirname(path.join(copy, file)), { recursive: true });
  fs.writeFileSync(path.join(copy, file), "x\n");
}

test("ignored files the image would take exit 1, naming them, before any docker call", async (t) => {
  const sb = await Sandbox.create(t);
  const copy = await checkout(sb);
  fs.appendFileSync(path.join(copy, ".git/info/exclude"), ".DS_Store\n");
  put(copy, "mini/.DS_Store");
  const { r } = await start(t, [], [], path.join(copy, "host/start"), sb);
  assert.equal(r.code, 1);
  assert.equal(
    r.stderr,
    "start: untracked or ignored files would be built into the image: mini/.DS_Store; commit or" +
      " remove them\n",
  );
  assert.equal(r.stdout, "");
  assert.deepEqual(sb.calls("docker"), []);
});

// A path for each exclusion line of host/Dockerfile.dockerignore: the build never takes it.
const EXCLUDED: Record<string, string> = {
  "mini/VERSION": "mini/VERSION",
  "**/node_modules": "ctl/node_modules/x",
  "**/.tools": "skills/.tools/x",
};

test("each exclusion of host/Dockerfile.dockerignore after its allowlist has a case here", () => {
  const lines = fs
    .readFileSync(path.join(REPO, "host/Dockerfile.dockerignore"), "utf8")
    .split("\n")
    .filter((line) => line && !line.startsWith("#"));
  const excluded = lines.slice(lines.findLastIndex((line) => line.startsWith("!")) + 1);
  assert.deepEqual(excluded, Object.keys(EXCLUDED));
  for (const [line, file] of Object.entries(EXCLUDED)) {
    const name = line.replace(/^\*\*\//, "");
    assert.ok(line === name ? file === name : file.split("/").includes(name), line);
  }
});

test("ignored files host/Dockerfile.dockerignore leaves out do not stop the build", async (t) => {
  const sb = await Sandbox.create(t);
  const copy = await checkout(sb);
  for (const file of Object.values(EXCLUDED)) put(copy, file);
  const status = await sb.run([
    ...["git", "-C", copy, "status", "--porcelain", "--untracked-files=all", "--ignored"],
  ]);
  assert.deepEqual(
    status.stdout.split("\n").filter(Boolean).sort(),
    Object.values(EXCLUDED)
      .map((file) => `!! ${file}`)
      .sort(),
  );
  const { r } = await start(t, [], [], path.join(copy, "host/start"), sb);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, "");
});

test("outside a git checkout it exits 1 before any docker call", async (t) => {
  const sb = await Sandbox.create(t);
  const copy = path.join(sb.dir, "plain");
  for (const file of ["host/start", "host/config", "host/config.yaml", "ctl/lib/version.sh"]) {
    fs.mkdirSync(path.dirname(path.join(copy, file)), { recursive: true });
    fs.copyFileSync(path.join(REPO, file), path.join(copy, file));
  }
  const { r } = await start(t, [], [], path.join(copy, "host/start"), sb);
  assert.equal(r.code, 1);
  assert.equal(
    r.stderr,
    `start: ${copy} is not a git checkout; cannot stamp the runtime version\n`,
  );
  assert.deepEqual(sb.calls("docker"), []);
});

test("a config failure exits 1 before any docker call", async (t) => {
  const sb = await Sandbox.create(t);
  fs.rmSync(path.join(sb.home, ".mini-op/config.local.yaml"));
  sb.fake("docker", docker());
  const r = await sb.run(["bash", START]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^config: no .*config\.local\.yaml; create it/);
  assert.ok(r.stderr.endsWith("start: host/config failed; nothing built or changed\n"), r.stderr);
  assert.deepEqual(sb.calls("docker"), []);
});

test("a network that is not internal exits 1 before any build", async (t) => {
  const { r, steps } = await start(t, [{ argv: ["network", "inspect"], stdout: "false\n" }]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^start: network mini-op-net exists but is not internal;/);
  assert.deepEqual(steps, ["network inspect"]);
});

test("a proxy image that exits at once: the prefixed line first, then its log", async (t) => {
  const { r, steps } = await start(t, [
    { argv: ["inspect", "-f", "{{.State.Running}}", CHECK], stdout: "false\n" },
    { argv: ["logs"], stderr: "Could not load config: permission denied\n" },
  ]);
  assert.equal(r.code, 1);
  assert.equal(
    r.stderr,
    `start: ${PROXY_IMAGE} exited in ${CHECK}; existing containers left as they were; its log:\n` +
      "Could not load config: permission denied\n",
  );
  assert.equal(steps.at(-1), "rm -f mini-op-proxy-check");
  assert.deepEqual(touches(steps), []);
});

test("a docker step failing after the checks exits 1 with a prefixed line", async (t) => {
  const { r, steps } = await start(t, [{ argv: ["network", "connect"], exit: 125 }]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^start: failed \(exit 125\): docker network connect /);
  assert.ok(!r.stdout.includes("running"), r.stdout);
  assert.equal(steps.at(-1), "network connect");
});

test("-h prints the usage to stdout and runs nothing", async (t) => {
  const { sb, r } = await start(t, [], ["-h"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^start /);
  assert.match(r.stdout, /host key[^.]*~\/\.ssh\/known_hosts/);
  assert.equal(r.stderr, "");
  assert.deepEqual(sb.calls(), []);
});

test("any argument is a usage error and runs nothing", async (t) => {
  for (const arg of ["now", "--bogus"]) {
    const { sb, r } = await start(t, [], [arg]);
    assert.equal(r.code, 2);
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, "start: usage: start\n");
    assert.deepEqual(sb.calls(), []);
  }
});
