import type { Guard, Violation } from "../lib/guard.ts";
import { loadSecretReads } from "../lib/registry.ts";
import { apmPath, isShipped, scanned, shellKind } from "../lib/repo.ts";
import { docShellViews, shellSources } from "../lib/scripts.ts";
import { readsHere, secretScope, stdinFed } from "../lib/secret_sources.ts";
import { commands } from "../lib/shell.ts";
import { names } from "../lib/tripwire.ts";

// FR-36: every shipped script that reads a secret has a canary scenario in tests/lib/canary.ts.
// A script reads one when it runs a command that reads a secret (tests/lib/secret_sources.ts) or
// holds a registered secret read (not an argv row: its secret never reaches a stdin), or when a
// doc or script line feeds a secret into it. A sourced mini/lib file's reads are its callers'.
const SCENARIOS = "tests/lib/canary.ts";
const SCENARIO = /\bscript:\s*"([^"]+)"/g;
export const guard: Guard = {
  name: "canary_scenarios",
  check(view) {
    const sourced = (f: string) => f.startsWith("mini/lib/") && !view.read(f).startsWith("#!");
    const scripts = scanned(view).filter((f) => isShipped(f) && shellKind(f, view.read(f)));
    const reads = loadSecretReads(view.read).filter((row) => !row.argv);
    const readers = new Set(reads.map((row) => row.file));
    const sources = shellSources(view).map((s) => ({ ...s, own: true }));
    const docs = scanned(view).filter((f) => f.endsWith(".md"));
    for (const file of docs)
      sources.push({ file, views: docShellViews(view.read(file)), own: false });
    for (const source of sources) {
      const scope = secretScope(source.views);
      for (const v of source.views) {
        const all = commands(v);
        const fed = stdinFed(all, scope);
        for (const command of all) {
          if (source.own && !sourced(source.file) && readsHere(command, scope)) {
            readers.add(source.file);
          }
          if (!fed.has(command)) continue;
          const words = [command.name, ...command.words].join(" ");
          for (const script of scripts) {
            const forms = [script, apmPath(script)].filter((w): w is string => w !== undefined);
            if (forms.some((form) => names(words, form))) readers.add(script);
          }
        }
      }
    }
    const listed = new Set(
      [...(view.files.includes(SCENARIOS) ? view.read(SCENARIOS) : "").matchAll(SCENARIO)].map(
        (m) => m[1],
      ),
    );
    const found: Violation[] = [];
    for (const file of [...readers].sort()) {
      if (!scripts.includes(file) || listed.has(file)) continue;
      found.push({
        file,
        line: 1,
        message: `reads a secret but has no canary scenario in ${SCENARIOS}`,
      });
    }
    return found;
  },
};
