const item = "mac-mini-" + "alice-password";
const other = "mac-mini-" + "x.y_z-password";

export const violation = {
  "README.md": `# x\n\nRead it: \`keychain_read ${item} alice\`.\nStore it: \`~/apm/runbooks/s/storekey ${other} a\`.\n`,
  "ctl/mini": `#!/bin/zsh\nsecurity add-generic-password -s ${other} -w x\n`,
  "mini/bin/pw": "#!/bin/zsh\nkeychain_read 'mini-op-password' | ssh mini x\n",
  "host/key":
    "#!/bin/zsh\nsecurity delete-generic-password -s Mini-Op-Password\nkeychain_has mini-password\n",
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
];
