import { lineAt, type Guard, type Violation } from "../lib/guard.ts";
import { isShipped, scanned } from "../lib/repo.ts";

// FR-54: opencli_data (mini/lib/opencli.zsh) is the one parser of an OpenCLI reply's data, so no
// shipped file outside mini/lib/ matches "data": itself, quoted or escaped.
const DATA = /\\?"data\\?"\s*:/g;
const HOME = "mini/lib/";

export const guard: Guard = {
  name: "data_parse",
  check(view) {
    const found: Violation[] = [];
    const message = "parses OpenCLI's data itself; pipe the reply to opencli_data (mini/lib)";
    for (const file of scanned(view)) {
      if (!isShipped(file) || file.startsWith(HOME)) continue;
      const text = view.read(file);
      for (const m of text.matchAll(DATA))
        found.push({ file, line: lineAt(text, m.index), message });
    }
    return found;
  },
};
