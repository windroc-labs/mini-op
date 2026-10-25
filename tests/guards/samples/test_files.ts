const script = "#!/usr/bin/env zsh\ntrue\n";
const registry = (rows: object[]) => JSON.stringify(rows);

export const violation = {
  "tests/registry/untested.json": registry([{ file: "mini/bin/ans", reason: "E10" }]),
  "mini/bin/ans": script,
  "ctl/untested": script,
  ".github/tool.ts": "\n",
  "mini/ts/click.ts": 'function run(): string {\n  return "";\n}\n',
  "tests/ghost.test.ts": "\n",
};

export const clean = {
  "tests/registry/untested.json": registry([]),
  "mini/bin/ans": script,
  "tests/mini/bin/ans.test.ts": "\n",
  "ctl/x": script,
  "tests/ctl/x.test.ts": "\n",
  ".github/format.ts": "\n",
  "tests/github/format.test.ts": "\n",
  ".github/lib/tools.ts": "\n",
  ".githooks/pre-commit": "#!/usr/bin/env bash\n",
  "tests/githooks/pre-commit.test.ts": "\n",
  "ctl/lib/ssh.zsh": "f() {}\n",
  "tests/ctl/lib/ssh.test.ts": "\n",
  "host/ssh_config": "Host mini\n",
  "tests/host/ssh_config.test.ts": "\n",
  "tsconfig.json": "{}\n",
  "tests/tsconfig.test.ts": "\n",
  "tests/guards/run.ts": "\n",
  "tests/guards/run.test.ts": "\n",
  "tests/guards/samples/x.ts": "\n",
  "tests/guards/samples.test.ts": "\n",
  "mini/ts/jxa.d.ts": "\n",
  "mini/js/click.js": "function run() {}\n",
};

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  "tests/registry/untested.json:1: lists mini/bin/ans; the list stays empty: write its test",
  "ctl/untested:1: no test at tests/ctl/untested.test.ts",
  ".github/tool.ts:1: no test at tests/github/tool.test.ts",
  "mini/ts/click.ts:1: no test at tests/mini/ts/click.test.ts",
  "tests/ghost.test.ts:1: tests no existing file",
];
