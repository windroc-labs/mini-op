import { type Guard, type Violation } from "../lib/guard.ts";
import { bypasses } from "../lib/path_bypass.ts";
import { loadPathBypass } from "../lib/registry.ts";
import { isShipped, scanned, shellKind } from "../lib/repo.ts";

const REGISTRY = "tests/registry/path-bypass.json";
// E1's shell files that find tools outside PATH. Rows may be renamed by a move, never added.
const BASELINE = new Set(["mini/bin/o"]);

export const guard: Guard = {
  name: "path_bypass",
  check(view) {
    const found: Violation[] = [];
    const rows = loadPathBypass(view.read);
    const listed = new Set(rows.map((row) => row.file));
    for (const row of rows) {
      const at = (message: string) => found.push({ file: REGISTRY, line: 1, message });
      if (!BASELINE.has(row.file)) at(`${row.file} is not in E1's baseline; call tools by name`);
      if (!row.reason?.trim()) at(`${row.file} has no reason`);
      if (!view.files.includes(row.file) || bypasses(view.read(row.file)).length === 0) {
        at(`${row.file} no longer bypasses PATH; remove its row`);
      }
    }
    for (const file of scanned(view)) {
      if (!isShipped(file) || listed.has(file)) continue;
      const text = view.read(file);
      if (!shellKind(file, text)) continue;
      for (const { line, message } of bypasses(text)) found.push({ file, line, message });
    }
    return found;
  },
};
