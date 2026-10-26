import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox } from "../lib/sandbox.ts";

const SCRIPT = path.join(REPO, "ctl/runbook");
const GIT = ["git", "-c", "user.name=t", "-c", "user.email=t@example.com"];
const book = (when: string, body = "# T\n\nbody\n") => `---\nwhen: ${when}\n---\n\n${body}`;

// The repo's runbooks/ is the plugin tier: one row per file, by name, with its frontmatter's when.
function pluginRows(root = REPO): string[] {
  return fs
    .readdirSync(path.join(root, "runbooks"))
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => {
      const text = fs.readFileSync(path.join(root, "runbooks", f), "utf8");
      const when = /^---\n(?:.*\n)*?when: (.*)\n/.exec(text)?.[1] ?? "";
      return `plugin\t${root}/runbooks/${f}\t${when}`;
    });
}

const lines = (text: string) => text.split("\n").filter(Boolean);

function workspace(sb: Sandbox): string {
  const ws = path.join(sb.dir, "ws");
  fs.mkdirSync(ws, { recursive: true });
  return ws;
}

function runbooks(dir: string, files: Record<string, string>): string {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

const snapshot = (ws: string, project: string, files: Record<string, string>) =>
  runbooks(path.join(ws, "projects", project, ".mini-op/runbooks"), files);

const run = (sb: Sandbox, ws: string, ...args: string[]) =>
  sb.run([SCRIPT, ...args, "--workspace", ws]);

test("list without a project prints the plugin runbooks in name order", async (t) => {
  const sb = await Sandbox.create(t);
  const r = await run(sb, workspace(sb), "list");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(lines(r.stdout), pluginRows());
  assert.equal(r.stderr, "");
});

test("every runbook in the repo has a when", async (t) => {
  const sb = await Sandbox.create(t);
  const r = await run(sb, workspace(sb), "list");
  assert.equal(r.code, 0);
  const files = fs.readdirSync(path.join(REPO, "runbooks")).filter((f) => f.endsWith(".md"));
  assert.equal(lines(r.stdout).length, files.length);
  for (const row of lines(r.stdout)) assert.match(row, /^plugin\t\S+\.md\t\S/);
  assert.equal(r.stderr, "");
});

test("one snapshot: its runbooks come before the plugin's", async (t) => {
  const sb = await Sandbox.create(t);
  const ws = workspace(sb);
  const dir = snapshot(ws, "ensemble", { "b.md": book("second"), "a.md": book("first") });
  fs.writeFileSync(path.join(ws, "projects/ensemble/remote"), "https://example.com/o/ensemble\n");
  fs.mkdirSync(path.join(dir, "a"));
  fs.writeFileSync(path.join(dir, "a/script"), "#!/bin/sh\n");
  fs.writeFileSync(path.join(dir, "board.toml"), "x = 1\n");
  const r = await run(sb, ws, "list");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(lines(r.stdout), [
    `project:ensemble\t${dir}/a.md\tfirst`,
    `project:ensemble\t${dir}/b.md\tsecond`,
    ...pluginRows(),
  ]);
  assert.equal(r.stderr, "");
});

test("several snapshots and no --project: exit 3, nothing listed, names them", async (t) => {
  const sb = await Sandbox.create(t);
  const ws = workspace(sb);
  snapshot(ws, "zeta", { "z.md": book("z") });
  snapshot(ws, "alpha", { "a.md": book("a") });
  fs.mkdirSync(path.join(ws, "projects/.alpha.new/.mini-op/runbooks"), { recursive: true });
  fs.mkdirSync(path.join(ws, "projects/empty"));
  const asked =
    "runbook: several projects (alpha, zeta); ask the user which one and pass --project <name>\n";
  for (const args of [["list"], ["path", "a"]]) {
    const r = await run(sb, ws, ...args);
    assert.equal(r.code, 3, r.stderr);
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, asked);
  }
});

test("several snapshots: --project picks one", async (t) => {
  const sb = await Sandbox.create(t);
  const ws = workspace(sb);
  snapshot(ws, "alpha", { "a.md": book("a") });
  const dir = snapshot(ws, "zeta", { "z.md": book("z") });
  const r = await run(sb, ws, "list", "--project", "zeta");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(lines(r.stdout), [`project:zeta\t${dir}/z.md\tz`, ...pluginRows()]);
});

