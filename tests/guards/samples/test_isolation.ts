const cp = '"node:' + 'child_process"';

export const violation = {
  "tests/registry/isolation-exempt.json": '["tests/a.test.ts"]',
  "tests/a.test.ts": `import { execFileSync } from ${cp};\n`,
  "tests/x/helpers.ts": `import * as cp from ${cp};\n`,
  "tests/b.test.ts": 'import net from "net";\nconst h = await import("node:https");\n',
  "tests/github/format.test.ts": 'import { main } from "../../.github/format.ts";\n',
  "tests/c.test.ts": "const b = process." + "binding('fs');\n",
  "tests/d.test.ts": "const cp = process.getBuiltinModule(" + cp + ");\n",
  "tests/e.test.ts": "const cp = await import(`node:" + "child_process`);\n",
};

export const clean = {
  "tests/registry/isolation-exempt.json": "[]\n",
  "tests/lib/sandbox.ts": `import { spawn } from ${cp};\n`,
  "tests/lib/repo.ts": `import { execFileSync } from ${cp};\n`,
  "tests/lib/fake.ts": `import { spawnSync } from ${cp};\n`,
  "tests/a.test.ts":
    'import * as fs from "node:fs";\nimport { Sandbox } from "./lib/sandbox.ts";\n',
  ".github/lint.ts": `import { execFileSync } from ${cp};\n`,
};

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  "tests/registry/isolation-exempt.json:1: the sandbox exemption list must stay empty",
  "tests/a.test.ts:1: imports node:child_process; run processes through Sandbox.run",
  "tests/b.test.ts:1: imports net; run processes through Sandbox.run",
  "tests/b.test.ts:2: imports node:https; run processes through Sandbox.run",
  "tests/c.test.ts:1: uses process bindings",
  "tests/d.test.ts:1: imports node:child_process; run processes through Sandbox.run",
  "tests/e.test.ts:1: imports node:child_process; run processes through Sandbox.run",
  "tests/github/format.test.ts:1: imports ../../.github/format.ts from outside tests/; run it in a Sandbox",
  "tests/x/helpers.ts:1: imports node:child_process; run processes through Sandbox.run",
];
