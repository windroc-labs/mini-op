import { lineAt, type Guard, type Violation } from "../lib/guard.ts";
import { scanned } from "../lib/repo.ts";
import { docShellSources, shellSources } from "../lib/scripts.ts";
import { commands } from "../lib/shell.ts";

// FR-55, Q14: the mini's password reaches the keychain only as an ensemble-env/ item, imported with
// `ensemble-broker login env`. Checked where a name enters the keychain: a word of a security,
// keychain_read, keychain_has or storekey command naming a mini password item (any name holding
// both mini and password, so mac-mini-*-password too), or a config line's `item = "<name>"` (TOML)
// or `item: <name>` (YAML). Paths, such as a secret's file, and $ expansions are not item names.
const PREFIX = "ensemble-env/";
const CONFIG = /^[ \t]*(?:-[ \t]+)?item[ \t]*[=:][ \t]*(["']?)([^"'\s#]+)\1[ \t]*(?:#.*)?$/gm;
const PATH = /^(?:\/|~\/|\.\.?\/)/;
const READERS = new Set(["security", "keychain_read", "keychain_has", "storekey"]);

const unquote = (word: string) => word.replace(/^(['"])(.*)\1$/, "$2");

function misplaced(word: string): boolean {
  if (word.startsWith(PREFIX) || PATH.test(word) || word.includes("$")) return false;
  const lower = word.toLowerCase();
  return lower.includes("mini") && lower.includes("password");
}

export const guard: Guard = {
  name: "mini_password_item",
  check(view) {
    const found: Violation[] = [];
    const at = (file: string, line: number, name: string) =>
      found.push({
        file,
        line,
        message: `names the mini's password item ${name} outside ${PREFIX}; import it with ensemble-broker login env`,
      });
    for (const file of scanned(view)) {
      if (file.startsWith("tests/")) continue;
      const text = view.read(file);
      for (const m of text.matchAll(CONFIG)) {
        if (misplaced(m[2] ?? "")) at(file, lineAt(text, m.index), m[2] ?? "");
      }
    }
    const sources = [...shellSources(view), ...docShellSources(view)];
    for (const source of sources) {
      const text = view.read(source.file);
      for (const v of source.views) {
        for (const command of commands(v)) {
          if (!READERS.has(command.name.split("/").at(-1) ?? "")) continue;
          for (const word of command.words.map(unquote).filter(misplaced)) {
            at(source.file, lineAt(text, v.at(command.index)), word);
          }
        }
      }
    }
    return found;
  },
};
