import * as path from "node:path";
import { lineAt, type Guard, type Violation } from "../lib/guard.ts";
import { isShipped, scanned, SHIPPED_DIRS, type RepoView } from "../lib/repo.ts";

// The container's operator reads ctl/CLAUDE.md as /opt/mini-op/CLAUDE.md, beside the repo's
// other copied files: its paths resolve from the repo root only.
const CLAUDE = "ctl/CLAUDE.md";
// Paths in other repos, named as such in the docs.
const ELSEWHERE = new Set(["docs/credentials.md"]);
// README.md › Start here: the records and the five runbooks stay, even without a reference to them.
const REQUIRED = [
  "status.md",
  ...["setup-test-env", "install-ensemble", "clean-ensemble", "manager-on-mini", "return-mini"].map(
    (name) => `runbooks/${name}.md`,
  ),
];
const TOP = new Set([...SHIPPED_DIRS, "runbooks", "tests", "proxy", ".github", ".githooks"]);
const PATH = /^(?:\.\.\/)*[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.*-]+)*\/?$/;
const SPAN = /`([^`\n]+)`/g;
// The mini's ~/apm is mini/; its state/ and the VERSION stamp are made at run time.
const APM = /~\/apm\/([A-Za-z0-9_./-]*[A-Za-z0-9_-])/g;
const RUNTIME = /^(?:state|VERSION)(?:\/|$)/;
const SUBCOMMAND = /^mini ([a-z][a-z-]*)\b/;
// In a fenced block, `mini <sub>` as a command: at a line's start, after ; & | (, after ctl/, or
// after `docker exec mini-op`. `ssh mini hostname` names the host, not a subcommand.
const FENCE = /^[ \t]*```[a-z]*\n([\s\S]*?)^[ \t]*```/dgm;
const COMMAND =
  /(?:^[ \t]*|[;&|(][ \t]*|(?<![\w.-])ctl\/|(?<![\w.-])mini-op[ \t]+)mini ([a-z][a-z-]*)(?![\w-])/gm;
// ctl/mini's -h text: its lines starting `mini <sub>` name the subcommands and their options.
const USAGE = /^usage="((?:[^"\\]|\\[\s\S])*)"/m;
const USAGE_LINE = /^mini ([a-z][a-z-]*)(?![\w-])(.*)$/gm;
const OPTION = /(?<![\w-])--?[A-Za-z][\w-]*/g;
// `<file>` › <heading>: a Markdown heading of <file> (# to ######, closing #s dropped) must follow
// the arrow and end at the cell, the line or punctuation.
const ARROW = /^[ \t]+›[ \t]+/;
const HEADING = /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/gm;
const HEADING_END = /^(?:[ \t]*(?:\n|$|\|)|[)\],;:.!?`])/;

function exists(view: RepoView, file: string): boolean {
  const target = path.posix.normalize(file).replace(/\/$/, "");
  return view.files.some((f) => f === target || f.startsWith(target + "/"));
}

function repoPath(doc: string, token: string): string[] | null {
  const word = (token.split(/\s/)[0] ?? "").replace(/\*+$/, "");
  const container = /^\/opt\/mini-op\/(.+)$/.exec(word)?.[1];
  if (container !== undefined) return [container === "CLAUDE.md" ? CLAUDE : container];
  if (!PATH.test(word) || ELSEWHERE.has(word)) return null;
  if (!(word.startsWith("../") || TOP.has(word.split("/")[0] ?? "") || word.endsWith(".md"))) {
    return null;
  }
  const relative = path.posix.join(path.posix.dirname(doc), word);
  return doc === CLAUDE ? [word] : [relative, word];
}

// Each subcommand on ctl/mini's usage lines, with the options those lines name.
function usage(text: string): Map<string, Set<string>> {
  const subs = new Map<string, Set<string>>();
  for (const line of text.matchAll(USAGE_LINE)) {
    const options = subs.get(line[1] ?? "") ?? new Set<string>();
    for (const option of (line[2] ?? "").matchAll(OPTION)) options.add(option[0]);
    subs.set(line[1] ?? "", options);
  }
  return subs;
}

