import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox } from "../../lib/sandbox.ts";
import { MINI_USER } from "../../lib/ssh_config.ts";

const HELPER = path.join(REPO, "ctl/lib/ssh.zsh");
const run = 'source "$1" && shift && mini_ssh "$@"';

test("in a checkout (the MacBook) mini_ssh uses ~/.mini-op/ssh_config", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("ssh", [{ stdout: "ok\n" }]);
  const r = await sb.run(
    ["zsh", "-fc", run, "zsh", HELPER, "-o", "BatchMode=yes", "mini", "true"],
    {
      input: "in",
    },
  );
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "ok\n");
  const [call] = sb.calls("ssh");
  assert.deepEqual(call?.argv, [
    "-F",
    path.join(sb.home, ".mini-op/ssh_config"),
    "-o",
    "BatchMode=yes",
    "mini",
    "true",
  ]);
  assert.equal(call?.stdin, "in");
});

test("without host/ (the container) mini_ssh uses the image's ssh config", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("ssh", [{ exit: 3 }]);
  const lib = path.join(sb.dir, "opt/ctl/lib");
  fs.mkdirSync(lib, { recursive: true });
  fs.copyFileSync(HELPER, path.join(lib, "ssh.zsh"));
  const r = await sb.run(["zsh", "-fc", run, "zsh", path.join(lib, "ssh.zsh"), "mini", "echo ok"]);
  assert.equal(r.code, 3);
  assert.deepEqual(sb.calls("ssh")[0]?.argv, ["mini", "echo ok"]);
});

const user = 'source "$1" && shift && mini_user "$@"';

// A ctl/lib/ssh.zsh copy: beside host/config (a checkout) with ~/.mini-op/ssh_config holding
// `config` (none when null), or with no host/ (the container) when `config` is undefined.
function checkout(sb: Sandbox, config: string | null | undefined): string {
  const lib = path.join(sb.dir, "repo/ctl/lib");
  fs.mkdirSync(lib, { recursive: true });
  fs.copyFileSync(HELPER, path.join(lib, "ssh.zsh"));
  const generated = path.join(sb.home, ".mini-op/ssh_config");
  fs.rmSync(generated, { force: true });
  if (config !== undefined) {
    fs.mkdirSync(path.join(sb.dir, "repo/host"), { recursive: true });
    fs.writeFileSync(path.join(sb.dir, "repo/host/config"), "");
    if (config !== null) fs.writeFileSync(generated, config);
  }
  return path.join(lib, "ssh.zsh");
}

test("mini_user prints ~/.mini-op/ssh_config's User, the mini's account", async (t) => {
  const sb = await Sandbox.create(t);
  const r = await sb.run(["zsh", "-fc", user, "zsh", HELPER]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, `${MINI_USER}\n`);
  assert.equal(r.stderr, "");
  assert.deepEqual(sb.calls(), []);
});

test("mini_user takes the first User under Host mini, as ssh does", async (t) => {
  const sb = await Sandbox.create(t);
  const helper = checkout(
    sb,
    "# the mini\nUser outside\nHost other\n    User nobody\nhost  backup mini\n" +
      "    HostName 10.9.8.7\n    user alice_2\n    User bob\nHost *\n    User star\n",
  );
  const r = await sb.run(["zsh", "-fc", user, "zsh", helper]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "alice_2\n");
});

test("mini_user returns 1 without a valid User under Host mini", async (t) => {
  const sb = await Sandbox.create(t);
  for (const config of [
    "Host mini\n    HostName 10.9.8.7\n",
    "Host other\n    User alice\n",
    "Host mini\n    User ../x\n",
    "Host mini\n    User A.b\n",
    "Host mini\n    User\n",
  ]) {
    fs.rmSync(path.join(sb.dir, "repo"), { recursive: true, force: true });
    const helper = checkout(sb, config);
    const file = path.join(sb.home, ".mini-op/ssh_config");
    const r = await sb.run(["zsh", "-fc", user, "zsh", helper, "x: y"]);
    assert.equal(r.code, 1, config);
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, `x: y: cannot read the mini's account from ${file}\n`);
  }
});

test("in a checkout without ~/.mini-op/ssh_config mini_user fails naming that path", async (t) => {
  const sb = await Sandbox.create(t);
  const helper = checkout(sb, null);
  const r = await sb.run(["zsh", "-fc", user, "zsh", helper, "x"]);
  assert.equal(r.code, 1);
  assert.equal(
    r.stderr,
    `x: cannot read the mini's account from ${path.join(sb.home, ".mini-op/ssh_config")}\n`,
  );
});

test("mini_user reads host/config's generated ssh_config", async (t) => {
  const sb = await Sandbox.create(t);
  fs.rmSync(path.join(sb.home, ".mini-op/ssh_config"));
  const config = await sb.run(["bash", path.join(REPO, "host/config")]);
  assert.equal(config.code, 0, config.stderr);
  const r = await sb.run(["zsh", "-fc", user, "zsh", HELPER]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, `${MINI_USER}\n`);
});

test("without host/ (the container) mini_user reads the image's ssh config", async (t) => {
  const image = "/etc/ssh/ssh_config.d/mini.conf";
  if (fs.existsSync(image)) return t.skip(`${image} exists on this machine`);
  const sb = await Sandbox.create(t);
  const helper = checkout(sb, undefined);
  const r = await sb.run(["zsh", "-fc", user, "zsh", helper]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, `cannot read the mini's account from ${image}\n`);
});
