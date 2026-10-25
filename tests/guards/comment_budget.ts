import { codeOf, type Guard, type Violation } from "../lib/guard.ts";
import { scanned, shellKind, type RepoView } from "../lib/repo.ts";

// FR-71: comments are at most this share of a set's non-blank chars, plus SLACK chars. Usage
// text belongs in the -h string, which counts as code.
const BUDGETS = [
  { name: "source", test: false, share: 0.15 },
  { name: "test", test: true, share: 0.1 },
];
const SLACK = 500;

const solid = (text: string) => text.replace(/\s/g, "").length;

// Shell (by shebang or extension) and TS, the shebang left out; generated mini/js is not counted.
function counted(view: RepoView, file: string): { comments: number; all: number } | undefined {
  if (file.startsWith("mini/js/")) return undefined;
  const text = view.read(file);
  if (!shellKind(file, text) && !file.endsWith(".ts")) return undefined;
  const body = (t: string) => (text.startsWith("#!") ? t.slice(t.indexOf("\n") + 1) : t);
  const all = solid(body(text));
  return { comments: all - solid(body(codeOf(file, text))), all };
}

export const guard: Guard = {
  name: "comment_budget",
  check(view) {
    const found: Violation[] = [];
    for (const budget of BUDGETS) {
      let comments = 0;
      let all = 0;
      let most = { file: "", comments: -1 };
      for (const file of scanned(view)) {
        if (file.startsWith("tests/") !== budget.test) continue;
        const n = counted(view, file);
        if (!n) continue;
        comments += n.comments;
        all += n.all;
        if (n.comments > most.comments) most = { file, comments: n.comments };
      }
      if (comments <= budget.share * all + SLACK) continue;
      const pct = ((100 * comments) / all).toFixed(1);
      found.push({
        file: most.file,
        line: 1,
        message:
          `${budget.name} comments are ${comments} of ${all} chars (${pct}%), over ` +
          `${budget.share * 100}% + ${SLACK}; this file has the most (${most.comments})`,
      });
    }
    return found;
  },
};
