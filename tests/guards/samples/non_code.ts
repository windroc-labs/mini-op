const registry = (rows: object[]) => JSON.stringify(rows);

export const violation = {
  "tests/registry/non-code.json": registry([
    { file: "host/gone.yaml", reason: "removed", tests: ["tests/host/x.test.ts"] },
    { file: "host/start", reason: "a script", tests: ["tests/host/x.test.ts"] },
    { file: "host/a.yaml", reason: "", tests: [] },
    { file: "host/b.yaml", reason: "policy", tests: ["tests/host/missing.test.ts"] },
    { file: "host/c.yaml", reason: "policy", tests: ["tests/host/x.test.ts"] },
  ]),
  "host/start": "#!/usr/bin/env bash\n",
  "host/a.yaml": "x: 1\n",
  "host/b.yaml": "x: 1\n",
  "host/c.yaml": "x: 1\n",
  "host/unlisted.conf": "x\n",
  "tests/host/x.test.ts": "// reads b.yaml only\n",
};

export const clean = {
  "tests/registry/non-code.json": registry([
    { file: "host/Dockerfile", reason: "image", tests: ["tests/host/Dockerfile.test.ts"] },
  ]),
  "host/Dockerfile": "FROM x\n",
  "tests/host/Dockerfile.test.ts": 'read("host/Dockerfile");\n',
  "host/README.md": "# docs\n",
  "host/update": "#!/usr/bin/env bash\n",
  "ctl/lib/ssh.zsh": "f() {}\n",
  "mini/js/type.js": "function run() {}\n",
  "mini/ts/keys.ts": "export {};\n",
  "runbooks/test-board.toml": "x = 1\n",
};

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  "tests/registry/non-code.json:1: host/gone.yaml no longer exists; remove its row",
  "tests/registry/non-code.json:1: host/start is code; remove its row",
  "tests/registry/non-code.json:1: host/a.yaml has no reason",
  "tests/registry/non-code.json:1: host/a.yaml has no covering test",
  "tests/registry/non-code.json:1: host/b.yaml: tests/host/missing.test.ts does not exist",
  "tests/registry/non-code.json:1: host/c.yaml: tests/host/x.test.ts does not name c.yaml",
  "host/unlisted.conf:1: not in tests/registry/non-code.json",
];
