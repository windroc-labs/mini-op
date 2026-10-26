const secrets = "/run/" + "secrets";
const env = "/run/ensemble/" + "secrets/env";
const registry = (literal: object[]) =>
  JSON.stringify({ variable: "MINI_OP_SECRETS_DIR", resolver: "ctl/lib/secrets.zsh", literal });
const resolver =
  'secrets_dir() { print -r -- "${MINI_OP_SECRETS_DIR:-' +
  secrets +
  '}"; }\nenv_secrets_dir() { print -r -- ' +
  env +
  "; }\n";
const start = `#!/usr/bin/env bash\necho "${secrets}:size=64k" x\n`;

export const violation = {
  "tests/registry/secrets.json": registry([
    { file: "host/unused", reads: false, reason: "no longer names it" },
    { file: "ctl/new-reader", reads: true, reason: "not in the E1 baseline" },
    { file: "host/start", reads: false, reason: "" },
  ]),
  "ctl/lib/secrets.zsh": resolver,
  "host/unused": "#!/usr/bin/env bash\necho stop\n",
  "host/start": start,
  "ctl/new-reader": `#!/bin/zsh\ncat ${secrets}/alice\n`,
  "ctl/unregistered": `#!/bin/zsh\ncat ${secrets}/alice\n`,
  "ctl/peek": "#!/bin/zsh\necho $MINI_OP_SECRETS_DIR\n",
  "host/bad-env": "#!/usr/bin/env bash\nexport MINI_OP_SECRETS_DIR=/tmp/x\n",
  "tests/a.test.ts": `readFileSync("${secrets}/alice");\n`,
  "ctl/env-reader": `#!/bin/zsh\ncat ${env}/mini-password\n`,
  "tests/b.test.ts": `const dir = "${env}";\n`,
  ".github/workflows/x.yml": `run: test -r ${env}/mini-ssh-key\n`,
};

export const clean = {
  "tests/registry/secrets.json": registry([]),
  "ctl/lib/secrets.zsh": resolver,
  "host/start": "#!/usr/bin/env bash\necho start\n",
  "ctl/mini": '#!/bin/zsh\nsource ${0:A:h}/lib/secrets.zsh\nssh mini x < "$(env_secrets_dir)/mini-password"\n',
  "tests/a.test.ts": 'const s = "/run/" + "secrets";\n',
  "tests/b.test.ts": 'const dir = "/run/ensemble/" + "secrets/env";\n',
  "host/ssh_config.keys": `Match originalhost mini\n    IdentityFile ${env}/mini-ssh-key\n`,
  "host/README.md": `Secrets live in ${env}.\n`,
};

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  "tests/registry/secrets.json:1: host/unused is not in E1's baseline; use the resolver",
  "tests/registry/secrets.json:1: host/start is not in E1's baseline; use the resolver",
  "tests/registry/secrets.json:1: host/unused no longer names /run/secrets; remove its row",
  "tests/registry/secrets.json:1: ctl/new-reader is not in E1's baseline; use the resolver",
  "tests/registry/secrets.json:1: host/start has no reason",
  "host/bad-env:2: names MINI_OP_SECRETS_DIR outside ctl/lib/secrets.zsh",
  "host/bad-env:2: sets MINI_OP_SECRETS_DIR",
  "ctl/peek:2: names MINI_OP_SECRETS_DIR outside ctl/lib/secrets.zsh",
  "ctl/unregistered:2: names /run/secrets; use secrets_dir",
  "tests/a.test.ts:1: names /run/secrets; use secrets_dir",
  `ctl/env-reader:2: names ${env}; use env_secrets_dir`,
  `tests/b.test.ts:1: names ${env}; use env_secrets_dir`,
  `.github/workflows/x.yml:1: names ${env}; use env_secrets_dir`,
];
