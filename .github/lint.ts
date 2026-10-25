// node .github/lint.ts [--root <dir>] [--tools <dir>]: syntax-check every shell file by its
// shebang (zsh -n; bash -n and shellcheck; sh -n and shellcheck), then actionlint and typos.
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { REPO, fromRoot, shellKind } from "../tests/lib/repo.ts";
import { TOOLS_DIR, ToolMissing, toolPath } from "./lib/tools.ts";

const USAGE = "usage: lint [--root <dir>] [--tools <dir>]";

function parse() {
  try {
    return parseArgs({
      options: { root: { type: "string" }, tools: { type: "string" } },
    });
  } catch (err) {
    process.stderr.write(`lint: ${err instanceof Error ? err.message : String(err)}\n${USAGE}\n`);
    process.exit(2);
  }
}
const { values } = parse();
const root = path.resolve(values.root ?? REPO);
const toolsDir = values.tools ?? TOOLS_DIR;

let tools: Record<"shellcheck" | "actionlint" | "typos", string>;
try {
  tools = {
    shellcheck: toolPath("shellcheck", toolsDir),
    actionlint: toolPath("actionlint", toolsDir),
    typos: toolPath("typos", toolsDir),
  };
} catch (err) {
  if (!(err instanceof ToolMissing)) throw err;
  process.stderr.write(`lint: ${err.message}\n`);
  process.exit(1);
}

const view = fromRoot(root);
let failed = false;

function check(label: string, command: string, args: string[]): void {
  const r = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PATH: `${path.dirname(tools.shellcheck)}:${process.env.PATH ?? ""}` },
  });
  if (r.status === 0) return;
  failed = true;
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? r.error.message : ""}`.trimEnd();
  process.stdout.write(`lint: ${label}:\n${output}\n`);
}

for (const file of view.files) {
  const kind = shellKind(file, view.read(file));
  if (!kind) continue;
  const abs = path.join(root, file);
  check(`${kind} -n ${file}`, kind, ["-n", abs]);
  if (kind !== "zsh") check(`shellcheck ${file}`, tools.shellcheck, ["-s", kind, "--", abs]);
}
const workflows = view.files.filter((file) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(file));
if (workflows.length > 0) {
  check("actionlint", tools.actionlint, ["--", ...workflows.map((f) => path.join(root, f))]);
}
check("typos", tools.typos, [
  "--force-exclude",
  "--",
  ...view.files.map((f) => path.join(root, f)),
]);
process.exitCode = failed ? 1 : 0;
