import type { Guard, Violation } from "../lib/guard.ts";
import { testedFile, testedFiles, testPath } from "../lib/managed.ts";
import { loadUntested } from "../lib/registry.ts";
import { scanned } from "../lib/repo.ts";

const REGISTRY = "tests/registry/untested.json";

// FR-26: every executable and program entry has its test at testPath(), and every test names a
// file. FR-69: the whitelist of files without one stays empty.
export const guard: Guard = {
  name: "test_files",
  check(view) {
    const found: Violation[] = [];
    const files = new Set(view.files);
    const rows = loadUntested(view.read);
    const listed = new Set(rows.map((row) => row.file));
    for (const row of rows) {
      found.push({
        file: REGISTRY,
        line: 1,
        message: `lists ${row.file}; the list stays empty: write its test`,
      });
    }
    for (const file of testedFiles({ ...view, files: scanned(view) })) {
      if (listed.has(file) || files.has(testPath(file))) continue;
      found.push({ file, line: 1, message: `no test at ${testPath(file)}` });
    }
    for (const file of scanned(view)) {
      if (file.startsWith("tests/") && file.endsWith(".test.ts") && !testedFile(file, files)) {
        found.push({ file, line: 1, message: "tests no existing file" });
      }
    }
    return found;
  },
};
