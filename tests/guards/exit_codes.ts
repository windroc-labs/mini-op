import type { Guard, Violation } from "../lib/guard.ts";
import { managedFiles, testPath } from "../lib/managed.ts";
import { scanned } from "../lib/repo.ts";

// FR-32: a managed file's test asserts success (0), refusal or failure (1), a usage error (2),
// and a timeout (124) when the file can time out: it names 124 or uses with_timeout or poll
// (FR-53). A JXA entry (mini/ts) has no usage exit: osascript exits 1 on any thrown error, as
// `opencli browser eval` does for a page program (mini/ts/page).
const ASSERTS = /\bassert\.(?:equal|strictEqual)\(\s*[\w.?[\]]+\.code\s*,\s*(\d+)\b/g;
const TIMEOUT = /\b(?:124|with_timeout|poll)\b/;

export const guard: Guard = {
  name: "exit_codes",
  check(view) {
    const found: Violation[] = [];
    const files = new Set(view.files);
    for (const file of managedFiles({ ...view, files: scanned(view) })) {
      const test = testPath(file);
      if (!files.has(test)) continue;
      const asserted = new Set([...view.read(test).matchAll(ASSERTS)].map((m) => Number(m[1])));
      const needed = file.startsWith("mini/ts/")
        ? [0, 1]
        : TIMEOUT.test(view.read(file))
          ? [0, 1, 2, 124]
          : [0, 1, 2];
      for (const code of needed.filter((c) => !asserted.has(c))) {
        found.push({ file: test, line: 1, message: `no test asserts exit ${code} of ${file}` });
      }
    }
    return found;
  },
};
