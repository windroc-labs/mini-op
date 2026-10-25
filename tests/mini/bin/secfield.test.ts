import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { Page } from "../../lib/page.ts";
import { REPO, Sandbox, type FakeRule } from "../../lib/sandbox.ts";

const SECFIELD = path.join(REPO, "mini/bin/secfield");

// The page answers field.js's ops from files in the sandbox dir: xy (the field's screen point,
// empty: not found) and focus (true once the click put the focus there).
const PAGE = `case $2 in
  *'})("point",'*) print -r -- "{\\"ok\\":true,\\"data\\":\\"$(<$FAKE_DIR/xy)\\"}";;
  *'})("focused",'*) print -r -- "{\\"ok\\":true,\\"data\\":$(<$FAKE_DIR/focus)}";;
  *'})("length",'*) print -r -- '{"ok":true,"data":12}';;
esac`;

const TYPED: FakeRule = {
  program: "keys.js",
  args: ["--secret"],
  stdout: "keys: typed the secret\n",
};
const REFUSED: FakeRule = {
  program: "keys.js",
  stderr: "keys: typing failed; the secret may be partly typed\n",
  exit: 1,
};

async function sandbox(
  t: Parameters<typeof Sandbox.create>[0],
  xy: string,
  focus: string,
  keys = TYPED,
) {
  const sb = await Sandbox.create(t);
  fs.writeFileSync(path.join(sb.dir, "xy"), xy);
  fs.writeFileSync(path.join(sb.dir, "focus"), focus);
  sb.fake("o", [{ argv: ["eval"], shell: PAGE }]);
  fs.mkdirSync(path.join(sb.home, "apm/bin"), { recursive: true });
  fs.symlinkSync(path.join(sb.dir, "bin/o"), path.join(sb.home, "apm/bin/o"));
  sb.fake("osascript", [
    { program: "chrome.js", args: ["activate"], stdout: "activated\n" },
    { program: "click.js", stdout: "clicked\n" },
    keys,
  ]);
  sb.fake("sleep", [{}]);
  const run = (args = ["role", "#pw"], input = `${sb.canary}\n`) =>
    sb.run(["zsh", SECFIELD, ...args], { input });
  return { sb, run };
}

test("the secret reaches only keys.js's stdin once a real click focused the field", async (t) => {
  const { sb, run } = await sandbox(t, "640 300", "true");
  const r = await run();
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "secfield: #pw filled, 12 chars\n");
  const programs = sb.calls("osascript").map((c) => [c.program, ...c.argv.slice(-2)]);
  assert.deepEqual(programs[1], ["click.js", "640", "300"]);
  const keys = sb.calls("osascript").filter((c) => c.program === "keys.js");
  assert.deepEqual(
    keys.map((c) => c.stdin),
    [sb.canary],
  );
  for (const call of sb.calls()) {
    assert.ok(!call.argv.join(" ").includes(sb.canary), call.cmd);
    assert.ok(!Object.values(call.env).some((v) => v.includes(sb.canary)), call.cmd);
    if (call.program !== "keys.js") assert.ok(!call.stdin.includes(sb.canary), call.cmd);
  }
  assert.ok(!(r.stdout + r.stderr).includes(sb.canary));
});

test("a keys.js failure exits 1 without reporting the field filled", async (t) => {
  const { sb, run } = await sandbox(t, "640 300", "true", REFUSED);
  const r = await run();
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /^keys: typing failed.*\nsecfield: typing into #pw failed\n$/);
  const evals = sb.calls("o").map((c) => c.argv[1] ?? "");
  assert.ok(!evals.some((js) => js.includes('("length",')), evals.join("\n"));
  for (const call of sb.calls()) {
    assert.ok(!call.argv.join(" ").includes(sb.canary), call.cmd);
    assert.ok(!Object.values(call.env).some((v) => v.includes(sb.canary)), call.cmd);
  }
  assert.ok(!(r.stdout + r.stderr).includes(sb.canary));
});

test("an empty secret line is refused through keys.js", async (t) => {
  const { sb, run } = await sandbox(t, "640 300", "true", {
    ...REFUSED,
    stderr: "keys: empty secret; typed nothing\n",
  });
  const r = await run(["role", "#pw"], "\n");
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /secfield: typing into #pw failed\n$/);
  assert.deepEqual(
    sb
      .calls("osascript")
      .filter((c) => c.program === "keys.js")
      .map((c) => c.stdin),
    [""],
  );
});

test("a field that is not found or not focused gets nothing typed", async (t) => {
  for (const [xy, focus, message] of [
    ["", "true", "secfield: #pw not found\n"],
    ["640 300", "false", "secfield: focus not on #pw (page focus: false); typed nothing\n"],
  ]) {
    const { sb, run } = await sandbox(t, xy ?? "", focus ?? "");
    const r = await run();
    assert.equal(r.code, 1);
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, message);
    assert.deepEqual(
      sb.calls("osascript").filter((c) => c.program === "keys.js"),
      [],
    );
  }
});

// FR-58: the selector reaches the page as a JSON string, never as code: one holding quotes and
// </script> still finds exactly its field, and the page runs nothing else.
test("a selector with quotes and </script> is data in the page code, not code", async (t) => {
  const css = `input[name='a"b</script><script>alert(1)</script>']`;
  const { sb, run } = await sandbox(t, "640 300", "true");
  const r = await run(["role", css]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, `secfield: ${css} filled, 12 chars\n`);
  const evals = sb.calls("o").map((c) => c.argv);
  assert.deepEqual(
    evals.map((argv) => [argv[0], ...argv.slice(2)]),
    Array(3).fill(["eval", "--session", "role"]),
  );
  const scene = {
    elements: [
      { selectors: ["input"], value: "x" },
      { selectors: [css], rect: { left: 10, top: 10, width: 20, height: 20 }, value: "secret12" },
    ],
    focus: 1,
  };
  const values = evals.map((argv) => Page.run(argv[1] ?? "", scene));
  assert.deepEqual(
    values.map((v) => v.value),
    ["20 120", true, 8],
  );
  assert.deepEqual(
    values.flatMap((v) => v.page.events),
    [{ type: "scroll", element: 1, block: "center" }],
  );
});

test("anything but a session and a selector is a usage error", async (t) => {
  const { sb, run } = await sandbox(t, "1 1", "true");
  for (const args of [["role"], ["--no-such-option"], ["-x", "#pw"], ["role", "-x"], ["-h", "x"]]) {
    const r = await run(args);
    assert.equal(r.code, 2, args.join(" "));
    assert.equal(r.stderr, "secfield: usage: secfield <session> <css>\n", args.join(" "));
    assert.equal(r.stdout, "");
  }
  assert.deepEqual(sb.calls(), []);
});

test("-h prints the usage to stdout and calls nothing", async (t) => {
  const sb = await Sandbox.create(t);
  const r = await sb.run(["zsh", SECFIELD, "-h"], { input: "probe\n" });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, "");
  assert.match(r.stdout, /^secfield <session> <css> /);
  assert.deepEqual(sb.calls(), []);
});
