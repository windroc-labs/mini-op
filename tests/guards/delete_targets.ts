import { commandName, repoArgv, repoCommands } from "../lib/commands.ts";
import { unique, type Guard, type Violation } from "../lib/guard.ts";

// FR-37: what rm, rmdir and find -delete remove is a literal path or built only on ${VAR:?…},
// so an unset variable stops the shell instead of widening the delete.
const DELETE = "-" + "delete";
const GUARDED = /\$\{[A-Za-z_][A-Za-z0-9_]*:\?[^}]*\}/g;

// Whether a target word is literal, or literal text around ${VAR:?…} expansions only. In a view
// the outer shell expands (a double-quoted ssh string), single quotes protect nothing.
function safe(word: string, expands: boolean): boolean {
  const rest = (expands ? word : word.replace(/'[^']*'/g, "")).replace(GUARDED, "");
  return !/[$`]/.test(rest);
}

// The paths a delete command removes, or none when it deletes nothing.
function targets(name: string, words: string[]): string[] {
  if (name === "find") {
    if (!words.includes(DELETE)) return [];
    // find's own options (GNU and macOS) before the paths; macOS -f <path> names a path too.
    const paths: string[] = [];
    let i = 0;
    for (; /^-(?:[HLPEXdsx]+|f)$/.test(words[i] ?? ""); i++) {
      if (words[i] === "-f" && words[i + 1] !== undefined) paths.push(words[++i] ?? "");
    }
    const end = words.findIndex((w, k) => k >= i && /^(?:-|\\?\(|!)/.test(w));
    return [...paths, ...words.slice(i, end < 0 ? words.length : end)];
  }
  const dashdash = words.indexOf("--");
  return words.filter((w, i) => (dashdash >= 0 && i > dashdash) || !w.startsWith("-"));
}

const label = (name: string) => (name === "find" ? `find ${DELETE}` : name);
const message = (name: string, word: string) =>
  `${label(name)} target ${word} is neither literal nor "\${VAR:?}…"`;

export const guard: Guard = {
  name: "delete_targets",
  check(view) {
    const found: Violation[] = [];
    for (const { file, line, command, view: shell } of repoCommands(view)) {
      const name = commandName(command);
      if (!["r" + "m", "r" + "mdir", "find"].includes(name)) continue;
      for (const word of targets(name, command.words)) {
        if (!safe(word, shell.expands)) found.push({ file, line, message: message(name, word) });
      }
    }
    for (const { file, line, elements } of repoArgv(view)) {
      const head = elements[0];
      const name = head && "literal" in head ? head.literal : "";
      if (!["r" + "m", "r" + "mdir", "find"].includes(name)) continue;
      const literals = elements.flatMap((e) => ("literal" in e ? [e.literal] : []));
      if (name === "find" && !literals.includes(DELETE)) continue;
      for (const e of elements.slice(1)) {
        if ("expr" in e) found.push({ file, line, message: message(name, e.expr) });
      }
    }
    return unique(found);
  },
};
