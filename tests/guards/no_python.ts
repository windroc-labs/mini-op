import { codeOf, lineAt, type Guard, type Violation } from "../lib/guard.ts";
import { scanned, shellKind } from "../lib/repo.ts";

// FR-67: the repo is shell and TypeScript only. Comments, docs and prose may name Python; code
// may not run it: a shell command (in a string too: ssh and sh -c run those), a TS string that is
// or starts a command, a workflow step.
const WORD = "python[0-9.]*|pip3?";
// Where a shell command starts, after any VAR=value words; the command may have a path.
const START =
  "(?:^|[;&|(`'\"!]|\\b(?:exec|env|nohup|xargs|time|then|do|else|if|while|until|sudo|command)\\s)";
const DIR = "(?:[^\\s;&|()`'\"]*/)?";
const SHELL = new RegExp(`${START}\\s*(?:\\w+=\\S*\\s+)*${DIR}(${WORD})(?![\\w.-])`, "gm");
// A TS string that is or starts a command line: an argv word, `python3 x`, `env python3 x`.
const TS = new RegExp(`["'\`](?:(?:env|exec|sudo|command)\\s+)?${DIR}(${WORD})(?=["'\`\\s])`, "g");
const WORKFLOW = new RegExp(`(?<![\\w.-])(${WORD}|actions/setup-python)(?![\\w-])`, "g");
// A script run by a Python interpreter, whatever its name.
const SHEBANG = new RegExp(`^#!\\s*\\S*?(?:/env\\s+(?:-\\S+\\s+)*)?${DIR}(${WORD})(?![\\w.-])`);

function rule(file: string, text: string): RegExp | undefined {
  if (shellKind(file, text)) return SHELL;
  if (file.endsWith(".ts")) return TS;
  if (/^\.github\/workflows\/.+\.ya?ml$/.test(file)) return WORKFLOW;
  return undefined;
}

export const guard: Guard = {
  name: "no_python",
  check(view) {
    const found: Violation[] = [];
    for (const file of scanned(view)) {
      if (/\.py[cdiw]?$/i.test(file)) {
        found.push({ file, line: 1, message: "a Python file; write shell or TypeScript" });
        continue;
      }
      const text = view.read(file);
      const shebang = SHEBANG.exec(text)?.[1];
      if (shebang) {
        found.push({ file, line: 1, message: `runs under ${shebang}; write shell or TypeScript` });
        continue;
      }
      const re = rule(file, text);
      if (!re) continue;
      const code = re === WORKFLOW ? text.replace(/(^|\s)#[^\n]*/g, "$1") : codeOf(file, text);
      for (const match of code.matchAll(re)) {
        const word = match[1] ?? "";
        // The word ends each match; what comes before it may span lines.
        const at = match.index + match[0].length - word.length;
        found.push({
          file,
          line: lineAt(code, at),
          message: `runs ${word}; write shell or TypeScript`,
        });
      }
    }
    return found;
  },
};
