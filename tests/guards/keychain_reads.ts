import { lineAt, type Guard, type Violation } from "../lib/guard.ts";
import { scanned } from "../lib/repo.ts";
import { KEYCHAIN } from "../lib/secret_sources.ts";

// FR-55: keychain_read and keychain_has (mini/lib/keychain.zsh) are the one keychain reader, so
// no other file but the tests (which fake security) names the find subcommand: code, docs and
// runbook steps call the helper. Built from parts so this file never matches itself.
const FIND = new RegExp("\\bfind-" + "generic-password\\b", "g");

export const guard: Guard = {
  name: "keychain_reads",
  check(view) {
    const found: Violation[] = [];
    const message = `reads the keychain itself; use keychain_read or keychain_has (${KEYCHAIN})`;
    for (const file of scanned(view)) {
      if (file === KEYCHAIN || file.startsWith("tests/")) continue;
      const text = view.read(file);
      for (const m of text.matchAll(FIND))
        found.push({ file, line: lineAt(text, m.index), message });
    }
    return found;
  },
};
