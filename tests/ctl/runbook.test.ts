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
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
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
  ]) {
    const r = await sb.run([SCRIPT, ...args], { cwd: ws });
    assert.equal(r.code, 2, args.join(" "));
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /^runbook: usage: /);
  }
  let r = await sb.run([SCRIPT, "-h"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^runbook list /);
  r = await sb.run([SCRIPT, "list", "--workspace", path.join(sb.dir, "none")]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, `runbook: no workspace ${path.join(sb.dir, "none")}\n`);
  r = await sb.run([SCRIPT, "list"], { cwd: ws });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(lines(r.stdout), pluginRows());
});
