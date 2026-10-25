import type { Guard, Violation } from "../lib/guard.ts";
import { scanned, type LocalFile } from "../lib/repo.ts";

const BASE = "host/config.yaml";
const KEYS = ["mini_host", "mini_user"] as const;
const SAY = "say `mini` (~/.mini-op/config.local.yaml)";
// host/config's line format: key: "", "text", text or [a, b], then an optional # comment.
const LINE = /^([a-z_][a-z0-9_]*):\s*(?:""|"([^"\\]*)"|([^\][#",\s]+)|\[[^\]#"]*\])(?:\s+#.*)?\s*$/;
const SKIP = /^\s*(#.*)?$/;

type Parsed = { values: Map<string, { value: string; line: number }>; bad: number[] };

function parse(text: string): Parsed {
  const parsed: Parsed = { values: new Map(), bad: [] };
  text.split("\n").forEach((raw, i) => {
    if (SKIP.test(raw)) return;
    const m = LINE.exec(raw);
    if (!m) parsed.bad.push(i + 1);
    else parsed.values.set(m[1] ?? "", { value: m[2] ?? m[3] ?? "", line: i + 1 });
  });
  return parsed;
}

// The real values, from the local file; every problem with it is a violation, never a pass.
function localNeedles(local: LocalFile, found: Violation[]): RegExp[] {
  const fail = (line: number, message: string) => found.push({ file: local.path, line, message });
  if (local.text === null) {
    fail(1, "cannot read it");
    return [];
  }
  const { values, bad } = parse(local.text);
  for (const line of bad) fail(line, "not a key: value line; run host/config");
  if (bad.length > 0) return [];
  const [host, user] = KEYS.map((key) => {
    const value = values.get(key)?.value ?? "";
    if (!value) fail(1, `${key} is empty`);
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  });
  return host && user ? [new RegExp(host), new RegExp(`\\b${user}\\b`, "i")] : [];
}

// The mini's address and account live only in ~/.mini-op/config.local.yaml: the base leaves them
// empty, and no committed file but the status record names them.
export const guard: Guard = {
  name: "address",
  check(view) {
    const found: Violation[] = [];
    const base = parse(view.files.includes(BASE) ? view.read(BASE) : "").values;
    for (const key of KEYS) {
      const entry = base.get(key);
      if (!entry) found.push({ file: BASE, line: 1, message: `no ${key} line` });
      else if (entry.value) {
        found.push({
          file: BASE,
          line: entry.line,
          message: `${key} must be "" here; set it in ~/.mini-op/config.local.yaml`,
        });
      }
    }
    if (!view.local) return found;
    const needles = localNeedles(view.local, found);
    const names = ["the mini's address", "the mini's account"];
    for (const file of scanned(view)) {
      if (file === "status.md" || needles.length === 0) continue;
      view
        .read(file)
        .split("\n")
        .forEach((line, i) => {
          needles.forEach((needle, n) => {
            if (needle.test(line)) {
              found.push({ file, line: i + 1, message: `names ${names[n]}; ${SAY}` });
            }
          });
        });
    }
    return found;
  },
};
