const secrets = "/run/" + "secrets";
const registry = (literal: object[]) =>
  JSON.stringify({ variable: "MINI_OP_SECRETS_DIR", resolver: "ctl/lib/secrets.zsh", literal });
const resolver = 'secrets_dir() { print -r -- "${MINI_OP_SECRETS_DIR:-' + secrets + '}"; }\n';
const start = `#!/usr/bin/env bash\ndocker run --tmpfs "${secrets}:size=64k" x\n`;

export const violation = {
  "tests/registry/secrets.json": registry([
    { file: "host/stop", reads: false, reason: "no longer names it" },
    { file: "ctl/new-reader", reads: true, reason: "not in the E1 baseline" },
    { file: "host/start", reads: false, reason: "" },
  ]),
  "ctl/lib/secrets.zsh": resolver,
  "host/stop": "#!/usr/bin/env bash\necho stop\n",
  "host/start": start,
  "ctl/new-reader": `#!/bin/zsh\ncat ${secrets}/alice\n`,
  "ctl/unregistered": `#!/bin/zsh\ncat ${secrets}/alice\n`,
  "ctl/peek": "#!/bin/zsh\necho $MINI_OP_SECRETS_DIR\n",
  "host/update": "#!/usr/bin/env bash\nexport MINI_OP_SECRETS_DIR=/tmp/x\n",
  "tests/a.test.ts": `readFileSync("${secrets}/alice");\n`,
};

export const clean = {
  "tests/registry/secrets.json": registry([
    { file: "host/start", reads: false, reason: "creates the secrets tmpfs" },
  ]),
  "ctl/lib/secrets.zsh": resolver,
  "host/start": start,
  "ctl/mini": '#!/bin/zsh\nsource ${0:A:h}/lib/secrets.zsh\nssh mini x < "$(secrets_dir)/alice"\n',
  "host/README.md": `Secrets live in ${secrets}.\n`,
  "tests/a.test.ts": 'const s = "/run/" + "secrets";\n',
};

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  "tests/registry/secrets.json:1: host/stop no longer names /run/secrets; remove its row",
  "tests/registry/secrets.json:1: ctl/new-reader is not in E1's baseline; use the resolver",
  "tests/registry/secrets.json:1: host/start has no reason",
  "host/update:2: names MINI_OP_SECRETS_DIR outside ctl/lib/secrets.zsh",
  "host/update:2: sets MINI_OP_SECRETS_DIR",
  "ctl/peek:2: names MINI_OP_SECRETS_DIR outside ctl/lib/secrets.zsh",
  "ctl/unregistered:2: names /run/secrets; use secrets_dir",
  "tests/a.test.ts:1: names /run/secrets; use secrets_dir",
];