test("path resolves a plugin name among several snapshots", async (t) => {
  const sb = await Sandbox.create(t);
  const ws = workspace(sb);
  snapshot(ws, "alpha", { "a.md": book("a") });
  snapshot(ws, "zeta", { "z.md": book("z") });
  const r = await run(sb, ws, "path", "return-mini");
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, `plugin\t${REPO}/runbooks/return-mini.md\n`);
});

test("--project: unknown project or not a plain name exits 1", async (t) => {
  const sb = await Sandbox.create(t);
  const ws = workspace(sb);
  let r = await run(sb, ws, "list", "--project", "nope");
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, `runbook: no project nope in ${ws}/projects (have: none)\n`);
  snapshot(ws, "alpha", { "a.md": book("a") });
  snapshot(ws, "beta", { "b.md": book("b") });
  r = await run(sb, ws, "list", "--project", "nope");
  assert.equal(r.code, 1);
  assert.equal(r.stderr, `runbook: no project nope in ${ws}/projects (have: alpha, beta)\n`);
  for (const bad of ["../alpha", "a/b", ".hidden", "..", ""]) {
    r = await run(sb, ws, "list", "--project", bad);
    assert.equal(r.code, 1, bad);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /^runbook: not a plain name: /);
  }
});

test("a project runbook named like a plugin runbook is skipped and reported", async (t) => {
  const sb = await Sandbox.create(t);
  const ws = workspace(sb);
  const dir = snapshot(ws, "ensemble", {
    "return-mini.md": book("shadow"),
    "check-connection.md": "no frontmatter\n",
    "own.md": book("own"),
  });
  const r = await run(sb, ws, "list");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(lines(r.stdout), [`project:ensemble\t${dir}/own.md\town`, ...pluginRows()]);
  assert.deepEqual(lines(r.stderr), [
    `runbook: skipped ${dir}/check-connection.md: the plugin has a runbook named check-connection`,
    `runbook: skipped ${dir}/return-mini.md: the plugin has a runbook named return-mini`,
  ]);
});

test("a runbook without when is skipped and reported", async (t) => {
  const sb = await Sandbox.create(t);
  const ws = workspace(sb);
  const dir = snapshot(ws, "ensemble", {
    "a.md": "# No frontmatter\n\nwhen: not here\n",
    "b.md": "---\ntitle: x\n---\n",
    "c.md": "---\nwhen:   \n---\n",
    "d.md": "---\nwhen: never closed\n",
    "e.md": book("fine"),
    "f.md": "---\nwhen:\nwhen: a second line does not count\n---\n",
    "g.md": "---\nwhen: closed on the last line\n---",
    "h.md": `---\nwhen: too long\n${"x: y\n".repeat(100)}---\n`,
  });
  const r = await run(sb, ws, "list");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(lines(r.stdout), [
    `project:ensemble\t${dir}/e.md\tfine`,
    `project:ensemble\t${dir}/g.md\tclosed on the last line`,
    ...pluginRows(),
  ]);
  assert.deepEqual(
    lines(r.stderr),
    ["a", "b", "c", "d", "f", "h"].map(
      (n) => `runbook: skipped ${dir}/${n}.md: no when in its frontmatter`,
    ),
  );
});

test("only the first 64 KiB of a runbook is read", async (t) => {
  const sb = await Sandbox.create(t);
  const ws = workspace(sb);
  const long = "a".repeat(5_000_000);
  const dir = snapshot(ws, "p", {
    "big.md": `---\nwhen: x${long}\n---\n`,
    "late.md": `---\nwhen: late\nx: ${long}\n---\n`,
    "tail.md": `---\nwhen: fine\n---\n${long}\n`,
  });
  const r = await sb.run([SCRIPT, "list", "--workspace", ws], { timeoutMs: 5000 });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(lines(r.stdout), [`project:p\t${dir}/tail.md\tfine`, ...pluginRows()]);
  assert.deepEqual(
    lines(r.stderr),
    ["big", "late"].map((n) => `runbook: skipped ${dir}/${n}.md: no when in its frontmatter`),
  );
});

