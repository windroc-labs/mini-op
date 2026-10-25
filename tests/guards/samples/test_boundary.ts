const registry = JSON.stringify({
  variable: "MINI_OP_SECRETS_DIR",
  resolver: "ctl/lib/secrets.zsh",
  literal: [],
});

export const violation = {
  "tests/registry/secrets.json": registry,
  "ctl/a": "#!/usr/bin/env zsh\nFOO_TEST=1\nprint $FORCE_COLOR\n",
  "mini/bin/b":
    "#!/bin/zsh\n/usr/local/bin/foo x\nls | /bin/cat\nif true; then /opt/x/y; fi\nX=1 /usr/bin/tool\n",
  "host/c": "#!/usr/bin/env bash\nresult=$(/usr/bin/id -u)\n",
  "host/d": "#!/usr/bin/env bash\nmake && \\\n  /usr/bin/id -u\nfind . | \\\n  /usr/bin/xargs rm\n",
  "host/Dockerfile": "FROM x\nENV DRY_TEST=1\n",
  "tests/x.test.ts":
    'run(["/usr/bin/git", "status"]);\nconst p = "a:/usr/bin";\nprocess.env.PATH = p;\nconst q = `/bin:${p}`;\nconst r = [p, "/bin"].join(":");\n',
};

export const clean = {
  "tests/registry/secrets.json": registry,
  "ctl/lib/secrets.zsh": 'secrets_dir() { print -r -- "${MINI_OP_SECRETS_DIR:-x}"; }\n',
  "ctl/ok":
    '#!/usr/bin/env zsh\nprint "/usr/bin/x is a path"\ntar -C /opt -xf - >/dev/null 2>&1\nmy_TESTS=1\n# /usr/bin/foo in a comment\npath=(/usr/local/bin $path)\n',
  "mini/bin/d": "#!/usr/bin/env zsh\n/usr/bin/ssh mini true\n",
  "host/cont": "#!/usr/bin/env bash\ntar -C \\\n  /opt/foo -xf x\n",
  "mini/runbooks/x/y": "#!/usr/bin/env zsh\n~/apm/runbooks/setup-test-env/maillink mark e\n",
  "host/Dockerfile": "FROM x\nRUN /usr/bin/apt-get update\n",
  "tests/y.test.ts":
    'const s = "#!/bin/zsh\\nprint hi\\n";\nconst h = process.env.HOME;\nconst t = path.join(sb.dir, "bin");\nconst e = "#!/usr/bin/env bash";\nsb.fake("sh", [{ stdout: "/usr/bin/nc\\n" }]);\n',
  "tests/guards/samples/z.ts": 'const x = "/usr/bin/x";\n',
};

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  "ctl/a:2: test switch FOO_TEST in shipped code",
  "ctl/a:3: test switch FORCE_COLOR in shipped code",
  "host/Dockerfile:2: test switch DRY_TEST in shipped code",
  "host/c:2: runs /usr/bin/id by absolute path; call it by name",
  "host/d:3: runs /usr/bin/id by absolute path; call it by name",
  "host/d:5: runs /usr/bin/xargs by absolute path; call it by name",
  "mini/bin/b:1: shebang must be #!/usr/bin/env <interpreter>",
  "mini/bin/b:2: runs /usr/local/bin/foo by absolute path; call it by name",
  "mini/bin/b:3: runs /bin/cat by absolute path; call it by name",
  "mini/bin/b:4: runs /opt/x/y by absolute path; call it by name",
  "mini/bin/b:5: runs /usr/bin/tool by absolute path; call it by name",
  "tests/x.test.ts:1: names a real tool path; run tools by name in a Sandbox",
  "tests/x.test.ts:2: puts a system dir on PATH",
  "tests/x.test.ts:3: sets PATH",
  "tests/x.test.ts:4: puts a system dir on PATH",
  "tests/x.test.ts:5: puts a system dir on PATH",
];
