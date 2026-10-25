import assert from "node:assert/strict";
import { test } from "node:test";
import { appleScriptOffsets, osascriptProgram } from "./osascript.ts";

test("osascriptProgram finds the program file after the options", () => {
  assert.deepEqual(osascriptProgram(["-l", "JavaScript", "/a/keys.js", "--enter"]), {
    program: "keys.js",
    file: "/a/keys.js",
    inline: false,
    language: "JavaScript",
    rest: ["--enter"],
  });
  assert.deepEqual(osascriptProgram(["-s", "o", "--", "-x.scpt", "a"]), {
    program: "-x.scpt",
    file: "-x.scpt",
    inline: false,
    language: "AppleScript",
    rest: ["a"],
  });
  assert.deepEqual(osascriptProgram(["-e", "keys.js", "x"]), {
    inline: true,
    language: "AppleScript",
    rest: ["x"],
  });
  assert.deepEqual(osascriptProgram(["-"]), {
    inline: false,
    language: "AppleScript",
    rest: ["-"],
  });
  assert.deepEqual(osascriptProgram([]), { inline: false, language: "AppleScript", rest: [] });
});

test("osascriptProgram reports inline and language", () => {
  const facts = (args: string[]) => {
    const { inline, language } = osascriptProgram(args);
    return { inline, language };
  };
  assert.deepEqual(facts(["-e", 'tell app "T" to activate']), {
    inline: true,
    language: "AppleScript",
  });
  assert.deepEqual(facts(["-l", "JavaScript", "-e", "1"]), {
    inline: true,
    language: "JavaScript",
  });
  assert.deepEqual(facts(["-l", "JavaScript", "/a/keys.js"]), {
    inline: false,
    language: "JavaScript",
  });
  assert.deepEqual(facts(["/a/chord.applescript", "command", "9"]), {
    inline: false,
    language: "AppleScript",
  });
});

const applescript = (text: string) => appleScriptOffsets(text).length > 0;

test("appleScriptOffsets matches AppleScript syntax and not JXA calls", () => {
  for (const text of [
    'tell application "Terminal" to activate',
    "TELL APP x",
    "end tell",
    "on run argv",
    "key down command",
    "key code 36",
    'keystroke "v"',
  ]) {
    assert.ok(applescript(text), text);
  }
  for (const text of [
    "se.keystroke(s)",
    "se.keyCode(36)",
    "keystroke (s)",
    "telling",
    "a.keyDown",
    "usage: x <key code>",
  ]) {
    assert.ok(!applescript(text), text);
  }
});

test("appleScriptOffsets gives each match's offset, in order", () => {
  assert.deepEqual(appleScriptOffsets('tell application "T"\nend tell'), [0, 21]);
  assert.deepEqual(appleScriptOffsets("x\nkey code 36\nx"), [2]);
  assert.deepEqual(appleScriptOffsets("se.keyCode(36)"), []);
});

test("appleScriptOffsets is stateless across calls", () => {
  const a = 'tell app "T"\n  keystroke "v"\nend tell';
  const b = 'x\ntell application "Terminal"';
  const first = appleScriptOffsets(a);
  assert.deepEqual(appleScriptOffsets(a), first);
  assert.deepEqual(appleScriptOffsets(b), [2]);
  assert.deepEqual(appleScriptOffsets(a), first);
  assert.deepEqual(appleScriptOffsets(""), []);
  assert.deepEqual(appleScriptOffsets(b), [2]);
  assert.deepEqual(first, [0, 15, 29]);
});
