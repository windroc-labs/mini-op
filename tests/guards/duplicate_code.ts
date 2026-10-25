import { codeOf, type Guard, type Violation } from "../lib/guard.ts";
import { loadDuplicates } from "../lib/registry.ts";
import { scanned, shellKind, type RepoView } from "../lib/repo.ts";

const REGISTRY = "tests/registry/duplicates.json";
// FR-72: no block of this many normalized lines appears in two code files.
const MIN = 6;

type Line = { text: string; line: number };

// Code lines trimmed, without comments, blank or bracket-only lines and imports.
function normalized(file: string, text: string): Line[] {
  return codeOf(file, text)
    .split("\n")
    .map((raw, i) => ({ text: raw.trim(), line: i + 1 }))
    .filter(({ text }) => !/^[\s{}()[\];,]*$/.test(text) && !/^import\b/.test(text));
}

function codeFiles(view: RepoView): string[] {
  return scanned(view).filter((file) => {
    if (file.startsWith("mini/js/")) return false;
    return file.endsWith(".ts") || shellKind(file, view.read(file)) !== null;
  });
}

type Region = { file: string; at: Line; repeats: string; from: Line; lines: number };

// Each longest run of shared lines between two files, reported in the later file.
function regions(view: RepoView): Region[] {
  const lines = new Map(codeFiles(view).map((file) => [file, normalized(file, view.read(file))]));
  const windows = new Map<string, { file: string; i: number }[]>();
  for (const [file, ls] of lines) {
    for (let i = 0; i + MIN <= ls.length; i++) {
      const key = ls
        .slice(i, i + MIN)
        .map((l) => l.text)
        .join("\n");
      windows.set(key, [...(windows.get(key) ?? []), { file, i }]);
    }
  }
  const pairs = new Set<string>();
  const starts: [string, number, string, number][] = [];
  for (const spots of windows.values()) {
    for (const a of spots) {
      for (const b of spots) {
        if (a.file >= b.file) continue;
        pairs.add(`${a.file}\0${a.i}\0${b.file}\0${b.i}`);
        starts.push([a.file, a.i, b.file, b.i]);
      }
    }
  }
  const has = (a: string, i: number, b: string, j: number) => pairs.has(`${a}\0${i}\0${b}\0${j}`);
  const found: Region[] = [];
  for (const [a, i, b, j] of starts) {
    if (has(a, i - 1, b, j - 1)) continue;
    let n = 1;
    while (has(a, i + n, b, j + n)) n++;
    const la = lines.get(a) ?? [];
    const lb = lines.get(b) ?? [];
    const at = lb[j];
    const from = la[i];
    if (at && from) found.push({ file: b, at, repeats: a, from, lines: n + MIN - 1 });
  }
  return found;
}

export const guard: Guard = {
  name: "duplicate_code",
  check(view) {
    const found: Violation[] = [];
    const rows = loadDuplicates(view.read);
    const used = new Set<number>();
    const reported = new Set<string>();
    for (const region of regions(view)) {
      const spot = `${region.file}:${region.at.line}:${region.repeats}`;
      if (reported.has(spot)) continue;
      reported.add(spot);
      const k = rows.findIndex(
        (row) =>
          row.file === region.file && row.repeats === region.repeats && row.text === region.at.text,
      );
      if (k >= 0) {
        used.add(k);
        continue;
      }
      found.push({
        file: region.file,
        line: region.at.line,
        message:
          `repeats ${region.repeats}:${region.from.line} for ${region.lines} lines; share it, ` +
          `or register it in ${REGISTRY} with a reason`,
      });
    }
    rows.forEach((row, k) => {
      const at = (message: string) => found.push({ file: REGISTRY, line: 1, message });
      if (!row.reason?.trim()) at(`${row.file} repeating ${row.repeats} has no reason`);
      if (!used.has(k)) at(`${row.file} no longer repeats ${row.repeats} from "${row.text}"`);
    });
    return found;
  },
};
