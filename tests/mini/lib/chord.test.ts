import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { REPO } from "../../lib/sandbox.ts";

// AppleScript cannot run here: these read chord.applescript's text. osascript compiles it against
// the running macOS's terminology, so a plain-word handler or parameter name can become a
// dictionary term on a new release (WDRC-289: -1750 at `press(…)` on macOS 27.2).
const PROGRAM = fs.readFileSync(path.join(REPO, "mini/lib/chord.applescript"), "utf8");
const code = PROGRAM.split("\n").filter((line) => !/^\s*--/.test(line));
const handlers = [...PROGRAM.matchAll(/^on (\w+)\(([^)]*)\)/gm)].map((m) => ({
  name: m[1],
  params: m[2].split(",").map((p) => p.trim()),
}));

test("chord.applescript's handlers and their parameters are camelCase", () => {
  assert.ok(handlers.length > 0);
  for (const { name, params } of handlers) {
    for (const id of [name, ...params]) assert.match(id, /^[a-z]+[A-Z]\w*$/, id);
  }
});

test("chord.applescript calls its handlers with my", () => {
  for (const { name } of handlers) {
    const calls = code.filter(
      (line) => new RegExp(`\\b${name}\\(`).test(line) && !/^on /.test(line),
    );
    assert.ok(calls.length > 0, name);
    for (const line of calls) assert.match(line, new RegExp(`\\bmy ${name}\\(`), line);
  }
});

test("chord.applescript releases the pressed modifiers after the try, then re-raises", () => {
  const at = (re: RegExp) => code.findIndex((line) => re.test(line));
  const keyDown = at(/my \w+\(modName, true\)/);
  const endTry = code.findLastIndex((line) => /^\tend try$/.test(line));
  const release = at(/^\tset failure to my releaseModifiers\(pressed, failure\)$/);
  const reraise = at(/^\tif failure is not missing value then error /);
  assert.ok(keyDown > 0 && keyDown < endTry, "the key downs run inside the try");
  assert.ok(endTry < release && release < reraise, "release after the try, then re-raise");
  assert.ok(at(/set end of pressed to modName/) < keyDown, "recorded before its key down");
});

// mini chord's separate release after a killed chord: key up only, nothing activated or pressed.
test("chord.applescript's --release form checks every name, then only releases", () => {
  const start = code.findIndex((line) => /^\tif item 1 of argv is "--release" then$/.test(line));
  const end = code.findIndex((line, i) => i > start && /^\tend if$/.test(line));
  assert.ok(start > 0 && end > start, "a --release block");
  assert.ok(end < code.findIndex((line) => /activate/.test(line)), "before Terminal is raised");
  const block = code.slice(start, end + 1).join("\n");
  assert.match(block, /my releaseModifiers\(my modifierList\(item 2 of argv\), missing value\)/);
  assert.match(block, /return "chord: released " & /);
  assert.doesNotMatch(block, /activate|key code|key down|, true\)/);
  const body = (name: string) =>
    PROGRAM.slice(PROGRAM.indexOf(`on ${name}(`), PROGRAM.indexOf(`end ${name}`));
  assert.match(
    body("modifierList"),
    /does not contain \(m as text\) then error "chord: unknown modifier "/,
  );
  assert.match(
    body("releaseModifiers"),
    /my setModifier\(\(item i of modifierNames\) as text, false\)/,
  );
  assert.doesNotMatch(body("releaseModifiers"), /, true\)|key down/);
});
