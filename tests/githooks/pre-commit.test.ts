import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox } from "../lib/sandbox.ts";

const UNFORMATTED_TS = "export const x = {a:1}\n";
const UNFORMATTED_BASH = "#!/usr/bin/env bash\nif true;then echo hi;fi\n";
const ZSH = "#!/bin/zsh\nif true;then print hi;fi\n";

async function repo(t: Parameters<typeof Sandbox.create>[0], hooks = path.join(REPO, ".githooks")) {
  const sb = await Sandbox.create(t);
  const root = path.join(sb.dir, "repo");
  fs.mkdirSync(root);
  const git = (...args: string[]) =>
    sb.run(
      [
        "git",
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@example.com",
        "-c",
        `core.hooksPath=${hooks}`,
        ...args,
      ],
      { cwd: root, timeoutMs: 30000 },
    );
  await git("init", "-q");
  const write = (file: string, text: string) => fs.writeFileSync(path.join(root, file), text);
  return { sb, root, git, write };
}

test("a commit stores the formatted bash and TS, leaving zsh alone", async (t) => {
  const { root, git, write } = await repo(t);
  write("a.ts", UNFORMATTED_TS);
  write("b", UNFORMATTED_BASH);
  write("z", ZSH);
  await git("add", "a.ts", "b", "z");
  const c = await git("commit", "-qm", "x");
  assert.equal(c.code, 0, c.stderr);
  assert.equal((await git("show", "HEAD:a.ts")).stdout, "export const x = { a: 1 };\n");
  assert.equal(
    (await git("show", "HEAD:b")).stdout,
    "#!/usr/bin/env bash\nif true; then echo hi; fi\n",
  );
  assert.equal((await git("show", "HEAD:z")).stdout, ZSH);
  assert.equal(fs.readFileSync(path.join(root, "a.ts"), "utf8"), "export const x = { a: 1 };\n");
  assert.equal((await git("status", "--porcelain")).stdout, "");
});

test("a staged file with unstaged changes aborts the commit naming it", async (t) => {
  const { root, git, write } = await repo(t);
  write("a.ts", UNFORMATTED_TS);
  await git("add", "a.ts");
  write("a.ts", UNFORMATTED_TS + "export const y = {b:2}\n");
  const c = await git("commit", "-qm", "x");
  assert.notEqual(c.code, 0);
  assert.match(c.stderr, /pre-commit: a\.ts has unstaged changes; stage or stash them/);
  assert.notEqual((await git("rev-parse", "-q", "--verify", "HEAD")).code, 0);
  assert.equal(
    fs.readFileSync(path.join(root, "a.ts"), "utf8"),
    UNFORMATTED_TS + "export const y = {b:2}\n",
  );
});

test("a commit with nothing to format passes untouched", async (t) => {
  const { git, write } = await repo(t);
  write("notes.txt", "x\n");
  await git("add", "notes.txt");
  assert.equal((await git("commit", "-qm", "x")).code, 0);
});

test("without the formatters installed the hook fails with a hint", async (t) => {
  const sb = await Sandbox.create(t);
  const bare = path.join(sb.dir, "tools-checkout/.githooks");
  fs.mkdirSync(bare, { recursive: true });
  fs.copyFileSync(path.join(REPO, ".githooks/pre-commit"), path.join(bare, "pre-commit"));
  fs.chmodSync(path.join(bare, "pre-commit"), 0o755);
  const { git, write } = await repo(t, bare);
  write("a.ts", UNFORMATTED_TS);
  await git("add", "a.ts");
  const c = await git("commit", "-qm", "x");
  assert.notEqual(c.code, 0);
  assert.match(c.stderr, /pre-commit: prettier is not installed; run npm ci --ignore-scripts/);
});

test("run directly, the hook exits 2 on any argument and 1 without prettier", async (t) => {
  const sb = await Sandbox.create(t);
  for (const arg of ["x", "--bogus"]) {
    const usage = await sb.run(["bash", path.join(REPO, ".githooks/pre-commit"), arg]);
    assert.equal(usage.code, 2);
    assert.equal(usage.stdout, "");
    assert.equal(usage.stderr, "pre-commit: usage: pre-commit\n");
  }
  const help = await sb.run(["bash", path.join(REPO, ".githooks/pre-commit"), "-h"]);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /^pre-commit /);
  assert.equal(help.stderr, "");
  const bare = path.join(sb.dir, "tools-checkout/.githooks");
  fs.mkdirSync(bare, { recursive: true });
  fs.copyFileSync(path.join(REPO, ".githooks/pre-commit"), path.join(bare, "pre-commit"));
  const missing = await sb.run(["bash", path.join(bare, "pre-commit")]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /pre-commit: prettier is not installed/);
});
