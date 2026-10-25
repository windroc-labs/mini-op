import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox } from "../lib/sandbox.ts";

const TOOLS = path.join(REPO, ".github/tools");
const RAW = "https://github.com/o/raw/releases/download/v1.0.0/raw_linux_amd64";
const TGZ = "https://github.com/o/tgz/releases/download/v2.0.0/tgz-linux.tar.gz";
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function setup(t: Parameters<typeof Sandbox.create>[0], os = "Linux") {
  const sb = await Sandbox.create(t);
  const src = path.join(sb.dir, "src");
  fs.mkdirSync(path.join(src, "pkg"), { recursive: true });
  fs.writeFileSync(path.join(src, "pkg/tgz"), "#!/bin/sh\necho tgz\n");
  const tarball = path.join(sb.dir, "tgz.tar.gz");
  await sb.run(["tar", "-czf", tarball, "-C", src, "pkg/tgz"]);
  const raw = Buffer.from("#!/bin/sh\necho raw\n");
  const tgz = fs.readFileSync(tarball);
  sb.fake("uname", [
    { argv: ["-s"], stdout: os + "\n" },
    { argv: ["-m"], stdout: "x86_64\n" },
  ]);
  sb.fake("curl", [
    { argv: ["-fsSL", RAW], stdoutBase64: raw.toString("base64") },
    { argv: ["-fsSL", TGZ], stdoutBase64: tgz.toString("base64") },
  ]);
  const manifest = path.join(sb.dir, "tools.tsv");
  const rows = [
    ["name", "version", "platform", "sha256", "url", "member"],
    ["raw", "v1.0.0", "linux-x64", sha(raw), RAW, "-"],
    ["raw", "v1.0.0", "darwin-arm64", "0".repeat(64), RAW, "-"],
    ["tgz", "v2.0.0", "linux-x64", sha(tgz), TGZ, "pkg/tgz"],
  ];
  fs.writeFileSync(manifest, rows.map((row) => row.join("\t")).join("\n") + "\n");
  const dest = path.join(sb.dir, "dest");
  const install = () => sb.run(["bash", TOOLS, "install", "--manifest", manifest, "--dest", dest]);
  return { sb, manifest, dest, raw, install };
}

test("installs a verified raw binary and a tarball member with stamps", async (t) => {
  const { sb, dest, raw, install } = await setup(t);
  const r = await install();
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(fs.readFileSync(path.join(dest, "bin/raw")), raw);
  assert.equal(fs.readFileSync(path.join(dest, "bin/tgz"), "utf8"), "#!/bin/sh\necho tgz\n");
  assert.equal(fs.statSync(path.join(dest, "bin/tgz")).mode & 0o777, 0o755);
  assert.match(
    fs.readFileSync(path.join(dest, "raw.version"), "utf8"),
    /^v1\.0\.0 [0-9a-f]{64}\n$/,
  );
  assert.equal(sb.calls("curl").length, 2);
});

test("a matching stamp skips the download", async (t) => {
  const { sb, install } = await setup(t);
  await install();
  const again = await install();
  assert.equal(again.code, 0);
  assert.match(again.stdout, /raw v1\.0\.0 already installed/);
  assert.equal(sb.calls("curl").length, 2);
});

test("a sha256 mismatch installs nothing and exits 1", async (t) => {
  const { manifest, dest, install } = await setup(t);
  const text = fs
    .readFileSync(manifest, "utf8")
    .replace(/\tv1\.0\.0\tlinux-x64\t[0-9a-f]+/, "\tv1.0.0\tlinux-x64\t" + "f".repeat(64));
  fs.writeFileSync(manifest, text);
  const r = await install();
  assert.equal(r.code, 1);
  assert.match(r.stderr, /tools: raw: sha256 mismatch/);
  assert.equal(fs.existsSync(path.join(dest, "bin/raw")), false);
  assert.equal(fs.existsSync(path.join(dest, "raw.version")), false);
});

test("an unsupported platform exits 1", async (t) => {
  const { install } = await setup(t, "Plan9");
  const r = await install();
  assert.equal(r.code, 1);
  assert.match(r.stderr, /tools: unsupported OS Plan9/);
});

test("usage errors exit 2 and -h prints usage", async (t) => {
  const sb = await Sandbox.create(t);
  for (const argv of [
    [],
    ["fetch"],
    ["--bogus"],
    ["install", "--dest"],
    ["install", "--dest", ""],
    ["install", "--bogus"],
  ]) {
    const r = await sb.run(["bash", TOOLS, ...argv]);
    assert.equal(r.code, 2, argv.join(" "));
    assert.equal(r.stdout, "", argv.join(" "));
    assert.equal(
      r.stderr,
      "tools: usage: tools install [--manifest <tools.tsv>] [--dest <dir>]\n",
      argv.join(" "),
    );
  }
  const help = await sb.run(["bash", TOOLS, "-h"]);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /^tools install \[--manifest <tools\.tsv>\] \[--dest <dir>\]\n/);
  assert.equal(help.stderr, "");
  // No usage error or -h runs a command: no dirname before the arguments are checked.
  const log = path.join(sb.dir, "tools.log");
  assert.ok(!(fs.existsSync(log) && /^tool: dirname$/m.test(fs.readFileSync(log, "utf8"))));
});
