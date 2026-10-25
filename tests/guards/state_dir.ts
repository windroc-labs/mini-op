import { lineAt, type Guard, type Violation } from "../lib/guard.ts";

// FR-40: the mini's runtime state (markers, marks, screenshots) lives in ~/apm/state/, which
// `mini sync` keeps; nothing in mini/ uses /tmp.
const TMP = /(?<![\w.~])(?:\/private|\/var)?\/tmp(?![\w.-])/g;

export const guard: Guard = {
  name: "state_dir",
  check(view) {
    const found: Violation[] = [];
    for (const file of view.files) {
      if (!file.startsWith("mini/")) continue;
      const text = view.read(file);
      for (const match of text.matchAll(TMP)) {
        found.push({
          file,
          line: lineAt(text, match.index),
          message: "mini/ names /tmp; runtime state goes in ~/apm/state/",
        });
      }
    }
    return found;
  },
};
