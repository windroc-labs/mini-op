const dir = "/run/" + "secrets";
const rows = (files: string[]) =>
  JSON.stringify(files.map((file) => ({ file, text: "IFS= read -r v", reason: "r" })));
const scripts = {
  "ctl/a": '#!/bin/zsh\npwfile=$(secrets_dir)/alice\nssh mini x < "$pwfile"\n',
  "mini/bin/b": "#!/bin/zsh\nsecurity find-generic-password -s x -w | ssh mini y\n",
  "mini/bin/c": "#!/bin/zsh\ncat >/dev/null\n",
  "mini/bin/d": "#!/bin/zsh\nIFS= read -r v\n",
  "mini/bin/e": "#!/bin/zsh\ncat >/dev/null\n",
  "mini/bin/g": "#!/bin/zsh\ncat >/dev/null\n",
  "mini/bin/h": "#!/bin/zsh\ncat >/dev/null\n",
  "README.md": [
    "Answer: `security find-generic-password -s k -w | ~/apm/bin/c 5 --to <id>`.",
    "Key: `security find-internet-password -wa x | ~/apm/bin/g`.",
    `Loop: \`while IFS= read -r l; do ~/apm/bin/h; done < ${dir}/alice\`.`,
    `Store: \`ssh mini '~/apm/bin/e s a' < ${dir}/alice\`.`,
    "",
  ].join("\n"),
  "host/start": `#!/usr/bin/env bash\ndocker container run --tmpfs "${dir}:size=64k" x\n`,
  "ctl/lib/secrets.zsh": `secrets_dir() { print -r -- "\${MINI_OP_SECRETS_DIR:-${dir}}"; }\n`,
  "mini/bin/f": "#!/bin/zsh\n# reads nothing\nprint ok | ssh mini x\n",
  "mini/lib/keychain.zsh": 'keychain_read() { security find-generic-password -s "$1" -w; }\n',
  "mini/bin/k": "#!/bin/zsh\nkeychain_read x y | curl -H @- u\n",
  "mini/bin/m": '#!/bin/zsh\no eval "$(page_js go $L)"\n',
  "tests/registry/secret-reads.json": JSON.stringify([
    ...JSON.parse(rows(["mini/bin/d"])),
    { file: "mini/bin/m", text: "page_js go", reason: "r", argv: true },
  ]),
};

export const violation = {
  ...scripts,
  "tests/lib/canary.ts": 'export const SECRET_SCRIPTS = [];\nconst note = "mini/bin/b";\n',
};

export const clean = {
  ...scripts,
  "tests/lib/canary.ts": [
    "export const SECRET_SCRIPTS = [",
    '  { script: "ctl/a" },',
    '  { script: "mini/bin/b" },',
    '  { script: "mini/bin/c" },',
    '  { script: "mini/bin/d" },',
    '  { script: "mini/bin/e" },',
    '  { script: "mini/bin/g" },',
    '  { script: "mini/bin/h" },',
    '  { script: "mini/bin/k" },',
    "];",
    "",
  ].join("\n"),
};

// Every violation the sample must produce, as "<file>:<line>: <message>".
const at = (file: string) =>
  `${file}:1: reads a secret but has no canary scenario in tests/lib/canary.ts`;
export const expected = [
  "ctl/a",
  "mini/bin/b",
  "mini/bin/c",
  "mini/bin/d",
  "mini/bin/g",
  "mini/bin/h",
  "mini/bin/k",
  "mini/bin/e",
].map(at);
