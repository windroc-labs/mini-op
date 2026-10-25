// node .github/format.ts [--root <dir>] [--tools <dir>] [--write | --staged] [-- <files>]:
// check (--write: rewrite) TS with prettier and bash with shfmt, keeping bash lines within 100
// columns. --staged formats and re-adds the staged files (the pre-commit hook).
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import * as prettier from "prettier";
import { REPO, fromRoot, shellKind } from "../tests/lib/repo.ts";
import { TOOLS_DIR, ToolMissing, toolPath } from "./lib/tools.ts";

const WIDTH = 100;
const SHFMT_FLAGS = ["-i", "2", "-ci", "-ln", "bash"];

const USAGE = "usage: format [--root <dir>] [--tools <dir>] [--write | --staged] [-- <files>]";

function parse() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        root: { type: "string" },
        tools: { type: "string" },
        write: { type: "boolean", default: false },
        staged: { type: "boolean", default: false },
      },
    });
  } catch (err) {
    process.stderr.write(`format: ${err instanceof Error ? err.message : String(err)}\n${USAGE}\n`);
    process.exit(2);
  }
}
const { values, positionals } = parse();
const root = path.resolve(values.root ?? REPO);
const toolsDir = values.tools ?? TOOLS_DIR;
const options = JSON.parse(fs.readFileSync(path.join(REPO, ".prettierrc.json"), "utf8"));

function fail(message: string): never {
  process.stderr.write(`format: ${message}\n`);
  process.exit(1);
}

let shfmt: string | undefined;
function shfmtPath(): string {
  try {
    shfmt ??= toolPath("shfmt", toolsDir);
    return shfmt;
  } catch (err) {
    if (err instanceof ToolMissing) fail(err.message);
    throw err;
  }
}

// The formatted text of a file, or undefined when no formatter covers it.
async function formatted(file: string, text: string): Promise<string | undefined> {
  if (file.endsWith(".ts")) return prettier.format(text, { ...options, filepath: file });
  if (shellKind(file, text) !== "bash") return undefined;
  const r = spawnSync(shfmtPath(), SHFMT_FLAGS, { input: text, encoding: "utf8" });
  if (r.status !== 0) fail(`shfmt ${file}: ${r.stderr.trim()}`);
  return r.stdout;
}

function git(...args: string[]): string {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (r.status !== 0) fail(`git ${args.join(" ")}: ${r.stderr.trim()}`);
  return r.stdout;
}

const covered = (file: string, text: string) =>
  file.endsWith(".ts") || shellKind(file, text) === "bash";
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const nul = (out: string) => out.split("\0").filter(Boolean);

// The pre-commit hook's files: staged bash and TS, refused when they also have unstaged changes,
// since formatting and re-adding them would commit those changes too.
function stagedFiles(): string[] {
  const staged = nul(git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"));
  const files = staged.filter((file) => covered(file, read(file)));
  if (files.length === 0) return [];
  const dirty = nul(git("diff", "--name-only", "-z", "--", ...files));
  for (const file of dirty) {
    process.stderr.write(`pre-commit: ${file} has unstaged changes; stage or stash them\n`);
  }
  if (dirty.length > 0) process.exit(1);
  return files;
}

const write = values.write || values.staged;
const files = values.staged
  ? stagedFiles()
  : positionals.length > 0
    ? positionals
    : fromRoot(root).files;
const changed: string[] = [];
let failed = false;
for (const file of files) {
  const text = read(file);
  const out = await formatted(file, text);
  if (out === undefined) continue;
  if (out !== text) {
    if (write) {
      fs.writeFileSync(path.join(root, file), out);
      changed.push(file);
    } else {
      process.stdout.write(`format: ${file} is not formatted\n`);
      failed = true;
    }
  }
  if (!file.endsWith(".ts")) {
    out.split("\n").forEach((line, i) => {
      if (line.length <= WIDTH) return;
      process.stdout.write(`format: ${file}:${i + 1}: line longer than ${WIDTH}\n`);
      failed = true;
    });
  }
}
if (values.staged && changed.length > 0) {
  git("add", "--", ...changed);
  for (const file of changed) process.stderr.write(`pre-commit: formatted ${file}\n`);
}
process.exitCode = failed ? 1 : 0;
