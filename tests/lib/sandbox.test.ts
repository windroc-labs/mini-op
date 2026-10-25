import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import * as os from "node:os";
import {
  ALLOWLIST,
  FAKE_CACHE,
  FORBIDDEN,
  REPO,
  Sandbox,
  SandboxError,
  type RunOptions,
} from "./sandbox.ts";
import { FAKE_LOCAL, FAKE_SSH_CONFIG, MINI_USER } from "./ssh_config.ts";

const SECRETS = "/run/" + "secrets";

test("allowlist excludes every forbidden command", () => {
  assert.deepEqual(
    ALLOWLIST.filter((tool) => (FORBIDDEN as readonly string[]).includes(tool)),
    [],
  );
});

test("an unfaked forbidden command rejects naming it", async (t) => {
  const sb = await Sandbox.create(t);
  await assert.rejects(sb.run(["sh", "-c", "ssh mini true"]), /unfaked command called: ssh/);
});

test("forbidden commands resolve inside the sandbox and HOME/TMPDIR are in it", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("ssh");
  const r = await sb.run([
    "sh",
    "-c",
    'command -v ssh; command -v security; echo "$HOME"; echo "$TMPDIR"',
  ]);
  const lines = r.stdout.trim().split("\n");
  assert.equal(lines.length, 4);
  for (const line of lines) assert.ok(line.startsWith(sb.dir + "/"), line);
  assert.equal(lines[2], sb.home);
});

test("env holds only the sandbox variables", async (t) => {
  const sb = await Sandbox.create(t);
  const r = await sb.run(["env"]);
  const keys = r.stdout
    .trim()
    .split("\n")
    .map((line) => line.split("=")[0]);
  // PWD: real tools run behind a /bin/sh shim (FR-36), and sh exports it, as for the fakes.
  const expected = ["HOME", "LANG", "MINI_OP_SECRETS_DIR", "PATH", "PWD", "TMPDIR"];
  if (process.env.MINI_OP_TRACE) expected.push("BASH_ENV", "MINI_OP_TRACE_FILE", "ZDOTDIR");
  if (process.env.NODE_V8_COVERAGE) expected.push("NODE_V8_COVERAGE");
  assert.deepEqual(keys.sort(), expected.sort());
});

test("the override variable must be set and point inside the sandbox", async (t) => {
  const sb = await Sandbox.create(t);
  const outside = path.dirname(sb.dir);
  for (const value of [undefined, "", outside, sb.dir + "/../x"]) {
    await assert.rejects(
      sb.run(["true"], { env: { MINI_OP_SECRETS_DIR: value } }),
      (err: Error) => err instanceof SandboxError && /MINI_OP_SECRETS_DIR/.test(err.message),
    );
  }
  const r = await sb.run(["sh", "-c", 'cat "$MINI_OP_SECRETS_DIR/$1"', "sh", MINI_USER]);
  assert.equal(r.stdout, sb.canary);
  assert.equal(sb.passwordFile, path.join(sb.secrets, MINI_USER));
});

test("a secrets entry linking out of the sandbox rejects", async (t) => {
  const sb = await Sandbox.create(t);
  fs.symlinkSync(path.dirname(sb.dir), path.join(sb.secrets, "escape"));
  await assert.rejects(sb.run(["true"]), /MINI_OP_SECRETS_DIR/);
});

test("tests may not set PATH, HOME, TMPDIR or the trace variables", async (t) => {
  const sb = await Sandbox.create(t);
  for (const key of ["PATH", "HOME", "TMPDIR", "ZDOTDIR", "BASH_ENV", "MINI_OP_TRACE_FILE"]) {
    await assert.rejects(
      sb.run(["true"], { env: { [key]: sb.home } }),
      new RegExp(`may not set ${key}`),
    );
  }
});

test("a real secrets path in argv, input or env rejects", async (t) => {
  const sb = await Sandbox.create(t);
  await assert.rejects(sb.run(["cat", SECRETS + "/pass"]), /real secrets/);
  await assert.rejects(sb.run(["cat"], { input: SECRETS }), /real secrets/);
  await assert.rejects(sb.run(["true"], { env: { X: SECRETS + "/pass" } }), /real secrets/);
});

