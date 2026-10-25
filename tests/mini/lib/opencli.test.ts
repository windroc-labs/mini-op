import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox } from "../../lib/sandbox.ts";

const LIB = path.join(REPO, "mini/lib/opencli.zsh");

// Runs `call` in zsh after sourcing the lib, with `input` on stdin.
async function zsh(t: Parameters<typeof Sandbox.create>[0], call: string, input = "") {
  const sb = await Sandbox.create(t);
  const r = await sb.run(["zsh", "-c", `. "$1" && ${call}`, "zsh", LIB], { input });
  return { ...r, sb };
}

const data = (t: Parameters<typeof Sandbox.create>[0], reply: string) =>
  zsh(t, "opencli_data", reply);

test("opencli_data prints a string's value decoded", async (t) => {
  const cases: [string, string][] = [
    ['{"ok":true,"data":"640 300"}\n', "640 300"],
    ['{"data":"a\\"b\\\\c\\/d"}', 'a"b\\c/d'],
    ['{"ok":true,"data":"x\\ny\\tz"}\n', "x\ny\tz"],
    ['{"ok":true,"data":"a\\rb\\bc\\fd"}\n', "a\rb\bc\fd"],
    ['{"ok":true,"data":"\\u0041\\u003c/script\\u003e"}\n', "A</script>"],
    ['{"ok":true, "data": ""}\n', ""],
    [
      '{"ok":true,"data":"https://linear.app/auth/email/a@b.c/x?y=1&z=2"}\n',
      "https://linear.app/auth/email/a@b.c/x?y=1&z=2",
    ],
  ];
  for (const [reply, value] of cases) {
    const r = await data(t, reply);
    assert.equal(r.code, 0, reply + r.stderr);
    assert.equal(r.stdout, `${value}\n`, reply);
    assert.equal(r.stderr, "");
  }
});

test("opencli_data prints any other value as it is", async (t) => {
  for (const value of ["true", "false", "12", "null", '{"a":[1,2]}']) {
    const r = await data(t, `{"ok":true,"data": ${value} }\n`);
    assert.equal(r.code, 0, value);
    assert.equal(r.stdout, `${value}\n`, value);
  }
});

test("opencli_data fails with nothing printed on a reply without data", async (t) => {
  for (const reply of [
    '{"ok":false,"error":{"code":"x","message":"no tab"}}\n',
    "",
    "not json\n",
    '{"ok":true,"data":"unterminated}\n',
    '{"ok":true,"data":"bad \\q escape"}\n',
    '{"ok":true,"data":"bad \\u00zz"}\n',
  ]) {
    const r = await data(t, reply);
    assert.equal(r.code, 1, reply);
    assert.equal(r.stdout, "", reply);
  }
});

test("json_str gives a JSON string literal that decodes to the argument", async (t) => {
  const values = [
    "plain",
    "it's",
    'say "hi"',
    "</script><script>alert(1)</script>",
    "back\\slash",
    "line\nbreak\ttab\rcr",
    "a & b > c",
    "input[name='a\"b']",
    "",
  ];
  const sb = await Sandbox.create(t);
  for (const value of values) {
    const call = '. "$1" && json_str "$2" && print -r -- "$REPLY"';
    const out = await sb.run(["zsh", "-c", call, "zsh", LIB, value]);
    assert.equal(out.code, 0, value + out.stderr);
    const literal = out.stdout.slice(0, -1);
    assert.equal(JSON.parse(literal), value, literal);
    assert.doesNotMatch(literal, /[<>&\n\r\t]/, literal);
  }
});

// A copy of the lib beside a mini/js/page holding page program p.js.
function pageLib(sb: Sandbox): string {
  const root = path.join(sb.dir, "apm");
  fs.mkdirSync(path.join(root, "lib"), { recursive: true });
  fs.mkdirSync(path.join(root, "js/page"), { recursive: true });
  fs.copyFileSync(LIB, path.join(root, "lib/opencli.zsh"));
  fs.writeFileSync(
    path.join(root, "js/page/p.js"),
    "// Generated header\n(function page(a, b) {\n    return a + b;\n})\n",
  );
  return path.join(root, "lib/opencli.zsh");
}

test("page_js calls the page program with each argument as a JSON string", async (t) => {
  const sb = await Sandbox.create(t);
  const lib = pageLib(sb);
  const r = await sb.run([
    "zsh",
    "-c",
    '. "$1" && page_js p "$2" "$3"',
    "zsh",
    lib,
    "a'b",
    '"</x>',
  ]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(
    r.stdout,
    '(function page(a, b) {\n    return a + b;\n})("a\'b","\\"\\u003c/x\\u003e")\n',
  );
  const none = await sb.run(["zsh", "-c", '. "$1" && page_js p', "zsh", lib]);
  assert.equal(none.stdout, "(function page(a, b) {\n    return a + b;\n})()\n");
});

test("page_js builds the repo's page programs; an unknown one fails", async (t) => {
  const go = await zsh(t, "page_js go https://linear.app/logout");
  assert.equal(go.code, 0, go.stderr);
  assert.match(
    go.stdout,
    /^\(function page\(url\) \{\n[\s\S]*\}\)\("https:\/\/linear\.app\/logout"\)\n$/,
  );
  const none = await zsh(t, "page_js nope");
  assert.equal(none.code, 1);
  assert.equal(none.stdout, "");
  assert.equal(none.stderr, `page_js: no page program ${REPO}/mini/js/page/nope.js\n`);
});

test("page_js fails for a missing or ill-named page program", async (t) => {
  const sb = await Sandbox.create(t);
  const lib = pageLib(sb);
  for (const name of ["nope", "../lib/opencli", ""]) {
    const r = await sb.run(["zsh", "-c", '. "$1" && page_js "$2" x', "zsh", lib, name]);
    assert.equal(r.code, 1, name);
    assert.equal(r.stdout, "", name);
    assert.match(r.stderr, /^page_js: no page program /, name);
  }
});
