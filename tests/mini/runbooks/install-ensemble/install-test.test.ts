import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox } from "../../../lib/sandbox.ts";
import { UNSAFE_REFS } from "../ref-cases.ts";

const INSTALL_TEST = path.join(REPO, "mini/runbooks/install-ensemble/install-test");
const URL = (ref: string) =>
  `https://raw.githubusercontent.com/windroc-labs/ensemble/${ref}/scripts/install.sh`;
const OC = [
  "--opencode-provider",
  "strata",
  "--opencode-url",
  "http://192.168.1.40:8080/v1",
  "--opencode-model",
  "qwen3.8-flash-next",
  "--opencode-context",
  "204800",
];

// The fake curl serves an install.sh that writes the args it got to ~/args and exits `rc`.
async function sandbox(t: Parameters<typeof Sandbox.create>[0], rc = 0) {
  const sb = await Sandbox.create(t);
  sb.fake("curl", [{ stdout: `printf '%s\\n' "$0" "$@" > "$HOME/args"\nexit ${rc}\n` }]);
  const args = () => {
    const file = path.join(sb.home, "args");
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").slice(0, -1) : null;
  };
  const run = (argv: string[], env: Record<string, string> = {}) =>
    sb.run(["zsh", INSTALL_TEST, ...argv], { env });
  return { sb, args, run };
}

test("runs main's install.sh with --ref main and only the flags after --", async (t) => {
  const { sb, args, run } = await sandbox(t);
  const r = await run(["--", "--docker", "--board", "local"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "install.sh exited 0\n");
  assert.equal(r.stderr, "");
  assert.deepEqual(
    sb.calls("curl").map((c) => c.argv),
    [["-fsSL", URL("main")]],
  );
  assert.deepEqual(args(), ["install.sh", "--ref", "main", "--docker", "--board", "local"]);
});

test("REF, CLIENTS and OC pick the ref, the clients and the Strata OpenCode flags", async (t) => {
  const { sb, args, run } = await sandbox(t);
  const r = await run(["--"], { REF: "feature-x", CLIENTS: "claude,opencode", OC: "1" });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "install.sh exited 0\n");
  assert.deepEqual(
    sb.calls("curl").map((c) => c.argv.at(-1)),
    [URL("feature-x")],
  );
  assert.deepEqual(args(), [
    "install.sh",
    "--ref",
    "feature-x",
    "--clients",
    "claude,opencode",
    ...OC,
  ]);
});

test("--ref selects a branch or commit for both download and installer", async (t) => {
  for (const ref of ["feature/visible", "1fc016e7f878ab197b6f73902795c9ab935b057c"]) {
    const { sb, args, run } = await sandbox(t);
    const r = await run(["--ref", ref, "--", "--clients", "opencode"], { REF: "ignored" });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(sb.calls("curl")[0]?.argv.at(-1), URL(ref));
    assert.deepEqual(args(), ["install.sh", "--ref", ref, "--clients", "opencode"]);
  }
});

test("CLI and REF cannot escape the ensemble repository or supply URL metacharacters", async (t) => {
  const { sb, run } = await sandbox(t);
  for (const ref of UNSAFE_REFS) {
    for (const envMode of [false, true]) {
      const r = await run(envMode ? [] : ["--ref", ref], envMode ? { REF: ref } : {});
      assert.equal(r.code, 2, `${ref} via ${envMode ? "REF" : "CLI"}`);
    }
  }
  assert.deepEqual(sb.calls("curl"), []);
});

// FR-56: a copy of install-test beside its own strata.conf, so a test can change the settings.
function copy(sb: Sandbox, conf: string | null): string {
  const dir = path.join(sb.dir, "copy");
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(INSTALL_TEST, path.join(dir, "install-test"));
  if (conf !== null) fs.writeFileSync(path.join(dir, "strata.conf"), conf);
  return dir;
}

test("OC takes the Strata URL, model and context from strata.conf", async (t) => {
  const { sb, args } = await sandbox(t);
  const conf = "# settings\nurl=http://10.0.0.9:9/v1?a=b\nmodel=other-model\ncontext=1024";
  const dir = copy(sb, conf);
  const r = await sb.run(["zsh", path.join(dir, "install-test")], { env: { OC: "1" } });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(args(), [
    "install.sh",
    "--ref",
    "main",
    "--opencode-provider",
    "strata",
    "--opencode-url",
    "http://10.0.0.9:9/v1?a=b",
    "--opencode-model",
    "other-model",
    "--opencode-context",
    "1024",
  ]);
});

test("a strata.conf missing a setting, or none, exits 1 under OC and fetches nothing", async (t) => {
  for (const [conf, problem] of [
    ["url=http://x/v1\nmodel=m\n", "has no context"],
    ["url=http://x/v1\ncontext=1\nmodel=\n", "has no model"],
    [null, "cannot be read"],
  ] as const) {
    const { sb } = await sandbox(t);
    const dir = copy(sb, conf);
    const r = await sb.run(["zsh", path.join(dir, "install-test")], { env: { OC: "1" } });
    assert.equal(r.code, 1, problem);
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, `install-test: ${dir}/strata.conf ${problem}; ran nothing\n`);
    assert.deepEqual(sb.calls("curl"), []);
  }
});

test("without OC, strata.conf is not read", async (t) => {
  const { sb, args } = await sandbox(t);
  const r = await sb.run(["zsh", path.join(copy(sb, null), "install-test")]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(args(), ["install.sh", "--ref", "main"]);
});

test("install.sh exiting non-zero exits 1 with its rc on stdout", async (t) => {
  const { args, run } = await sandbox(t, 3);
  const r = await run([]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "install.sh exited 3\n");
  assert.equal(r.stderr, "");
  assert.deepEqual(args(), ["install.sh", "--ref", "main"]);
});

test("a failed download exits 1 and runs nothing", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("curl", [{ stderr: "curl: (22) The requested URL returned error: 404\n", exit: 22 }]);
  const r = await sb.run(["zsh", INSTALL_TEST, "--", "--docker"], { env: { REF: "gone" } });
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(
    r.stderr,
    `curl: (22) The requested URL returned error: 404\ninstall-test: cannot fetch ${URL("gone")}; ran nothing\n`,
  );
  assert.ok(!fs.existsSync(path.join(sb.home, "args")));
});

test("flags before -- and stray words are usage errors that fetch nothing", async (t) => {
  const { sb, run } = await sandbox(t);
  for (const argv of [
    ["--docker"],
    ["--no-such-option"],
    ["-x", "--"],
    ["x"],
    ["-h", "x"],
    ["--ref"],
    ["--ref", ""],
    ["--ref", "--docker"],
  ]) {
    const r = await run(argv);
    assert.equal(r.code, 2, argv.join(" "));
    assert.equal(
      r.stderr,
      "install-test: usage: install-test [--ref <ref>] [-- <install.sh flags>]\n",
    );
    assert.equal(r.stdout, "");
  }
  assert.deepEqual(sb.calls(), []);
});

test("-h prints the usage to stdout and fetches nothing", async (t) => {
  const { sb, run } = await sandbox(t);
  const r = await run(["-h"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, "");
  assert.match(r.stdout, /^install-test \[--ref <ref>\] \[-- <install\.sh flags>\] /);
  assert.deepEqual(sb.calls(), []);
});
