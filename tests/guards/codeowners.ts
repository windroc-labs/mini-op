import type { Guard, Violation } from "../lib/guard.ts";
import { scanned } from "../lib/repo.ts";

const FILE = ".github/CODEOWNERS";
const OWNER = "@windroc";
// CI, the guards and their registries, the sandbox, and the tool settings and pins.
const PROTECTED_DIRS = [".github/", ".githooks/", "tests/guards/", "tests/registry/", "tests/lib/"];
const PROTECTED_FILES = new Set([
  "tsconfig.json",
  ".prettierrc.json",
  "_typos.toml",
  ".node-version",
  "package.json",
  "package-lock.json",
]);

type Rule = { pattern: RegExp; owners: string[] };

// The CODEOWNERS (gitignore-style) subset this repo uses: anchored or basename patterns, `*`,
// `**`, and a trailing `/` for a directory.
function compile(pattern: string): RegExp {
  const anchored = pattern.startsWith("/") || pattern.slice(0, -1).includes("/");
  const dir = pattern.endsWith("/");
  const body = pattern
    .replace(/^\//, "")
    .replace(/\/$/, "")
    .split("**")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"))
    .join(".*");
  return new RegExp(`${anchored ? "^" : "(^|/)"}${body}${dir ? "/" : "(/|$)"}`);
}

function rules(text: string): Rule[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [pattern = "", ...owners] = line.split(/\s+/);
      return { pattern: compile(pattern), owners };
    });
}

export const guard: Guard = {
  name: "codeowners",
  check(view) {
    const found: Violation[] = [];
    const files = scanned(view).filter(
      (file) => PROTECTED_FILES.has(file) || PROTECTED_DIRS.some((dir) => file.startsWith(dir)),
    );
    if (files.length === 0) return found;
    if (!view.files.includes(FILE)) {
      return [{ file: FILE, line: 1, message: "missing; CI and tool settings need an owner" }];
    }
    const list = rules(view.read(FILE));
    for (const file of files) {
      const rule = list.filter((r) => r.pattern.test(file)).at(-1);
      if (!rule?.owners.includes(OWNER)) {
        found.push({ file, line: 1, message: `no ${FILE} rule makes ${OWNER} its owner` });
      }
    }
    return found;
  },
};
