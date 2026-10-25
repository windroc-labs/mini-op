const registry = JSON.stringify([
  { file: "mini/lib/chord.applescript", reason: "chords" },
  { file: "mini/lib/gone.applescript", reason: "gone" },
  { file: "mini/lib/chord2.applescript", reason: " " },
]);

export const violation = {
  "tests/registry/applescript.json": registry,
  "mini/lib/chord.applescript": 'on run argv\n  tell application "Terminal" to activate\nend run\n',
  "mini/lib/chord2.applescript": "on run argv\nend run\n",
  "mini/lib/extra.scpt": "",
  "mini/bin/a": [
    "#!/usr/bin/env zsh",
    "osascript - <<'AS'",
    "on run argv",
    '  tell app "System Events" to key down command',
    "end run",
    "AS",
    "",
  ].join("\n"),
  "ctl/b": '#!/usr/bin/env zsh\nssh mini "osascript -e \'keystroke \\"v\\"\'"\n',
  "mini/ts/c.ts": 'function run(): string {\n  return "end tell";\n}\n',
  "tests/x.applescript": "",
};

export const clean = {
  "tests/registry/applescript.json": JSON.stringify([
    { file: "mini/lib/chord.applescript", reason: "chords" },
  ]),
  "mini/lib/chord.applescript": 'on run argv\n  tell application "Terminal" to activate\nend run\n',
  "mini/ts/keys.ts": [
    "// keystroke text; key down is AppleScript's",
    "function run(): string {",
    "  se.keystroke(s);",
    "  se.keyCode(36);",
    '  se.keyCode(119, { using: "command down" });',
    '  return "keys: typed";',
    "}",
    "",
  ].join("\n"),
  "mini/bin/a":
    "#!/usr/bin/env zsh\n# on run argv: tell application\nosascript ~/apm/lib/chord.applescript\n",
  "README.md": '`tell application "System Events" to key down command`\n',
  "tests/sandbox.test.ts": "const x = 'tell application x';\n",
};

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  "tests/registry/applescript.json:1: mini/lib/gone.applescript no longer exists; remove its row",
  "tests/registry/applescript.json:1: mini/lib/chord2.applescript has no reason",
  "mini/lib/extra.scpt:1: an AppleScript file; only tests/registry/applescript.json's files may hold AppleScript",
  "tests/x.applescript:1: an AppleScript file; only tests/registry/applescript.json's files may hold AppleScript",
  "mini/bin/a:3: has AppleScript; only tests/registry/applescript.json's files may",
  "mini/bin/a:4: has AppleScript; only tests/registry/applescript.json's files may",
  "ctl/b:2: has AppleScript; only tests/registry/applescript.json's files may",
  "mini/ts/c.ts:2: has AppleScript; only tests/registry/applescript.json's files may",
];
