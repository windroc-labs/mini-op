import assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox } from "../../lib/sandbox.ts";
import { MINI_USER } from "../../lib/ssh_config.ts";

const RESOLVER = path.join(REPO, "ctl/lib/secrets.zsh");

test("secrets_dir prints the registered override", async (t) => {
  const sb = await Sandbox.create(t);
  const r = await sb.run(["zsh", "-fc", 'source "$1" && secrets_dir', "zsh", RESOLVER]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, sb.secrets + "\n");
});

test("the resolved dir holds the sandbox canary, not a real secret", async (t) => {
  const sb = await Sandbox.create(t);
  const r = await sb.run([
    "zsh",
    "-fc",
    'source "$1" && cat "$(secrets_dir)/$2"',
    "zsh",
    RESOLVER,
    MINI_USER,
  ]);
  assert.equal(r.stdout, sb.canary);
});
