import { lineAt, type Guard, type Violation } from "../lib/guard.ts";
import { containerToRepo, RUNTIME_ROOT, scanned, shellKind } from "../lib/repo.ts";
import { shellCode } from "../lib/shell.ts";

// mini/ runs on the mini: it never names the container, its secrets dir, docker or the other dirs.
const MINI_NAMES: [RegExp, string][] = [
  [new RegExp(`${RUNTIME_ROOT}(?![\\w.-])`, "g"), RUNTIME_ROOT],
  [new RegExp("/run/" + "secrets\\b", "g"), "the container's secrets dir"],
  [/(?<![\w.-])docker(?![\w-])/g, "docker"],
  [/(?<![\w.-])ctl\//g, "ctl/"],
  [/(?<![\w.-])host\//g, "host/"],
];
// ctl/ and host/ run in the container or on the MacBook: the mini's tools only run over ssh there.
const LOCAL = /(?<![\w.-])(osascript|security)(?![\w.-])/g;
// `scp … <dest>` with the mini as the last argument; option values are not sources.
const SCP = /(?<![\w.-])scp((?:[ \t]+[^\s`'"|;&()]+)+)/g;
const VALUED = new Set(["-F", "-i", "-o", "-P", "-S", "-c", "-l", "-J", "-D", "-X"]);

function copies(file: string, text: string, found: Violation[]): void {
  for (const match of text.matchAll(SCP)) {
    const args = (match[1] ?? "").trim().split(/[ \t]+/);
    if (!/^(?:[\w.-]+@)?mini:/.test(args.at(-1) ?? "")) continue;
    const sources: string[] = [];
    for (let i = 0; i < args.length - 1; i++) {
      const arg = args[i] ?? "";
      if (VALUED.has(arg)) i++;
      else if (!arg.startsWith("-")) sources.push(arg);
    }
    for (const source of sources.filter((s) => !(containerToRepo(s) ?? s).startsWith("mini/"))) {
      found.push({
        file,
        line: lineAt(text, match.index),
        message: `copies ${source} to the mini; only mini/ goes there`,
      });
    }
  }
}

export const guard: Guard = {
  name: "boundary",
  check(view) {
    const found: Violation[] = [];
    for (const file of scanned(view)) {
      if (file.startsWith("tests/")) continue;
      const text = view.read(file);
      copies(file, text, found);
      if (file.startsWith("mini/")) {
        for (const [pattern, name] of MINI_NAMES) {
          for (const match of text.matchAll(pattern)) {
            found.push({ file, line: lineAt(text, match.index), message: `mini/ names ${name}` });
          }
        }
      } else if ((file.startsWith("ctl/") || file.startsWith("host/")) && shellKind(file, text)) {
        const code = shellCode(text, { strings: "blank" });
        for (const match of code.matchAll(LOCAL)) {
          found.push({
            file,
            line: lineAt(code, match.index),
            message: `runs ${match[1]} on this machine; the mini's tools run only over ssh`,
          });
        }
      }
    }
    return found;
  },
};
