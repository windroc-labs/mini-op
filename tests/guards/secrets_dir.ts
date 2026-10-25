import { lineAt, type Guard, type Violation } from "../lib/guard.ts";
import { loadSecrets } from "../lib/registry.ts";
import { isShipped, scanned } from "../lib/repo.ts";

const REGISTRY = "tests/registry/secrets.json";
const VARIABLE = "MINI_OP_SECRETS_DIR";
const RESOLVER = "ctl/lib/secrets.zsh";
const LITERAL = "/run/" + "secrets";
// The environment's secrets dir (AC9b): named only by the resolver, the ssh settings and docs.
const ENV_LITERAL = "/run/ensemble/" + "secrets/env";
const ENV_NAMERS = new Set([RESOLVER, "host/ssh_config.keys"]);
// The direct users of the literal left after E2 put ctl/'s readers on the resolver. A move may
// rename a row (same count, same commit); a new file may never be added: new code goes through the
// resolver.
const BASELINE = new Set(["host/start", "host/stop"]);
const SETS = new RegExp(
  `(?:^|[^A-Za-z0-9_])(?:(?:export|typeset|declare|local|readonly)\\s+(?:-\\S+\\s+)*${VARIABLE}\\b|${VARIABLE}:?=)`,
  "g",
);

export const guard: Guard = {
  name: "secrets_dir",
  check(view) {
    const found: Violation[] = [];
    const registry = loadSecrets(view.read);
    const at = (message: string) => found.push({ file: REGISTRY, line: 1, message });
    if (registry.variable !== VARIABLE || registry.resolver !== RESOLVER) {
      at(`the override must stay ${VARIABLE}, resolved only in ${RESOLVER}`);
    }
    const listed = new Set(registry.literal.map((entry) => entry.file));
    for (const entry of registry.literal) {
      if (!BASELINE.has(entry.file)) at(`${entry.file} is not in E1's baseline; use the resolver`);
      if (!entry.reason?.trim()) at(`${entry.file} has no reason`);
      if (!view.files.includes(entry.file) || !view.read(entry.file).includes(LITERAL)) {
        at(`${entry.file} no longer names ${LITERAL}; remove its row`);
      }
    }
    for (const file of scanned(view)) {
      const text = view.read(file);
      const env = text.indexOf(ENV_LITERAL);
      if (env >= 0 && !ENV_NAMERS.has(file) && !file.endsWith(".md")) {
        found.push({
          file,
          line: lineAt(text, env),
          message: `names ${ENV_LITERAL}; use env_secrets_dir`,
        });
      }
      const tests = file.startsWith("tests/");
      if (!tests && !isShipped(file)) continue;
      const literal = text.indexOf(LITERAL);
      if (literal >= 0 && (tests || (file !== RESOLVER && !listed.has(file)))) {
        found.push({
          file,
          line: lineAt(text, literal),
          message: `names ${LITERAL}; use secrets_dir`,
        });
      }
      if (tests) continue;
      const named = text.indexOf(VARIABLE);
      if (named >= 0 && file !== RESOLVER) {
        found.push({
          file,
          line: lineAt(text, named),
          message: `names ${VARIABLE} outside ${RESOLVER}`,
        });
      }
      for (const match of text.matchAll(SETS)) {
        found.push({
          file,
          line: lineAt(text, match.index + match[0].indexOf(VARIABLE)),
          message: `sets ${VARIABLE}`,
        });
      }
    }
    return found;
  },
};
