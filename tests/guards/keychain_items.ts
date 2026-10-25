import { lineAt, type Guard, type Violation } from "../lib/guard.ts";
import { isShipped, scanned } from "../lib/repo.ts";
import { docShellViews, shellSources } from "../lib/scripts.ts";
import { commands, type Command } from "../lib/shell.ts";

// FR-61: every keychain item that code or a doc names, by service or service and account, is in
// a row of status.md's Current environment table, both as `code` words: a call of keychain_read,
// keychain_has or storekey, or security's <find|add|delete>-generic-password -s/-a. Only literal
// names count: a command holding a <placeholder>, or a $variable, names the caller's item.
const STATUS = "status.md";
const SECTION = "## Current environment";
const LITERAL = /^[A-Za-z0-9][A-Za-z0-9._@+:-]*$/;
const SUBCOMMAND = /^(?:find|add|delete)-generic-password$/;

type Item = { service: string; account?: string };

const unquote = (word: string) => word.replace(/^(['"])(.*)\1$/, "$2");

function item(command: Command, raw: string): Item | undefined {
  if (raw.includes("<")) return undefined;
  const words = command.words.map(unquote);
  let service: string | undefined;
  let account: string | undefined;
  const base = command.name.split("/").at(-1);
  if (base === "keychain_read" || base === "keychain_has" || base === "storekey") {
    [service, account] = words.filter((w) => !w.startsWith("-"));
  } else if (
    command.name === "security" &&
    SUBCOMMAND.test(words[0] ?? "") &&
    words.includes("-s")
  ) {
    service = words[words.indexOf("-s") + 1];
    account = words.includes("-a") ? words[words.indexOf("-a") + 1] : undefined;
  }
  if (service === undefined || !LITERAL.test(service)) return undefined;
  return account !== undefined && LITERAL.test(account) ? { service, account } : { service };
}

// Each row of the table as its `code` words.
function rows(text: string): Set<string>[] {
  const start = text.indexOf(`\n${SECTION}`);
  if (start < 0) return [];
  const rest = text.slice(start + 1 + SECTION.length);
  const section = rest.slice(0, rest.search(/\n## |$/));
  return section
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .map((line) => new Set([...line.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? "")));
}

export const guard: Guard = {
  name: "keychain_items",
  check(view) {
    const found: Violation[] = [];
    const table = view.files.includes(STATUS) ? rows(view.read(STATUS)) : [];
    const listed = ({ service, account }: Item) =>
      table.some((row) => row.has(service) && (account === undefined || row.has(account)));
    const sources = shellSources(view).filter((s) => isShipped(s.file));
    for (const file of scanned(view)) {
      if (file.endsWith(".md") && !file.startsWith("tests/")) {
        sources.push({ file, views: docShellViews(view.read(file)) });
      }
    }
    for (const source of sources) {
      const text = view.read(source.file);
      for (const v of source.views) {
        for (const command of commands(v)) {
          const it = item(command, v.text.slice(command.index, command.end));
          if (!it || listed(it)) continue;
          const name = it.account === undefined ? it.service : `${it.service} / ${it.account}`;
          const message = `keychain item ${name} is not in ${STATUS}'s Current environment table`;
          found.push({ file: source.file, line: lineAt(text, v.at(command.index)), message });
        }
      }
    }
    return found;
  },
};
