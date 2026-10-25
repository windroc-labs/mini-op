const zsh = "#!/usr/bin/env zsh\n";
const block = (tag: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${tag}${i} --flag`).join("\n") + "\n";
const registry = (rows: object[]) => JSON.stringify(rows);

export const violation = {
  "tests/registry/duplicates.json": registry([
    { file: "ctl/b", repeats: "ctl/a", text: "a0 --flag", reason: "" },
    { file: "ctl/d", repeats: "ctl/c", text: "gone", reason: "no longer shared" },
  ]),
  "ctl/a": zsh + block("a", 6),
  "ctl/b": zsh + "# b\n" + block("a", 6),
  "host/e": "#!/usr/bin/env bash\n" + block("e", 6),
  "mini/bin/f": zsh + "f\n" + block("e", 7),
  // A block twice in one file and once in another: one report.
  "ctl/g": zsh + block("g", 6) + "x\n" + block("g", 6),
  "ctl/h": zsh + block("g", 6),
  // One region of 8 shared lines, in a different layout and with its own comments.
  "mini/ts/x.ts": "let a = 0;\n" + block("x", 8),
  "tests/y.test.ts": "{\n" + block("x", 8).replace(/\n/g, "  // note\n\n"),
};

export const clean = {
  "tests/registry/duplicates.json": registry([
    { file: "ctl/b", repeats: "ctl/a", text: "a0 --flag", reason: "the same preamble" },
  ]),
  "ctl/a": zsh + block("a", 6),
  "ctl/b": zsh + block("a", 6),
  // Five shared lines, shared imports, generated JS and docs do not count.
  "mini/ts/x.ts": block("x", 5) + "x();\n",
  "tests/y.test.ts": block("x", 5) + "y();\n",
  "tests/i.test.ts": block("i", 6).replace(/^/gm, "import "),
  "tests/j.test.ts": block("i", 6).replace(/^/gm, "import "),
  "mini/js/x.js": block("x", 8),
  "README.md": block("x", 8),
};

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  "ctl/h:2: repeats ctl/g:2 for 6 lines; share it, or register it in tests/registry/duplicates.json with a reason",
  "mini/bin/f:3: repeats host/e:2 for 6 lines; share it, or register it in tests/registry/duplicates.json with a reason",
  "tests/y.test.ts:2: repeats mini/ts/x.ts:2 for 8 lines; share it, or register it in tests/registry/duplicates.json with a reason",
  "tests/registry/duplicates.json:1: ctl/b repeating ctl/a has no reason",
  'tests/registry/duplicates.json:1: ctl/d no longer repeats ctl/c from "gone"',
];
