// Shell lines that find tools outside PATH, for the path_bypass guard and the tripwire.
import { FORBIDDEN } from "./sandbox.ts";

export type Bypass = { line: number; message: string; appends: boolean };

const B = "(?:^|[\\s;&|(`'\"=])";
const DECL = "(?:(?:export|typeset|declare|local)\\s+(?:-\\S+\\s+)*)?";
const ASSIGNS = new RegExp(`${B}${DECL}(?:PATH|path)\\+?=`, "g");
// An assignment that keeps the inherited PATH first, so the sandbox's fakes still win.
const APPENDS = new RegExp(`${B}${DECL}(?:PATH="?\\$(?:PATH|\\{PATH\\}):|path\\+=)`, "g");

// Built on first use: sandbox.ts and this module import each other through tripwire.ts.
let rules: [RegExp, string][] | undefined;
function rulesOf(): [RegExp, string][] {
  rules ??= [
    [
      new RegExp(`${B}/[^\\s;&|()'"\`]*/(?:${FORBIDDEN.join("|")})(?=$|[\\s;&|)'"\`])`),
      "runs a sandboxed command by absolute path",
    ],
    [new RegExp(`${B}command\\s+-p\\b`), "uses command -p"],
    [new RegExp(ASSIGNS.source), "assigns PATH"],
    [
      new RegExp(`${B}env\\s+(?:-\\S*i\\S*|--ignore-environment|-u\\s*PATH|--unset=PATH)\\b`),
      "clears PATH with env",
    ],
  ];
  return rules;
}

const count = (re: RegExp, line: string) => [...line.matchAll(re)].length;

// `appends`: every PATH assignment on the line keeps $PATH first.
export function bypasses(text: string): Bypass[] {
  const out: Bypass[] = [];
  text.split("\n").forEach((line, i) => {
    if (/^\s*#/.test(line)) return;
    for (const [rule, message] of rulesOf()) {
      if (!rule.test(line)) continue;
      const appends = message === "assigns PATH" && count(APPENDS, line) === count(ASSIGNS, line);
      out.push({ line: i + 1, message, appends });
    }
  });
  return out;
}

// Whether a shell file can reach a tool ahead of the sandbox's fakes.
export function prependsPath(text: string): boolean {
  return bypasses(text).some((hit) => !hit.appends);
}
