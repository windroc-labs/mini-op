// Diff coverage for npm run coverage: shell statements from the sandbox's trace (FR-30), TS lines
// and branches from node's lcov (FR-29), and whether each managed file ran at all (FR-27).
import * as fs from "node:fs";
import * as path from "node:path";
import { shellKind } from "../../tests/lib/repo.ts";
import { shellCode } from "../../tests/lib/shell.ts";

export const THRESHOLD = 0.85;

export type Statement = { lines: number[]; executable: boolean };
export type Lines = Map<string, Set<number>>;
export type LcovFile = { lines: Map<number, number>; branches: { line: number; taken: number }[] };
export type Gate = { covered: number; total: number; misses: string[] };

const SYNTAX = new Set([
  "then",
  "else",
  "elif",
  "fi",
  "do",
  "done",
  "esac",
  "in",
  "{",
  "}",
  "(",
  ")",
]);
// A compound command's closing word: a redirect after it (`done <<<x`, `fi >&2`) belongs to the
// command, whose first line is the one bash and zsh trace.
const CLOSERS = new Set(["done", "fi", "esac", "}", ")"]);
const CASE_PATTERN = /^\(?[^\s();|&]+(?:\|[^\s();|&]+)*\)$/;
const HEREDOC = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/;

// The newline offsets inside quotes, (…), $(…) or backticks of shellCode's output, where string
// bodies are blank but their quote characters and newlines are kept.
function enclosed(code: string): Set<number> {
  const inside = new Set<number>();
  const mark = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (code[k] === "\n") inside.add(k);
  };
  const quoted = (i: number): number => {
    while (i < code.length) {
      if (code[i] === "\\") i += 2;
      else if (code[i] === '"') return i + 1;
      else if (code[i] === "$" && code[i + 1] === "(") i = scan(i + 2, ")");
      else if (code[i] === "`") i = scan(i + 1, "`");
      else i++;
    }
    return i;
  };
  const scan = (i: number, close: string): number => {
    while (i < code.length) {
      const c = code[i];
      let end: number;
      if (c === "\\") {
        i += 2;
        continue;
      } else if (close && c === close) {
        return i + 1;
      } else if (c === "'") {
        const stop = code.indexOf("'", i + 1);
        end = stop < 0 ? code.length : stop + 1;
      } else if (c === '"') {
        end = quoted(i + 1);
      } else if (c === "`") {
        end = scan(i + 1, "`");
      } else if (c === "(") {
        end = scan(i + 1, ")");
      } else {
        i++;
        continue;
      }
      mark(i, end);
      i = end;
    }
    return i;
  };
  scan(0, "");
  return inside;
}

// The commands a shell file runs, each with its physical lines: lines join inside quotes and
// parentheses, through a heredoc body, and after a trailing \, |, && or ||.
export function statements(text: string): Statement[] {
  const code = shellCode(text, { strings: "blank" });
  const inside = enclosed(code);
  const lines = code.split("\n");
  const joined = new Set<number>(); // 0-based lines whose newline does not end the command
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const newline = offset + line.length;
    if (inside.has(newline) || /(\\|\||&&)\s*$/.test(line)) joined.add(i);
    const doc = line.includes("<<<") ? null : HEREDOC.exec(line);
    if (doc) {
      let end = i + 1;
      while (end < lines.length && (lines[end] ?? "").replace(/^\t+/, "") !== doc[2]) end++;
      for (let k = i; k < end; k++) joined.add(k);
    }
    offset = newline + 1;
  }
  const out: Statement[] = [];
  let current: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    current.push(i);
    if (joined.has(i)) continue;
    let joinedCode = current
      .map((k) => lines[k] ?? "")
      .join(" ")
      .trim();
    // After a closer only what follows a separator runs as its own command.
    if (CLOSERS.has(joinedCode.split(/[\s;]/, 1)[0] ?? "")) {
      joinedCode = /(?:&&|\|\||;(?![;&|])|\|)(.*)$/.exec(joinedCode)?.[1] ?? "";
    }
    const words = joinedCode
      .replace(/;[;&|]/g, " ")
      .replace(/;/g, " ")
      .split(/\s+/)
      .filter((word) => word && !SYNTAX.has(word) && !CASE_PATTERN.test(word));
    const executable = words.length > 0;
    out.push({ lines: current.map((k) => k + 1), executable });
    current = [];
  }
  return out;
}

function inRoot(root: string, file: string): string | undefined {
  let real: string;
  try {
    real = fs.realpathSync(file);
  } catch {
    return undefined;
  }
  const rel = path.relative(root, real);
  return rel.startsWith("..") || path.isAbsolute(rel) ? undefined : rel;
}

// "<abs path>:<line>" lines, keyed by repo-relative path; files outside `root` are dropped.
export function parseTrace(text: string, root: string): Lines {
  const out: Lines = new Map();
  for (const entry of text.split("\n")) {
    const colon = entry.lastIndexOf(":");
    const file = entry.slice(0, colon);
    if (colon < 0 || !path.isAbsolute(file)) continue;
    const rel = inRoot(root, file);
    if (rel === undefined) continue;
    out.set(rel, (out.get(rel) ?? new Set()).add(Number(entry.slice(colon + 1))));
  }
  return out;
}