test("a plugin runbook without when is skipped and reported", async (t) => {
  const sb = await Sandbox.create(t);
  const root = path.join(sb.dir, "root");
  fs.cpSync(path.join(REPO, "ctl"), path.join(root, "ctl"), { recursive: true });
  runbooks(path.join(root, "runbooks"), { "a.md": book("plugin a"), "b.md": "# B\n" });
  const r = await sb.run([path.join(root, "ctl/runbook"), "list", "--workspace", workspace(sb)]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, `plugin\t${root}/runbooks/a.md\tplugin a\n`);
  assert.equal(r.stderr, `runbook: skipped ${root}/runbooks/b.md: no when in its frontmatter\n`);
});

test("list reads only the frontmatter's when", async (t) => {
  const sb = await Sandbox.create(t);
  const ws = workspace(sb);
  const body = "# Body\n\nSECRET-BODY-LINE\n---\nwhen: later\n";
  const dir = snapshot(ws, "p", {
    "a.md": `---\ntitle: t\nwhen: \tfirst one\t\nwhen: second\n---\n${body}`,
  });
  const r = await run(sb, ws, "list");
  assert.equal(r.code, 0, r.stderr);
  assert.equal(lines(r.stdout)[0], `project:p\t${dir}/a.md\tfirst one`);
  assert.doesNotMatch(r.stdout, /SECRET-BODY-LINE|later|second/);
});

test("checkout case: the workspace's own .mini-op/runbooks is the project, named by its origin repo", async (t) => {
  const sb = await Sandbox.create(t);
  const ws = path.join(sb.dir, "ensemble-WDRC-1");
  const dir = runbooks(path.join(ws, ".mini-op/runbooks"), { "install.md": book("install") });
  snapshot(ws, "other", { "o.md": book("o") });
  let r = await sb.run([...GIT, "-C", ws, "init", "-q"]);
  assert.equal(r.code, 0, r.stderr);
  r = await run(sb, ws, "list");
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "runbook: cannot name the checkout's project from its origin remote\n");
  for (const [url, name] of [
    ["git@github.com:o/ensemble.git", "ensemble"],
    ["https://github.com/o/ensemble/", "ensemble"],
  ]) {
    await sb.run([...GIT, "-C", ws, "remote", "remove", "origin"]);
    r = await sb.run([...GIT, "-C", ws, "remote", "add", "origin", url!]);
    assert.equal(r.code, 0, r.stderr);
    r = await run(sb, ws, "list");
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(lines(r.stdout), [
      `project:${name}\t${dir}/install.md\tinstall`,
      ...pluginRows(),
    ]);
  }
  r = await run(sb, ws, "path", "install");
  assert.equal(r.stdout, `project:ensemble\t${dir}/install.md\n`);
  r = await run(sb, ws, "list", "--project", "other");
  assert.equal(r.code, 1);
  assert.equal(r.stderr, `runbook: --project other given, but ${ws} is itself a checkout\n`);
  r = await run(sb, ws, "list", "--project", "../x");
  assert.equal(r.stderr, "runbook: not a plain name: ../x\n");
  await sb.run([...GIT, "-C", ws, "remote", "set-url", "origin", "https://example.com/o/bad name"]);
  r = await run(sb, ws, "list");
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "runbook: cannot name the checkout's project from its origin remote\n");
});

test("checkout case: a git config that blocks makes the lookup give up, not hang", async (t) => {
  const sb = await Sandbox.create(t);
  const ws = path.join(sb.dir, "ensemble");
  runbooks(path.join(ws, ".mini-op/runbooks"), { "install.md": book("install") });
  let r = await sb.run([...GIT, "-C", ws, "init", "-q"]);
  assert.equal(r.code, 0, r.stderr);
  fs.rmSync(path.join(ws, ".git/config"));
  const config = path.join(ws, ".git/config");
  r = await sb.run(["perl", "-MPOSIX", "-e", "mkfifo($ARGV[0], 0644) or die", config]);
  assert.equal(r.code, 0, r.stderr);
  r = await sb.run([SCRIPT, "list", "--workspace", ws], { timeoutMs: 12000 });
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "runbook: cannot name the checkout's project from its origin remote\n");
});

