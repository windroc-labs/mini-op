import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox } from "../../lib/sandbox.ts";

const RESOLVER = path.join(REPO, "ctl/lib/secrets.zsh");
const ENV_DIR = "/run/ensemble/" + "secrets/env";
const IMPORT = "import with ensemble-broker login env mini-op-password (host/README.md, Environment definition)";

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
  fs.rmSync(file, { force: true });
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

test("a legacy direct password file is never used", async (t) => {
  const sb = await Sandbox.create(t);
  fs.rmSync(sb.passwordFile);
  fs.writeFileSync(path.join(sb.secrets, "mini-password"), sb.canary);
  const r = await pick(sb);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, `mini: pw: ${sb.passwordFile} is missing, empty or unreadable; ${IMPORT}; typed nothing\n`);
});

test("an empty environment file fails naming it, with no fallback", async (t) => {
  const sb = await Sandbox.create(t);
  const file = envFile(sb, "");
  const r = await pick(sb);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, `mini: pw: ${file} is missing, empty or unreadable; ${IMPORT}; typed nothing\n`);
});

test("no ctl/ script builds a password path from the account name", () => {
  for (const file of ["ctl/mini", "ctl/mini-autologin", "ctl/lib/secrets.zsh"]) {
    const text = fs.readFileSync(path.join(REPO, file), "utf8");
    assert.doesNotMatch(text, /secrets_dir\)\/[^\s"']*\$\{?(account|user)/i, file);
    assert.match(text, /mini-password/, file);
  }
});
