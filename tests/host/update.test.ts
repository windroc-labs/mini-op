import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox, type FakeRule } from "../lib/sandbox.ts";

const UPDATE = path.join(REPO, "host/update");
const RUNBOOK = path.join(REPO, "ctl/runbook");
const GIT = ["git", "-c", "user.name=t", "-c", "user.email=t@example.com"];
const ID = "c0ffee";
const PS = [
  ...["ps", "-q", "--no-trunc", "--filter", "label=windroc.lock=mini-op"],
  ...["--filter", "label=windroc.lock.owner=mini-op"],
];
// The container side runs here, with the sandbox's sh, as `docker exec -i <id> sh -c …` would.
const CONTAINER = 'shift 3; exec "$@"';
const BOOK = "---\nwhen: install it\n---\n\n# Install\n";

type T = Parameters<typeof Sandbox.create>[0];
type Setup = { ids?: string; mounts?: string; exec?: FakeRule };

const workspace = (sb: Sandbox) => path.join(sb.home, ".mini-op/workspace");
const snapshotDir = (sb: Sandbox, project = "ensemble") =>
  path.join(workspace(sb), "projects", project);

async function git(sb: Sandbox, dir: string, ...args: string[]): Promise<void> {
  const r = await sb.run([...GIT, "-C", dir, ...args]);
  assert.equal(r.code, 0, r.stderr);
}

// A checkout whose origin is `url`, with `files` (path to text; a mode 0755 for names ending -test)
// under .mini-op/runbooks/.
async function checkout(
  sb: Sandbox,
  files: Record<string, string>,
  url = "https://u:t@github.com/o/ensemble.git",
  dir = path.join(sb.dir, "co"),
): Promise<string> {
  fs.mkdirSync(dir, { recursive: true });
  await git(sb, dir, "init", "-q");
  await git(sb, dir, "remote", "add", "origin", url);
  writeRunbooks(dir, files);
  return dir;
}

function writeRunbooks(dir: string, files: Record<string, string>): void {
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(dir, ".mini-op/runbooks", name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, { mode: name.endsWith("-test") ? 0o755 : 0o644 });
  }
}

function docker(sb: Sandbox, setup: Setup = {}): void {
  sb.fake("docker", [
    { argv: PS, stdout: setup.ids ?? `${ID}\n` },
    { argv: ["inspect"], stdout: setup.mounts ?? `bind /x\nvolume ${workspace(sb)}\n` },
    setup.exec ?? { argv: ["exec", "-i", ID, "sh", "-c"], shell: CONTAINER },
  ]);
}

async function sandbox(t: T, setup: Setup = {}): Promise<Sandbox> {
  const sb = await Sandbox.create(t);
  docker(sb, setup);
  return sb;
}

const update = (sb: Sandbox, ...args: string[]) => sb.run(["bash", UPDATE, ...args]);

// Every file under dir, relative, to its text.
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (sub: string) => {
    for (const entry of fs.readdirSync(path.join(dir, sub), { withFileTypes: true })) {
      const rel = path.join(sub, entry.name);
      if (entry.isDirectory()) walk(rel);
      else out[rel] = fs.readFileSync(path.join(dir, rel), "utf8");
    }
  };
  walk("");
  return out;
}

function writable(dir: string): string[] {
  const found: string[] = [];
  const walk = (p: string) => {
    if (fs.statSync(p).mode & 0o222) found.push(p);
    if (fs.statSync(p).isDirectory()) for (const e of fs.readdirSync(p)) walk(path.join(p, e));
  };
  walk(dir);
  return found;
}

const FILES = {
  "install.md": BOOK,
  "install/install-test": "#!/bin/zsh\necho installed\n",
  "install/strata.conf": "model = x\n",
};

test("a checkout's runbooks become a read-only snapshot with its remote id", async (t) => {
  const sb = await sandbox(t);
  const co = await checkout(sb, FILES);
  const r = await update(sb, path.join(co, ".mini-op"));
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, `update: ensemble snapshot in mini-op at ${snapshotDir(sb)}\n`);
  assert.equal(r.stderr, "");
  const runbooks = path.join(snapshotDir(sb), ".mini-op/runbooks");
  assert.deepEqual(tree(runbooks), FILES);
  assert.ok(fs.statSync(path.join(runbooks, "install/install-test")).mode & 0o100);
  assert.deepEqual(writable(path.join(snapshotDir(sb), ".mini-op")), []);
  assert.equal(
    fs.readFileSync(path.join(snapshotDir(sb), "remote"), "utf8"),
    "github.com/o/ensemble\n",
  );
  assert.deepEqual(fs.readdirSync(path.join(workspace(sb), "projects")), ["ensemble"]);
  // A copy, not a mount: the checkout's path and the URL's credentials never reach docker.
  const calls = sb.calls("docker");
  assert.deepEqual(calls[0]?.argv, PS);
  assert.deepEqual(calls[1]?.argv.slice(-1), [ID]);
  for (const call of calls) {
    for (const arg of call.argv) assert.ok(!arg.includes(co) && !arg.includes("u:t@"), arg);
  }
});