test("a stdinFile is the child's stdin, and the run reports how far it was read", async (t) => {
  const sb = await Sandbox.create(t);
  const file = path.join(sb.dir, "in");
  fs.writeFileSync(file, "one\ntwo\n");
  const r = await sb.run(["sh", "-c", 'read -r line; printf "%s" "$line"'], { stdinFile: file });
  assert.equal(r.stdout, "one");
  assert.equal(r.stdinOffset, 4);
  assert.equal((await sb.run(["true"], { stdinFile: file })).stdinOffset, 0);
  assert.equal((await sb.run(["true"])).stdinOffset, undefined);
});

test("a stdinFile outside the sandbox, naming the real secrets dir or a bypass rejects", async (t) => {
  const sb = await Sandbox.create(t);
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "mini-op-outside-"));
  t.after(() => fs.rmSync(elsewhere, { recursive: true, force: true }));
  const outside = path.join(elsewhere, "in");
  fs.writeFileSync(outside, "x\n");
  const link = path.join(sb.dir, "link");
  fs.symlinkSync(outside, link);
  for (const file of [outside, link, SECRETS + "/pass"]) {
    await assert.rejects(sb.run(["cat"], { stdinFile: file }), /stdinFile must be a file inside/);
  }
  const named = path.join(sb.dir, "run/secrets/pass");
  fs.mkdirSync(path.dirname(named), { recursive: true });
  fs.writeFileSync(named, "x\n");
  await assert.rejects(sb.run(["cat"], { stdinFile: named }), /real secrets/);
  const bypassed = await Sandbox.create(t, { repo: bypassRepo(t) });
  const script = path.join(bypassed.dir, "script");
  fs.writeFileSync(script, "exec mini/bin/p open x\n");
  await assert.rejects(bypassed.run(["sh"], { stdinFile: script }), /PATH bypass/);
  await assert.rejects(
    sb.run(["cat"], { stdinFile: path.join(sb.dir, "in"), input: "x" }),
    /input or stdinFile/,
  );
});

test("a fake logs argv, env, stdin and cwd", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("ssh", [{ stdout: "ok\n" }]);
  const r = await sb.run(["sh", "-c", 'printf "%s" pw | ssh -o BatchMode=yes mini "read x"'], {
    env: { EXTRA: "1" },
  });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "ok\n");
  const [call] = sb.calls("ssh");
  assert.ok(call);
  assert.deepEqual(call.argv, ["-o", "BatchMode=yes", "mini", "read x"]);
  assert.equal(call.stdin, "pw");
  assert.equal(call.env.EXTRA, "1");
  assert.equal(call.cwd, sb.dir);
  assert.equal(call.matched, 0);
});

test("rules match on argv prefix, in order, and a miss exits 127", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("docker", [
    { argv: ["inspect"], stdout: "true\n" },
    { argv: ["run"], stderr: "boom\n", exit: 3 },
  ]);
  const a = await sb.run(["docker", "inspect", "-f", "x"]);
  assert.equal(a.stdout, "true\n");
  const b = await sb.run(["docker", "run", "img"]);
  assert.equal(b.code, 3);
  assert.equal(b.stderr, "boom\n");
  const c = await sb.run(["docker", "ps"]);
  assert.equal(c.code, 127);
  assert.match(c.stderr, /fake docker: no rule for \["ps"\]/);
  assert.deepEqual(
    sb.calls("docker").map((call) => call.matched),
    [0, 1, null],
  );
});

test("an osascript fake matches the program file name, not its contents", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("osascript", [
    { program: "keys.js", args: ["--enter"], stdout: "typed\n" },
    { argv: ["-e"], stdout: "inline\n" },
  ]);
  for (const body of ["function run() { return 1 }", "function run() { return 'reworded' }"]) {
    const file = path.join(sb.dir, "keys.js");
    fs.writeFileSync(file, body);
    const r = await sb.run(["osascript", "-l", "JavaScript", file, "--enter"]);
    assert.equal(r.stdout, "typed\n");
  }
  const inline = await sb.run(["osascript", "-e", "keys.js"]);
  assert.equal(inline.stdout, "inline\n");
  assert.equal(sb.calls("osascript")[0]?.program, "keys.js");
});

