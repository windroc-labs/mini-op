import { lineAt, type Guard, type Violation } from "../lib/guard.ts";
import { loadSuppressions, textRows } from "../lib/registry.ts";
import { scanned } from "../lib/repo.ts";

const REGISTRY = "tests/registry/suppressions.json";
// Built from parts so this file never matches itself.
const PATTERN = new RegExp(
  [
    "shellcheck\\s+" + "disable=[A-Za-z0-9,]+",
    "@ts-" + "(?:ignore|expect-error|nocheck)",
    "node:coverage\\s+" + "(?:ignore|disable)",
    "c8\\s+" + "ignore",
    "istanbul\\s+" + "ignore",
  ].join("|"),
  "g",
);
const SKIP = /\.(md|json|asc)$/;

export const guard: Guard = {
  name: "suppressions",
  check(view) {
    const found: Violation[] = [];
    const entries = loadSuppressions(view.read);
    const uses = new Map<string, { file: string; line: number }[]>();
    for (const file of scanned(view)) {
      if (SKIP.test(file)) continue;
      const text = view.read(file);
      for (const match of text.matchAll(PATTERN)) {
        const key = `${file}\0${match[0].replace(/\s+/g, " ")}`;
        uses.set(key, [...(uses.get(key) ?? []), { file, line: lineAt(text, match.index) }]);
      }
    }
    const registered = new Set<string>();
    for (const { row: entry, key, duplicate, reasonless } of textRows(entries)) {
      const count = uses.get(key)?.length ?? 0;
      if (duplicate) {
        found.push({
          file: REGISTRY,
          line: 1,
          message: `${entry.file}: ${entry.text} listed twice`,
        });
      }
      registered.add(key);
      if (reasonless) {
        found.push({
          file: REGISTRY,
          line: 1,
          message: `${entry.file}: ${entry.text} has no reason`,
        });
      }
      if (count !== 1) {
        found.push({
          file: REGISTRY,
          line: 1,
          message: `${entry.file}: ${entry.text} is used ${count} times, must be once`,
        });
      }
    }
    for (const [key, places] of uses) {
      if (registered.has(key)) continue;
      for (const place of places) {
        const text = key.split("\0")[1];
        found.push({ ...place, message: `${text} is not registered in ${REGISTRY}` });
      }
    }
    return found;
  },
};
