import { codeOf, lineAt, type Guard, type Violation } from "../lib/guard.ts";
import { appleScriptOffsets } from "../lib/osascript.ts";
import { loadAppleScript } from "../lib/registry.ts";
import { isShipped, scanned } from "../lib/repo.ts";

const REGISTRY = "tests/registry/applescript.json";
const FILE = /\.(applescript|scpt|scptd)$/;

// FR-45: AppleScript lives only in the files tests/registry/applescript.json lists; everything
// else on the mini is a JXA program built from mini/ts. Docs keep their manual recipes.
export const guard: Guard = {
  name: "applescript",
  check(view) {
    const found: Violation[] = [];
    const files = new Set(view.files);
    const rows = loadAppleScript(view.read);
    for (const row of rows) {
      const at = (message: string) => found.push({ file: REGISTRY, line: 1, message });
      if (!files.has(row.file)) at(`${row.file} no longer exists; remove its row`);
      else if (!row.reason?.trim()) at(`${row.file} has no reason`);
    }
    const registered = new Set(rows.map((row) => row.file));
    for (const file of scanned(view)) {
      if (registered.has(file)) continue;
      if (FILE.test(file)) {
        found.push({
          file,
          line: 1,
          message: `an AppleScript file; only ${REGISTRY}'s files may hold AppleScript`,
        });
        continue;
      }
      if (!isShipped(file)) continue;
      const code = codeOf(file, view.read(file));
      const lines = new Set(appleScriptOffsets(code).map((offset) => lineAt(code, offset)));
      for (const line of lines) {
        found.push({ file, line, message: `has AppleScript; only ${REGISTRY}'s files may` });
      }
    }
    return found;
  },
};
