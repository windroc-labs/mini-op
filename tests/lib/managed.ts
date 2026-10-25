// The files FR-26 requires a test for, and where that test lives.
import { loadUntested } from "./registry.ts";
import { isShipped, shellKind, TESTED_DIRS, type RepoView } from "./repo.ts";

const CODE_EXT = /\.(ts|js|zsh|sh|bash)$/;

export function isExecutable(file: string, text: string): boolean {
  return TESTED_DIRS.some((dir) => file.startsWith(dir + "/")) && text.startsWith("#!");
}

// TS run as a program: outside tests/ and lib/ dirs, not a declaration file. A JXA program in
// mini/js is not one: .github/jxa.ts ties it to its tested mini/ts entry byte for byte.
export function isProgramEntry(file: string): boolean {
  const dirs = file.split("/").slice(0, -1);
  return (
    file.endsWith(".ts") && !file.endsWith(".d.ts") && dirs[0] !== "tests" && !dirs.includes("lib")
  );
}

// tests/<top without its leading .>/<rest without a code extension>.test.ts
export function testPath(file: string): string {
  const stem = file.replace(CODE_EXT, "").replace(/^\./, "");
  return `tests/${stem}.test.ts`;
}

// Whether a test file names an existing file or dir: <stem>, <stem>.<ext>, the same under a
// .-prefixed dir, or tests/<stem>(.ts) for test infrastructure.
export function testedFile(test: string, files: Set<string>): boolean {
  const stem = /^tests\/(.+)\.test\.ts$/.exec(test)?.[1];
  if (stem === undefined) return false;
  const candidates = [stem, `.${stem}`, `tests/${stem}`];
  for (const file of files) {
    if (file.endsWith(".test.ts")) continue;
    for (const c of candidates) {
      if (file === c || file.startsWith(c + "/")) return true;
      if (file.startsWith(c + ".") && !file.slice(c.length + 1).includes("/")) return true;
    }
  }
  return false;
}

// Executables and program entries, before the allowlist.
export function testedFiles(view: RepoView): string[] {
  return view.files.filter((file) => isProgramEntry(file) || isExecutable(file, view.read(file)));
}

// The files that must have a test, run in the suite and meet FR-32: those off the allowlist.
export function managedFiles(view: RepoView): string[] {
  const untested = new Set(loadUntested(view.read).map((row) => row.file));
  return testedFiles(view).filter((file) => !untested.has(file));
}

// A shipped file that is neither docs nor code: FR-28 lists each with the tests that cover it.
export function isNonCode(file: string, text: string): boolean {
  return isShipped(file) && !/\.(ts|js)$/.test(file) && shellKind(file, text) === null;
}