test("a shell rule runs with the call's args, stdin and env plus FAKE_DIR", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("osascript", [
    {
      program: "keys.js",
      shell:
        'print -r -- "args=$*"; print -r -- "in=$(cat) x=$X dir=$FAKE_DIR"; print -u2 err; exit 3',
    },
  ]);
  const r = await sb.run(["osascript", "-l", "JavaScript", "/x/keys.js", "--enter", "a b"], {
    input: "typed",
    env: { X: "1" },
  });
  assert.equal(r.code, 3);
  assert.equal(r.stdout, `args=--enter a b\nin=typed x=1 dir=${sb.dir}\n`);
  assert.equal(r.stderr, "err\n");
  assert.equal(sb.calls("osascript")[0]?.stdin, "typed");
});

test("a shell rule gets binary stdin byte for byte", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("tool", [{ shell: 'cat > "$FAKE_DIR/got"' }]);
  const r = await sb.run(["sh", "-c", "printf '\\351\\377\\000x' | tool"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(fs.readFileSync(path.join(sb.dir, "got")), Buffer.from([0xe9, 0xff, 0, 0x78]));
});

test("a shell rule can keep its own state across calls", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("sleep", [{ shell: 'print -r -- "$1" >> "$FAKE_DIR/sleeps"' }]);
  const r = await sb.run(["sh", "-c", "sleep 0.5; sleep 1"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(sb.dir, "sleeps"), "utf8"), "0.5\n1\n");
});

// A fake is a fresh node: the compile cache spares it re-stripping fake.ts's TS on every call.
test("fakes start with node's compile cache, which stays out of their env", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("tool", [{ shell: 'printf "%s" "${NODE_COMPILE_CACHE-unset}"' }]);
  const r = await sb.run(["tool"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "unset");
  assert.equal(sb.calls("tool")[0]?.env.NODE_COMPILE_CACHE, undefined);
  assert.ok(fs.readdirSync(FAKE_CACHE, { recursive: true }).length > 0);
});

test("an ignoresStdin rule leaves stdin to the next reader", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("sleep", [{ ignoresStdin: true }]);
  const r = await sb.run(["sh", "-c", "sleep 1; cat"], { input: "left" });
  assert.equal(r.stdout, "left");
  assert.equal(sb.calls("sleep")[0]?.stdin, "");
});

test("rules follow and update scenario state", async (t) => {
  const sb = await Sandbox.create(t);
  sb.setState({ front: "Terminal", screen: "mini ~ % " });
  sb.fake("osascript", [
    { program: "front.js", when: { front: "Terminal" }, stdout: "Terminal\n" },
    { program: "front.js", stdout: "Google Chrome\n" },
    { program: "contents.js", stdoutFromState: "screen" },
    { program: "hide.js", set: { front: "Finder" } },
  ]);
  const run = (program: string) => sb.run(["osascript", path.join(sb.dir, program)]);
  assert.equal((await run("front.js")).stdout, "Terminal\n");
  assert.equal((await run("contents.js")).stdout, "mini ~ % ");
  await run("hide.js");
  assert.equal(sb.state().front, "Finder");
  assert.equal((await run("front.js")).stdout, "Google Chrome\n");
});

test("stdoutBase64 writes raw bytes", async (t) => {
  const sb = await Sandbox.create(t);
  const bytes = Buffer.from([0, 255, 10, 1]);
  sb.fake("curl", [{ stdoutBase64: bytes.toString("base64") }]);
  await sb.run(["sh", "-c", 'curl -fsSL https://x > "$HOME/out"']);
  assert.deepEqual(fs.readFileSync(path.join(sb.home, "out")), bytes);
});

test("a background process left behind rejects and is killed", async (t) => {
  const sb = await Sandbox.create(t);
  await assert.rejects(sb.run(["sh", "-c", "sleep 30 & echo started"]), /left processes behind/);
});

