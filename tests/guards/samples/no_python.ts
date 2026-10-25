export const violation = {
  "tests/test_x.py": "import unittest\n",
  ".github/helper.pyw": "",
  "tests/X.PY": "",
  "ctl/tool": "#!/usr/bin/env python3\nprint(1)\n",
  "host/tool2": "#!/usr/bin/python3.13\nprint(1)\n",
  "ctl/c": "#!/usr/bin/env zsh\n/usr/bin/python3 -c 1\nsudo python3 x\ncommand python3 y\n",
  "tests/z.test.ts": [
    'spawnSync("/usr/bin/python3", ["-c", "1"]);',
    'execSync("python3 script");',
    'execSync("env python3 x");',
    'spawnSync("sh", ["-c", "python3 x"]);',
    "",
  ].join("\n"),
  "ctl/a": '#!/usr/bin/env zsh\npython3 -c 1\nx=$(python -V); ssh mini "pip3 install x"\n',
  "host/b":
    "#!/usr/bin/env bash\nexec python3.13 -m http.server\nif PYTHONPATH=x python -V; then :; fi\n",
  "tests/x.test.ts": 'spawnSync("python3", ["-c", "1"]);\nrun(`python ${file}`);\n',
  ".github/workflows/ci.yml": [
    "jobs:",
    "  t:",
    "    steps:",
    "      - uses: actions/setup-python@0123 # v7",
    "      - run: python3 -m unittest",
    '      - run: echo "#" && pip3 install x',
    "",
  ].join("\n"),
};

export const clean = {
  "ctl/a": "#!/usr/bin/env zsh\n# never python3 here: the mini has none\nprint -r -- ok\n",
  "mini/lib/c.zsh": "# perl, not python3\nf() { perl -e 1; }\n",
  ".github/check": [
    "#!/usr/bin/env bash",
    'usage="check   the image has no python3"',
    "docker exec x sh -c '! command -v python3' || echo \"found python3\"",
    'row "no python3 on PATH"',
    "",
  ].join("\n"),
  "tests/x.test.ts":
    '// python3 is gone\nconst BANNED = /(python3?|node)/;\ntest("no python3 on PATH", f);\n',
  ".github/workflows/ci.yml":
    "jobs:\n  t:\n    steps:\n      # python3 left in E10\n      - run: npm test\n",
  "README.md": "Run nothing that calls `python3` on the mini.\n",
  "host/Dockerfile": "RUN apt-get install -y python3\n",
};

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  "tests/test_x.py:1: a Python file; write shell or TypeScript",
  ".github/helper.pyw:1: a Python file; write shell or TypeScript",
  "ctl/a:2: runs python3; write shell or TypeScript",
  "ctl/a:3: runs python; write shell or TypeScript",
  "ctl/a:3: runs pip3; write shell or TypeScript",
  "host/b:2: runs python3.13; write shell or TypeScript",
  "host/b:3: runs python; write shell or TypeScript",
  "tests/x.test.ts:1: runs python3; write shell or TypeScript",
  "tests/x.test.ts:2: runs python; write shell or TypeScript",
  ".github/workflows/ci.yml:4: runs actions/setup-python; write shell or TypeScript",
  ".github/workflows/ci.yml:5: runs python3; write shell or TypeScript",
  ".github/workflows/ci.yml:6: runs pip3; write shell or TypeScript",
  "tests/X.PY:1: a Python file; write shell or TypeScript",
  "ctl/tool:1: runs under python3; write shell or TypeScript",
  "host/tool2:1: runs under python3.13; write shell or TypeScript",
  "ctl/c:2: runs python3; write shell or TypeScript",
  "ctl/c:3: runs python3; write shell or TypeScript",
  "ctl/c:4: runs python3; write shell or TypeScript",
  "tests/z.test.ts:1: runs python3; write shell or TypeScript",
  "tests/z.test.ts:2: runs python3; write shell or TypeScript",
  "tests/z.test.ts:3: runs python3; write shell or TypeScript",
  "tests/z.test.ts:4: runs python3; write shell or TypeScript",
];
