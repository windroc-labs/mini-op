import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox } from "../lib/sandbox.ts";

const COVERAGE = path.join(REPO, ".github/coverage.ts");
const TEST_SCRIPT = "node --test --test-timeout=60000 'tests/**/*.test.ts'";

// Every statement kind statements() joins, and the lines bash and zsh report for each.
const KINDS = [
  "#!/usr/bin/env bash",
  "echo a \\",
  "  b \\",
  "  c",
  "echo x |",
  "  tr x y |",
  "  cat",
  "v=$(",
  "  echo sub",
  ")",
  "arr=(",
  "  one",
  "  two",
  ")",
  "cat <<'EOF'",
  "body 'x'",
  "EOF",
  "s='multi",
  "line'",
  "case $1 in",
  "  a) echo A ;;",
  "  *)",
  "    echo star",
  "    ;;",
  "esac",
  "if true; then",
  "  :",
  "fi",
  "",
].join("\n");
const BASH_LINES = [2, 5, 10, 14, 15, 18, 20, 23, 26, 27];
const ZSH_LINES = [2, 5, 8, 11, 15, 18, 20, 21, 23, 26, 27];

type Fixture = {
  sb: Sandbox;
  root: string;
  base: string;
  trace: string;
  lcov: string;
  run: (...args: string[]) => ReturnType<Sandbox["run"]>;
};

// A git repo whose second commit adds `files`; trace and lcov start empty.
async function fixture(
  t: Parameters<typeof Sandbox.create>[0],
  files: Record<string, string>,
  untested: string[] = [],
  baseFiles: Record<string, string> = {},
): Promise<Fixture> {
  const sb = await Sandbox.create(t, { trace: "" });
  const root = path.join(sb.dir, "repo");
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text, { mode: text.startsWith("#!") ? 0o755 : 0o644 });
  };
  const git = (...args: string[]) =>
    sb.run(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
      cwd: root,
    });
  write("README.md", "x\n");
  write("package.json", JSON.stringify({ type: "module", scripts: { test: TEST_SCRIPT } }));
  write(
    "tests/registry/untested.json",
    JSON.stringify(untested.map((file) => ({ file, reason: "later" }))),
  );
  for (const [file, text] of Object.entries(baseFiles)) write(file, text);
  await git("init", "-q");
  await git("add", "-A");
  await git("commit", "-qm", "base");
  const base = (await git("rev-parse", "HEAD")).stdout.trim();
  for (const [file, text] of Object.entries(files)) write(file, text);
  await git("add", "-A");
  await git("commit", "-qm", "head");
  const trace = path.join(sb.dir, "trace");
  fs.mkdirSync(trace);
  const lcov = path.join(sb.dir, "lcov.info");
  fs.writeFileSync(lcov, "");
  const run = (...args: string[]) =>
    sb.run(["node", COVERAGE, "--root", root, "--base", base, ...args], { timeoutMs: 60000 });
  return { sb, root, base, trace, lcov, run };
}

function traceLines(f: Fixture, file: string, lines: number[]): void {
  const abs = path.join(f.root, file);
  fs.appendFileSync(path.join(f.trace, "a.trace"), lines.map((n) => `${abs}:${n}\n`).join(""));
}

const checked = (f: Fixture, ...args: string[]) =>
  f.run("--trace", f.trace, "--lcov", f.lcov, ...args);

test("unknown options and a lone --trace are usage errors", async (t) => {
  const f = await fixture(t, {});
  for (const args of [["--bogus"], ["--trace", f.trace], ["extra"]]) {
    const r = await f.run(...args);
    assert.equal(r.code, 2, args.join(" "));
    assert.match(r.stderr, /^coverage: /);
    assert.match(r.stderr, /usage: coverage \[--root <dir>\]/);
  }
});

test("an unresolvable base is a usage error naming it", async (t) => {
  const f = await fixture(t, {});
  const r = await f.sb.run(
    [
      "node",
      COVERAGE,
      "--root",
      f.root,
      "--base",
      "no-such-ref",
      "--trace",
      f.trace,
      "--lcov",
      f.lcov,
    ],
    { timeoutMs: 60000 },
  );
  assert.equal(r.code, 2);
  assert.match(r.stderr, /coverage: cannot resolve base no-such-ref/);
});

