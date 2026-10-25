import { commandName, repoArgv, repoCommands } from "../lib/commands.ts";
import { unique, type Guard, type Violation } from "../lib/guard.ts";

// FR-37: tmux runs on its default server only: no -S socket, and the server is never killed
// (other sessions, the user's included, live there). Built from parts so this file never
// matches itself; tmux takes unique prefixes, so those count too.
const KILL = "kill-" + "server";
const KILLS = new RegExp("^" + KILL.slice(0, 8));

// The flag letters of tmux's own options before the subcommand. A valued letter (-L name, -f
// file, -c cmd, -T list, -S path) takes the rest of its word, or the next word when it is last.
const VALUED = new Set(["L", "f", "c", "T", "S"]);
function flags(words: string[]): string[] {
  const letters: string[] = [];
  for (let i = 0; i < words.length && words[i]?.startsWith("-"); i++) {
    if (words[i] === "--" || words[i] === "-") break;
    const word = (words[i] ?? "").slice(1);
    for (let k = 0; k < word.length; k++) {
      const letter = word[k] ?? "";
      letters.push(letter);
      if (VALUED.has(letter)) {
        if (k === word.length - 1) i++;
        break;
      }
    }
  }
  return letters;
}

function problems(words: string[]): string[] {
  const found: string[] = [];
  if (flags(words).includes("S")) found.push("tmux with " + "-S");
  if (words.some((w) => KILLS.test(w))) found.push(`tmux ${KILL}`);
  return found;
}

export const guard: Guard = {
  name: "tmux_calls",
  check(view) {
    const found: Violation[] = [];
    for (const { file, line, command } of repoCommands(view)) {
      if (commandName(command) !== "tmux") continue;
      const words = command.words.map((w) => w.replace(/^(['"])(.*)\1$/, "$2"));
      for (const message of problems(words)) found.push({ file, line, message });
    }
    for (const { file, line, elements } of repoArgv(view)) {
      const head = elements[0];
      if (!head || !("literal" in head) || head.literal !== "tmux") continue;
      // an expression keeps its place as a word (a flag's value), never a flag itself
      const words = elements.map((e) => ("literal" in e ? e.literal : "\0"));
      for (const message of problems(words.slice(1))) found.push({ file, line, message });
    }
    return unique(found);
  },
};
