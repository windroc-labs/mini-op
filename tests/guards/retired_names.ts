import { lineAt, unique, type Guard, type Violation } from "../lib/guard.ts";
import { scanned } from "../lib/repo.ts";

// FR-50: `ctl/mini run|pw|sudo|chord` replaced five wrappers (E7); no file or file name names them
// again. Built from parts so this file never matches itself.
const RETIRED = new Map(
  [
    ["ans", "mini run"],
    ["pw", "mini pw"],
    ["sa", "mini pw --sa"],
    ["sudo", "mini sudo"],
    ["chord", "mini chord"],
  ].map(([old, now]) => ["mini-" + old, now]),
);
const NAME = new RegExp(`(?<![\\w-])(${[...RETIRED.keys()].join("|")})(?![\\w-])`, "g");

export const guard: Guard = {
  name: "retired_names",
  check(view) {
    const found: Violation[] = [];
    const at = (file: string, line: number, name: string) =>
      found.push({ file, line, message: `\`${name}\` is retired: use \`${RETIRED.get(name)}\`` });
    for (const file of scanned(view)) {
      for (const match of file.matchAll(NAME)) at(file, 1, match[1] ?? "");
      const text = view.read(file);
      for (const match of text.matchAll(NAME)) at(file, lineAt(text, match.index), match[1] ?? "");
    }
    return unique(found);
  },
};
