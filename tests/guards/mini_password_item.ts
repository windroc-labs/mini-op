import { lineAt, type Guard, type Violation } from "../lib/guard.ts";
import { scanned } from "../lib/repo.ts";

// The user deleted the MacBook keychain item that held the mini's password: it reaches mini-op only
// as the user types it in (host/README.md step 4). An item named for any account counts. Built from
// parts so this file never matches itself.
const ITEM = new RegExp("mac-mini-" + "[A-Za-z0-9._-]+-password", "g");

export const guard: Guard = {
  name: "mini_password_item",
  check(view) {
    const found: Violation[] = [];
    for (const file of scanned(view)) {
      const text = view.read(file);
      for (const match of text.matchAll(ITEM)) {
        found.push({
          file,
          line: lineAt(text, match.index),
          message:
            "names a MacBook keychain item for the mini's password; the user types the password in",
        });
      }
    }
    return found;
  },
};