test("handing over again replaces the snapshot", async (t) => {
  const sb = await sandbox(t);
  const co = await checkout(sb, FILES);
  assert.equal((await update(sb, co)).code, 0);
  fs.rmSync(path.join(co, ".mini-op/runbooks/install/strata.conf"));
  writeRunbooks(co, { "install/install-test": "#!/bin/zsh\necho v2\n", "clean.md": BOOK });
  const r = await update(sb, co);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(tree(path.join(snapshotDir(sb), ".mini-op/runbooks")), {
    "clean.md": BOOK,
    "install.md": BOOK,
    "install/install-test": "#!/bin/zsh\necho v2\n",
  });
  assert.deepEqual(fs.readdirSync(path.join(workspace(sb), "projects")), ["ensemble"]);
});

test("a snapshot of the same name from another remote is refused and kept", async (t) => {
  const sb = await sandbox(t);
  const co = await checkout(sb, FILES);
  assert.equal((await update(sb, co)).code, 0);
  const before = tree(snapshotDir(sb));
  await git(sb, co, "remote", "set-url", "origin", "git@example.com:fork/ensemble.git");
  let r = await update(sb, co);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(
    r.stderr,
    `update: ${snapshotDir(sb)} holds a snapshot of github.com/o/ensemble, not example.com/fork/ensemble; nothing copied\n`,
  );
  assert.deepEqual(tree(snapshotDir(sb)), before);
  // A dir of that name without a recorded remote is not this checkout's either.
  fs.chmodSync(snapshotDir(sb), 0o755);
  fs.rmSync(path.join(snapshotDir(sb), "remote"));
  r = await update(sb, co);
  assert.equal(r.code, 1);
  assert.match(
    r.stderr,
    /holds a snapshot of an unknown remote, not example\.com\/fork\/ensemble;/,
  );
});

test("no direct-use container, only a verifier's, or two: refused, nothing written", async (t) => {
  const none =
    "update: no direct-use mini-op container (labels windroc.lock=mini-op, windroc.lock.owner=mini-op); start ensemble's direct-use session mini-op (host/README.md, Hand over a project)\n";
  // The owner filter leaves a verifier run's container (windroc.lock=mini-op, another owner) out.
  for (const [ids, stderr] of [
    ["", none],
    ["a1\nb2\n", "update: several direct-use mini-op containers: a1 b2; nothing copied\n"],
  ] as const) {
    const sb = await sandbox(t, { ids });
    const r = await update(sb, await checkout(sb, FILES));
    assert.equal(r.code, 1);
    assert.equal(r.stderr, stderr);
    assert.deepEqual(
      sb.calls("docker").map((call) => call.argv),
      [PS],
    );
    assert.ok(!fs.existsSync(workspace(sb)));
  }
  const sb = await Sandbox.create(t);
  sb.fake("docker", [{ argv: ["ps"], stderr: "Cannot connect\n", exit: 1 }]);
  const r = await update(sb, await checkout(sb, FILES));
  assert.equal(r.code, 1);
  assert.match(r.stderr, /update: cannot list containers; is Docker running\?\n$/);
});

test("a container without the workspace volume is refused", async (t) => {
  const sb = await Sandbox.create(t);
  docker(sb, { mounts: `bind ${workspace(sb)}\nvolume /elsewhere\n` });
  const r = await update(sb, await checkout(sb, FILES));
  assert.equal(r.code, 1);
  assert.equal(
    r.stderr,
    `update: container ${ID} has no workspace volume at ${workspace(sb)}; nothing copied\n`,
  );
  assert.equal(sb.calls("docker").length, 2);
  const failing = await Sandbox.create(t);
  failing.fake("docker", [
    { argv: PS, stdout: `${ID}\n` },
    { argv: ["inspect"], exit: 1 },
  ]);
  const r2 = await update(failing, await checkout(failing, FILES));
  assert.equal(r2.code, 1);
  assert.equal(r2.stderr, `update: cannot inspect container ${ID}; nothing copied\n`);
});