export function parseLcov(text: string, root: string): Map<string, LcovFile> {
  const out = new Map<string, LcovFile>();
  let current: LcovFile | undefined;
  for (const entry of text.split("\n")) {
    if (entry.startsWith("SF:")) {
      const rel = inRoot(root, entry.slice(3));
      current = undefined;
      if (rel === undefined) continue;
      current = out.get(rel) ?? { lines: new Map(), branches: [] };
      out.set(rel, current);
    } else if (current && entry.startsWith("DA:")) {
      const [line = 0, count = 0] = entry.slice(3).split(",").map(Number);
      current.lines.set(line, Math.max(count, current.lines.get(line) ?? 0));
    } else if (current && entry.startsWith("BRDA:")) {
      const [line = "0", , , taken = "-"] = entry.slice(5).split(",");
      current.branches.push({ line: Number(line), taken: taken === "-" ? 0 : Number(taken) });
    }
  }
  return out;
}

// The new-side line numbers each file's hunks touch, from `git diff -U0`.
export function changedLines(diff: string): Lines {
  const out: Lines = new Map();
  let file: string | undefined;
  let removed = 0; // lines of the open hunk still to come, so content is never read as a header
  let added = 0;
  for (const entry of diff.split("\n")) {
    if (removed > 0 || added > 0) {
      if (entry.startsWith("-")) removed--;
      else if (entry.startsWith("+")) added--;
      continue;
    }
    if (entry.startsWith("+++ ")) {
      file = entry.startsWith("+++ b/") ? entry.slice(6) : undefined;
      if (file !== undefined && !out.has(file)) out.set(file, new Set());
    } else if (file !== undefined && entry.startsWith("@@")) {
      const hunk = /-\d+(?:,(\d+))? \+(\d+)(?:,(\d+))?/.exec(entry);
      removed = Number(hunk?.[1] ?? 1);
      const start = Number(hunk?.[2] ?? 0);
      added = Number(hunk?.[3] ?? 1);
      for (let n = start; n < start + added; n++) out.get(file)?.add(n);
    }
  }
  return out;
}

export const isTsSource = (file: string) =>
  file.endsWith(".ts") && !file.endsWith(".d.ts") && !file.startsWith("tests/");

const isShellSource = (file: string, text: string) =>
  !file.startsWith("tests/") && shellKind(file, text) !== null;

const empty = (): Gate => ({ covered: 0, total: 0, misses: [] });

export function tsGate(
  changed: Lines,
  lcov: Map<string, LcovFile>,
  read: (file: string) => string,
): Gate {
  const gate = empty();
  const count = (hit: boolean, miss: string) => {
    gate.total++;
    if (hit) gate.covered++;
    else gate.misses.push(miss);
  };
  for (const [file, lines] of changed) {
    if (!isTsSource(file)) continue;
    const record = lcov.get(file);
    const text = read(file).split("\n");
    for (const line of [...lines].sort((a, b) => a - b)) {
      if (record) {
        const hits = record.lines.get(line);
        if (hits !== undefined) count(hits > 0, `${file}:${line}`);
      } else {
        const source = (text[line - 1] ?? "").trim();
        if (source && !/^(\/\/|\/\*|\*)/.test(source)) count(false, `${file}:${line}`);
      }
    }
    for (const branch of record?.branches ?? []) {
      if (lines.has(branch.line)) count(branch.taken > 0, `${file}:${branch.line} branch`);
    }
  }
  return gate;
}

export function shellGate(changed: Lines, trace: Lines, read: (file: string) => string): Gate {
  const gate = empty();
  for (const [file, lines] of changed) {
    const text = read(file);
    if (!isShellSource(file, text)) continue;
    const ran = trace.get(file) ?? new Set();
    for (const statement of statements(text)) {
      if (!statement.executable || !statement.lines.some((n) => lines.has(n))) continue;
      gate.total++;
      if (statement.lines.some((n) => ran.has(n))) gate.covered++;
      else gate.misses.push(`${file}:${statement.lines[0]}`);
    }
  }
  return gate;
}

// Managed files with no trace line (shell) or no hit line in lcov (anything else).
export function neverRan(
  managed: string[],
  trace: Lines,
  lcov: Map<string, LcovFile>,
  read: (file: string) => string,
): string[] {
  return managed.filter((file) =>
    shellKind(file, read(file)) !== null
      ? !trace.has(file)
      : ![...(lcov.get(file)?.lines.values() ?? [])].some((hits) => hits > 0),
  );
}

export const percent = (gate: Gate) =>
  gate.total === 0 ? "100.0" : ((100 * gate.covered) / gate.total).toFixed(1);

export const passes = (gate: Gate) => gate.total === 0 || gate.covered / gate.total >= THRESHOLD;
