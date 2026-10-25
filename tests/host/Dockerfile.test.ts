import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { dockerfileProblems } from "../lib/image.ts";
import { fromRoot, isShipped, PLUGIN_ROOT, SAMPLES_DIR } from "../lib/repo.ts";
import { REPO } from "../lib/sandbox.ts";

const TEXT = fs.readFileSync(path.join(REPO, "host/Dockerfile"), "utf8");
const IGNORE = fs.readFileSync(path.join(REPO, "host/Dockerfile.dockerignore"), "utf8");
const NPM =
  "ADD --checksum=sha256:c80bd097147cce32e31010b791bab8c71a26a5e10668210ec9d2e7f4c7cea2a1" +
  " https://registry.npmjs.org/npm/-/npm-10.9.9.tgz /tmp/npm.tgz";

// Each stage's name and text, in order; a RUN's continuation lines joined into one.
function stages(text: string): { name: string; text: string }[] {
  return text
    .replace(/\\\n/g, " ")
    .split(/^(?=FROM\s)/m)
    .filter((part) => part.startsWith("FROM"))
    .map((part) => ({ name: /^FROM\s+\S+\s+AS\s+(\S+)/i.exec(part)?.[1] ?? "", text: part }));
}
const [image, env, ...more] = stages(TEXT);
const lines = (text: string, instruction: string) =>
  [...text.matchAll(new RegExp(`^${instruction}\\s+(.*)$`, "gm"))].map((m) => m[1] ?? "");
const install = /apt-get install -y --no-install-recommends \\\n([^;]+);/.exec(TEXT)?.[1] ?? "";

test("the mini-op Dockerfile pins its base by digest and claude-code by exact version", () => {
  assert.deepEqual(dockerfileProblems(TEXT), []);
});

test("the image installs no python3 (FR-68) and no Debian npm, but Debian's nodejs", () => {
  const packages = install.split(/\s+/).filter(Boolean);
  assert.match(install, /claude-code=/);
  assert.ok(packages.includes("nodejs"), install);
  assert.deepEqual(
    packages.filter((p) => /^(python|npm\b|node-gyp)/.test(p)),
    [],
  );
});

test("npm comes from the registry tarball pinned by sha256, linked into /usr/local/bin", () => {
  assert.ok(TEXT.includes(`${NPM}\n`), "no checksum-pinned npm 10.9.9 ADD");
  const run = image?.text ?? "";
  assert.match(run, /tar [^;]*--strip-components=1 [^;]*\/usr\/local\/lib\/node_modules\/npm/);
  for (const [bin, cli] of [
    ["npm", "npm-cli.js"],
    ["npx", "npx-cli.js"],
  ]) {
    assert.match(run, new RegExp(`ln -s \\S*node_modules/npm/bin/${cli} /usr/local/bin/${bin};`));
  }
  assert.match(run, /rm -f \/tmp\/npm\.tgz;/);
});

test("an ADD of a URL without a sha256 checksum fails", () => {
  const text = TEXT.replace(/^ADD --checksum=sha256:[0-9a-f]{64} /m, "ADD ");
  assert.match(dockerfileProblems(text).join("\n"), /ADD https:\S+npm-10\.9\.9\.tgz has no sha256/);
});

test("the image runs as agent, uid and gid 1000, not root (FR-208)", () => {
  assert.match(TEXT, /^ARG AGENT_UID=1000$/m);
  assert.match(image?.text ?? "", /useradd -m -u "\$AGENT_UID" -U -s \/bin\/bash agent;?\s/);
  assert.deepEqual(lines(TEXT, "USER"), ["agent"]);
  assert.doesNotMatch(TEXT, /\bsudo\b/);
});

