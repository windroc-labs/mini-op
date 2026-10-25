// node .github/coverage.ts [--root <dir>] [--base <ref>] [--trace <dir> --lcov <file>]: run the
// suite with shell tracing and TS coverage (or read the given trace dir and lcov file), then
// require every managed file to have run (FR-27) and 85% of the TS (FR-29) and shell (FR-30)
// changed since the merge base with <ref> (default $COVERAGE_BASE, else origin/main) covered. An
// all-zero <ref>, a push's base when it creates its branch, counts every line as changed.
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { managedFiles } from "../tests/lib/managed.ts";
import { REPO, fromRoot } from "../tests/lib/repo.ts";
import {
  changedLines,
  neverRan,
  parseLcov,
  parseTrace,
  passes,
  percent,
  shellGate,
  tsGate,
} from "./lib/coverage.ts";

const USAGE = "usage: coverage [--root <dir>] [--base <ref>] [--trace <dir> --lcov <file>]";
const FLAGS = [
  "--experimental-test-coverage",
  "--test-reporter=spec",
  "--test-reporter-destination=stdout",
  "--test-reporter=lcov",
];

function usage(message: string): never {
  process.stderr.write(`coverage: ${message}\n${USAGE}\n`);
  process.exit(2);
}

function parse() {
  try {
    return parseArgs({
      options: {
        root: { type: "string" },
        base: { type: "string" },
        trace: { type: "string" },
        lcov: { type: "string" },
      },
    }).values;
  } catch (err) {
    usage(err instanceof Error ? err.message : String(err));
  }
}

const values = parse();
if ((values.trace === undefined) !== (values.lcov === undefined)) {
  usage("--trace and --lcov go together");
}
const root = fs.realpathSync(path.resolve(values.root ?? REPO));
const base = values.base || process.env.COVERAGE_BASE || "origin/main";

function git(...args: string[]): { ok: boolean; out: string } {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  return { ok: r.status === 0, out: r.stdout ?? "" };
}

// No commit came before an all-zero base: diff from the empty tree.
const diffBase = /^(0{40}|0{64})$/.test(base)
  ? git("hash-object", "-t", "tree", "/dev/null")
  : git("merge-base", base, "HEAD");
if (!diffBase.ok) usage(`cannot resolve base ${base}; fetch it or pass --base`);

// The repo's own test command, with node's coverage reporters added after --test.
function runSuite(trace: string, lcov: string): boolean {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const words = String(pkg.scripts?.test ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.replace(/^'(.*)'$/, "$1"));
  const at = words.indexOf("--test") + 1;
  if (at === 0) usage("package.json scripts.test does not run node --test");
  words.splice(at, 0, ...FLAGS, `--test-reporter-destination=${lcov}`);
  const [command = "", ...args] = words;
  const r = spawnSync(command === "node" ? process.execPath : command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, MINI_OP_TRACE: trace },
  });
  return r.status === 0;
}

let traceDir = values.trace;
let lcovFile = values.lcov;
let temp: string | undefined;
if (traceDir === undefined || lcovFile === undefined) {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "mini-op-coverage-"));
  traceDir = path.join(temp, "trace");
  lcovFile = path.join(temp, "lcov.info");
  fs.mkdirSync(traceDir);
  if (!runSuite(traceDir, lcovFile)) {
    process.stderr.write("coverage: tests failed\n");
    process.exit(1);
  }
}

const traceText = fs
  .readdirSync(traceDir)
  .map((file) => fs.readFileSync(path.join(traceDir, file), "utf8"))
  .join("\n");
const trace = parseTrace(traceText, root);
const lcov = parseLcov(fs.existsSync(lcovFile) ? fs.readFileSync(lcovFile, "utf8") : "", root);
if (temp) fs.rmSync(temp, { recursive: true, force: true });

const view = fromRoot(root);
const changed = changedLines(
  git("diff", "-U0", "--no-color", "--no-ext-diff", diffBase.out.trim()).out,
);
for (const file of [...changed.keys()]) if (!view.files.includes(file)) changed.delete(file);

let failed = false;
for (const file of neverRan(managedFiles(view), trace, lcov, view.read)) {
  process.stdout.write(`coverage: ${file} never ran\n`);
  failed = true;
}
const gates = [
  ["TS changed lines+branches", tsGate(changed, lcov, view.read)],
  ["shell changed statements", shellGate(changed, trace, view.read)],
] as const;
for (const [label, gate] of gates) {
  process.stdout.write(`coverage: ${label} ${gate.covered}/${gate.total} (${percent(gate)}%)\n`);
  for (const miss of gate.misses) process.stdout.write(`coverage: ${miss} not covered\n`);
  if (!passes(gate)) failed = true;
}
process.exitCode = failed ? 1 : 0;
