import type { Guard, Violation } from "../lib/guard.ts";

// FR-73/FR-74: ctl/CLAUDE.md is a routing table and at most 8 hard rules. Each route's Read cell
// names a repo file, alone or with one of its headings (doc_refs checks both exist); no sentence
// outside the rules copies 8 or more words of a doc in a row (D8): the doc stays their one home.
const FILE = "ctl/CLAUDE.md";
const TITLE = "# mini-op";
const ROUTES = "## Routes";
const RULES = "## Hard rules";
const MAX_RULES = 8;
const MIN_WORDS = 8;
const HEADER = /^\|\s*Task\s*\|\s*Read\s*\|$/;
const SEPARATOR = /^\|(?:\s*:?-+:?\s*\|)+$/;
const READ = /^`[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*`(?: › \S.*)?$/;
const RULE = /^\d+\. \S/;
const DOC = /^(?:README\.md|host\/README\.md|runbooks\/[^/]+\.md)$/;

const OUTSIDE = "not a route or a hard rule: ctl/CLAUDE.md holds only those (FR-73)";
const NO_FILE = "route names no repo file: its Read cell is `<file>` or `<file>` › <heading>";

// Words split on whitespace and punctuation, case-folded.
function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export const guard: Guard = {
  name: "claude_md",
  check(view) {
    if (!view.files.includes(FILE)) return [];
    const found: Violation[] = [];
    const docs = view.files
      .filter((f) => DOC.test(f))
      .map((f) => ({ file: f, words: ` ${words(view.read(f)).join(" ")} ` }));
    const at = (line: number, message: string) => found.push({ file: FILE, line, message });
    const copied = (line: number, text: string) => {
      for (const sentence of text.split(/[.!?]+(?=\s|$)/)) {
        const run = words(sentence);
        if (run.length < MIN_WORDS) continue;
        const source = docs.find((d) => d.words.includes(` ${run.join(" ")} `));
        if (source) {
          at(line, `repeats ${source.file}: "${run.join(" ")}"; route to it instead (FR-74)`);
        }
      }
    };
    let section: "top" | "routes" | "rules" = "top";
    let title = false;
    let rows = 0;
    let tableEnded = false;
    let rules = 0;
    view
      .read(FILE)
      .split("\n")
      .forEach((text, i) => {
        const line = i + 1;
        const trimmed = text.trim();
        if (trimmed === "") {
          if (rows > 0) tableEnded = true;
        } else if (text === TITLE && section === "top" && !title) {
          title = true;
        } else if (text === ROUTES && section === "top") {
          section = "routes";
        } else if (text === RULES && section === "routes") {
          section = "rules";
        } else if (section === "routes" && trimmed.startsWith("|") && !tableEnded) {
          rows += 1;
          if (rows === 1) {
            if (!HEADER.test(trimmed))
              at(line, "the routes table's header is not `| Task | Read |`");
          } else if (rows > 2 || !SEPARATOR.test(trimmed)) {
            const cells = trimmed.replace(/^\||\|$/g, "").split("|");
            if (cells.length !== 2 || !READ.test(cells[1]?.trim() ?? "")) at(line, NO_FILE);
            for (const cell of cells) copied(line, cell);
          }
        } else if (section === "rules" && RULE.test(text)) {
          rules += 1;
          if (rules === MAX_RULES + 1) at(line, `more than ${MAX_RULES} hard rules (FR-74)`);
        } else {
          at(line, OUTSIDE);
          copied(line, text);
        }
      });
    return found;
  },
};