test("nothing is copied or written under /home/agent: the volume hides it", () => {
  assert.doesNotMatch(TEXT, /\/home\/|~\//);
});

test("the plugin root holds plugin/, ctl/, mini/, README.md and runbooks/, never status.md", () => {
  const root = `${PLUGIN_ROOT}/`;
  assert.deepEqual(lines(image?.text ?? "", "COPY"), [
    "host/claude-code.asc /etc/apt/keyrings/claude-code.asc",
    `plugin/ ${root}`,
    `ctl/ ${root}ctl/`,
    `mini/ ${root}mini/`,
    `runbooks/ ${root}runbooks/`,
    `README.md ${root}`,
    "host/ssh_config.container /etc/ssh/ssh_config.d/mini-proxy.conf",
  ]);
  assert.doesNotMatch(TEXT, /status\.md|host\/config\b/);
  const run = image?.text ?? "";
  assert.match(run, /mv ctl\/CLAUDE\.md CLAUDE\.md;/);
  assert.match(run, /chmod -R a\+rX,go-w /);
});

test("MINI_OP_VERSION is required and stamps mini/VERSION, plugin.json and the label", () => {
  assert.match(TEXT, /^ARG MINI_OP_VERSION$/m);
  const run = image?.text ?? "";
  assert.match(run, /test -n "\$\{MINI_OP_VERSION-\}"/);
  assert.match(run, /printf '%s\\n' "\$MINI_OP_VERSION" > mini\/VERSION;/);
  assert.match(
    run,
    /jq --arg v "\$MINI_OP_VERSION" '\.version = \$v' \.claude-plugin\/plugin\.json /,
  );
  assert.deepEqual(lines(TEXT, "LABEL"), ["mini-op.version=$MINI_OP_VERSION"]);
});

test("every label key starts mini-op., none windroc. or ensemble. (FR-42)", () => {
  const keys = lines(TEXT, "LABEL").flatMap((l) => [...l.matchAll(/(?:^|\s)([^\s=]+)=/g)]);
  assert.ok(keys.length > 0);
  for (const [, key] of keys) assert.match(key ?? "", /^mini-op\./);
});

test("PATH starts with the plugin root's ctl/, mini/ stays off it, and the plugin dir is set", () => {
  const entries = /\sPATH=(\S+)/.exec(TEXT)?.[1]?.split(":") ?? [];
  assert.equal(entries[0], `${PLUGIN_ROOT}/ctl`);
  assert.deepEqual(
    entries.filter((dir) => dir.startsWith(PLUGIN_ROOT)),
    [`${PLUGIN_ROOT}/ctl`],
  );
  assert.match(TEXT, new RegExp(`\\sCLAUDE_CODE_PLUGIN_DIRS=${PLUGIN_ROOT}\\s`));
  assert.deepEqual(lines(TEXT, "WORKDIR"), [PLUGIN_ROOT]);
});

test("the last stage, env, adds the mini's ssh config from the generated context; image has none", () => {
  assert.equal(image?.name, "image");
  assert.equal(env?.name, "env");
  assert.deepEqual(more, []);
  assert.match(env?.text ?? "", /^FROM image AS env$/m);
  assert.deepEqual(lines(env?.text ?? "", "COPY"), [
    "--from=mini --chmod=0644 ssh_config /etc/ssh/ssh_config.d/mini.conf",
  ]);
  assert.doesNotMatch(image?.text ?? "", /--from=mini|mini\.conf|mini_known_hosts/);
});

test("Dockerfile.dockerignore lets in only what the image takes", () => {
  const rules = IGNORE.split("\n").filter((l) => l && !l.startsWith("#"));
  assert.equal(rules[0], "*");
  assert.deepEqual(rules.filter((r) => r.startsWith("!")).sort(), [
    "!README.md",
    "!ctl",
    "!host/claude-code.asc",
    "!host/ssh_config.*",
    "!mini",
    "!plugin",
    "!runbooks",
  ]);
  for (const excluded of ["mini/VERSION", "**/node_modules", "**/.tools"]) {
    assert.ok(rules.indexOf(excluded) > rules.indexOf("!mini"), excluded);
  }
  for (const [source] of lines(image?.text ?? "", "COPY").map((l) => l.split(" "))) {
    const top = (source ?? "").replace(/\/$/, "").split("/")[0];
    assert.ok(
      rules.some((r) => r.startsWith(`!${top}`)),
      `COPY ${source} is ignored`,
    );
  }
});

test("no shipped file or doc names the old home /home/op or the old root /opt/mini-op", () => {
  const view = fromRoot(REPO);
  const named = view.files
    .filter((f) => (isShipped(f) || f.endsWith(".md")) && !f.startsWith(SAMPLES_DIR))
    .filter((f) => /\/home\/op\b|\/opt\/mini-op\b/.test(view.read(f)));
  assert.deepEqual(named, []);
});

test("a FROM without a digest fails", () => {
  const text = TEXT.replace(/^FROM (\S+)@sha256:[0-9a-f]{64}/m, "FROM $1");
  assert.match(dockerfileProblems(text).join("\n"), /FROM .* is not pinned by digest/);
});

test("a claude-code version range or a missing pin fails", () => {
  const range = TEXT.replace(/^ARG CLAUDE_CODE_VERSION=.*$/m, "ARG CLAUDE_CODE_VERSION=2.1.*");
  assert.match(dockerfileProblems(range).join("\n"), /CLAUDE_CODE_VERSION .* is not exact/);
  const unpinned = TEXT.replace('"claude-code=${CLAUDE_CODE_VERSION}"', "claude-code");
  assert.match(dockerfileProblems(unpinned).join("\n"), /claude-code is not installed at/);
});
