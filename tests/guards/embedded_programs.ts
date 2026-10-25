import { lineAt, type Guard, type Violation } from "../lib/guard.ts";
import { appleScriptOffsets } from "../lib/osascript.ts";
import { isShipped, scanned, shellKind } from "../lib/repo.ts";
import { shellCode } from "../lib/shell.ts";

const PROGRAM = [/\bObjC\.\w/g, /\bApplication\s*\(/g, /\$\.NS[A-Z]\w*/g, /\bfunction\s+run\s*\(/g];
const PAGE = [
  /\bdocument\.\w/g,
  /\bwindow\.\w/g,
  /\blocation\.\w/g,
  /\bquerySelector(?:All)?\s*\(/g,
];

// The text of a shell file's quoted strings and heredoc bodies only, at their offsets.
function strings(text: string): string {
  const keep = shellCode(text, { strings: "keep" });
  const blank = shellCode(text, { strings: "blank" });
  let out = "";
  for (let i = 0; i < keep.length; i++) {
    out += keep[i] === "\n" || blank[i] !== " " ? (keep[i] === "\n" ? "\n" : " ") : (keep[i] ?? "");
  }
  return out;
}

function lines(text: string, patterns: RegExp[], offsets: number[] = []): number[] {
  const found = new Set(offsets.map((offset) => lineAt(text, offset)));
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) found.add(lineAt(text, match.index));
  }
  return [...found].sort((a, b) => a - b);
}

// FR-49, FR-58: shell strings and heredocs carry no osascript program (JXA or AppleScript) and
// no page JS: page JS is built from mini/ts/page/ and called with page_js (mini/lib/opencli.zsh).
export const guard: Guard = {
  name: "embedded_programs",
  check(view) {
    const found: Violation[] = [];
    for (const file of scanned(view)) {
      const text = view.read(file);
      if (!isShipped(file) || !shellKind(file, text)) continue;
      const quoted = strings(text);
      for (const line of lines(quoted, PROGRAM, appleScriptOffsets(quoted))) {
        const message = "embeds an osascript program in a shell string; use a mini/js program file";
        found.push({ file, line, message });
      }
      for (const line of lines(quoted, PAGE)) {
        const message = "embeds page JS in a shell string; build it in mini/ts/page/ (page_js)";
        found.push({ file, line, message });
      }
    }
    return found;
  },
};