test("path finds a named runbook in order; none or not plain exits 1", async (t) => {
  const sb = await Sandbox.create(t);
  const ws = workspace(sb);
  const dir = snapshot(ws, "ensemble", { "install.md": book("install"), "bare.md": "# x\n" });
  let r = await run(sb, ws, "path", "install");
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, `project:ensemble\t${dir}/install.md\n`);
  r = await run(sb, ws, "path", "setup-test-env");
  assert.equal(r.stdout, `plugin\t${REPO}/runbooks/setup-test-env.md\n`);
  r = await run(sb, ws, "path", "missing");
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /^runbook: no runbook named missing\n$/m);
  r = await run(sb, ws, "path", "bare");
  assert.equal(r.code, 1);
  assert.deepEqual(lines(r.stderr), [
    `runbook: skipped ${dir}/bare.md: no when in its frontmatter`,
    "runbook: no runbook named bare",
  ]);
  for (const bad of ["../install", "a/b", ".x"]) {
    r = await run(sb, ws, "path", bad);
    assert.equal(r.code, 1);
    assert.equal(r.stderr, `runbook: not a plain name: ${bad}\n`);
  }
});

test("non-plain project and runbook names are skipped and reported", async (t) => {
  const sb = await Sandbox.create(t);
  const ws = workspace(sb);
  fs.mkdirSync(path.join(ws, "projects/has space/.mini-op/runbooks"), { recursive: true });
  const dir = snapshot(ws, "ok", { "bad name.md": book("x"), "good.md": book("good") });
  const r = await run(sb, ws, "list");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(lines(r.stdout), [`project:ok\t${dir}/good.md\tgood`, ...pluginRows()]);
  assert.deepEqual(lines(r.stderr), [
    `runbook: skipped $'${ws}/projects/has space': not a plain project name`,
    `runbook: skipped $'${dir}/bad name.md': not a plain runbook name`,
  ]);
});

test("names with a newline or tab are reported quoted", async (t) => {
  const sb = await Sandbox.create(t);
  const ws = workspace(sb);
  fs.mkdirSync(path.join(ws, "projects/x\nRunbook: plugin evil/.mini-op/runbooks"), {
    recursive: true,
  });
  const dir = snapshot(ws, "ok", { "a\tb.md": book("x"), "good.md": book("good") });
  const r = await run(sb, ws, "list");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(lines(r.stdout), [`project:ok\t${dir}/good.md\tgood`, ...pluginRows()]);
  assert.deepEqual(lines(r.stderr), [
    `runbook: skipped $'${ws}/projects/x\\nRunbook: plugin evil': not a plain project name`,
    `runbook: skipped $'${dir}/a\\tb.md': not a plain runbook name`,
  ]);
});

test("symlinks, FIFOs and dirs named .md in the workspace are skipped, never read", async (t) => {
  const sb = await Sandbox.create(t);
  const ws = workspace(sb);
  const outside = runbooks(path.join(sb.dir, "outside"), { "o.md": book("outside") });
  const dir = snapshot(ws, "p", { "good.md": book("good") });
  fs.symlinkSync(path.join(outside, "o.md"), path.join(dir, "link.md"));
  fs.symlinkSync(path.join(dir, "good.md"), path.join(dir, "inner.md"));
  fs.mkdirSync(path.join(dir, "folder.md"));
  const made = await sb.run([
    "perl",
    "-MPOSIX",
    "-e",
    "mkfifo($ARGV[0], 0644) or die",
    `${dir}/pipe.md`,
  ]);
  assert.equal(made.code, 0, made.stderr);
  const r = await sb.run([SCRIPT, "list", "--workspace", ws], { timeoutMs: 5000 });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(lines(r.stdout), [`project:p\t${dir}/good.md\tgood`, ...pluginRows()]);
  assert.doesNotMatch(r.stdout, /outside/);
  assert.deepEqual(
    lines(r.stderr),
    ["folder", "inner", "link", "pipe"].map(
      (n) => `runbook: skipped ${dir}/${n}.md: not a regular file`,
    ),
  );
});

