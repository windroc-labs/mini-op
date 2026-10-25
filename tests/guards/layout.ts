import type { Guard, Violation } from "../lib/guard.ts";

// Files sit by where they run (README.md › Layout). Root: the docs and tool configs only.
const ROOT = new Set([
  "README.md",
  "status.md",
  ".gitignore",
  ".node-version",
  ".prettierrc.json",
  "_typos.toml",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
]);
const FREE = [".github/", ".githooks/", "tests/"];

function problem(file: string, files: Set<string>, script: () => boolean): string | null {
  if (!file.includes("/"))
    return ROOT.has(file) ? null : "the root holds only docs and tool configs";
  if (FREE.some((dir) => file.startsWith(dir))) return null;
  const top = file.slice(0, file.indexOf("/"));
  const rest = file.slice(top.length + 1);
  switch (top) {
    case "runbooks":
      if (!/^[^/]+\.(md|toml)$/.test(rest) || script()) return "runbooks/ holds docs and data only";
      return null;
    case "mini": {
      if (
        /^bin\/[^/]+$/.test(rest) ||
        /^js\/(page\/)?[^/]+\.js$/.test(rest) ||
        /^(lib|ts)\/./.test(rest)
      ) {
        return null;
      }
      const runbook = /^runbooks\/([^/]+)\/[^/]+$/.exec(rest)?.[1];
      if (runbook === undefined)
        return "mini/ holds bin/, js/*.js, js/page/*.js, lib/, ts/ and runbooks/<runbook>/";
      return files.has(`runbooks/${runbook}.md`)
        ? null
        : `no runbooks/${runbook}.md for this script`;
    }
    case "ctl":
      if (/^lib\/[^/]+$/.test(rest) || rest === "CLAUDE.md") return null;
      return /^[^/]+$/.test(rest) && script() ? null : "ctl/ holds scripts, CLAUDE.md and lib/";
    case "host":
      return /^(proxy\/)?[^/]+$/.test(rest) ? null : "host/ holds its files and proxy/";
    case "plugin":
      return /^(\.claude-plugin\/plugin\.json|skills\/[^/]+\/SKILL\.md)$/.test(rest)
        ? null
        : "plugin/ holds .claude-plugin/plugin.json and skills/<name>/SKILL.md";
    default:
      return `${top}/ is not a layout dir (mini/, ctl/, host/, plugin/, runbooks/, tests/)`;
  }
}

export const guard: Guard = {
  name: "layout",
  check(view) {
    const found: Violation[] = [];
    const files = new Set(view.files);
    for (const file of view.files) {
      const message = problem(file, files, () => view.read(file).startsWith("#!"));
      if (message) found.push({ file, line: 1, message });
    }
    return found;
  },
};
