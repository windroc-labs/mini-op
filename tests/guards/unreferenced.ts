import type { Guard, Violation } from "../lib/guard.ts";
import { scanned } from "../lib/repo.ts";

// A script nothing names is dead or undocumented. The mini's scripts are named by their path under
// ~/apm (bin/<name>, runbooks/<runbook>/<name>), ctl/ scripts by name (they are on the container's
// PATH), host/ scripts by a path ending /<name> (host/start, "$here/update"). Tests don't count.
const DIRS = ["mini/", "ctl/", "host/"];

function named(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const before = word.startsWith("/") ? "" : "(?<![A-Za-z0-9_.-])";
  return new RegExp(`${before}${escaped}(?![A-Za-z0-9_.-])`).test(text);
}

export const guard: Guard = {
  name: "unreferenced",
  check(view) {
    const found: Violation[] = [];
    const files = scanned(view).filter((file) => !file.startsWith("tests/"));
    for (const file of files) {
      if (!DIRS.some((dir) => file.startsWith(dir)) || !view.read(file).startsWith("#!")) continue;
      const base = file.slice(file.lastIndexOf("/") + 1);
      const word = file.startsWith("mini/")
        ? file.slice(5)
        : file.startsWith("host/")
          ? `/${base}`
          : base;
      if (!files.some((other) => other !== file && named(view.read(other), word))) {
        found.push({ file, line: 1, message: `no doc or other script names ${word}` });
      }
    }
    return found;
  },
};
