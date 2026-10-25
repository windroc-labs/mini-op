import { lineAt, type Guard, type Violation } from "../lib/guard.ts";
import { isShipped, scanned, shellKind } from "../lib/repo.ts";
import { shellCode } from "../lib/shell.ts";

const SHOT = "mini/bin/shot";
// README.md › Rules and Gotchas: the user arranges the mini's windows; a one-shot chord drops its
// modifier; a raw screenshot can catch a token; an empty `do script` presses Enter.
const RULES: [RegExp, string][] = [
  [/\bset\s+(?:the\s+)?(?:position|size|bounds)\s+of\b/gi, "moves or resizes a window"],
  [/\.(?:position|size|bounds)\s*=(?!=)/g, "moves or resizes a window"],
  [/\bkeystroke\b[^\n]*\busing\b[^\n]*\bdown\b/g, "sends a one-shot keystroke … using … down"],
  [/\bdo\s+script\s+(?:\\?"){2}/g, 'sends do script "", which presses Enter'],
];
const SCREENCAPTURE = /(?<![\w.-])screencapture(?![\w.-])/g;
const DEBUGGER = new RegExp("(?<=(?:^|[;{})])\\s*)" + "debugger" + "(?=\\s*(?:;|$))", "gm");

export const guard: Guard = {
  name: "forbidden_ops",
  check(view) {
    const found: Violation[] = [];
    const at = (file: string, text: string, index: number, message: string) =>
      found.push({ file, line: lineAt(text, index), message });
    for (const file of scanned(view)) {
      const text = view.read(file);
      if (file.endsWith(".ts")) {
        for (const match of text.matchAll(DEBUGGER)) {
          at(file, text, match.index, "has a debugger statement");
        }
      }
      if (!isShipped(file)) continue;
      const code = shellKind(file, text) ? shellCode(text, { strings: "keep" }) : text;
      for (const [rule, message] of RULES) {
        for (const match of code.matchAll(rule)) at(file, code, match.index, message);
      }
      if (file !== SHOT) {
        for (const match of code.matchAll(SCREENCAPTURE)) {
          at(file, code, match.index, `calls screencapture; screenshots go through ${SHOT}`);
        }
      }
    }
    return found;
  },
};
