import type { Guard, Violation } from "../lib/guard.ts";
import { scanned } from "../lib/repo.ts";

const FILES = /^\.github\/(workflows\/[^/]+|actions\/.+\/action)\.ya?ml$/;
const USES = /^\s*(?:-\s+)?uses:\s*["']?([^"'\s#]+)["']?(.*)$/;
const PINNED = /^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40}$/;
const TAG = /#\s*v?\d+(?:\.\d+)*\b/;

export const guard: Guard = {
  name: "action_pins",
  check(view) {
    const found: Violation[] = [];
    for (const file of scanned(view).filter((f) => FILES.test(f))) {
      view
        .read(file)
        .split("\n")
        .forEach((text, i) => {
          const match = USES.exec(text);
          if (!match) return;
          const [, ref = "", rest = ""] = match;
          const at = (message: string) => found.push({ file, line: i + 1, message });
          if (ref.startsWith("./")) return;
          if (ref.startsWith("docker://")) {
            if (!/@sha256:[0-9a-f]{64}$/.test(ref)) at(`${ref} is not pinned to an image digest`);
            return;
          }
          if (!PINNED.test(ref)) at(`${ref} is not pinned to a 40-hex commit SHA`);
          else if (!TAG.test(rest)) at(`${ref} has no '# <tag>' comment`);
        });
    }
    return found;
  },
};
