import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox } from "../../lib/sandbox.ts";

const HELPER = path.join(REPO, "ctl/lib/version.sh");
const run = '. "$1" && apm_version "$2"';
const GIT = ["git", "-c", "user.name=t", "-c", "user.email=t@example.com"];

// A one-commit git repo in the sandbox; returns its dir and commit.
async function repo(sb: Sandbox): Promise<{ dir: string; commit: string }> {
  const dir = path.join(sb.dir, "checkout");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "a"), "a\n");
  for (const args of [
    ["init", "-q"],
    ["add", "a"],
    ["commit", "-q", "-m", "a"],
  ]) {
    const r = await sb.run([...GIT, "-C", dir, ...args]);
    assert.equal(r.code, 0, r.stderr);
  }
  const head = await sb.run(["git", "-C", dir, "rev-parse", "HEAD"]);
  return { dir, commit: head.stdout.trim() };
}

for (const shell of ["bash", "zsh"]) {
  test(`${shell}: a clean checkout's stamp is its commit`, async (t) => {
    const sb = await Sandbox.create(t);
    const { dir, commit } = await repo(sb);
    const r = await sb.run([shell, "-c", run, shell, HELPER, dir]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(commit, /^[0-9a-f]{40}$/);
    assert.equal(r.stdout, `${commit}\n`);
  });
}

test("uncommitted changes, untracked files included, add -dirty", async (t) => {
  const sb = await Sandbox.create(t);
  const { dir, commit } = await repo(sb);
  fs.writeFileSync(path.join(dir, "new"), "x\n");
  const r = await sb.run(["bash", "-c", run, "bash", HELPER, dir]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, `${commit}-dirty\n`);
});

test("a dir that is not a checkout's top fails and prints nothing", async (t) => {
  const sb = await Sandbox.create(t);
  const { dir } = await repo(sb);
  fs.mkdirSync(path.join(dir, "sub"));
  for (const target of [sb.home, path.join(dir, "sub")]) {
    const r = await sb.run(["bash", "-c", run, "bash", HELPER, target]);
    assert.equal(r.code, 1);
    assert.equal(r.stdout, "");
  }
});
