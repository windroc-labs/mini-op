const workflow = [
  "jobs:",
  "  a:",
  "    steps:",
  "      - name: clean",
  "        run: |",
  "          make",
  '          rm -rf "$RUNNER_TEMP/x"',
  "      - run: rm -f y.tab.c",
].join("\n");

export const violation = {
  "mini/bin/a": [
    "#!/bin/zsh",
    'rm -f -- "$marker"',
    'ssh mini "rm -rf ~/apm/$d"',
    'LC_ALL=C rm -rf "$d"/x',
    'find "$dir" -name x -delete',
    "rmdir $(pwd)/x",
    'x=$(rm -f "$y")',
    'sudo -u root rm -r -- "${a:?}/$b"',
    "ssh mini \"rm -rf ~/apm/'$d'\"",
    'find -L "$d" -name x -delete',
    'find -x "$d" -delete',
    'find -f "$d" -delete',
    "",
  ].join("\n"),
  ".github/workflows/ci.yml": workflow,
  "host/Dockerfile": "FROM x\nRUN set -eux; \\\n    rm -rf $X\n",
  "tests/a.test.ts": 'run(["rm", "-rf", dir]);\nconst s = `rm -f ${f}`;\n',
};

export const clean = {
  "mini/bin/a": [
    "#!/bin/zsh",
    'rm -f -- "${marker:?}"',
    "rm -f y.tab.c y.tab.h",
    'docker rm -f "$x"',
    "find . -name x -print",
    "rm -rf /var/lib/apt/lists/*",
    "ssh mini 'rm -f ~/apm/x'",
    'echo "remove it (docker network rm $net) and rerun"',
    "rm '$literal' \"${dir:?}/${id:?}.tmp\"",
    "trap 'rm -rf \"${work:?}\"' EXIT",
    "",
  ].join("\n"),
  "tests/b.test.ts": 'run(["rm", "-f", "/tmp/x"]);\nconst names = ["rm", "rmdir"];\n',
  "README.md": 'Never `rm -rf "$d"`.\n',
};

// Every violation the sample must produce, as "<file>:<line>: <message>".
const at = (where: string, cmd: string, word: string) =>
  `${where}: ${cmd} target ${word} is neither literal nor "\${VAR:?}…"`;
export const expected = [
  at("mini/bin/a:2", "rm", '"$marker"'),
  at("mini/bin/a:3", "rm", "~/apm/$d"),
  at("mini/bin/a:4", "rm", '"$d"/x'),
  at("mini/bin/a:5", "find -delete", '"$dir"'),
  at("mini/bin/a:6", "rmdir", "$(pwd)/x"),
  at("mini/bin/a:7", "rm", '"$y"'),
  at("mini/bin/a:8", "rm", '"${a:?}/$b"'),
  at("mini/bin/a:9", "rm", "~/apm/'$d'"),
  at("mini/bin/a:10", "find -delete", '"$d"'),
  at("mini/bin/a:11", "find -delete", '"$d"'),
  at("mini/bin/a:12", "find -delete", '"$d"'),
  at(".github/workflows/ci.yml:7", "rm", '"$RUNNER_TEMP/x"'),
  at("host/Dockerfile:3", "rm", "$X"),
  at("tests/a.test.ts:1", "rm", "dir"),
  at("tests/a.test.ts:2", "rm", "${f}"),
];
