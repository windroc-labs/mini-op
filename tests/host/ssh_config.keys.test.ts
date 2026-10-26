import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { fromRoot, isShipped, SAMPLES_DIR } from "../lib/repo.ts";
import { REPO, Sandbox } from "../lib/sandbox.ts";
import { FAKE_LOCAL, MINI_HOST } from "../lib/ssh_config.ts";

const KEYS = fs.readFileSync(path.join(REPO, "host/ssh_config.keys"), "utf8");
const DOCKERFILE = fs.readFileSync(path.join(REPO, "host/Dockerfile"), "utf8");
const ENV_KEY = "/run/ensemble/" + "secrets/env/mini-ssh-key";

// The file's Match blocks: each criteria line with its settings, comments and blank lines left out.
function blocks(text: string): { match: string; settings: string[] }[] {
  const found: { match: string; settings: string[] }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (/^match\s/i.test(line)) found.push({ match: line, settings: [] });
    else found.at(-1)?.settings.push(line.replace(/\s+/g, " "));
  }
  return found;
}

test("ssh uses only the injected key and the baked host key", () => {
  assert.deepEqual(blocks(KEYS), [
    {
      match: "Match originalhost mini",
      settings: [
        `IdentityFile ${ENV_KEY}`,
        "IdentitiesOnly yes",
        "StrictHostKeyChecking yes",
        "UserKnownHostsFile /dev/null",
        "GlobalKnownHostsFile /etc/ssh/mini_known_hosts",
      ],
    },
  ]);
});

test("the image reads it before mini.conf, and the env stage bakes the host keys it names", () => {
  const keys = "/etc/ssh/ssh_config.d/mini-keys.conf";
  const image = DOCKERFILE.slice(0, DOCKERFILE.search(/^FROM image AS env$/m));
  assert.match(image, /^COPY host\/ssh_config\.keys \/etc\/ssh\/ssh_config\.d\/mini-keys\.conf$/m);
  assert.match(
    DOCKERFILE.slice(image.length),
    /^COPY --from=mini --chmod=0644 known_hosts \/etc\/ssh\/mini_known_hosts$/m,
  );
  // ssh reads ssh_config.d/*.conf in sorted order; the first value of a keyword wins.
  const conf = ["mini.conf", "mini-proxy.conf", path.basename(keys)].sort();
  assert.equal(conf[0], path.basename(keys));
});

test("host/config's Host mini sets only HostName, User and Port, so nothing competes", async (t) => {
  const sb = await Sandbox.create(t);
  fs.rmSync(path.join(sb.home, ".mini-op/ssh_config"));
  const r = await sb.run(["bash", path.join(REPO, "host/config")]);
  assert.equal(r.code, 0, r.stderr);
  const config = fs.readFileSync(path.join(sb.home, ".mini-op/ssh_config"), "utf8");
  const keywords = config
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split(/\s+/)[0]);
  assert.deepEqual(keywords, ["Host", "HostName", "User", "Port"]);
});

test("no doc or shipped file accepts a host key inside the container (AC12b)", () => {
  const view = fromRoot(REPO);
  const accepts = /docker exec[^\n]*ssh-keygen -R|StrictHostKeyChecking=(?:ask|accept-new|no)\b/;
  const named = view.files
    .filter((f) => (isShipped(f) || f.endsWith(".md")) && !f.startsWith(SAMPLES_DIR))
    .filter((f) => accepts.test(view.read(f)));
  assert.deepEqual(named, []);
});

// Run the documented enrollment command with only fake network tools and a sandbox HOME.
function reconnectStep5(): string {
  const runbook = fs.readFileSync(path.join(REPO, "runbooks/setup-test-env.md"), "utf8");
  const step = runbook.slice(runbook.search(/^5\. Pin the mini.s new host key/m));
  const block = /^ *```sh\n([\s\S]*?)^ *```$/m.exec(step)?.[1] ?? "";
  assert.ok(block.trim(), "Reconnect step 5 must have a command");
  return block.replace(/^ +/gm, "");
}

test("Reconnect step 5 pins mini-op state for the configured endpoint without touching personal trust", async (t) => {
  const block = reconnectStep5();
  // The enrollment tests cover both ports; exercise the documented command with a custom one.
  const port = "2222";
  const entry = `[${MINI_HOST}]:${port}`;
  const sb = await Sandbox.create(t);
  fs.writeFileSync(
    path.join(sb.home, ".mini-op/config.local.yaml"),
    `${FAKE_LOCAL}mini_port: ${port}\n`,
  );
  sb.fake("ssh-keyscan", [{ stdout: `${entry} ssh-ed25519 fake-key\n`, ignoresStdin: true }]);
  sb.fake("ssh-keygen", [
    { argv: ["-lf"], stdout: "256 SHA256:fake mini (ED25519)\n", ignoresStdin: true },
  ]);
  const r = await sb.run(["bash", "-euc", block], { cwd: REPO, input: "yes\n" });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(
    fs.readFileSync(path.join(sb.home, ".mini-op/known_hosts"), "utf8"),
    `${entry} ssh-ed25519 fake-key\n`,
  );
  assert.ok(!fs.existsSync(path.join(sb.home, ".ssh")));
  assert.equal(sb.calls("ssh-keygen").length, 1);
  assert.equal(sb.calls("ssh-keygen")[0]?.argv[0], "-lf");
});