test("a run past its timeout rejects", async (t) => {
  const sb = await Sandbox.create(t);
  await assert.rejects(sb.run(["sleep", "30"], { timeoutMs: 300 }), /timed out after 300 ms/);
});

// A checkout of registries and shipped files the tripwire checks; `literal` replaces the secrets
// registry's rows.
function tempRepo(t: { after(fn: () => void): void }, literal?: object[]): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "mini-op-repo-"));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  fs.mkdirSync(path.join(repo, "tests/registry"), { recursive: true });
  fs.mkdirSync(path.join(repo, "ctl"));
  for (const name of ["secrets.json", "path-bypass.json"]) {
    fs.copyFileSync(
      path.join(REPO, "tests/registry", name),
      path.join(repo, "tests/registry", name),
    );
  }
  if (literal) {
    const file = path.join(repo, "tests/registry/secrets.json");
    fs.writeFileSync(
      file,
      JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), literal }),
    );
  }
  return repo;
}

// A checkout whose registered PATH bypass mini/bin/p puts a dir ahead of PATH, and mini/bin/q,
// which calls it through ~/apm; with `appends`, p keeps PATH first instead.
function bypassRepo(t: { after(fn: () => void): void }, appends = false): string {
  const repo = tempRepo(t);
  const file = "tests/registry/path-bypass.json";
  fs.writeFileSync(path.join(repo, file), JSON.stringify([{ file: "mini/bin/p", reason: "x" }]));
  fs.mkdirSync(path.join(repo, "mini/bin"), { recursive: true });
  const assign = appends ? "PATH=$PATH:/opt/x" : "PATH=/opt/x:$PATH";
  fs.writeFileSync(path.join(repo, "mini/bin/p"), `#!/bin/zsh\nexport ${assign}\necho p\n`, {
    mode: 0o755,
  });
  fs.writeFileSync(path.join(repo, "mini/bin/q"), "#!/bin/zsh\n~/apm/bin/p\n", { mode: 0o755 });
  return repo;
}

test("the tripwire refuses a registered secrets reader however it is named", async (t) => {
  const repo = tempRepo(t, [{ file: "ctl/mini-reader", reads: true, reason: "reads it" }]);
  const reader = path.join(repo, "ctl/mini-reader");
  fs.writeFileSync(reader, `#!/bin/zsh\ncat ${SECRETS}/pass\n`, { mode: 0o755 });
  const sb = await Sandbox.create(t, { repo });
  const link = path.join(sb.dir, "innocent");
  fs.symlinkSync(reader, link);
  const runs: [string[], RunOptions][] = [
    [[reader], {}],
    [["zsh", "ctl/mini-reader"], { cwd: repo }],
    [["zsh", link], {}],
    [["zsh", "-c", "ctl/mini-reader"], {}],
    [["sh"], { input: "exec mini-reader -v" }],
  ];
  for (const [argv, opts] of runs) {
    await assert.rejects(sb.run(argv, opts), /registered secrets reader/, argv.join(" "));
  }
});

test("the tripwire refuses a registered PATH bypasser", async (t) => {
  const repo = bypassRepo(t);
  const sb = await Sandbox.create(t, { repo });
  await assert.rejects(sb.run(["zsh", path.join(repo, "mini/bin/p")]), /PATH bypass/);
});

test("a registered PATH bypasser that keeps PATH first runs", async (t) => {
  const repo = bypassRepo(t, true);
  const sb = await Sandbox.create(t, { repo });
  const r = await sb.run(["zsh", path.join(repo, "mini/bin/p")]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "p\n");
});

test("the tripwire refuses an unregistered shipped file naming the real secrets dir", async (t) => {
  const repo = tempRepo(t);
  fs.writeFileSync(path.join(repo, "ctl/new"), `#!/bin/zsh\ncat ${SECRETS}/pass\n`);
  fs.writeFileSync(path.join(repo, "ctl/fine"), "#!/bin/zsh\necho ok\n");
  const sb = await Sandbox.create(t, { repo });
  await assert.rejects(sb.run(["zsh", path.join(repo, "ctl/new")]), /unregistered/);
  assert.equal((await sb.run(["zsh", path.join(repo, "ctl/fine")])).stdout, "ok\n");
});

