import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox } from "../../lib/sandbox.ts";

const RESOLVER = path.join(REPO, "ctl/lib/secrets.zsh");
const ENV_DIR = "/run/ensemble/" + "secrets/env";
const WRITES = "the user writes it (host/README.md, Steps 4); typed nothing";

test("secrets_dir prints the registered override", async (t) => {
  const sb = await Sandbox.create(t);
  const r = await sb.run(["zsh", "-fc", 'source "$1" && secrets_dir', "zsh", RESOLVER]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, sb.secrets + "\n");
});

test("the resolved dir holds the sandbox canary, not a real secret", async (t) => {
  const sb = await Sandbox.create(t);
  const script = 'source "$1" && cat "$(secrets_dir)/mini-password"';
  const r = await sb.run(["zsh", "-fc", script, "zsh", RESOLVER]);
  assert.equal(r.stdout, sb.canary);
  assert.equal(sb.passwordFile, path.join(sb.secrets, "mini-password"));
});

test("env_secrets_dir is the environment's dir, or env/ under the override", async (t) => {
  const sb = await Sandbox.create(t);
  const r = await sb.run(["zsh", "-fc", 'source "$1" && env_secrets_dir', "zsh", RESOLVER]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, path.join(sb.secrets, "env") + "\n");
  const unset = 'unset MINI_OP_SECRETS_DIR; source "$1" && env_secrets_dir';
  const real = await sb.run(["zsh", "-fc", unset, "zsh", RESOLVER]);
  assert.equal(real.code, 0);
  assert.equal(real.stdout, ENV_DIR + "\n");
});

// mini_password_file run as ctl/mini's pw would: its stdout, stderr and code.
async function pick(sb: Sandbox) {
  const script = 'source "$1" && mini_password_file "mini: pw" "typed nothing"';
  return sb.run(["zsh", "-fc", script, "zsh", RESOLVER]);
}

function envFile(sb: Sandbox, text: string): string {
  const file = path.join(sb.secrets, "env/mini-password");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, { mode: 0o400 });
  return file;
}

test("mini_password_file picks the environment's mini-password first", async (t) => {
  const sb = await Sandbox.create(t);
  const file = envFile(sb, "other");
  const r = await pick(sb);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, file + "\n");
  assert.equal(r.stderr, "");
});

test("mini_password_file without an environment file picks the secrets dir's", async (t) => {
  const sb = await Sandbox.create(t);
  fs.mkdirSync(path.join(sb.secrets, "env"));
  const r = await pick(sb);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, sb.passwordFile + "\n");
});

test("an empty environment file fails naming it, with no fallback", async (t) => {
  const sb = await Sandbox.create(t);
  const file = envFile(sb, "");
  const r = await pick(sb);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, `mini: pw: ${file} is empty or unreadable; typed nothing\n`);
});

test("no environment file and no usable direct file fail naming both", async (t) => {
  const env = (sb: Sandbox) => path.join(sb.secrets, "env/mini-password");
  for (const direct of [undefined, ""]) {
    const sb = await Sandbox.create(t);
    fs.rmSync(sb.passwordFile);
    if (direct !== undefined) fs.writeFileSync(sb.passwordFile, direct);
    const r = await pick(sb);
    assert.equal(r.code, 1, String(direct));
    assert.equal(r.stdout, "");
    assert.equal(
      r.stderr,
      `mini: pw: no mini password in ${env(sb)} or ${sb.passwordFile}; ${WRITES}\n`,
    );
  }
});

test("no ctl/ script builds a password path from the account name", () => {
  for (const file of ["ctl/mini", "ctl/mini-autologin", "ctl/lib/secrets.zsh"]) {
    const text = fs.readFileSync(path.join(REPO, file), "utf8");
    assert.doesNotMatch(text, /secrets_dir\)\/[^\s"']*\$\{?(account|user)/i, file);
    assert.match(text, /mini-password/, file);
  }
});
