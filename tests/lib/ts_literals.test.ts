import assert from "node:assert/strict";
import { test } from "node:test";
import { lineAt } from "./guard.ts";
import { tsArgvArrays, tsStrings } from "./ts_literals.ts";

test("tsStrings: bodies unescaped, templates keep ${…}, comments and regexes skipped", () => {
  const text = [
    "// 'not a string'",
    'const a = "x\\n\\"y\\"";',
    "const b = `run ${dir}/z ${`in`}`;",
    "const r = /[\"'`]/g; /* 'no' */ const c = 'it\\'s';",
    'const d = x / 2; const e = "/";',
  ].join("\n");
  const found = tsStrings(text).map((s) => [s.body, lineAt(text, s.at(0))]);
  assert.deepEqual(found, [
    ['x\n"y"', 2],
    ["run ${dir}/z ${`in`}", 3],
    ["in", 3],
    ["it's", 4],
    ["/", 5],
  ]);
});

test("tsArgvArrays: arrays opening with a string, each element literal or expression", () => {
  const text = 'run(["rm", "-rf", dir, `${x}/y`, "a,b"]);\nconst k = [1, "x"];\nf(["tmux"]);\n';
  assert.deepEqual(
    tsArgvArrays(text).map((a) => [a.elements, lineAt(text, a.index)]),
    [
      [
        [
          { literal: "rm" },
          { literal: "-rf" },
          { expr: "dir" },
          { expr: "`${x}/y`" },
          { literal: "a,b" },
        ],
        1,
      ],
      [[{ literal: "tmux" }], 3],
    ],
  );
});
