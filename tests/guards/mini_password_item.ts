import { lineAt, type Guard, type Violation } from "../lib/guard.ts";
import { docShellSources, shellSources } from "../lib/scripts.ts";
import { commands } from "../lib/shell.ts";

// FR-55, Q14: the mini's password reaches the keychain only as an ensemble-env/ item, imported with
// `ensemble-broker login env`. Checked where a name enters the keychain: a word of a security,
// keychain_read, keychain_has or storekey command naming a mini password item (any name holding
// both mini and password, so mac-mini-*-password too). Paths, such as a secret's file, are not
// item names.
const PREFIX = "ensemble-env/";
const PATH = /^(?:\/|~\/|\.\.?\/)/;
const READERS = new Set(["security", "keychain_read", "keychain_has", "storekey"]);

const unquote = (word: string) => word.replace(/^(['"])(.*)\1$/, "$2");

function misplaced(word: string): boolean {
  if (word.startsWith(PREFIX) || PATH.test(word)) return false;
  const lower = word.toLowerCase();
  return lower.includes("mini") && lower.includes("password");
}

export const guard: Guard = {
  name: "mini_password_item",
  check(view) {
    const found: Violation[] = [];
    const sources = [...shellSources(view), ...docShellSources(view)];
    for (const source of sources) {
      const text = view.read(source.file);
      for (const v of source.views) {
        for (const command of commands(v)) {
          if (!READERS.has(command.name.split("/").at(-1) ?? "")) continue;
          for (const word of command.words.map(unquote).filter(misplaced)) {
            found.push({
              file: source.file,
              line: lineAt(text, v.at(command.index)),
              message: `names the mini's password item ${word} outside ${PREFIX}; import it with ensemble-broker login env`,
            });
          }
        }
      }
    }
    return found;
  },
};
