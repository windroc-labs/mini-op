const item = "mac-mini-" + "alice-password";
const other = "mac-mini-" + "x.y_z-password";

export const violation = {
  "README.md": `# x\n\nRead it: \`keychain_read ${item} alice\`.\nStore it: \`~/apm/runbooks/s/storekey ${other} a\`.\n`,
  "ctl/mini": `#!/bin/zsh\nsecurity add-generic-password -s ${other} -w x\n`,
  "mini/bin/pw": "#!/bin/zsh\nkeychain_read 'mini-op-password' | ssh mini x\n",
  "host/key":
    "#!/bin/zsh\nsecurity delete-generic-password -s Mini-Op-Password\nkeychain_has mini-password\n",
  "config/env.toml": [
    "[x]",
    'item = "mini-op-password"',
    'item = "Mac Mini Password"',
    'env = { item = "mini-password", file = "x" }',
    "item = '''mini-op-password'''",
    "",
  ].join("\n"),
  "config/env.yaml": "secrets:\n  - item: mac-mini-x-password\n  - item: Mac Mini Password # x\n",
};

export const clean = {
  "README.md": [
    `The mini's password: \`ensemble-env/mini-op-password\`, never ${item}.`,
    "Read it: `keychain_read ensemble-env/mini-op-password`.",
    "Store it: `~/apm/runbooks/s/storekey ensemble-env/mini-op-password a`.",
    "",
  ].join("\n"),
  "ctl/mini":
    '#!/bin/zsh\nssh mini x < /run/ensemble/secrets/env/mini-password\nf="mini-password"\n',
  "mini/bin/pw": "#!/bin/zsh\nkeychain_read strata-api-key strata | ssh mini x\n",
  "host/key":
    "#!/bin/zsh\nsecurity add-generic-password -s x -w /run/ensemble/secrets/env/mini-password\n",
  "host/vars": [
    "#!/bin/zsh",
    'security unlock-keychain -p "$mini_password" login.keychain',
    'security add-generic-password -s ensemble-env/mini-op-password -w "$(cat /run/ensemble/secrets/env/mini-password)"',
    "",
  ].join("\n"),
  "config/env.toml": [
    "[x]",
    'item = "ensemble-env/mini-op-password"',
    'file = "mini-password"',
    '# item = "mini-op-password"',
    '# env = { item = "mini-op-password" }',
    "s = { item = 'ensemble-env/mini-op-password' }",
    'note = "x" # see { item = "mini-op-password" }',
    'url = "a#b" # item = "mini-op-password"',
    "",
  ].join("\n"),
  "config/env.yaml": "secrets:\n  - item: ensemble-env/mini-op-password\n",
};

const message = (name: string) =>
  `names the mini's password item ${name} outside ensemble-env/; import it with ensemble-broker login env`;

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  `README.md:3: ${message(item)}`,
  `ctl/mini:2: ${message(other)}`,
  `mini/bin/pw:2: ${message("mini-op-password")}`,
  `host/key:2: ${message("Mini-Op-Password")}`,
  `README.md:4: ${message(other)}`,
  `host/key:3: ${message("mini-password")}`,
  `config/env.toml:2: ${message("mini-op-password")}`,
  `config/env.toml:3: ${message("Mac Mini Password")}`,
  `config/env.toml:4: ${message("mini-password")}`,
  `config/env.toml:5: ${message("mini-op-password")}`,
  `config/env.yaml:3: ${message("Mac Mini Password")}`,
  `config/env.yaml:2: ${message("mac-mini-x-password")}`,
];