// A push that creates its branch sends the all-zero SHA as its base: every line counts as changed.
const UNTRACED = { "host/old": "#!/usr/bin/env bash\necho one\necho two\n" };
const ZERO = "0".repeat(40);

test("an all-zero base counts the base commit's lines as changed", async (t) => {
  const f = await fixture(t, {}, [], UNTRACED);
  traceLines(f, "host/old", [2]);
  const passing = await checked(f);
  assert.equal(passing.code, 0, passing.stdout + passing.stderr);
  assert.match(passing.stdout, /coverage: shell changed statements 0\/0/);
  const r = await checked(f, "--base", ZERO);
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stdout, /coverage: shell changed statements 1\/2 \(50\.0%\)/);
  assert.match(r.stdout, /coverage: host\/old:3 not covered/);
});

test("an all-zero COVERAGE_BASE with no --base does the same", async (t) => {
  const f = await fixture(t, {}, [], UNTRACED);
  traceLines(f, "host/old", [2]);
  const args = ["--root", f.root, "--trace", f.trace, "--lcov", f.lcov];
  const r = await f.sb.run(["node", COVERAGE, ...args], {
    env: { COVERAGE_BASE: ZERO },
    timeoutMs: 60000,
  });
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stdout, /coverage: host\/old:3 not covered/);
});

test("statements count once whichever line bash or zsh reports", async (t) => {
  const bash = await fixture(t, { "host/kinds": KINDS });
  traceLines(bash, "host/kinds", BASH_LINES);
  const rb = await checked(bash);
  assert.equal(rb.code, 0, rb.stdout + rb.stderr);
  assert.match(rb.stdout, /coverage: shell changed statements 10\/11 \(90\.9%\)/);
  assert.match(rb.stdout, /coverage: host\/kinds:21 not covered/);
  const zsh = await fixture(t, { "host/kinds": KINDS });
  traceLines(zsh, "host/kinds", ZSH_LINES);
  const rz = await checked(zsh);
  assert.equal(rz.code, 0, rz.stdout + rz.stderr);
  assert.match(rz.stdout, /coverage: shell changed statements 11\/11 \(100\.0%\)/);
});

test("an untraced shell statement below the threshold fails", async (t) => {
  const f = await fixture(t, {
    "host/x": '#!/usr/bin/env bash\necho one\nif [ -n "$1" ]; then\n  echo two\nfi\n',
  });
  traceLines(f, "host/x", [2, 3]);
  const r = await checked(f);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /coverage: shell changed statements 2\/3 \(66\.7%\)/);
  assert.match(r.stdout, /coverage: host\/x:4 not covered/);
});

test("a managed file that never ran fails", async (t) => {
  const f = await fixture(t, { "ctl/idle": "#!/usr/bin/env zsh\nprint hi\n" });
  const r = await checked(f);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /coverage: ctl\/idle never ran/);
});

test("an allowlisted file that never ran is not required to", async (t) => {
  const f = await fixture(t, { "mini/bin/later": "#!/usr/bin/env zsh\n" }, ["mini/bin/later"]);
  const r = await checked(f);
  assert.equal(r.code, 0, r.stdout + r.stderr);
});

const TS =
  'export function f(x: number): string {\n  if (x > 0) return "pos";\n  return "neg";\n}\n';
const lcovFor = (file: string, da: number[], brda: number[]) =>
  [
    `SF:${file}`,
    ...da.map((count, i) => `DA:${i + 1},${count}`),
    ...brda.map((taken, i) => `BRDA:2,0,${i},${taken === -1 ? "-" : taken}`),
    "end_of_record",
    "",
  ].join("\n");

test("covered TS lines and branches pass", async (t) => {
  const f = await fixture(t, { ".github/t.ts": TS });
  fs.writeFileSync(f.lcov, lcovFor(path.join(f.root, ".github/t.ts"), [1, 1, 1, 1], [1, 1]));
  const r = await checked(f);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /coverage: TS changed lines\+branches 6\/6 \(100\.0%\)/);
});

