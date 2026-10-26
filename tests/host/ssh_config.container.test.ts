import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox } from "../lib/sandbox.ts";
import { hostMini, MINI_HOST, MINI_USER } from "../lib/ssh_config.ts";

// ssh_config's rules for one host name, as `ssh -G` applies them: the texts in order, a keyword's
// first value wins, `Host` patterns with * and ? and !negation. No real ssh runs in tests.
function resolve(texts: string[], host: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const text of texts) {
    let on = true;
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const [key = "", ...rest] = line.split(/\s+/);
      const value = rest.join(" ");
      if (key.toLowerCase() === "host") {
        const glob = (p: string) =>
          new RegExp(
            `^${p
              .replace(/[.+^${}()|[\]\\]/g, "\\$&")
              .replace(/\*/g, ".*")
              .replace(/\?/g, ".")}$`,
          );
        const hit = rest.some((p) => !p.startsWith("!") && glob(p).test(host));
        on = hit && !rest.some((p) => p.startsWith("!") && glob(p.slice(1)).test(host));
      } else if (on && !out.has(key.toLowerCase())) {
        out.set(key.toLowerCase(), value);
      }
    }
  }
  return out;
}

const CONTAINER = fs.readFileSync(path.join(REPO, "host/ssh_config.container"), "utf8");

// host/config's ssh_config for the sandbox's fake config, as the MacBook and the container get it.
async function generated(t: Parameters<typeof Sandbox.create>[0]): Promise<string> {
  const sb = await Sandbox.create(t);
  fs.rmSync(path.join(sb.home, ".mini-op/ssh_config"));
  const r = await sb.run(["bash", path.join(REPO, "host/config")]);
  assert.equal(r.code, 0, r.stderr);
  return fs.readFileSync(path.join(sb.home, ".mini-op/ssh_config"), "utf8");
}

test("the generated ssh_config alone names the mini directly, for the MacBook", async (t) => {
  const config = await generated(t);
  const mini = resolve([config], "mini");
  assert.equal(mini.get("hostname"), MINI_HOST);
  assert.equal(mini.get("user"), MINI_USER);
  assert.equal(mini.get("port"), "22");
  assert.equal(mini.get("proxycommand"), undefined);
  assert.deepEqual(hostMini(config), { hostName: MINI_HOST, user: MINI_USER });
});

test("the proxy hop reads HTTPS_PROXY at runtime and passes data as arguments", async (t) => {
  const mini = resolve([await generated(t), CONTAINER], "mini");
  const proxy = mini.get("proxycommand") ?? "";
  assert.ok(proxy.includes("HTTPS_PROXY"));
  const sb = await Sandbox.create(t);
  sb.fake("nc", [{}]);
  // SSH substitutes only the endpoint tokens; the shell expands the proxy when the hop runs.
  const command = proxy.replaceAll("%h", MINI_HOST).replaceAll("%p", "22");
  for (const endpoint of ["gateway.example:3128", "other.example:8080"]) {
    const r = await sb.run(["sh", "-c", command], { env: { HTTPS_PROXY: `http://${endpoint}` } });
    assert.equal(r.code, 0, r.stderr);
    const expected = ["-X", "connect", "-x", endpoint, MINI_HOST, "22"];
    assert.deepEqual(sb.calls("nc").at(-1)?.argv, expected);
  }
  const before = sb.calls("nc").length;
  const missing = await sb.run(["sh", "-c", command]);
  assert.notEqual(missing.code, 0);
  assert.match(missing.stderr, /HTTPS_PROXY/);
  assert.equal(sb.calls("nc").length, before);
  assert.deepEqual(resolve([CONTAINER], "other"), new Map());
});

test("the image installs the proxy hop into ssh's config dir, and nc for the ProxyCommand", () => {
  const dockerfile = fs.readFileSync(path.join(REPO, "host/Dockerfile"), "utf8");
  const copies = [
    ...dockerfile.matchAll(
      /^COPY (?:--\S+ )*(\S*ssh_config\S*) (\/etc\/ssh\/ssh_config\.d\/\S+\.conf)$/gm,
    ),
  ];
  // Host mini (address, account) comes only from host/start's generated context, in the last
  // stage, at the path where ctl/lib/ssh.zsh's mini_user reads it.
  const mini = "/etc/ssh/ssh_config.d/mini.conf";
  assert.deepEqual(
    copies.map((m) => [m[1], m[2]]),
    [
      ["host/ssh_config.container", "/etc/ssh/ssh_config.d/mini-proxy.conf"],
      ["host/ssh_config.keys", "/etc/ssh/ssh_config.d/mini-keys.conf"],
      ["ssh_config", mini],
    ],
  );
  assert.match(dockerfile, /^COPY --from=mini .*ssh_config\.d\/mini\.conf$/m);
  assert.ok(fs.readFileSync(path.join(REPO, "ctl/lib/ssh.zsh"), "utf8").includes(mini));
  const install = /apt-get install -y --no-install-recommends \\\n\s*"claude-code=[^;]*/.exec(
    dockerfile,
  )?.[0];
  assert.ok(install?.split(/\s+/).includes("netcat-openbsd"), install);
});
