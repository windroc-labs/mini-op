const stop = "debug" + "ger";

export const violation = {
  "mini/bin/a": [
    "#!/bin/zsh",
    'osascript -e \'tell application "System Events" to tell process "Terminal" to set position of window 1 to {0, 0}\'',
    'osascript -e \'tell app "System Events" to keystroke "v" using command down\'',
    'ssh mini "osascript -e \'tell app \\"Terminal\\" to do script \\"\\"\'"',
    "screencapture -x /tmp/a.png",
    "",
  ].join("\n"),
  "mini/js/b.js":
    "function run() { w.bounds = {x: 0}; se.keystroke('v', {using: 'command down'}); }\n",
  "ctl/c":
    "#!/bin/zsh\nssh mini 'SET SIZE OF window 1 to {1, 1}'\nssh mini 'tell app \"Terminal\" to set the bounds of front window to {0, 0, 9, 9}'\n",
  "tests/d.test.ts": `const x = 1;\n${stop};\nif (x) {\n  ${stop}\n}\nif (x) ${stop};\n`,
};

export const clean = {
  "mini/bin/shot": '#!/bin/zsh\n# no screencapture outside shot\nscreencapture -x "$out"\n',
  "mini/bin/a": [
    "#!/bin/zsh",
    "# never set position of a window, never keystroke … using command down",
    "osascript -e 'tell application \"System Events\" to key code 119 using command down'",
    "osascript -e 'key down command' -e 'key code 9' -e 'key up command'",
    'osascript -e \'tell app "Terminal" to do script "ls"\'',
    "",
  ].join("\n"),
  "mini/js/b.js": "function run() { if (w.size == 2) return w.position; }\n",
  "README.md": 'Never `do script ""`; never `screencapture`.\n',
  "tests/sandbox.ts": 'const FORBIDDEN = ["screencapture"];\nconst s = "a debugger b";\n',
};

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  "mini/bin/a:2: moves or resizes a window",
  "mini/bin/a:3: sends a one-shot keystroke … using … down",
  'mini/bin/a:4: sends do script "", which presses Enter',
  "mini/bin/a:5: calls screencapture; screenshots go through mini/bin/shot",
  "mini/js/b.js:1: moves or resizes a window",
  "mini/js/b.js:1: sends a one-shot keystroke … using … down",
  "ctl/c:2: moves or resizes a window",
  "ctl/c:3: moves or resizes a window",
  "tests/d.test.ts:2: has a debugger statement",
  "tests/d.test.ts:4: has a debugger statement",
  "tests/d.test.ts:6: has a debugger statement",
];