test("an untested TS branch below the threshold fails", async (t) => {
  const f = await fixture(t, { ".github/t.ts": TS });
  fs.writeFileSync(f.lcov, lcovFor(path.join(f.root, ".github/t.ts"), [1, 1, 0, 1], [1, -1]));
  const r = await checked(f);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /coverage: TS changed lines\+branches 4\/6 \(66\.7%\)/);
  assert.match(r.stdout, /coverage: \.github\/t\.ts:3 not covered/);
  assert.match(r.stdout, /coverage: \.github\/t\.ts:2 branch not covered/);
});

test("a changed TS file with no lcov record counts as uncovered", async (t) => {
  const f = await fixture(t, { ".github/lib/u.ts": "// helper\n\nexport const u = 1;\n" });
  const r = await checked(f);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /coverage: TS changed lines\+branches 0\/1 \(0\.0%\)/);
  assert.match(r.stdout, /coverage: \.github\/lib\/u\.ts:3 not covered/);
});

test("run mode runs the suite with coverage; a failing suite fails", async (t) => {
  const pass = await fixture(t, {
    "tests/a.test.ts": 'import { test } from "node:test";\ntest("ok", () => {});\n',
  });
  const ok = await pass.run();
  assert.equal(ok.code, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /coverage: shell changed statements 0\/0/);
  const fail = await fixture(t, {
    "tests/a.test.ts":
      'import { test } from "node:test";\ntest("bad", () => {\n  throw new Error("x");\n});\n',
  });
  const bad = await fail.run();
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /coverage: tests failed/);
});

test("a closing keyword's redirect line is part of its compound command", async (t) => {
  const f = await fixture(t, {
    "host/loop":
      '#!/usr/bin/env bash\nwhile read -r l; do\n  echo "$l"\ndone <<<"x"\nif true; then\n  echo t\nfi >&2\n',
  });
  traceLines(f, "host/loop", [2, 3, 5, 6]);
  const r = await checked(f);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /coverage: shell changed statements 4\/4 \(100\.0%\)/);
});

test("an added line starting with ++ does not end its file's hunks", async (t) => {
  const old = "#!/usr/bin/env bash\necho one\ncat <<'EOF'\nEOF\necho two\necho three\necho four\n";
  const now =
    "#!/usr/bin/env bash\necho one\ncat <<'EOF'\n++ x\nEOF\necho two\necho three\necho changed\n";
  const f = await fixture(t, { "host/pp": now }, [], { "host/pp": old });
  traceLines(f, "host/pp", [2, 3, 6, 7]);
  const r = await checked(f);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /coverage: shell changed statements 1\/2 \(50\.0%\)/);
  assert.match(r.stdout, /coverage: host\/pp:8 not covered/);
});

test("a test script without --test is a usage error", async (t) => {
  const f = await fixture(t, { "package.json": JSON.stringify({ scripts: { test: "true" } }) });
  const r = await f.run();
  assert.equal(r.code, 2);
  assert.match(r.stderr, /coverage: package\.json scripts\.test does not run node --test/);
});

test("a command after a closing keyword on its line is still a statement", async (t) => {
  const f = await fixture(t, {
    "host/c": "#!/usr/bin/env bash\nif true; then\n  echo t\nfi; echo after\n",
  });
  traceLines(f, "host/c", [2, 3]);
  const r = await checked(f);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /coverage: shell changed statements 2\/3 \(66\.7%\)/);
  assert.match(r.stdout, /coverage: host\/c:4 not covered/);
});

test("a removed -- line before an added ++ line stays inside its hunk", async (t) => {
  const head = "#!/usr/bin/env bash\ncat <<'EOF'\n";
  const tail = "EOF\necho a\necho b\necho c\n";
  const old = `${head}-- old\n${tail}echo d\n`;
  const now = `${head}++ new\n${tail}echo changed\n`;
  const f = await fixture(t, { "host/q": now }, [], { "host/q": old });
  traceLines(f, "host/q", [2, 5, 6, 7]);
  const r = await checked(f);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /coverage: shell changed statements 1\/2 \(50\.0%\)/);
  assert.match(r.stdout, /coverage: host\/q:8 not covered/);
});
