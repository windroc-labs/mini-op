import assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox } from "../../lib/sandbox.ts";

const LIB = path.join(REPO, "mini/lib/secrets.zsh");
// Sourced by zsh (the mini's scripts) and by bash (.github/image-check): both must agree.
const SHELLS = [
  ["zsh", "-fc"],
  ["bash", "-c"],
] as const;

const TOKENS = [
  "sk-ant-" + "oat01-abc_DEF-123",
  "lin_api_" + "abcDEF123",
  "ghp_" + "abc123",
  "gho_" + "abc123",
  "ghu_" + "abc123",
  "ghs_" + "abc123",
  "ghr_" + "abc123",
  "github_pat_" + "11ABC_def",
];
const BEGIN = "-----BEGIN " + "OPENSSH PRIVATE KEY-----";
const END = "-----END " + "OPENSSH PRIVATE KEY-----";

async function lib(t: Parameters<typeof Sandbox.create>[0], call: string, input = "") {
  const sb = await Sandbox.create(t);
  const results = [];
  for (const [shell, flag] of SHELLS) {
    results.push(await sb.run([shell, flag, `source "$1" && ${call}`, shell, LIB], { input }));
  }
  assert.deepEqual(results[1], results[0], "bash and zsh differ");
  return results[0]!;
}

test("secrets_redact hides every token pattern and keeps the rest of the line", async (t) => {
  for (const token of TOKENS) {
    const r = await lib(t, "secrets_redact", `before ${token} after\nplain\n`);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, "before <redacted> after\nplain\n", token);
  }
});

test("secrets_redact hides a private key block as one line, with or without its END", async (t) => {
  const block = `a\n${BEGIN}\nb3BlbnNzaC1rZXk\nAAAA\n${END}\nz\n`;
  assert.equal((await lib(t, "secrets_redact", block)).stdout, "a\n<redacted private key>\nz\n");
  const cut = `a\n  ${BEGIN}\nb3BlbnNzaC1rZXk\n`;
  assert.equal((await lib(t, "secrets_redact", cut)).stdout, "a\n<redacted private key>\n");
});

test("secrets_redact hides the OAuth token block, wrapped lines included", async (t) => {
  const screen =
    "x\nYour OAuth token:\nsk-ant-" + "oat01-AAAA\nBBBB-wrapped\nStore this token safely\ny\n";
  const r = await lib(t, "secrets_redact", screen);
  assert.equal(r.stdout, "x\nYour OAuth token:\n  <token hidden>\nStore this token safely\ny\n");
});

test("secrets_redact hides a token on the OAuth heading line itself", async (t) => {
  const r = await lib(
    t,
    "secrets_redact",
    "Your OAuth token: sk-ant-" + "oat01-abc\nStore this token\n",
  );
  assert.equal(r.stdout, "Your OAuth token: <redacted>\n  <token hidden>\nStore this token\n");
});

test("secrets_redact hides everything before a private key END whose BEGIN scrolled off", async (t) => {
  const r = await lib(t, "secrets_redact", `b3BlbnNzaC1rZXk\nQUFBQUJB\n${END}\nmini ~ % \n`);
  assert.equal(r.stdout, "<redacted private key>\nmini ~ % \n");
});

test("secrets_redact hides everything before a Store line whose OAuth heading scrolled off", async (t) => {
  const r = await lib(
    t,
    "secrets_redact",
    "AAAA\nWRAPPEDTAIL0123\nStore this token securely\nok\n",
  );
  assert.equal(r.stdout, "  <token hidden>\nStore this token securely\nok\n");
});

test("secrets_redact leaves clean text unchanged", async (t) => {
  const text = "mini ~ % ls\nghp_ alone is a prefix: gh_x sk-ant lin_api\n\n";
  assert.equal((await lib(t, "secrets_redact", text)).stdout, text);
});

test("secrets_found finds any pattern, or only the named keys", async (t) => {
  for (const token of [...TOKENS, BEGIN]) {
    assert.equal((await lib(t, "secrets_found", `x\n${token}\n`)).code, 0, token);
  }
  assert.equal((await lib(t, "secrets_found", "clean\ntext\n")).code, 1);
  assert.equal((await lib(t, "secrets_found linear", "ghs_" + "abc\n")).code, 1);
  assert.equal((await lib(t, "secrets_found linear github", "ghs_" + "abc\n")).code, 0);
  const unknown = await lib(t, "secrets_found lin_api_", "lin_api_" + "abc\n");
  assert.equal(unknown.code, 2);
  assert.equal(unknown.stdout, "");
});

test("secret_is accepts exactly one whole token of the key", async (t) => {
  const key = "lin_api_" + "abcDEF123";
  assert.equal((await lib(t, "secret_is linear", key)).code, 0);
  assert.equal((await lib(t, "secret_is linear", key + "\n")).code, 0);
  for (const bad of [
    `My key: ${key}`,
    `${key}" -A -l "y`,
    `${key}\\n" -A`,
    `${key}\nmore`,
    `${key}\n\n`,
    "ghs_" + "abc",
    "",
  ]) {
    assert.equal((await lib(t, "secret_is linear", bad)).code, 1, JSON.stringify(bad));
  }
  for (const call of [
    "secret_is",
    "secret_is private-key",
    "secret_is linear github",
    "secret_is x",
  ]) {
    assert.equal((await lib(t, call, key)).code, 2, call);
  }
});
