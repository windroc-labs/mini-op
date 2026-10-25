import { lineAt, type Guard, type Violation } from "../lib/guard.ts";
import { osascriptProgram } from "../lib/osascript.ts";
import { loadAppleScript } from "../lib/registry.ts";
import { isShipped, scanned, shellKind } from "../lib/repo.ts";
import { shellCode } from "../lib/shell.ts";

// FR-48: osascript runs only a program file, never -e or stdin: a mini/js program (with -l
// JavaScript) or a registered AppleScript file, both as the mini has them under ~/apm. Strings
// count: ssh command strings run on the mini.
const CALL = /(?<![\w.-])osascript(?![\w.-])([^|;&)<>\n]*)/g;
const APM = /^(?:~|\$HOME|\$\{HOME\})\/apm\/(.+)$/;

function problem(args: string[], files: Set<string>, registered: Set<string>): string | null {
  const { file, inline, language } = osascriptProgram(args);
  if (file === undefined) {
    return inline
      ? "runs an inline program (osascript -e); run a mini/js program file"
      : "runs a program from stdin; run a mini/js program file";
  }
  const rel = `mini/${APM.exec(file)?.[1] ?? ""}`;
  if (/^mini\/js\/[^/]+\.js$/.test(rel) && files.has(rel)) {
    return language === "JavaScript" ? null : `runs ${file} without -l JavaScript`;
  }
  if (registered.has(rel)) return null;
  return `runs ${file}, not a mini/js program or registered AppleScript file`;
}

export const guard: Guard = {
  name: "osascript_programs",
  check(view) {
    const found: Violation[] = [];
    const files = new Set(view.files);
    const registered = new Set(loadAppleScript(view.read).map((row) => row.file));
    for (const file of scanned(view)) {
      const text = view.read(file);
      if (!isShipped(file) || !shellKind(file, text)) continue;
      const code = shellCode(text, { strings: "keep" });
      for (const match of code.matchAll(CALL)) {
        const args = (match[1] ?? "")
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .map((arg) => arg.replace(/^['"]+|['"]+$/g, ""));
        const message = problem(args, files, registered);
        if (message) found.push({ file, line: lineAt(code, match.index), message });
      }
    }
    return found;
  },
};