test("symlinked project, .mini-op and runbooks dirs are skipped; the lookup falls through", async (t) => {
  const sb = await Sandbox.create(t);
  const ws = workspace(sb);
  const outside = runbooks(path.join(sb.dir, "outside/.mini-op/runbooks"), { "o.md": book("o") });
  fs.mkdirSync(path.join(ws, "projects"));
  fs.symlinkSync(path.join(sb.dir, "outside"), path.join(ws, "projects/linked"));
  fs.mkdirSync(path.join(ws, "projects/inner/.mini-op"), { recursive: true });
  fs.symlinkSync(outside, path.join(ws, "projects/inner/.mini-op/runbooks"));
  fs.symlinkSync(path.join(sb.dir, "outside/.mini-op"), path.join(ws, ".mini-op"));
  const dir = snapshot(ws, "real", { "r.md": book("real") });
  const r = await run(sb, ws, "list");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(lines(r.stdout), [`project:real\t${dir}/r.md\treal`, ...pluginRows()]);
  assert.deepEqual(lines(r.stderr), [
    `runbook: skipped ${ws}/.mini-op: not a real directory`,
    `runbook: skipped ${ws}/projects/inner/.mini-op/runbooks: not a real directory`,
    `runbook: skipped ${ws}/projects/linked: not a real directory`,
  ]);
});

test("usage errors exit 2; -h exits 0; a missing workspace exits 1", async (t) => {
  const sb = await Sandbox.create(t);
  const ws = workspace(sb);
  for (const args of [
    [],
    ["nope"],
    ["list", "--bogus"],
    ["list", "extra"],
    ["path"],
    ["path", "a", "b"],
    ["list", "--project"],
    ["list", "--workspace"],
    ["deploy"],
    ["deploy", "a", "b"],
  ]) {
    const r = await sb.run([SCRIPT, ...args], { cwd: ws });
    assert.equal(r.code, 2, args.join(" "));
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /^runbook: usage: /);
  }
  let r = await sb.run([SCRIPT, "-h"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^runbook list /);
  assert.match(r.stdout, /^runbook deploy <name> /m);
  assert.match(r.stdout, /~\/mini-op-projects\/<project>\/<name>\//);
  assert.match(r.stdout, /named by its origin repo/);
  assert.match(r.stdout, /real \.mini-op\/runbooks/);
  assert.match(r.stdout, /starting with \.\s+\(staging\)\s+are\s+ignored/);
  r = await sb.run([SCRIPT, "list", "--workspace", path.join(sb.dir, "none")]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, `runbook: no workspace ${path.join(sb.dir, "none")}\n`);
  r = await sb.run([SCRIPT, "list"], { cwd: ws });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(lines(r.stdout), pluginRows());
});

// deploy (FR-213, FR-214, FR-217): the mini is the sandbox's HOME, through a local fake ssh.
const MINI = path.join(REPO, "ctl/mini");
const SCRIPTS = { "install.md": book("install"), "install/install-test": "#!/bin/zsh\necho hi\n" };

function onMini(sb: Sandbox, ...parts: string[]): string {
  return path.join(sb.home, "mini-op-projects", ...parts);
}

// Every file under dir, relative, to its text.
function files(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of fs.readdirSync(dir, { recursive: true }) as string[]) {
    const full = path.join(dir, rel);
    if (fs.lstatSync(full).isFile()) out[rel] = fs.readFileSync(full, "utf8");
  }
  return out;
}

// A sandbox whose mini already has this copy's ~/apm.
async function synced(t: Parameters<typeof Sandbox.create>[0]): Promise<Sandbox> {
  const sb = await Sandbox.create(t);
  sb.fake("ssh", [{ local: true }]);
  const r = await sb.run(["zsh", MINI, "sync"]);
  assert.equal(r.code, 0, r.stderr);
  return sb;
}

function scripts(ws: string, project: string, extra: Record<string, string> = {}): string {
  const dir = snapshot(ws, project, { "install.md": book("install") });
  runbooks(path.join(dir, "install"), { "install-test": "#!/bin/zsh\necho hi\n", ...extra });
  fs.chmodSync(path.join(dir, "install/install-test"), 0o755);
  return dir;
}