// The `-…` words after `mini <sub>` up to its first operand or the end of the command.
function leadingOptions(rest: string): string[] {
  const words = (rest.split(/[;&|()\n`]/, 1)[0] ?? "").trim().split(/\s+/);
  const end = words.findIndex((word) => !word.startsWith("-"));
  return end === -1 ? words : words.slice(0, end);
}

function headings(file: string, text: string): string[] {
  if (!file.endsWith(".md")) return [];
  return [...text.replace(FENCE, "").matchAll(HEADING)].map((m) => m[1] ?? "");
}

// The heading a reference names, for the message: up to the cell, clause or sentence end.
function named(after: string): string {
  let heading = (/^[^|;,:`\n]*/.exec(after)?.[0] ?? "").split(/\.(?:\s|$)/)[0]?.trim() ?? "";
  const count = (c: string) => heading.split(c).length - 1;
  while (heading.endsWith(")") && count(")") > count("(")) heading = heading.slice(0, -1).trim();
  return heading;
}

export const guard: Guard = {
  name: "doc_refs",
  check(view) {
    const found: Violation[] = [];
    // Without its usage text in ctl/mini, every `mini <sub>` reference would fail: say so once.
    const ctl = view.files.includes("ctl/mini") ? USAGE.exec(view.read("ctl/mini"))?.[1] : "";
    if (ctl === undefined) {
      const message = `no usage="…" text: doc_refs reads mini's subcommands and options from it`;
      found.push({ file: "ctl/mini", line: 1, message });
    }
    for (const doc of REQUIRED.filter((d) => !view.files.includes(d))) {
      found.push({
        file: doc,
        line: 1,
        message: `${doc} is missing: README.md › Start here needs it`,
      });
    }
    const subs = usage(ctl ?? "");
    const titles = new Map<string, string[]>();
    const headingsOf = (target: string) => {
      if (!titles.has(target)) titles.set(target, headings(target, view.read(target)));
      return titles.get(target) ?? [];
    };
    for (const file of scanned(view)) {
      const doc = file.endsWith(".md") && !file.startsWith("tests/");
      if (!doc && !isShipped(file)) continue;
      const text = view.read(file);
      const at = (index: number, message: string) =>
        found.push({ file, line: lineAt(text, index), message });
      const subcommand = (sub: string | undefined, rest: string, index: number) => {
        if (!sub || ctl === undefined) return;
        const options = subs.get(sub);
        if (!options) return at(index, `\`mini ${sub}\`: ctl/mini has no ${sub} subcommand`);
        for (const option of leadingOptions(rest)) {
          if (!options.has(option)) {
            at(
              index,
              `\`mini ${sub} ${option}\`: ctl/mini's usage has no ${option} for mini ${sub}`,
            );
          }
        }
      };
      const heading = (span: string, target: string, after: string, index: number) => {
        const ref = `\`${span}\` › ${named(after)}`;
        if (!view.files.includes(target)) return at(index, `${ref}: ${target} does not exist`);
        const ok = headingsOf(target).some(
          (h) => after.startsWith(h) && HEADING_END.test(after.slice(h.length)),
        );
        if (!ok) at(index, `${ref}: ${target} has no such heading`);
      };
      for (const match of text.matchAll(APM)) {
        const rest = match[1] ?? "";
        if (!RUNTIME.test(rest) && !exists(view, `mini/${rest}`)) {
          at(match.index, `~/apm/${rest} is not mini/${rest}`);
        }
      }
      if (!doc) continue;
      for (const match of text.matchAll(SPAN)) {
        const span = match[1] ?? "";
        const candidates = repoPath(file, span);
        if (candidates && !candidates.some((c) => exists(view, c))) {
          at(match.index, `\`${span.split(/\s/)[0]}\` does not exist`);
        } else if (candidates) {
          const tail = text.slice(match.index + match[0].length);
          const arrow = ARROW.exec(tail);
          if (arrow) heading(span, candidates[0] ?? "", tail.slice(arrow[0].length), match.index);
        }
        const sub = SUBCOMMAND.exec(span);
        subcommand(sub?.[1], span.slice(sub?.[0].length ?? 0), match.index);
      }
      for (const fence of text.matchAll(FENCE)) {
        const start = fence.indices?.[1]?.[0] ?? fence.index;
        const body = fence[1] ?? "";
        for (const match of body.matchAll(COMMAND)) {
          subcommand(match[1], body.slice(match.index + match[0].length), start + match.index);
        }
      }
    }
    return found;
  },
};
