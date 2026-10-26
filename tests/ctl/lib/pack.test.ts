import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox } from "../../lib/sandbox.ts";

const HELPER = path.join(REPO, "ctl/lib/pack.zsh");
const run = 'source "$1" && shift && pack_tar "$@"';

for (const [version, extra] of [
  ["bsdtar 3.5.3 - libarchive 3.7.4", ["--no-mac-metadata"]],
  ["tar (GNU tar) 1.35", []],
] as const) {
  test(`pack_tar on ${version.split(" ")[0]}: --no-xattrs, COPYFILE_DISABLE=1`, async (t) => {
    const sb = await Sandbox.create(t);
    sb.fake("tar", [
      { argv: ["--version"], stdout: `${version}\n` },
      { argv: ["--no-xattrs"], stdout: "packed\n" },
    ]);
    const r = await sb.run(["zsh", "-fc", run, "zsh", HELPER, "-cf", "-", "-C", "/d", "."]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, "packed\n");
    const call = sb.calls("tar").at(-1);
    assert.deepEqual(call?.argv, ["--no-xattrs", ...extra, "-cf", "-", "-C", "/d", "."]);
    assert.equal(call?.env.COPYFILE_DISABLE, "1");
  });
}

test("pack_tar passes tar's failure on", async (t) => {
  const sb = await Sandbox.create(t);
  sb.fake("tar", [{ argv: ["--version"], stdout: "tar (GNU tar) 1.35\n" }, { exit: 2 }]);
  const r = await sb.run(["zsh", "-fc", run, "zsh", HELPER, "-cf", "x.tar", "."]);
  assert.equal(r.code, 2);
});

test("ctl/mini and ctl/runbook leave the tar flags to pack_tar", () => {
  for (const file of ["ctl/mini", "ctl/runbook"]) {
    const text = fs.readFileSync(path.join(REPO, file), "utf8");
    assert.match(text, /^source \$\{0:A:h\}\/lib\/pack\.zsh$/m, file);
    for (const flag of ["--no-xattrs", "--no-mac-metadata", "COPYFILE_DISABLE"]) {
      assert.ok(!text.includes(flag), `${file} names ${flag}`);
    }
  }
});
