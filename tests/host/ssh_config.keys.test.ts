import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { fromRoot, isShipped, SAMPLES_DIR } from "../lib/repo.ts";
import { REPO, Sandbox } from "../lib/sandbox.ts";

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

test("the environment's key when it is readable, else the volume's, never both", () => {
  const [env, volume] = blocks(KEYS);
  const exec = `exec "test -r ${ENV_KEY}"`;
  assert.deepEqual(env, {
    match: `Match originalhost mini ${exec}`,
    settings: [`IdentityFile ${ENV_KEY}`],
  });
  assert.deepEqual(volume, {
    match: `Match originalhost mini !${exec}`,
    settings: ["IdentityFile ~/.ssh/id_ed25519"],
  });
});

test("ssh trusts only the baked host key and never adds or asks about one", () => {
  const [, , common, ...more] = blocks(KEYS);
  assert.deepEqual(more, []);
  assert.deepEqual(common, {
    match: "Match originalhost mini",
    settings: [
      "IdentitiesOnly yes",
      "StrictHostKeyChecking yes",
      "UserKnownHostsFile /dev/null",
      "GlobalKnownHostsFile /etc/ssh/mini_known_hosts",
    ],
  });
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