const sshCommands = (sb: Sandbox) => sb.calls("ssh").map((call) => call.argv.at(-1) ?? "");

test("deploy puts a snapshot runbook's scripts in ~/mini-op-projects", async (t) => {
  const sb = await synced(t);
  const ws = workspace(sb);
  const dir = scripts(ws, "ensemble", { "conf/strata.conf": "model = x\n" });
  const r = await run(sb, ws, "deploy", "install");
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^mini: in sync at \S+\n/);
  assert.ok(
    r.stdout.endsWith(
      `runbook: deployed ${dir}/install to the mini's ~/mini-op-projects/ensemble/install/\n`,
    ),
    r.stdout,
  );
  assert.deepEqual(files(onMini(sb, "ensemble/install")), {
    "install-test": "#!/bin/zsh\necho hi\n",
    "conf/strata.conf": "model = x\n",
  });
  assert.ok(fs.statSync(onMini(sb, "ensemble/install/install-test")).mode & 0o100);
  assert.deepEqual(fs.readdirSync(onMini(sb, "ensemble")), ["install"]);
  // The packed archive went to ssh as a file, and its temp dir is gone.
  assert.match(sb.calls("ssh").at(-1)?.stdin ?? "", /install-test/);
  assert.deepEqual(fs.readdirSync(path.join(sb.dir, "tmp")), []);
});

test("deploy works for a checkout workspace", async (t) => {
  const sb = await synced(t);
  const ws = path.join(sb.dir, "proj-checkout");
  runbooks(path.join(ws, ".mini-op/runbooks"), SCRIPTS);
  for (const args of [
    ["init", "-q"],
    ["remote", "add", "origin", "https://github.com/o/proj.git"],
  ]) {
    const r = await sb.run([...GIT, "-C", ws, ...args]);
    assert.equal(r.code, 0, r.stderr);
  }
  const r = await run(sb, ws, "deploy", "install");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(files(onMini(sb, "proj/install")), { "install-test": "#!/bin/zsh\necho hi\n" });
});

test("deploy again replaces; no scripts dir removes; two projects stay apart", async (t) => {
  const sb = await synced(t);
  const ws = workspace(sb);
  const dir = scripts(ws, "alpha", { "old.conf": "1\n" });
  scripts(ws, "beta");
  assert.equal((await run(sb, ws, "deploy", "install", "--project", "alpha")).code, 0);
  assert.equal((await run(sb, ws, "deploy", "install", "--project", "beta")).code, 0);
  fs.rmSync(path.join(dir, "install/old.conf"));
  fs.writeFileSync(path.join(dir, "install/install-test"), "#!/bin/zsh\necho v2\n");
  // The mini's copy is read-only, as tar keeps the snapshot's modes: a redeploy swaps it anyway.
  fs.chmodSync(onMini(sb, "alpha/install/install-test"), 0o555);
  fs.chmodSync(onMini(sb, "alpha/install"), 0o555);
  let r = await run(sb, ws, "deploy", "install", "--project", "alpha");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(files(onMini(sb, "alpha/install")), { "install-test": "#!/bin/zsh\necho v2\n" });
  assert.deepEqual(files(onMini(sb, "beta/install")), { "install-test": "#!/bin/zsh\necho hi\n" });
  assert.deepEqual(fs.readdirSync(onMini(sb, "alpha")), ["install"]);
  fs.rmSync(path.join(dir, "install"), { recursive: true });
  r = await run(sb, ws, "deploy", "install", "--project", "alpha");
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.stdout.endsWith("runbook: install has no scripts; nothing on the mini\n"), r.stdout);
  assert.ok(!fs.existsSync(onMini(sb, "alpha/install")));
  assert.ok(fs.existsSync(onMini(sb, "beta/install/install-test")));
  r = await run(sb, ws, "deploy", "install", "--project", "alpha");
  assert.equal(r.code, 0, r.stderr);
});

