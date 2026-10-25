// Sizes in non-blank chars: each line of code() is 40, each line of note() a 40-char comment.
const code = (n: number) => `${"x".repeat(40)}\n`.repeat(n);
const note = (n: number, mark: string) => `${mark} ${"c".repeat(40 - mark.length)}\n`.repeat(n);
const zsh = "#!/usr/bin/env zsh\n";

export const violation = {
  // Source: 1200 of 4000 chars, over 15% of 4000 + 500 = 1100.
  "ctl/a": zsh + note(30, "#") + code(10),
  ".github/b.ts": code(60),
  // Tests: 1000 of 4000 chars, over 10% of 4000 + 500 = 900.
  "tests/a.test.ts": note(25, "//") + code(75),
};

export const clean = {
  // Source: exactly 15% of 2000 + 500 = 800, the shebang not counted.
  "ctl/a": zsh + note(20, "#") + code(30),
  // Generated JS and non-code files are not counted.
  "mini/js/c.js": note(500, "//"),
  "README.md": note(500, "#"),
  "tests/a.test.ts": note(10, "//") + code(100),
};

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  "ctl/a:1: source comments are 1200 of 4000 chars (30.0%), over 15% + 500; this file has the most (1200)",
  "tests/a.test.ts:1: test comments are 1000 of 4000 chars (25.0%), over 10% + 500; this file has the most (1000)",
];
