const disable = "# shellcheck " + "disable=SC2016";
const ignore = "// @ts-" + "ignore";

export const violation = {
  "tests/registry/suppressions.json": JSON.stringify([
    { file: "scripts/a", text: "shellcheck disable=SC2016", reason: "" },
    { file: "scripts/gone", text: "shellcheck disable=SC2086", reason: "stale" },
    { file: "scripts/b", text: "shellcheck disable=SC2016", reason: "used twice" },
  ]),
  "scripts/a": `#!/bin/bash\n${disable}\necho '$x'\n`,
  "scripts/b": `#!/bin/bash\n${disable}\n${disable}\n`,
  "tests/x.ts": `${ignore}\nconst x: number = "1";\n`,
  "tests/y.ts": "/* node:coverage " + "ignore next */\n",
};

export const clean = {
  "tests/registry/suppressions.json": JSON.stringify([
    {
      file: "scripts/a",
      text: "shellcheck disable=SC2016",
      reason: "the $x is for the remote shell",
    },
  ]),
  "scripts/a": `#!/bin/bash\n${disable}\necho '$x'\n`,
  "README.md": `Never write ${ignore} without registering it.\n`,
};

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  "tests/registry/suppressions.json:1: scripts/a: shellcheck disable=SC2016 has no reason",
  "tests/registry/suppressions.json:1: scripts/gone: shellcheck disable=SC2086 is used 0 times, must be once",
  "tests/registry/suppressions.json:1: scripts/b: shellcheck disable=SC2016 is used 2 times, must be once",
  "tests/x.ts:1: @ts-ignore is not registered in tests/registry/suppressions.json",
  "tests/y.ts:1: node:coverage ignore is not registered in tests/registry/suppressions.json",
];
