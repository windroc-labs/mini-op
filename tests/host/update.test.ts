import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { PROXY_LABEL, PROXY_POLICY } from "../lib/image.ts";
import { REPO, Sandbox } from "../lib/sandbox.ts";

const UPDATE = path.join(REPO, "host/update");
const EXTRACT = ["exec", "-i", "mini-op", "tar", "-xf", "-", "-C", "/opt/mini-op"];
// The running container's ssh config, written as root from the generated ssh_config on stdin.
const SSH_CONFIG = "/etc/ssh/ssh_config.d/mini.conf";
const INSTALL = ["exec", "-i", "-u", "0", "mini-op", "sh", "-c", `cat > ${SSH_CONFIG}`];
const POLICY = PROXY_POLICY.argv ?? [];
const DOCKER = [PROXY_POLICY, { argv: EXTRACT }, { argv: INSTALL }];
const extracts = (sb: Sandbox) => sb.calls("docker").filter((call) => call.argv[2] === "mini-op");

// Runs host/update against fake docker and lists what each tar stream would put in /opt/mini-op.
async function payload(t: Parameters<typeof Sandbox.create>[0]): Promise<string[][]> {
  const sb = await Sandbox.create(t);
  sb.fake("docker", DOCKER);
  const r = await sb.run(["bash", UPDATE]);
  assert.equal(r.code, 0, r.stderr);
  const lists: string[][] = [];
  for (const [i, call] of extracts(sb).entries()) {
    const file = path.join(sb.dir, `payload-${i}.tar`);
    fs.writeFileSync(file, Buffer.from(call.stdin, "utf8"));
    const listed = await sb.run(["tar", "-tf", file]);
    lists.push(listed.stdout.split("\n").filter((name) => name && !name.endsWith("/")));
  }
  return lists;
}

test("the container gets the docs, runbooks, ctl/ and mini/, and CLAUDE.md at its root", async (t) => {
  const lists = await payload(t);
  assert.equal(lists.length, 2);
  const all = lists.flat();
  for (const name of [
    "README.md",
    "status.md",
    "runbooks/test-board.toml",
    "runbooks/setup-test-env.md",
    "ctl/mini",
    "ctl/lib/secrets.zsh",
    "mini/bin/ans",
    "mini/js/keys.js",
    "mini/runbooks/setup-test-env/linearlogin",
  ]) {
    assert.ok(all.includes(name), name);
  }
  assert.deepEqual(lists[1], ["CLAUDE.md"]);
});

test("nothing from host/, the rest of the repo or the deleted files reaches the container", async (t) => {
  const lists = await payload(t);
  const top = new Set(lists[0]?.map((name) => name.split("/")[0]));
  assert.deepEqual([...top].sort(), ["README.md", "ctl", "mini", "runbooks", "status.md"]);
  const all = lists.flat();
  const stray = all.filter(
    (name) =>
      name.startsWith("host/") ||
      name === "ctl/CLAUDE.md" ||
      /(^|\/)(findings-812\.md|layout|tw)$/.test(name),
  );
  assert.deepEqual(stray, []);
});

test("only ctl/ is on the container's PATH; mini/ stays off it", () => {
  const dockerfile = fs.readFileSync(path.join(REPO, "host/Dockerfile"), "utf8");
  const entries = /^\s*PATH=(\S+)/m.exec(dockerfile)?.[1]?.split(":") ?? [];
  assert.equal(entries[0], "/opt/mini-op/ctl");
  assert.deepEqual(
    entries.filter((dir) => dir.startsWith("/opt/mini-op")),
    ["/opt/mini-op/ctl"],
  );
});

// Extracts the tar streams of extract calls `from` on into `dest`, in order, as the container would.
async function extract(sb: Sandbox, dest: string, from = 0): Promise<void> {
  for (const [i, call] of extracts(sb).entries()) {
    if (i < from) continue;
    const file = path.join(sb.dir, `payload-${i}.tar`);
    fs.writeFileSync(file, Buffer.from(call.stdin, "utf8"));
    const x = await sb.run(["tar", "-xf", file, "-C", dest]);
    assert.equal(x.code, 0, x.stderr);
  }
}

// A git checkout of `names` from this repo in the sandbox, for update to run from.
async function checkout(sb: Sandbox, names: string[]): Promise<string> {
  const copy = path.join(sb.dir, "checkout");
  fs.mkdirSync(copy);
  for (const name of names) {
    fs.cpSync(path.join(REPO, name), path.join(copy, name), { recursive: true });
  }
  const git = ["git", "-c", "user.name=t", "-c", "user.email=t@example.com", "-C", copy];
  for (const args of [
    ["init", "-q"],
    ["add", "-A"],
    ["commit", "-q", "-m", "c"],
  ]) {
    assert.equal((await sb.run([...git, ...args])).code, 0);
  }
  return copy;
}

