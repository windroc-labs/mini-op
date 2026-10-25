import { lineAt, type Guard, type Violation } from "../lib/guard.ts";
import { isShipped, scanned } from "../lib/repo.ts";

// FR-34: the secret patterns live only in mini/lib/secrets.zsh; code picks them there by key.
// Docs and tests may name them. Built from parts so this file never matches itself.
const LIB = "mini/lib/secrets.zsh";
const PATTERN = new RegExp(
  ["sk-" + "ant-", "lin_" + "api_", "gh\\[pousr\\]" + "_", "(?<![A-Za-z0-9])gh[pousr]" + "_"]
    .concat(["github_" + "pat_", "PRIVATE " + "KEY"])
    .join("|"),
  "g",
);

function code(file: string): boolean {
  if (file.endsWith(".md") || file === LIB) return false;
  return isShipped(file) || file.startsWith(".github/") || file.startsWith(".githooks/");
}

export const guard: Guard = {
  name: "secret_patterns",
  check(view) {
    const found: Violation[] = [];
    for (const file of scanned(view).filter(code)) {
      const text = view.read(file);
      for (const match of text.matchAll(PATTERN)) {
        found.push({
          file,
          line: lineAt(text, match.index),
          message: `holds secret pattern ${match[0]}; use ${LIB}`,
        });
      }
    }
    return found;
  },
};
