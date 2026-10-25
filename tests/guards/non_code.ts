import * as path from "node:path";
import type { Guard, Violation } from "../lib/guard.ts";
import { isNonCode } from "../lib/managed.ts";
import { loadNonCode } from "../lib/registry.ts";
import { scanned } from "../lib/repo.ts";

const REGISTRY = "tests/registry/non-code.json";

// FR-28: every non-code shipped file (Dockerfiles, proxy policy, ssh config, keys) has a row with
// its reason and the tests that cover it.
export const guard: Guard = {
  name: "non_code",
  check(view) {
    const found: Violation[] = [];
    const files = new Set(view.files);
    const rows = loadNonCode(view.read);
    for (const row of rows) {
      const at = (message: string) => found.push({ file: REGISTRY, line: 1, message });
      if (!files.has(row.file)) {
        at(`${row.file} no longer exists; remove its row`);
        continue;
      }
      if (!isNonCode(row.file, view.read(row.file))) {
        at(`${row.file} is code; remove its row`);
        continue;
      }
      if (!row.reason?.trim()) at(`${row.file} has no reason`);
      if (!row.tests?.length) at(`${row.file} has no covering test`);
      for (const test of row.tests ?? []) {
        if (!files.has(test)) at(`${row.file}: ${test} does not exist`);
        else if (!view.read(test).includes(path.basename(row.file))) {
          at(`${row.file}: ${test} does not name ${path.basename(row.file)}`);
        }
      }
    }
    const listed = new Set(rows.map((row) => row.file));
    for (const file of scanned(view)) {
      if (!listed.has(file) && isNonCode(file, view.read(file))) {
        found.push({ file, line: 1, message: `not in ${REGISTRY}` });
      }
    }
    return found;
  },
};