test("deploy syncs a stale ~/apm first; a failed sync deploys nothing", async (t) => {
  const sb = await synced(t);
  const ws = workspace(sb);
  scripts(ws, "ensemble");
  const version = fs.readFileSync(path.join(sb.home, "apm/VERSION"), "utf8");
  fs.writeFileSync(path.join(sb.home, "apm/VERSION"), `${"0".repeat(40)}\n`);
  const before = sb.calls("ssh").length;
  let r = await run(sb, ws, "deploy", "install");
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^mini: synced mini\/ to the mini's ~\/apm at \S+\n/);
  assert.equal(fs.readFileSync(path.join(sb.home, "apm/VERSION"), "utf8"), version);
  const [check, unpack, deploy, ...more] = sshCommands(sb).slice(before);
  assert.equal(check, "cat ~/apm/VERSION");
  assert.match(unpack ?? "", /tar -xf - -C ~\/apm\.new/);
  assert.match(deploy ?? "", /mini-op-projects/);
  assert.deepEqual(more, []);
  assert.ok(fs.existsSync(onMini(sb, "ensemble/install/install-test")));
  // A sync that fails: the mini's home takes no writes.
  fs.rmSync(onMini(sb), { recursive: true });
  fs.writeFileSync(path.join(sb.home, "apm/VERSION"), `${"0".repeat(40)}\n`);
  const calls = sb.calls("ssh").length;
  fs.chmodSync(sb.home, 0o555);
  try {
    r = await run(sb, ws, "deploy", "install");
  } finally {
    fs.chmodSync(sb.home, 0o755);
  }
  assert.equal(r.code, 1);
  assert.match(r.stderr, /runbook: mini sync failed; deployed nothing\n$/);
  assert.equal(sb.calls("ssh").length, calls + 2);
  assert.ok(!fs.existsSync(onMini(sb)));
});

test("deploy refuses symlinks, FIFOs, sockets and hard links before any ssh", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("ssh", [{ local: true }]);
  const ws = workspace(sb);
  const dir = scripts(ws, "ensemble");
  const key = path.join(sb.home, ".ssh/id_ed25519");
  fs.mkdirSync(path.dirname(key), { recursive: true });
  fs.writeFileSync(key, "not a key\n");
  const src = path.join(dir, "install");
  fs.symlinkSync(key, path.join(src, "key"));
  fs.mkdirSync(path.join(src, "sub"));
  fs.symlinkSync(path.dirname(key), path.join(src, "sub/dotssh"));
  fs.linkSync(key, path.join(src, "hard"));
  for (const [module, code, name] of [
    ["-MPOSIX", "mkfifo($ARGV[0], 0644) or die", "pipe"],
    ["-MIO::Socket::UNIX", "IO::Socket::UNIX->new(Local => $ARGV[0], Listen => 1) or die", "sock"],
  ] as const) {
    const made = await sb.run(["perl", module, "-e", code, path.join(src, name)]);
    assert.equal(made.code, 0, made.stderr);
  }
  let r = await run(sb, ws, "deploy", "install");
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.deepEqual(
    lines(r.stderr).sort(),
    [
      `runbook: refused ${src}/hard: a hard link`,
      `runbook: refused ${src}/key: a symlink`,
      `runbook: refused ${src}/pipe: not a regular file`,
      `runbook: refused ${src}/sock: not a regular file`,
      `runbook: refused ${src}/sub/dotssh: a symlink`,
      "runbook: deployed nothing",
    ].sort(),
  );
  assert.deepEqual(sb.calls("ssh"), []);
  fs.rmSync(src, { recursive: true });
  fs.symlinkSync(path.dirname(key), src);
  r = await run(sb, ws, "deploy", "install");
  assert.equal(r.code, 1);
  assert.equal(r.stderr, `runbook: refused ${src}: a symlink\nrunbook: deployed nothing\n`);
  fs.rmSync(src);
  fs.writeFileSync(src, "a file\n");
  r = await run(sb, ws, "deploy", "install");
  assert.equal(r.code, 1);
  assert.equal(r.stderr, `runbook: refused ${src}: not a directory\nrunbook: deployed nothing\n`);
  assert.deepEqual(sb.calls("ssh"), []);
});