test("an override dir holding a link out of the sandbox rejects", async (t) => {
  const sb = await Sandbox.create(t);
  fs.symlinkSync(path.dirname(sb.dir), path.join(sb.home, "up"));
  await assert.rejects(
    sb.run(["true"], { env: { MINI_OP_SECRETS_DIR: sb.home } }),
    /MINI_OP_SECRETS_DIR/,
  );
});

function traceDir(t: { after(fn: () => void): void }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mini-op-trace-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function traced(dir: string): Set<string> {
  const lines = fs
    .readdirSync(dir)
    .flatMap((file) => fs.readFileSync(path.join(dir, file), "utf8").split("\n"));
  return new Set(lines.filter(Boolean));
}

test("with trace, zsh and bash lines land in the trace file and output is unchanged", async (t) => {
  const trace = traceDir(t);
  const sb = await Sandbox.create(t, { trace });
  const lib = path.join(sb.dir, "lib.zsh");
  fs.writeFileSync(lib, "g() {\n  print -r -- lib\n}\n");
  const z = path.join(sb.dir, "s.zsh");
  fs.writeFileSync(
    z,
    `#!/usr/bin/env zsh\nf() {\n  print -u2 -- err\n}\nsource ${lib}\nx=$(print hi)\nf\ng\nexit 3\n`,
  );
  const b = path.join(sb.dir, "s.bash");
  fs.writeFileSync(
    b,
    '#!/usr/bin/env bash\nset -euo pipefail\nh() {\n  echo "in $1"\n}\nh a\nfalse || echo "rc $?"\n',
  );
  const rz = await sb.run(["zsh", z]);
  assert.deepEqual([rz.code, rz.stdout, rz.stderr], [3, "lib\n", "err\n"]);
  const rb = await sb.run(["bash", b]);
  assert.deepEqual([rb.code, rb.stdout, rb.stderr], [0, "in a\nrc 1\n", ""]);
  const lines = traced(trace);
  for (const n of [3, 5, 6, 7, 8, 9]) assert.ok(lines.has(`${z}:${n}`), `${z}:${n}`);
  assert.ok(lines.has(`${lib}:2`));
  for (const n of [2, 4, 6, 7]) assert.ok(lines.has(`${b}:${n}`), `${b}:${n}`);
});

test("without trace, no shell startup hook is set", async (t) => {
  const sb = await Sandbox.create(t, { trace: "" });
  const r = await sb.run(["env"]);
  assert.doesNotMatch(r.stdout, /^(ZDOTDIR|BASH_ENV|MINI_OP_TRACE_FILE)=/m);
});

test("NODE_V8_COVERAGE passes through to scripts when the test process has it", async (t) => {
  const before = process.env.NODE_V8_COVERAGE;
  const dir = traceDir(t);
  process.env.NODE_V8_COVERAGE = dir;
  t.after(() => {
    if (before === undefined) delete process.env.NODE_V8_COVERAGE;
    else process.env.NODE_V8_COVERAGE = before;
  });
  const sb = await Sandbox.create(t);
  const r = await sb.run(["sh", "-c", 'printf "%s" "$NODE_V8_COVERAGE"']);
  assert.equal(r.stdout, dir);
});

// A fixture mini/ root whose bin/hello reports how the remote side ran it.
function fixtureMini(sb: Sandbox): string {
  const root = path.join(sb.dir, "fixture-mini");
  fs.mkdirSync(path.join(root, "bin"), { recursive: true });
  const hello = [
    "#!/usr/bin/env zsh",
    'read -r line; print -r -- "$line $*"',
    'print -r -- "$HOME|$PWD|${LEAK:-none}"',
    "print -u2 -- remote-err",
    "exit 4",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(root, "bin/hello"), hello, { mode: 0o755 });
  return root;
}

test("fake ssh local runs ~/apm scripts and traces them under mini/", async (t) => {
  const trace = traceDir(t);
  const sb = await Sandbox.create(t, { trace });
  const root = fixtureMini(sb);
  sb.mini(root);
  sb.fake("ssh", [{ local: true }]);
  const r = await sb.run([
    "sh",
    "-c",
    "printf 'in\\n' | LEAK=1 ssh -o BatchMode=yes -F x mini '~/apm/bin/hello a b'",
  ]);
  assert.equal(r.code, 4);
  assert.equal(r.stdout, `in a b\n${sb.home}|${sb.home}|none\n`);
  assert.equal(r.stderr, "remote-err\n");
  assert.equal(sb.calls("ssh")[0]?.stdin, "in\n");
  assert.ok(traced(trace).has(`${path.join(root, "bin/hello")}:2`));
});

test("fake ssh local with no remote command exits 255", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("ssh", [{ local: true }]);
  const r = await sb.run(["ssh", "-o", "BatchMode=yes", "mini"]);
  assert.equal(r.code, 255);
  assert.match(r.stderr, /fake ssh: no remote command/);
});

