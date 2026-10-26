import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox, type FakeRule } from "../lib/sandbox.ts";
import { FAKE_LOCAL, MINI_HOST } from "../lib/ssh_config.ts";

const PIN = path.join(REPO, "host/pin-host-key");
const KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGZha2VfaG9zdF9rZXlfZm9yX3Rlc3RzX29ubHkh";
const FINGERPRINT = "256 SHA256:fake-fingerprint mini (ED25519)\n";
const OLD = "old pin\n";
const PERSONAL = "personal known_hosts must stay unchanged\n";
const pinFile = (sb: Sandbox) => path.join(sb.home, ".mini-op/known_hosts");

async function setup(t: Parameters<typeof Sandbox.create>[0], scan?: FakeRule, keygen?: FakeRule) {
  const sb = await Sandbox.create(t);
  fs.writeFileSync(pinFile(sb), OLD);
  fs.mkdirSync(path.join(sb.home, ".ssh"));
  fs.writeFileSync(path.join(sb.home, ".ssh/known_hosts"), PERSONAL);
  sb.fake("ssh-keyscan", [
    { ignoresStdin: true, ...(scan ?? { stdout: `# banner\n${MINI_HOST} ${KEY}\n` }) },
  ]);
  sb.fake("ssh-keygen", [{ ignoresStdin: true, ...(keygen ?? { stdout: FINGERPRINT }) }]);
  return sb;
}

function unchanged(sb: Sandbox) {
  assert.equal(fs.readFileSync(pinFile(sb), "utf8"), OLD);
  assert.equal(fs.readFileSync(path.join(sb.home, ".ssh/known_hosts"), "utf8"), PERSONAL);
  assert.deepEqual(fs.readdirSync(path.join(sb.home, ".mini-op")).sort(), [
    "config.local.yaml",
    "known_hosts",
    "ssh_config",
  ]);
}

test("shows the scanned fingerprint and pins only after explicit yes, for default and custom ports", async (t) => {
  for (const port of ["22", "2222"]) {
    const entry = port === "22" ? MINI_HOST : `[${MINI_HOST}]:${port}`;
    const sb = await setup(t, { stdout: `# banner\n${entry} ${KEY}\n` });
    fs.writeFileSync(
      path.join(sb.home, ".mini-op/config.local.yaml"),
      `${FAKE_LOCAL}mini_port: ${port}\n`,
    );
    const r = await sb.run(["bash", PIN], { input: "yes\n" });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.stdout.indexOf(FINGERPRINT.trim()) < r.stdout.indexOf("Type yes"), r.stdout);
    assert.match(r.stdout, /ssh-keygen -lf \/etc\/ssh\/ssh_host_ed25519_key.pub/);
    assert.equal(fs.readFileSync(pinFile(sb), "utf8"), `${entry} ${KEY}\n`);
    assert.equal(fs.statSync(pinFile(sb)).mode & 0o077, 0);
    assert.equal(fs.readFileSync(path.join(sb.home, ".ssh/known_hosts"), "utf8"), PERSONAL);
    assert.deepEqual(
      sb.calls("ssh-keyscan").map((c) => c.argv),
      [["-T", "5", "-p", port, "-t", "ed25519", MINI_HOST]],
    );
    assert.deepEqual(sb.calls("ssh"), []);
    const keygen = sb.calls("ssh-keygen")[0]!;
    assert.equal(keygen.argv[0], "-lf");
    assert.deepEqual(keygen.argv.slice(2), ["-E", "sha256"]);
    assert.ok(keygen.argv[1]!.startsWith(path.join(sb.home, ".mini-op/")));
  }
});

test("first enrollment writes a pin without any personal known_hosts file", async (t) => {
  const sb = await setup(t);
  fs.rmSync(pinFile(sb));
  fs.rmSync(path.join(sb.home, ".ssh"), { recursive: true });
  const r = await sb.run(["bash", PIN], { input: "yes\n" });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(fs.readFileSync(pinFile(sb), "utf8"), `${MINI_HOST} ${KEY}\n`);
  assert.ok(!fs.existsSync(path.join(sb.home, ".ssh")));
});

test("declining, another answer, or EOF keeps the old pin", async (t) => {
  for (const input of ["no\n", "y\n", "YES\n", "", "\n"]) {
    const sb = await setup(t);
    const r = await sb.run(["bash", PIN], { input });
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /not confirmed; pinned key unchanged/);
    unchanged(sb);
  }
});

test("failed, empty, malformed, multiple, or wrong-endpoint scans keep the old pin", async (t) => {
  for (const scan of [
    { exit: 1 },
    { stdout: "" },
    { stdout: "# banner\n" },
    { stdout: `${MINI_HOST} ssh-rsa fake\n` },
    { stdout: `${MINI_HOST} ${KEY}\n${MINI_HOST} ${KEY}\n` },
    { stdout: `192.168.1.99 ${KEY}\n` },
    { stdout: `[${MINI_HOST}]:2222 ${KEY}\n` },
    { stdout: `${MINI_HOST} ${KEY} extra\n` },
  ]) {
    const sb = await setup(t, scan);
    const r = await sb.run(["bash", PIN], { input: "yes\n" });
    assert.equal(r.code, 1, JSON.stringify(scan));
    assert.ok(!r.stdout.includes("Type yes"));
    unchanged(sb);
  }
});

test("an invalid key or failed config keeps the old pin", async (t) => {
  const invalid = await setup(t, undefined, { exit: 255 });
  const r = await invalid.run(["bash", PIN], { input: "yes\n" });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /invalid Ed25519 host key/);
  unchanged(invalid);
  const sb = await setup(t);
  fs.writeFileSync(path.join(sb.home, ".mini-op/config.local.yaml"), "mini_host: invalid\n");
  assert.equal((await sb.run(["bash", PIN], { input: "yes\n" })).code, 1);
  assert.deepEqual(sb.calls(), []);
  unchanged(sb);
});

test("help and usage errors run no tools", async (t) => {
  const sb = await setup(t);
  for (const args of [["-h"], ["--help"]]) {
    const r = await sb.run(["bash", PIN, ...args]);
    assert.equal(r.code, 0);
  }
  for (const args of [["--yes"], ["extra"]]) {
    const r = await sb.run(["bash", PIN, ...args]);
    assert.equal(r.code, 2);
  }
  assert.deepEqual(sb.calls(), []);
  unchanged(sb);
});