// Gives the owner write access to every file and dir under `dir`, as a working checkout has.
// Skips .git: git's background maintenance adds and removes lock files there mid-walk.
function writable(dir: string): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    fs.chmodSync(full, fs.statSync(full).mode | 0o200);
    if (entry.isDirectory()) writable(full);
  }
}

test("the payload refreshes /opt/mini-op in place: repo files and modes, local files kept", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("docker", DOCKER);
  // update runs from the user's writable checkout. CI's read-only shipped dirs would ride the
  // payload into dest as r-x dirs, and the second extraction could not replace their files.
  const copy = await checkout(sb, [
    ".gitignore",
    "README.md",
    "status.md",
    "runbooks",
    "mini",
    "ctl",
    "host",
  ]);
  writable(copy);
  const dest = path.join(sb.dir, "opt-mini-op");
  fs.mkdirSync(path.join(dest, "ctl"), { recursive: true });
  fs.writeFileSync(path.join(dest, "keep.txt"), "local file\n");
  fs.writeFileSync(path.join(dest, "ctl/mini"), "stale copy\n");
  for (const run of [0, 1]) {
    const r = await sb.run(["bash", path.join(copy, "host/update")]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^mini-op files updated/);
    await extract(sb, dest, run * 2);
  }
  assert.deepEqual(
    sb.calls("docker").map(({ argv }) => argv),
    [POLICY, EXTRACT, EXTRACT, INSTALL, POLICY, EXTRACT, EXTRACT, INSTALL],
  );
  const read = (file: string) => fs.readFileSync(file, "utf8");
  const helpers = ["ctl/mini", "ctl/mini-autologin", "mini/bin/ans", "mini/bin/termwait"];
  const docs = ["README.md", "status.md", "runbooks/test-board.toml", "runbooks/setup-test-env.md"];
  for (const name of [...docs, ...helpers]) {
    assert.equal(read(path.join(dest, name)), read(path.join(REPO, name)), name);
  }
  for (const name of helpers) {
    assert.equal(fs.statSync(path.join(dest, name)).mode & 0o111, 0o111, name);
  }
  assert.equal(read(path.join(dest, "CLAUDE.md")), read(path.join(REPO, "ctl/CLAUDE.md")));
  assert.equal(read(path.join(dest, "keep.txt")), "local file\n");
});

test("a payload file missing from the checkout exits 1 without claiming success", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("docker", DOCKER);
  const copy = await checkout(sb, [".gitignore", "README.md", "runbooks", "mini", "ctl", "host"]);
  const r = await sb.run(["bash", path.join(copy, "host/update")]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /status\.md/);
  assert.ok(r.stderr.endsWith("update: copying into mini-op failed\n"), r.stderr);
  assert.ok(!r.stdout.includes("updated"), r.stdout);
});

test("the payload stamps mini/VERSION with the checkout's commit", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("docker", DOCKER);
  const r = await sb.run(["bash", UPDATE]);
  assert.equal(r.code, 0, r.stderr);
  const dest = path.join(sb.dir, "opt-mini-op");
  fs.mkdirSync(dest);
  const file = path.join(sb.dir, "payload.tar");
  fs.writeFileSync(file, Buffer.from(extracts(sb)[0]?.stdin ?? "", "utf8"));
  assert.equal((await sb.run(["tar", "-xf", file, "-C", dest])).code, 0);
  const head = await sb.run(["git", "-C", REPO, "rev-parse", "HEAD"]);
  const version = fs.readFileSync(path.join(dest, "mini/VERSION"), "utf8");
  assert.match(version, new RegExp(`^${head.stdout.trim()}(-dirty)?\n$`));
});

// Makes every file and dir under `dir` read-only, as CI does to the shipped dirs.
function readOnly(dir: string): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) readOnly(full);
    fs.chmodSync(full, fs.statSync(full).mode & ~0o222);
  }
  fs.chmodSync(dir, fs.statSync(dir).mode & ~0o222);
}

test("a stale mini/VERSION in a read-only checkout never overrides the stamp", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("docker", DOCKER);
  const copy = await checkout(sb, [
    ".gitignore",
    "README.md",
    "status.md",
    "runbooks",
    "mini",
    "ctl",
    "host",
  ]);
  // The copy keeps CI's read-only modes: open mini/ for the stale file, then lock it all again.
  fs.chmodSync(path.join(copy, "mini"), 0o755);
  fs.writeFileSync(path.join(copy, "mini/VERSION"), "stale\n");
  for (const dir of ["ctl", "host", "mini"]) readOnly(path.join(copy, dir));
  const r = await sb.run(["bash", path.join(copy, "host/update")]);
  assert.equal(r.code, 0, r.stderr);
  const head = (await sb.run(["git", "-C", copy, "rev-parse", "HEAD"])).stdout.trim();
  const file = path.join(sb.dir, "payload.tar");
  fs.writeFileSync(file, Buffer.from(extracts(sb)[0]?.stdin ?? "", "utf8"));
  const listed = (await sb.run(["tar", "-tf", file])).stdout.split("\n");
  assert.deepEqual(
    listed.filter((name) => name.endsWith("/VERSION")),
    ["mini/VERSION"],
  );
  const dest = path.join(sb.dir, "opt-mini-op");
  fs.mkdirSync(dest);
  assert.equal((await sb.run(["tar", "-xf", file, "-C", dest])).code, 0);
  assert.equal(fs.readFileSync(path.join(dest, "mini/VERSION"), "utf8"), `${head}\n`);
});