test("local is refused for a fake other than ssh", async (t) => {
  const sb = await Sandbox.create(t);
  assert.throws(() => sb.fake("docker", [{ local: true }]), /local works for ssh only/);
});

test("a local remote command naming a registered bypass, reader or the real secrets dir trips", async (t) => {
  const sb = await Sandbox.create(t, { repo: bypassRepo(t) });
  sb.fake("ssh", [{ local: true }]);
  const script = path.join(sb.dir, "call");
  for (const remote of ["~/apm/bin/p open x", "zsh mini/bin/p", `cat ${SECRETS}/pass`]) {
    fs.writeFileSync(script, `ssh mini '${remote}'\n`);
    await assert.rejects(sb.run(["sh", script]), /tripped: remote command names/, remote);
  }
  const repo = tempRepo(t, [{ file: "ctl/mini-reader", reads: true, reason: "reads it" }]);
  const withReader = await Sandbox.create(t, { repo });
  withReader.fake("ssh", [{ local: true }]);
  const call = path.join(withReader.dir, "call");
  fs.writeFileSync(call, "ssh mini 'mini-reader -v'\n");
  await assert.rejects(
    withReader.run(["sh", call]),
    /tripped: remote command names registered secrets reader ctl\/mini-reader/,
  );
});

test("a script reaching a registered bypass through sb.mini() trips", async (t) => {
  const repo = bypassRepo(t);
  const sb = await Sandbox.create(t, { repo });
  sb.mini(path.join(repo, "mini"));
  sb.fake("ssh", [{ local: true }]);
  const script = path.join(sb.dir, "call");
  fs.writeFileSync(script, "ssh mini '~/apm/bin/q'\n");
  await assert.rejects(
    sb.run(["sh", script]),
    /tripped: mini\/bin\/p is a registered PATH bypass, reached through ~\/apm/,
  );
});

test("a remote command holding a registered name only inside a longer word does not trip", async (t) => {
  const sb = await Sandbox.create(t);
  sb.mini();
  sb.fake("ssh", [{ local: true }]);
  sb.fake("osascript", [{ stdout: "front\n" }]);
  const script = path.join(sb.dir, "call");
  fs.writeFileSync(script, "ssh mini '~/apm/bin/front example.com'\n");
  const r = await sb.run(["sh", script]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "front\n");
});

test("fakes answer by subcommand prefix", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("opencli", [
    { argv: ["browser", "eval"], stdout: "e" },
    { argv: ["browser", "open"], stdout: "o" },
  ]);
  sb.fake("security", [{ argv: ["find-generic-password"], stdout: "k" }]);
  sb.fake("curl", [{ argv: ["-s"], stdout: "c" }]);
  const r = await sb.run([
    "sh",
    "-c",
    "opencli browser open x; opencli browser eval y; security find-generic-password -w; curl -s u",
  ]);
  assert.equal(r.stdout, "oekc");
});