test("symlinks, FIFOs, sockets and hard links are refused before docker", async (t) => {
  const sb = await sandbox(t);
  const co = await checkout(sb, FILES);
  const rb = path.join(co, ".mini-op/runbooks");
  const key = path.join(sb.home, ".ssh/id_ed25519");
  fs.mkdirSync(path.dirname(key), { recursive: true });
  fs.writeFileSync(key, "not a key\n");
  fs.symlinkSync(key, path.join(rb, "install/key"));
  fs.symlinkSync(path.dirname(key), path.join(rb, "dotssh"));
  const fifo = await sb.run([
    "perl",
    "-MPOSIX",
    "-e",
    "mkfifo($ARGV[0], 0644) or die",
    path.join(rb, "pipe"),
  ]);
  assert.equal(fifo.code, 0, fifo.stderr);
  fs.linkSync(key, path.join(rb, "install/hard"));
  const sock = await sb.run([
    ...["perl", "-MIO::Socket::UNIX", "-e"],
    "IO::Socket::UNIX->new(Local => $ARGV[0], Listen => 1) or die",
    path.join(rb, "sock"),
  ]);
  assert.equal(sock.code, 0, sock.stderr);
  const r = await update(sb, co);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.deepEqual(
    r.stderr.split("\n").filter(Boolean).sort(),
    [
      `update: refused ${rb}/dotssh: a symlink`,
      `update: refused ${rb}/install/hard: a hard link`,
      `update: refused ${rb}/install/key: a symlink`,
      `update: refused ${rb}/pipe: not a regular file`,
      `update: refused ${rb}/sock: not a regular file`,
      "update: nothing copied",
    ].sort(),
  );
  assert.deepEqual(sb.calls("docker"), []);
  // .mini-op or .mini-op/runbooks itself a symlink: refused, nothing read through it.
  for (const linked of [".mini-op", ".mini-op/runbooks"]) {
    const other = await Sandbox.create(t);
    docker(other);
    const dir = await checkout(other, {}, undefined, path.join(other.dir, "co"));
    const outside = path.join(other.dir, "outside", ".mini-op/runbooks");
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, "install.md"), BOOK);
    fs.mkdirSync(path.join(dir, ".mini-op"), { recursive: true });
    fs.rmSync(path.join(dir, linked), { recursive: true, force: true });
    fs.symlinkSync(linked === ".mini-op" ? path.dirname(outside) : outside, path.join(dir, linked));
    const r = await update(other, dir);
    assert.equal(r.code, 1, linked);
    assert.equal(
      r.stderr,
      `update: refused ${path.join(dir, linked)}: a symlink\nupdate: nothing copied\n`,
    );
    assert.deepEqual(other.calls("docker"), []);
  }
});

test("a file name with an escape is printed quoted", async (t) => {
  const sb = await sandbox(t);
  const co = await checkout(sb, FILES);
  const rb = path.join(co, ".mini-op/runbooks");
  fs.symlinkSync("/etc/passwd", path.join(rb, "a\x1b[2Jb"));
  const r = await update(sb, co);
  assert.equal(r.code, 1);
  assert.ok(!r.stderr.includes("\x1b"), JSON.stringify(r.stderr));
  assert.match(r.stderr, /^update: refused \$'(\\[0-7]{3})+': a symlink\n/);
  assert.ok(r.stderr.includes("\\033\\133\\062\\112"));
});

test("not a checkout, no runbooks dir or no plain project name exits 1 before docker", async (t) => {
  const sb = await sandbox(t);
  const plain = path.join(sb.dir, "plain");
  fs.mkdirSync(plain);
  let r = await update(sb, plain);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, `update: ${plain} is not a git checkout\n`);
  r = await update(sb, path.join(sb.dir, "missing"));
  assert.equal(r.stderr, `update: ${sb.dir}/missing is not a git checkout\n`);
  const bare = await checkout(sb, {}, "https://github.com/o/ensemble", path.join(sb.dir, "bare"));
  r = await update(sb, bare);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, `update: ${bare} has no .mini-op/runbooks/\n`);
  fs.mkdirSync(path.join(bare, ".mini-op/runbooks"), { recursive: true });
  for (const url of ["https://github.com/o/.hidden", "https://github.com/o/a%20b"]) {
    await git(sb, bare, "remote", "set-url", "origin", url);
    r = await update(sb, bare);
    assert.equal(r.code, 1, url);
    assert.equal(r.stderr, `update: cannot name the project from ${bare}'s origin remote\n`);
  }
  await git(sb, bare, "remote", "remove", "origin");
  r = await update(sb, bare);
  assert.equal(r.stderr, `update: cannot name the project from ${bare}'s origin remote\n`);
  assert.deepEqual(sb.calls("docker"), []);
});

