import { lineAt, unique, type Guard, type Violation } from "../lib/guard.ts";
import { loadSecretReads, textRows } from "../lib/registry.ts";
import { shellSources } from "../lib/scripts.ts";
import {
  enclosing,
  KEYCHAIN,
  reads,
  secretPath,
  secretScope,
  secretSource,
  stdinFed,
} from "../lib/secret_sources.ts";
import { commands, type Command, type ShellView } from "../lib/shell.ts";

// FR-35: secrets move only by pipe or < redirect. Their sources (security … -w, pbpaste, the
// secrets dir) never feed a command substitution or a variable, unless the read is registered
// with its reason; secret-named variables are never exported. An argv row registers the one line
// that must pass a secret in argv, for want of any other way in. keychain_read's own security -w
// is its output: its callers' pipes are checked instead.
const REGISTRY = "tests/registry/secret-reads.json";
const SECRET_NAME = /pass|token|key|secret/i;
const READ_ARGS = new Set(["-d", "-u", "-n", "-N", "-t", "-p", "-a", "-A", "-k"]);
const TO_STDOUT = /^(?:1?>|>>|&>|>\|)/;
const ALLEXPORT = /(?:^|[\s;&|])(?:set\s+(?:-[A-Za-z]*a\b|-o\s+allexport)|setopt\s+all_?export)/i;

const SUBSTITUTED = "secret source in a command substitution";
const READ = `reads a secret into a variable; register it in ${REGISTRY}`;

// The variables a read assigns: its words that are not options or their arguments.
function readNames(command: Command): string[] {
  const names: string[] = [];
  for (let i = 0; i < command.words.length; i++) {
    const w = command.words[i] ?? "";
    if (READ_ARGS.has(w)) i++;
    else if (!w.startsWith("-")) names.push(w.split("?")[0] ?? w);
  }
  return names;
}

function exported(command: Command): string[] {
  const names = command.assignments.map((a) => a.split(/\+?=/)[0] ?? a);
  const flags = command.words.filter((w) => w.startsWith("-"));
  const declares = ["typeset", "declare", "local", "readonly"].includes(command.name);
  if (command.name === "export" || (declares && flags.some((f) => /^-[A-Za-z]*x/.test(f)))) {
    names.push(...command.words.filter((w) => !w.startsWith("-")).map((w) => w.split("=")[0] ?? w));
  }
  return names.filter((name) => SECRET_NAME.test(name));
}

// Whether a source's output reaches a pipe: its own, or that of a block it runs in, out to the
// outermost ({ { pbpaste; }; } | …), unless a > on the way sends it to a file ({ pbpaste; } > f).
function piped(command: Command, all: Command[]): boolean {
  for (const c of [command, ...enclosing(all, command)]) {
    if (c.redirects.some((r) => TO_STDOUT.test(r.op))) return false;
    if (c.terminator === "|") return true;
  }
  return false;
}

function check(file: string, text: string, views: ShellView[], found: Violation[]): void {
  const scope = secretScope(views);
  const at = (view: ShellView, index: number, message: string) =>
    found.push({ file, line: lineAt(text, view.at(index)), message });
  for (const view of views) {
    for (const m of view.code.matchAll(/\$\(\s*<[^)]*\)/g)) {
      if (secretPath(view.text.slice(m.index, m.index + m[0].length), scope)) {
        at(view, m.index, SUBSTITUTED);
      }
    }
    const allexport = ALLEXPORT.exec(view.code);
    if (allexport) {
      const index = allexport.index + allexport[0].search(/\S/);
      at(view, index, "turns on allexport, which exports every variable");
    }
    const all = commands(view);
    const fed = stdinFed(all, scope);
    for (const command of all) {
      const substituted = command.opener === "$(" || command.opener === "`";
      if (substituted && reads(command, scope)) at(view, command.index, SUBSTITUTED);
      if (
        command.name === "read" &&
        (fed.has(command) || readNames(command).some((n) => SECRET_NAME.test(n)))
      ) {
        at(view, command.index, READ);
      }
      if (
        secretSource(command) &&
        file !== KEYCHAIN &&
        !substituted &&
        command.opener !== "<(" &&
        !piped(command, all)
      ) {
        at(view, command.index, "secret output not piped");
      }
      for (const name of exported(command)) at(view, command.index, `exports secret-named ${name}`);
    }
  }
}

export const guard: Guard = {
  name: "secret_stdin",
  check(view) {
    const found: Violation[] = [];
    for (const source of shellSources(view)) {
      check(source.file, view.read(source.file), source.views, found);
    }
    // A row waives the read on the one line holding its text; a row matching 0 or 2+ lines none.
    const rows = textRows(loadSecretReads(view.read)).map((r) => {
      const exists = view.files.includes(r.row.file);
      const lines = exists ? view.read(r.row.file).split("\n") : [];
      const hits = lines.flatMap((l, i) => (l.includes(r.row.text) ? [i + 1] : []));
      return { ...r, exists, hits };
    });
    const waived = new Set<string>();
    const kept = unique(found).filter((v) => {
      if (v.message !== READ) return true;
      const row = rows.find(
        (r) => !r.row.argv && r.row.file === v.file && r.hits.length === 1 && r.hits[0] === v.line,
      );
      if (row) waived.add(row.key);
      return !row;
    });
    for (const { row, key, duplicate, reasonless, exists, hits } of rows) {
      const fault = (message: string) => kept.push({ file: REGISTRY, line: 1, message });
      if (duplicate) fault(`${row.file}: ${row.text} listed twice`);
      if (reasonless) fault(`${row.file}: ${row.text} has no reason`);
      if (!exists) fault(`${row.file} does not exist`);
      else if (hits.length !== 1) fault(`${row.file}: ${row.text} matches ${hits.length} lines`);
      else if (!row.argv && !waived.has(key)) {
        fault(`${row.file}: ${row.text} waives nothing; remove its row`);
      }
    }
    return kept;
  },
};
