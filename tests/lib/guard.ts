// Guards: repository rules checked over a RepoView. Each lives in tests/guards/<name>.ts with
// violation and clean samples in tests/guards/samples/<name>.ts.
import { shellKind, type RepoView } from "./repo.ts";
import { shellCode } from "./shell.ts";

export type Violation = { file: string; line: number; message: string };

export type Guard = { name: string; check(view: RepoView): Violation[] };

// Runs every guard, printing "<name>: N violations" and each violation; returns the exit code.
export function runGuards(view: RepoView, guards: Guard[], write: (text: string) => void): number {
  let failed = false;
  for (const guard of guards) {
    let found: Violation[];
    try {
      found = guard.check(view);
    } catch (err) {
      write(`${guard.name}: error: ${err instanceof Error ? err.message : String(err)}\n`);
      failed = true;
      continue;
    }
    write(`${guard.name}: ${found.length} violations\n`);
    for (const v of found) write(`  ${v.file}:${v.line}: ${v.message}\n`);
    if (found.length > 0) failed = true;
  }
  return failed ? 1 : 0;
}

// The 1-based line of a character offset.
export function lineAt(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

// A file's code, comments blanked: shell (strings kept: they run too), JS and TS; other files as is.
export function codeOf(file: string, text: string): string {
  if (shellKind(file, text)) return shellCode(text, { strings: "keep" });
  if (/\.(js|ts)$/.test(file)) {
    return text.replace(/\/\*[\s\S]*?\*\/|(?<![:"'`])\/\/[^\n]*/g, (c) => c.replace(/[^\n]/g, " "));
  }
  return text;
}

// Violations once each: a $( ) in double quotes is seen in two views.
export function unique(found: Violation[]): Violation[] {
  const seen = new Set<string>();
  return found.filter((v) => {
    const key = `${v.file}:${v.line}:${v.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
