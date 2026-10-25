const registry = (rows: object[]) => JSON.stringify(rows);
const asserts = (codes: number[]) =>
  codes.map((code) => `assert.equal(r.code, ${code}, r.stderr);\n`).join("");

export const violation = {
  "tests/registry/untested.json": registry([{ file: "mini/bin/ans", reason: "E10" }]),
  "ctl/a": "#!/usr/bin/env zsh\nexit 1\n",
  "tests/ctl/a.test.ts": asserts([0, 1]),
  "mini/bin/wait": "#!/usr/bin/env zsh\nexit 124\n",
  "tests/mini/bin/wait.test.ts": asserts([0, 1, 2]),
  ".github/x.ts": "process.exit(2);\n",
  "tests/github/x.test.ts": "assert.notEqual(r.code, 0);\nassert.equal(code, 1);\n",
  "mini/bin/keys": "#!/usr/bin/env zsh\n. ~/apm/lib/timeout.zsh\nwith_timeout 15 osascript k.js\n",
  "tests/mini/bin/keys.test.ts": asserts([0, 1, 2]),
  "mini/bin/land": "#!/usr/bin/env zsh\n. ~/apm/lib/timeout.zsh\npoll 10 0.5 landed\n",
  "tests/mini/bin/land.test.ts": asserts([0, 1, 2]),
  "mini/bin/ans": "#!/usr/bin/env zsh\nexit 124\n",
  "tests/mini/bin/ans.test.ts": "\n",
  "mini/ts/keys.ts": "function run(): string {\n  return '';\n}\n",
  "tests/mini/ts/keys.test.ts": asserts([0]),
};

export const clean = {
  "tests/registry/untested.json": registry([]),
  "ctl/a": "#!/usr/bin/env zsh\nexit 1\n",
  "tests/ctl/a.test.ts": asserts([0, 1, 2]),
  "mini/bin/wait": "#!/usr/bin/env zsh\nexit 124\n",
  "tests/mini/bin/wait.test.ts":
    asserts([0, 1, 2]) + "assert.strictEqual(result.code, 124);\nassert.equal(x?.code, 0);\n",
  "mini/bin/keys": "#!/usr/bin/env zsh\n. ~/apm/lib/timeout.zsh\nwith_timeout 15 osascript k.js\n",
  "tests/mini/bin/keys.test.ts": asserts([0, 1, 2, 124]),
  "mini/bin/land": "#!/usr/bin/env zsh\n. ~/apm/lib/timeout.zsh\npoll 10 0.5 landed\n",
  "tests/mini/bin/land.test.ts": asserts([0, 1, 2, 124]),
  "ctl/untested": "#!/usr/bin/env zsh\n",
  "mini/ts/keys.ts": "function run(): string {\n  return '';\n}\n",
  "tests/mini/ts/keys.test.ts": asserts([0, 1]),
};

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  "tests/ctl/a.test.ts:1: no test asserts exit 2 of ctl/a",
  "tests/mini/bin/wait.test.ts:1: no test asserts exit 124 of mini/bin/wait",
  "tests/github/x.test.ts:1: no test asserts exit 0 of .github/x.ts",
  "tests/github/x.test.ts:1: no test asserts exit 1 of .github/x.ts",
  "tests/github/x.test.ts:1: no test asserts exit 2 of .github/x.ts",
  "tests/mini/ts/keys.test.ts:1: no test asserts exit 1 of mini/ts/keys.ts",
  "tests/mini/bin/keys.test.ts:1: no test asserts exit 124 of mini/bin/keys",
  "tests/mini/bin/land.test.ts:1: no test asserts exit 124 of mini/bin/land",
];