test("outside a git checkout it exits 1 before copying anything", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("docker", DOCKER);
  const copy = path.join(sb.dir, "plain");
  for (const file of ["host/update", "ctl/lib/version.sh"]) {
    fs.mkdirSync(path.dirname(path.join(copy, file)), { recursive: true });
    fs.copyFileSync(path.join(REPO, file), path.join(copy, file));
  }
  const r = await sb.run(["bash", path.join(copy, "host/update")]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, `update: ${copy} is not a git checkout; cannot stamp mini/VERSION\n`);
  assert.deepEqual(sb.calls("docker"), []);
});

test("a config failure exits 1 before any docker call", async (t) => {
  const sb = await Sandbox.create(t);
  fs.writeFileSync(path.join(sb.home, ".mini-op/config.local.yaml"), "mini_user: tester\n");
  sb.fake("docker", DOCKER);
  const r = await sb.run(["bash", UPDATE]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^config: mini_host is empty; set it in /);
  assert.ok(r.stderr.endsWith("update: host/config failed; nothing copied\n"), r.stderr);
  assert.deepEqual(sb.calls("docker"), []);
});

test("a proxy whose policy label differs, has none, or is missing exits 1 before any copy", async (t) => {
  const stale: [string, { stdout?: string; exit?: number }][] = [
    ["another policy", { stdout: `${"0".repeat(64)}\n` }],
    ["no label", { stdout: "\n" }],
    ["no proxy container", { exit: 1 }],
  ];
  const message = (name: string) =>
    name === "no proxy container"
      ? "update: no mini-op-proxy container; run host/start\n"
      : "update: the proxy's policy differs from the config (mini_host, mini_port or proxy_* " +
        "changed); run host/start\n";
  for (const [name, answer] of stale) {
    const sb = await Sandbox.create(t);
    sb.fake("docker", [{ argv: POLICY, ...answer }, { argv: EXTRACT }, { argv: INSTALL }]);
    const r = await sb.run(["bash", UPDATE]);
    assert.equal(r.code, 1, name);
    assert.equal(r.stderr, message(name), name);
    assert.deepEqual(
      sb.calls("docker").map(({ argv }) => argv),
      [POLICY],
      name,
    );
  }
});

test("a matching policy label goes on to copy", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("docker", DOCKER);
  const r = await sb.run(["bash", UPDATE]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(sb.calls("docker")[0]?.argv.slice(0, 3).join(" "), PROXY_LABEL.join(" "));
  assert.equal(extracts(sb).length, 2);
});

test("a failed copy exits 1 without claiming success", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("docker", [PROXY_POLICY, { argv: EXTRACT, exit: 42 }, { argv: INSTALL }]);
  const r = await sb.run(["bash", UPDATE]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "update: copying into mini-op failed\n");
  assert.ok(!r.stdout.includes("updated"));
});

test("the running container gets the generated ssh_config as its ssh config, written as root", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("docker", DOCKER);
  const r = await sb.run(["bash", UPDATE]);
  assert.equal(r.code, 0, r.stderr);
  const installs = sb.calls("docker").filter((call) => call.argv.includes("-u"));
  assert.deepEqual(
    installs.map((call) => call.argv),
    [INSTALL],
  );
  const generated = fs.readFileSync(path.join(sb.home, ".mini-op/ssh_config"), "utf8");
  assert.match(generated, /^Host mini$/m);
  assert.equal(installs[0]?.stdin, generated);
  assert.match(r.stdout, /ssh config/);
});

test("a failed ssh config write exits 1 without claiming success", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("docker", [PROXY_POLICY, { argv: EXTRACT }, { argv: INSTALL, exit: 1 }]);
  const r = await sb.run(["bash", UPDATE]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "update: copying into mini-op failed\n");
  assert.ok(!r.stdout.includes("updated"));
});

test("any argument is a usage error and copies nothing", async (t) => {
  for (const arg of ["now", "--bogus"]) {
    const sb = await Sandbox.create(t);
    sb.fake("docker", DOCKER);
    const r = await sb.run(["bash", UPDATE, arg]);
    assert.equal(r.code, 2);
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, "update: usage: update\n");
    assert.deepEqual(sb.calls("docker"), []);
  }
});

test("-h prints the usage to stdout and copies nothing", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("docker", DOCKER);
  const r = await sb.run(["bash", UPDATE, "-h"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^update /);
  assert.equal(r.stderr, "");
  assert.deepEqual(sb.calls("docker"), []);
});