test("an unreadable file or dir: nothing copied", async (t) => {
  const sb = await sandbox(t);
  const co = await checkout(sb, FILES);
  const rb = path.join(co, ".mini-op/runbooks");
  const file = path.join(rb, "install/strata.conf");
  const dir = path.join(rb, "install");
  try {
    fs.chmodSync(file, 0);
    let r = await update(sb, co);
    assert.equal(r.code, 1);
    assert.match(r.stderr, new RegExp(`update: cannot pack ${rb}; nothing copied\n$`));
    assert.ok(!sb.calls("docker").some((call) => call.argv[0] === "exec"));
    fs.chmodSync(file, 0o644);
    fs.chmodSync(dir, 0);
    r = await update(sb, co);
    assert.equal(r.code, 1);
    assert.match(r.stderr, new RegExp(`update: cannot read ${rb}\n$`));
  } finally {
    fs.chmodSync(dir, 0o755);
    fs.chmodSync(file, 0o644);
  }
});

test("the container's re-check refuses a special file it extracted", async (t) => {
  // The tree changed after the check: the container receives a symlink in the archive.
  const tamper = `shift 3; d=$(mktemp -d); tar -xf - -C "$d"; ln -s /etc/passwd "$d/.mini-op/runbooks/evil"
tar -cf - -C "$d" .mini-op | "$@"`;
  const sb = await sandbox(t);
  const co = await checkout(sb, FILES);
  assert.equal((await update(sb, co)).code, 0);
  const before = tree(snapshotDir(sb));
  docker(sb, { exec: { argv: ["exec", "-i", ID], shell: tamper } });
  writeRunbooks(co, { "install/install-test": "#!/bin/zsh\necho v2\n" });
  const r = await update(sb, co);
  assert.equal(r.code, 1);
  assert.equal(
    r.stderr,
    `update: the container found ${workspace(sb)}/projects/.ensemble.new/.mini-op/runbooks/evil not a regular file; nothing copied\n`,
  );
  assert.deepEqual(tree(snapshotDir(sb)), before);
  assert.deepEqual(fs.readdirSync(path.join(workspace(sb), "projects")), ["ensemble"]);
});

test("a failed copy into the container is reported", async (t) => {
  const sb = await sandbox(t, {
    exec: { argv: ["exec"], stderr: "Error: No such container\n", exit: 1 },
  });
  const r = await update(sb, await checkout(sb, FILES));
  assert.equal(r.code, 1);
  assert.match(
    r.stderr,
    new RegExp(
      `update: copying into container ${ID} failed; the snapshot is unchanged or partly updated\n$`,
    ),
  );
});

test("usage errors exit 2; -h exits 0", async (t) => {
  const sb = await sandbox(t);
  for (const args of [[], ["a", "b"], ["-x"], ["--help", "x"]]) {
    const r = await update(sb, ...args);
    assert.equal(r.code, 2, args.join(" "));
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, "update: usage: update <checkout>\n");
  }
  for (const flag of ["-h", "--help"]) {
    const r = await update(sb, flag);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /^update <checkout> /);
    assert.match(r.stdout, /symlink, FIFO, socket, device or hard link/);
  }
  assert.deepEqual(sb.calls("docker"), []);
});

test("host/update and ctl/runbook name a project alike", async (t) => {
  const cases = [
    ["git@github.com:o/ensemble.git/", "ensemble", "github.com/o/ensemble"],
    ["https://u:t@github.com/o/ensemble", "ensemble", "github.com/o/ensemble"],
    ["ssh://git@example.com:22/o/ens.repo.git", "ens.repo", "example.com:22/o/ens.repo"],
    ["/srv/git/proj//", "proj", "/srv/git/proj"],
  ] as const;
  for (const [url, name, remote] of cases) {
    const sb = await sandbox(t);
    const co = await checkout(sb, { "install.md": BOOK }, url);
    const r = await update(sb, co);
    assert.equal(r.code, 0, `${url}: ${r.stderr}`);
    assert.equal(
      fs.readFileSync(path.join(snapshotDir(sb, name), "remote"), "utf8"),
      `${remote}\n`,
    );
    const list = await sb.run(["zsh", RUNBOOK, "list", "--workspace", co]);
    assert.equal(list.code, 0, list.stderr);
    assert.ok(list.stdout.startsWith(`project:${name}\t`), `${url}: ${list.stdout}`);
  }
});