test("fake ssh local passes large remote output through whole", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("ssh", [{ local: true }]);
  const r = await sb.run(["ssh", "mini", "head -c 3000000 /dev/zero | tr '\\0' x"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.length, 3000000);
});

test("dispose removes the sandbox even when a test left read-only dirs in it", async (t) => {
  const sb = await Sandbox.create(t);
  const locked = path.join(sb.dir, "extracted/ctl/lib");
  fs.mkdirSync(locked, { recursive: true });
  fs.writeFileSync(path.join(locked, "ssh.zsh"), "f() {}\n");
  fs.chmodSync(locked, 0o555);
  fs.chmodSync(path.dirname(locked), 0o555);
  sb.dispose();
  assert.ok(!fs.existsSync(sb.dir));
});

test("real tools run through shims that log their name, argv and env (FR-36)", async (t) => {
  const sb = await Sandbox.create(t);
  const r = await sb.run(["sh", "-c", "printf 'a\\n' | sed -n p; X_MARK=1 cat </dev/null"]);
  assert.equal(r.stdout, "a\n");
  const log = fs.readFileSync(path.join(sb.dir, "tools.log"), "utf8");
  assert.match(log, /^tool: sed\nargv: -n p$/m);
  assert.match(log, /X_MARK=.?1/);
  assert.ok(fs.lstatSync(path.join(sb.dir, "allow/sed")).isFile());
});

// Scripts reading the canary from the secrets dir, each sending it somewhere.
const READ = `tok=$(cat "$MINI_OP_SECRETS_DIR/${MINI_USER}"); `;

test("leaks: a canary in a real tool's argv is caught (the sed variant)", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("ssh", [{ stdout: "" }]);
  await sb.run(["zsh", "-fc", READ + 'print ok | sed "s/^/$tok/" | ssh mini cat']);
  assert.deepEqual(sb.leaks({ consumers: ["ssh"] }), ["tools.log"]);
});

test("leaks: the canary only on a consumer's stdin is clean", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("ssh", [{ stdout: "" }]);
  await sb.run(["zsh", "-fc", `ssh mini cat < "$MINI_OP_SECRETS_DIR/${MINI_USER}"`]);
  assert.deepEqual(sb.leaks({ consumers: ["ssh"] }), []);
  assert.equal(sb.calls("ssh")[0]?.stdin, sb.canary);
});

test("leaks: argv, env, other stdin, stdout, stderr and written files are each caught", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("ssh", [{ stdout: "" }]);
  sb.fake("security", [{ stdout: "" }]);
  const cases: [string, string][] = [
    ['ssh mini "$tok"', "ssh argv"],
    ["TOK=$tok ssh mini x", "ssh env"],
    ["print -r -- $tok | security -i", "security stdin"],
    ["print -r -- $tok", "stdout"],
    ["print -u2 -r -- $tok", "stderr"],
    ["print -r -- $tok > ~/kept", "file home/kept"],
  ];
  for (const [script, where] of cases) {
    const one = await Sandbox.create(t);
    one.fake("ssh", [{ stdout: "" }]);
    one.fake("security", [{ stdout: "" }]);
    await one.run(["zsh", "-fc", READ + script]);
    assert.deepEqual(one.leaks({ consumers: ["ssh"] }), [where], script);
  }
  await sb.run(["cat"], { input: "abc123def" });
  assert.deepEqual(sb.leaks({ consumers: [], secrets: ["123d"] }), ["stdout"]);
  assert.deepEqual(sb.leaks({ consumers: [] }), []);
});

test("the sandbox HOME holds the fake config and its ssh config, never the user's", async (t) => {
  const sb = await Sandbox.create(t);
  const dir = path.join(sb.home, ".mini-op");
  assert.equal(fs.readFileSync(path.join(dir, "config.local.yaml"), "utf8"), FAKE_LOCAL);
  assert.equal(fs.readFileSync(path.join(dir, "ssh_config"), "utf8"), FAKE_SSH_CONFIG);
  const r = await sb.run(["sh", "-c", 'printf %s "$HOME"']);
  assert.equal(r.stdout, sb.home);
});
