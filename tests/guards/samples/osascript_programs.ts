const registry = JSON.stringify([{ file: "mini/lib/chord.applescript", reason: "chords" }]);
const files = {
  "tests/registry/applescript.json": registry,
  "mini/lib/chord.applescript": "on run argv\nend run\n",
  "mini/lib/other.applescript": "on run argv\nend run\n",
  "mini/js/keys.js": "function run() {}\n",
};

export const violation = {
  ...files,
  "mini/bin/a": [
    "#!/usr/bin/env zsh",
    "osascript -e 'tell app \"Finder\" to activate'",
    "osascript - <<'AS'",
    "x",
    "AS",
    "osascript -l JavaScript ~/apm/js/none.js",
    "osascript ~/apm/js/keys.js --enter",
    "osascript -l JavaScript /tmp/x.js",
    "x=$(osascript)",
    "",
  ].join("\n"),
  "ctl/b": [
    "#!/usr/bin/env zsh",
    "ssh mini 'with_timeout 1 osascript -l JavaScript -e \"function run(){}\"'",
    'ssh mini "osascript ~/apm/lib/other.applescript"',
    "",
  ].join("\n"),
};

export const clean = {
  ...files,
  "mini/bin/a": [
    "#!/usr/bin/env zsh",
    "# never osascript -e here",
    "osascript -l JavaScript ~/apm/js/keys.js --enter </dev/null",
    'print -rn -- x | osascript -l JavaScript "$HOME/apm/js/keys.js" --secret',
    "osascript -l JavaScript ${HOME}/apm/js/keys.js 2>/dev/null | tail -1",
    "",
  ].join("\n"),
  "ctl/b": [
    "#!/usr/bin/env zsh",
    "ssh mini 'with_timeout 15 osascript -l JavaScript ~/apm/js/keys.js --enter'",
    'ssh mini "with_timeout 10 osascript ~/apm/lib/chord.applescript $1 $2"',
    "",
  ].join("\n"),
  "README.md": "By hand: `osascript -e 'set the clipboard to x'`.\n",
  "tests/x.test.ts": 'run(["osascript", "-e", "x"]);\n',
};

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  "mini/bin/a:2: runs an inline program (osascript -e); run a mini/js program file",
  "mini/bin/a:3: runs a program from stdin; run a mini/js program file",
  "mini/bin/a:6: runs ~/apm/js/none.js, not a mini/js program or registered AppleScript file",
  "mini/bin/a:7: runs ~/apm/js/keys.js without -l JavaScript",
  "mini/bin/a:8: runs /tmp/x.js, not a mini/js program or registered AppleScript file",
  "mini/bin/a:9: runs a program from stdin; run a mini/js program file",
  "ctl/b:2: runs an inline program (osascript -e); run a mini/js program file",
  "ctl/b:3: runs ~/apm/lib/other.applescript, not a mini/js program or registered AppleScript file",
];
