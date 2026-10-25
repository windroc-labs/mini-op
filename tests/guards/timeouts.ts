import { lineAt, unique, type Guard, type Violation } from "../lib/guard.ts";
import { scanned } from "../lib/repo.ts";

// FR-53: mini/lib/timeout.zsh is the one timeout wrapper (with_timeout) and poll helper, so only
// mini/lib/ may name perl's timer; docs and tests included (D7). Built from parts so this file
// never matches itself.
const WORD = "al" + "arm";
const NAMED = new RegExp(`\\b${WORD}\\b`, "gi");
const HOME = "mini/lib/";

export const guard: Guard = {
  name: "timeouts",
  check(view) {
    const found: Violation[] = [];
    const message = `names ${WORD}; time out with with_timeout or poll (mini/lib/timeout.zsh, exit 124)`;
    for (const file of scanned(view)) {
      if (file.startsWith(HOME)) continue;
      const text = view.read(file);
      for (const match of text.matchAll(NAMED)) {
        found.push({ file, line: lineAt(text, match.index), message });
      }
    }
    return unique(found);
  },
};
