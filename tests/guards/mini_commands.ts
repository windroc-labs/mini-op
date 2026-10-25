import { codeOf, lineAt, type Guard, type Violation } from "../lib/guard.ts";

// The mini runs only macOS's own commands plus opencli (runbooks/setup-test-env.md): calling
// python3 on a blank mini pops the Command Line Tools installer, and nothing gets installed there.
const BANNED = /(?<![\w.-])(python3?|node|npm|npx|brew|pip3?)(?![\w-])|\/opt\/homebrew\b/g;

// Comments say what not to call; code (strings included: they run too) must not call it.
export const guard: Guard = {
  name: "mini_commands",
  check(view) {
    const found: Violation[] = [];
    for (const file of view.files) {
      if (!file.startsWith("mini/")) continue;
      const text = codeOf(file, view.read(file));
      for (const match of text.matchAll(BANNED)) {
        const what = match[1] ?? match[0];
        found.push({
          file,
          line: lineAt(text, match.index),
          message: `calls ${what}; the mini runs only macOS's own commands and opencli`,
        });
      }
    }
    return found;
  },
};
