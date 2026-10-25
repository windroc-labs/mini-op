export const violation = {
  "mini/bin/a": [
    "#!/usr/bin/env zsh",
    `ssh mini 'osascript -l JavaScript -e "ObjC.import(\\"Foundation\\");function run(){}"'`,
    "cat <<'JS' | ssh mini 'osascript -l JavaScript -'",
    'Application("System Events").keystroke("v")',
    "JS",
    "o eval \"document.querySelector('#x').value\"",
    "",
  ].join("\n"),
  "ctl/b": '#!/usr/bin/env zsh\nssh mini "osascript -e \'tell app \\"Terminal\\" to activate\'"\n',
  "mini/bin/page": '#!/usr/bin/env zsh\no eval "location.href"\n',
};

export const clean = {
  "mini/bin/a": [
    "#!/usr/bin/env zsh",
    "# ObjC.import and document.title are fine in a comment",
    "osascript -l JavaScript ~/apm/js/keys.js --enter",
    'echo "Application support: done"',
    "",
  ].join("\n"),
  "mini/bin/page": '#!/usr/bin/env zsh\no eval "$(page_js where)" | opencli_data\n',
  "mini/ts/page/where.ts": "function page(): string {\n  return location.href;\n}\n",
  "mini/ts/keys.ts": 'ObjC.import("Foundation");\nfunction run(): string {\n  return "";\n}\n',
  "tests/x.test.ts": "const s = 'ObjC.import(\"x\")';\n",
};

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  "mini/bin/a:2: embeds an osascript program in a shell string; use a mini/js program file",
  "mini/bin/a:4: embeds an osascript program in a shell string; use a mini/js program file",
  "mini/bin/a:6: embeds page JS in a shell string; build it in mini/ts/page/ (page_js)",
  "ctl/b:2: embeds an osascript program in a shell string; use a mini/js program file",
  "mini/bin/page:2: embeds page JS in a shell string; build it in mini/ts/page/ (page_js)",
];