test("deploy needs a plain name and a project runbook", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("ssh", [{ local: true }]);
  const ws = workspace(sb);
  scripts(ws, "alpha");
  let r = await run(sb, ws, "deploy", "../x");
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "runbook: not a plain name: ../x\n");
  for (const name of ["return-mini", "nope"]) {
    r = await run(sb, ws, "deploy", name);
    assert.equal(r.code, 1, name);
    assert.equal(r.stderr, `runbook: no project runbook named ${name}\n`);
  }
  scripts(ws, "beta");
  r = await run(sb, ws, "deploy", "install");
  assert.equal(r.code, 3);
  assert.match(r.stderr, /^runbook: several projects \(alpha, beta\)/);
  assert.deepEqual(sb.calls("ssh"), []);
});

test("a failed deploy keeps the mini's previous scripts", async (t) => {
  const sb = await synced(t);
  const ws = workspace(sb);
  const dir = scripts(ws, "ensemble");
  assert.equal((await run(sb, ws, "deploy", "install")).code, 0);
  fs.writeFileSync(path.join(dir, "install/install-test"), "#!/bin/zsh\necho v2\n");
  fs.chmodSync(onMini(sb, "ensemble"), 0o555);
  let r: Awaited<ReturnType<typeof run>>;
  try {
    r = await run(sb, ws, "deploy", "install");
  } finally {
    fs.chmodSync(onMini(sb, "ensemble"), 0o755);
  }
  assert.equal(r.code, 1);
  assert.match(
    r.stderr,
    new RegExp(
      `runbook: deploying to the mini failed; ~/mini-op-projects/ensemble/install/ unchanged or partly updated\n$`,
    ),
  );
  assert.deepEqual(files(onMini(sb, "ensemble/install")), {
    "install-test": "#!/bin/zsh\necho hi\n",
  });
});

test("the mini's re-check refuses a special file in what it received", async (t) => {
  const sb = await Sandbox.create(t);
  // The archive gains a symlink on its way: the mini side must refuse it and keep what it had.
  sb.fake("ssh", [
    {
      shell: `cmd=\${@[-1]}
case $cmd in
  *mini-op-projects*.new*) d=$(mktemp -d); tar -xf - -C $d; ln -s /etc/passwd $d/evil; tar -cf - -C $d . | zsh -c $cmd ;;
  *) exec zsh -c $cmd ;;
esac`,
    },
  ]);
  const r0 = await sb.run(["zsh", MINI, "sync"]);
  assert.equal(r0.code, 0, r0.stderr);
  const ws = workspace(sb);
  scripts(ws, "ensemble");
  const r = await run(sb, ws, "deploy", "install");
  assert.equal(r.code, 1);
  assert.match(
    r.stderr,
    /runbook: the mini found a file that is not a regular file; deployed nothing\n/,
  );
  assert.match(r.stderr, /runbook: deploying to the mini failed;/);
  assert.deepEqual(fs.readdirSync(onMini(sb, "ensemble")), []);
});

test("an unreadable script deploys nothing and keeps the mini's previous scripts", async (t) => {
  const sb = await synced(t);
  const ws = workspace(sb);
  const dir = scripts(ws, "ensemble", { "b.conf": "1\n" });
  assert.equal((await run(sb, ws, "deploy", "install")).code, 0);
  const before = files(onMini(sb, "ensemble/install"));
  const calls = sb.calls("ssh").length;
  fs.writeFileSync(path.join(dir, "install/install-test"), "#!/bin/zsh\necho v2\n");
  const src = path.join(dir, "install");
  const unreadable = path.join(src, "b.conf");
  fs.chmodSync(unreadable, 0);
  let r: Awaited<ReturnType<typeof run>>;
  try {
    r = await run(sb, ws, "deploy", "install");
  } finally {
    fs.chmodSync(unreadable, 0o644);
  }
  assert.equal(r.code, 1);
  assert.match(r.stderr, new RegExp(`runbook: cannot pack ${src}; deployed nothing\n$`));
  assert.equal(sb.calls("ssh").length, calls);
  assert.deepEqual(files(onMini(sb, "ensemble/install")), before);
  assert.deepEqual(fs.readdirSync(path.join(sb.dir, "tmp")), []);
});
