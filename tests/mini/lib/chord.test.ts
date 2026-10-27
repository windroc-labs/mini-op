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
  const release = at(/^\trepeat with i from \(count of pressed\) to 1 by -1$/);
  const reraise = at(/^\tif failure is not missing value then error /);
  assert.ok(keyDown > 0 && keyDown < endTry, "the key downs run inside the try");
  assert.ok(endTry < release && release < reraise, "release after the try, then re-raise");
  assert.ok(at(/set end of pressed to modName/) < keyDown, "recorded before its key down");
});
